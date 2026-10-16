//! Connections, their per-environment profiles and endpoints.
//!
//! A connection is one logical system (`acme-db`). It has at most one profile per environment.
//! A PostgreSQL profile has at most one `write` endpoint (the primary) and any number of `read`
//! endpoints (replicas); a profile with only read endpoints can only read. A MongoDB profile has
//! one endpoint and routes reads with a read preference. Profiles never hold secrets, only a
//! keychain reference.

use crate::env::{EnvId, Environment};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Postgres,
    Mongodb,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Write,
    Read,
}

/// How the client protects the connection. `Auto` means `require` for remote hosts and
/// `disable` for localhost, where a dev database usually has no certificate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TlsMode {
    #[default]
    Auto,
    Require,
    Disable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub role: Role,
    #[serde(default)]
    pub host: String,
    /// Kept wide so a bad value from the UI reaches validation instead of failing to parse.
    #[serde(default)]
    pub port: i64,
    #[serde(default)]
    pub database: String,
    #[serde(default)]
    pub user: String,
    /// MongoDB only: `mongodb://…` or `mongodb+srv://…`, never with a password inside.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    /// MongoDB only: the database the user is defined in, usually `admin`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_source: Option<String>,
    #[serde(default)]
    pub tls: TlsMode,
    /// PostgreSQL only: path to a PEM file with extra CA certificates to trust besides the
    /// system trust store, for example the Amazon RDS bundle. Ignored when TLS is off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ca_cert: Option<String>,
    /// A keychain reference such as `keychain://berth-studio/acme-db/dev/write-0`. Never the secret.
    #[serde(default)]
    pub secret: Option<String>,
    /// Set when the endpoint was copied and still needs its own password.
    #[serde(default)]
    pub needs_secret: bool,
}

impl Endpoint {
    pub fn is_local(&self) -> bool {
        let h = self.host.trim().to_ascii_lowercase();
        h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "[::1]"
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    #[serde(default)]
    pub endpoints: Vec<Endpoint>,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default = "yes")]
    pub auto_route: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copied_from: Option<EnvId>,
    /// MongoDB only: where reads go.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_preference: Option<ReadPreference>,
}

/// MongoDB read preferences offered in the interface. `secondary` is left out on purpose: on a
/// single-node replica set it finds no eligible server and fails after the selection timeout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadPreference {
    #[default]
    Primary,
    SecondaryPreferred,
}

fn yes() -> bool {
    true
}

impl Profile {
    pub fn endpoints(&self, role: Role) -> impl Iterator<Item = &Endpoint> {
        self.endpoints.iter().filter(move |e| e.role == role)
    }

    pub fn has_read(&self) -> bool {
        self.endpoints(Role::Read).next().is_some()
    }

    pub fn has_write(&self) -> bool {
        self.endpoints(Role::Write).next().is_some()
    }

    /// A copy that is safe to store for `env`: production is always read-only.
    pub fn normalized(&self, env: &Environment) -> Profile {
        let mut p = self.clone();
        if env.production {
            p.read_only = true;
        }
        p
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub engine: Engine,
    #[serde(default)]
    pub profiles: BTreeMap<EnvId, Profile>,
}

impl Connection {
    pub fn profile(&self, env: &EnvId) -> Option<&Profile> {
        self.profiles.get(env)
    }

    /// The first environment, in the workspace's order, that has a profile for this connection.
    pub fn first_profile_env<'a>(&self, envs: &'a [Environment]) -> Option<&'a EnvId> {
        envs.iter().map(|e| &e.id).find(|id| self.profiles.contains_key(*id))
    }
}

/// A connection id doubles as a keychain account prefix, so it is kept to a safe alphabet.
pub fn validate_connection_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
        && id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
    if ok {
        Ok(())
    } else {
        Err("Use 1 to 64 lowercase letters, digits, hyphens or underscores, starting with a letter or digit.".into())
    }
}

fn is_label(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 63
        && b[0].is_ascii_alphanumeric()
        && b[b.len() - 1].is_ascii_alphanumeric()
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-')
}

