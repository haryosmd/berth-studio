//! PostgreSQL for Berth Studio.
//!
//! One [`Session`] talks to one endpoint. Sessions on read endpoints, and on every production
//! profile unless the user confirmed a write, are read-only at the server
//! (`default_transaction_read_only`), so the database itself refuses a stray write.
//! Values travel as text (the simple query protocol), which is all the grid needs to show them.

use berth_core::{Endpoint, TlsMode};
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tokio_postgres::{CancelToken, Client, NoTls, SimpleQueryMessage};

/// Rows kept per result. A larger result is cut and marked `truncated`, so one careless
/// `SELECT *` cannot exhaust the app's memory.
pub const MAX_ROWS: usize = 5_000;
pub const DEFAULT_STATEMENT_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct DbError {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    /// The SQLSTATE code, for example `25006` for a write in a read-only transaction.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// 1-based character position in the SQL, when the server reports one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<u32>,
}

impl DbError {
    pub fn msg(message: impl Into<String>) -> Self {
        DbError { message: message.into(), detail: None, hint: None, code: None, position: None }
    }
}

impl From<tokio_postgres::Error> for DbError {
    fn from(e: tokio_postgres::Error) -> Self {
        match e.as_db_error() {
            Some(db) => DbError {
                message: db.message().to_string(),
                detail: db.detail().map(str::to_string),
                hint: db.hint().map(str::to_string),
                code: Some(db.code().code().to_string()),
                position: match db.position() {
                    Some(tokio_postgres::error::ErrorPosition::Original(p)) => Some(*p),
                    _ => None,
                },
            },
            // Connection errors carry no SQLSTATE; their text never includes the password.
            None => DbError::msg(chain(&e)),
        }
    }
}

/// The error and every cause behind it, joined with `: `. `tokio_postgres` keeps the reason a
/// handshake failed only in `source()`, so without this a TLS failure reads just
/// "error performing TLS handshake".
fn chain(e: &dyn std::error::Error) -> String {
    let mut out = e.to_string();
    let mut cur = e.source();
    while let Some(s) = cur {
        let text = s.to_string();
        if !text.is_empty() && !out.ends_with(&text) {
            out.push_str(": ");
            out.push_str(&text);
        }
        cur = s.source();
    }
    out
}

/// Everything needed to open a session, except the password.
#[derive(Debug, Clone)]
pub struct Target {
    pub endpoint: Endpoint,
    pub read_only: bool,
    pub statement_timeout: Duration,
}

impl Target {
    pub fn new(endpoint: Endpoint, read_only: bool) -> Self {
        Target { endpoint, read_only, statement_timeout: DEFAULT_STATEMENT_TIMEOUT }
    }

    fn uses_tls(&self) -> bool {
        match self.endpoint.tls {
            TlsMode::Require => true,
            TlsMode::Disable => false,
            TlsMode::Auto => !self.endpoint.is_local(),
        }
    }
}

#[derive(Clone)]
enum Tls {
    None,
    Rustls(tokio_postgres_rustls::MakeRustlsConnect),
}

/// Certificates are checked against the macOS trust store, including the host name. A PEM file
/// at `ca_cert` adds roots to that store for this connection, which is what RDS needs: Amazon
/// signs RDS certificates with its own CA, which no operating system ships.
fn rustls_connector(ca_cert: Option<&str>) -> Result<tokio_postgres_rustls::MakeRustlsConnect, DbError> {
    use rustls_platform_verifier::{BuilderVerifierExt, Verifier};
    let setup = |e: &dyn std::fmt::Display| DbError::msg(format!("TLS setup failed: {e}"));
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder =
        rustls::ClientConfig::builder_with_provider(provider.clone()).with_safe_default_protocol_versions().map_err(|e| setup(&e))?;
    let config = match ca_cert.map(str::trim).filter(|p| !p.is_empty()) {
        None => builder.with_platform_verifier().map_err(|e| setup(&e))?,
        Some(path) => {
            let verifier = Verifier::new_with_extra_roots(extra_roots(path)?, provider)
                .map_err(|e| DbError::msg(format!("CA certificate {path}: {e}")))?;
            builder.dangerous().with_custom_certificate_verifier(Arc::new(verifier))
        }
    }
    .with_no_client_auth();
    Ok(tokio_postgres_rustls::MakeRustlsConnect::new(config))
}

