# MAFIA

A production-ready, server-authoritative real-time multiplayer social deduction game (Mafia / Werewolf) built with **Node.js + Express + Socket.IO** and a vanilla JS + Tailwind frontend.

Every phase — night kills, saves, detective checks, voting, eliminations and win conditions — is validated on the server. Clients receive only the information they are allowed to see (roles, teams, night actions and private chat are never leaked).

## Live demo / hosting

- **Production (recommended): Render web service.** The repo ships a [`render.yaml`](render.yaml) blueprint — one-click deploy, Postgres persistence, WebSockets, auto-migrations. Deploy guide below.
- **Netlify:** Netlify is static-only and cannot run the Socket.IO server, so it is **not** suitable as the sole host for the real-time game.

## Quick start (local)

Requires **Node.js ≥ 18.17**.

```bash
npm install
npm run build:css     # compile the Tailwind noir-dossier theme
npm start             # server on http://localhost:3000
```

Open `http://localhost:3000`, enter a username and create or join a room (minimum 6 players).

## Deploy to Render

1. Push this repo to GitHub.
2. In the Render Dashboard: **New → Blueprint**, pick the repo, click **Apply**.
3. After the first deploy, open **Service → Environment** and set:

   ```
   DATABASE_URL=postgresql://USER:PASSWORD@dpg-xxxxxxxx-a:5432/mafia_d5he
   ```

   (Replace `YOUR_DB_PASSWORD` in `render.yaml` before the first deploy, or paste the real value in the dashboard. Render's internal hostname `dpg-xxxx-a` is only reachable from inside Render.)

The blueprint runs `npx prisma migrate deploy` before boot (it skips automatically while the placeholder password is set), so the Postgres schema is created automatically. The game still runs fully in-memory if `DATABASE_URL` is missing.

> Free-tier note: Render free web services sleep after ~15 minutes of inactivity; the first request after wake-up can take ~30–50 seconds. Upgrade to a paid plan to avoid this.

## Docker

```bash
docker compose up --build
```

The compose stack ships an optional PostgreSQL service and applies Prisma migrations on boot. Set `DATABASE_URL` to use Postgres; leave it unset for in-memory mode (no persistence).

## Scripts

| Command              | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `npm start`          | Run the server (in-memory by default)               |
| `npm run dev`        | Run with `--watch` for development                  |
| `npm run build:css`  | Rebuild `client/assets/css/tailwind.css`            |
| `npm test`           | Run the full test suite (38 tests)                  |
| `npm run test:coverage` | Run tests with coverage                          |
| `npm run prisma:deploy` | Apply database migrations                        |

## Configuration

See `.env.example`. Key variables:

| Variable                | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `PORT`                  | HTTP + Socket.IO port (Render injects its own)       |
| `CORS_ORIGIN`           | Restrict Socket.IO origins. Empty = reflect request origin (same-origin works) |
| `DATABASE_URL`          | PostgreSQL connection string (optional)              |
| `SESSION_SECRET`        | Secret for signing sensitive data (Render generates one) |
| `MAX_PLAYERS_PER_ROOM`  | Hard cap on room size (default `20`)                 |
| `DEBUG_MODE`            | Dev-only privileged `debug:state` socket event       |
| `TRUST_PROXY`           | Set `true` behind a reverse proxy (rate limiting)    |

## Architecture

```
src/
  server.js            Express + Socket.IO bootstrap, static frontend
  config.js            Environment config, frozen phase/team constants
  routes/api.js        REST: /api/create /api/join /api/leave /api/session
  socket/
    middleware.js      auth, error safe-wrap, rate limiting
    handlers.js        all socket events (room, night, voting, chat, lifecycle)
  game/
    engine.js          authoritative game engine (all actions + rules)
    stateMachine.js    phase transitions, durations, active-phase helpers
    roomManager.js     rooms, sessions, sockets, timers, broadcasts
    view.js            per-player sanitized views (no role/team leakage)
    roles.js           role definitions and team assignment
    roleBalancer.js    balanced role distribution per mode/settings
    settings.js        modes + sanitized settings
    chat.js            room / mafia / dead channels
  services/persistence.js   optional Postgres persistence via Prisma
client/                landing + game pages, JS controllers, Tailwind theme
prisma/                optional Postgres schema + migrations
tests/                 engine, security, and real-socket integration tests
```

### Security model

- The server is authoritative; clients only ever send actions (target IDs, votes, chat).
- `view.js` builds a fresh object per player per broadcast — roles, teams, night targets, detective results and mafia chat are only included for the owning player.
- All socket actions are wrapped in `safe()`, which maps errors to typed codes and never crashes a handler.
- Chat is rate-limited (per-socket and per-window); room codes, names and messages are sanitized.
- Dead players cannot act; private chat channels (`mafia`, `dead`) enforce access server-side.

## Tests

```bash
npm test
```

- `tests/engine.test.js` — unit tests of the engine: role assignments, night actions, saves, detective results, voting, runoffs, ties, win conditions, rematches.
- `tests/security.test.js` — view-leak checks for every role/team across all phases.
- `tests/integration.test.js` — full 8-player games over real sockets: REST join flow, night + voting, chat secrecy, host migration, rematch, leave/destroy.

## License

[MIT](LICENSE) © Sattorov Alixon
