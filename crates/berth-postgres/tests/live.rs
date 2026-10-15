//! Runs against the throwaway database from `scripts/dev-db/start.sh`:
//!     scripts/dev-db/start.sh && BERTH_TEST_PG=127.0.0.1:54329 cargo test -p berth-postgres
//! Without BERTH_TEST_PG every test returns early, so `cargo test` works with no database.

use berth_core::{Endpoint, Role, TlsMode};
use berth_postgres::{Session, Target, MAX_ROWS};
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
        uri: None,
        auth_source: None,
        secret: None,
        needs_secret: false,
    };
    Some(Target::new(ep, read_only))
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
    let page = s.browse("public", "users", 25, 10).await.unwrap();
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
    let err = s.browse("public", "users\"; DROP TABLE users; --", 10, 0).await.unwrap_err();
    assert!(err.message.contains("does not exist"));
    assert_eq!(s.run("SELECT count(*) FROM users").await.unwrap()[0].rows[0][0].as_deref(), Some("1300"));
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