/// Every certificate in the PEM file at `path`. A leading `~` means the home directory.
fn extra_roots(path: &str) -> Result<Vec<rustls::pki_types::CertificateDer<'static>>, DbError> {
    use rustls::pki_types::{pem::PemObject, CertificateDer};
    let fail = |e: &dyn std::fmt::Display| DbError::msg(format!("CA certificate {path}: {e}"));
    let file = match path.strip_prefix("~/") {
        Some(rest) => std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(rest)).unwrap_or_else(|| path.into()),
        None => path.into(),
    };
    let roots = CertificateDer::pem_file_iter(&file).map_err(|e| fail(&e))?.collect::<Result<Vec<_>, _>>().map_err(|e| fail(&e))?;
    if roots.is_empty() {
        return Err(fail(&"the file holds no certificate"));
    }
    Ok(roots)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    pub schema: String,
    pub name: String,
    /// `table`, `view`, `materialized view`, `partitioned table` or `foreign table`.
    pub kind: String,
    /// The planner's estimate, `-1` when the table was never analysed.
    pub estimated_rows: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    /// The Postgres type name, when known (table browsing); `None` for ad-hoc queries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub type_name: Option<String>,
    pub primary_key: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultSet {
    pub columns: Vec<Column>,
    pub rows: Vec<Vec<Option<String>>>,
    pub truncated: bool,
    /// Rows the statement selected or changed, as the server reported it.
    pub affected: Option<u64>,
}

pub struct Session {
    client: Client,
    tls: Tls,
    pub read_only: bool,
}

impl Session {
    pub async fn connect(target: &Target, password: Option<&str>) -> Result<Session, DbError> {
        let e = &target.endpoint;
        let port = u16::try_from(e.port).map_err(|_| DbError::msg("The port must be between 1 and 65535."))?;
        let mut cfg = tokio_postgres::Config::new();
        cfg.host(e.host.trim().trim_start_matches('[').trim_end_matches(']'))
            .port(port)
            .dbname(e.database.trim())
            .user(e.user.trim())
            .application_name("Berth Studio")
            .connect_timeout(CONNECT_TIMEOUT)
            .keepalives(true);
        if let Some(p) = password {
            cfg.password(p);
        }
        let tls = if target.uses_tls() {
            cfg.ssl_mode(tokio_postgres::config::SslMode::Require);
            Tls::Rustls(rustls_connector(e.ca_cert.as_deref())?)
        } else {
            cfg.ssl_mode(tokio_postgres::config::SslMode::Disable);
            Tls::None
        };
        let client = match &tls {
            Tls::None => {
                let (client, conn) = cfg.connect(NoTls).await?;
                tokio::spawn(conn);
                client
            }
            Tls::Rustls(m) => {
                let (client, conn) = cfg.connect(m.clone()).await?;
                tokio::spawn(conn);
                client
            }
        };
        let mut setup = format!("SET statement_timeout = {};", target.statement_timeout.as_millis());
        if target.read_only {
            setup.push_str(" SET default_transaction_read_only = on;");
        }
        client.batch_execute(&setup).await?;
        Ok(Session { client, tls, read_only: target.read_only })
    }

    pub fn is_closed(&self) -> bool {
        self.client.is_closed()
    }

    pub fn canceller(&self) -> Canceller {
        Canceller { token: self.client.cancel_token(), tls: self.tls.clone() }
    }

    pub async fn server_version(&self) -> Result<String, DbError> {
        let rows = self.client.simple_query("SHOW server_version").await?;
        Ok(first_text(&rows).unwrap_or_default())
    }

