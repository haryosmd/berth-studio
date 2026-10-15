# Berth Studio design (Stage 0)

`prototype.html` is a single-file clickable prototype with sample data. Open it in any browser; it needs no server. Its only network requests load fonts from Google Fonts.

## Visual direction

Native macOS feel with a teal accent. Neutrals carry a slight teal bias so the chrome looks deliberate rather than default grey. One accent color is used for focus, selection and primary actions. Red is reserved for production.

- UI type: Geist. Data and code: Geist Mono with ligatures off. Display: Bricolage Grotesque, used only for big headings. Sketch notes on the ERD canvas: Caveat.
- Every value type has its own color across grids, JSON and syntax highlighting: numbers blue, strings green, NULL grey italic, JSON purple, dates orange, booleans pink, primary keys gold.
- Light and dark themes are both first-class. Tokens live in `tokens.css`.

## Screens in the prototype

| Screen | What to check |
|---|---|
| Welcome | Workspace overview, quick actions (including Import collection), module checklist, connections with their environment dots |
| Table browser | Typed column headers, filter chips, inline edit, pending-changes bar, SQL review drawer, row inspector, Structure and Indexes tabs |
| Query editor | Syntax highlighting, autocomplete preview (click a line), run and cancel, Results, Chart, Explain with index advice, Messages with line and column errors. The target chip shows where the query runs (auto, write or read) and Run reports the endpoint it used |
| Mongo | Filter, project and sort bar, document tree, flattened table, aggregation pipeline with per-stage counts, inferred schema |
| ERD | Live mode from the schema with crow's-foot relations, draggable tables, minimap, auto-layout, zoom. Sketch mode adds draft tables, sticky notes and freehand arrows |
| API Collections | Sidebar tree with folders at any depth, indent guides, collapse state that survives reload, hover `+` for New request or New folder, inline rename (F2), delete with undo, right-click menu and arrow-key navigation |
| Import collection | ⇧⌘I, the section `+` menu, or drop a file on the sidebar. Detects Postman, Insomnia, OpenAPI, Swagger, HAR, Bruno and cURL, previews the tree, moves secrets to Keychain and keeps scripts turned off |
| API client | Variables from environments, secret variables, Chain to save response values, timing waterfall, history, and a link from `user.id` in the response to the matching row in Postgres |
| Supabase | Database with pooler choice and RLS per table, Auth users, Storage buckets, Edge Functions with invoke, API keys, Logs |
| Firebase | Firestore three-column browser with typed fields and references, Authentication, Realtime Database tree with reviewed edits, Storage, and a Production/Emulators switch |
| Command palette | Press ⌘K. Fuzzy search across tables, queries, requests, diagrams and actions |
| New connection | Engine picker, then one profile per environment (dev, staging, prod). A Postgres profile has a primary and any number of read replicas, each with its own host, database and user. Test connection validates the profile first |
| Environments | Variables tab: one variable set shared by connections and requests. Connections tab: a matrix of every connection's profile per environment, with Set up and Copy from on empty cells |
| Settings | Keychain secrets, guardrails, privacy, imported content (scripts off), this build (signature, provenance, update key), appearance and shortcuts |
| Design system | Live tokens, type scale, controls and grid cell states |

Workspace modules: the Welcome screen has a checklist of modules (PostgreSQL, MongoDB, Supabase, Firebase, API client, Saved queries, Diagrams). Turning one off hides its sidebar entries, tabs, palette results, connection engine and Welcome rows. Settings › General mirrors the same switches.

Connections and environments: each connection has one profile per environment. Switch to `dev` in the titlebar and `events-db` turns grey with "not in dev". Its view shows a gate offering Set up, Copy from staging, or Switch to staging. In the query editor, reads go to the read replica and writes stay on the primary.

Tests: run `npm test` in the repository root. The prototype's pure logic lives in the `<script id="berth-core">` block and the sample data in `<script id="berth-sample">`, so both can be tested without a browser.

Production guardrail: switch the environment to `prod` in the titlebar. The tab bar and status bar turn red, the connection opens read-only, and committing asks you to type the connection name (`acme-db`).

## Decisions for Stage 1

These were taken before Stage 1 started. Each one can still be tried in the prototype under Settings › Appearance.

1. Accent color: teal.
2. Grid density: compact.
3. Query results panel: bottom.
4. App name: Berth Studio. Dock was the working name.
