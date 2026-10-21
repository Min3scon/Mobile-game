# Neon Swarm

A neon survivors-style arcade game for iPhone that runs in the browser, so you don't need the App Store.
Drag anywhere to move. Your weapons fire on their own. Survive 8 minutes and destroy the Hive Queen.

**Play:** https://min3scon.github.io/Mobile-game/ — in Safari, tap **Share → Add to Home Screen** for a fullscreen app that works offline.

## Features

- **Arsenal:** 9 weapons, each with an evolution, plus 9 passives, 10 pilots with mastery levels, and 10 pets to hatch from eggs and star up.
- **Progression:**
  - Account rank 1–50 with a reward road
  - 7-day login calendar and 3 daily quests
  - 28 achievements
  - 5 sectors (difficulty tiers)
  - Permanent upgrade shop with 15 upgrades
- **Online:**
  - Email accounts with an encrypted cloud save
  - All-time, weekly and daily leaderboards
  - Weekly raid boss that everyone damages together
  - Friend duels on the same seed
  - Live 2–4 player co-op with room codes and invite links
- **Daily run:** one try per day, the same seed and modifier for everyone, and its own leaderboard.

## Turning on online features

Follow [`supabase/SETUP.md`](supabase/SETUP.md): create a free Supabase project, run `supabase/schema.sql`, then paste the project URL and anon key into `config.js`. Until then, the game works fully offline.

## Cheating and privacy

- **Server checks:** the server checks every score, raid hit and duel against a run ticket issued when the run starts, and rejects impossible results.
- **Daily limit:** one daily run per account per day, enforced on the server.
- **Published code:** the site is built into a single minified file with no console access to game state. Saves are signed, so hand-edited saves are rejected. Test switches only work on localhost.
- **Encrypted saves:** cloud saves are encrypted with a per-player key kept in a separate private schema. Deleting an account destroys the key first.

## Development

```
npx http-server -c-1 .        # play the source version at http://localhost:8080
npm install && npm run build  # build the published version into dist/
```

GitHub Pages runs the build and publishes `dist/` on every push to `main` (`.github/workflows/static.yml`).

Test switches (localhost only):

- `?bot`: an autopilot plays the run
- `?speed=8`: runs the simulation 8 times faster
- `?t=6`: starts at 6:00 with a plausible build
- `?god`: no damage
- `?backend=mock`: a local fake server for testing accounts, leaderboards, duels and co-op in two tabs

| File | Purpose |
| --- | --- |
| `src/data.js` | All content and tuning |
| `src/game.js` | Run simulation, ships, weapons, pets |
| `src/coop.js` | Live co-op: host simulation, snapshots, client prediction |
| `src/online.js` | Supabase and mock backends |
| `src/progress.js` | Rank, pets, quests, rewards |
| `src/save.js` | Signed local save and save codes |
| `src/ui.js` | Menus and overlays |
| `src/render.js` | Canvas drawing |
| `src/audio.js` | Synthesized sound and music |
| `supabase/schema.sql` | Database, access rules and anti-cheat functions |
| `src/guard.js` | In-game anti-cheat: 30-second checkpoints, tamper and speed checks |
| `src/update.js` | Auto-update: reloads into new versions, and learns the server's clock |
| `tools/build.mjs` | Production build |
