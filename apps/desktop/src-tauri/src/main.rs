// Berth Studio desktop app. The commands below are thin wrappers around `app::App`;
// each one must also be listed in build.rs and allowed in capabilities/main.json.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod export;
mod history;
mod update;
mod workspace;

use app::{App, DocumentWrite, EditOutcome, EndpointCheck, MongoOverview, Page, PasswordInput, RunResult, WriteOutcome};
use berth_core::{Connection, Engine, EnvId, Environment, Profile, RouteMode};
use berth_mongo::{CollectionInfo, Documents, FindRequest};
use berth_postgres::{BrowseRequest, DbError, EditPlan, EditPreview, RowCount, SchemaColumn, Table, TableInfo, TableStructure};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use update::{Pending, Progress, UpdateInfo};
use workspace::SavedQuery;

#[tauri::command]
async fn list_environments(app: State<'_, App>) -> Result<Vec<Environment>, DbError> {
    Ok(app.environments().await)
}

#[tauri::command]
async fn save_environments(app: State<'_, App>, environments: Vec<Environment>, confirm_delete: bool) -> Result<Vec<Environment>, DbError> {
    app.save_environments(environments, confirm_delete).await
}

#[tauri::command]
async fn list_connections(app: State<'_, App>) -> Result<Vec<Connection>, DbError> {
    Ok(app.connections().await)
}

#[tauri::command]
async fn save_connection(app: State<'_, App>, connection: Connection, passwords: Vec<PasswordInput>) -> Result<Connection, DbError> {
    app.save_connection(connection, passwords).await
}

#[tauri::command]
async fn delete_connection(app: State<'_, App>, id: String) -> Result<(), DbError> {
    app.delete_connection(&id).await
}

#[tauri::command]
async fn test_profile(
    app: State<'_, App>,
    id: String,
    engine: Engine,
    env: EnvId,
    profile: Profile,
    passwords: Vec<PasswordInput>,
) -> Result<Vec<EndpointCheck>, DbError> {
    app.test_profile(&id, engine, &env, profile, passwords).await
}

#[tauri::command]
async fn list_tables(app: State<'_, App>, id: String, env: EnvId) -> Result<Vec<Table>, DbError> {
    app.list_tables(&id, &env).await
}

#[tauri::command]
async fn browse_table(
    app: State<'_, App>,
    id: String,
    env: EnvId,
    schema: String,
    table: String,
    request: BrowseRequest,
) -> Result<Page, DbError> {
    app.browse_table(&id, &env, &schema, &table, &request).await
}

#[tauri::command]
async fn describe_table(app: State<'_, App>, id: String, env: EnvId, schema: String, table: String) -> Result<TableInfo, DbError> {
    app.describe_table(&id, &env, &schema, &table).await
}

#[tauri::command]
async fn table_structure(app: State<'_, App>, id: String, env: EnvId, schema: String, table: String) -> Result<TableStructure, DbError> {
    app.table_structure(&id, &env, &schema, &table).await
}

#[tauri::command]
async fn schema_columns(app: State<'_, App>, id: String, env: EnvId) -> Result<Vec<SchemaColumn>, DbError> {
    app.schema_columns(&id, &env).await
}

#[tauri::command]
async fn preview_edits(
    app: State<'_, App>,
    id: String,
    env: EnvId,
    schema: String,
    table: String,
    plan: EditPlan,
) -> Result<EditPreview, DbError> {
    app.preview_edits(&id, &env, &schema, &table, &plan).await
}

#[tauri::command]
async fn commit_edits(
    app: State<'_, App>,
    id: String,
    env: EnvId,
    schema: String,
    table: String,
    plan: EditPlan,
    confirm: Option<String>,
) -> Result<EditOutcome, DbError> {
    app.commit_edits(&id, &env, &schema, &table, &plan, confirm.as_deref()).await
}

#[tauri::command]
async fn count_rows(
    app: State<'_, App>,
    id: String,
    env: EnvId,
    schema: String,
    table: String,
    request: BrowseRequest,
) -> Result<RowCount, DbError> {
    app.count_rows(&id, &env, &schema, &table, &request).await
}

#[tauri::command]
async fn run_query(
    app: State<'_, App>,
    id: String,
    env: EnvId,
    sql: String,
    mode: RouteMode,
    confirm: Option<String>,
    run_id: String,
) -> Result<RunResult, DbError> {
    app.run_query(&id, &env, &sql, mode, confirm.as_deref(), &run_id).await
}

