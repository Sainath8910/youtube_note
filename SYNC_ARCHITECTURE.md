# YouTube Notes Synchronization Architecture

This document tracks the proposed synchronization between the independently
deployed `youtube_note` application and the AI-enabled
`youtube-knowledge-extension` application. The projects and their databases
remain independent.

## Current authentication and identity

Both Django backends configure Django REST Framework to use
`users.authentication.SupabaseJWTAuthentication` first and
`DevHeaderAuthentication` second. The development header path is enabled only
when debug mode, development environment, and its explicit feature flag are all
set.

The Supabase authenticator:

1. Reads an `Authorization: Bearer <JWT>` header.
2. Derives an exact issuer from the configured Supabase project URL and checks
   the configured audience.
3. Verifies the JWT signature using the configured Supabase JWKS for ES256,
   RS256, or EdDSA tokens; HS256 is accepted only when the JWT secret is
   configured.
4. Requires and validates the `exp`, `sub`, `iss`, and `aud` claims.
5. Parses the verified `sub` as a UUID and resolves or provisions a local
   `users.User` whose unique `supabase_uid` equals that UUID.

The currently inspected environment files for both projects resolve to the
same Supabase project and audience. This is configuration evidence, not a
guarantee that future deployments will remain identical. Keep issuer and
subject together as the external identity key if multiple Supabase projects
are ever supported. Do not identify accounts by email.

The extension obtains a Supabase session in its background auth context,
refreshes expiring access tokens, and sends the access token to Django as a
Bearer token. Django remains responsible for token verification. Protected
note and folder APIs derive ownership from `request.user`; note detail/list
querysets and folder operations are user-scoped.

## Existing note and folder data

Both projects have integer `BigAutoField` primary keys; those keys are local
only. Note fields include title, versioned JSON `document`, legacy `content`,
`note_type`, optional folder and video references, optional timestamp, and
created/updated timestamps. The document may contain extension-specific block
types and metadata; clients and sync layers must preserve unknown block data.

Folders have a user, name, optional parent, description, and created/updated
timestamps. Folder hierarchy is local integer-keyed today.

The Note and Folder models in each project have a unique `sync_uuid`, generated
by `uuid.uuid4`, and normal model saves reject changing an already persisted
UUID. Phase 2A.1 migrations backfill existing rows independently in each
database. Therefore, these backfilled UUIDs do **not** link logical records
that existed in both databases before the migrations.

## Current API and deletion behavior

Existing APIs continue to use integer IDs, including note detail and folder
detail routes. The ordinary Note and Folder serializers expose `sync_uuid` as
read-only and keep integer `id`. Note JSON is serialized as stored; unknown
blocks and metadata must remain intact.

Note and Folder deletion moves records to Trash for 30 days; folder trash
includes its active subtree and contained Notes as one restorable group.
Versioned Notes Bridge tombstones preserve sync identity and prevent stale
upserts from resurrecting permanently purged records. Deletions caused by
database cascades are still not treated as explicit user actions. Knowledge
chunks, embeddings, transcript/analysis indexing, conversations, and other
AI-only derived state are not portable note data.

## Phase 2A.4 — Synchronization model audit

This section records the pre-implementation baseline. Current Note and Folder
Trash behavior is described above and in Section 12.

### Projects and model locations

The workspace contains two separate project roots, each with its own `.git`,
`backend/`, `Doc/`, and `extension/` directories. The AI project root also
contains `docker-compose.yml`. Their backend application directories are:

- `youtube_note/backend/`: `config`, `deployment_tests`, `folders`,
  `knowledge`, `notes`, `questions`, `recovery`, `static`, `staticfiles`,
  `users`, and `videos`.
- `youtube-knowledge-extension/backend/`: `config`, `folders`, `knowledge`,
  `notes`, `questions`, `recovery`, `users`, and `videos`.

The Note, Folder, User, and Video models have matching counterparts in both
projects. AI-specific relations exist only in the knowledge-enabled project.
Neither project defines custom managers for Note or Folder. Both models have
custom `save()` guards that reject changing an already persisted `sync_uuid`;
these guards do not intercept `QuerySet.update()`, bulk operations, or direct
SQL.

Primary source files:

| Model / API surface | `youtube_note` | `youtube-knowledge-extension` |
|---|---|---|
| Note model | `backend/notes/models.py` | `backend/notes/models.py` |
| Folder model | `backend/folders/models.py` | `backend/folders/models.py` |
| User model | `backend/users/models.py` | `backend/users/models.py` |
| Video and viewing models | `backend/videos/models.py` | `backend/videos/models.py` |
| Note serializer / CRUD | `backend/notes/serializers.py`, `backend/notes/views.py`, `backend/notes/urls.py` | Same paths |
| Folder serializer / CRUD | `backend/folders/serializers.py`, `backend/folders/views.py`, `backend/folders/urls.py` | Same paths |
| AI-only relations | None | `backend/knowledge/models.py`, `backend/questions/models.py` |

### Field-by-field comparison

The Note and Folder schemas and constraints are currently the same in both
projects. Integer primary keys and all foreign-key IDs remain database-local.
Unless stated otherwise, Django creates an index for each ForeignKey.

| Model / field | Type and constraints in both projects | Sync interpretation |
|---|---|---|
| Note `id` | `BigAutoField`, primary key | Local-only; never send as a cross-project identifier. |
| Note `user` | Required FK to `users.User`, `CASCADE`, related name `notes` | Resolve from authenticated Supabase identity; never accept a client-supplied local user ID. |
| Note `sync_uuid` | UUID, `uuid.uuid4` default, unique, non-editable; save guard rejects normal reassignment | Portable identity for records that have been explicitly paired. Independently backfilled values do not pair pre-existing records. |
| Note `title` | Required `CharField(500)` | Portable. |
| Note `document` | Required `JSONField`, `default=dict` | Portable as an opaque JSON value; preserve all block fields and unknown metadata. |
| Note `content` | `TextField(blank=True)`, database non-null; no explicit default | Legacy compatibility field. Preserve during transition until its relationship to `document` is settled. |
| Note `note_type` | Required `CharField(20)`, choices `VIDEO` / `STANDALONE` | Portable. Preserve the validation that VIDEO needs a video and STANDALONE cannot have a video or timestamp. |
| Note `folder` | Nullable/blank FK to Folder, `SET_NULL`, related name `notes` | Portable relationship by Folder `sync_uuid`; `NULL` is valid. |
| Note `video` | Nullable/blank FK to global Video, `CASCADE`, related name `notes` | Portable relation by YouTube ID, not local Video `id`; current hard-delete cascade is a data-loss risk. |
| Note `timestamp_seconds` | Nullable/blank `PositiveIntegerField` | Portable when present; currently a separate note field, not guaranteed to be encoded in the document. |
| Note `created_at` | Required `DateTimeField(auto_now_add=True)` | Preserve as source metadata on import if agreed; normal model create overwrites it. Not a conflict version. |
| Note `updated_at` | Required `DateTimeField(auto_now=True)`, default list ordering `-updated_at` | Informational only; not a safe synchronization revision. |
| Folder `id` | `BigAutoField`, primary key | Local-only. |
| Folder `user` | Required FK to User, `CASCADE`, related name `folders` | Resolve from authenticated Supabase identity. |
| Folder `sync_uuid` | UUID, `uuid.uuid4` default, unique, non-editable; save guard rejects normal reassignment | Portable identity only after explicit pairing; migration-generated values are independent. |
| Folder `name` | Required `CharField(255)` | Portable. |
| Folder `parent` | Nullable/blank self-FK, `CASCADE`, related name `children` | Portable by parent Folder `sync_uuid`; root is `NULL`. Nested folders are supported. |
| Folder `description` | `TextField(blank=True)`, database non-null | Portable. |
| Folder `created_at` | Required `DateTimeField(auto_now_add=True)` | Source metadata, not a conflict version; normal model create overwrites it. |
| Folder `updated_at` | Required `DateTimeField(auto_now=True)`, default ordering by `name` | Informational only. |
| Folder uniqueness | `(user, parent, name)` unique, plus conditional `(user, name)` unique where `parent IS NULL` | Local database constraints. Name collisions on another device must be reported/resolved, not silently renamed or merged. |

`Note` has no explicit model-level `Meta` indexes or uniqueness constraints
besides `sync_uuid`; its ForeignKeys have their default indexes. `Folder` has
the two uniqueness constraints above and the default FK indexes. Unique UUID
fields enforce non-null/unique values after the UUID migrations' final
`AlterField`.

