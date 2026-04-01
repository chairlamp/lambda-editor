<img alt="Lambda Editor" width="50%" src="logo.png" />

This is Lambda. My team's project for AI1220: a remake of Overleaf with AI features.

## Key Features

- **Role-aware collaboration** with `owner`, `editor`, and `viewer` permissions
- **Invite links** with a per-project limit and pre-assigned access role
- **Live collaborative editing** over WebSockets with presence and remote cursor indicators
- **Real-time project file sync** so document create, rename, and delete events update every connected client immediately
- **Monaco-powered LaTeX editor** with snippets, selection quoting, and insertion helpers
- **Built-in AI assistant** with tool-enabled chat for web search, research, translation, rewriting, equation insertion, error explanation, and structured document edits
- **Persistent AI chat history** stored per document in PostgreSQL and restored when collaborators reopen the file
- **AI tool trace visibility** so chat replies can show which tools ran and which sources were cited
- **Persistent AI consent acknowledgement** stored locally in the browser so users only need to accept the disclosure once
- **Version history** with named snapshots and one-click restore
- **PDF preview pipeline** that compiles LaTeX on demand and surfaces logs in the UI
- **Shared PDF preview updates** so a fresh compile result is pushed to other clients viewing the same document

<p align="center">
<img width="100%" src="banner.png" />
</p>

## Tech Stack

| Area | Technology used |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Zustand, Monaco Editor |
| Backend | FastAPI, SQLAlchemy async, PostgreSQL, WebSockets |
| AI | OpenAI Responses API for tool-enabled chat, OpenAI streaming for rewrite/generation actions, Google Cloud Translation API for translation tool calls |
| Auth | Redis-backed server-side sessions with HTTP-only cookies |
| Collaboration | Redis-backed websocket pub/sub, document sync, cursor presence, shared project events |
| Output | PDF compilation via `pdflatex`, `xelatex`, `lualatex`, or `tectonic` |
| Default storage | PostgreSQL via `postgresql+asyncpg` |

## Setup

### Prerequisites

Before starting the app, make sure you have:

- `Python` 3.9+
- `Node.js` 18+ and `npm`
- `Docker` for the default local PostgreSQL and Redis setup used by `start.sh`
- A LaTeX compiler such as `pdflatex`, `xelatex`, `lualatex`, or `tectonic`
- An OpenAI API key if you want AI features enabled
- A Google Cloud Translation API key if you want the translation tool enabled

> **Note**
> The editor itself can run without AI, but AI endpoints require `OPENAI_API_KEY` to be configured.

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
SESSION_COOKIE_NAME=lambda_session
SESSION_TTL_SECONDS=604800
SESSION_COOKIE_SECURE=false
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_BASE_URL=https://api.openai.com/v1
GOOGLE_TRANSLATE_API_URL=https://translation.googleapis.com/language/translate/v2
GOOGLE_TRANSLATE_API_KEY=
GOOGLE_TRANSLATE_SOURCE_LANGUAGE=auto
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
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
npm run dev
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

## Implementation Notes

<details>
<summary><strong>Collaboration model</strong></summary>

- Websocket fan-out uses Redis pub/sub so room broadcasts are not tied to a single process
- Presence and cursor state are stored in Redis instead of in-process memory
- The backend also maintains project-scoped websocket rooms for document lifecycle events
- Users are admitted only if they belong to the parent project
- Viewer members are explicitly marked read-only
- Targeted `replace` operations help avoid clobbering unrelated edits during AI-assisted changes
- File trees and project document lists subscribe to project events so create/delete/title changes stay synchronized across clients
- Compile results are rebroadcast over the document room so connected collaborators see the latest rendered PDF and log state without manual refresh

</details>

<details>
<summary><strong>Compilation model</strong></summary>

- Source is written to a temporary directory as `document.tex`
- The backend checks for `pdflatex`, `xelatex`, `lualatex`, or `tectonic`
- Output is returned as `{ success, pdf_base64, log }`
- Missing compiler binaries are surfaced with install guidance in the response log

</details>

<details>
<summary><strong>AI model behavior</strong></summary>

- Free-form chat uses a tool-enabled agent path backed by the OpenAI Responses API
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