/// Host names, IPv4 addresses, and IPv6 addresses with or without brackets.
fn is_host(h: &str) -> bool {
    if let Some(inner) = h.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
        return !inner.is_empty() && inner.chars().all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.');
    }
    if h.contains(':') {
        let first = h.split(':').next().unwrap_or("");
        return first.chars().all(|c| c.is_ascii_hexdigit()) && h.chars().all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.');
    }
    !h.is_empty() && h.split('.').all(is_label)
}

/// More replicas than this is almost certainly a mistake, and each one holds a keychain item.
pub const MAX_READ_REPLICAS: usize = 16;

pub fn validate_profile(engine: Engine, env: &Environment, profile: &Profile) -> Vec<String> {
    let mut errs = match engine {
        Engine::Postgres => validate_postgres(profile),
        Engine::Mongodb => validate_mongodb(profile),
    };
    if env.production && !profile.read_only {
        errs.push("Production profiles always open read-only.".to_string());
    }
    errs
}

fn validate_postgres(profile: &Profile) -> Vec<String> {
    let mut errs = Vec::new();
    let writes: Vec<&Endpoint> = profile.endpoints(Role::Write).collect();
    let reads: Vec<&Endpoint> = profile.endpoints(Role::Read).collect();
    if profile.endpoints.is_empty() {
        errs.push("A profile needs a primary or at least one read replica.".to_string());
    }
    if writes.len() > 1 {
        errs.push("A profile can have only one primary (write) endpoint.".to_string());
    }
    if reads.len() > MAX_READ_REPLICAS {
        errs.push(format!("A profile can have at most {MAX_READ_REPLICAS} read replicas."));
    }
    for (i, e) in writes.iter().chain(reads.iter()).enumerate() {
        let tag = if e.role == Role::Write { "Primary".to_string() } else { format!("Read replica {}", i - writes.len() + 1) };
        let host = e.host.trim();
        if host.is_empty() {
            errs.push(format!("{tag}: host is empty."));
        } else if !is_host(host) {
            errs.push(format!("{tag}: \"{}\" is not a valid host name.", e.host));
        }
        if !(1..=65535).contains(&e.port) {
            errs.push(format!("{tag}: port must be between 1 and 65535."));
        }
        if e.database.trim().is_empty() {
            errs.push(format!("{tag}: database is empty."));
        }
        if e.user.trim().is_empty() {
            errs.push(format!("{tag}: user is empty."));
        }
    }
    let key = |e: &Endpoint| (e.host.trim().to_ascii_lowercase(), e.port, e.database.trim().to_string(), e.user.trim().to_string());
    if let Some(w) = writes.first() {
        if reads.iter().any(|r| key(r) == key(w)) {
            errs.push("A read replica is identical to the primary. Remove it or point it at the replica host.".to_string());
        }
    }
    errs
}

fn validate_mongodb(profile: &Profile) -> Vec<String> {
    let mut errs = Vec::new();
    if profile.endpoints.len() != 1 || profile.endpoints[0].role != Role::Write {
        errs.push("A MongoDB profile has exactly one connection string.".to_string());
        return errs;
    }
    let e = &profile.endpoints[0];
    let uri = e.uri.as_deref().unwrap_or("").trim();
    match uri.strip_prefix("mongodb://").or_else(|| uri.strip_prefix("mongodb+srv://")) {
        None => errs.push("The connection string must start with mongodb:// or mongodb+srv://.".to_string()),
        Some(rest) => {
            let authority = rest.split(['/', '?']).next().unwrap_or("");
            if let Some((userinfo, _)) = authority.rsplit_once('@') {
                if userinfo.contains(':') {
                    errs.push("Remove the password from the connection string. Berth Studio keeps it in the system keychain.".to_string());
                }
            }
            let hosts = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
            if hosts.is_empty() {
                errs.push("The connection string has no host.".to_string());
            }
        }
    }
    if let Some(src) = &e.auth_source {
        if !src.is_empty() && !src.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            errs.push("The authentication database name can only hold letters, digits, hyphens or underscores.".to_string());
        }
    }
    errs
}