The custom User models are also the same. Both subclass Django `AbstractUser`
and use a local `BigAutoField` ID. Inherited username is unique; inherited
email is blankable but not unique. `supabase_uid` is a nullable, blankable,
unique UUID. `public_username` is nullable/blankable `CharField(30)` with a
case-insensitive unique constraint on `Lower(public_username)`. Inherited
groups and user permissions are many-to-many relations to Django auth tables.
Only the verified Supabase issuer/project plus `sub` is a suitable external
identity key; local User IDs, usernames, and email are not portable ownership
keys.

The Video models share local integer IDs, globally unique `youtube_id`
(`CharField(20)`), title, channel name/handle/ID, thumbnail URL,
`duration_seconds`, transcript status/data/language/fetched timestamp, and
created/updated timestamps. The API uses the YouTube ID as the stable video
identity. Video rows are not user-owned. Video metadata can be retained as
context and, per the approved update, its common fields and transcript are
transferred when a Video Note is explicitly selected. The Video record is
shared, so an import preserves newer destination metadata; AI-only analysis is
not replicated.

| Shared Video field | Type / constraints in both projects | Sync interpretation |
|---|---|---|
| `id` | `BigAutoField`, primary key | Local-only. |
| `youtube_id` | Required `CharField(20)`, unique | Portable video reference. |
| `title`, `channel_name`, `channel_handle`, `channel_id` | Required database strings with `blank=True`, maximum lengths 500 / 255 / 255 / 255 | Portable Video metadata included with an explicitly transferred Video Note. |
| `thumbnail_url` | `URLField(blank=True)` | Portable display metadata. |
| `duration_seconds` | Nullable/blank `PositiveIntegerField` | Portable Video metadata. |
| `transcript_status` | Required `CharField(20)`, status choices, default `NOT_STARTED` | Transferred with the shared Video record. |
| `transcript` | Nullable/blank `JSONField`, no explicit default | Transcript JSON is transferred with the shared Video record. |
| `transcript_language` | `CharField(35, blank=True)` | Portable transcript metadata. |
| `transcript_fetched_at` | Nullable/blank `DateTimeField` | Transferred with the transcript. |
| AI `analysis_status` | Required `CharField(20)` with default `NOT_STARTED` | AI-only; absent in current non-AI model. |
| `created_at`, `updated_at` | Required `DateTimeField(auto_now_add/auto_now)` | Local Video lifecycle timestamps. |

Both projects also have `ViewingSession`: local `BigAutoField` ID, required
User and Video foreign keys with `CASCADE`, `last_position_seconds` defaulting
to zero, and `last_watched_at=auto_now`. `(user, video)` is unique. Its
per-user position and last-watched timestamp travel with a transferred Video
Note; local IDs are not transferred. The most recently watched position wins.
An absent source session does not delete a destination session. Video rows are
not enumerated as a separate transfer inventory; only Videos referenced by
selected Notes are included.

### Relationships, serializers, and API behavior

- Notes belong to a user. Folder ownership is also a required User FK. The API
  scopes note and folder reads/updates/deletes to the authenticated user. The
  Note serializer limits writable folder choices to that user, and Folder
  creation limits a parent choice to that user. The database itself does not
  enforce that a Folder's parent has the same user; synchronization must
  validate this invariant.
- A Folder can have child folders through its nullable self-parent relation.
  The API makes a Folder's parent read-only after creation. Its parent FK is
  `CASCADE`, so bridge trash/restore code explicitly preserves descendants
  rather than deleting them. Folder DELETE trashes the active subtree and its
  contained Notes as one batch.
- Note DELETE moves the Note to Trash for 30 days. The associated Video row is
  retained. User deletion and Video deletion still have database cascades;
  they are not treated as explicit user deletion tombstones.
- Both Note serializers expose `id` (integer) and `sync_uuid` (read-only),
  plus the same note fields. Document validation requires an object with
  `version == 1`, a `blocks` list, and each block's `id`, `type`, and
  `content`; other document and block keys are not normalized away. Do not
  reconstruct blocks from a whitelist during sync.
- Note routes in both projects retain integer-ID CRUD: `GET/POST
  /api/notes/`, `POST /api/notes/video/`, and
  `GET/PATCH/PUT/DELETE /api/notes/<int:pk>/`. The video create route resolves
  or creates a Video by YouTube ID, obtains metadata, then creates the Note.
  Folder routes use integer IDs for list/create, search, folder notes, detail,
  patch, and delete. The AI project additionally exposes
  `/api/notes/<int:pk>/assistance/`; this is not a synchronization API.
- Folder serializers expose local integer `id`, read-only `sync_uuid`,
  `name`, `description`, local integer `parent`, timestamps, and detail
  breadcrumbs. Note responses include local `folder` and `video` integer IDs,
  `folder_path`, and `video_detail`; these are not portable references.
- The AI project has no extra fields on Note or Folder. It adds
  `Video.analysis_status` and `VideoAnalysis` (one-to-one with Video), absent
  in the non-AI project's current models. The non-AI migration
  `videos/0005_remove_video_analysis.py` removes that field/model after
  `0004_videoanalysis`; the AI project retains it. This is AI-specific derived
  state and should not be in the portable note schema.
- AI-only `Question` records reference User (`CASCADE`), Video (`SET_NULL`)
  and Folder (`SET_NULL`), not Note. AI `KnowledgeChunk` references User
  (`CASCADE`), optional Note (`CASCADE`), optional Video (`CASCADE`), and
  optional Folder (`SET_NULL`); embeddings and chunk metadata are derived
  local state. Note trash removes its chunks and restore queues re-indexing;
  Folder trash detaches chunks. Video deletion removes chunks. These records
  must be rebuilt/maintained by the AI application, not synchronized as Notes.
- The AI-only `Question` stores question and answer text plus an automatic
  creation timestamp. `KnowledgeChunk` stores extracted content, content/source
  types, optional source block ID, chunk index, JSON metadata, a nullable
  1024-dimensional vector, and automatic timestamps. Its foreign-key indexes
  are disabled individually and replaced by explicit composite/search indexes
  on user, note, video, folder, and content type. Neither model has a
  many-to-many relation to Note or Folder.
- AI note creation and update call `_save_and_index_note`: save occurs in an
  atomic request path, then `knowledge.services.indexing.index_note(note)`
  runs. An indexing failure raises a 502-class `NoteIndexingUnavailable`
  exception. Non-AI note creation and update do not invoke indexing. AI note
  delete uses the generic hard-delete view; the Note FK cascade removes
  KnowledgeChunks. An accepted future sync update on the AI side must invoke
  the same indexing service, and an accepted deletion must ensure dependent
  chunks are removed.

Relevant migration history is aligned for Note and Folder: each project has
`0001` through `0004`; `0003` adds `document` and makes legacy `content`
blankable, while `0004` adds and backfills `sync_uuid`. Folder migration
`0003` adds the root-name uniqueness constraint. The Note/Folder initial
migrations retain the integer primary keys and the FK deletion rules described
above. User migrations `0001` through `0004` are aligned and add the same
Supabase and public-username fields/constraint.

### Portable and local-only mapping

| Data | Portable mapping | Local-only / derived data |
|---|---|---|
| Note identity | `sync_uuid`, after pairing | Integer `id` |
| Note owner | Verified Supabase `(issuer, sub)` mapped to a local User | Local User PK, username, email, password, groups, permissions |
| Note body | `title`, complete `document` JSON, legacy `content` during migration, `note_type`, `timestamp_seconds` | Local computed folder path and nested response representation |
| Folder assignment | Folder `sync_uuid`, or null | Integer `folder_id` |
| Video assignment | `youtube_id` plus the common Video fields and transcript snapshot on an explicitly selected Video Note | Integer Video ID and AI-only `analysis_status`/`VideoAnalysis` |
| Folder identity/hierarchy | Folder `sync_uuid`, name, description, parent Folder `sync_uuid` or null | Integer Folder ID and parent ID |
| Timestamps | Original creation/update times may travel as provenance if explicitly supported | Local `auto_now_add` / `auto_now` values are not portable concurrency state |
| AI data | None by default | KnowledgeChunk, vector embeddings, Question, VideoAnalysis, and processing state |

The canonical cross-project fields therefore need UUID references for Notes and
Folders, Supabase subject mapping for ownership, and YouTube ID for videos.
Never serialize local integer relation IDs as if they were shared identifiers.

### Existing UUID migration implications

Each project's Note and Folder `0004` migration generates a separate UUID for
each existing row in that database. It preserves rows and integer primary keys,
but it cannot establish that two rows in different databases represent the
same logical Note or Folder. Equal-looking titles or matching local integer
IDs are not evidence of identity.

