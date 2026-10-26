//! PostgreSQL for Berth Studio.
//!
//! One [`Session`] talks to one endpoint. Sessions on read endpoints, and on every production
//! profile unless the user confirmed a write, are read-only at the server
//! (`default_transaction_read_only`), so the database itself refuses a stray write.
//! Values travel as text (the simple query protocol), which is all the grid needs to show them.

mod structure;

use berth_core::{Endpoint, TlsMode};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
pub use structure::{build_ddl, Constraint, Index, SchemaColumn, StructureColumn, TableStructure, MAX_SCHEMA_COLUMNS};
use tokio_postgres::types::ToSql;
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

/// Certificates are checked against the macOS trust store, including the host name. Extra roots
/// add to it for one connection: the built-in Amazon RDS roots when `host` is an RDS endpoint,
/// and the PEM file at `ca_cert`. Amazon signs RDS certificates with its own CA, which no
/// operating system ships, so without the built-in roots every RDS user had to download a bundle.
fn rustls_connector(host: &str, ca_cert: Option<&str>) -> Result<tokio_postgres_rustls::MakeRustlsConnect, DbError> {
    use rustls_platform_verifier::BuilderVerifierExt;
    let setup = |e: &dyn std::fmt::Display| DbError::msg(format!("TLS setup failed: {e}"));
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder =
        rustls::ClientConfig::builder_with_provider(provider.clone()).with_safe_default_protocol_versions().map_err(|e| setup(&e))?;
    let roots = trusted_extra_roots(host, ca_cert)?;
    let config = if roots.is_empty() {
        builder.with_platform_verifier().map_err(|e| setup(&e))?
    } else {
        let source = match ca_file(ca_cert) {
            Some(path) => format!("CA certificate {path}"),
            None => "built-in Amazon RDS roots".into(),
        };
        let verifier = ExtraRootsVerifier::new(roots, provider).map_err(|e| DbError::msg(format!("{source}: {e}")))?;
        builder.dangerous().with_custom_certificate_verifier(Arc::new(verifier))
    }
    .with_no_client_auth();
    Ok(tokio_postgres_rustls::MakeRustlsConnect::new(config))
}

/// The CA file path a profile set, if any; blank means none.
fn ca_file(ca_cert: Option<&str>) -> Option<&str> {
    ca_cert.map(str::trim).filter(|p| !p.is_empty())
}

/// The roots trusted besides the system store for a connection to `host`: the built-in Amazon RDS
/// roots for an RDS host, plus every certificate of the CA file when one is set. Any other host
/// without a CA file gets none, so the RDS roots never vouch for a server elsewhere.
fn trusted_extra_roots(host: &str, ca_cert: Option<&str>) -> Result<Vec<rustls::pki_types::CertificateDer<'static>>, DbError> {
    let mut roots = Vec::new();
    if is_rds_host(host) {
        roots.extend(rds_roots().iter().cloned());
    }
    if let Some(path) = ca_file(ca_cert) {
        roots.extend(extra_roots(path)?);
    }
    Ok(roots)
}

/// Whether `host` is an Amazon RDS or Aurora endpoint, told by its DNS suffix alone and never by
/// the certificate the server presents. A trailing dot names the same host.
fn is_rds_host(host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    host.ends_with(".rds.amazonaws.com") || host.ends_with(".rds.amazonaws.com.cn")
}

/// Amazon's global CA bundle for RDS and Aurora; `certs/README.md` records where it came from and
/// how to refresh it.
const RDS_GLOBAL_BUNDLE: &str = include_str!("../certs/rds-global-bundle.pem");

/// The bundle's certificates, parsed once for the whole process. A certificate rustls cannot read
/// is skipped; the unit test checks that none is.
fn rds_roots() -> &'static [rustls::pki_types::CertificateDer<'static>] {
    static ROOTS: OnceLock<Vec<rustls::pki_types::CertificateDer<'static>>> = OnceLock::new();
    ROOTS.get_or_init(|| {
        use rustls::pki_types::{pem::PemObject, CertificateDer};
        CertificateDer::pem_slice_iter(RDS_GLOBAL_BUNDLE.as_bytes()).filter_map(Result::ok).collect()
    })
}

/// Checks a server certificate against the extra roots with webpki, and failing that against the
/// macOS trust store. The extra roots cannot simply be handed to macOS: Apple's TLS policy
/// rejects every server certificate without an Extended Key Usage extension, and Amazon RDS
/// issues exactly those, so a chain to the RDS root fails there with `EkuError` even though the
/// root is trusted. webpki follows RFC 5280, where a missing extension allows any use.
#[derive(Debug)]
struct ExtraRootsVerifier {
    extra: Arc<rustls::client::WebPkiServerVerifier>,
    platform: rustls_platform_verifier::Verifier,
}

impl ExtraRootsVerifier {
    fn new(roots: Vec<rustls::pki_types::CertificateDer<'static>>, provider: Arc<rustls::crypto::CryptoProvider>) -> Result<Self, String> {
        let mut store = rustls::RootCertStore::empty();
        let (added, _) = store.add_parsable_certificates(roots);
        if added == 0 {
            return Err("no certificate in the file can act as a CA".into());
        }
        let extra = rustls::client::WebPkiServerVerifier::builder_with_provider(Arc::new(store), provider.clone())
            .build()
            .map_err(|e| e.to_string())?;
        let platform = rustls_platform_verifier::Verifier::new(provider).map_err(|e| e.to_string())?;
        Ok(ExtraRootsVerifier { extra, platform })
    }
}

impl rustls::client::danger::ServerCertVerifier for ExtraRootsVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        intermediates: &[rustls::pki_types::CertificateDer<'_>],
        server_name: &rustls::pki_types::ServerName<'_>,
        ocsp_response: &[u8],
        now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        let extra = match self.extra.verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now) {
            Ok(ok) => return Ok(ok),
            Err(e) => e,
        };
        let platform = match self.platform.verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now) {
            Ok(ok) => return Ok(ok),
            Err(e) => e,
        };
        // A certificate that does not chain to the extra roots at all is the system store's
        // business, so its verdict is the one to show; anything else (wrong host name, expired)
        // was found on the chain the user configured.
        Err(match extra {
            rustls::Error::InvalidCertificate(rustls::CertificateError::UnknownIssuer) => platform,
            other => other,
        })
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        self.extra.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        self.extra.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.extra.supported_verify_schemes()
    }
}

