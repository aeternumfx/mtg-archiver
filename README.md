# mtg-archiver

A self-hosted web application for cataloging, managing, and tracking a Magic: The Gathering card collection.

## Features

- **Search & browse** — full Scryfall card database, local (no API calls after initial sync). Arena/Alchemy-only cards are hidden (paper-focused)
- **Collection management** — add, edit, move, delete cards with quantities, conditions, foil tracking; per-copy subcards, shift-select, ghost cards for wantlist items
- **Locations** — binders, boxes, decks, and **Collection goals** (collect specific cards or whole sets with progress + cost to complete), grouped into sections
- **Decks** — build and manage decks, commander/partner/background support, legality checker, bracket estimate, ghost (required) cards, deck stats
- **Wantlist** — add wanted cards (specific printing or generic), destination on acquire, **fulfil externally** (add new card) or **fulfil internally** (use an existing copy), collection-goal support
- **Organize** — schedule and resolve card movements between locations, move history with undo tracking
- **Trades** — track trades with split panels, card values, and cash
- **Dashboard** — collection value over time, rarity/condition/location breakdowns, unrealized P&L
- **Booster Opener** — log pack openings, track value vs cost, add pulls to collection
- **Undo system** — global undo toasts (bottom-right, countdown, dismissible) that persist across pages
- **Onboarding** — a welcome tour on first sign-in (re-triggered after a full reset, or via Settings → Replay Intro Tour)
- **Multi-user** — each user gets their own private, isolated database; accounts are provisioned by a central admin (enrollment model, no public signup)
- **Admin console** — create users, reset passwords, enable/disable or permanently delete accounts
- **Scheduler** — all outbound API calls are centralized in one job scheduler (Scryfall bulk sync runs on a single-flight, staleness-aware schedule)
- **Image proxy** — card images are served through the server with a disk cache, so clients never hit the Scryfall CDN directly
- **Scryfall Sync** — automatic daily sync of card data and prices (gzipped JSONL format), stored once in a shared catalog
- **Export/Import** — full backup of your collection, wantlist, decks, trades, and history as JSON; restore or merge later (per user)
- **Themes** — Light, Dark, and Galaxy UI themes

## Quick Start

### Prerequisites

- Node.js 22+
- npm (comes with Node)

### Install & Run

```bash
# Clone the repo
git clone https://github.com/your-username/mtg-archiver.git
cd mtg-archiver

# Install dependencies (Node 22+ recommended)
npm install

# Start development servers (client + server with hot reload)
npm run dev
```

The app will be available at **http://localhost:5173** (Vite dev server proxies API to port 3001).

> **Note for nvm users:** use Node 22 via `nvm use 22` before running `npm run dev` / `npm run build`.

### Production Build

```bash
npm run build
npm start
```

Serves the built frontend from Express at **http://localhost:3001**.

### Docker

```bash
# Build and run with docker compose
docker compose up -d --build   # http://localhost:3001, data stored in ./data

# Or build + run manually
docker build -t mtg-archiver .
docker run -d -p 3001:3001 -v $PWD/data:/app/data --name mtg-archiver mtg-archiver
```

- `DATA_DIR` (default `/app/data`) controls where all data lives; mount a volume there so it persists.
- `PORT` (default `3001`) changes the listen port.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP listen port |
| `DATA_DIR` | `./data` (or `/app/data` in Docker) | Root data directory |
| `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD` | `admin` / `admin` | Creates the first admin on first boot (only when no users exist). **Change the default password after first sign-in.** |
| `SESSION_TTL_DAYS` | `30` | How long a sign-in session lasts |
| `COOKIE_SECURE` | `false` | Set `true` to mark the session cookie `Secure` (use behind HTTPS) |
| `ALLOWED_ORIGINS` | — | Comma-separated list of allowed CORS origins (defaults to same-origin only) |
| `SCRYFALL_STALE_HOURS` | `24` | How stale the card catalog must be before the scheduler re-downloads the full Scryfall bulk file. The lightweight sets list refreshes hourly on its own. |

You can also create the first admin from the command line:

```bash
npm run create-admin -w server -- --username admin --password 'a-strong-password' --role admin
```

### Building a release artifact (for GitHub releases)

```bash
./release/build-docker.sh            # uses current git tag, or "dev"
./release/build-docker.sh v0.1.0     # specify a version
```