/// Swaps whole environment words (`dev`, `development`, `stg`, `prod`, ...) in a host or name.
/// Returns the new value and how many words were swapped.
pub fn swap_env_token(s: &str, from: &Environment, to: &Environment) -> (String, usize) {
    if from.id == to.id {
        return (s.to_string(), 0);
    }
    let (f, t) = (from.words(), to.words());
    let mut out = s.to_string();
    let mut n = 0;
    let mut done: Vec<&str> = Vec::new();
    for k in 0..3 {
        if done.contains(&f[k]) {
            continue;
        }
        done.push(f[k]);
        let (value, count) = replace_word(&out, f[k], t[k]);
        out = value;
        n += count;
    }
    (out, n)
}

fn replace_word(s: &str, word: &str, with: &str) -> (String, usize) {
    let bytes = s.as_bytes();
    let w = word.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut n = 0;
    let mut i = 0;
    let mut last = 0;
    while i + w.len() <= bytes.len() {
        let before_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
        let after_ok = i + w.len() == bytes.len() || !bytes[i + w.len()].is_ascii_alphanumeric();
        if before_ok && after_ok && &bytes[i..i + w.len()] == w {
            out.push_str(&s[last..i]);
            out.push_str(with);
            i += w.len();
            last = i;
            n += 1;
        } else {
            i += 1;
        }
    }
    out.push_str(&s[last..]);
    (out, n)
}