Before initial synchronization of legacy data, candidate matching can use
multiple signals: the same verified Supabase owner, exact video YouTube ID
and timestamp where applicable, exact canonical document/content comparison,
creation-time proximity, and recursively matched folder context. Even combined
signals are candidates, not proof. Title-only matching is unsafe because
titles are editable, non-unique, and often generic. Ambiguous candidates must
be presented for explicit user choice or left as separate records; do not
silently merge content or assign the same sync UUID to unrelated records.

### Integrity and synchronization risks

1. **Independent UUID backfills:** existing logical records will appear as
   distinct records until a reviewed reconciliation pairs them.
2. **Folder name collision:** destination uniqueness can reject a valid
   incoming folder tree. Do not silently rename or merge; return a conflict
   with the relevant parent/name.
3. **Folder ownership/cycles:** validate owner consistency, reject self/ancestor
   cycles, and apply parents in dependency order. Current DB constraints do not
   prohibit cross-user parent links or cycles created outside the API.
4. **Cascades:** user deletion cascades to Notes/Folders; Folder parent
   deletion cascades to descendants when bypassing the API; Video deletion
   cascades to Notes. In particular, relying only on Folder/Note model
   deletion misses changes caused by cascades unless each affected portable
   object receives a tombstone.
5. **Folder detach semantics:** deleting a leaf Folder sets Notes' folder
   reference to null, which is an update to each Note that must be propagated,
   not a Note deletion.
6. **Video deletion:** a global Video row may be removed by local maintenance
   and cascade to user Notes. For a sync protocol, do not treat local Video
   row deletion as an instruction to delete a portable Note on the other
   application. This lifecycle needs an explicit product decision.
7. **Timestamps:** `auto_now` is application write time, and `auto_now_add`
   makes ordinary imported creation time difficult to preserve. Timestamp
   equality is already used by AI assistance as a stale-input check, but that
   single-request check is not a durable revision or cross-database ordering
   mechanism. Concurrent writes, precision/serialization, clock differences,
   and changes through bulk operations make timestamps insufficient as the
   sync conflict key.
8. **Hard deletes:** after a hard delete there is no row to discover on a later
   pull. Without a retained tombstone, an older peer can recreate the deleted
   Note or Folder.
9. **Derived AI state:** imported content must be re-indexed on the AI side.
   Never accept remote embeddings as authoritative; they depend on local
   chunking, model, and indexing versions.

### Recommended synchronization metadata and behavior

- Add a durable, per-owner synchronization record keyed by entity type and
  `sync_uuid`, with a monotonically increasing revision and last accepted
  source/device metadata. Keep it independent of the Note/Folder FK so it
  survives hard deletion.
- Keep a durable change/outbox record for each accepted Note or Folder create,
  update, and delete. A delete entry is a tombstone containing entity type,
  UUID, owner, revision, and deletion time; it must not rely on the deleted
  model row. Make requests idempotent with a unique operation/request ID.
- Register clients using a server-scoped device UUID and maintain a per-device
  pull cursor/acknowledgment. Define tombstone retention and behavior for
  devices that return after retention before releasing tombstones.
- Push must derive the owner from the verified JWT, validate UUID relations
  and same-owner folder hierarchy, require a base revision, and reject
  duplicate UUIDs belonging to another owner. Pull must use a stable,
  opaque cursor, paginate deterministically, and include tombstones.
- Use a monotonically increasing object revision and expected-base-revision
  comparison (for example `If-Match`) for conflict detection. A mismatch
  returns a conflict with current revision/state; do not silently apply
  last-write-wins based on timestamps. Preserve both edits for user resolution
  when they cannot be merged safely.
- Do not infer or propagate deletion from a missing row or database cascade.
  Capture only explicit, authorized deletions and each affected relationship
  change in the same transaction. Prevent or explicitly resolve Video and
  Folder cascades before emitting tombstones; preserve a repair conflict when
  a cascade has already removed data without provable user intent.
- For an accepted AI-side content change, record durable AI-local
  indexing-needed work in the same local transaction and invoke the existing
  indexing service asynchronously with retry. Indexing failure must not change
  transfer success. For an accepted deletion, remove its derived chunks. Do
  not replicate AI chunks, vectors, or analysis state.
- Keep the existing integer CRUD routes and response fields intact. New
  synchronization routes should use UUIDs and must not overload the current
  integer `id` or ordinary serializer write formats.

### Exact Phase 2A.5 scope recommended

Phase 2A.5 should add only synchronization metadata/storage and its migrations
in both backends; it should not yet expose push/pull endpoints or alter the
existing CRUD contract. The following data-model details are implementation
design choices; they must preserve the approved protocol and existing data:

1. Entity key and uniqueness: `(owner, entity_type, sync_uuid)`, with no
   foreign key to a deletable Note/Folder for tombstone rows.
2. Revision lifecycle: initial revision for existing rows, increment rules
   for note/folder field changes and relationship changes, and concurrency
   checks for imported updates.
3. Change capture: model save/delete, admin, bulk operations, cascades, and
   scripts; use one transactionally written outbox path, explicitly guard
   destructive cascade paths, and document unsupported bypasses rather than
   claiming they are captured.
4. Device and idempotency metadata: stable device UUID, unique request ID,
   per-device cursor/acknowledgment, and revoked/stale-device policy.
5. Tombstone retention: payload, deletion timestamp, acknowledgment policy,
   and minimum retention period.
6. Seed/backfill strategy: preserve independent existing sync UUIDs pending
   reviewed reconciliation; do not create cross-project UUID matches from
   titles or local integer IDs.
7. Constraint behavior: same-owner folder parent validation, folder name
   conflicts, and explicit handling of video deletion and folder-detach
   updates.

No models, migrations, API behavior, or test/database contents were changed
for this audit.

## Phase 2A.5.1 — Synchronization Protocol Specification

This section is a **design proposal**, not implemented behavior. The facts
below are marked **Existing fact** where verified in the source or the
preceding audit. All endpoints, synchronization metadata, revisions, cursors,
conflict responses, reconciliation workflow, and retry behavior are
**proposed**. No current synchronization API or change log exists.

### 1. Architecture overview

**Existing facts**

- The applications are independent Django deployments with separate
  databases. Both validate Supabase JWTs and resolve the verified `sub` UUID
  to a local User. Issuer is derived from each application's configured
  Supabase project URL; both applications must use the same project/issuer for
  the shared-subject rule to identify the same person.
- Note and Folder have local integer primary keys and immutable-on-normal-save
  `sync_uuid` fields. Existing records received UUIDs independently.
- Existing serializers/API contracts expose local integer `id`; ordinary
  serializers make `sync_uuid` read-only. Current routes are not sync routes.
- The AI backend indexes saved Notes locally; embeddings, chunks, questions,
  AI video analysis, and conversations remain local. The shared Video metadata
  and transcript fields listed above are included when transferring a Note
  attached to that Video.

**Approved direction**

Keep both applications and databases independent. The AI project is the only
user-facing Notes Bridge: its UI lets the user review and confirm PUSH
(`youtube-knowledge-extension` to `youtube_note`) and PULL
(`youtube_note` to `youtube-knowledge-extension`) for both Notes and Folders.
The AI Django backend coordinates these operations by communicating directly
with the Non-AI Django backend. The browser extension must not call the
Non-AI backend for synchronization or hold backend peer credentials.

User authentication and backend peer authentication are separate controls.
The AI backend verifies the user's Supabase JWT for its own request and
forwards the user access token only over the authenticated backend channel
when the Non-AI backend must authorize that same user. The Non-AI backend
independently verifies the JWT, issuer, audience, expiry, and subject and
derives its local owner from the verified subject. Peer authentication proves
the calling backend; it does not identify or authorize the user. Both backends
must enforce ownership, and neither may accept a client-supplied user ID.
Production peer-authentication mechanism remains an approval item below.

The AI backend owns the user-facing preview, confirmation, progress, result,
conflict, and history experience. The Non-AI backend exposes only a
versioned, authenticated peer API and gains no bridge dashboard or extension
dependency. Existing CRUD routes and authentication contracts remain
unchanged.

**Operation flow**

1. The user selects PUSH or PULL in the AI project's Notes Bridge. PUSH means
   AI to Non-AI; PULL means Non-AI to AI. Both operations include Notes and
   Folders.
2. The AI backend authenticates the user and requests a scoped inventory or
   change preview from the Non-AI backend over the protected peer channel.
   The AI UI presents new, updated, deleted, and conflicting records and
   preserves the full Note document and mapped Folder hierarchy.
3. After explicit confirmation, the AI backend applies the selected
   operations. The Non-AI backend independently verifies the same user's
   Supabase identity and ownership for peer reads and writes.
