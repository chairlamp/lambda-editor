<p align="center">
  <img alt="Lambda Editor" width="50%" src="logo.png" />
</p>

This is Lambda. My team's project for AI1220: a remake of Overleaf with AI features.

## Key Features

- **Role-aware collaboration** with `owner`, `editor`, and `viewer` permissions
- **Invite links** with a per-project limit and pre-assigned access role
- **Y.js-powered collaborative editing** with a dedicated FastAPI sync backend, Redis-backed CRDT state sharing, binary WebSocket transport, and conflict-free merges across all connected editors
- **Real-time project file sync** so document create, rename, and delete events update every connected client immediately
- **Monaco-powered LaTeX editor** with snippets, selection quoting, and insertion helpers
- **Built-in AI assistant** with tool-enabled chat for web search, research, translation, rewriting, equation insertion, error explanation, and structured document edits
- **Persistent AI chat history** stored per document in PostgreSQL and restored when collaborators reopen the file
- **AI tool trace visibility** so chat replies can show which tools ran and which sources were cited
- **Persistent AI consent acknowledgement** stored locally in the browser so users only need to accept the disclosure once
- **Version history** with named snapshots and one-click restore
- **PDF preview pipeline** that compiles LaTeX on demand and surfaces logs in the UI
- **Multi-format export** for rendered LaTeX output, including `PDF`, `DVI`, and `PS`
- **Shared PDF preview updates** so a fresh compile result is pushed to other clients viewing the same document
---

<p align="center">
<img width="100%" src="banner.png" />
</p>

---

## Tech Stack

| Area | Technology used |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Zustand, Monaco Editor |
| Backend | FastAPI, SQLAlchemy async, PostgreSQL, WebSockets |
| AI | Configurable OpenAI-compatible provider (`OpenAI` or `Groq`) for chat/generation, plus Google Cloud Translation API for translation tool calls |
| Auth | JWT access/refresh tokens delivered via HTTP-only cookies, with Redis-backed refresh-token rotation |
| Collaboration | Yjs CRDT (`pycrdt` on server, `y-websocket` + `y-monaco` on client), Redis-backed CRDT state/pub-sub, Redis pub/sub for presence and project events |
| Output | Rendered export to `PDF`, `DVI`, and `PS` via `pdflatex`, `xelatex`, `lualatex`, or `tectonic` |
| Default storage | PostgreSQL via `postgresql+asyncpg` |

## Setup

### Prerequisites

Before starting the app, make sure you have:

- `Python` 3.9+
- `Node.js` 18+ and `npm`
- `Docker` for the default local PostgreSQL and Redis setup used by `start.sh`
- A LaTeX compiler such as `pdflatex`, `xelatex`, `lualatex`, or `tectonic`
- An OpenAI or Groq API key if you want AI features enabled
- A Google Cloud Translation API key if you want the translation tool enabled

> **Note**
> The editor itself can run without AI, but AI endpoints require the provider-specific API key to be configured (`OPENAI_API_KEY` for `openai`, `GROQ_API_KEY` for `groq`).

### 1. Backend setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Update `backend/.env` with your values:

```env
SECRET_KEY=your-secret-key-change-in-production
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/lambda_editor
REDIS_URL=redis://localhost:6379/0
JWT_ALGORITHM=HS256
ACCESS_TOKEN_COOKIE_NAME=lambda_access_token
REFRESH_TOKEN_COOKIE_NAME=lambda_refresh_token
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=604800
AUTH_COOKIE_SECURE=false
AUTH_COOKIE_SAMESITE=lax
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_BASE_URL=https://api.openai.com/v1
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
GROQ_BASE_URL=https://api.groq.com/openai/v1
GOOGLE_TRANSLATE_API_URL=https://translation.googleapis.com/language/translate/v2
GOOGLE_TRANSLATE_API_KEY=
GOOGLE_TRANSLATE_SOURCE_LANGUAGE=auto
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

To use Groq instead of OpenAI, set:

```env
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
GROQ_MODEL=openai/gpt-oss-20b
GROQ_BASE_URL=https://api.groq.com/openai/v1
```

To create PostgreSQL table structure, apply the schema dump with:

```bash
psql postgresql://postgres:postgres@localhost:5432/lambda_editor -f backend/scripts/postgres_schema.sql
```

Then run the API server:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

This creates the current application tables in PostgreSQL: `users`, `projects`, `project_members`, `project_invites`, `documents`, `document_versions`, and `ai_chat_messages`.

### 2. Frontend setup

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

`frontend/.env.local` is optional for local development because Vite proxies `/api` to the backend by default. Use it when the frontend needs to talk to a deployed backend directly:

```env
VITE_API_BASE_URL=https://your-backend.example.com
VITE_WS_BASE_URL=wss://your-backend.example.com
```

### 3. One-command startup

If dependencies are already installed, you can use:

```bash
./start.sh
```

This script:

- starts PostgreSQL in Docker on port `5432`
- starts Redis in Docker on port `6379`
- activates `backend/venv`
- starts FastAPI on port `8000`
- starts Vite on port `5173`
- prints the database, cache, app, and API docs URLs

## Tests

### Backend and frontend unit/integration tests

```bash
cd backend
venv/bin/pytest -q

