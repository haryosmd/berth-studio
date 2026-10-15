//! MongoDB for Berth Studio. See `docs/providers/mongodb.md` for the verified behaviour this
//! module relies on.
//!
//! MongoDB has no read-only session setting, so a read-only [`Session`] refuses writes itself:
//! inserts, replacements, deletions, and aggregation pipelines with `$out` or `$merge`. Real
//! protection comes from connecting with a user that has the `read` role.
//!
//! The driver has no cancellation API, and dropping a driver future part-way can leave it in an
//! inconsistent state. Every operation therefore carries a server-side `maxTimeMS`, runs in its
//! own task, and is waited on with a deadline instead of being dropped.

use berth_core::ReadPreference;
use futures_util::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use mongodb::options::{ClientOptions, Credential, ReadPreference as DriverReadPreference, SelectionCriteria};
use mongodb::Client;
use serde::Serialize;
use serde_json::Value;
use std::future::Future;
use std::time::{Duration, Instant};

/// Documents kept per result. Documents can be up to 16 MiB each, so this is lower than the
/// PostgreSQL row limit.
pub const MAX_DOCS: usize = 1_000;
pub const DEFAULT_MAX_TIME: Duration = Duration::from_secs(30);
const SELECTION_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long to keep waiting after the server's own `maxTimeMS` should have stopped an operation.
const GRACE: Duration = Duration::from_secs(5);
/// The largest filter, sort, projection or pipeline accepted as text.
const MAX_INPUT_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, thiserror::Error, Serialize)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct MongoError {
    pub message: String,
    /// The server's error code name, for example `Unauthorized` or `MaxTimeMSExpired`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl MongoError {
    pub fn msg(message: impl Into<String>) -> Self {
        MongoError { message: message.into(), code: None }
    }
}

impl From<mongodb::error::Error> for MongoError {
    fn from(e: mongodb::error::Error) -> Self {
        match e.kind.as_ref() {
            mongodb::error::ErrorKind::Command(c) => MongoError { message: c.message.clone(), code: Some(c.code_name.clone()) },
            // Driver errors (selection timeouts, network, authentication) never include the password.
            _ => MongoError::msg(e.to_string()),
        }
    }
}

/// Everything needed to connect, except the password.
#[derive(Debug, Clone)]
pub struct Target {
    pub uri: String,
    pub user: String,
    pub auth_source: Option<String>,
    pub read_preference: ReadPreference,
    pub read_only: bool,
    pub max_time: Duration,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub version: String,
    /// `standalone`, `replica set <name>` or `sharded cluster`.
    pub topology: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInfo {
    pub name: String,
    /// `collection`, `view` or `timeseries`.
    pub kind: String,
    /// The estimated document count, from collection metadata. Views have none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Documents {
    /// Relaxed Extended JSON: `{"$oid": …}`, `{"$date": …}`, `{"$numberDecimal": …}` and so on.
    pub documents: Vec<Value>,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

/// A query on one collection. Filter, sort and projection are Extended JSON objects as text.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FindRequest {
    pub filter: String,
    pub sort: String,
    pub projection: String,
    pub skip: u64,
    pub limit: u32,
}

#[derive(Clone)]
pub struct Session {
    client: Client,
    pub read_only: bool,
    max_time: Duration,
    pub info: ServerInfo,
}

fn read_preference(p: ReadPreference) -> SelectionCriteria {
    match p {
        ReadPreference::Primary => SelectionCriteria::ReadPreference(DriverReadPreference::Primary),
        ReadPreference::SecondaryPreferred => SelectionCriteria::ReadPreference(DriverReadPreference::SecondaryPreferred { options: None }),
    }
}

/// Parses an Extended JSON object typed by the user. Empty text means `{}`.
pub fn parse_document(text: &str, what: &str) -> Result<Document, MongoError> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(Document::new());
    }
    if text.len() > MAX_INPUT_BYTES {
        return Err(MongoError::msg(format!("The {what} is larger than 256 KiB.")));
    }
    let value: Value = serde_json::from_str(text).map_err(|e| MongoError::msg(format!("The {what} is not valid JSON: {e}")))?;
    match Bson::try_from(value) {
        Ok(Bson::Document(d)) => Ok(d),
        Ok(_) => Err(MongoError::msg(format!("The {what} must be a JSON object."))),
        Err(e) => Err(MongoError::msg(format!("The {what} is not valid Extended JSON: {e}"))),
    }
}