/// A handshake that fails with `UnknownIssuer` while no CA file is set is almost always a managed
/// database signed by a CA no operating system ships. Bare "UnknownIssuer" reads like a bug, so
/// the message says what to do. An RDS host already had the built-in roots, so there the shipped
/// bundle is behind Amazon's, and the region's own bundle is the stopgap.
fn explain_unknown_issuer(mut err: DbError, host: &str, ca_cert: Option<&str>) -> DbError {
    if ca_file(ca_cert).is_some() || !err.message.contains("UnknownIssuer") {
        return err;
    }
    err.message.push_str(if is_rds_host(host) {
        ". The Amazon RDS root certificates built into this version do not cover this server's \
         certificate; until the next release, set your region's bundle from \
         https://truststore.pki.rds.amazonaws.com/ as the CA certificate"
    } else {
        ". The system trust store does not know the CA that signed this server's certificate; \
         download the CA from your provider and set its PEM file as the CA certificate"
    });
    err
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

/// One foreign key: `table.columns` point at `ref_table.ref_columns`, in matching order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKey {
    pub name: String,
    pub schema: String,
    pub table: String,
    pub columns: Vec<String>,
    pub ref_schema: String,
    pub ref_table: String,
    pub ref_columns: Vec<String>,
}

/// A table's columns and the foreign keys it holds and receives.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub columns: Vec<Column>,
    pub foreign_keys: Vec<ForeignKey>,
    pub referenced_by: Vec<ForeignKey>,
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
            Tls::Rustls(rustls_connector(&e.host, e.ca_cert.as_deref())?)
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
                let (client, conn) =
                    cfg.connect(m.clone()).await.map_err(|err| explain_unknown_issuer(err.into(), &e.host, e.ca_cert.as_deref()))?;
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

    /// The table's columns plus its foreign keys, outgoing and incoming, from `pg_constraint`.
    pub async fn describe(&self, schema: &str, table: &str) -> Result<TableInfo, DbError> {
        let columns = self.columns(schema, table).await?;
        let fetch = |filter: &'static str| async move {
            let rows = self
                .client
                .query(
                    &format!("{FK_SQL} WHERE con.contype = 'f' AND {filter} ORDER BY con.conname, n.nspname, c.relname, k.ord"),
                    &[&schema, &table],
                )
                .await?;
            Ok::<_, DbError>(fold_foreign_keys(rows.iter().map(|r| (r.get(0), r.get(1), r.get(2), r.get(3), r.get(4), r.get(5), r.get(6)))))
        };
        let foreign_keys = fetch("n.nspname = $1 AND c.relname = $2").await?;
        let referenced_by = fetch("fn.nspname = $1 AND fc.relname = $2").await?;
        Ok(TableInfo { columns, foreign_keys, referenced_by })
    }

    /// One page of a table: filtered, sorted (by the primary key unless asked otherwise) and cut
    /// to `limit` rows from `offset`. Runs as one prepared statement with every value bound, so
    /// the request can never add a second statement; see [`build_browse`].
    pub async fn browse(&self, schema: &str, table: &str, req: &BrowseRequest) -> Result<ResultSet, DbError> {
        let columns = self.columns(schema, table).await?;
        let b = build_browse(schema, table, &columns, req)?;
        let rows = self.client.query(&b.sql, &b.param_refs()).await.map_err(|e| rebase_position(e.into(), b.raw_start))?;
        let rows: Vec<Vec<Option<String>>> =
            rows.iter().map(|r| (0..columns.len()).map(|i| r.get::<_, Option<String>>(i)).collect()).collect();
        let affected = Some(rows.len() as u64);
        Ok(ResultSet { columns, rows, truncated: false, affected })
    }

    /// How many rows the request matches: exact when it filters, otherwise the planner's
    /// estimate for the whole table (`None` when the table was never analysed, or is a view).
    pub async fn count(&self, schema: &str, table: &str, req: &BrowseRequest) -> Result<RowCount, DbError> {
        let columns = self.columns(schema, table).await?;
        let b = build_browse(schema, table, &columns, req)?;
        if b.filtered {
            let row = self.client.query_one(&b.count_sql, &b.param_refs()).await.map_err(|e| rebase_position(e.into(), b.raw_start))?;
            return Ok(RowCount { total: Some(row.get(0)), exact: true });
        }
        let row = self
            .client
            .query_opt(
                "SELECT c.reltuples::bigint, c.relkind::text
                   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = $1 AND c.relname = $2",
                &[&schema, &table],
            )
            .await?;
        let total = row.and_then(|r| {
            let (n, kind): (i64, String) = (r.get(0), r.get(1));
            (n >= 0 && matches!(kind.as_str(), "r" | "p" | "m")).then_some(n)
        });
        Ok(RowCount { total, exact: false })
    }

    /// Runs the statements of a commit in one transaction. Each must change exactly one row, or
    /// the whole transaction is rolled back and nothing is changed. Meant for a session of its
    /// own: a failure mid-way can never leave a shared session inside a transaction.
    pub async fn apply_edits(&self, statements: &[Statement]) -> Result<u64, DbError> {
        self.client.batch_execute("BEGIN").await?;
        let mut total = 0;
        for (i, st) in statements.iter().enumerate() {
            let refs: Vec<&(dyn ToSql + Sync)> = st.params.iter().map(|p| p as &(dyn ToSql + Sync)).collect();
            let n = match self.client.execute(&st.sql, &refs).await {
                Ok(n) => n,
                Err(e) => {
                    let _ = self.client.batch_execute("ROLLBACK").await;
                    return Err(e.into());
                }
            };
            if n != 1 {
                let _ = self.client.batch_execute("ROLLBACK").await;
                return Err(DbError::msg(format!("Statement {} matched {n} rows instead of 1; nothing was changed.", i + 1)));
            }
            total += n;
        }
        self.client.batch_execute("COMMIT").await?;
        Ok(total)
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

/// How a filter compares a column with its value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOp {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Contains,
    StartsWith,
    IsNull,
    IsNotNull,
    In,
}

/// One filter chip. `value` serves every operator but `In`, which takes `values`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub column: String,
    pub op: FilterOp,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub values: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sort {
    pub column: String,
    #[serde(default)]
    pub descending: bool,
}

