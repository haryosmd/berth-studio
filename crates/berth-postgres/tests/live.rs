//! Runs against the throwaway database from `scripts/dev-db/start.sh`:
//!     scripts/dev-db/start.sh && BERTH_TEST_PG=127.0.0.1:54329 cargo test -p berth-postgres
//! Without BERTH_TEST_PG every test returns early, so `cargo test` works with no database.
//!
//! The TLS test instead needs a server signed by a CA the system does not trust, such as any
//! Amazon RDS instance, and optionally its CA bundle. It never needs the password:
//!     BERTH_TEST_TLS_HOST=db.xyz.ap-southeast-1.rds.amazonaws.com \
//!     BERTH_TEST_TLS_CA=~/Downloads/ap-southeast-1-bundle.pem cargo test -p berth-postgres
//! An RDS host must also get past TLS with no bundle at all, since its roots ship in the crate.

use berth_core::{Endpoint, Role, TlsMode};
use berth_postgres::{build_updates, BrowseRequest, CellEdit, EditPlan, Filter, FilterOp, RowEdit, Session, Sort, Target, MAX_ROWS};
use std::time::Duration;

fn target(user: &str, read_only: bool) -> Option<Target> {
    let addr = std::env::var("BERTH_TEST_PG").ok()?;
    let (host, port) = addr.rsplit_once(':')?;
    let ep = Endpoint {
        role: if read_only { Role::Read } else { Role::Write },
        host: host.into(),
        port: port.parse().ok()?,
        database: "acme".into(),
        user: user.into(),
        tls: TlsMode::Auto,
        ca_cert: None,
        uri: None,
        auth_source: None,
        secret: None,
        needs_secret: false,
    };
    Some(Target::new(ep, read_only))
}

fn page_req(limit: u32, offset: u64) -> BrowseRequest {
    BrowseRequest { limit, offset, ..Default::default() }
}

fn filter(column: &str, op: FilterOp, value: &str) -> Filter {
    Filter { column: column.into(), op, value: Some(value.into()), values: vec![] }
}

async fn app(read_only: bool) -> Option<Session> {
    let t = target("app", read_only)?;
    Some(Session::connect(&t, Some("berth-dev-app")).await.expect("connect as app"))
}

#[tokio::test(flavor = "current_thread")]
async fn lists_and_browses_tables_in_primary_key_order() {
    let Some(s) = app(false).await else { return };
    assert!(s.server_version().await.unwrap().starts_with("16"));
    let tables = s.list_tables().await.unwrap();
    assert!(tables.iter().any(|t| t.schema == "public" && t.name == "users" && t.kind == "table"));
    let page = s.browse("public", "users", &page_req(25, 10)).await.unwrap();
    assert_eq!(page.rows.len(), 25);
    assert_eq!(page.rows[0][0].as_deref(), Some("11"));
    let id = page.columns.iter().find(|c| c.name == "id").unwrap();
    assert!(id.primary_key && id.type_name.as_deref() == Some("integer"));
    assert!(page.columns.iter().any(|c| c.name == "metadata" && c.type_name.as_deref() == Some("jsonb")));
    assert!(page.rows.iter().any(|r| r.iter().any(Option::is_none)), "NULLs come through as None");
}

#[tokio::test(flavor = "current_thread")]
async fn browsing_only_accepts_tables_the_catalog_knows() {
    let Some(s) = app(false).await else { return };
    let err = s.browse("public", "users\"; DROP TABLE users; --", &page_req(10, 0)).await.unwrap_err();
    assert!(err.message.contains("does not exist"));
    assert_eq!(s.run("SELECT count(*) FROM users").await.unwrap()[0].rows[0][0].as_deref(), Some("1300"));
}

