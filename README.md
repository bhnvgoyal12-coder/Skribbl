# Scribble

A real-time multiplayer draw-and-guess game. Skribbl-style, built from scratch with Node.js + Socket.IO and a vanilla HTML/CSS/JS frontend wrapped in a risograph-zine aesthetic.

![Made with Node.js](https://img.shields.io/badge/Node-24+-339933?logo=node.js&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socket.io&logoColor=white)
![No build step](https://img.shields.io/badge/No%20build%20step-✓-f4a300)

## What it is

Create a room, share the 5-character code, and take turns drawing while everyone else guesses in chat. Faster guesses = more points. The drawer earns points when others get it right.

## Features

**Gameplay**
- Room codes + shareable join links (`?room=XXXXX`)
- 2–10 players per room
- Turn-based drawing with 3-word choice → drawing → reveal phases
- Masked-word hints that reveal letters at 50% and 75% of the round
- Close-guess detection (only the guesser is told it's close)
- Configurable rounds (1–7) and draw time (30–120s)
- Custom word lists — paste your own, comma- or newline-separated

**Drawing**
- 12-color risograph palette
- Pen and eraser tools, variable brush size
- **Undo** (stroke-level, server-authoritative — everyone stays in sync)
- Clear canvas
- Late-joiners receive the in-progress drawing

**Polish**
- Deterministic avatars (animal emoji + ink color, hashed from name)
- Synthesized sound effects (correct guess chord, countdown ticks, round-end, fanfare, join chirp)
- Confetti on correct guesses and game-over
- Urgent timer pulse in the final 10 seconds

**Design**
- Risograph zine aesthetic — cream paper, ink colors, SVG grain overlay, halftone dots
- Display: Bowlby One · Hand: Caveat · Body: Sora · Mono: JetBrains Mono
- Slightly rotated cards, hard offset shadows, washi-tape accents

## Tech stack

- **Server:** Node.js (ES modules), Express, Socket.IO
- **Client:** Vanilla HTML / CSS / JS (no framework, no build step)
- **No database** — game state is in-memory per room and ephemeral

## Run locally

```bash
git clone https://github.com/bhnvgoyal12-coder/Skribbl.git
cd Skribbl
npm install
npm start
```

Open <http://localhost:3000> in two tabs (or share with a friend on your local network). Create a room in one, join with the code in the other, then hit **Start Game**.

For auto-reload during development:

```bash
npm run dev
```

## Project layout

```
.
├── server.js             # Express + Socket.IO server, room/game state machine
├── words.js              # Default word pack (~75 words)
├── public/
│   ├── index.html        # Single-page UI
│   ├── client.js         # Socket events, canvas, audio, confetti, avatars
│   └── style.css         # Risograph theme
└── package.json
```

## How the realtime layer works

Each room is a state machine on the server: `lobby → picking → drawing → reveal → (next turn or end)`. State is broadcast as a single `state` event after every meaningful transition. Drawing strokes carry a `strokeId` so the server can group continuous strokes for **undo**, which replays the remaining strokes to every client via `replace-strokes` to keep canvases in lockstep.

Scoring rewards speed: `100 + remaining_seconds_ratio * 200` for the guesser, and a `50 + (fraction_of_players_who_guessed * 100)` bonus for the drawer.

## Deploying

This is a stateful WebSocket server, so it needs a host that can run a long-lived Node process — not a serverless platform.

**Recommended (simplest):** Railway, Fly.io, or Render.

1. Connect the GitHub repo.
2. Set the start command to `npm start`.
3. Make sure the platform allows WebSocket connections (all three do by default).
4. Use the platform's PORT env var — `server.js` already reads `process.env.PORT`.

**A note on Vercel:** Vercel's Functions (even with Fluid Compute) are request-scoped with a max execution time (300s default). A multiplayer game session lasts longer than that — the WebSocket would drop mid-game. If you want to deploy on Vercel, the right pattern is to keep the frontend on Vercel and move the realtime layer to a managed service like [Ably](https://ably.com), [Pusher](https://pusher.com), or [PartyKit](https://www.partykit.io/) — that's a meaningful rewrite of `server.js` but unlocks edge-fast page loads + globally distributed realtime.

## Things I'd add next

- Spectator mode for late joiners during a round
- Drawing replay when the word is revealed
- Vote-to-skip for unguessable words
- Categories of word packs (animals, movies, food, etc.)
- Persistence with Redis so server restarts don't drop rooms
- Mobile-optimized tool layout

## License

MIT — do what you want with it.

---

Built as a one-evening project to explore real-time multiplayer mechanics from scratch.
