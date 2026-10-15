//! Pure logic shared by the Berth Studio app: connections with one profile per environment,
//! read/write endpoints, and the SQL classifier that decides where a statement may run.
//!
//! This is a port of the `berth-core` block in `design/prototype.html`; the tests mirror
//! `design/tests/core.test.mjs` so both stay in step.

pub mod env;
pub mod profile;
pub mod sql;

pub use env::{default_environments, validate_environments, EnvId, Environment};
pub use profile::{clone_profile, swap_env_token, validate_profile, Connection, Endpoint, Engine, Profile, ReadPreference, Role, TlsMode};
pub use sql::{classify, route, strip, Classification, Kind, Route, RouteMode, RouteOptions};

/// Checks a request to write in production. Prod profiles open read-only, and a write runs only
/// after the user typed the connection name. The check lives here so the Rust side enforces it,
/// whatever the webview sends.
pub fn check_prod_write(env: &Environment, kind: Kind, connection_id: &str, typed: Option<&str>) -> Result<(), String> {
    if !env.production || kind != Kind::Write {
        return Ok(());
    }
    match typed {
        Some(t) if t.trim() == connection_id => Ok(()),
        Some(_) => Err(format!("The name does not match. Type {connection_id} to write to production.")),
        None => Err(format!("Writing to production needs confirmation. Type {connection_id} to continue.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_writes_need_the_exact_connection_name() {
        let envs = default_environments();
        let (dev, prod) = (&envs[0], &envs[2]);
        assert!(check_prod_write(dev, Kind::Write, "acme-db", None).is_ok());
        assert!(check_prod_write(prod, Kind::Read, "acme-db", None).is_ok());
        assert!(check_prod_write(prod, Kind::Write, "acme-db", None).is_err());
        assert!(check_prod_write(prod, Kind::Write, "acme-db", Some("acme")).is_err());
        assert!(check_prod_write(prod, Kind::Write, "acme-db", Some(" acme-db ")).is_ok());
        let mut eu = dev.clone();
        eu.production = true;
        assert!(check_prod_write(&eu, Kind::Write, "acme-db", None).is_err(), "any production environment");
    }
}
