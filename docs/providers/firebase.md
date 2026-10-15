# Firebase

Status: specified, not implemented. Berth Studio talks to Firebase through Google's REST APIs from Rust; it does not embed a Firebase SDK.

## Signing in

Two ways, chosen per profile:

1. **Google account (preferred).** An OAuth installed-app flow with a loopback redirect, or the user's Application Default Credentials from `gcloud auth application-default login`. Google discourages service-account keys, so this is the default.
2. **Service-account key.** The JSON file is read once, its private key moves to the Keychain, and the file is not kept. Tokens come from the JWT bearer flow: an RS256-signed assertion posted to `https://oauth2.googleapis.com/token`; tokens last one hour and are renewed automatically.

**Scopes**, requested once: `https://www.googleapis.com/auth/cloud-platform`, `…/auth/userinfo.email` and `…/auth/firebase.database`. Together they cover Firestore, Authentication, Realtime Database and Storage.

Requests made with OAuth credentials are checked by **IAM, not by Security Rules**. Read-only access therefore means read-only IAM roles: `roles/datastore.viewer`, `roles/firebaseauth.viewer`, `roles/firebasedatabase.viewer` and `roles/storage.objectViewer`.

Crate candidates, to be vetted under [DEPENDENCIES.md](../DEPENDENCIES.md) when this module starts: `yup-oauth2` 12.1 (MIT OR Apache-2.0; installed-app and service-account flows; rustls with `ring`) or `gcp_auth` 0.12 (MIT; service accounts and ADC only).

## Firestore (REST v1)

Base: `https://firestore.googleapis.com/v1/projects/{project}/databases/{database}/documents`. The database is `(default)` or a named database (4–63 characters, lowercase letters, digits and hyphens).

| Operation | Endpoint |
|---|---|
| Top-level collections | `POST {documents}:listCollectionIds` with `{pageSize, pageToken}` |
| Subcollections | `POST {document}:listCollectionIds` |
| List documents | `GET {parent}/{collectionId}?pageSize=&pageToken=&orderBy=&mask.fieldPaths=` |
| Query | `POST {parent}:runQuery` with a `structuredQuery` (`from`, `where`, `orderBy`, `startAt`, `limit`); the response is a JSON array that always holds at least one item |
| Read one | `GET {name}` |
| Write | `PATCH {name}?updateMask.fieldPaths=…&currentDocument.updateTime=…` |
| Delete | `DELETE {name}?currentDocument.updateTime=…` |
| Read-only snapshot | `POST …:beginTransaction` with `{"options":{"readOnly":{}}}` |

Rules that matter for an editor:

- `PATCH` is an upsert. A field named in `updateMask` but absent from the body is **deleted**, so the editor always sends the mask of exactly the fields it changed.
- Writes send `currentDocument.updateTime` as a precondition, so a document changed by someone else is not overwritten.
- Third-party OAuth callers cannot open read-write transactions.
- Values are typed: `integerValue` is a **string**, `timestampValue` is RFC 3339, `bytesValue` is base64, `referenceValue` is a full document name, plus `geoPointValue`, `arrayValue` (no array directly inside an array) and `mapValue`.
- Limits: 1 MiB per document, 20 levels of map or array nesting, 10 MiB per request.
- Live listeners need gRPC; over REST the app reloads on demand.

## Authentication (Identity Toolkit v1)

| Operation | Endpoint |
|---|---|
| List users | **`GET`** `https://identitytoolkit.googleapis.com/v1/projects/{project}/accounts:batchGet?maxResults=1000&nextPageToken=` |
| Look up | `POST …/accounts:lookup` with `localId[]`, `email[]` or `phoneNumber[]` |
| Search | `POST …/accounts:query` (`limit` up to 500, paged by `offset`) |
| Disable | `POST …/accounts:update` with `{localId, disableUser: true}` |
| Delete | `POST …/accounts:delete` with `{localId}` |

Reading needs `firebaseauth.users.get` (role Firebase Authentication Viewer); changes need Firebase Authentication Admin.

## Realtime Database (REST)

- URL: `https://<db>.firebaseio.com` for us-central1, `https://<db>.<region>.firebasedatabase.app` elsewhere. The default instance is `<project>-default-rtdb`, but older projects differ, so the URL is configured, not derived.
- Browse with `GET /path.json?shallow=true` (child keys only; cannot be combined with filters). Filters (`orderBy`, `limitToFirst`, `startAt`, `equalTo`) need an `.indexOn` rule and return results unordered.
- Conditional writes: read with `X-Firebase-ETag: true`, then `PUT`/`DELETE` with `if-match: <etag>`; a conflict answers 412 with the current value.
- Limits: depth 32, keys 768 bytes, a single read up to 256 MB. Reads always send `timeout=` and `writeSizeLimit=` is set on writes.

## Cloud Storage

- List: `GET https://storage.googleapis.com/storage/v1/b/{bucket}/o?prefix=&delimiter=/&maxResults=1000&pageToken=`. A page can be empty while a page token is still present.
- Download: `GET …/o/{url-encoded name}?alt=media`.
- Default bucket: `<project>.firebasestorage.app` for buckets created after September 2024, `<project>.appspot.com` for older ones.
- **Since 3 February 2026 Storage needs the Blaze plan.** On Spark the API answers 402 or 403, and the app explains this instead of showing an empty bucket.

## Emulator Suite

- Default ports: Firestore 8080, Auth 9099, Realtime Database 9000, Storage 9199, UI 4000.
- Requests use the same REST paths over `http://127.0.0.1:<port>` and authenticate with `Authorization: Bearer owner`. For the Realtime Database add `?ns=<database name>`.
- `firebase-tools` 15 and later need **Java 21**. A `demo-*` project id runs fully offline, without a Google account, which suits automated tests.
- In Berth Studio, a dev profile can switch to the emulators; production profiles cannot.

## Identifiers

Project id: 6–30 characters of lowercase letters, digits and hyphens, starting with a letter and not ending with a hyphen.

## Sources

- Service-account flow: https://developers.google.com/identity/protocols/oauth2/service-account
- Application Default Credentials: https://docs.cloud.google.com/docs/authentication/application-default-credentials
- Firestore REST: https://firebase.google.com/docs/firestore/use-rest-api and https://firestore.googleapis.com/$discovery/rest?version=v1
- Firestore values, patch and transactions: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Value, https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/patch, https://docs.cloud.google.com/firestore/docs/reference/rest/v1/TransactionOptions
- Firestore limits: https://docs.cloud.google.com/firestore/quotas
- Identity Toolkit: https://identitytoolkit.googleapis.com/$discovery/rest?version=v1
- IAM roles: https://firebase.google.com/docs/projects/iam/roles-predefined-product
- Realtime Database REST: https://firebase.google.com/docs/database/rest/retrieve-data, https://firebase.google.com/docs/database/rest/save-data, https://firebase.google.com/docs/database/rest/auth
- Realtime Database limits: https://firebase.google.com/docs/database/usage/limits
- Cloud Storage JSON API: https://docs.cloud.google.com/storage/docs/json_api/v1/objects/list
- Storage plan change: https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- Emulators: https://firebase.google.com/docs/emulator-suite/install_and_configure and https://firebase.google.com/support/release-notes/cli

## Unverified

- Whether the Firestore emulator rejects real OAuth tokens (community sources only).
- The REST path versions served by the Storage emulator.
- The maximum `localIds` count for `accounts:batchDelete`.