#[tokio::test(flavor = "current_thread")]
async fn filters_sort_and_count_run_as_bound_parameters() {
    let Some(s) = app(true).await else { return };
    let req = |filters: Vec<Filter>| BrowseRequest { filters, limit: 500, offset: 0, ..Default::default() };
    let pro = req(vec![filter("plan", FilterOp::Eq, "pro")]);
    let page = s.browse("public", "users", &pro).await.unwrap();
    assert!(!page.rows.is_empty() && page.rows.iter().all(|r| r[4].as_deref() == Some("pro")));
    let n = s.count("public", "users", &pro).await.unwrap();
    let expected = s.run("SELECT count(*) FROM users WHERE plan = 'pro'").await.unwrap()[0].rows[0][0].clone().unwrap();
    assert_eq!((n.exact, n.total.map(|t| t.to_string())), (true, Some(expected)));

    // Booleans come back as the text of the cast, not the simple protocol's t/f.
    assert!(page.rows.iter().all(|r| matches!(r[5].as_deref(), Some("true" | "false"))));

    let like = s.browse("public", "users", &req(vec![filter("email", FilterOp::Contains, "USER1")])).await.unwrap();
    assert!(!like.rows.is_empty() && like.rows.iter().all(|r| r[1].as_deref().unwrap().contains("user1")), "ILIKE is case-insensitive");
    let starts = s.browse("public", "users", &req(vec![filter("email", FilterOp::StartsWith, "user12")])).await.unwrap();
    assert!(starts.rows.iter().all(|r| r[1].as_deref().unwrap().starts_with("user12")));

    let nulls = s.browse("public", "users", &req(vec![filter("last_login", FilterOp::IsNull, "")])).await.unwrap();
    assert!(!nulls.rows.is_empty() && nulls.rows.iter().all(|r| r[7].is_none()));

    let three = Filter { column: "id".into(), op: FilterOp::In, value: None, values: vec!["1".into(), "2".into(), "3".into()] };
    assert_eq!(s.browse("public", "users", &req(vec![three])).await.unwrap().rows.len(), 3);

    let sorted =
        BrowseRequest { sort: Some(Sort { column: "last_login".into(), descending: true }), limit: 5, offset: 0, ..Default::default() };
    let page = s.browse("public", "users", &sorted).await.unwrap();
    assert!(page.rows.iter().all(|r| r[7].is_some()), "NULLS LAST keeps the nulls off the first page");
    let times: Vec<&str> = page.rows.iter().map(|r| r[7].as_deref().unwrap()).collect();
    assert!(times.windows(2).all(|w| w[0] >= w[1]), "{times:?}");

    // A value the column's type cannot hold is a clean server error, not a crash.
    let bad = s.browse("public", "users", &req(vec![filter("id", FilterOp::Eq, "ten")])).await.unwrap_err();
    assert_eq!(bad.code.as_deref(), Some("22P02"), "{bad:?}");

    let raw = |w: &str| BrowseRequest { where_: Some(w.into()), limit: 500, offset: 0, ..Default::default() };
    assert_eq!(s.browse("public", "users", &raw("id < 10")).await.unwrap().rows.len(), 9);
    assert!(s.browse("public", "users", &raw("1=1; DROP TABLE users")).await.unwrap_err().message.contains("`;`"));
    assert_eq!(s.run("SELECT count(*) FROM users").await.unwrap()[0].rows[0][0].as_deref(), Some("1300"));
    // An error inside the condition is reported at a position inside the condition.
    let err = s.browse("public", "users", &raw("id < 10 AND nope = 1")).await.unwrap_err();
    assert_eq!((err.code.as_deref(), err.position), (Some("42703"), Some(13)), "{err:?}");
    // The session is still read-only, whatever the condition tries.
    let err = s.browse("public", "users", &raw("nextval('users_id_seq') > 0")).await.unwrap_err();
    assert_eq!(err.code.as_deref(), Some("25006"), "{err:?}");

    let n = s.count("public", "users", &page_req(10, 0)).await.unwrap();
    assert!(!n.exact && n.total.is_some_and(|t| t >= 1000), "{n:?}");
}

