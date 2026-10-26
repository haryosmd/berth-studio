// The only place the interface talks to the Rust side. Every call is one of the commands allowed in
// src-tauri/capabilities/main.json. In a plain browser (design review), a mock with sample data
// stands in; it is only loaded in development builds.
import type {
  BrowseRequest, CollectionInfo, Connection, DocumentWrite, Documents, EditOutcome, EditPlan, EditPreview, EndpointCheck, Engine, EnvId, Environment, FindRequest,
  HistoryEntry, MongoOverview, Page, PasswordInput, Profile, RouteMode, RowCount, RunResult, SavedQuery, SchemaColumn, Table, TableInfo, TableStructure, UpdateInfo, UpdateProgress,
} from './types';

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let impl: Promise<Invoke> | null = null;
function backend(): Promise<Invoke> {
  if (!impl) {
    impl = '__TAURI_INTERNALS__' in window
      ? import('@tauri-apps/api/core').then(m => m.invoke as Invoke)
      : import.meta.env.DEV
        ? import('./mock').then(m => m.invoke as Invoke)
        : Promise.reject(new Error('Berth Studio must run inside its desktop app.'));
  }
  return impl;
}
const call = async <T>(cmd: string, args?: Record<string, unknown>) => (await backend())<T>(cmd, args);

export const api = {
  listEnvironments: () => call<Environment[]>('list_environments'),
  saveEnvironments: (environments: Environment[], confirmDelete: boolean) =>
    call<Environment[]>('save_environments', { environments, confirmDelete }),

  listConnections: () => call<Connection[]>('list_connections'),
  saveConnection: (connection: Connection, passwords: PasswordInput[]) => call<Connection>('save_connection', { connection, passwords }),
  deleteConnection: (id: string) => call<void>('delete_connection', { id }),
  testProfile: (id: string, engine: Engine, env: EnvId, profile: Profile, passwords: PasswordInput[]) =>
    call<EndpointCheck[]>('test_profile', { id, engine, env, profile, passwords }),

  listTables: (id: string, env: EnvId) => call<Table[]>('list_tables', { id, env }),
  browseTable: (id: string, env: EnvId, schema: string, table: string, request: BrowseRequest) =>
    call<Page>('browse_table', { id, env, schema, table, request }),
  countRows: (id: string, env: EnvId, schema: string, table: string, request: BrowseRequest) =>
    call<RowCount>('count_rows', { id, env, schema, table, request }),
  describeTable: (id: string, env: EnvId, schema: string, table: string) => call<TableInfo>('describe_table', { id, env, schema, table }),
  tableStructure: (id: string, env: EnvId, schema: string, table: string) => call<TableStructure>('table_structure', { id, env, schema, table }),
  schemaColumns: (id: string, env: EnvId) => call<SchemaColumn[]>('schema_columns', { id, env }),
  previewEdits: (id: string, env: EnvId, schema: string, table: string, plan: EditPlan) =>
    call<EditPreview>('preview_edits', { id, env, schema, table, plan }),
  commitEdits: (id: string, env: EnvId, schema: string, table: string, plan: EditPlan, confirm: string | null) =>
    call<EditOutcome>('commit_edits', { id, env, schema, table, plan, confirm }),
  runQuery: (id: string, env: EnvId, sql: string, mode: RouteMode, confirm: string | null, runId: string) =>
    call<RunResult>('run_query', { id, env, sql, mode, confirm, runId }),
  cancelQuery: (runId: string) => call<boolean>('cancel_query', { runId }),

  listSavedQueries: () => call<SavedQuery[]>('list_saved_queries'),
  saveQuery: (query: SavedQuery) => call<SavedQuery>('save_query', { query }),
  deleteSavedQuery: (id: string) => call<void>('delete_saved_query', { id }),
  listHistory: (conn: string | null, query: string | null, limit: number) => call<HistoryEntry[]>('list_history', { conn, query, limit }),
  clearHistory: (conn: string | null) => call<void>('clear_history', { conn }),

  mongoOverview: (id: string, env: EnvId) => call<MongoOverview>('mongo_overview', { id, env }),
  listCollections: (id: string, env: EnvId, db: string) => call<CollectionInfo[]>('list_collections', { id, env, db }),
  findDocuments: (id: string, env: EnvId, db: string, collection: string, request: FindRequest) =>
    call<Documents>('find_documents', { id, env, db, collection, request }),
  aggregate: (id: string, env: EnvId, db: string, collection: string, pipeline: string, confirm: string | null) =>
    call<Documents>('aggregate', { id, env, db, collection, pipeline, confirm }),
  listIndexes: (id: string, env: EnvId, db: string, collection: string) =>
    call<{ name: string; keys: Record<string, unknown>; unique: boolean }[]>('list_indexes', { id, env, db, collection }),
  writeDocument: (id: string, env: EnvId, db: string, collection: string, change: DocumentWrite, confirm: string | null) =>
    call<{ message: string }>('write_document', { id, env, db, collection, change, confirm }),

  /** Shows the Save dialog and writes the file; the path it was saved to, or null when cancelled. */
  saveExport: (suggestedName: string, contents: string) => call<string | null>('save_export', { suggestedName, contents }),

  checkUpdate: () => call<UpdateInfo | null>('check_update'),
  /** Downloads, verifies and installs the update from the last check; `onProgress` follows the download. */
  installUpdate: async (onProgress: (p: UpdateProgress) => void) => {
    if (!('__TAURI_INTERNALS__' in window)) return call<void>('install_update', { onProgress });
    const { Channel } = await import('@tauri-apps/api/core');
    const channel = new Channel<UpdateProgress>();
    channel.onmessage = onProgress;
    return call<void>('install_update', { onProgress: channel });
  },
  restartApp: () => call<void>('restart_app'),
};
