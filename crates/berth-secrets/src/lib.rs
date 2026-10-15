//! Secrets live in the operating system's secret store (macOS Keychain today; Windows Credential
//! Manager and the Linux Secret Service later). Workspace files only hold a reference such as
//! `keychain://berth-studio/acme-db/dev/write-0`, and the webview never receives a secret.

use std::collections::HashMap;
use std::sync::Mutex;
use zeroize::Zeroizing;

/// The keychain "service" every Berth Studio secret is filed under.
pub const SERVICE: &str = "berth-studio";

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("the secret store is not available: {0}")]
    Unavailable(String),
    #[error("the secret store refused the request: {0}")]
    Store(String),
    #[error("{0} is not a valid secret reference")]
    BadReference(String),
}

/// A password that is wiped from memory when dropped.
pub type Secret = Zeroizing<String>;

pub trait SecretStore: Send + Sync {
    fn set(&self, account: &str, secret: &str) -> Result<(), SecretError>;
    /// `Ok(None)` when nothing is stored for this account.
    fn get(&self, account: &str) -> Result<Option<Secret>, SecretError>;
    /// Deleting something that is not there is not an error.
    fn delete(&self, account: &str) -> Result<(), SecretError>;
}

/// The account for one endpoint: `<connection>/<env>/<role>-<index>`.
pub fn account(connection: &str, env: &str, role: &str, index: usize) -> String {
    format!("{connection}/{env}/{role}-{index}")
}

pub fn reference(account: &str) -> String {
    format!("keychain://{SERVICE}/{account}")
}

/// The account inside a `keychain://berth-studio/...` reference. Anything else is rejected, so a
/// workspace file cannot point the app at another program's keychain item.
pub fn account_of(reference: &str) -> Result<&str, SecretError> {
    let bad = || SecretError::BadReference(reference.to_string());
    let rest = reference.strip_prefix("keychain://").ok_or_else(bad)?;
    let account = rest.strip_prefix(SERVICE).and_then(|r| r.strip_prefix('/')).ok_or_else(bad)?;
    let ok = !account.is_empty()
        && account.split('/').count() == 3
        && account.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '/'))
        && !account.split('/').any(|p| p.is_empty() || p == "." || p == "..");
    if ok {
        Ok(account)
    } else {
        Err(bad())
    }
}

/// The real store: the user's login keychain.
#[cfg(target_os = "macos")]
pub struct KeychainStore(());

#[cfg(target_os = "macos")]
impl KeychainStore {
    pub fn new() -> Result<Self, SecretError> {
        let store = apple_native_keyring_store::keychain::Store::new().map_err(|e| SecretError::Unavailable(e.to_string()))?;
        keyring_core::set_default_store(store);
        Ok(Self(()))
    }

    fn entry(account: &str) -> Result<keyring_core::Entry, SecretError> {
        keyring_core::Entry::new(SERVICE, account).map_err(|e| SecretError::Store(e.to_string()))
    }
}

#[cfg(target_os = "macos")]
impl SecretStore for KeychainStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), SecretError> {
        Self::entry(account)?.set_password(secret).map_err(|e| SecretError::Store(e.to_string()))
    }

    fn get(&self, account: &str) -> Result<Option<Secret>, SecretError> {
        match Self::entry(account)?.get_password() {
            Ok(p) => Ok(Some(Zeroizing::new(p))),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(e) => Err(SecretError::Store(e.to_string())),
        }
    }

    fn delete(&self, account: &str) -> Result<(), SecretError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(e) => Err(SecretError::Store(e.to_string())),
        }
    }
}

/// An in-memory store for tests, so they never touch or prompt for the real keychain.
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, Secret>>);

impl SecretStore for MemoryStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), SecretError> {
        self.0.lock().map_err(|_| SecretError::Unavailable("poisoned".into()))?.insert(account.into(), Zeroizing::new(secret.into()));
        Ok(())
    }

    fn get(&self, account: &str) -> Result<Option<Secret>, SecretError> {
        Ok(self.0.lock().map_err(|_| SecretError::Unavailable("poisoned".into()))?.get(account).cloned())
    }

    fn delete(&self, account: &str) -> Result<(), SecretError> {
        self.0.lock().map_err(|_| SecretError::Unavailable("poisoned".into()))?.remove(account);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references_round_trip_and_reject_foreign_items() {
        let a = account("acme-db", "dev", "write", 0);
        assert_eq!(a, "acme-db/dev/write-0");
        assert_eq!(account_of(&reference(&a)).unwrap(), a);
        for bad in [
            "keychain://other-app/acme-db/dev/write-0",
            "keychain://berth-studio/../x/y",
            "keychain://berth-studio/acme-db/dev",
            "keychain://berth-studioX/acme-db/dev/write-0",
            "file:///etc/passwd",
            "keychain://berth-studio/a b/dev/write-0",
        ] {
            assert!(account_of(bad).is_err(), "{bad}");
        }
    }

    /// Touches the real login keychain, so it only runs on request:
    ///     cargo test -p berth-secrets -- --ignored
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn keychain_round_trip() {
        let k = KeychainStore::new().unwrap();
        let acct = format!("test-{}/dev/write-0", std::process::id());
        k.set(&acct, "berth-keychain-test").unwrap();
        assert_eq!(k.get(&acct).unwrap().unwrap().as_str(), "berth-keychain-test");
        k.delete(&acct).unwrap();
        assert!(k.get(&acct).unwrap().is_none());
    }

    #[test]
    fn memory_store_sets_gets_and_deletes() {
        let s = MemoryStore::default();
        assert!(s.get("a/dev/write-0").unwrap().is_none());
        s.set("a/dev/write-0", "hunter2").unwrap();
        assert_eq!(s.get("a/dev/write-0").unwrap().unwrap().as_str(), "hunter2");
        s.delete("a/dev/write-0").unwrap();
        s.delete("a/dev/write-0").unwrap();
        assert!(s.get("a/dev/write-0").unwrap().is_none());
    }
}