#[tokio::test(flavor = "current_thread")]
async fn foreign_keys_are_read_in_both_directions() {
    let Some(s) = app(true).await else { return };
    let users = s.describe("public", "users").await.unwrap();
    assert!(users.columns.iter().any(|c| c.name == "org_id"));
    assert_eq!(users.foreign_keys.len(), 1);
    let fk = &users.foreign_keys[0];
    assert_eq!(
        (fk.table.as_str(), &fk.columns[..], fk.ref_schema.as_str(), fk.ref_table.as_str(), &fk.ref_columns[..]),
        ("users", &["org_id".to_string()][..], "public", "orgs", &["id".to_string()][..])
    );
    assert!(users.referenced_by.iter().any(|f| f.table == "orders" && f.columns == ["user_id"] && f.ref_columns == ["id"]));

    let orgs = s.describe("public", "orgs").await.unwrap();
    assert!(orgs.foreign_keys.is_empty());
    assert!(orgs.referenced_by.iter().any(|f| f.table == "users" && f.columns == ["org_id"]));
    assert!(s.describe("public", "nope").await.is_err());
}

#[tokio::test(flavor = "current_thread")]
async fn edits_commit_in_one_transaction_or_not_at_all() {
    let Some(w) = app(false).await else { return };
    let cell = |column: &str, value: Option<&str>| CellEdit { column: column.into(), value: value.map(str::to_string) };
    let plan = |rows: Vec<(&str, Option<&str>)>| EditPlan {
        rows: rows
            .into_iter()
            .map(|(id, v)| RowEdit {
                key: vec![cell("id", Some(id))],
                set: vec![cell("plan", v), cell("metadata", Some("{\"via\": \"grid\"}"))],
            })
            .collect(),
    };
    let columns = w.columns("public", "users").await.unwrap();
    async fn read(s: &Session, id: &str) -> Vec<Option<String>> {
        s.run(&format!("SELECT plan, metadata::text FROM users WHERE id = {id}")).await.unwrap()[0].rows[0].clone()
    }
    let before = read(&w, "1").await;

    let st = build_updates("public", "users", &columns, &plan(vec![("1", Some("team"))])).unwrap();
    assert_eq!(w.apply_edits(&st).await.unwrap(), 1);
    assert_eq!(read(&w, "1").await, vec![Some("team".to_string()), Some("{\"via\": \"grid\"}".to_string())]);

    // The second row does not exist, so the first change is rolled back with it.
    let st = build_updates("public", "users", &columns, &plan(vec![("2", Some("team")), ("9999999", Some("team"))])).unwrap();
    let err = w.apply_edits(&st).await.unwrap_err();
    assert!(err.message.contains("matched 0 rows"), "{err:?}");
    assert_ne!(read(&w, "2").await[1], Some("{\"via\": \"grid\"}".to_string()));
    // A value the column refuses rolls back too, and the session is usable afterwards.
    let st = build_updates("public", "users", &columns, &plan(vec![("3", None)])).unwrap();
    assert_eq!(w.apply_edits(&st).await.unwrap_err().code.as_deref(), Some("23502"), "plan is NOT NULL");
    assert!(read(&w, "3").await[1].is_some());

    // Put row 1 back the way it was.
    let restore = EditPlan {
        rows: vec![RowEdit {
            key: vec![cell("id", Some("1"))],
            set: vec![cell("plan", before[0].as_deref()), cell("metadata", before[1].as_deref())],
        }],
    };
    w.apply_edits(&build_updates("public", "users", &columns, &restore).unwrap()).await.unwrap();
    assert_eq!(read(&w, "1").await, before);

    // A read-only session refuses the whole thing at the server.
    let ro = app(true).await.unwrap();
    let st = build_updates("public", "users", &columns, &plan(vec![("1", Some("team"))])).unwrap();
    assert_eq!(ro.apply_edits(&st).await.unwrap_err().code.as_deref(), Some("25006"));
}

