# Poker Tournament Manager

A combined web dashboard and Telegram bot for running multi-table poker tournaments. Tournament directors can drive blind level changes from the browser, while dealers receive synchronized round alerts and can report rebuys or eliminations either through Telegram or the web UI. All activity is persisted so the event survives restarts.

## Features

- **React scoreboard** with level timer, blind structure controls, prize pool stats, and quick actions for rebuys and eliminations.
- **Telegram dealer bot** (powered by [Telegraf](https://telegraf.js.org)) that handles table assignments, round acknowledgements, and dealer actions.
- **State persistence** to disk so dealer assignments, current round, rebuys, and eliminations are restored after a reboot.
- **REST API** for programmatic control (`/round`, `/api/rebuys`, `/api/eliminations`, etc.) that mirrors the bot flows.
- **Access controls** via an allow-list of Telegram IDs to keep the bot private to verified dealers.
- **Recent activity feeds** so staff can review the last announcements and player movements.

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set the required environment variables (see below) and start the backend:
   ```bash
   TELEGRAM_BOT_TOKEN=123456:ABC npm start
   ```
   The server listens on `http://localhost:3000` by default and also serves the static dashboard (`index.html`).
3. Open `http://localhost:3000/` in a browser to access the tournament board. The board polls the backend for the latest state, so it should be accessed through the Express server rather than as a standalone `file://` URL.
4. Start a conversation with your Telegram bot and use `/start` to pick a table. Only IDs included in the allow list (if configured) will be able to interact.

## Environment variables

| Variable | Description |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` (or `BOT_TOKEN`) | **Required.** Telegram bot token provided by BotFather. |
| `PORT` | Optional HTTP port for the Express server (default `3000`). |
| `TOURNAMENT_STATE_FILE` | Optional path for the JSON persistence file (default `server/tournament-state.json`). |
| `TOURNAMENT_TABLES` | Comma-separated list of table identifiers (default `1` through `10`). |
| `TELEGRAM_ALLOWED_USER_IDS` / `ALLOWED_TELEGRAM_IDS` | Optional comma-separated list of Telegram numeric IDs allowed to use the bot. If unset, the bot is open to everyone. |
| `TELEGRAM_UNAUTHORIZED_MESSAGE` | Optional custom denial message sent to unauthorized Telegram users. |
| `STATIC_ROOT` | Override the directory served as static assets (defaults to the repository root). |

## REST API overview

All endpoints accept/return JSON and live under the same origin as the web app:

- `POST /round` or `POST /api/rounds` – broadcast a new blind level (accepts `round`, `sb`, `bb`, `ante`, `tables`, etc.).
- `POST /api/rebuys` – record a rebuy (`table` is required, `player`, `amount`, `notes` optional). Notifies the dealer for that table via Telegram.
- `POST /api/eliminations` – record an elimination (requires `player`, optional `table`, `position`, `payout`, `notes`). Broadcasts to all dealers.
- `GET /api/state` – full persisted state (`dealers`, `currentRound`, `rebuys`, `eliminations`).
- `GET /api/dealers` – list current dealer assignments.
- `POST /api/dealers` – manually assign a dealer (respects the allow list if enabled).
- `DELETE /api/dealers/:id` – remove a dealer assignment.
- `GET /api/health` – health check with dealer count.

## Telegram bot usage

- `/start` – choose a table from the inline keyboard (enforced so only one dealer occupies a table).
- `/menu` or `/actions` – reopen the dealer action menu.
- `/cancel` – abort the current inline prompt.
- `/table` and `/status` – review your assignment or the latest round announcement.
- `/recent` (alias `/history`) – view the most recent rebuys and eliminations, filtered to your table when applicable.

The inline “Dealer actions” menu now includes:

- **♻️ Rebuy** – prompt for player/amount and notify only the assigned dealer.
- **❌ Eliminate Player** – record an elimination and broadcast to all dealers.
- **🗒 Recent activity** – show the latest recorded rebuys and eliminations directly in Telegram.

Unauthorized users attempting to access the bot receive a customizable denial message that includes their Telegram ID for easy whitelisting.

## Web dashboard enhancements

- The **Rebuy** button opens a form that submits to `/api/rebuys`, ensuring Telegram dealers are notified even when the staff uses the browser.
- The new **Elimination** button records player knockouts via `/api/eliminations` and broadcasts them to every dealer.
- A **Telegram sync summary** shows the broadcast round, tables notified, total rebuys/eliminations, and blind details pulled from the backend state.
- **Dealer assignments** and **recent activity feeds** visualize the persisted data so TDs can monitor action across tables.

## Persistence

Tournament state is stored in the JSON file configured by `TOURNAMENT_STATE_FILE` (defaults to `server/tournament-state.json`). The file tracks dealer assignments, the last announced round, and a history of rebuys and eliminations so the operation can resume seamlessly after a restart.
