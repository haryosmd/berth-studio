// In-app updates through tauri-plugin-updater.
//
// The webview never talks to the plugin directly: its own commands are not allowed in
// capabilities/main.json. These three commands are the whole surface. The plugin downloads
// `latest.json` from the GitHub release, refuses any package whose minisign signature does not
// match the public key in tauri.conf.json, and, with `requireSignedVersion`, refuses a package
// signed for a different version than the one announced, so an old release cannot be replayed.

use berth_postgres::DbError;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

/// The update found by the last check, kept so that installing it needs no second request and
/// installs exactly what the user was shown.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub version: String,
    /// RFC 3339, as published in `latest.json`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    /// Release notes as plain text. The interface never renders them as HTML.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event")]
pub enum Progress {
    Started { total: Option<u64> },
    Chunk { downloaded: u64 },
    Installed,
}

fn error(e: tauri_plugin_updater::Error) -> DbError {
    DbError::msg(format!("Could not update Berth Studio: {e}"))
}

pub fn info(update: &Update) -> UpdateInfo {
    UpdateInfo {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update.raw_json.get("pub_date").and_then(|d| d.as_str()).map(str::to_string),
        notes: update.body.clone().filter(|n| !n.trim().is_empty()),
    }
}

/// Asks the release endpoint for a newer version. `None` means the app is up to date.
pub async fn check<R: Runtime>(app: &AppHandle<R>, pending: &Pending) -> Result<Option<UpdateInfo>, DbError> {
    let update = app.updater().map_err(error)?.check().await.map_err(error)?;
    let found = update.as_ref().map(info);
    *pending.0.lock().await = update;
    Ok(found)
}

/// Downloads, verifies and installs the update from the last check, reporting progress. The new
/// version runs after a restart.
pub async fn install(pending: &Pending, progress: Channel<Progress>) -> Result<(), DbError> {
    let Some(update) = pending.0.lock().await.take() else {
        return Err(DbError::msg("There is no update to install. Check for updates first."));
    };
    let mut downloaded = 0u64;
    let mut started = false;
    let result = update
        .download_and_install(
            |chunk, total| {
                if !started {
                    started = true;
                    let _ = progress.send(Progress::Started { total });
                }
                downloaded += chunk as u64;
                let _ = progress.send(Progress::Chunk { downloaded });
            },
            || {},
        )
        .await;
    if let Err(e) = result {
        // Keep the update so the user can try again without checking first.
        *pending.0.lock().await = Some(update);
        return Err(error(e));
    }
    let _ = progress.send(Progress::Installed);
    Ok(())
}
