> **Try the live application:** [https://youtube-note-veif.onrender.com/](https://youtube-note-veif.onrender.com/)

# YouTube Notes

YouTube Notes is a learning workspace for capturing and organizing notes while watching YouTube videos or reading web pages. This is the **non-AI version** of the project: it helps you collect and revisit learning material without AI-generated answers or summaries.

## Why this application?

Useful ideas from a video or article are easy to lose: notes end up in separate documents, timestamps are forgotten, and it can be difficult to find the original source later. YouTube Notes keeps notes connected to the content they came from and gives you one place to organize and revisit them.

## How it works

The Chrome extension adds a sidebar to YouTube watch pages and supported web pages. From there, you can create and revisit notes without leaving what you are reading or watching. Notes and saved content are associated with your account and are available in the dashboard, where you can organize, search, and browse your learning library.

## Features

- **YouTube notes:** Create and manage notes connected to a video, including timestamped notes.
- **Web-page notes:** Save notes against a page URL and browse them by website and URL path.
- **Rich note content:** Keep structured content such as headings, lists, checklists, tables, code, images, links, screenshots, and page positions.
- **Video library:** Browse saved videos, view transcript availability, and sort or filter your collection.
- **Transcripts:** Fetch and read available YouTube transcripts, copy transcript text, and view it alongside video notes.
- **Local transcript translation:** Translate transcripts in supported recent Chrome or Edge browsers using the browser's on-device translation capability. No translation API key is required.
- **Folders and playlists:** Group notes into folders and videos into playlists.
- **Search and organization:** Find notes and videos in the dashboard and browse web notes by source.
- **Trash and recovery:** Restore deleted notes, folders, and playlists within the 30-day retention period, or permanently delete them.
- **Account management:** Sign in with email or Google through Supabase, reset or change your password, and manage your username.

## Technologies

- **Frontend and browser extension:** React, TypeScript, Vite, and Chrome Extension Manifest V3
- **Backend and API:** Python, Django, and Django REST Framework
- **Authentication:** Supabase Auth with JWT authentication
- **Database:** Supabase PostgreSQL
- **YouTube data:** `youtube-transcript-api` for captions and transcripts; `yt-dlp` for YouTube-related metadata
- **Static files and deployment:** WhiteNoise and Gunicorn

## Run locally

### Prerequisites

- Python 3.12 or newer
- Node.js compatible with Vite 8 (Node.js 20.19+ or 22.12+)
- A Supabase project with its PostgreSQL connection details and Auth configured
- Google Chrome (if you also want to load and use the browser extension)

The backend is configured to connect to Supabase PostgreSQL; it does not use a local SQLite database. You will need a reachable Supabase database for the app to run.

### 1. Configure the backend

From the project root, create a Python environment, install dependencies, and copy the backend environment template:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` and set at least:

- `SECRET_KEY`: a newly generated Django secret key.
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, and `DB_PORT`: your Supabase PostgreSQL connection details. Use the Supabase pooler or database host and keep `DB_SSLMODE=require`.
- `SUPABASE_URL`: your Supabase project URL.

Keep database credentials and Django secrets private. Do not put them in frontend `VITE_` variables or commit your `.env` file.

### 2. Configure and build the dashboard

In a second terminal, from the project root:

```powershell
cd extension
npm ci
Copy-Item .env.example .env.local
```

Edit `extension/.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` using the public client values from your Supabase project. These are used by the frontend for account sign-in; never use a Supabase service-role key here.

Build the web dashboard into the Django static files directory:

```powershell
npm run build:web
```

### 3. Apply migrations and start Django

In the backend terminal, from `backend` with the virtual environment active:

```powershell
python manage.py migrate
python manage.py runserver
```

Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/) to use the local dashboard. Create or sign in to an account through the Supabase Auth project configured above.

### 4. (Optional) Load the Chrome extension

The extension adds the sidebar to YouTube and supported web pages. In the extension terminal, create a local production build:

```powershell
npm run build
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/dist`. Set `VITE_DJANGO_API_ORIGIN` in `extension/.env.local` to your backend URL (for example, `http://localhost:8000`) before building. The dashboard web build and the Chrome extension build are separate; use `npm run build:web` for the Django-hosted dashboard and `npm run build` for the browser extension.

## AI version

To explore the AI version of this project, visit [youtube_note_extension](https://github.com/Sainath8910/youtube_note_extension). It builds on the note-taking workflow with features including:

- **Retrieval-Augmented Generation (RAG):** Retrieve relevant material from your saved knowledge when answering questions.
- **Chat conversations:** Ask follow-up questions and continue conversations about your learning content.
- **Previous Context Manager:** Preserve and surface relevant context from earlier work and conversations.