/// What the table browser asks for: chips, an optional free-text condition, a sort and a page.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseRequest {
    #[serde(default)]
    pub filters: Vec<Filter>,
    /// A raw SQL condition, appended as `AND (…)`. It can only ever be part of this one
    /// statement: the extended protocol refuses a second one, and `;` is rejected up front.
    #[serde(default, rename = "where")]
    pub where_: Option<String>,
    #[serde(default)]
    pub sort: Option<Sort>,
    pub limit: u32,
    pub offset: u64,
}

/// One cell of an edit: the column and its new text, `None` for SQL NULL.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellEdit {
    pub column: String,
    pub value: Option<String>,
}

/// One row's edits. `key` holds every primary-key column with the value the row had when it was
/// read, so the UPDATE finds exactly that row.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowEdit {
    pub key: Vec<CellEdit>,
    pub set: Vec<CellEdit>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditPlan {
    pub rows: Vec<RowEdit>,
}

/// One UPDATE with its bound values; `None` binds SQL NULL.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statement {
    pub sql: String,
    pub params: Vec<Option<String>>,
}

/// The statements a plan would run, and the same as text for the user to read before committing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditPreview {
    pub statements: Vec<Statement>,
    pub text: String,
}

/// The most rows one commit may change.
pub const MAX_EDIT_ROWS: usize = 500;

/// Turns a plan into one UPDATE per row, every value bound and cast to the column's catalog type:
/// `UPDATE "public"."users" SET "plan" = ($1::text)::text WHERE "id" = ($2::text)::integer`.
/// Column names must come from the catalog, the key must name every primary-key column, and a
/// primary-key column cannot be set, so an edit can never move to another row.
pub fn build_updates(schema: &str, table: &str, columns: &[Column], plan: &EditPlan) -> Result<Vec<Statement>, DbError> {
    let pk: Vec<&Column> = columns.iter().filter(|c| c.primary_key).collect();
    if pk.is_empty() {
        return Err(DbError::msg(format!("{table} has no primary key, so its rows cannot be edited inline.")));
    }
    if plan.rows.is_empty() {
        return Err(DbError::msg("There is nothing to commit."));
    }
    if plan.rows.len() > MAX_EDIT_ROWS {
        return Err(DbError::msg(format!("A commit changes at most {MAX_EDIT_ROWS} rows; this one has {}.", plan.rows.len())));
    }
    let find = |name: &str| columns.iter().find(|c| c.name == name).ok_or_else(|| DbError::msg(format!("Unknown column {name}.")));
    let target = format!("{}.{}", quote_ident(schema), quote_ident(table));
    let mut out = Vec::with_capacity(plan.rows.len());
    for (i, row) in plan.rows.iter().enumerate() {
        let at = |what: &str| DbError::msg(format!("Row {}: {what}", i + 1));
        let mut params: Vec<Option<String>> = Vec::new();
        let mut bind = |c: &Column, v: Option<String>| {
            params.push(v);
            format!("(${}::text)::{}", params.len(), c.type_name.as_deref().unwrap_or("text"))
        };
        if row.set.is_empty() {
            return Err(at("nothing is set."));
        }
        let mut sets = Vec::new();
        let mut seen: Vec<&str> = Vec::new();
        for e in &row.set {
            let c = find(&e.column)?;
            if c.primary_key {
                return Err(at(&format!("{} is part of the primary key, which is not editable inline.", c.name)));
            }
            if seen.contains(&c.name.as_str()) {
                return Err(at(&format!("{} is set twice.", c.name)));
            }
            seen.push(&c.name);
            sets.push(format!("{} = {}", quote_ident(&c.name), bind(c, e.value.clone())));
        }
        let mut wheres = Vec::new();
        for c in &pk {
            let k = row.key.iter().filter(|k| k.column == c.name).collect::<Vec<_>>();
            let k = match k.as_slice() {
                [one] => *one,
                [] => return Err(at(&format!("the key is missing {}.", c.name))),
                _ => return Err(at(&format!("the key names {} twice.", c.name))),
            };
            let Some(v) = &k.value else { return Err(at(&format!("{} is NULL in the key.", c.name))) };
            wheres.push(format!("{} = {}", quote_ident(&c.name), bind(c, Some(v.clone()))));
        }
        out.push(Statement { sql: format!("UPDATE {target} SET {} WHERE {}", sets.join(", "), wheres.join(" AND ")), params });
    }
    Ok(out)
}

