//! Saving an export. The webview hands over the contents and a suggested file name, never a path:
//! the user picks the place in the native Save dialog, and only the path that dialog returns is
//! written, through a temporary file and a rename so a failed write leaves nothing half-done.

use berth_postgres::DbError;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

pub const MAX_EXPORT_BYTES: usize = 64 << 20;

/// The suggested name with anything that could name another folder taken out.
pub fn safe_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("").trim().trim_start_matches('.');
    if base.is_empty() {
        "export".into()
    } else {
        base.chars().take(120).collect()
    }
}

pub fn write_private(path: &Path, contents: &[u8]) -> Result<(), String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("export");
    let tmp: PathBuf = path.with_file_name(format!(".{name}.berth-tmp"));
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&tmp).map_err(|e| format!("{} could not be written: {e}", path.display()))?;
    if let Err(e) = f.write_all(contents).and_then(|_| f.sync_all()) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("{} could not be written: {e}", path.display()));
    }
    fs::rename(&tmp, path).map_err(|e| format!("{} could not be saved: {e}", path.display()))
}

/// Shows the Save dialog and writes `contents` where the user chose. `None` when they cancelled.
pub async fn save(handle: &AppHandle, suggested_name: &str, contents: &str) -> Result<Option<String>, DbError> {
    if contents.len() > MAX_EXPORT_BYTES {
        return Err(DbError::msg(format!("An export can be at most {} MiB.", MAX_EXPORT_BYTES >> 20)));
    }
    let name = safe_name(suggested_name);
    let mut dialog = handle.dialog().file().set_file_name(&name);
    if let Some((_, ext)) = name.rsplit_once('.').filter(|(_, e)| matches!(*e, "csv" | "json")) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    if let Some(window) = handle.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.save_file(move |path| {
        let _ = tx.send(path);
    });
    let Some(path) = rx.await.map_err(|_| DbError::msg("The Save dialog closed unexpectedly."))? else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| DbError::msg(e.to_string()))?;
    write_private(&path, contents.as_bytes()).map_err(DbError::msg)?;
    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_suggested_name_cannot_point_elsewhere() {
        assert_eq!(safe_name("users.csv"), "users.csv");
        assert_eq!(safe_name("../../.ssh/authorized_keys"), "authorized_keys");
        assert_eq!(safe_name("..\\evil.json"), "evil.json");
        assert_eq!(safe_name(".hidden"), "hidden");
        assert_eq!(safe_name("  "), "export");
    }

    #[test]
    fn writes_privately_and_replaces_atomically() {
        let dir = std::env::temp_dir().join(format!("berth-export-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("users.csv");
        write_private(&path, b"old").unwrap();
        write_private(&path, b"id,email\r\n1,a@b\r\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "id,email\r\n1,a@b\r\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "no temporary file is left behind");
        fs::remove_dir_all(dir).unwrap();
    }
}