    pub async fn list_tables(&self) -> Result<Vec<Table>, DbError> {
        let rows = self
            .client
            .query(
                "SELECT n.nspname, c.relname,
                        CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
                                       WHEN 'p' THEN 'partitioned table' ELSE 'foreign table' END,
                        c.reltuples::bigint
                   FROM pg_catalog.pg_class c
                   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                  WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f')
                    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                    AND n.nspname NOT LIKE 'pg_toast%'
                    AND has_table_privilege(c.oid, 'SELECT')
                  ORDER BY n.nspname, c.relname",
                &[],
            )
            .await?;
        Ok(rows.iter().map(|r| Table { schema: r.get(0), name: r.get(1), kind: r.get(2), estimated_rows: r.get(3) }).collect())
    }

    /// Columns of a table, in order. Fails when the table does not exist or is not readable,
    /// so callers can only ever build SQL from names the catalog confirmed.
    pub async fn columns(&self, schema: &str, table: &str) -> Result<Vec<Column>, DbError> {
        let rows = self
            .client
            .query(
                "SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod),
                        COALESCE(a.attnum = ANY (i.indkey), false)
                   FROM pg_catalog.pg_class c
                   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                   JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                   LEFT JOIN pg_catalog.pg_index i ON i.indrelid = c.oid AND i.indisprimary
                  WHERE n.nspname = $1 AND c.relname = $2 AND has_table_privilege(c.oid, 'SELECT')
                  ORDER BY a.attnum",
                &[&schema, &table],
            )
            .await?;
        if rows.is_empty() {
            return Err(DbError::msg(format!("{schema}.{table} does not exist, or you cannot read it.")));
        }
        Ok(rows.iter().map(|r| Column { name: r.get(0), type_name: Some(r.get(1)), primary_key: r.get(2) }).collect())
    }

    /// One page of a table, ordered by its primary key when it has one.
    pub async fn browse(&self, schema: &str, table: &str, limit: u32, offset: u64) -> Result<ResultSet, DbError> {
        let columns = self.columns(schema, table).await?;
        let pk: Vec<String> = columns.iter().filter(|c| c.primary_key).map(|c| quote_ident(&c.name)).collect();
        let order = if pk.is_empty() { String::new() } else { format!(" ORDER BY {}", pk.join(", ")) };
        let limit = limit.clamp(1, MAX_ROWS as u32);
        let sql = format!("SELECT * FROM {}.{}{order} LIMIT {limit} OFFSET {offset}", quote_ident(schema), quote_ident(table));
        let mut sets = run_simple(&self.client, &sql).await?;
        let mut set = sets.pop().unwrap_or_default();
        set.columns = columns;
        Ok(set)
    }

    /// Runs user SQL, which may hold several statements. Returns one result per statement.
    pub async fn run(&self, sql: &str) -> Result<Vec<ResultSet>, DbError> {
        run_simple(&self.client, sql).await
    }
}

/// Cancels whatever the session is running, from another task.
#[derive(Clone)]
pub struct Canceller {
    token: CancelToken,
    tls: Tls,
}

impl Canceller {
    pub async fn cancel(&self) -> Result<(), DbError> {
        match &self.tls {
            Tls::None => self.token.cancel_query(NoTls).await?,
            Tls::Rustls(m) => self.token.cancel_query(m.clone()).await?,
        }
        Ok(())
    }
}

/// Quotes an identifier the way Postgres does: wrap in double quotes and double any inside.
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn first_text(msgs: &[SimpleQueryMessage]) -> Option<String> {
    msgs.iter().find_map(|m| match m {
        SimpleQueryMessage::Row(r) => r.get(0).map(str::to_string),
        _ => None,
    })
}