/// The statements as the review text: a transaction, each UPDATE under a comment naming its row,
/// and the bound values after it.
pub fn preview_text(schema: &str, table: &str, statements: &[Statement], plan: &EditPlan) -> String {
    let lit = |v: &Option<String>| match v {
        None => "NULL".to_string(),
        Some(s) => format!("'{}'", s.replace('\'', "''")),
    };
    let mut text = String::from("BEGIN;\n");
    for (st, row) in statements.iter().zip(&plan.rows) {
        let key = row.key.iter().map(|k| format!("{} = {}", k.column, lit(&k.value))).collect::<Vec<_>>().join(" and ");
        text.push_str(&format!("\n-- {schema}.{table} where {key}\n{};\n", st.sql));
        let values = st.params.iter().enumerate().map(|(i, p)| format!("${} = {}", i + 1, lit(p))).collect::<Vec<_>>().join(", ");
        text.push_str(&format!("-- {values}\n"));
    }
    text.push_str("\nCOMMIT;\n");
    text
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowCount {
    pub total: Option<i64>,
    pub exact: bool,
}

/// The longest free-text condition accepted, in bytes.
pub const MAX_WHERE_BYTES: usize = 4096;
/// The most values one `In` filter may list.
pub const MAX_IN_VALUES: usize = 200;

/// The statements for one [`BrowseRequest`], with their shared parameters.
#[derive(Debug)]
pub(crate) struct Built {
    pub sql: String,
    pub count_sql: String,
    /// Every value, bound as `$n::text` and cast server-side to the column's catalog type.
    pub params: Vec<String>,
    /// Characters before the free-text condition in `sql`, so an error position inside it can be
    /// told in the user's own text.
    pub raw_start: Option<usize>,
    pub filtered: bool,
}

impl Built {
    fn param_refs(&self) -> Vec<&(dyn ToSql + Sync)> {
        self.params.iter().map(|p| p as &(dyn ToSql + Sync)).collect()
    }
}

/// Builds the page and count statements. Column and type names come from the catalog, never
/// from the request: a filter may only name a column the catalog listed, and its value is bound
/// as text and cast to that column's `format_type` name, so `"t"."id" = ($1::text)::integer`.
/// Columns are qualified with the table because the select list aliases each one to its own
/// name as text, and a bare name in ORDER BY would pick that text alias.
pub(crate) fn build_browse(schema: &str, table: &str, columns: &[Column], req: &BrowseRequest) -> Result<Built, DbError> {
    let find = |name: &str| columns.iter().find(|c| c.name == name).ok_or_else(|| DbError::msg(format!("Unknown column {name}.")));
    let t = quote_ident(table);
    let mut params: Vec<String> = Vec::new();
    let mut preds: Vec<String> = Vec::new();
    for f in &req.filters {
        preds.push(predicate(f, &t, find(&f.column)?, &mut params)?);
    }
    let from = format!("{}.{t}", quote_ident(schema));
    let mut raw_start = None;
    if let Some(raw) = req.where_.as_deref().map(str::trim).filter(|w| !w.is_empty()) {
        if raw.len() > MAX_WHERE_BYTES {
            return Err(DbError::msg(format!("The condition is longer than {MAX_WHERE_BYTES} bytes.")));
        }
        if berth_core::strip(raw).contains(';') {
            return Err(DbError::msg("The condition is one expression for WHERE; it cannot hold `;`."));
        }
        let head = format!("SELECT {} FROM {from} WHERE ", select_list(columns));
        let before = if preds.is_empty() { format!("{head}(") } else { format!("{head}{} AND (", preds.join(" AND ")) };
        raw_start = Some(before.chars().count());
        preds.push(format!("({raw})"));
    }
    let filtered = !preds.is_empty();
    let where_ = if filtered { format!(" WHERE {}", preds.join(" AND ")) } else { String::new() };
    let mut order: Vec<String> = Vec::new();
    if let Some(sort) = &req.sort {
        let c = find(&sort.column)?;
        order.push(format!("{t}.{} {} NULLS LAST", quote_ident(&c.name), if sort.descending { "DESC" } else { "ASC" }));
    }
    for c in columns.iter().filter(|c| c.primary_key && req.sort.as_ref().is_none_or(|s| s.column != c.name)) {
        order.push(format!("{t}.{}", quote_ident(&c.name)));
    }
    let order = if order.is_empty() { String::new() } else { format!(" ORDER BY {}", order.join(", ")) };
    let limit = req.limit.clamp(1, MAX_ROWS as u32);
    let sql = format!("SELECT {} FROM {from}{where_}{order} LIMIT {limit} OFFSET {}", select_list(columns), req.offset);
    let count_sql = format!("SELECT count(*) FROM {from}{where_}");
    Ok(Built { sql, count_sql, params, raw_start, filtered })
}

/// One row per column pair of a foreign key: constraint name, referencing schema, table and
/// column, then the referenced schema, table and column. `unnest … WITH ORDINALITY` keeps the
/// pairs of a composite key in order.
const FK_SQL: &str =
    "SELECT con.conname::text, n.nspname::text, c.relname::text, att.attname::text, fn.nspname::text, fc.relname::text, fatt.attname::text
   FROM pg_catalog.pg_constraint con
   JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_catalog.pg_class fc ON fc.oid = con.confrelid
   JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
   JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(a, fa, ord) ON true
   JOIN pg_catalog.pg_attribute att ON att.attrelid = c.oid AND att.attnum = k.a
   JOIN pg_catalog.pg_attribute fatt ON fatt.attrelid = fc.oid AND fatt.attnum = k.fa";

type FkRow = (String, String, String, String, String, String, String);

/// Folds consecutive rows of one constraint into a [`ForeignKey`]; rows come sorted by constraint.
fn fold_foreign_keys(rows: impl IntoIterator<Item = FkRow>) -> Vec<ForeignKey> {
    let mut out: Vec<ForeignKey> = Vec::new();
    for (name, schema, table, column, ref_schema, ref_table, ref_column) in rows {
        match out.last_mut() {
            Some(fk) if fk.name == name && fk.schema == schema && fk.table == table => {
                fk.columns.push(column);
                fk.ref_columns.push(ref_column);
            }
            _ => out.push(ForeignKey { name, schema, table, columns: vec![column], ref_schema, ref_table, ref_columns: vec![ref_column] }),
        }
    }
    out
}

/// Every column as text, so the grid gets the same strings the simple query protocol sends.
fn select_list(columns: &[Column]) -> String {
    columns.iter().map(|c| format!("{q}::text AS {q}", q = quote_ident(&c.name))).collect::<Vec<_>>().join(", ")
}

fn predicate(f: &Filter, table: &str, col: &Column, params: &mut Vec<String>) -> Result<String, DbError> {
    let q = format!("{table}.{}", quote_ident(&col.name));
    let ty = col.type_name.as_deref().unwrap_or("text");
    let mut bind = |v: String| {
        params.push(v);
        format!("(${}::text)::{ty}", params.len())
    };
    let value = || f.value.clone().ok_or_else(|| DbError::msg(format!("The filter on {} needs a value.", col.name)));
    Ok(match f.op {
        FilterOp::Eq => format!("{q} = {}", bind(value()?)),
        FilterOp::Ne => format!("{q} <> {}", bind(value()?)),
        FilterOp::Lt => format!("{q} < {}", bind(value()?)),
        FilterOp::Le => format!("{q} <= {}", bind(value()?)),
        FilterOp::Gt => format!("{q} > {}", bind(value()?)),
        FilterOp::Ge => format!("{q} >= {}", bind(value()?)),
        FilterOp::Contains | FilterOp::StartsWith => {
            let v = escape_like(&value()?);
            params.push(if f.op == FilterOp::Contains { format!("%{v}%") } else { format!("{v}%") });
            format!("{q}::text ILIKE ${}::text ESCAPE '\\'", params.len())
        }
        FilterOp::IsNull => format!("{q} IS NULL"),
        FilterOp::IsNotNull => format!("{q} IS NOT NULL"),
        FilterOp::In => {
            let mut values: Vec<&String> = Vec::new();
            for v in &f.values {
                if !values.contains(&v) {
                    values.push(v);
                }
            }
            if values.is_empty() {
                return Err(DbError::msg(format!("The filter on {} needs at least one value.", col.name)));
            }
            if values.len() > MAX_IN_VALUES {
                return Err(DbError::msg(format!("The filter on {} lists more than {MAX_IN_VALUES} values.", col.name)));
            }
            let list: Vec<String> = values.into_iter().map(|v| bind(v.clone())).collect();
            format!("{q} IN ({})", list.join(", "))
        }
    })
}

/// Makes a value safe inside a LIKE pattern whose escape character is `\`.
fn escape_like(v: &str) -> String {
    v.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// An error position inside the free-text condition, told in the user's own text.
fn rebase_position(mut err: DbError, raw_start: Option<usize>) -> DbError {
    if let (Some(p), Some(start)) = (err.position, raw_start) {
        err.position = (p as usize > start).then(|| (p as usize - start) as u32);
    }
    err
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

    fn col(name: &str, ty: &str, pk: bool) -> Column {
        Column { name: name.into(), type_name: Some(ty.into()), primary_key: pk }
    }

    fn users() -> Vec<Column> {
        vec![
            col("id", "integer", true),
            col("email", "text", false),
            col("plan", "character varying(255)", false),
            col("last_login", "timestamp with time zone", false),
            col("we\"ird", "numeric(10,2)", false),
            col("tags", "text[]", false),
        ]
    }

    fn filter(column: &str, op: FilterOp, value: &str) -> Filter {
        Filter { column: column.into(), op, value: Some(value.into()), values: vec![] }
    }

    fn req(filters: Vec<Filter>) -> BrowseRequest {
        BrowseRequest { filters, limit: 200, offset: 0, ..Default::default() }
    }

    #[test]
    fn a_plain_page_selects_every_column_as_text_in_primary_key_order() {
        let b = build_browse("public", "users", &users(), &req(vec![])).unwrap();
        assert_eq!(
            b.sql,
            "SELECT \"id\"::text AS \"id\", \"email\"::text AS \"email\", \"plan\"::text AS \"plan\", \"last_login\"::text AS \"last_login\", \"we\"\"ird\"::text AS \"we\"\"ird\", \"tags\"::text AS \"tags\" FROM \"public\".\"users\" ORDER BY \"users\".\"id\" LIMIT 200 OFFSET 0"
        );
        assert_eq!(b.count_sql, "SELECT count(*) FROM \"public\".\"users\"");
        assert!(b.params.is_empty() && !b.filtered && b.raw_start.is_none());
        let b = build_browse("public", "users", &[col("a", "text", false)], &BrowseRequest { limit: 0, offset: 40, ..Default::default() })
            .unwrap();
        assert!(b.sql.ends_with("FROM \"public\".\"users\" LIMIT 1 OFFSET 40"), "{}", b.sql);
    }

    #[test]
    fn filters_bind_every_value_as_text_cast_to_the_catalog_type() {
        let b = build_browse(
            "public",
            "users",
            &users(),
            &req(vec![
                filter("plan", FilterOp::Eq, "pro"),
                filter("id", FilterOp::Ge, "10"),
                filter("last_login", FilterOp::Lt, "2026-01-01"),
                filter("we\"ird", FilterOp::Ne, "1.5"),
                filter("tags", FilterOp::Gt, "{}"),
                filter("email", FilterOp::Contains, "USER_1%"),
                filter("plan", FilterOp::StartsWith, "te"),
                filter("last_login", FilterOp::IsNull, ""),
                filter("email", FilterOp::IsNotNull, ""),
                Filter { column: "id".into(), op: FilterOp::In, value: None, values: vec!["1".into(), "2".into(), "1".into(), "3".into()] },
            ]),
        )
        .unwrap();
        let where_ = b.sql.split(" WHERE ").nth(1).unwrap().split(" ORDER BY ").next().unwrap();
        assert_eq!(
            where_,
            "\"users\".\"plan\" = ($1::text)::character varying(255) AND \"users\".\"id\" >= ($2::text)::integer \
             AND \"users\".\"last_login\" < ($3::text)::timestamp with time zone AND \"users\".\"we\"\"ird\" <> ($4::text)::numeric(10,2) \
             AND \"users\".\"tags\" > ($5::text)::text[] AND \"users\".\"email\"::text ILIKE $6::text ESCAPE '\\' \
             AND \"users\".\"plan\"::text ILIKE $7::text ESCAPE '\\' AND \"users\".\"last_login\" IS NULL AND \"users\".\"email\" IS NOT NULL \
             AND \"users\".\"id\" IN (($8::text)::integer, ($9::text)::integer, ($10::text)::integer)"
        );
        assert_eq!(b.params, ["pro", "10", "2026-01-01", "1.5", "{}", "%USER\\_1\\%%", "te%", "1", "2", "3"]);
        assert!(b.filtered);
        assert_eq!(b.count_sql, format!("SELECT count(*) FROM \"public\".\"users\" WHERE {where_}"));
    }

    #[test]
    fn filters_are_checked_against_the_catalog() {
        let e = |r: Result<Built, DbError>| r.unwrap_err().message;
        assert_eq!(e(build_browse("public", "users", &users(), &req(vec![filter("nope", FilterOp::Eq, "1")]))), "Unknown column nope.");
        assert_eq!(
            e(build_browse(
                "public",
                "users",
                &users(),
                &req(vec![Filter { column: "id".into(), op: FilterOp::Eq, value: None, values: vec![] }])
            )),
            "The filter on id needs a value."
        );
        assert!(e(build_browse(
            "public",
            "users",
            &users(),
            &req(vec![Filter { column: "id".into(), op: FilterOp::In, value: None, values: vec![] }])
        ))
        .contains("at least one value"));
        let many =
            Filter { column: "id".into(), op: FilterOp::In, value: None, values: (0..=MAX_IN_VALUES).map(|i| i.to_string()).collect() };
        assert!(e(build_browse("public", "users", &users(), &req(vec![many]))).contains("more than 200"));
        let sort =
            BrowseRequest { sort: Some(Sort { column: "nope".into(), descending: true }), limit: 10, offset: 0, ..Default::default() };
        assert_eq!(e(build_browse("public", "users", &users(), &sort)), "Unknown column nope.");
    }

    #[test]
    fn sorting_keeps_the_primary_key_as_a_tiebreaker() {
        let sort = |column: &str, descending: bool| BrowseRequest {
            sort: Some(Sort { column: column.into(), descending }),
            limit: 10,
            offset: 0,
            ..Default::default()
        };
        let b = build_browse("public", "users", &users(), &sort("last_login", true)).unwrap();
        assert!(b.sql.contains(" ORDER BY \"users\".\"last_login\" DESC NULLS LAST, \"users\".\"id\" LIMIT 10"), "{}", b.sql);
        let b = build_browse("public", "users", &users(), &sort("id", false)).unwrap();
        assert!(b.sql.contains(" ORDER BY \"users\".\"id\" ASC NULLS LAST LIMIT 10"), "{}", b.sql);
        let b = build_browse("public", "t", &[col("a", "text", false)], &sort("a", false)).unwrap();
        assert!(b.sql.contains(" ORDER BY \"t\".\"a\" ASC NULLS LAST LIMIT"), "{}", b.sql);
    }

    #[test]
    fn a_free_text_condition_is_one_parenthesised_expression() {
        let raw = |w: &str| BrowseRequest { where_: Some(w.into()), limit: 10, offset: 0, ..Default::default() };
        let b = build_browse("public", "users", &users(), &raw("  id < 10 AND plan = 'a;b'  ")).unwrap();
        assert!(b.sql.contains(" WHERE (id < 10 AND plan = 'a;b') ORDER BY"), "{}", b.sql);
        assert!(b.filtered && b.params.is_empty());
        // The position of the condition's first character, so a server error can be told in it.
        let start = b.raw_start.unwrap();
        assert_eq!(&b.sql.chars().skip(start).take(7).collect::<String>(), "id < 10");
        assert_eq!(rebase_position(DbError { position: Some(start as u32 + 4), ..DbError::msg("x") }, b.raw_start).position, Some(4));
        assert_eq!(rebase_position(DbError { position: Some(3), ..DbError::msg("x") }, b.raw_start).position, None);

        let both = BrowseRequest {
            filters: vec![filter("plan", FilterOp::Eq, "pro")],
            where_: Some("id < 10".into()),
            limit: 10,
            offset: 0,
            ..Default::default()
        };
        let b = build_browse("public", "users", &users(), &both).unwrap();
        assert!(b.sql.contains(" WHERE \"users\".\"plan\" = ($1::text)::character varying(255) AND (id < 10) ORDER BY"), "{}", b.sql);
        assert_eq!(&b.sql.chars().skip(b.raw_start.unwrap()).take(7).collect::<String>(), "id < 10");

        assert!(build_browse("public", "users", &users(), &raw("1=1; DROP TABLE users")).unwrap_err().message.contains("`;`"));
        assert!(build_browse("public", "users", &users(), &raw(&"x".repeat(MAX_WHERE_BYTES + 1)))
            .unwrap_err()
            .message
            .contains("longer than"));
        assert!(!build_browse("public", "users", &users(), &raw("   ")).unwrap().filtered, "blank is no condition");
    }

    #[test]
    fn foreign_key_rows_fold_into_keys_with_their_column_pairs_in_order() {
        let r = |name: &str, col: &str, rcol: &str| {
            (
                name.to_string(),
                "public".to_string(),
                "orders".to_string(),
                col.to_string(),
                "public".to_string(),
                "users".to_string(),
                rcol.to_string(),
            )
        };
        let fks = fold_foreign_keys(vec![
            r("orders_user_fk", "user_id", "id"),
            r("orders_user_fk", "user_org", "org_id"),
            r("orders_zone_fk", "zone", "id"),
        ]);
        assert_eq!(fks.len(), 2);
        assert_eq!(
            (fks[0].columns.clone(), fks[0].ref_columns.clone()),
            (vec!["user_id".to_string(), "user_org".into()], vec!["id".to_string(), "org_id".into()])
        );
        assert_eq!((fks[1].name.as_str(), fks[1].ref_table.as_str()), ("orders_zone_fk", "users"));
        assert!(fold_foreign_keys(vec![]).is_empty());
    }

    fn cell(column: &str, value: Option<&str>) -> CellEdit {
        CellEdit { column: column.into(), value: value.map(str::to_string) }
    }

    #[test]
    fn edits_become_one_bound_update_per_row_found_by_its_key() {
        let plan = EditPlan {
            rows: vec![
                RowEdit { key: vec![cell("id", Some("1049"))], set: vec![cell("plan", Some("team")), cell("last_login", None)] },
                RowEdit { key: vec![cell("id", Some("7"))], set: vec![cell("email", Some("o'neil@acme.dev"))] },
            ],
        };
        let st = build_updates("public", "users", &users(), &plan).unwrap();
        assert_eq!(st.len(), 2);
        assert_eq!(
            st[0].sql,
            "UPDATE \"public\".\"users\" SET \"plan\" = ($1::text)::character varying(255), \"last_login\" = ($2::text)::timestamp with time zone WHERE \"id\" = ($3::text)::integer"
        );
        assert_eq!(st[0].params, [Some("team".to_string()), None, Some("1049".to_string())]);
        let text = preview_text("public", "users", &st, &plan);
        assert!(text.starts_with("BEGIN;\n") && text.ends_with("COMMIT;\n"), "{text}");
        assert!(text.contains("-- public.users where id = '1049'\n"), "{text}");
        assert!(text.contains("-- $1 = 'team', $2 = NULL, $3 = '1049'\n"), "{text}");
        assert!(text.contains("$1 = 'o''neil@acme.dev'"), "quotes are doubled: {text}");
    }

    #[test]
    fn edits_are_refused_when_they_could_change_the_wrong_row() {
        let e = |rows: Vec<RowEdit>, cols: &[Column]| build_updates("public", "users", cols, &EditPlan { rows }).unwrap_err().message;
        let ok = || vec![cell("plan", Some("team"))];
        assert!(e(vec![RowEdit { key: vec![cell("id", Some("1"))], set: ok() }], &[col("a", "text", false)]).contains("no primary key"));
        assert!(e(vec![], &users()).contains("nothing to commit"));
        assert!(e(vec![RowEdit { key: vec![], set: ok() }], &users()).contains("missing id"));
        assert!(e(vec![RowEdit { key: vec![cell("id", None)], set: ok() }], &users()).contains("NULL in the key"));
        assert!(e(vec![RowEdit { key: vec![cell("id", Some("1")), cell("id", Some("2"))], set: ok() }], &users()).contains("twice"));
        assert!(e(vec![RowEdit { key: vec![cell("id", Some("1"))], set: vec![] }], &users()).contains("nothing is set"));
        assert!(e(vec![RowEdit { key: vec![cell("id", Some("1"))], set: vec![cell("id", Some("2"))] }], &users()).contains("primary key"));
        assert!(e(vec![RowEdit { key: vec![cell("id", Some("1"))], set: vec![cell("nope", Some("2"))] }], &users())
            .contains("Unknown column nope"));
        assert!(e(
            vec![RowEdit { key: vec![cell("id", Some("1"))], set: vec![cell("plan", Some("a")), cell("plan", Some("b"))] }],
            &users()
        )
        .contains("set twice"));
        let many: Vec<RowEdit> = (0..=MAX_EDIT_ROWS).map(|i| RowEdit { key: vec![cell("id", Some(&i.to_string()))], set: ok() }).collect();
        assert!(e(many, &users()).contains("at most 500"));
        // A composite key needs every column, in any order.
        let cols = vec![col("a", "integer", true), col("b", "text", true), col("v", "text", false)];
        let st = build_updates(
            "s",
            "t",
            &cols,
            &EditPlan { rows: vec![RowEdit { key: vec![cell("b", Some("x")), cell("a", Some("1"))], set: vec![cell("v", None)] }] },
        )
        .unwrap();
        assert_eq!(
            st[0].sql,
            "UPDATE \"s\".\"t\" SET \"v\" = ($1::text)::text WHERE \"a\" = ($2::text)::integer AND \"b\" = ($3::text)::text"
        );
        assert!(e(vec![RowEdit { key: vec![cell("a", Some("1"))], set: vec![cell("v", None)] }], &cols).contains("missing b"));
    }

    #[test]
    fn like_patterns_escape_their_wildcards() {
        assert_eq!(escape_like("50%_off\\x"), "50\\%\\_off\\\\x");
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
        assert!(rustls_connector("db.acme.io", None).is_ok());
        assert!(rustls_connector("db.acme.io", Some("  ")).is_ok());
        assert!(rustls_connector("db.abc.us-east-1.rds.amazonaws.com", None).is_ok());
    }

    #[test]
    fn rds_hosts_are_told_by_their_suffix_alone() {
        for host in [
            "db.abc123.ap-southeast-1.rds.amazonaws.com",
            "aurora-cluster.cluster-abc.eu-west-1.rds.amazonaws.com",
            "DB.ABC.US-EAST-1.RDS.AMAZONAWS.COM",
            "  db.abc.us-east-1.rds.amazonaws.com\n",
            "db.abc.us-east-1.rds.amazonaws.com.",
            "db.abc.cn-north-1.rds.amazonaws.com.cn",
            "db.abc.cn-north-1.RDS.amazonaws.com.CN.",
        ] {
            assert!(is_rds_host(host), "{host:?}");
        }
        for host in [
            "",
            "localhost",
            "db.acme.io",
            "rds.amazonaws.com",
            "notrds.amazonaws.com",
            "db.abc.us-east-1.rds.amazonaws.com.evil.test",
            "db.abc.us-east-1.rds.amazonaws.com.cn.evil.test",
            "db.abc.us-east-1.rds.amazonaws.co",
            "db.abc.us-east-1.rds.amazonaws.com.c",
            "rds.amazonaws.com.db.acme.io",
            "db.rds-amazonaws.com",
        ] {
            assert!(!is_rds_host(host), "{host:?}");
        }
    }

    /// Every certificate in the shipped bundle must parse and act as a CA, and the bundle must
    /// reach RDS hosts only: elsewhere the system store alone decides, CA file or not.
    #[test]
    fn the_built_in_rds_roots_parse_and_reach_rds_hosts_only() {
        use rustls::client::danger::ServerCertVerifier;
        use rustls::pki_types::{pem::PemObject, CertificateDer, ServerName, UnixTime};
        let in_bundle = RDS_GLOBAL_BUNDLE.matches("-----BEGIN CERTIFICATE-----").count();
        assert!(in_bundle > 0);
        assert_eq!(rds_roots().len(), in_bundle);
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        assert!(ExtraRootsVerifier::new(rds_roots().to_vec(), provider.clone()).is_ok());

        let rds = "db.abc.ap-southeast-1.rds.amazonaws.com";
        assert!(trusted_extra_roots("db.acme.io", None).unwrap().is_empty());
        assert!(trusted_extra_roots("db.acme.io", Some(" ")).unwrap().is_empty());
        assert_eq!(trusted_extra_roots(rds, None).unwrap().len(), in_bundle);

        let dir = std::env::temp_dir().join(format!("berth-rds-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("root.pem");
        std::fs::write(&file, TEST_ROOT).unwrap();
        let path = file.to_str().unwrap();
        assert_eq!(trusted_extra_roots("db.acme.io", Some(path)).unwrap().len(), 1);
        let merged = trusted_extra_roots(rds, Some(path)).unwrap();
        assert_eq!(merged.len(), in_bundle + 1);
        // The CA file's root still vouches next to the built-in ones.
        let verifier = ExtraRootsVerifier::new(merged, provider).unwrap();
        let leaf = CertificateDer::from_pem_slice(TEST_LEAF_NO_EKU.as_bytes()).unwrap();
        assert!(verifier.verify_server_cert(&leaf, &[], &ServerName::try_from("db.example.test").unwrap(), &[], UnixTime::now()).is_ok());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extra_ca_certificates_come_from_a_pem_file() {
        let dir = std::env::temp_dir().join(format!("berth-ca-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("ca.pem");
        std::fs::write(&ok, TEST_CA).unwrap();
        assert!(rustls_connector("db.acme.io", Some(ok.to_str().unwrap())).is_ok());

        let empty = dir.join("empty.pem");
        std::fs::write(&empty, "just text\n").unwrap();
        let e = rustls_connector("db.acme.io", Some(empty.to_str().unwrap())).err().expect("an error");
        assert!(e.message.contains("empty.pem") && e.message.contains("no certificate"), "{}", e.message);
        // An RDS host reads the file just the same; the built-in roots are no excuse for a bad file.
        let e = rustls_connector("db.abc.us-east-1.rds.amazonaws.com", Some(empty.to_str().unwrap())).err().expect("an error");
        assert!(e.message.contains("empty.pem"), "{}", e.message);

        let missing = dir.join("missing.pem");
        let e = rustls_connector("db.acme.io", Some(missing.to_str().unwrap())).err().expect("an error");
        assert!(e.message.starts_with("CA certificate ") && e.message.contains("missing.pem"), "{}", e.message);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unknown_issuer_without_a_ca_file_says_what_to_do() {
        let raw = "error performing TLS handshake: invalid peer certificate: UnknownIssuer";
        let e = explain_unknown_issuer(DbError::msg(raw), "db.acme.io", None);
        assert!(e.message.starts_with(raw) && e.message.contains("CA certificate"), "{}", e.message);
        // Nobody but an RDS user needs the RDS trust store, and an RDS user has it built in.
        assert!(!e.message.contains("RDS"), "{}", e.message);
        // With a CA file the file itself is the suspect, so the message stays as it was.
        assert_eq!(explain_unknown_issuer(DbError::msg(raw), "db.acme.io", Some("~/ca.pem")).message, raw);
        assert_eq!(explain_unknown_issuer(DbError::msg(raw), "db.acme.io", Some("  ")).message, e.message);
        assert_eq!(explain_unknown_issuer(DbError::msg("connection refused"), "db.acme.io", None).message, "connection refused");
        // An RDS host that still fails has outgrown the shipped bundle; the region's is the stopgap.
        let rds = explain_unknown_issuer(DbError::msg(raw), "db.abc.us-east-1.rds.amazonaws.com", None);
        assert!(rds.message.contains("built into") && rds.message.contains("truststore.pki.rds.amazonaws.com"), "{}", rds.message);
        assert_eq!(explain_unknown_issuer(DbError::msg(raw), "db.abc.us-east-1.rds.amazonaws.com", Some("~/ca.pem")).message, raw);
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

    /// A root from the CA file must vouch for a server certificate that has no Extended Key
    /// Usage extension, as every Amazon RDS certificate is; macOS alone refuses those.
    #[test]
    fn a_ca_file_root_vouches_for_a_server_certificate_without_eku() {
        use rustls::client::danger::ServerCertVerifier;
        use rustls::pki_types::{pem::PemObject, CertificateDer, ServerName, UnixTime};
        let root = CertificateDer::from_pem_slice(TEST_ROOT.as_bytes()).unwrap();
        let leaf = CertificateDer::from_pem_slice(TEST_LEAF_NO_EKU.as_bytes()).unwrap();
        let verifier = ExtraRootsVerifier::new(vec![root], Arc::new(rustls::crypto::ring::default_provider())).unwrap();
        let verify =
            |host: &str| verifier.verify_server_cert(&leaf, &[], &ServerName::try_from(host.to_string()).unwrap(), &[], UnixTime::now());
        assert!(verify("db.example.test").is_ok());
        // The chain is the user's, so its own verdict shows, not the system store's.
        assert!(
            matches!(
                verify("other.example.test"),
                Err(rustls::Error::InvalidCertificate(rustls::CertificateError::NotValidForNameContext { .. }))
            ),
            "{:?}",
            verify("other.example.test")
        );
        // A certificate that chains to neither is refused by both.
        let stranger = CertificateDer::from_pem_slice(TEST_CA.as_bytes()).unwrap();
        assert!(verifier
            .verify_server_cert(&stranger, &[], &ServerName::try_from("db.example.test").unwrap(), &[], UnixTime::now())
            .is_err());
    }

    /// A test root and a server certificate it signed for `db.example.test` without an Extended
    /// Key Usage extension. Both keys were discarded; they sign nothing real.
    const TEST_ROOT: &str = "-----BEGIN CERTIFICATE-----\n\
MIIBhzCCASygAwIBAgIUT6isvV0EWP8QbXr9hKStOvZY69YwCgYIKoZIzj0EAwIw\n\
ITEfMB0GA1UEAwwWQmVydGggU3R1ZGlvIHRlc3Qgcm9vdDAeFw0yNjEwMTYwNjA5\n\
MjBaFw0zNjEwMTMwNjA5MjBaMCExHzAdBgNVBAMMFkJlcnRoIFN0dWRpbyB0ZXN0\n\
IHJvb3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASgGDj8vU+qKxMATZRO/hCL\n\
h8cuz/3mzXOpNVbdC4GV6jnG0JJnJ5e+Q3VUtxffGnDBWKriaKqWxXZFTJ59FRQO\n\
o0IwQDAdBgNVHQ4EFgQU7ZrY4ht+ed57LYBd7Ljde0fTwKQwDwYDVR0TAQH/BAUw\n\
AwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSQAwRgIhANEKzXrDIooc\n\
iahR2lHXNCVuOeK1O3JVjnJNLMIPtHbXAiEAxR0FivLNzj7BPX/i1/l/BbrNYdxm\n\
omvWR8LffzdGVeg=\n\
-----END CERTIFICATE-----\n";
    const TEST_LEAF_NO_EKU: &str = "-----BEGIN CERTIFICATE-----\n\
MIIBdDCCARmgAwIBAgIUbAAvGf+zaZAa2rvz4geMnaxp/0AwCgYIKoZIzj0EAwIw\n\
ITEfMB0GA1UEAwwWQmVydGggU3R1ZGlvIHRlc3Qgcm9vdDAeFw0yNjEwMTYwNjA5\n\
MjBaFw0zNjEwMTMwNjA5MjBaMBoxGDAWBgNVBAMMD2RiLmV4YW1wbGUudGVzdDBZ\n\
MBMGByqGSM49AgEGCCqGSM49AwEHA0IABCPLWW0Dz6n6uKDpClOy3fU8rNOqkiD4\n\
pQEeQbn/BB8LQRuIU1J/8wAk6/Y7mM0GW991ZNG6JPUZMbmvXHHNta2jNjA0MAkG\n\
A1UdEwQCMAAwGgYDVR0RBBMwEYIPZGIuZXhhbXBsZS50ZXN0MAsGA1UdDwQEAwIH\n\
gDAKBggqhkjOPQQDAgNJADBGAiEA54Mw+5+QdHV2hjba0it7VxUmu6GXrCGqFqUa\n\
ujgJ0tsCIQDx0848+R6BAEltUYcJJ8FyKEPCPYOE7DDEpm62d5QB2w==\n\
-----END CERTIFICATE-----\n";

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