#[tokio::test(flavor = "current_thread")]
async fn read_only_sessions_refuse_writes_at_the_server() {
    let Some(s) = app(true).await else { return };
    let err = s.run("UPDATE users SET plan = 'team' WHERE id = 1").await.unwrap_err();
    assert_eq!(err.code.as_deref(), Some("25006"), "{err:?}");
    // The read-only replica stand-in refuses too, even without our session setting.
    let ro = target("app_ro", false).unwrap();
    let s = Session::connect(&ro, Some("berth-dev-ro")).await.unwrap();
    assert!(s.run("DELETE FROM orders").await.is_err());
}

#[tokio::test(flavor = "current_thread")]
async fn scripts_return_one_result_per_statement_and_big_results_are_cut() {
    let Some(s) = app(false).await else { return };
    let sets = s.run("BEGIN; UPDATE users SET plan = plan WHERE id <= 3; SELECT generate_series(1, 6000) AS n; ROLLBACK;").await.unwrap();
    assert_eq!(sets.len(), 4);
    assert_eq!(sets[1].affected, Some(3));
    assert_eq!(sets[2].columns[0].name, "n");
    assert_eq!(sets[2].rows.len(), MAX_ROWS);
    assert!(sets[2].truncated);
}

#[tokio::test(flavor = "current_thread")]
async fn errors_carry_the_position_and_never_the_password() {
    let Some(s) = app(false).await else { return };
    let err = s.run("SELECT id, nope FROM users").await.unwrap_err();
    assert_eq!(err.code.as_deref(), Some("42703"));
    assert_eq!(err.position, Some(12));
    let t = target("app", false).unwrap();
    let Err(err) = Session::connect(&t, Some("wrong-secret-123")).await else { panic!("a wrong password must fail") };
    assert!(!format!("{err:?}").contains("wrong-secret-123"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn long_queries_time_out_and_can_be_cancelled() {
    let Some(mut t) = target("app", false) else { return };
    t.statement_timeout = Duration::from_millis(200);
    let s = Session::connect(&t, Some("berth-dev-app")).await.unwrap();
    assert_eq!(s.run("SELECT pg_sleep(2)").await.unwrap_err().code.as_deref(), Some("57014"));

    let s = app(false).await.unwrap();
    let c = s.canceller();
    let run = tokio::spawn(async move { s.run("SELECT pg_sleep(5)").await });
    tokio::time::sleep(Duration::from_millis(300)).await;
    c.cancel().await.unwrap();
    assert_eq!(run.await.unwrap().unwrap_err().code.as_deref(), Some("57014"));
}

/// The handshake must succeed with the CA file, so the only error left is the server refusing
/// the made-up password. Without the CA file it must fail in TLS instead, unless the host is an
/// Amazon RDS one: those get the built-in roots and must reach the password check as well.
#[tokio::test(flavor = "current_thread")]
async fn tls_trusts_the_ca_file_besides_the_system_store() {
    let Ok(host) = std::env::var("BERTH_TEST_TLS_HOST") else { return };
    let ca = std::env::var("BERTH_TEST_TLS_CA").ok();
    let ep = |ca_cert: Option<String>| Endpoint {
        role: Role::Write,
        host: host.clone(),
        port: 5432,
        database: "postgres".into(),
        user: "berth_tls_probe".into(),
        tls: TlsMode::Require,
        ca_cert,
        uri: None,
        auth_source: None,
        secret: None,
        needs_secret: true,
    };
    let refused_by_the_server = |err: &berth_postgres::DbError| {
        assert!(err.code.is_some() || err.message.contains("password"), "expected a server-side refusal, got: {}", err.message);
        assert!(!err.message.contains("TLS"), "{}", err.message);
    };
    if let Some(ca) = ca {
        let err = Session::connect(&Target::new(ep(Some(ca)), true), Some("not-the-password")).await.err().expect("an error");
        refused_by_the_server(&err);
    }

    let err = Session::connect(&Target::new(ep(None), true), Some("not-the-password")).await.err().expect("an error");
    let rds = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if rds.ends_with(".rds.amazonaws.com") || rds.ends_with(".rds.amazonaws.com.cn") {
        refused_by_the_server(&err);
    } else {
        assert!(err.message.contains("UnknownIssuer") && err.message.contains("CA certificate"), "{}", err.message);
    }
}