/// Parses an aggregation pipeline: a JSON array of stage objects.
pub fn parse_pipeline(text: &str) -> Result<Vec<Document>, MongoError> {
    if text.len() > MAX_INPUT_BYTES {
        return Err(MongoError::msg("The pipeline is larger than 256 KiB."));
    }
    let value: Value = serde_json::from_str(text.trim()).map_err(|e| MongoError::msg(format!("The pipeline is not valid JSON: {e}")))?;
    let Value::Array(stages) = value else {
        return Err(MongoError::msg("The pipeline must be a JSON array of stages."));
    };
    stages
        .into_iter()
        .enumerate()
        .map(|(i, s)| match Bson::try_from(s) {
            Ok(Bson::Document(d)) if d.len() == 1 => Ok(d),
            Ok(Bson::Document(_)) => Err(MongoError::msg(format!("Stage {} must have exactly one operator, such as $match.", i + 1))),
            Ok(_) => Err(MongoError::msg(format!("Stage {} must be an object.", i + 1))),
            Err(e) => Err(MongoError::msg(format!("Stage {} is not valid Extended JSON: {e}", i + 1))),
        })
        .collect()
}

/// True when a pipeline writes: `$out` and `$merge` store its results in a collection.
pub fn pipeline_writes(pipeline: &[Document]) -> bool {
    pipeline.iter().any(|s| s.contains_key("$out") || s.contains_key("$merge"))
}

/// Converts BSON to relaxed Extended JSON. `Bson::into_relaxed_extjson` panics on Decimal128,
/// so that type is written in its canonical form instead.
pub fn to_json(value: Bson) -> Value {
    match value {
        Bson::Document(d) => Value::Object(d.into_iter().map(|(k, v)| (k, to_json(v))).collect()),
        Bson::Array(a) => Value::Array(a.into_iter().map(to_json).collect()),
        Bson::Decimal128(d) => serde_json::json!({ "$numberDecimal": d.to_string() }),
        other => other.into_relaxed_extjson(),
    }
}

fn check_name(name: &str, what: &str) -> Result<(), MongoError> {
    if name.is_empty() || name.len() > 255 || name.contains('\0') {
        return Err(MongoError::msg(format!("Invalid {what} name.")));
    }
    Ok(())
}

impl Session {
    pub async fn connect(target: &Target, password: Option<&str>) -> Result<Session, MongoError> {
        let mut opts = ClientOptions::parse(target.uri.trim()).await?;
        opts.app_name = Some("Berth Studio".into());
        opts.server_selection_timeout = Some(SELECTION_TIMEOUT);
        opts.connect_timeout = Some(CONNECT_TIMEOUT);
        opts.selection_criteria = Some(read_preference(target.read_preference));
        let user = target.user.trim();
        if !user.is_empty() {
            let mut cred = Credential::builder().username(user.to_string()).build();
            cred.password = password.map(str::to_string);
            cred.source = target.auth_source.clone().filter(|s| !s.is_empty());
            opts.credential = Some(cred);
        }
        let client = Client::with_options(opts)?;
        let info = run_bounded(target.max_time, {
            let client = client.clone();
            async move { server_info(&client).await }
        })
        .await?;
        Ok(Session { client, read_only: target.read_only, max_time: target.max_time, info })
    }

    pub async fn list_databases(&self) -> Result<Vec<String>, MongoError> {
        let client = self.client.clone();
        run_bounded(self.max_time, async move { Ok(client.list_database_names().authorized_databases(true).await?) }).await
    }

    pub async fn list_collections(&self, db: &str) -> Result<Vec<CollectionInfo>, MongoError> {
        check_name(db, "database")?;
        let database = self.client.database(db);
        run_bounded(self.max_time, async move {
            let specs: Vec<_> = database.list_collections().await?.try_collect().await?;
            let mut out = Vec::with_capacity(specs.len());
            for s in specs {
                let kind = match s.collection_type {
                    mongodb::results::CollectionType::View => "view",
                    mongodb::results::CollectionType::Timeseries => "timeseries",
                    _ => "collection",
                };
                let count =
                    if kind == "view" { None } else { database.collection::<Document>(&s.name).estimated_document_count().await.ok() };
                out.push(CollectionInfo { name: s.name, kind: kind.into(), count });
            }
            out.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(out)
        })
        .await
    }

    pub async fn find(&self, db: &str, collection: &str, req: FindRequest) -> Result<Documents, MongoError> {
        check_name(db, "database")?;
        check_name(collection, "collection")?;
        let filter = parse_document(&req.filter, "filter")?;
        let sort = parse_document(&req.sort, "sort")?;
        let projection = parse_document(&req.projection, "projection")?;
        let limit = req.limit.clamp(1, MAX_DOCS as u32) as i64;
        let coll = self.client.database(db).collection::<Document>(collection);
        let max_time = self.max_time;
        let started = Instant::now();
        run_bounded(max_time, async move {
            let mut find = coll.find(filter).skip(req.skip).limit(limit + 1).max_time(max_time).batch_size(200);
            if !sort.is_empty() {
                find = find.sort(sort);
            }
            if !projection.is_empty() {
                find = find.projection(projection);
            }
            collect(find.await?, limit as usize, started).await
        })
        .await
    }