async fn run_simple(client: &Client, sql: &str) -> Result<Vec<ResultSet>, DbError> {
    let msgs = client.simple_query(sql).await?;
    let mut sets = Vec::new();
    let mut cur = ResultSet::default();
    for m in msgs {
        match m {
            SimpleQueryMessage::RowDescription(cols) => {
                cur.columns = cols.iter().map(|c| Column { name: c.name().to_string(), type_name: None, primary_key: false }).collect();
            }
            SimpleQueryMessage::Row(r) => {
                if cur.rows.len() < MAX_ROWS {
                    cur.rows.push((0..r.len()).map(|i| r.get(i).map(str::to_string)).collect());
                } else {
                    cur.truncated = true;
                }
            }
            SimpleQueryMessage::CommandComplete(n) => {
                cur.affected = Some(n);
                sets.push(std::mem::take(&mut cur));
            }
            _ => {}
        }
    }
    Ok(sets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_are_quoted_like_postgres_does() {
        assert_eq!(quote_ident("users"), "\"users\"");
        assert_eq!(quote_ident("we\"ird; DROP TABLE x"), "\"we\"\"ird; DROP TABLE x\"");
    }

    #[test]
    fn tls_is_required_for_remote_hosts_by_default() {
        let ep = |host: &str, tls| Endpoint {
            role: berth_core::Role::Write,
            host: host.into(),
            port: 5432,
            database: "acme".into(),
            user: "app".into(),
            tls,
            ca_cert: None,
            uri: None,
            auth_source: None,
            secret: None,
            needs_secret: false,
        };
        assert!(Target::new(ep("db.acme.io", TlsMode::Auto), false).uses_tls());
        assert!(!Target::new(ep("localhost", TlsMode::Auto), false).uses_tls());
        assert!(!Target::new(ep("127.0.0.1", TlsMode::Auto), false).uses_tls());
        assert!(Target::new(ep("localhost", TlsMode::Require), false).uses_tls());
        assert!(!Target::new(ep("db.acme.io", TlsMode::Disable), false).uses_tls());
    }

    #[test]
    fn the_tls_connector_builds_with_the_platform_verifier() {
        assert!(rustls_connector(None).is_ok());
        assert!(rustls_connector(Some("  ")).is_ok());
    }

    #[test]
    fn extra_ca_certificates_come_from_a_pem_file() {
        let dir = std::env::temp_dir().join(format!("berth-ca-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("ca.pem");
        std::fs::write(&ok, TEST_CA).unwrap();
        assert!(rustls_connector(Some(ok.to_str().unwrap())).is_ok());

        let empty = dir.join("empty.pem");
        std::fs::write(&empty, "just text\n").unwrap();
        let e = rustls_connector(Some(empty.to_str().unwrap())).err().expect("an error");
        assert!(e.message.contains("empty.pem") && e.message.contains("no certificate"), "{}", e.message);

        let missing = dir.join("missing.pem");
        let e = rustls_connector(Some(missing.to_str().unwrap())).err().expect("an error");
        assert!(e.message.starts_with("CA certificate ") && e.message.contains("missing.pem"), "{}", e.message);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn error_messages_carry_every_cause() {
        use std::io;
        let inner = io::Error::other("invalid peer certificate: UnknownIssuer");
        let outer = io::Error::other(inner);
        // `io::Error::new(_, source)` displays the source itself, so the chain must not repeat it.
        assert_eq!(chain(&outer), "invalid peer certificate: UnknownIssuer");
        assert_eq!(chain(&io::Error::other("alone")), "alone");
    }

    /// A self-signed certificate made for this test; it signs nothing real.
    const TEST_CA: &str = "-----BEGIN CERTIFICATE-----\n\
MIIBczCCARigAwIBAgIUMlJKuIV6eJaCtaf6k6FksMyaBF0wCgYIKoZIzj0EAwIw\n\
HzEdMBsGA1UEAwwUQmVydGggU3R1ZGlvIHRlc3QgQ0EwHhcNMjYxMDE2MDIwMzQx\n\
WhcNMzYxMDEzMDIwMzQxWjAfMR0wGwYDVQQDDBRCZXJ0aCBTdHVkaW8gdGVzdCBD\n\
QTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABGQjEOoN9jwRFaBeHRYnxFQBM6p6\n\
k+Eg/lli7/4H37e/JlDvRdWRbapl54PpAc6ExyOUY6ycGnoi5bsrnmt1806jMjAw\n\
MB0GA1UdDgQWBBQx1SnW8OUm2VxjxUAbX9KNPCvtnjAPBgNVHRMBAf8EBTADAQH/\n\
MAoGCCqGSM49BAMCA0kAMEYCIQDOy0F1XtwfMG0iq7Fm51E6RGCx7t+UBkLi21VP\n\
of+/4QIhAJcRuGxo58XqIP+suOfL89u7lmpVgfDhaERdD7FGjHxH\n\
-----END CERTIFICATE-----";
}