4. The AI backend reports per-operation results and persists conflicts and
   progress for retry/history. No change is applied merely because it was
   included in a preview.

Each backend installation has a server-generated `installation_id`. The AI
backend acts as the coordinator and registers the remote installation as its
peer. Each installation/device identity is server-managed and scoped to the
verified user where appropriate; these identifiers support streams, cursors,
and provenance but never authenticate users. Each change has an
installation-scoped sequence and a per-record revision. Use revisions for
record concurrency and the sequence for reliable feed pagination; neither
replaces the other.

### 2. Identity and record-matching rules

| Entity | Proposed protocol identity | Prohibited identity |
|---|---|---|
| User | Exact verified pair `(issuer, sub UUID)`; resolve to the local `User` separately in each application | Client-supplied local User ID, email, username, or an unverified JWT claim |
| Note | The preserved local `Note.sync_uuid`, resolved across installations through an explicit audited identity mapping | Note integer `id`, title, or content-derived hash |
| Folder | The preserved local `Folder.sync_uuid`, resolved across installations through an explicit audited identity mapping | Folder integer `id`, name, or path |
| Video | Exact YouTube video ID (`youtube_id`) | Local Video integer `id`, title, channel name, or URL display text |
| Change event | `(source installation_id, source sequence)` plus an idempotency operation UUID | Timestamp alone or client-controlled sequence without server validation |

Every endpoint derives ownership from the verified JWT. Look up a Note,
Folder, or sync-state row by both authenticated owner and its local UUID. A
mapping is also owner- and peer-scoped. If a UUID or mapping already belongs
to a different local user, reject with a generic conflict/security error
without disclosing that user's record. Verify that a referenced Folder has
the same local owner and resolve it through the same mapping. Validate that
any `youtube_id` refers to a valid YouTube ID before associating a local Video
row.

An incoming `sync_uuid` is accepted only through a dedicated sync operation;
ordinary CRUD serializers remain unchanged. UUID uniqueness does not itself
prove that records in the two databases are the same logical record.

**Legacy identity mapping (approved: preserve UUIDs; never rekey).** For
explicitly paired records whose existing UUIDs differ, create an auditable
mapping between the two installation-scoped UUIDs. The mapping is per
verified owner and entity type, records both installation IDs and both
unchanged `sync_uuid` values, and has a stable bridge mapping ID, state
(pending/confirmed/deferred/revoked), confirmation provenance, and timestamps.
Enforce one-to-one pairing per owner, entity kind, and peer; reject ambiguous
or already-mapped pairs. Keep the mapping independently of either Note or
Folder row so deletion does not erase identity history. Record an immutable
audit event for each proposed, confirmed, or reversed pairing. Both backends
must persist or verifiably obtain the same confirmed mapping before applying
cross-UUID updates. An implementation must not use bulk updates, direct SQL,
or a model-save bypass to change either existing UUID.

An unpaired record is not silently equated with a peer record, even if names,
IDs, or content look alike. A user-confirmed mapping pairs existing records
without merging or overwriting their data; if snapshots differ, create a
normal conflict. A one-sided record may be adopted only by an explicit
operation. New records can retain the sender's UUID on creation when no
destination record or conflicting mapping exists. Folder references and
parents resolve through confirmed mappings, preserving the corresponding
relationships rather than matching by local integer ID or folder name.

### 3. Portable payloads

Payload examples show a proposed version-1 wire format. `sync_uuid` identifies
the source installation's unchanged local record. For a confirmed legacy pair
with different UUIDs, include its bridge mapping ID and resolve the receiving
installation's local UUID through that mapping; do not overwrite either UUID.
For unpaired new records, the destination may adopt the source UUID only when
no record or conflicting mapping exists. Timestamps are
RFC 3339 UTC strings and are provenance only; they do not determine which
update wins. The server derives owner identity from authentication, so no
owner ID is accepted in the body.

**Note snapshot or upsert**

```json
{
  "schema_version": 1,
  "operation_id": "30c8c978-9cb8-4e31-9ed1-8c99fb4ea431",
  "source": {
    "installation_id": "ec08194e-33fa-48e8-92c7-5628351b2c04",
    "sequence": 841
  },
  "entity": "note",
  "bridge_mapping_id": null,
  "sync_uuid": "1fa73ad8-8060-4fc6-a58c-29664d1120c7",
  "source_revision": 9,
  "base_revision": 4,
  "deleted": false,
  "created_at": "2026-10-28T15:22:13.104Z",
  "updated_at": "2026-11-08T19:31:40.520Z",
  "data": {
    "title": "Binary search",
    "document": {
      "version": 1,
      "blocks": [
        {
          "id": "block-1",
          "type": "paragraph",
          "content": "Divide the search space in half.",
          "extension_metadata": {"origin": "clipper"}
        },
        {
          "id": "block-2",
          "type": "future_block",
          "content": {"raw": true},
          "other_unknown_key": [1, 2, 3]
        }
      ],
      "unknown_document_key": {"keep": true}
    },
    "content": "",
    "note_type": "VIDEO",
    "folder_sync_uuid": "658e1bd2-7093-47e8-9db0-831e0bf2da93",
    "video_youtube_id": "dQw4w9WgXcQ",
    "timestamp_seconds": 73
  }
}
```

The full `document` value is opaque JSON: copy it without filtering,
normalizing, or reconstructing blocks. Include legacy `content` during the
compatibility period until its relationship to `document` is explicitly
settled. Include `note_type` and `timestamp_seconds` because they are current
Note fields. Represent an absent Folder or Video as JSON `null`. For an
attached Video, include its common model fields and the user's ViewingSession.
Video metadata replaces a destination placeholder or is applied when its
source `updated_at` is newer; otherwise the newer destination metadata is
preserved. Viewing progress is applied only when its `last_watched_at` is
newer. An absent session does not delete existing progress. AI-only video
analysis remains local. The Video relation uses `youtube_id`, never local
Video ID. `folder_sync_uuid` is a portable relation, never local Folder ID.

**Folder snapshot or upsert**

```json
{
  "schema_version": 1,
  "operation_id": "b94a07d7-39c5-4089-9de4-6b5316e6602c",
  "source": {
    "installation_id": "ec08194e-33fa-48e8-92c7-5628351b2c04",
    "sequence": 842
  },
  "entity": "folder",
  "bridge_mapping_id": null,
  "sync_uuid": "658e1bd2-7093-47e8-9db0-831e0bf2da93",
  "source_revision": 3,
  "base_revision": 1,
  "deleted": false,
  "created_at": "2026-10-29T08:01:00Z",
  "updated_at": "2026-11-02T09:00:00Z",
  "data": {
    "name": "Algorithms",
    "description": "Notes about algorithms.",
    "parent_sync_uuid": "b6c23ec1-60dc-42df-9e18-316fb5ba553d"
  }
}
```

Create/apply parent folders before children. `parent_sync_uuid: null` denotes
a root. A move is a revisioned Folder update to `parent_sync_uuid`; reject a
move that creates a cycle, crosses owners, or violates the destination's
same-parent name uniqueness constraint. Do not silently rename on a collision.

**Tombstone**

```json
{
  "schema_version": 1,
  "operation_id": "4cfb395e-5b58-462b-b767-dc216af05521",
  "source": {
    "installation_id": "ec08194e-33fa-48e8-92c7-5628351b2c04",
    "sequence": 843
  },
  "entity": "folder",
  "sync_uuid": "658e1bd2-7093-47e8-9db0-831e0bf2da93",
  "source_revision": 4,
  "base_revision": 3,
  "deleted": true,
  "deleted_at": "2026-11-08T20:00:00Z",
  "deletion_reason": "user"
}
```

`deletion_reason` is proposed provenance, not permission to reproduce local
database cascades. Never include a local integer ID as a sync field.

**Portable Note fields:** sync UUID; title; complete document JSON; transitional
legacy content; note type; timestamp seconds; Folder UUID reference; Video
YouTube ID and common Video metadata/transcript; the authenticated user's
viewing position; source creation/update timestamps as provenance; revision
and deletion metadata.

**Portable Folder fields:** sync UUID; name; description; parent Folder UUID;
source creation/update timestamps as provenance; revision and deletion
metadata.

**Local-only fields:** all Django PKs and FK IDs; local User ID and account
profile/auth fields; computed `folder_path`, `video_detail`, and breadcrumbs;
AI-only `analysis_status`/`VideoAnalysis`; AI chunks/embeddings, questions,
conversations, and processing state.

### 4. Revision and conflict-resolution rules