#[tauri::command]
async fn cancel_query(app: State<'_, App>, run_id: String) -> Result<bool, DbError> {
    app.cancel_query(&run_id).await
}

#[tauri::command]
async fn list_saved_queries(app: State<'_, App>) -> Result<Vec<SavedQuery>, DbError> {
    Ok(app.saved_queries().await)
}

#[tauri::command]
async fn save_query(app: State<'_, App>, query: SavedQuery) -> Result<SavedQuery, DbError> {
    app.save_query(query).await
}

#[tauri::command]
async fn delete_saved_query(app: State<'_, App>, id: String) -> Result<(), DbError> {
    app.delete_saved_query(&id).await
}

#[tauri::command]
fn list_history(app: State<'_, App>, conn: Option<String>, query: Option<String>, limit: usize) -> Result<Vec<history::Entry>, DbError> {
    app.history(conn.as_deref(), query.as_deref(), limit)
}

#[tauri::command]
fn clear_history(app: State<'_, App>, conn: Option<String>) -> Result<(), DbError> {
    app.clear_history(conn.as_deref())
}

#[tauri::command]
async fn mongo_overview(app: State<'_, App>, id: String, env: EnvId) -> Result<MongoOverview, DbError> {
    app.mongo_overview(&id, &env).await
}

#[tauri::command]
async fn list_collections(app: State<'_, App>, id: String, env: EnvId, db: String) -> Result<Vec<CollectionInfo>, DbError> {
    app.list_collections(&id, &env, &db).await
}

#[tauri::command]
async fn find_documents(
    app: State<'_, App>,
    id: String,
    env: EnvId,
    db: String,
    collection: String,
    request: FindRequest,
) -> Result<Documents, DbError> {
    app.find_documents(&id, &env, &db, &collection, request).await
}

#[tauri::command]
async fn aggregate(
    app: State<'_, App>,
    id: String,
    env: EnvId,
    db: String,
    collection: String,
    pipeline: String,
    confirm: Option<String>,
) -> Result<Documents, DbError> {
    app.aggregate(&id, &env, &db, &collection, &pipeline, confirm.as_deref()).await
}

#[tauri::command]
async fn list_indexes(
    app: State<'_, App>,
    id: String,
    env: EnvId,
    db: String,
    collection: String,
) -> Result<Vec<serde_json::Value>, DbError> {
    app.list_indexes(&id, &env, &db, &collection).await
}

#[tauri::command]
async fn write_document(
    app: State<'_, App>,
    id: String,
    env: EnvId,
    db: String,
    collection: String,
    change: DocumentWrite,
    confirm: Option<String>,
) -> Result<WriteOutcome, DbError> {
    app.write_document(&id, &env, &db, &collection, change, confirm.as_deref()).await
}

#[tauri::command]
async fn check_update(app: AppHandle, pending: State<'_, Pending>) -> Result<Option<UpdateInfo>, DbError> {
    update::check(&app, &pending).await
}

#[tauri::command]
async fn install_update(pending: State<'_, Pending>, on_progress: Channel<Progress>) -> Result<(), DbError> {
    update::install(&pending, on_progress).await
}

/// Asks where to save an export and writes it there; `None` when the user cancelled.
#[tauri::command]
async fn save_export(app: AppHandle, suggested_name: String, contents: String) -> Result<Option<String>, DbError> {
    export::save(&app, &suggested_name, &contents).await
}

/// Restarts into the version that `install_update` put in place.
#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(Pending::default())
        .setup(|handle| {
            let dir = handle.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
            }
            let secrets = berth_secrets::KeychainStore::new()?;
            let app = App::new(dir.join("workspace.json"), Box::new(secrets))?;
            handle.manage(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_environments,
            save_environments,
            list_connections,
            save_connection,
            delete_connection,
            test_profile,
            list_tables,
            browse_table,
            count_rows,
            describe_table,
            table_structure,
            schema_columns,
            preview_edits,
            commit_edits,
            run_query,
            cancel_query,
            list_saved_queries,
            save_query,
            delete_saved_query,
            list_history,
            clear_history,
            mongo_overview,
            list_collections,
            find_documents,
            aggregate,
            list_indexes,
            write_document,
            save_export,
            check_update,
            install_update,
            restart_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Berth Studio");
}