    pub async fn aggregate(&self, db: &str, collection: &str, pipeline: &str) -> Result<Documents, MongoError> {
        check_name(db, "database")?;
        check_name(collection, "collection")?;
        let stages = parse_pipeline(pipeline)?;
        if self.read_only && pipeline_writes(&stages) {
            return Err(MongoError::msg("This session is read-only, and $out or $merge would write the results to a collection."));
        }
        let coll = self.client.database(db).collection::<Document>(collection);
        let max_time = self.max_time;
        let started = Instant::now();
        run_bounded(
            max_time,
            async move { collect(coll.aggregate(stages).max_time(max_time).batch_size(200).await?, MAX_DOCS, started).await },
        )
        .await
    }

    pub async fn list_indexes(&self, db: &str, collection: &str) -> Result<Vec<Value>, MongoError> {
        check_name(db, "database")?;
        check_name(collection, "collection")?;
        let coll = self.client.database(db).collection::<Document>(collection);
        run_bounded(self.max_time, async move {
            let models: Vec<_> = coll.list_indexes().await?.try_collect().await?;
            Ok(models
                .into_iter()
                .map(|m| {
                    let name = m.options.as_ref().and_then(|o| o.name.clone()).unwrap_or_default();
                    let unique = m.options.as_ref().and_then(|o| o.unique).unwrap_or(false);
                    serde_json::json!({ "name": name, "keys": to_json(Bson::Document(m.keys)), "unique": unique })
                })
                .collect())
        })
        .await
    }

    fn writable(&self) -> Result<(), MongoError> {
        if self.read_only {
            return Err(MongoError { message: "This session is read-only.".into(), code: Some("BerthReadOnly".into()) });
        }
        Ok(())
    }

    /// Inserts one document and returns its `_id`.
    pub async fn insert_one(&self, db: &str, collection: &str, document: &str) -> Result<Value, MongoError> {
        self.writable()?;
        check_name(db, "database")?;
        check_name(collection, "collection")?;
        let doc = parse_document(document, "document")?;
        let coll = self.client.database(db).collection::<Document>(collection);
        run_bounded(self.max_time, async move { Ok(to_json(coll.insert_one(doc).await?.inserted_id)) }).await
    }

    /// Replaces the document with this `_id` and returns how many documents changed (0 or 1).
    pub async fn replace_one(&self, db: &str, collection: &str, id: &str, document: &str) -> Result<u64, MongoError> {
        self.writable()?;
        check_name(db, "database")?;
        check_name(collection, "collection")?;
        let id = parse_id(id)?;
        let mut doc = parse_document(document, "document")?;
        if doc.get("_id").is_some_and(|v| v != &id) {
            return Err(MongoError::msg("The document's _id cannot change."));
        }
        doc.remove("_id");
        let coll = self.client.database(db).collection::<Document>(collection);
        run_bounded(self.max_time, async move { Ok(coll.replace_one(doc! { "_id": id }, doc).await?.modified_count) }).await
    }

    /// Deletes the document with this `_id` and returns how many were deleted (0 or 1).
    pub async fn delete_one(&self, db: &str, collection: &str, id: &str) -> Result<u64, MongoError> {
        self.writable()?;
        check_name(db, "database")?;
        check_name(collection, "collection")?;
        let id = parse_id(id)?;
        let coll = self.client.database(db).collection::<Document>(collection);
        run_bounded(self.max_time, async move { Ok(coll.delete_one(doc! { "_id": id }).await?.deleted_count) }).await
    }
}

/// An `_id` given as Extended JSON, for example `{"$oid":"…"}`, `"abc"` or `42`.
fn parse_id(text: &str) -> Result<Bson, MongoError> {
    let value: Value = serde_json::from_str(text.trim()).map_err(|e| MongoError::msg(format!("The _id is not valid JSON: {e}")))?;
    Bson::try_from(value).map_err(|e| MongoError::msg(format!("The _id is not valid Extended JSON: {e}")))
}

async fn collect(mut cursor: mongodb::Cursor<Document>, limit: usize, started: Instant) -> Result<Documents, MongoError> {
    let mut out = Documents::default();
    while let Some(d) = cursor.try_next().await? {
        if out.documents.len() == limit {
            out.truncated = true;
            break;
        }
        out.documents.push(to_json(Bson::Document(d)));
    }
    out.elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(out)
}