**Proposed revision semantics**

1. Each live entity has a monotonically increasing integer revision in each
   receiving database. A change to any portable field, including Folder
   assignment or Folder parent, increments that database's revision.
2. `source_revision` identifies the snapshot version in the sending
   installation. It is not compared numerically with the receiver's revision.
3. `base_revision` is the receiver-local revision that the sender last
   observed and acknowledged for this UUID. For a create it is `null`, and the
   receiver must confirm the UUID is absent. A sender must not guess it.
4. On push, lock/check the receiver's sync state and compare `base_revision`
   to its current revision. If equal, validate and apply atomically, increment
   the receiver revision, write the change log and return the new receiver
   revision. If unequal, do not overwrite.
5. After receiving an accepted response, the sender persists the returned
   receiver revision as the next `base_revision` for that peer/entity. When
   pulling a peer change, the response's `source_revision` is that peer's
   current local revision and updates the sender's remembered peer revision
   after successful apply.
6. Track the last accepted `source_revision` per entity and source
   installation. A repeated or older source revision cannot overwrite newer
   state. Event sequence and per-operation deduplication handle replay even
   when the payload is retried.
7. A simultaneous update is detected when both sides changed since the last
   acknowledged base: the second arrival fails the base comparison and
   returns a conflict. Do not use last-write-wins, timestamp ordering, or
   automatic merging of document blocks.

For existing records whose corresponding remote revision is unknown, the
base is **unknown**, not zero. Require a completed reconciliation/bootstrap
baseline or return a `baseline_required` conflict. Do not make a destructive
guess.

**Idempotency and provenance:** require an `operation_id` unique within
authenticated owner and peer/device scope. Persist the request hash and
completed result. Retrying the same ID and same body returns the original
result; reusing that ID with a different body returns
`409 idempotency_key_reused`. Record the authenticated owner, source and
destination installations, source event sequence/revision, operation ID,
and origin installation/operation for every accepted change. These fields
come from the authenticated peer protocol and server records, not an
untrusted client assertion. Duplicate source sequences/record revisions are
acknowledged without applying the mutation a second time. Installation
sequence gaps are valid (for example, events for another owner are filtered
out); sequence gaps alone are not errors. A lower already-accepted per-record
source revision is stale and must not overwrite newer state. A cursor replay
is safe and idempotent.

**Conflict response proposal (`409 Conflict`)**

```json
{
  "code": "revision_conflict",
  "conflict_id": "7ffcf30e-7144-4f4a-a900-6391f18d915c",
  "entity": "note",
  "sync_uuid": "1fa73ad8-8060-4fc6-a58c-29664d1120c7",
  "reason": "receiver_changed_since_base",
  "expected_base_revision": 4,
  "current_revision": 5,
  "current": {
    "title": "Binary search (edited here)",
    "document": {"version": 1, "blocks": []},
    "folder_sync_uuid": null,
    "video_youtube_id": "dQw4w9WgXcQ"
  },
  "incoming_source_revision": 9
}
```

Include only the authenticated user's current state. The client must preserve
the incoming draft and current snapshot, then let the user choose/merge and
submit a new operation based on the newly observed revision. Folder name
collisions, UUID owner collisions, invalid folder moves, missing dependencies,
and deletion-vs-edit are distinct conflict reasons; never expose another
user's current data.

### 5. Durable change log and cursors

**Proposed server-side records (conceptual, not existing models)**

- `SyncInstallation`: server-generated UUID and protocol/schema version.
- `SyncDevice`: authenticated local owner, device UUID, creation/last-seen,
  revocation state.
- `SyncEntityState`: local owner, entity kind, portable UUID, current local
  revision, deletion state/time, and per-peer last acknowledged revision.
  Keep it independent of the Note/Folder FK so it survives deletion.
- `SyncChange`: installation-scoped monotonically increasing sequence,
  owner, entity kind/UUID, revision, full portable snapshot or tombstone,
  origin installation/operation, and creation time. Store enough data to
  serve a later pull even after the Note/Folder row is gone. Keep received
  origin metadata so a change accepted from the peer is never re-emitted to
  that same peer as a new independent edit. The accepted state remains
  available for local UI and any other authorized future peer.
- `SyncOperation`: owner, peer/device scope, operation UUID, request hash,
  origin metadata, and result for idempotent retry.
- `SyncCursor`: owner, device, source installation, acknowledged sequence,
  protocol/snapshot epoch, and update time.

A transaction that accepts a local or incoming change should persist the
entity update, revision, idempotency result, and durable change event
atomically. If the Note/Folder row is hard-deleted, retain the tombstone in
sync state/change history. Include origin information so an accepted incoming
change can be deduplicated and not endlessly echoed to its source; still make
the resulting state available to other authorized local devices.

Generate one operation ID per logical change and reuse it with the identical
payload for every retry. A receiving backend records the source operation
and installation as provenance. When that change later appears in the
receiver's feed, the source must recognize its own origin and not reapply or
republish it as a new change. The change remains visible in receiver history.

Both a per-record revision and a monotonically increasing change sequence are
needed. Revision detects stale/conflicting edits to one object. Sequence plus
an opaque cursor enables resumable, ordered pagination across multiple
objects/deletions and prevents a client from relying on wall-clock ordering.
Sequence gaps caused by other users' events are valid; cursors are always
scoped by owner, device, and source installation.

On each page, return a stable `next_cursor` and ordered events. Acknowledge a
cursor only after the client durably applies or records a conflict for every
item in the page. A conflict must not silently disappear; the client may
advance after storing it in a durable conflict queue that can be resolved
later. Cursor acknowledgment is not proof that the peer accepted every
mutation; push results are tracked separately.

### 6. Tombstones and relationship deletion

**Proposed deletion rules**

- A Note or Folder user deletion moves the database row to Trash and emits a
  full-snapshot tombstone in the same transaction. Peers retain the trashed
  row, sync UUID, and portable snapshot. After 30 days the row and note content
  are permanently purged; a compact tombstone remains so stale upserts cannot
  recreate the record. Schedule `python manage.py purge_expired_trash` at
  least daily in each backend.
- Restore is allowed only within the 30-day window, is a new higher-revision
  upsert, and retains the original sync UUID. If one side has a live record and
  the destination has a tombstone, show a deletion conflict; an explicit
  choice of the live side restores it at the destination. A folder restore
  restores the subtree and contained Notes that were trashed in the same
  batch; independently trashed descendants remain in Trash.
- A tombstone is propagated only for an explicit, identified user deletion
  accepted by the synchronization deletion policy. A missing row, cascade,
  failed lookup, or incomplete inventory is not evidence that the user
  deleted a record. If the source cannot prove a deletion's origin, stop and
  report a recoverable repair/conflict; never synthesize a remote delete.
- Folder Trash preserves parent/child and Note/Folder relationships. Each
  affected Folder and Note has its own revisioned tombstone and shared trash
  batch ID. Peer tombstones are applied without database cascades; restore
  decisions are explicit.
- Current database `CASCADE` on `Folder.parent` can delete descendants when a
  parent is deleted outside the API's leaf-only guard. Do not reproduce this
  cascade at the receiver. Recommended default: require explicit child
  moves/deletes and then parent deletion; otherwise return
  `folder_has_live_children`. If a local cascade occurs, capture and validate
  each affected record before committing a deletion event. If complete,
  explicit user intent cannot be established, do not propagate descendant
  tombstones; mark affected sync state for recovery and surface a conflict.
- Current database `CASCADE` from Video to Note is local storage behavior,
  not an instruction to delete the remote Note. A Video-cascade disappearance
  must not be sent as an ordinary user Note tombstone. Recommended default:
  reject or prevent Video deletion while portable Notes depend on it, or
  require an explicit user-confirmed detach/delete policy that records each
  affected Note change before the Video deletion. If an untracked cascade is
  detected, preserve the remote Note and surface a
  `source_dependency_deleted` repair conflict. Never cascade delete on a peer
  merely because its local Video row is absent.
- User deletion/account deprovisioning needs a separately approved policy:
  cascaded portable-record tombstones, account-level remote purge, or retention
  pending recovery. It must not be inferred from a missing JWT/user row.

Retain compact tombstones and change events indefinitely. Retain the full
trashed record for 30 days, then purge its content while preserving sync state.
Acknowledgments are tracked but do not trigger tombstone cleanup. A returning
device must reconcile against the current snapshot before stale data can
recreate a purged record.

### 7. Legacy record reconciliation

Each existing database's backfilled Note/Folder UUID is independent. The
bootstrap process must not equate records by integer ID, title, Folder name,
or path, and must not automatically push all unpaired rows as new records.

