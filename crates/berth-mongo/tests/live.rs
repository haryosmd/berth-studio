//! Runs against the throwaway replica set from `scripts/dev-db/mongo-start.sh`:
//!     scripts/dev-db/mongo-start.sh && BERTH_TEST_MONGO=127.0.0.1:54330 cargo test -p berth-mongo
//! Without BERTH_TEST_MONGO every test returns early, so `cargo test` works with no database.

use berth_core::ReadPreference;
use berth_mongo::{FindRequest, Session, Target, DEFAULT_MAX_TIME, MAX_DOCS};

fn target(user: &str, read_only: bool) -> Option<Target> {
    let addr = std::env::var("BERTH_TEST_MONGO").ok()?;
    Some(Target {
        uri: format!("mongodb://{addr}/?directConnection=true"),
        user: user.into(),
        auth_source: Some("events".into()),
        read_preference: ReadPreference::SecondaryPreferred,
        read_only,
        max_time: DEFAULT_MAX_TIME,
    })
}

async fn connect(user: &str, password: &str, read_only: bool) -> Option<Session> {
    let t = target(user, read_only)?;
    Some(Session::connect(&t, Some(password)).await.expect("connect"))
}

fn find(filter: &str, sort: &str, projection: &str, limit: u32) -> FindRequest {
    FindRequest { filter: filter.into(), sort: sort.into(), projection: projection.into(), skip: 0, limit }
}

#[tokio::test(flavor = "current_thread")]
async fn browses_databases_collections_and_indexes() {
    let Some(s) = connect("app", "berth-dev-app", false).await else { return };
    assert!(s.info.version.starts_with('8'), "{}", s.info.version);
    assert_eq!(s.info.topology, "replica set rs0");

    let dbs = s.list_databases().await.unwrap();
    assert!(dbs.contains(&"events".to_string()), "{dbs:?}");

    let colls = s.list_collections("events").await.unwrap();
    let get = |n: &str| colls.iter().find(|c| c.name == n).unwrap_or_else(|| panic!("{n} missing: {colls:?}"));
    assert_eq!((get("events").kind.as_str(), get("events").count), ("collection", Some(500)));
    assert_eq!((get("sessions").kind.as_str(), get("sessions").count), ("collection", Some(40)));
    assert_eq!((get("purchases").kind.as_str(), get("purchases").count), ("view", None));

    let idx = s.list_indexes("events", "events").await.unwrap();
    assert!(idx.iter().any(|i| i["name"] == "type_1_at_-1" && i["keys"]["at"] == -1), "{idx:?}");
}

#[tokio::test(flavor = "current_thread")]
async fn finds_with_filter_sort_projection_and_a_row_cap() {
    let Some(s) = connect("app_ro", "berth-dev-ro", true).await else { return };

    let r = s.find("events", "events", find(r#"{"type": "purchase"}"#, r#"{"at": -1}"#, r#"{"meta": 0}"#, 10)).await.unwrap();
    assert_eq!(r.documents.len(), 10);
    assert!(r.truncated);
    let first = &r.documents[0];
    assert_eq!(first["type"], "purchase");
    assert_eq!(first["amount"]["$numberDecimal"], "19.99");
    assert!(first["_id"]["$oid"].is_string() && first["at"]["$date"].is_string(), "{first}");
    assert!(first.get("meta").is_none());

    let all = s.find("events", "events", find("", "", "", u32::MAX)).await.unwrap();
    assert_eq!(all.documents.len(), MAX_DOCS.min(500));
    assert!(!all.truncated);

    let view = s.find("events", "purchases", find("", "", "", 1000)).await.unwrap();
    assert_eq!(view.documents.len(), 166);

    let bad = s.find("events", "events", find("{nope", "", "", 10)).await.unwrap_err();
    assert!(bad.message.contains("not valid JSON"), "{}", bad.message);
}

#[tokio::test(flavor = "current_thread")]
async fn aggregates_and_refuses_writing_stages_when_read_only() {
    let Some(s) = connect("app_ro", "berth-dev-ro", true).await else { return };
    let groups =
        s.aggregate("events", "events", r#"[{"$group": {"_id": "$type", "n": {"$sum": 1}}}, {"$sort": {"_id": 1}}]"#).await.unwrap();
    let counts: Vec<_> = groups.documents.iter().map(|d| (d["_id"].as_str().unwrap().to_string(), d["n"].as_i64().unwrap())).collect();
    assert_eq!(counts, [("click".into(), 167), ("purchase".into(), 166), ("view".into(), 167)]);

    let out = s.aggregate("events", "events", r#"[{"$match": {}}, {"$out": "copy"}]"#).await.unwrap_err();
    assert!(out.message.contains("read-only"), "{}", out.message);
    let insert = s.insert_one("events", "events", r#"{"type": "click"}"#).await.unwrap_err();
    assert_eq!(insert.code.as_deref(), Some("BerthReadOnly"));
}

#[tokio::test(flavor = "current_thread")]
async fn a_read_role_user_is_refused_by_the_server() {
    // The client-side guard is off here, so the refusal must come from MongoDB itself.
    let Some(s) = connect("app_ro", "berth-dev-ro", false).await else { return };
    let e = s.insert_one("events", "scratch", r#"{"n": 1}"#).await.unwrap_err();
    assert_eq!(e.code.as_deref(), Some("Unauthorized"), "{e:?}");
}

#[tokio::test(flavor = "current_thread")]
async fn inserts_replaces_and_deletes_by_id() {
    let Some(s) = connect("app", "berth-dev-app", false).await else { return };
    let id = s.insert_one("events", "scratch", r#"{"n": 1, "price": {"$numberDecimal": "2.50"}}"#).await.unwrap();
    let id_text = id.to_string();
    assert!(id["$oid"].is_string(), "{id}");

    assert_eq!(s.replace_one("events", "scratch", &id_text, r#"{"n": 2}"#).await.unwrap(), 1);
    let changed = s.replace_one("events", "scratch", &id_text, r#"{"_id": {"$oid": "000000000000000000000000"}, "n": 3}"#).await;
    assert!(changed.unwrap_err().message.contains("cannot change"));

    let got = s.find("events", "scratch", find(&format!(r#"{{"_id": {id_text}}}"#), "", "", 1)).await.unwrap();
    assert_eq!(got.documents[0]["n"], 2);
    assert!(got.documents[0].get("price").is_none());

    assert_eq!(s.delete_one("events", "scratch", &id_text).await.unwrap(), 1);
    assert_eq!(s.delete_one("events", "scratch", &id_text).await.unwrap(), 0);
}

#[tokio::test(flavor = "current_thread")]
async fn a_wrong_password_fails_without_echoing_it() {
    let Some(t) = target("app", false) else { return };
    let e = Session::connect(&t, Some("not-the-password")).await.err().expect("must fail");
    assert!(!e.message.contains("not-the-password"), "{}", e.message);
}