cd ../frontend
npm test -- --run
```

### Browser E2E tests

The Playwright suite covers the full bonus-path flow from registration/login through project creation, document opening, AI suggestion generation, and AI suggestion acceptance.

On first setup:

```bash
cd frontend
npm install
npm run e2e:install
```

To run the suite:

```bash
cd frontend
npm run test:e2e
```

The E2E harness starts:

- a local FastAPI backend on `127.0.0.1:8000`
- a local Vite frontend on `127.0.0.1:4173`
- SQLite storage at `/tmp/lambda_editor_e2e.db`
- in-process fake Redis
- a deterministic fake LLM provider so the AI diff flow is repeatable and does not require network access or external API keys

## Vercel Frontend Deployment

For a split deployment, the easiest shape is:

- frontend on Vercel
- backend on a service that supports long-lived WebSockets and Redis/PostgreSQL connectivity

The frontend no longer assumes the backend lives on the same origin. For a Vercel deployment:

1. Set the Vercel project root directory to `frontend`
2. Add these frontend environment variables in Vercel:

```env
VITE_API_BASE_URL=https://your-backend.example.com
VITE_WS_BASE_URL=wss://your-backend.example.com
```

3. Update the backend environment so browser auth cookies can be used from the deployed frontend:

```env
AUTH_COOKIE_SECURE=true
AUTH_COOKIE_SAMESITE=none
CORS_ORIGINS=https://your-frontend.vercel.app
```

`frontend/vercel.json` includes a SPA rewrite so deep links such as `/projects/:projectId/docs/:docId` resolve to the React app correctly.

## Render Backend Deployment

`render.yaml` provisions a free Render web service for the backend, a free Postgres database, and a free Key Value instance for collaboration state.

If you use the Blueprint:

1. In Render, create a new Blueprint from this repository
2. Provide `CORS_ORIGINS` during setup, for example:

```env
CORS_ORIGINS=https://lambdav2.vercel.app
```

3. Optionally provide:

```env
OPENAI_API_KEY=sk-...
GOOGLE_TRANSLATE_API_KEY=...
```

The backend now accepts Render's plain Postgres connection string format (`postgresql://...`) and automatically upgrades it to the async SQLAlchemy driver URL internally, so you can use Render's injected `connectionString` directly as `DATABASE_URL`.

## Implementation Notes

### How Y.js integrates with the backend

Y.js document syncing is handled by the backend directly rather than by a separate collaboration service. FastAPI exposes a dedicated binary WebSocket endpoint at `/ws/{doc_id}/sync`, and authenticated clients connect to it through `y-websocket` from the frontend.

For each open document, the backend creates or reuses a `pycrdt` `Doc` for the connected clients in that process, but the active CRDT state is shared through Redis instead of living only in process memory. On first connection, the room loads the latest merged CRDT update from Redis; if none exists yet, it seeds Redis from the document content stored in PostgreSQL.

Incoming Y.js updates are applied locally, merged back into Redis, and published over a document-scoped Redis pub/sub channel so other backend instances can apply and rebroadcast the same CRDT delta to their connected clients. PostgreSQL is still updated with debounced text snapshots so version history, reloads, and non-CRDT API reads continue to use the database safely.

The Y.js sync channel is separate from the existing JSON WebSocket channel at `/ws/{doc_id}`. The JSON socket still handles presence, cursor state, AI chat relay, and compile-result broadcasts, while the Y.js socket is responsible only for CRDT document content synchronization. Backend permission checks still apply at connection time, and `viewer` users are kept read-only by dropping sync updates server-side.

Version restore also flows through this backend integration. When a restore request updates `doc.content` through the REST API, the backend calls `invalidate_room(...)` in the Y.js handler, updates the Redis-backed CRDT state, and broadcasts the resulting delta so every connected editor across backend instances updates immediately.

<details>
<summary><strong>Collaboration model</strong></summary>

#### CRDT sync (`/ws/{doc_id}/sync`)

Document text is a **Yjs CRDT** (`Y.Text`). Every edit is encoded as an immutable, causally-ordered operation that can be merged with any concurrent operation without conflicts, so two users typing at the same point simultaneously always produces a correct, deterministic result - no reconciliation dialog, no last-write-wins data loss.

