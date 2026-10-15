//! Environments are defined by the workspace, not by Berth Studio. A team may have only `local`
//! and `prod`, or add `qa` and `uat`, or run several production regions. Every connection has
//! at most one profile per environment.

use serde::{Deserialize, Serialize};
use std::fmt;

/// An environment id such as `dev` or `prod-eu`. Ids are part of keychain account names, so they
/// keep to a small, safe alphabet.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct EnvId(String);

pub const MAX_ENV_ID: usize = 24;

impl EnvId {
    pub fn new(id: &str) -> Result<EnvId, String> {
        let ok = !id.is_empty()
            && id.len() <= MAX_ENV_ID
            && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
            && id.chars().next().is_some_and(|c| c.is_ascii_lowercase());
        if ok {
            Ok(EnvId(id.to_string()))
        } else {
            Err(format!(
                "\"{id}\" is not a valid environment id. Use 1 to {MAX_ENV_ID} lowercase letters, digits, hyphens or underscores, starting with a letter."
            ))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for EnvId {
    type Error = String;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        EnvId::new(&s)
    }
}

impl From<EnvId> for String {
    fn from(e: EnvId) -> String {
        e.0
    }
}

impl fmt::Display for EnvId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub id: EnvId,
    /// Shown in the switcher, for example "Staging" or "Prod (EU)".
    pub label: String,
    /// A `#rrggbb` colour for the environment dot.
    pub color: String,
    /// Production profiles always open read-only, and writes need the connection name typed.
    #[serde(default)]
    pub production: bool,
    /// How this environment is also written in host and database names, for example
    /// `development` for `dev`. Used when a profile is copied between environments.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub long_name: Option<String>,
    /// A short form, for example `stg` for `staging` or `prd` for `prod`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_name: Option<String>,
}

impl Environment {
    fn new(id: &str, label: &str, color: &str, production: bool, long_name: Option<&str>, short_name: Option<&str>) -> Environment {
        Environment {
            id: EnvId::new(id).expect("built-in environment ids are valid"),
            label: label.into(),
            color: color.into(),
            production,
            long_name: long_name.map(Into::into),
            short_name: short_name.map(Into::into),
        }
    }

    /// The words that name this environment in host and database names: id, long form, short
    /// form. A missing form falls back to the id, so words line up by position across environments.
    pub fn words(&self) -> [&str; 3] {
        let id = self.id.as_str();
        [id, self.long_name.as_deref().unwrap_or(id), self.short_name.as_deref().unwrap_or(id)]
    }
}

/// The environments a new workspace starts with.
pub fn default_environments() -> Vec<Environment> {
    vec![
        Environment::new("dev", "dev", "#1E8E50", false, Some("development"), None),
        Environment::new("staging", "staging", "#B26A00", false, None, Some("stg")),
        Environment::new("prod", "prod", "#C8372F", true, Some("production"), Some("prd")),
    ]
}

pub const MAX_ENVIRONMENTS: usize = 16;

fn is_word(s: &str) -> bool {
    !s.is_empty() && s.len() <= 32 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn validate_environments(envs: &[Environment]) -> Vec<String> {
    let mut errs = Vec::new();
    if envs.is_empty() || envs.len() > MAX_ENVIRONMENTS {
        errs.push(format!("A workspace needs between 1 and {MAX_ENVIRONMENTS} environments."));
    }
    for (i, e) in envs.iter().enumerate() {
        if envs[..i].iter().any(|o| o.id == e.id) {
            errs.push(format!("The environment id {} is used twice.", e.id));
        }
        let label = e.label.trim();
        if label.is_empty() || label.chars().count() > 32 {
            errs.push(format!("{}: the label must be 1 to 32 characters.", e.id));
        }
        let c = e.color.as_bytes();
        if !(c.len() == 7 && c[0] == b'#' && c[1..].iter().all(u8::is_ascii_hexdigit)) {
            errs.push(format!("{}: the colour must look like #1E8E50.", e.id));
        }
        for w in [&e.long_name, &e.short_name].into_iter().flatten() {
            if !is_word(w) {
                errs.push(format!("{}: \"{w}\" can only hold letters, digits, hyphens or underscores.", e.id));
            }
        }
    }
    errs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_safe_keychain_segments() {
        for ok in ["dev", "prod-eu", "qa_2", "local"] {
            assert!(EnvId::new(ok).is_ok(), "{ok}");
        }
        for bad in ["", "Dev", "1st", "a/b", "../x", "dev env", &"x".repeat(25)] {
            assert!(EnvId::new(bad).is_err(), "{bad}");
        }
        assert!(serde_json::from_str::<EnvId>("\"../evil\"").is_err());
        assert_eq!(serde_json::from_str::<EnvId>("\"dev\"").unwrap().as_str(), "dev");
    }

    #[test]
    fn the_defaults_are_valid_and_only_prod_is_production() {
        let d = default_environments();
        assert!(validate_environments(&d).is_empty());
        assert_eq!(d.iter().filter(|e| e.production).map(|e| e.id.as_str()).collect::<Vec<_>>(), ["prod"]);
        assert_eq!(d[1].words(), ["staging", "staging", "stg"]);
    }

    #[test]
    fn custom_lists_are_checked() {
        let mut d = default_environments();
        d.push(d[0].clone());
        d[1].color = "teal".into();
        d[2].label = " ".into();
        d[2].short_name = Some("p rd".into());
        let errs = validate_environments(&d).join(" ");
        assert!(errs.contains("used twice") && errs.contains("colour") && errs.contains("label") && errs.contains("\"p rd\""), "{errs}");
        assert!(!validate_environments(&[]).is_empty());
    }
}