This builds the image and packages it into `release/mtg-archiver-<version>.zip`
— a self-contained "run pack" containing the Docker image, a `docker-compose.yml`,
a `load.sh`/`load.bat`, and a beginner-friendly `README.txt`. Attach the `.zip`
to a GitHub release.

**End users install it like this (no source code needed):**

*Easiest (click, no typing):* unzip → **drag the `.tar` onto the Docker Desktop
window** to load the image → open Docker Desktop → Images → click Run on
`mtg-archiver` → set the host port to `3001` → open `http://localhost:3001`.

*Or from a terminal:* unzip → `sh load.sh` (Windows: `load.bat`) → `docker compose up -d`
→ open `http://localhost:3001`. Their data is stored in a `data/` folder next to the
compose file, so upgrades and backups carry over.

## First Run

On first startup, the app downloads the Scryfall bulk data file (~73 MB compressed, ~530 MB uncompressed, ~116,000 cards) once into the **shared catalog**. This takes 30-60 seconds. Subsequent startups only sync if data is older than 24 hours. Users do not download anything — they all read the one shared catalog.

Before anyone can sign in you need an admin account. Either set `INITIAL_ADMIN_USERNAME`/`INITIAL_ADMIN_PASSWORD` before the first start, or run the `create-admin` script above. Then:

1. Sign in as the admin.
2. Use the **Admin** page (user menu → Admin) to create accounts.
3. Share each user's one-time temporary password with them; they'll set their own password on first sign-in.

## Project Structure

```
mtg-archiver/
├── client/          # React SPA (Vite + Mantine + Recharts)
│   └── src/
│       ├── pages/       # Route pages (incl. landing, login, admin)
│       ├── components/  # Shared components
│       ├── auth/        # Auth context, route guards, password change
│       ├── api/         # API client
│       └── types/       # TypeScript interfaces
├── server/          # Express API (Drizzle ORM + better-sqlite3)
│   └── src/
│       ├── routes/      # API endpoints (auth, admin, user data, images)
│       ├── services/    # Scryfall sync, card catalog hydration, image proxy
│       ├── scheduler/   # Centralized job scheduler
│       ├── auth/        # Passwords, sessions, middleware, user management
│       └── db/          # System + per-user connections, schema, init
└── data/            # All data (created on first run)
```

## Data

Data is split across two SQLite tiers under `DATA_DIR`:

- `system.db` — shared read-only card catalog (`scryfall_cards`, `sets`), the sync scheduler state, and auth (`users`, `sessions`).
- `users/user_<id>.db` — one database **per user**, holding their locations, decks, collection, wantlist, trades, boosters, and movement history. Users can only ever read/write their own file.
- `images/` — cached card images fetched through the proxy.

**Back up regularly** by copying the whole `DATA_DIR` folder, or use Settings → Export Data (per user) for a portable JSON backup.

## Updates & backups

- **Admin → Updates** page: shows the current version, checks the GitHub releases for the latest tag, lets you **back up & download** (a consistent, user-data-only zip of `system.db` + every per-user database — no Scryfall catalog or image cache), **restore from a backup** (overwrites all data; requires typing `RESTORE` to confirm), and trigger an update.
- **Updating**: the in-app button downloads a local copy, has the server back up internally (to `data/backups/`), then pulls and recreates the container — but only if you've opted in by mounting the Docker socket and compose file and setting `ENABLE_IN_APP_UPDATE=true`. Otherwise it shows the manual fallback: `./update.sh` (i.e. `docker compose pull && docker compose up -d`). The release zip ships `update.sh` and `backup.sh`.
- A dismissible **update-available** banner appears in the admin view when a newer release is found.

> **Security note:** enabling in-app auto-update mounts `/var/run/docker.sock` into the container, which gives the app host-level Docker control. Use the host `update.sh` if you prefer not to.

## Security notes

- Passwords are hashed with scrypt (salted, per-user).
- Sessions use random opaque tokens stored hashed in the DB, delivered in `httpOnly` cookies (`SameSite=Strict`; `Secure` with `COOKIE_SECURE=true`).
- All `/api/*` routes except login require authentication; `/api/admin/*` requires the admin role.
- Login is rate-limited to mitigate brute forcing.
- Helmet security headers and a restrictive CORS policy are enabled by default.

## Alpha Status

This is alpha software. Features may change, and data migration between versions is handled manually via export/import. Always export your data before updating.