The implementation uses two WebSocket connections per open document:

| Connection | Path | Protocol | Purpose |
|---|---|---|---|
| JSON channel | `/ws/{doc_id}` | JSON text frames | Presence, cursors, AI chat relay, compile results, title |
| CRDT channel | `/ws/{doc_id}/sync` | Binary y-websocket protocol | Document text sync |

**Server side (`yjs_handler.py`)** - written in Python using `pycrdt` and Redis:
1. One `Doc` is kept per open document per process, but its state is hydrated from Redis on room startup instead of being authoritative only in local memory.
2. On client connect the server sends `[SYNC, STEP1, state_vector]`; the client responds with the updates it has that the server is missing, and the server replies with what the client is missing (`STEP2`). After this exchange both sides are identical.
3. Real-time edits arrive as `[SYNC, UPDATE, update_bytes]`, are applied with `Doc.apply_update(...)`, merged into the Redis-stored document update, and published over a per-document Redis channel.
4. Every process with clients in that document subscribes to the Redis channel, applies remote updates to its own `Doc`, and rebroadcasts them to its local websocket clients.
5. Saves are debounced (2 s) to avoid hammering PostgreSQL on every keystroke; a final save runs when the last client leaves.
6. `invalidate_room(doc_id, content)` updates Redis-backed CRDT state and broadcasts the resulting delta — called by the version-restore REST endpoint so all open editors on all backend instances receive the restored content.

**Client side** - uses the pre-installed `y-websocket` and `y-monaco` npm packages:
1. `WebsocketProvider` opens the binary CRDT channel and keeps it alive with automatic reconnection.
2. The provider is created immediately but `syncedYdoc` is only set (and therefore `MonacoBinding` only created) after the first `sync` event fires, ensuring Monaco never binds to an empty `Y.Text` while the initial sync is in flight.
3. `MonacoBinding` wires the `Y.Text` directly to the Monaco editor model - local keystrokes update `Y.Text` which propagates to peers; remote `Y.Text` updates are applied to the Monaco model as surgical `executeEdits` calls that preserve undo history and cursor position.
4. A `Y.Text` observer updates the Zustand store after sync so the PDF preview and AI chat always read the current content.

**AI-suggested edits** - when a user accepts a diff from the AI chat panel, `applyChange` and `handleAcceptAll` write directly into `Y.Text` via `ydoc.transact()`. Yjs broadcasts the change to all peers exactly like a manual keystroke.

**Version restore** - the REST handler updates `doc.content` in PostgreSQL, then calls `yjs_handler.invalidate_room` which rewrites the Redis-backed CRDT text state and broadcasts the resulting delta update to every connected client across all backend instances.

**Presence and cursors** still travel over the JSON channel and are rendered as Monaco editor decorations, unchanged from before.

- Project-scoped websocket rooms handle document lifecycle events (create, rename, delete) and are still backed by Redis pub/sub
- Users are admitted only if they belong to the parent project; viewer members are marked read-only and their `SYNC_UPDATE` messages are dropped server-side
- Compile results are rebroadcast over the JSON channel so collaborators see the latest PDF without manual refresh

</details>

<details>
<summary><strong>Compilation model</strong></summary>

- Source is written to a temporary directory as `document.tex`
- The backend checks for `pdflatex`, `xelatex`, `lualatex`, or `tectonic`
- The compile/export endpoint supports `pdf`, `dvi`, and `ps` output formats
- PDF output is shown inline in the preview panel, while `DVI` and `PS` exports download directly
- Output is returned as `{ success, pdf_base64, file_base64, file_name, mime_type, output_format, log }`
- Missing compiler binaries are surfaced with install guidance in the response log

</details>

<details>
<summary><strong>AI model behavior</strong></summary>

- Free-form chat uses a tool-enabled agent path backed by a configurable OpenAI-compatible Responses API provider
- The agent can use built-in web search plus custom `research_topic` and `translate_text` tools
- Translation tool calls are handled with Google Cloud Translation instead of the language model directly
- LaTeX commands, environments, refs, citations, and math are masked before translation and restored afterward
- Chat replies can show both cited sources and tool calls used during the response
- Streaming endpoints send Server-Sent Events to the client
- Diff endpoints ask the model for strict JSON so the frontend can review edits safely
- Document context is clipped before sending to the model to keep prompts bounded
- AI chat history is persisted server-side: user prompts are written from authenticated websocket events, and assistant replies/diffs are written by the AI API after generation completes
- Inline LaTeX in AI chat messages is rendered in the frontend with KaTeX
- The AI disclosure acknowledgement is persisted in browser local storage so the warning is not shown again after acceptance

</details>