**Proposed workflow**

1. Authenticate on each backend and produce per-owner inventories containing
   sync UUIDs and only user-authorized comparison fields. Build candidates
   using multiple signals such as exact YouTube ID/timestamp, canonical
   document/content equality, creation-time proximity, and recursively
   matched parent context. Candidate scores only assist review; they are not
   identity proof.
2. Show candidate pairs to the user with enough differences to confirm, keep
   separate, or defer. Never pair on title alone. Do not merge any fields as
   a side effect of candidate generation.
3. On explicit confirmation, record an auditable pairing. If contents differ,
   preserve both snapshots and route through normal conflict resolution before
   either version overwrites the other.
4. If confirmed records have different UUIDs, preserve both and create the
   explicit, audited, one-to-one mapping defined in section 2. Never choose a
   replacement UUID, rekey a record, or merge their content as a side effect
   of pairing. If their snapshots differ, create a normal conflict.
5. If a record exists only in one app, user confirmation may adopt its
   complete portable snapshot into the other app while retaining the source
   UUID, provided no destination record or conflicting mapping exists. If
   user declines, leave it local and mark it deferred/unpaired; do not delete
   it.
6. Reconcile Folder trees parent-first. If a candidate parent is ambiguous,
   defer its descendants or leave them rooted only after explicit user choice.

No legacy record is deleted or rekeyed during pairing. Keep an audit trail of
both unchanged UUIDs, bridge mapping ID, owner identity key, peer
installations, confirmation actor/time, and content hashes or snapshots
sufficient for recovery. A one-sided record is portable only after its owner
elects to adopt/share it with the other application.

### 8. Proposed API endpoints and examples

These are new, proposed routes; they do **not** exist. The AI backend exposes
the user-facing bridge operations to its extension/dashboard and coordinates
calls to the Non-AI backend's peer-only sync API. The Non-AI peer API has no
user-facing bridge UI. PUSH sends AI-owned changes to the Non-AI backend;
PULL reads Non-AI changes and applies them in the AI backend. Neither
direction changes existing `/api/notes/`, `/api/folders/`, extension, or
dashboard CRUD contracts.

All routes require HTTPS and a verified `Authorization: Bearer <Supabase
access_token>`. Each backend verifies issuer, audience, signature, expiration,
and subject itself and scopes all rows to the resolved local User. For
AI-to-Non-AI calls, the Non-AI backend also requires independent peer
authentication. The AI backend forwards the user access token only over that
authenticated backend channel. Peer authentication is not a substitute for
the user's JWT. `device_id` identifies an enrolled sync stream but never
selects or authenticates the owner.

**Initial inventory/bootstrap**

`POST /api/sync/v1/bootstrap/` on the Non-AI peer API, called by the AI
backend for the authenticated user. The AI bridge may provide a corresponding
preview endpoint to the UI; the UI does not call the peer endpoint directly.

```json
{"device_id": "a61fd48d-0738-4451-b4ab-df21384309a2", "peer_installation_id": "ec08194e-33fa-48e8-92c7-5628351b2c04"}
```

Proposed response returns a `snapshot_id`, schema version, snapshot
high-watermark/cursor, page token, and portable Note/Folder records with
pairing status (`paired`, `unpaired`, `deferred`). Use a consistent snapshot
boundary so changes concurrent with pagination are later available from the
change feed. Do not auto-import independently backfilled/unpaired records;
return reconciliation candidates separately or through a dedicated
`POST /api/sync/v1/reconcile/` operation after user confirmation.

**Pull feed**

`GET /api/sync/v1/changes/?device_id=<uuid>&cursor=<opaque>&limit=100` on
the Non-AI peer API, called by the AI backend during PULL.

```json
{
  "schema_version": 1,
  "source_installation_id": "ec08194e-33fa-48e8-92c7-5628351b2c04",
  "events": [{"sequence": 841, "entity": "note", "sync_uuid": "1fa73ad8-8060-4fc6-a58c-29664d1120c7", "revision": 9, "deleted": false, "snapshot": {"title": "Binary search", "document": {"version": 1, "blocks": []}}}],
  "next_cursor": "opaque-owner-device-installation-epoch-sequence",
  "has_more": true
}
```

Use stable sequence ordering and bounded page size. Cursors are opaque,
validated, and bound to the authenticated owner, device, source installation,
and snapshot epoch. Reject tampered/foreign cursors. The `410 cursor_expired`
response triggers a new bootstrap, not a cursor reset that could miss deletes.

**Push batch**

`POST /api/sync/v1/changes/push/` on the Non-AI peer API, called by the AI
backend during PUSH.

```json
{
  "device_id": "a61fd48d-0738-4451-b4ab-df21384309a2",
  "changes": [
    {
      "operation_id": "30c8c978-9cb8-4e31-9ed1-8c99fb4ea431",
      "source_installation_id": "ec08194e-33fa-48e8-92c7-5628351b2c04",
      "source_sequence": 841,
      "entity": "note",
      "bridge_mapping_id": null,
      "sync_uuid": "1fa73ad8-8060-4fc6-a58c-29664d1120c7",
      "source_revision": 9,
      "base_revision": 4,
      "deleted": false,
      "data": {"title": "Binary search", "document": {"version": 1, "blocks": []}, "folder_sync_uuid": null, "video_youtube_id": "dQw4w9WgXcQ"}
    }
  ]
}
```

Return per-operation accepted/duplicate/conflict/invalid results. Accept
out-of-order dependencies only if the referenced Folder is already present;
otherwise return `dependency_missing` and let the client retry after pushing
the parent. Batch results are independent only if the batch explicitly allows
partial success; otherwise validate the whole batch and specify atomicity.
Recommended default is per-change atomicity with explicit per-item outcomes.

**Acknowledge pull cursor**

`POST /api/sync/v1/cursors/ack/`

```json
{"device_id": "a61fd48d-0738-4451-b4ab-df21384309a2", "source_installation_id": "ec08194e-33fa-48e8-92c7-5628351b2c04", "cursor": "opaque-owner-device-installation-epoch-sequence"}
```

Only acknowledge after every page item is applied or durably saved as a
conflict. A cursor ack advances delivery/retention state; it does not mark
pushes as accepted.

**Manual reconciliation (proposed)**

`POST /api/sync/v1/reconcile/` accepts an explicit user-confirmed pairing,
one-sided adoption, or keep-separate decision; carries both unchanged local
UUIDs (where both exist), peer installation IDs, the bridge mapping ID, the
selected action, and an idempotency key. It never accepts a user ID, changes
either existing UUID, applies no implicit content merge, and records an audit
event. The AI backend presents and records the user confirmation; both peers
must agree on a mapping before it is used.

**Error/retry contract**

- `400`: malformed payload/schema/relationship; correct the request.
- `401`: missing/invalid JWT; refresh/re-authenticate, never fall back to
  client-supplied identity.
- `403` or privacy-preserving `404`: unauthorized/unknown local object.
- `409`: revision, identity, uniqueness, dependency, or reconciliation
  conflict; preserve both versions and require resolution.
- `410`: cursor expired or snapshot epoch invalid; bootstrap/reconcile again.
- `413`: batch/payload too large; split while preserving dependency order.
- `429`, timeout, or `5xx`: exponential backoff with jitter and same
  operation IDs.

Keep the sync API versioned and separate from ordinary CRUD. Bound body/page
sizes, reject unsupported schema versions explicitly, and make retries safe
after a lost response by returning stored idempotency results.

### 9. Security considerations

- Require JWT verification against the configured issuer and audience in
  **each** backend; accept only the verified `sub` mapped to the local owner.
  If deployment issuers differ, stop cross-project sync until a separately
  approved account-linking flow exists. Never bridge accounts by email.
- Authenticate the AI-to-Non-AI backend connection separately from the user's
  JWT. Recommended production mechanism is mutual TLS with managed,
  independently rotatable peer certificates and server-side trust
  configuration. HMAC-signed, timestamped requests with nonces and rotation
  are an alternative if mutual TLS is operationally unavailable; a long-lived
  shared bearer secret is not recommended. Both mechanisms require replay
  protection and secret/certificate rotation. Final mechanism and operational
  ownership remain for approval.
- The AI backend must not treat a valid peer credential as proof of the user.
  Forward the user's access token only over the authenticated HTTPS peer
  channel; the Non-AI backend independently verifies it. Never place peer
  credentials in extension code, browser storage, API responses, logs, or
  sync records.
- Ignore or reject body fields that purport to identify the owner. Enforce
  owner-scoped lookups for UUIDs, revisions, operations, cursors, and conflicts.
