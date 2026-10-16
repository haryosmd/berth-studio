// Mirrors the Rust types sent over IPC (crates/berth-core, crates/berth-postgres, crates/berth-mongo,
// src-tauri/src/app.rs).

/** An environment id defined by the workspace, such as "dev" or "prod-eu". */
export type EnvId = string;
export type Engine = 'postgres' | 'mongodb';
export type Role = 'write' | 'read';
export type TlsMode = 'auto' | 'require' | 'disable';
export type RouteMode = 'auto' | 'write' | 'read';
export type ReadPreference = 'primary' | 'secondaryPreferred';

export interface Environment {
  id: EnvId;
  label: string;
  /** A #rrggbb colour for the environment dot. */
  color: string;
  /** Production profiles open read-only, and writes need the connection name typed. */
  production: boolean;
  longName?: string;
  shortName?: string;
}

export interface Endpoint {
  role: Role;
  host: string;
  port: number;
  database: string;
  user: string;
  /** MongoDB only. Never holds a password. */
  uri?: string;
  /** MongoDB only: the database the user is defined in. */
  authSource?: string;
  tls: TlsMode;
  /** PostgreSQL only: path to a PEM file with extra CA certificates. Amazon RDS roots are built in. */
  caCert?: string;
  /** A keychain reference such as keychain://berth-studio/acme-db/dev/write-0. Never the password. */
  secret?: string | null;
  needsSecret?: boolean;
}

export interface Profile {
  endpoints: Endpoint[];
  readOnly: boolean;
  autoRoute: boolean;
  copiedFrom?: EnvId;
  readPreference?: ReadPreference;
}

export interface Connection {
  id: string;
  engine: Engine;
  profiles: Record<EnvId, Profile | undefined>;
}

export interface PasswordInput {
  env: EnvId;
  role: Role;
  index: number;
  password: string;
}

export interface Table {
  schema: string;
  name: string;
  kind: string;
  estimatedRows: number;
}

export interface Column {
  name: string;
  typeName?: string;
  primaryKey: boolean;
}

export interface ResultSet {
  columns: Column[];
  rows: (string | null)[][];
  truncated: boolean;
  affected: number | null;
}

export interface Page extends ResultSet {
  host: string;
  elapsedMs: number;
}

/** How a filter chip compares its column with its value; the Rust side binds the value as a parameter. */
export type FilterOp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'contains' | 'startsWith' | 'isNull' | 'isNotNull' | 'in';

export interface Filter {
  column: string;
  op: FilterOp;
  value?: string;
  /** For `in` only. */
  values?: string[];
}

export interface Sort {
  column: string;
  descending: boolean;
}

export interface BrowseRequest {
  filters: Filter[];
  /** A raw SQL condition, appended as `AND (…)`; one expression, never a second statement. */
  where: string | null;
  sort: Sort | null;
  limit: number;
  offset: number;
}

/** Exact when the request filters, otherwise the planner's estimate (`null` for views and unanalysed tables). */
export interface RowCount {
  total: number | null;
  exact: boolean;
}

export interface RunResult {
  results: ResultSet[];
  role: Role;
  reason: string;
  warn?: string;
  host: string;
  readOnly: boolean;
  elapsedMs: number;
}

export interface EndpointCheck {
  role: Role;
  index: number;
  host: string;
  ok: boolean;
  message: string;
}

export interface MongoServer {
  version: string;
  topology: string;
}

export interface MongoOverview {
  server: MongoServer;
  databases: string[];
}

export interface CollectionInfo {
  name: string;
  kind: 'collection' | 'view' | 'timeseries';
  count?: number;
}

/** A JSON value in relaxed Extended JSON, as the MongoDB module returns it. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Documents {
  documents: { [key: string]: Json }[];
  truncated: boolean;
  elapsedMs: number;
}

export interface FindRequest {
  filter: string;
  sort: string;
  projection: string;
  skip: number;
  limit: number;
}

export type DocumentWrite =
  | { action: 'insert'; document: string }
  | { action: 'replace'; id: string; document: string }
  | { action: 'delete'; id: string };

export interface DbError {
  message: string;
  detail?: string;
  hint?: string;
  code?: string;
  position?: number;
}

/** Error codes the interface reacts to. */
export const CONFIRM_CODE = 'BERTH_CONFIRM_PROD';
export const CONFIRM_ENV_DELETE = 'BERTH_CONFIRM_ENV_DELETE';
export const NO_WRITE = 'BERTH_NO_WRITE';

/** A newer release found by `check_update`. Notes are plain text, never rendered as HTML. */
export interface UpdateInfo { currentVersion: string; version: string; date?: string; notes?: string }
export type UpdateProgress =
  | { event: 'started'; total: number | null }
  | { event: 'chunk'; downloaded: number }
  | { event: 'installed' };
