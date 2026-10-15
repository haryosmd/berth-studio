//! The workspace file: environments, connections and their profiles, never secrets.
//! It lives in the app data folder as `workspace.json`, readable by the user only.
//! Version 1 files had no environment list; they load with the default dev, staging and prod.

use berth_core::{default_environments, validate_environments, Connection, Environment};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const VERSION: u32 = 2;

#[derive(Debug, Serialize, Deserialize)]
pub struct Workspace {
    #[serde(default = "version")]
    pub version: u32,
    #[serde(default = "default_environments")]
    pub environments: Vec<Environment>,
    #[serde(default)]
    pub connections: Vec<Connection>,
}

fn version() -> u32 {
    1
}

impl Default for Workspace {
    fn default() -> Self {
        Workspace { version: VERSION, environments: default_environments(), connections: Vec::new() }
    }
}

pub fn load(path: &Path) -> Result<Workspace, String> {
    let mut ws: Workspace = match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("{} could not be read: {e}", path.display()))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Workspace::default()),
        Err(e) => return Err(format!("{} could not be opened: {e}", path.display())),
    };
    let problems = validate_environments(&ws.environments);
    if !problems.is_empty() {
        return Err(format!("{} has invalid environments: {}", path.display(), problems.join(" ")));
    }
    ws.version = VERSION;
    Ok(ws)
}

/// Writes to a temporary file first and renames it, so a crash never leaves half a workspace.
pub fn save(path: &Path, ws: &Workspace) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(ws).map_err(|e| e.to_string())?;
    let tmp: PathBuf = path.with_extension("json.tmp");
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&tmp).map_err(|e| format!("{} could not be written: {e}", tmp.display()))?;
    f.write_all(&json).and_then(|_| f.sync_all()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| format!("{} could not be saved: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_atomically_with_private_permissions_and_loads_back() {
        let dir = std::env::temp_dir().join(format!("berth-ws-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("workspace.json");
        assert!(load(&path).unwrap().connections.is_empty());
        assert_eq!(load(&path).unwrap().environments.len(), 3);
        let ws: Workspace = serde_json::from_str(
            r#"{"connections":[{"id":"acme-db","engine":"postgres","profiles":{"dev":{"endpoints":[
               {"role":"write","host":"localhost","port":5432,"database":"acme","user":"app","secret":"keychain://berth-studio/acme-db/dev/write-0"}]}}}]}"#,
        )
        .unwrap();
        save(&path, &ws).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let back = load(&path).unwrap();
        assert_eq!(back.connections[0].id, "acme-db");
        assert_eq!((back.version, back.environments.len()), (VERSION, 3), "a version 1 file gets the default environments");
        let mut json: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        json["environments"] = serde_json::json!([]);
        fs::write(&path, json.to_string()).unwrap();
        assert!(load(&path).unwrap_err().contains("invalid environments"));
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