- Do not let a caller claim another `installation_id`, advance another
  device's cursor, or replay a request under another owner. Bind enrolled
  device/cursor/operation state to the authenticated owner and revoke devices
  explicitly.
- Validate all fields, lengths, UUID formats, JSON limits, YouTube IDs,
  Folder ownership, parent existence, acyclic hierarchy, and destination
  uniqueness. Enforce expected-base checks and UUID-owner collision checks
  transactionally.
- Treat document text and unknown metadata as untrusted content. Preserve it
  for fidelity but do not execute or interpret it as instructions. Avoid
  logging full note documents, tokens, or personal data.
- Use TLS, rate limits, bounded page/batch sizes, audit logs, replay
  protection, and generic errors where necessary to avoid cross-user
  existence disclosure. Keep JWTs out of persistent sync records and logs.
- Apply imported Note changes only through a dedicated trusted sync service,
  not by widening the public CRUD serializer's writable `sync_uuid` field.

### 10. Failure scenarios and recovery

| Failure | Proposed behavior |
|---|---|
| Response lost after accepted push | Retry identical operation ID/body; return stored result without reapplying. |
| Network failure during pull page | Do not ack cursor; fetch/replay page and apply idempotently. |
| Stale base revision / simultaneous edits | Return 409 with current revision and authorized current snapshot; save incoming draft in conflict queue; user resolves. |
| Same operation ID, different body | Return 409; create a new operation ID after user/client correction. |
| Child arrives before parent | Return dependency-missing; retry parent-first. |
| Folder move creates cycle or name collision | Reject with structured conflict; preserve both trees; user moves/renames explicitly. |
| Note points to missing/deleted Folder | Do not silently drop relation or recreate a Folder by name; return dependency conflict or accept a separately approved explicit detach. |
| Peer Video row missing / source Video cascade | Do not delete the receiving Note; report dependency conflict and retain the YouTube ID for repair. |
| Tombstone races with edit | Revision mismatch; present delete-vs-edit conflict and require explicit delete/restore choice. |
| AI embedding/index provider unavailable | Commit accepted portable Note and durable local indexing-needed work separately; expose indexing status/retry locally. Do not turn a remote sync retry into duplicate Note changes. |
| Cursor expired after retention | Return 410; perform fresh snapshot/bootstrap and reconciliation before resuming incremental sync. |
| Database transaction fails | Return retryable server error; entity, revision, operation result, and log event must all roll back together. |
| User/issuer no longer valid | Stop sync; never infer or silently transfer ownership. Preserve local data pending account-resolution policy. |

The AI project's existing Note write path invokes indexing inline and surfaces
index failure as a failed request. For bridge imports, the approved direction
is a durable AI-local indexing-needed queue/outbox: commit the accepted Note,
sync revision/change, idempotency result, and indexing-needed work atomically;
index asynchronously and retry independently. Transfer success must not
depend on indexing success. The implementation uses a database-backed queue
with five attempts, exponential retry delays capped at one hour, and explicit
user requeue for exhausted jobs. Deployment scheduling and monitoring remain
operational work.

### 11. Approved rollout decisions and remaining approvals

The approved architecture is implemented in both backends and the AI
extension. Implementation defaults selected without changing existing auth
contracts or ordinary CRUD APIs are: HMAC-signed peer requests over HTTPS;
owner-scoped mappings stored on both backends and marked usable only after
peer confirmation; lossless transfer of both `document` and `content`; explicit
per-item transfer confirmation; explicit Keep AI / Keep Non-AI conflict
resolution; folder-parent-first transfer; a 50-record apply batch, 100-record
snapshot page, and 2,000-record inventory ceiling; one-day bootstrap snapshots;
and a database-backed AI indexing queue processed by a management command.
The user has approved HMAC with coordinated key rotation, indefinite compact
tombstone retention, 30-day Trash, current operation limits, scheduled
indexing with bounded retry/backoff, explicit whole-side conflict resolution,
Video repair handling, and restoring a trashed Folder subtree with its
contained Notes as one group.

The table records approved defaults and decisions that remain open. Approved
behavior is implemented unless identified as an operational deployment task.

| Decision | Alternatives and principal risks | Recommended default |
|---|---|---|
| Backend peer authentication | Keep HMAC-signed requests with nonce/timestamp and coordinated key rotation; migrate to mutual TLS; OAuth client credentials. HMAC secrets can be replayed or leaked if poorly managed; mTLS increases certificate operations; OAuth adds a service dependency. | **Approved:** HMAC with a shared secret of at least 32 characters, a five-minute timestamp window, one-use nonce, peer-installation pinning, and HTTPS outside localhost. Rotation must be coordinated; overlapping keys are unsupported. |
| Legacy identity mapping storage | Replicate mapping rows on both peers; keep an AI-owned registry. Replication can temporarily disagree; a sole registry adds a dependency. | Mirrored owner-scoped mappings are implemented, and sync uses them only after peer confirmation. Never rekey either record. Approve retention and operator recovery for a one-sided pending mapping. |
| `content` versus `document` divergence | Treat one as authoritative; preserve both and require user resolution. Choosing one may discard data. | Both are transferred; note document JSON is kept opaque. Decide whether mismatches should block transfer or continue to preserve both fields. |
| Conflict-resolution UI | Show both snapshots and require a choice; offer user-edited resolution; auto-merge selected metadata. Auto-merge can lose intent or corrupt document semantics. | **Approved:** Keep AI or Keep Non-AI after reviewing snapshots; edited/manual merge and automatic merge are out of scope. |
| Video deletion/cascade | Block deletion while Notes reference a Video; explicit detach/delete; mark cascade-disappeared Notes for repair. Protecting may change existing behavior; cascades can destroy rows. | **Approved:** retain repair handling; Video cascades do not emit sync tombstones. |
| Folder deletion | Trash the folder subtree and its contained Notes together; trash only an empty folder; or detach contents. Recursive trash needs group restore and expiry. | **Approved:** trash the active subtree and contained Notes as one 30-day restorable group; preserve relationships. |
| Account deletion/deprovisioning | Propagate tombstones/purge immediately; retain remote data for recovery; disable sync and defer cleanup to a reviewed account workflow. Immediate purge is destructive; indefinite retention creates privacy/compliance risk. | Stop sync when identity is invalid and preserve records pending an explicit account-deletion policy. No remote purge inferred from a missing user/JWT. |
| Device and stale-peer lifecycle | Treat the AI backend as the sole sync client; enroll separate browser devices; allow dormant devices indefinitely or expire/revoke them. Client-managed peer credentials widen exposure; indefinite cursors prevent tombstone cleanup. | Let the AI backend coordinate and own peer cursors; use device IDs only for user-visible client history if needed. Require explicit revocation and an agreed expiry/rebootstrap policy. |
| Trash and tombstone retention | Keep full data indefinitely; permanently purge after a fixed recovery window; or use a hybrid policy. | **Approved:** retain full Notes/Folders for 30 days, then purge their content while keeping compact sync tombstones indefinitely. Schedule `python manage.py purge_expired_trash` daily in both backends. |
| Batch semantics and limits | All-or-nothing batches; per-item transactions/results. Atomic batches simplify consistency but make retries and large transfers brittle; per-item handling can expose partial completion. | **Approved:** per-item atomicity, explicit outcomes, parent-first folder ordering, 50-operation apply batches, 100-record pages, 2,000-record bootstrap ceiling. |
| Bootstrap/adoption policy | Auto-adopt newly created one-sided records after pairing; confirm every one-sided record; selectable defaults by user. Auto-adoption can expose unexpected data in the other app; repeated prompts add friction. | Every transfer is previewed and explicitly confirmed; no auto-adoption. Approve any future opt-in auto-adoption behavior. |
| Protocol/schema compatibility | Single wire version; negotiated compatibility window. Single-version rollout can block deployments; long compatibility windows add testing and code paths. | Routes are versioned at `/api/sync/v1/`; payload capability negotiation is not implemented. Approve the rollout/minimum-peer-version policy before independent deployments. |
| Indexing worker/recovery details | Scheduled management command; application worker; synchronous indexing. Scheduling needs operations; worker infrastructure needs monitoring; synchronous indexing gates transfers. | **Approved:** schedule `process_sync_indexing_jobs` with bounded exponential retry/backoff. The command implements bounded retries; deployment scheduling and monitoring remain operational tasks. |

### 12. Implemented behavior and remaining work

- Both backends expose additive `/api/sync/v1/` bridge routes. The Non-AI
  project has peer-only endpoints; the AI project owns orchestration and the
  only user-facing Notes Bridge UI.
