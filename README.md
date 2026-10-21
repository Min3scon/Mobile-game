# Neon Swarm

A neon survivors-style arcade game for iPhone that runs in the browser, so you don't need the App Store.
Drag anywhere to move. Your weapons fire on their own. Survive 8 minutes and destroy the Hive Queen.

## Play on iPhone

1. Turn on GitHub Pages for this repo: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
2. Open `https://min3scon.github.io/Mobile-game/` in Safari.
3. Tap **Share → Add to Home Screen** to get a fullscreen app that works offline.

The home-screen app and Safari keep separate progress. To move progress between them, use **Settings → Save code**.

## What's in it

- 6 weapons, each with an evolution (max the weapon while holding its paired passive, then open a chest)
- 8 passives, 7 enemy types, 3 Warden mini-bosses and the Hive Queen
- 5 pilots, a permanent upgrade shop, 15 quests and a daily run with a streak
- Synthesized sound and music (no audio files), auto-pause, and run resume if the app is closed

## Run locally

Any static file server works, for example `npx http-server -c-1 .`, then open `http://localhost:8080`.

These debug URL flags help with testing:

- `?bot`: an autopilot plays the run
- `?speed=8`: runs the simulation 8 times faster
- `?t=6`: starts at 6:00 with a plausible build
- `?god`: no damage

## Code layout

| File | Purpose |
| --- | --- |
| `src/data.js` | All content and tuning: weapons, enemies, waves, shop, quests |
| `src/game.js` | Run simulation: spawning, weapons, collisions, level ups |
| `src/render.js` | Canvas drawing with pre-rendered glow sprites |
| `src/ui.js` | Menus and overlays |
| `src/audio.js` | Web Audio sound effects and music |
| `src/input.js` | Floating thumbstick and keyboard |
| `src/save.js` | Local progress and save codes |
| `src/main.js` | Boot, main loop, pause and resume |
| `sw.js` | Offline cache (bump `CACHE` when you deploy changes) |
