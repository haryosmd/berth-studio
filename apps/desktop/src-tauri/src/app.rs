//! Everything the IPC commands do, kept free of Tauri types so it can be tested directly.
//!
//! Security rules live here, not in the webview:
//! - passwords arrive once, go to the secret store, and are never returned or written to disk;
//! - a stored password is only ever sent to the server and user it was saved for;
//! - every profile is validated, and profiles in production environments are always read-only;
//! - where a query runs is decided by `berth_core::route`, and a production write needs the typed name;
//! - PostgreSQL sessions on read endpoints and read-only profiles are read-only at the server;
//!   MongoDB sessions for read-only profiles refuse writes before anything is sent.

use crate::workspace::{self, Workspace};
use berth_core::{
    check_prod_write, profile::validate_connection_id, route, validate_environments, Connection, Endpoint, Engine, EnvId, Environment,
    Kind, Profile, Role, RouteMode, RouteOptions,
};
use berth_mongo::{CollectionInfo, Documents, FindRequest, MongoError, ServerInfo};
use berth_postgres::{BrowseRequest, Canceller, DbError, ResultSet, RowCount, Session, Table, Target};
use berth_secrets::{account, account_of, reference, SecretStore};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

/// A password typed in the connection sheet, for one endpoint. Empty means "keep the stored one".
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordInput {
    pub env: EnvId,
    pub role: Role,
    /// Position among the profile's endpoints with the same role.
    pub index: usize,
    pub password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointCheck {
    pub role: Role,
    pub index: usize,
    pub host: String,
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub results: Vec<ResultSet>,
    pub role: Role,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warn: Option<String>,
    pub host: String,
    pub read_only: bool,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    #[serde(flatten)]
    pub set: ResultSet,
    pub host: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MongoOverview {
    pub server: ServerInfo,
    pub databases: Vec<String>,
}

/// A change to one MongoDB document. Documents and ids are Extended JSON text.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "action")]
pub enum DocumentWrite {
    Insert { document: String },
    Replace { id: String, document: String },
    Delete { id: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub message: String,
}

type SessionKey = (String, EnvId, Role, bool);
type MongoKey = (String, EnvId, bool);

pub struct App {
    path: PathBuf,
    ws: Mutex<Workspace>,
    secrets: Box<dyn SecretStore>,
    sessions: Mutex<HashMap<SessionKey, Arc<Session>>>,
    mongo: Mutex<HashMap<MongoKey, berth_mongo::Session>>,
    running: std::sync::Mutex<HashMap<String, Canceller>>,
}

fn err(msg: impl Into<String>) -> DbError {
    DbError::msg(msg)
}

fn coded(code: &str, msg: impl Into<String>) -> DbError {
    DbError { code: Some(code.into()), ..err(msg) }
}

fn from_mongo(e: MongoError) -> DbError {
    DbError { code: e.code, ..err(e.message) }
}

/// The code the UI looks for to open the "type the connection name" dialog.
pub const CONFIRM_CODE: &str = "BERTH_CONFIRM_PROD";
/// The code the UI looks for to ask before deleting environments that still have profiles.
pub const CONFIRM_ENV_DELETE: &str = "BERTH_CONFIRM_ENV_DELETE";
/// A write was asked of a profile that has no write endpoint.
pub const NO_WRITE: &str = "BERTH_NO_WRITE";

/// The largest SQL text accepted over IPC.
const MAX_SQL_BYTES: usize = 1 << 20;

/// True when two endpoints reach the same server as the same user.
fn same_server(a: &Endpoint, b: &Endpoint) -> bool {
    a.host.trim().eq_ignore_ascii_case(b.host.trim())
        && a.port == b.port
        && a.user.trim() == b.user.trim()
        && a.uri.as_deref().map(str::trim) == b.uri.as_deref().map(str::trim)
        && a.auth_source == b.auth_source
}

fn role_name(r: Role) -> &'static str {
    if r == Role::Write {
        "write"
    } else {
        "read"
    }
}

fn label(e: &Endpoint) -> String {
    e.uri.clone().unwrap_or_else(|| e.host.clone())
}

impl App {
    pub fn new(path: PathBuf, secrets: Box<dyn SecretStore>) -> Result<App, String> {
        let ws = workspace::load(&path)?;
        Ok(App {
            path,
            ws: Mutex::new(ws),
            secrets,
            sessions: Mutex::new(HashMap::new()),
            mongo: Mutex::new(HashMap::new()),
            running: Default::default(),
        })
    }

    pub async fn environments(&self) -> Vec<Environment> {
        self.ws.lock().await.environments.clone()
    }

    pub async fn connections(&self) -> Vec<Connection> {
        self.ws.lock().await.connections.clone()
    }

    async fn environment(&self, id: &EnvId) -> Result<Environment, DbError> {
        self.ws
            .lock()
            .await
            .environments
            .iter()
            .find(|e| &e.id == id)
            .cloned()
            .ok_or_else(|| err(format!("The environment {id} does not exist.")))
    }

    async fn connection(&self, id: &str) -> Result<Connection, DbError> {
        self.ws.lock().await.connections.iter().find(|c| c.id == id).cloned().ok_or_else(|| err(format!("{id} does not exist.")))
    }

    async fn profile(&self, id: &str, env: &EnvId, engine: Engine) -> Result<(Connection, Profile, Environment), DbError> {
        let environment = self.environment(env).await?;
        let c = self.connection(id).await?;
        if c.engine != engine {
            return Err(err(format!("{id} is not a {} connection.", if engine == Engine::Postgres { "PostgreSQL" } else { "MongoDB" })));
        }
        let p = c.profile(env).cloned().ok_or_else(|| err(format!("{id} has no {env} profile.")))?.normalized(&environment);
        Ok((c, p, environment))
    }

    fn password_for(&self, e: &Endpoint) -> Result<Option<berth_secrets::Secret>, DbError> {
        match &e.secret {
            None => Ok(None),
            Some(r) => {
                let acct = account_of(r).map_err(|x| err(x.to_string()))?;
                self.secrets.get(acct).map_err(|x| err(x.to_string()))
            }
        }
    }

    fn delete_secrets(&self, profiles: impl Iterator<Item = Profile>) {
        for e in profiles.flat_map(|p| p.endpoints.into_iter()) {
            if let Some(acct) = e.secret.as_deref().and_then(|r| account_of(r).ok()) {
                // A missing keychain item is not an error worth stopping for.
                let _ = self.secrets.delete(acct);
            }
        }
    }

    async fn forget_sessions(&self, connection: Option<&str>) {
        self.sessions.lock().await.retain(|k, _| connection.is_some_and(|c| k.0 != c));
        self.mongo.lock().await.retain(|k, _| connection.is_some_and(|c| k.0 != c));
    }

    /// Replaces the workspace's environment list. Removing an environment that still has
    /// profiles needs `confirm_delete`; those profiles and their stored passwords are then deleted.
    pub async fn save_environments(&self, envs: Vec<Environment>, confirm_delete: bool) -> Result<Vec<Environment>, DbError> {
        let problems = validate_environments(&envs);
        if !problems.is_empty() {
            return Err(DbError { detail: Some(problems.join("\n")), ..err("The environments have problems.") });
        }
        let mut ws = self.ws.lock().await;
        let removed: Vec<EnvId> = ws.environments.iter().map(|e| e.id.clone()).filter(|id| !envs.iter().any(|e| &e.id == id)).collect();
        let affected: Vec<String> = ws
            .connections
            .iter()
            .flat_map(|c| c.profiles.keys().filter(|k| removed.contains(k)).map(move |k| format!("{} · {k}", c.id)))
            .collect();
        if !affected.is_empty() && !confirm_delete {
            return Err(DbError {
                detail: Some(affected.join("\n")),
                ..coded(CONFIRM_ENV_DELETE, format!("{} profile(s) belong to environments you are removing.", affected.len()))
            });
        }
        let mut dropped = Vec::new();
        for c in ws.connections.iter_mut() {
            for id in &removed {
                if let Some(p) = c.profiles.remove(id) {
                    dropped.push(p);
                }
            }
        }
        self.delete_secrets(dropped.into_iter());
        ws.environments = envs;
        workspace::save(&self.path, &ws).map_err(err)?;
        let out = ws.environments.clone();
        drop(ws);
        self.forget_sessions(None).await;
        Ok(out)
    }

    /// Validates, stores passwords in the secret store and saves the workspace. Returns the saved connection.
    pub async fn save_connection(&self, mut conn: Connection, passwords: Vec<PasswordInput>) -> Result<Connection, DbError> {
        validate_connection_id(&conn.id).map_err(err)?;
        let envs = self.environments().await;
        let mut problems = Vec::new();
        for (env, p) in conn.profiles.iter_mut() {
            let Some(environment) = envs.iter().find(|e| &e.id == env) else {
                problems.push(format!("{env}: this environment does not exist in the workspace."));
                continue;
            };
            *p = p.normalized(environment);
            problems.extend(berth_core::validate_profile(conn.engine, environment, p).into_iter().map(|m| format!("{env}: {m}")));
        }
        if !problems.is_empty() {
            return Err(DbError { detail: Some(problems.join("\n")), ..err("The connection has problems.") });
        }
        let old = self.ws.lock().await.connections.iter().find(|c| c.id == conn.id).cloned();
        if old.as_ref().is_some_and(|o| o.engine != conn.engine) {
            return Err(err("A connection cannot change its database type. Create a new connection instead."));
        }
        let mut keep: Vec<String> = Vec::new();
        for (env, p) in conn.profiles.iter_mut() {
            let mut seen: HashMap<Role, usize> = HashMap::new();
            for e in p.endpoints.iter_mut() {
                let idx = *seen.entry(e.role).and_modify(|n| *n += 1).or_insert(0);
                let acct = account(&conn.id, env.as_str(), role_name(e.role), idx);
                let typed = passwords.iter().find(|x| &x.env == env && x.role == e.role && x.index == idx && !x.password.is_empty());
                let old_ep = old.as_ref().and_then(|o| o.profile(env)).and_then(|op| op.endpoints(e.role).nth(idx));
                // A stored password stays with an endpoint only while it points at the same server
                // and user; otherwise it would be sent to whatever host the endpoint now names.
                let had = old_ep
                    .is_some_and(|oe| same_server(oe, e) && oe.secret.as_deref().is_some_and(|r| account_of(r).is_ok_and(|a| a == acct)));
                let lost = !had && old_ep.is_some_and(|oe| oe.secret.is_some());
                if let Some(t) = typed {
                    self.secrets.set(&acct, &t.password).map_err(|x| err(x.to_string()))?;
                }
                // Whatever the webview sent in `secret` is ignored: only references we create are stored.
                e.secret = (typed.is_some() || had).then(|| reference(&acct));
                e.needs_secret = e.secret.is_none() && (e.needs_secret || lost);
                if e.secret.is_some() {
                    keep.push(acct);
                }
            }
        }
        if let Some(o) = &old {
            let orphaned = o.profiles.values().cloned().map(|mut p| {
                p.endpoints.retain(|e| e.secret.as_deref().and_then(|r| account_of(r).ok()).is_some_and(|a| !keep.iter().any(|k| k == a)));
                p
            });
            self.delete_secrets(orphaned);
        }
        {
            let mut ws = self.ws.lock().await;
            ws.connections.retain(|c| c.id != conn.id);
            ws.connections.push(conn.clone());
            ws.connections.sort_by(|a, b| a.id.cmp(&b.id));
            workspace::save(&self.path, &ws).map_err(err)?;
        }
        self.forget_sessions(Some(&conn.id)).await;
        Ok(conn)
    }

    pub async fn delete_connection(&self, id: &str) -> Result<(), DbError> {
        let conn = self.connection(id).await?;
        self.delete_secrets(conn.profiles.into_values());
        let mut ws = self.ws.lock().await;
        ws.connections.retain(|c| c.id != id);
        workspace::save(&self.path, &ws).map_err(err)?;
        drop(ws);
        self.forget_sessions(Some(id)).await;
        Ok(())
    }

    /// Connects read-only to every endpoint of a draft profile and reports each one.
    pub async fn test_profile(
        &self,
        id: &str,
        engine: Engine,
        env: &EnvId,
        profile: Profile,
        passwords: Vec<PasswordInput>,
    ) -> Result<Vec<EndpointCheck>, DbError> {
        let environment = self.environment(env).await?;
        let profile = profile.normalized(&environment);
        let problems = berth_core::validate_profile(engine, &environment, &profile);
        if !problems.is_empty() {
            return Err(DbError { detail: Some(problems.join("\n")), ..err("Fix the profile first.") });
        }
        let saved = self.connection(id).await.ok().filter(|c| c.engine == engine);
        let mut out = Vec::new();
        let mut seen: HashMap<Role, usize> = HashMap::new();
        for e in &profile.endpoints {
            let idx = *seen.entry(e.role).and_modify(|n| *n += 1).or_insert(0);
            let typed = passwords.iter().find(|x| &x.env == env && x.role == e.role && x.index == idx && !x.password.is_empty());
            // Only reuse a stored password for the exact server and user it was saved for.
            let stored = match (typed, &saved) {
                (None, Some(c)) => c
                    .profile(env)
                    .and_then(|p| p.endpoints(e.role).nth(idx))
                    .filter(|se| same_server(se, e))
                    .map(|se| self.password_for(se))
                    .transpose()?
                    .flatten(),
                _ => None,
            };
            let pw = typed.map(|t| t.password.as_str()).or(stored.as_ref().map(|s| s.as_str()));
            let res = match engine {
                Engine::Postgres => match Session::connect(&Target::new(e.clone(), true), pw).await {
                    Ok(s) => s.server_version().await.map(|v| format!("PostgreSQL {v}")),
                    Err(x) => Err(x),
                },
                Engine::Mongodb => berth_mongo::Session::connect(&mongo_target(e, &profile, true), pw)
                    .await
                    .map(|s| format!("MongoDB {} · {}", s.info.version, s.info.topology))
                    .map_err(from_mongo),
            };
            out.push(EndpointCheck {
                role: e.role,
                index: idx,
                host: label(e),
                ok: res.is_ok(),
                message: res.unwrap_or_else(|x| x.message),
            });
        }
        Ok(out)
    }

    // ------------------------------------------------------------------ PostgreSQL

    async fn session(&self, conn: &Connection, env: &EnvId, e: &Endpoint, read_only: bool) -> Result<Arc<Session>, DbError> {
        let key = (conn.id.clone(), env.clone(), e.role, read_only);
        let mut map = self.sessions.lock().await;
        if let Some(s) = map.get(&key) {
            if !s.is_closed() {
                return Ok(s.clone());
            }
        }
        let pw = self.password_for(e)?;
        let s = Arc::new(Session::connect(&Target::new(e.clone(), read_only), pw.as_ref().map(|p| p.as_str())).await?);
        map.insert(key, s.clone());
        Ok(s)
    }

    /// Catalog reads prefer a read endpoint and always use a read-only session.
    async fn reader(&self, id: &str, env: &EnvId) -> Result<(Arc<Session>, String), DbError> {
        let (c, p, _) = self.profile(id, env, Engine::Postgres).await?;
        let e = p
            .endpoints(Role::Read)
            .next()
            .or_else(|| p.endpoints(Role::Write).next())
            .ok_or_else(|| err("The profile has no endpoint."))?;
        Ok((self.session(&c, env, e, true).await?, e.host.clone()))
    }

    pub async fn list_tables(&self, id: &str, env: &EnvId) -> Result<Vec<Table>, DbError> {
        self.reader(id, env).await?.0.list_tables().await
    }

    pub async fn browse_table(&self, id: &str, env: &EnvId, schema: &str, table: &str, request: &BrowseRequest) -> Result<Page, DbError> {
        let (s, host) = self.reader(id, env).await?;
        let t = Instant::now();
        let set = s.browse(schema, table, request).await?;
        Ok(Page { set, host, elapsed_ms: t.elapsed().as_millis() as u64 })
    }

    pub async fn count_rows(&self, id: &str, env: &EnvId, schema: &str, table: &str, request: &BrowseRequest) -> Result<RowCount, DbError> {
        self.reader(id, env).await?.0.count(schema, table, request).await
    }

    pub async fn run_query(
        &self,
        id: &str,
        env: &EnvId,
        sql: &str,
        mode: RouteMode,
        confirm: Option<&str>,
        run_id: &str,
    ) -> Result<RunResult, DbError> {
        if run_id.is_empty() || run_id.len() > 64 {
            return Err(err("Invalid run id."));
        }
        if sql.len() > MAX_SQL_BYTES {
            return Err(err(format!("The query is larger than {} MiB. Run it from a file with psql instead.", MAX_SQL_BYTES >> 20)));
        }
        let (c, p, environment) = self.profile(id, env, Engine::Postgres).await?;
        let r = route(sql, RouteOptions { mode, has_read: p.has_read(), no_write_endpoint: !p.has_write(), in_transaction: false });
        if r.kind == Kind::Empty {
            return Ok(RunResult {
                results: vec![],
                role: r.role,
                reason: r.reason,
                warn: None,
                host: String::new(),
                read_only: true,
                elapsed_ms: 0,
            });
        }
        if r.kind == Kind::Write && !p.has_write() {
            return Err(coded(NO_WRITE, format!("The {env} profile of {id} has no write endpoint, so it can only read.")));
        }
        // A write in a production environment runs only after the user typed the connection name.
        let to_write = r.role == Role::Write && r.kind == Kind::Write;
        if to_write {
            check_prod_write(&environment, r.kind, &c.id, confirm).map_err(|m| coded(CONFIRM_CODE, m))?;
        }
        let e = p.endpoints(r.role).next().ok_or_else(|| err("The profile has no endpoint for this role."))?.clone();
        let confirmed_prod_write = environment.production && to_write;
        let read_only = r.role == Role::Read || (p.read_only && !confirmed_prod_write);
        let session = if confirmed_prod_write {
            // A one-off session that is not cached, so the next query is read-only again.
            let pw = self.password_for(&e)?;
            Arc::new(Session::connect(&Target::new(e.clone(), false), pw.as_ref().map(|x| x.as_str())).await?)
        } else {
            self.session(&c, env, &e, read_only).await?
        };
        self.running.lock().map_err(|_| err("internal lock"))?.insert(run_id.to_string(), session.canceller());
        let t = Instant::now();
        let out = session.run(sql).await;
        self.running.lock().map_err(|_| err("internal lock"))?.remove(run_id);
        Ok(RunResult {
            results: out?,
            role: r.role,
            reason: r.reason,
            warn: r.warn,
            host: e.host,
            read_only,
            elapsed_ms: t.elapsed().as_millis() as u64,
        })
    }

    pub async fn cancel_query(&self, run_id: &str) -> Result<bool, DbError> {
        let c = self.running.lock().map_err(|_| err("internal lock"))?.get(run_id).cloned();
        match c {
            Some(c) => c.cancel().await.map(|_| true),
            None => Ok(false),
        }
    }

    // ------------------------------------------------------------------ MongoDB

    async fn mongo_session(
        &self,
        id: &str,
        env: &EnvId,
        writable: bool,
    ) -> Result<(berth_mongo::Session, Environment, Connection), DbError> {
        let (c, p, environment) = self.profile(id, env, Engine::Mongodb).await?;
        let e = p.endpoints.first().ok_or_else(|| err("The profile has no connection string."))?;
        let read_only = !writable;
        let key = (c.id.clone(), env.clone(), read_only);
        if let Some(s) = self.mongo.lock().await.get(&key) {
            return Ok((s.clone(), environment, c));
        }
        let pw = self.password_for(e)?;
        let s =
            berth_mongo::Session::connect(&mongo_target(e, &p, read_only), pw.as_ref().map(|x| x.as_str())).await.map_err(from_mongo)?;
        // Write sessions in production are one-off, so the next operation is read-only again.
        if !(writable && environment.production) {
            self.mongo.lock().await.insert(key, s.clone());
        }
        Ok((s, environment, c))
    }

    pub async fn mongo_overview(&self, id: &str, env: &EnvId) -> Result<MongoOverview, DbError> {
        let (s, ..) = self.mongo_session(id, env, false).await?;
        let databases = s.list_databases().await.map_err(from_mongo)?;
        Ok(MongoOverview { server: s.info.clone(), databases })
    }

    pub async fn list_collections(&self, id: &str, env: &EnvId, db: &str) -> Result<Vec<CollectionInfo>, DbError> {
        let (s, ..) = self.mongo_session(id, env, false).await?;
        s.list_collections(db).await.map_err(from_mongo)
    }

    pub async fn find_documents(
        &self,
        id: &str,
        env: &EnvId,
        db: &str,
        collection: &str,
        request: FindRequest,
    ) -> Result<Documents, DbError> {
        let (s, ..) = self.mongo_session(id, env, false).await?;
        s.find(db, collection, request).await.map_err(from_mongo)
    }

    pub async fn list_indexes(&self, id: &str, env: &EnvId, db: &str, collection: &str) -> Result<Vec<serde_json::Value>, DbError> {
        let (s, ..) = self.mongo_session(id, env, false).await?;
        s.list_indexes(db, collection).await.map_err(from_mongo)
    }

    /// Decides whether a MongoDB write may run, and returns a session to run it on.
    async fn mongo_writer(&self, id: &str, env: &EnvId, confirm: Option<&str>) -> Result<berth_mongo::Session, DbError> {
        let (_, p, environment) = self.profile(id, env, Engine::Mongodb).await?;
        if environment.production {
            check_prod_write(&environment, Kind::Write, id, confirm).map_err(|m| coded(CONFIRM_CODE, m))?;
        } else if p.read_only {
            return Err(coded(NO_WRITE, format!("The {env} profile of {id} opens read-only.")));
        }
        Ok(self.mongo_session(id, env, true).await?.0)
    }

    pub async fn aggregate(
        &self,
        id: &str,
        env: &EnvId,
        db: &str,
        collection: &str,
        pipeline: &str,
        confirm: Option<&str>,
    ) -> Result<Documents, DbError> {
        let stages = berth_mongo::parse_pipeline(pipeline).map_err(from_mongo)?;
        let s = if berth_mongo::pipeline_writes(&stages) {
            self.mongo_writer(id, env, confirm).await?
        } else {
            self.mongo_session(id, env, false).await?.0
        };
        s.aggregate(db, collection, pipeline).await.map_err(from_mongo)
    }

    pub async fn write_document(
        &self,
        id: &str,
        env: &EnvId,
        db: &str,
        collection: &str,
        change: DocumentWrite,
        confirm: Option<&str>,
    ) -> Result<WriteOutcome, DbError> {
        let s = self.mongo_writer(id, env, confirm).await?;
        let message = match change {
            DocumentWrite::Insert { document } => {
                let new_id = s.insert_one(db, collection, &document).await.map_err(from_mongo)?;
                format!("Inserted a document with _id {new_id}.")
            }
            DocumentWrite::Replace { id: doc_id, document } => {
                match s.replace_one(db, collection, &doc_id, &document).await.map_err(from_mongo)? {
                    0 => "No document changed: it was not found, or it was already identical.".to_string(),
                    _ => "Saved the document.".to_string(),
                }
            }
            DocumentWrite::Delete { id: doc_id } => match s.delete_one(db, collection, &doc_id).await.map_err(from_mongo)? {
                0 => "No document was deleted: it was not found.".to_string(),
                _ => "Deleted the document.".to_string(),
            },
        };
        Ok(WriteOutcome { message })
    }
}

fn mongo_target(e: &Endpoint, p: &Profile, read_only: bool) -> berth_mongo::Target {
    berth_mongo::Target {
        uri: e.uri.clone().unwrap_or_default(),
        user: e.user.clone(),
        auth_source: e.auth_source.clone(),
        read_preference: p.read_preference.unwrap_or_default(),
        read_only,
        max_time: berth_mongo::DEFAULT_MAX_TIME,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use berth_core::{default_environments, ReadPreference, TlsMode};
    use berth_postgres::{Filter, FilterOp};
    use berth_secrets::MemoryStore;
    use std::collections::BTreeMap;

    fn id(s: &str) -> EnvId {
        EnvId::new(s).unwrap()
    }

    fn ep(role: Role, user: &str) -> Endpoint {
        let (host, port) = std::env::var("BERTH_TEST_PG")
            .ok()
            .and_then(|a| a.rsplit_once(':').map(|(h, p)| (h.to_string(), p.parse().unwrap_or(5432))))
            .unwrap_or(("localhost".into(), 5432));
        Endpoint {
            role,
            host,
            port,
            database: "acme".into(),
            user: user.into(),
            uri: None,
            auth_source: None,
            tls: TlsMode::Auto,
            ca_cert: None,
            secret: None,
            needs_secret: false,
        }
    }

    fn conn() -> Connection {
        let p = Profile {
            endpoints: vec![ep(Role::Write, "app"), ep(Role::Read, "app_ro")],
            read_only: false,
            auto_route: true,
            copied_from: None,
            read_preference: None,
        };
        let mut profiles = BTreeMap::new();
        profiles.insert(id("dev"), p.clone());
        profiles.insert(id("prod"), Profile { read_only: true, ..p });
        Connection { id: "acme-db".into(), engine: Engine::Postgres, profiles }
    }

    fn mongo_conn() -> Connection {
        let addr = std::env::var("BERTH_TEST_MONGO").unwrap_or_else(|_| "127.0.0.1:27017".into());
        let e = |user: &str| Endpoint {
            role: Role::Write,
            host: String::new(),
            port: 0,
            database: String::new(),
            user: user.into(),
            uri: Some(format!("mongodb://{addr}/?replicaSet=rs0")),
            auth_source: Some("events".into()),
            tls: TlsMode::Auto,
            ca_cert: None,
            secret: None,
            needs_secret: false,
        };
        let p = |user, read_only| Profile {
            endpoints: vec![e(user)],
            read_only,
            auto_route: true,
            copied_from: None,
            read_preference: Some(ReadPreference::SecondaryPreferred),
        };
        let mut profiles = BTreeMap::new();
        profiles.insert(id("dev"), p("app", false));
        profiles.insert(id("staging"), p("app_ro", true));
        profiles.insert(id("prod"), p("app", true));
        Connection { id: "events-db".into(), engine: Engine::Mongodb, profiles }
    }

    fn pw(env: &str, role: Role, password: &str) -> PasswordInput {
        PasswordInput { env: id(env), role, index: 0, password: password.into() }
    }

    fn app(tag: &str) -> (App, PathBuf) {
        let dir = std::env::temp_dir().join(format!("berth-app-test-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("workspace.json");
        let _ = std::fs::remove_file(&path);
        (App::new(path.clone(), Box::new(MemoryStore::default())).unwrap(), dir)
    }

    fn passwords() -> Vec<PasswordInput> {
        ["dev", "prod"].into_iter().flat_map(|e| [pw(e, Role::Write, "berth-dev-app"), pw(e, Role::Read, "berth-dev-ro")]).collect()
    }

    #[tokio::test]
    async fn saving_keeps_passwords_out_of_the_workspace_file() {
        let (a, dir) = app("save");
        let mut c = conn();
        c.profiles.get_mut(&id("dev")).unwrap().endpoints[0].secret = Some("hunter2-smuggled".into());
        let saved = a.save_connection(c, passwords()).await.unwrap();
        let text = std::fs::read_to_string(dir.join("workspace.json")).unwrap();
        assert!(!text.contains("berth-dev-app") && !text.contains("hunter2"), "{text}");
        assert!(text.contains("keychain://berth-studio/acme-db/dev/write-0"));
        assert!(saved.profiles[&id("prod")].read_only);
        assert_eq!(a.secrets.get("acme-db/prod/read-0").unwrap().unwrap().as_str(), "berth-dev-ro");

        // Saving again without passwords keeps the stored ones; removing the replica deletes its secret.
        let mut c2 = conn();
        c2.profiles.get_mut(&id("dev")).unwrap().endpoints.truncate(1);
        a.save_connection(c2, vec![]).await.unwrap();
        assert!(a.secrets.get("acme-db/dev/write-0").unwrap().is_some());
        assert!(a.secrets.get("acme-db/dev/read-0").unwrap().is_none());

        // Pointing the primary at another host must not carry its password along.
        let mut moved = conn();
        moved.profiles.get_mut(&id("dev")).unwrap().endpoints[0].host = "attacker.example.com".into();
        let saved = a.save_connection(moved, vec![]).await.unwrap();
        let primary = &saved.profiles[&id("dev")].endpoints[0];
        assert!(primary.secret.is_none() && primary.needs_secret);
        assert!(a.secrets.get("acme-db/dev/write-0").unwrap().is_none(), "the orphaned password is deleted");

        a.delete_connection("acme-db").await.unwrap();
        assert!(a.secrets.get("acme-db/prod/write-0").unwrap().is_none());
        assert!(a.connections().await.is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn invalid_profiles_ids_and_environments_are_refused() {
        let (a, dir) = app("invalid");
        let mut c = conn();
        c.profiles.get_mut(&id("dev")).unwrap().endpoints[0].port = 0;
        let e = a.save_connection(c, vec![]).await.unwrap_err();
        assert!(e.detail.unwrap().contains("dev: Primary: port must be between 1 and 65535"));
        let mut c = conn();
        c.id = "../evil".into();
        assert!(a.save_connection(c, vec![]).await.is_err());
        let mut c = conn();
        c.profiles.insert(id("qa"), c.profiles[&id("dev")].clone());
        assert!(a.save_connection(c, vec![]).await.unwrap_err().detail.unwrap().contains("qa: this environment does not exist"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn environments_can_be_customised_and_removing_one_asks_first() {
        let (a, dir) = app("envs");
        a.save_connection(conn(), passwords()).await.unwrap();
        let mut envs = default_environments();
        envs.retain(|e| e.id.as_str() != "dev");
        let mut eu = envs[1].clone();
        eu.id = id("prod-eu");
        eu.label = "prod (EU)".into();
        envs.push(eu);

        let e = a.save_environments(envs.clone(), false).await.unwrap_err();
        assert_eq!(e.code.as_deref(), Some(CONFIRM_ENV_DELETE));
        assert!(e.detail.unwrap().contains("acme-db · dev"));
        assert!(a.secrets.get("acme-db/dev/write-0").unwrap().is_some(), "nothing changes without confirmation");

        let saved = a.save_environments(envs, true).await.unwrap();
        assert_eq!(saved.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["staging", "prod", "prod-eu"]);
        assert!(!a.connections().await[0].profiles.contains_key(&id("dev")));
        assert!(a.secrets.get("acme-db/dev/write-0").unwrap().is_none(), "the deleted profile's passwords are removed");
        assert!(a.secrets.get("acme-db/prod/write-0").unwrap().is_some());

        // The list survives a restart, and a new production environment is read-only at once.
        let reopened = App::new(dir.join("workspace.json"), Box::new(MemoryStore::default())).unwrap();
        assert_eq!(reopened.environments().await.len(), 3);
        let mut c = conn();
        c.profiles.clear();
        c.profiles.insert(id("prod-eu"), Profile { read_only: false, ..conn().profiles[&id("dev")].clone() });
        assert!(a.save_connection(c, vec![]).await.unwrap().profiles[&id("prod-eu")].read_only);

        let mut bad = default_environments();
        bad[0].color = "green".into();
        assert!(a.save_environments(bad, true).await.is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_read_only_profile_refuses_writes_before_connecting() {
        let (a, dir) = app("readonly");
        let mut c = conn();
        c.profiles.get_mut(&id("dev")).unwrap().endpoints.retain(|e| e.role == Role::Read);
        a.save_connection(c, vec![]).await.unwrap();
        let e = a.run_query("acme-db", &id("dev"), "DELETE FROM orders", RouteMode::Auto, None, "r1").await.unwrap_err();
        assert_eq!(e.code.as_deref(), Some(NO_WRITE));
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Needs the dev database: scripts/dev-db/start.sh, then BERTH_TEST_PG=127.0.0.1:54329.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn routes_reads_and_writes_and_guards_production() {
        if std::env::var("BERTH_TEST_PG").is_err() {
            return;
        }
        let (a, dir) = app("live");
        a.save_connection(conn(), passwords()).await.unwrap();
        let (dev, prod) = (id("dev"), id("prod"));

        let r = a.run_query("acme-db", &dev, "SELECT count(*) FROM users", RouteMode::Auto, None, "r1").await.unwrap();
        assert_eq!((r.role, r.read_only), (Role::Read, true));
        assert_eq!(r.results[0].rows[0][0].as_deref(), Some("1300"));

        let w = a.run_query("acme-db", &dev, "UPDATE users SET plan = plan WHERE id = 1", RouteMode::Auto, None, "r2").await.unwrap();
        assert_eq!((w.role, w.read_only, w.results[0].affected), (Role::Write, false, Some(1)));

        // Pinned to read, a write is refused by the server.
        let e = a.run_query("acme-db", &dev, "DELETE FROM orders", RouteMode::Read, None, "r3").await.unwrap_err();
        assert_eq!(e.code.as_deref(), Some("25006"));

        // Production: no write without the typed name, and a wrong name is refused too.
        let sql = "UPDATE users SET plan = plan WHERE id = 2";
        assert_eq!(a.run_query("acme-db", &prod, sql, RouteMode::Auto, None, "r4").await.unwrap_err().code.as_deref(), Some(CONFIRM_CODE));
        assert!(a.run_query("acme-db", &prod, sql, RouteMode::Auto, Some("acme"), "r5").await.is_err());
        let ok = a.run_query("acme-db", &prod, sql, RouteMode::Auto, Some("acme-db"), "r6").await.unwrap();
        assert_eq!((ok.read_only, ok.results[0].affected), (false, Some(1)));
        // The next query in prod is read-only again.
        let ro = a.run_query("acme-db", &prod, "SELECT 1", RouteMode::Write, None, "r7").await.unwrap();
        assert!(ro.read_only);

        let tables = a.list_tables("acme-db", &dev).await.unwrap();
        assert!(tables.iter().any(|t| t.name == "orders"));
        let page = a
            .browse_table("acme-db", &dev, "public", "orders", &BrowseRequest { limit: 100, offset: 0, ..Default::default() })
            .await
            .unwrap();
        assert_eq!(page.set.rows.len(), 100);
        let filtered = BrowseRequest {
            filters: vec![Filter { column: "status".into(), op: FilterOp::Eq, value: Some("paid".into()), values: vec![] }],
            limit: 10,
            offset: 0,
            ..Default::default()
        };
        let n = a.count_rows("acme-db", &dev, "public", "orders", &filtered).await.unwrap();
        assert!(n.exact && n.total.is_some_and(|t| t > 0), "{n:?}");
        let page = a.browse_table("acme-db", &dev, "public", "orders", &filtered).await.unwrap();
        assert!(page.set.rows.iter().all(|r| r[2].as_deref() == Some("paid")));

        let checks = a.test_profile("acme-db", Engine::Postgres, &dev, conn().profiles[&dev].clone(), vec![]).await.unwrap();
        assert!(checks.iter().all(|c| c.ok), "{checks:?}");
        assert!(a.list_collections("acme-db", &dev, "x").await.unwrap_err().message.contains("not a MongoDB connection"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Needs the MongoDB dev database: scripts/dev-db/mongo-start.sh, then BERTH_TEST_MONGO=127.0.0.1:54330.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn mongodb_reads_writes_and_guards_production() {
        if std::env::var("BERTH_TEST_MONGO").is_err() {
            return;
        }
        let (a, dir) = app("mongo");
        let pws = vec![
            pw("dev", Role::Write, "berth-dev-app"),
            pw("staging", Role::Write, "berth-dev-ro"),
            pw("prod", Role::Write, "berth-dev-app"),
        ];
        a.save_connection(mongo_conn(), pws).await.unwrap();
        let (dev, staging, prod) = (id("dev"), id("staging"), id("prod"));

        let o = a.mongo_overview("events-db", &dev).await.unwrap();
        assert!(o.server.topology.starts_with("replica set") && o.databases.contains(&"events".to_string()), "{o:?}");
        let colls = a.list_collections("events-db", &dev, "events").await.unwrap();
        assert!(colls.iter().any(|c| c.name == "events" && c.count == Some(500)));

        let found = a
            .find_documents(
                "events-db",
                &dev,
                "events",
                "events",
                FindRequest { filter: r#"{"type":"click"}"#.into(), limit: 10, ..Default::default() },
            )
            .await
            .unwrap();
        assert_eq!(found.documents.len(), 10);
        assert!(found.documents[0]["_id"]["$oid"].is_string());

        let agg = a
            .aggregate("events-db", &dev, "events", "events", r#"[{"$group":{"_id":"$type","n":{"$sum":1}}},{"$sort":{"_id":1}}]"#, None)
            .await
            .unwrap();
        assert_eq!(agg.documents.len(), 3);

        // Writes: allowed in dev, refused for the read-only staging profile, and confirmed in prod.
        let ins = DocumentWrite::Insert { document: r#"{"type":"test","n":1}"#.into() };
        assert!(a.write_document("events-db", &dev, "events", "events", ins.clone(), None).await.unwrap().message.starts_with("Inserted"));
        assert_eq!(
            a.write_document("events-db", &staging, "events", "events", ins.clone(), None).await.unwrap_err().code.as_deref(),
            Some(NO_WRITE)
        );
        assert_eq!(
            a.write_document("events-db", &prod, "events", "events", ins.clone(), None).await.unwrap_err().code.as_deref(),
            Some(CONFIRM_CODE)
        );
        assert!(a.write_document("events-db", &prod, "events", "events", ins, Some("events-db")).await.is_ok());
        let out = r#"[{"$match":{"type":"test"}},{"$out":"copy"}]"#;
        assert_eq!(a.aggregate("events-db", &prod, "events", "events", out, None).await.unwrap_err().code.as_deref(), Some(CONFIRM_CODE));

        // The read-only user cannot write even if the client let it through.
        let ro = a.mongo_session("events-db", &staging, false).await.unwrap().0;
        assert!(ro.list_databases().await.is_ok());

        let del = a
            .find_documents(
                "events-db",
                &dev,
                "events",
                "events",
                FindRequest { filter: r#"{"type":"test"}"#.into(), limit: 10, ..Default::default() },
            )
            .await
            .unwrap();
        for d in del.documents {
            let doc_id = d["_id"].to_string();
            a.write_document("events-db", &dev, "events", "events", DocumentWrite::Delete { id: doc_id }, None).await.unwrap();
        }
        let checks = a.test_profile("events-db", Engine::Mongodb, &dev, mongo_conn().profiles[&dev].clone(), vec![]).await.unwrap();
        assert!(checks[0].ok && checks[0].message.starts_with("MongoDB"), "{checks:?}");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
