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
- **Onboarding** — a welcome tour on first run (re-triggered after a full reset, or via Settings → Replay Intro Tour) that offers a demo instance, a recommended setup, or a blank slate
- **Scryfall Sync** — automatic daily sync of card data and prices (gzipped JSONL format)
- **Export/Import** — full backup of your collection, wantlist, decks, trades, and history as JSON; restore or merge later
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

## First Run

On first startup, the app downloads the Scryfall bulk data file (~73 MB compressed, ~530 MB uncompressed, ~116,000 cards). This takes 30-60 seconds. Subsequent startups only sync if data is older than 24 hours.

If you don't want to wait, you can skip the sync and use the app immediately — the sync runs in the background and your collection works without it.

## Project Structure

```
mtg-archiver/
├── client/          # React SPA (Vite + Mantine + Recharts)
│   └── src/
│       ├── pages/       # Route pages
│       ├── components/  # Shared components
│       ├── api/         # API client
│       └── types/       # TypeScript interfaces
├── server/          # Express API (Drizzle ORM + better-sqlite3)
│   └── src/
│       ├── routes/      # API endpoints
│       ├── services/    # Scryfall sync
│       └── db/          # Schema, migration, connection
└── data/            # SQLite database (created on first run)
```

## Data

All data is stored in a local SQLite file at `data/mtg.db`. The Scryfall card database is ~270 MB. Your collection, locations, decks, wantlist, trades, and settings are stored in the same file.

**Back up your data regularly** using Settings → Export Data. The backup includes everything (collection, locations, decks + ghost cards, wantlist + collection goals, trades, boosters, and movement history). You can restore it later with Import Data.

## Alpha Status

This is alpha software. Features may change, and data migration between versions is handled manually via export/import. Always export your data before updating.