- Both sides independently verify the Supabase JWT and scope records to the
  resolved user. Peer HMAC authentication is separate, checks a pinned peer
  installation, timestamp, one-use nonce, signed path/body, and requires a
  32-character secret. Production URLs must use HTTPS.
- Preview uses a persisted, one-day bootstrap snapshot, explicit source and
  destination revisions, bounded inventory/pages, and per-item operation IDs.
  Confirmation revalidates the source revision/snapshot and the receiver
  checks the destination base revision before applying.
- Applies preserve Note document JSON, legacy content, Note type, timestamps,
  shared Video metadata/transcripts and the user's viewing position, and Folder
  relation/hierarchy by immutable `sync_uuid`; AI analysis, embeddings, chunks,
  and questions stay local.
- Confirmed identity mappings are audited on both databases. Conflict resolution
  is an explicit Keep AI / Keep Non-AI action, rechecks the current destination
  revision, and records the user choice. Before applying, each receiver compares
  the live Note/Folder against its tracked snapshot; drift or a repair flag is
  persisted as a conflict and the operation is rejected idempotently. Conflict
  choices remain blocked until both records are repaired. Parent Folders cannot
  be deleted while child Folders remain. Video cascades are surfaced for repair
  and never become deletion tombstones.
- Sync history, pending conflicts, peer acknowledgments, and AI indexing jobs
  are durable. Indexing uses the existing indexing service via the
  `process_sync_indexing_jobs` management command with bounded exponential
  retries and remains independent of transfer success.
- The new additive sync-bridge migration enriches existing tracked Video Note
  snapshots with Video metadata/transcripts and current user viewing position,
  advancing their revisions with auditable change events.
- Still to complete before production: automated deployment/rotation of peer
  secrets and peer installation IDs; schedule and monitor the indexing command;
  change-feed/cursor-driven incremental sync (the current UI uses bounded
  snapshots); and end-to-end testing against two isolated, configured service
  instances. Tombstones are intentionally retained indefinitely, and edited
  conflict merges are outside the approved scope.

### Deployment configuration

After review, apply the new additive migrations independently in each
deployment. Do not copy or share databases. Generate one high-entropy secret
of at least 32 characters and configure the same value as
`NOTES_SYNC_PEER_SECRET` on both backends. Coordinate rotation on both sides;
the current implementation does not support overlapping old/new keys.

After migrations, obtain each database's pinned installation UUID with:

```text
python manage.py show_sync_installation_id
```

On the AI backend configure:

- `NOTES_SYNC_PEER_URL`: HTTPS base URL of the Non-AI backend.
- `NOTES_SYNC_PEER_SECRET`: shared HMAC secret.
- `NOTES_SYNC_PEER_INSTALLATION_ID`: Non-AI installation UUID.

On the Non-AI backend configure:

- `NOTES_SYNC_PEER_SECRET`: same shared HMAC secret.
- `NOTES_SYNC_PEER_INSTALLATION_ID`: AI installation UUID.

The existing Supabase project/audience settings must independently validate
the same user's JWT on both deployments. Keep the peer secret server-side;
never put it in extension settings or requests from the browser. Schedule
`python manage.py process_sync_indexing_jobs` on the AI backend to process
recoverable indexing jobs; until a scheduler is configured, transfer success
is unaffected but queued indexing work remains pending.

### Implemented version-1 API contract

The browser can call only the AI-backend user API through the extension
background context; it cannot send peer credentials or call the Non-AI backend
directly.

| Backend | Route | Method | Purpose |
|---|---|---|---|
| AI user API | `/api/sync/v1/status/` | GET | Connection, sync history, and indexing-job status. |
| AI user API | `/api/sync/v1/preview/` | POST | `{"direction":"push"|"pull"}`; creates a durable read-only plan. |
| AI user API | `/api/sync/v1/identities/` | GET | Owner-scoped candidates for manual legacy mapping. |
| AI user API | `/api/sync/v1/runs/{run_id}/confirm/` | POST | `{"operation_ids":[...]}`; executes selected new/updated operations. |
| AI user API | `/api/sync/v1/runs/{run_id}/retry-acknowledgments/` | POST | Retries saved peer-revision acknowledgments. |
| AI user API | `/api/sync/v1/conflicts/` | GET | Lists open conflicts and both snapshots. |
| AI user API | `/api/sync/v1/conflicts/{id}/resolve/` | POST | `{"choice":"keep_ai"|"keep_non_ai"}`; rechecks revisions before explicit replacement. |
| AI user API | `/api/sync/v1/reconcile/` | POST | Records direction, entity, AI UUID, Non-AI UUID, and `pair`, `defer`, or `separate`. |
| AI user API | `/api/sync/v1/indexing/` | GET/POST | Lists recoverable jobs or requeues failed AI indexing work. |
| Non-AI peer API | `/api/sync/v1/peer/snapshot/` | GET | Stable inventory pages; 100 records/page, 2,000 total, 24-hour snapshot. |
| Non-AI peer API | `/api/sync/v1/peer/changes/` | GET | Signed owner/peer-bound change cursor; not yet used by orchestration. |
| Non-AI peer API | `/api/sync/v1/peer/apply/` | POST | Applies 1–50 independently idempotent changes per request. |
| Non-AI peer API | `/api/sync/v1/peer/reconcile/` | POST | Confirms the same owner-scoped legacy mapping ID on the peer. |
| Non-AI peer API | `/api/sync/v1/peer/acknowledge/` | POST | Records the latest peer revision monotonically. |

Each apply change carries `operation_id`, `entity`, source `record_uuid`,
optional confirmed `mapping_id`, `source_revision`, receiver
`base_revision`, the portable `snapshot`, and `deleted`. The full `document`
and legacy `content` are preserved. Folder and parent relations are mapped by
UUID and folders are ordered parent-first. Video Notes include a Video
snapshot (title, channel fields, thumbnail, duration, transcript fields, and
timestamps) and the user's viewing session; AI-only analysis is not copied.

Peer authentication signs
`METHOD + newline + full request path/query + newline + Unix timestamp + newline
+ nonce + newline + SHA-256(body)`. It uses `X-Bridge-Installation`,
`X-Bridge-Timestamp`, `X-Bridge-Nonce`, and `X-Bridge-Signature` headers. The
receiver checks the pinned installation ID, shared secret, five-minute clock
window, and one-use nonce before independently verifying the user's Supabase
JWT. Identical operation IDs with identical bodies return the stored result;
reusing an ID with a different body conflicts. Per-user row locking serializes
concurrent apply requests.

## Planned protocol principles

- Keep both Django applications and databases independently operable.
- Keep the Notes Bridge UI and operation controls in the AI project only;
  have the AI backend call the Non-AI backend directly.
- Use verified Supabase identity, never client-supplied user IDs, for access
  control, and authenticate the backend peer separately.
- Preserve existing `sync_uuid` values and pair differing legacy identities
  only through explicit, audited mappings.
- Preserve note documents and unknown block data losslessly.
- Define folder UUID relationships explicitly before syncing folder trees.
- Make create/update retries idempotent and scope every operation to the
  authenticated owner; retain origin provenance to prevent loops.
- Use revisions and durable change tracking; never silently overwrite
  conflicts, and never infer deletion from a cascade or missing row.
- Keep AI-derived data local; make post-import indexing recoverable and
  independent of transfer success.

## Phase tracking

- **2A.1 — Stable identifiers:** implemented for Note and Folder in both
  projects, including independent backfill migrations.
- **2A.2 — UUID immutability:** implemented using model save guards and tests.
- **2A.3 — Authentication and identity verification:** current verified JWT
  flow documented; API-level HS256/JWKS and invalid-token tests are added in
  both projects. No authentication contract change is introduced.
- **2A.4 — Synchronization model audit:** completed; findings and Phase 2A.5
  scope are documented above. No application behavior was changed.
- **2A.5.1 — Synchronization protocol design:** revised to incorporate the
  approved direction above; implementation details and remaining approvals
  are listed in sections 11 and 12.
- **2A.5.2 — Synchronization metadata:** implemented additively in both
  backends; new migrations are unapplied to persistent databases.
- **2A.6 — Synchronization API:** implemented baseline peer and orchestration
  endpoints; production configuration and live two-instance verification
  remain.
- **2A.7 — Conflict resolution:** explicit Keep AI / Keep Non-AI implemented;
  edited/manual merge and operational recovery policies remain.
- **2A.8 — Browser extension integration:** AI-only preview, confirmation,
  history, conflict review, identity pairing, and indexing status UI
  implemented.
- **2A.9 — End-to-end verification:** isolated backend and extension checks
  pass; two-instance integration tests and deployment checks remain.