/// Copies a profile to another environment: environment words are swapped in hosts, databases
/// and users, secrets are dropped, and a copy into production is read-only.
pub fn clone_profile(profile: &Profile, from: &Environment, to: &Environment) -> (Profile, usize) {
    let mut p = profile.clone();
    let mut replaced = 0;
    for e in &mut p.endpoints {
        for field in [&mut e.host, &mut e.database, &mut e.user] {
            let (v, n) = swap_env_token(field, from, to);
            *field = v;
            replaced += n;
        }
        if let Some(uri) = &mut e.uri {
            let (v, n) = swap_env_token(uri, from, to);
            *uri = v;
            replaced += n;
        }
        e.secret = None;
        e.needs_secret = true;
    }
    p.copied_from = Some(from.id.clone());
    if to.production {
        p.read_only = true;
    }
    (p, replaced)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::default_environments;

    fn env(id: &str) -> Environment {
        default_environments().into_iter().find(|e| e.id.as_str() == id).unwrap()
    }

    fn id(s: &str) -> EnvId {
        EnvId::new(s).unwrap()
    }

    fn ep(role: Role, host: &str, database: &str, user: &str) -> Endpoint {
        Endpoint {
            role,
            host: host.into(),
            port: 5432,
            database: database.into(),
            user: user.into(),
            uri: None,
            auth_source: None,
            tls: TlsMode::Auto,
            ca_cert: None,
            secret: Some(format!("keychain://berth-studio/acme-db/dev/{}", if role == Role::Write { "write" } else { "read" })),
            needs_secret: false,
        }
    }

    fn pg(read_only: bool) -> Profile {
        Profile {
            endpoints: vec![
                ep(Role::Write, "db-w.dev.acme.internal", "acme_dev_write", "app"),
                ep(Role::Read, "db-r.dev.acme.internal", "acme_dev_read", "app_ro"),
            ],
            read_only,
            auto_route: true,
            copied_from: None,
            read_preference: None,
        }
    }

    fn mongo(uri: &str) -> Profile {
        let mut e = ep(Role::Write, "", "", "app");
        e.uri = Some(uri.into());
        e.auth_source = Some("admin".into());
        Profile {
            endpoints: vec![e],
            read_only: false,
            auto_route: true,
            copied_from: None,
            read_preference: Some(ReadPreference::SecondaryPreferred),
        }
    }

    fn errs(env_id: &str, p: &Profile) -> String {
        validate_profile(Engine::Postgres, &env(env_id), p).join(" ")
    }

    #[test]
    fn endpoints_filter_by_role_and_profiles_may_be_missing() {
        let p = pg(false);
        assert_eq!(p.endpoints(Role::Write).map(|e| e.host.as_str()).collect::<Vec<_>>(), ["db-w.dev.acme.internal"]);
        assert_eq!(p.endpoints(Role::Read).map(|e| e.host.as_str()).collect::<Vec<_>>(), ["db-r.dev.acme.internal"]);
        let envs = default_environments();
        let mut c = Connection { id: "events-db".into(), engine: Engine::Postgres, profiles: BTreeMap::new() };
        assert!(c.profile(&id("dev")).is_none());
        assert_eq!(c.first_profile_env(&envs), None);
        c.profiles.insert(id("prod"), pg(true));
        c.profiles.insert(id("staging"), pg(false));
        assert_eq!(c.first_profile_env(&envs).map(EnvId::as_str), Some("staging"));
    }

    #[test]
    fn normalized_forces_read_only_in_production_environments() {
        let src = pg(false);
        assert!(src.normalized(&env("prod")).read_only);
        assert!(!src.normalized(&env("dev")).read_only);
        let mut eu = env("dev");
        eu.production = true;
        assert!(src.normalized(&eu).read_only, "any environment marked production");
        assert!(!src.read_only);
    }

    #[test]
    fn a_complete_profile_is_valid() {
        assert!(errs("dev", &pg(false)).is_empty());
    }

    #[test]
    fn a_profile_with_only_read_replicas_is_valid_and_cannot_write() {
        let mut ro = pg(false);
        ro.endpoints.retain(|e| e.role == Role::Read);
        assert!(errs("dev", &ro).is_empty());
        assert!(!ro.has_write() && ro.has_read());
        let empty = Profile { endpoints: vec![], ..pg(false) };
        assert!(errs("dev", &empty).contains("a primary or at least one read replica"));
    }

    #[test]
    fn allows_at_most_one_primary() {
        let mut two = pg(false);
        two.endpoints.push(ep(Role::Write, "other.acme.internal", "acme", "app"));
        assert!(errs("dev", &two).contains("only one primary"));
    }

    #[test]
    fn rejects_bad_ports_hosts_and_empty_fields() {
        for port in [0, 70000, -1] {
            let mut p = pg(false);
            p.endpoints[0].port = port;
            assert!(errs("dev", &p).contains("port must be between 1 and 65535"), "port {port}");
        }
        let mut h = pg(false);
        h.endpoints[1].host = "db_dev!.acme".into();
        assert!(errs("dev", &h).contains("Read replica 1: \"db_dev!.acme\" is not a valid host name"));
        let mut e = pg(false);
        e.endpoints[0].database = " ".into();
        e.endpoints[0].user = String::new();
        let all = errs("dev", &e);
        assert!(all.contains("database is empty") && all.contains("user is empty"));
    }

    #[test]
    fn accepts_ipv4_ipv6_and_localhost() {
        for host in ["127.0.0.1", "localhost", "[::1]", "::1", "fd00::5"] {
            let mut p = pg(false);
            p.endpoints[0].host = host.into();
            assert!(errs("dev", &p).is_empty(), "{host}");
        }
    }

    #[test]
    fn flags_a_replica_identical_to_the_primary() {
        let mut p = pg(false);
        p.endpoints[1] = Endpoint { role: Role::Read, host: "DB-W.dev.acme.internal".into(), ..p.endpoints[0].clone() };
        assert!(errs("dev", &p).contains("identical to the primary"));
    }

    #[test]
    fn caps_the_number_of_replicas() {
        let mut p = pg(false);
        for i in 0..MAX_READ_REPLICAS {
            p.endpoints.push(ep(Role::Read, &format!("db-r{i}.acme.internal"), "acme", "app_ro"));
        }
        assert!(errs("dev", &p).contains("at most 16 read replicas"));
    }

    #[test]
    fn production_must_stay_read_only() {
        assert!(errs("prod", &pg(false)).contains("always open read-only"));
        assert!(errs("prod", &pg(true)).is_empty());
    }

    #[test]
    fn mongodb_profiles_need_one_uri_without_a_password() {
        let v = |p: &Profile| validate_profile(Engine::Mongodb, &env("dev"), p).join(" ");
        assert!(v(&mongo("mongodb://127.0.0.1:27017/?replicaSet=rs0")).is_empty());
        assert!(v(&mongo("mongodb+srv://ro@cluster0.acme.net/events")).is_empty());
        assert!(v(&mongo("mongodb://ro:hunter2@cluster0.acme.net/db")).contains("Remove the password"));
        assert!(v(&mongo("postgres://x")).contains("must start with mongodb"));
        assert!(v(&mongo("mongodb:///db")).contains("no host"));
        let mut two = mongo("mongodb://a");
        two.endpoints.push(two.endpoints[0].clone());
        assert!(v(&two).contains("exactly one connection string"));
        let mut src = mongo("mongodb://a");
        src.endpoints[0].auth_source = Some("ad min".into());
        assert!(v(&src).contains("authentication database"));
    }

    #[test]
    fn connection_ids_are_safe_keychain_prefixes() {
        assert!(validate_connection_id("acme-db").is_ok());
        assert!(validate_connection_id("acme_db2").is_ok());
        for bad in ["", "-x", "Acme", "a/b", "a..b", &"x".repeat(65)] {
            assert!(validate_connection_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn swap_env_token_swaps_whole_words_only() {
        let (dev, stg, prod) = (env("dev"), env("staging"), env("prod"));
        assert_eq!(swap_env_token("db.dev.acme.internal", &dev, &stg), ("db.staging.acme.internal".into(), 1));
        assert_eq!(swap_env_token("acme_dev_write", &dev, &stg).0, "acme_staging_write");
        assert_eq!(swap_env_token("devices.acme.io", &dev, &prod).0, "devices.acme.io");
        assert_eq!(swap_env_token("devops-db", &dev, &prod).0, "devops-db");
        assert_eq!(swap_env_token("db.staging.acme.io", &stg, &dev).0, "db.dev.acme.io");
        assert_eq!(swap_env_token("api-stg-1.acme.io", &stg, &prod).0, "api-prd-1.acme.io");
        assert_eq!(swap_env_token("production-db", &prod, &dev).0, "development-db");
        assert_eq!(swap_env_token("db.dev.io", &dev, &dev), ("db.dev.io".into(), 0));
    }

    #[test]
    fn swap_env_token_works_with_custom_environments() {
        let mut qa = env("dev");
        qa.id = id("qa");
        qa.long_name = Some("quality".into());
        qa.short_name = None;
        let mut local = env("dev");
        local.id = id("local");
        local.long_name = None;
        assert_eq!(swap_env_token("db.qa.acme.io", &qa, &local).0, "db.local.acme.io");
        assert_eq!(swap_env_token("quality-db", &qa, &env("prod")).0, "production-db");
    }

    #[test]
    fn clone_profile_renames_drops_secrets_and_keeps_the_source() {
        let src = pg(false);
        let (p, replaced) = clone_profile(&src, &env("dev"), &env("staging"));
        assert_eq!(replaced, 4);
        assert_eq!(
            p.endpoints.iter().map(|e| e.host.as_str()).collect::<Vec<_>>(),
            ["db-w.staging.acme.internal", "db-r.staging.acme.internal"]
        );
        assert_eq!(p.endpoints.iter().map(|e| e.database.as_str()).collect::<Vec<_>>(), ["acme_staging_write", "acme_staging_read"]);
        assert!(p.endpoints.iter().all(|e| e.secret.is_none() && e.needs_secret));
        assert_eq!(p.copied_from, Some(id("dev")));
        assert_eq!(src.endpoints[0].secret.as_deref(), Some("keychain://berth-studio/acme-db/dev/write"));
        assert!(clone_profile(&src, &env("dev"), &env("prod")).0.read_only);
        let (m, n) = clone_profile(&mongo("mongodb://mongo.dev.acme.io/events"), &env("dev"), &env("prod"));
        assert_eq!((m.endpoints[0].uri.as_deref(), n), (Some("mongodb://mongo.prod.acme.io/events"), 1));
    }

    #[test]
    fn workspace_json_round_trips_without_secrets() {
        let mut c = Connection { id: "acme-db".into(), engine: Engine::Postgres, profiles: BTreeMap::new() };
        c.profiles.insert(id("dev"), pg(false));
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("\"readOnly\":false") && json.contains("\"dev\"") && !json.contains("\"uri\""));
        let back: Connection = serde_json::from_str(&json).unwrap();
        assert_eq!(back, c);
        let bad = json.replace("\"dev\":", "\"../x\":");
        assert!(serde_json::from_str::<Connection>(&bad).is_err(), "environment ids are validated on load");
    }
}
