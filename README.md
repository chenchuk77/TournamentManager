# Poker Tournament Telegram Bot

This project provides a Telegram bot for managing home-game poker tournaments without any accompanying web interface. When a tournament director sends `/start`, the bot:

- Announces the players, dealers, table count, and blind structure pulled from `appconfig.yaml`/`appconfig.json`.
- Shuffles every player into tables (nine seats per table) with the configured dealers always occupying seat 1.
- Displays the current metrics – total chips in play, prize pool, active/eliminated players, and rebuy counts.
- Offers inline controls to register rebuys, mark eliminations, restart the current blind level, or skip ahead.
- Runs the blind timer, warning one minute before a level changes and announcing the new level automatically.

The default configuration lives in `appconfig.yaml` and already contains the requested player list (`chen`, `nir`, `doron`, `eldad`, `haim`, `amit`, `etai`) and dealer rotation (`chen`, `nir`). Adjust the file (or provide `appconfig.json`) to match your event.

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the bot. The token is loaded from the configuration file, but you can override it with an environment variable:
   ```bash
   npm start
   # or
   TELEGRAM_BOT_TOKEN=123456:ABC npm start
   ```
3. Open a chat with your bot in Telegram and send `/start` to initialize the tournament.

## Configuration

The bot reads the first file it finds among `appconfig.yaml`, `appconfig.yml`, or `appconfig.json` in the project root. Key fields include:

- `bot_token` – BotFather token (optional if you prefer environment variables).
- `player` or `players` – Array of player names used to populate the tournament and action menus.
- `dealers` – Dealer names (must be part of the player list). Dealers are shuffled across tables but always occupy seat 1.
- `number_of_tables` – How many tables to generate during the seat draw.
- `buy_in.amount` and `buy_in.chips` – Used to compute total prize pool and chips in play.
- `rebuy.enabled`, `rebuy.amount`, `rebuy.chips` – Optional rebuy configuration reflected in the metrics panel.
- `structure` – Array of blind levels. Each level can include `level`, `small_blind`, `big_blind`, `ante`, and `duration_minutes` (or similar minute-based fields).

Edit the file to match your tournament. JSON and YAML formats are both supported, and redundant keys such as `player`/`players` or `duration_minutes`/`duration` are normalized automatically.

## Bot actions

- `/start` – Initializes the tournament, performs a fresh seat draw, and posts the blind structure plus metrics.
- **♻️ Rebuy** – Opens a player picker to log an additional buy-in. Totals update immediately.
- **❌ Eliminate Player** – Marks a player as knocked out and removes them from future elimination prompts.
- **🔁 Reset Round** – Restarts the active blind level timer from the beginning.
- **⏭️ Skip Round** – Advances directly to the next blind level.

Every blind level generates two announcements: one minute before the scheduled change and again when the new level starts.