async fn server_info(client: &Client) -> Result<ServerInfo, MongoError> {
    let admin = client.database("admin");
    let any = SelectionCriteria::ReadPreference(DriverReadPreference::PrimaryPreferred { options: None });
    let hello = admin.run_command(doc! { "hello": 1 }).selection_criteria(any.clone()).await?;
    let build = admin.run_command(doc! { "buildInfo": 1 }).selection_criteria(any).await?;
    let topology = if hello.get_str("msg") == Ok("isdbgrid") {
        "sharded cluster".to_string()
    } else if let Ok(set) = hello.get_str("setName") {
        format!("replica set {set}")
    } else {
        "standalone".to_string()
    };
    Ok(ServerInfo { version: build.get_str("version").unwrap_or("unknown").to_string(), topology })
}

/// Runs a driver operation in its own task and waits for it with a deadline a little longer than
/// the server's `maxTimeMS`. If the deadline passes, the task is left to finish on its own rather
/// than dropped part-way.
async fn run_bounded<T, F>(max_time: Duration, op: F) -> Result<T, MongoError>
where
    T: Send + 'static,
    F: Future<Output = Result<T, MongoError>> + Send + 'static,
{
    let task = tokio::spawn(op);
    match tokio::time::timeout(max_time + SELECTION_TIMEOUT + GRACE, task).await {
        Ok(Ok(result)) => result,
        Ok(Err(join)) => Err(MongoError::msg(format!("The operation stopped unexpectedly: {join}"))),
        Err(_) => Err(MongoError {
            message: "The server did not answer in time. The operation may still finish on the server.".into(),
            code: Some("BerthTimeout".into()),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{oid::ObjectId, Decimal128};
    use std::str::FromStr;

    #[test]
    fn decimal128_does_not_panic_and_other_types_stay_readable() {
        let oid = ObjectId::parse_str("6512bd43d9caa6e02c990b0a").unwrap();
        let d = doc! {
            "_id": oid,
            "price": Bson::Decimal128(Decimal128::from_str("19.99").unwrap()),
            "nested": { "tags": ["a", "b"], "n": 3_i64 },
            "at": mongodb::bson::DateTime::from_millis(0),
        };
        let v = to_json(Bson::Document(d));
        assert_eq!(v["_id"]["$oid"], "6512bd43d9caa6e02c990b0a");
        assert_eq!(v["price"]["$numberDecimal"], "19.99");
        assert_eq!(v["nested"]["tags"][1], "b");
        assert_eq!(v["nested"]["n"], 3);
        assert_eq!(v["at"]["$date"], "1970-01-01T00:00:00Z");
    }

    #[test]
    fn user_input_is_parsed_as_extended_json_objects() {
        assert!(parse_document("", "filter").unwrap().is_empty());
        let f = parse_document(r#"{"_id": {"$oid": "6512bd43d9caa6e02c990b0a"}, "n": {"$gt": 3}}"#, "filter").unwrap();
        assert!(matches!(f.get("_id"), Some(Bson::ObjectId(_))));
        assert!(parse_document("[1,2]", "filter").unwrap_err().message.contains("must be a JSON object"));
        assert!(parse_document("{nope", "filter").unwrap_err().message.contains("not valid JSON"));
        assert!(parse_document(&format!("{{\"a\":\"{}\"}}", "x".repeat(300_000)), "filter").is_err());
    }

    #[test]
    fn pipelines_are_checked_and_writing_stages_are_detected() {
        let p = parse_pipeline(r#"[{"$match": {"type": "click"}}, {"$group": {"_id": "$user", "n": {"$sum": 1}}}]"#).unwrap();
        assert_eq!(p.len(), 2);
        assert!(!pipeline_writes(&p));
        assert!(pipeline_writes(&parse_pipeline(r#"[{"$match": {}}, {"$out": "copy"}]"#).unwrap()));
        assert!(pipeline_writes(&parse_pipeline(r#"[{"$merge": {"into": "copy"}}]"#).unwrap()));
        assert!(parse_pipeline(r#"{"$match": {}}"#).unwrap_err().message.contains("JSON array"));
        assert!(parse_pipeline(r#"[{"$match": {}, "$limit": 1}]"#).unwrap_err().message.contains("exactly one operator"));
        assert!(parse_pipeline("[1]").unwrap_err().message.contains("must be an object"));
    }

    #[test]
    fn ids_accept_object_ids_strings_and_numbers() {
        assert!(matches!(parse_id(r#"{"$oid": "6512bd43d9caa6e02c990b0a"}"#).unwrap(), Bson::ObjectId(_)));
        assert_eq!(parse_id(r#""abc""#).unwrap(), Bson::String("abc".into()));
        assert!(parse_id("42").is_ok());
        assert!(parse_id("{").is_err());
    }

    #[test]
    fn names_are_checked() {
        assert!(check_name("events", "database").is_ok());
        assert!(check_name("", "database").is_err());
        assert!(check_name("a\0b", "collection").is_err());
    }
}
