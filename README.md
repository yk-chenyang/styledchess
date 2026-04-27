# ♛ StyledChess

A web app where you can upload any chess player's game history to train a personalized AI bot that mimics their playing style, then play against it on a full interactive board.

## Features

- **Bot Training**: Upload PGN games to train an AI that mimics a player's style
- **Import from chess.com & Lichess**: Fetch games automatically via public APIs
- **Full Chess Board**: Interactive board powered by Stockfish (WASM) + chess.js + react-chessboard
- **Game Review**: Stockfish-powered analysis with Best / Excellent / Inaccuracy / Blunder annotations
- **Guest, User, and Member tiers** with appropriate bot limits
- **Auth**: Email/password + Google OAuth (NextAuth.js)
- **Email verification**: 6-digit code sent to your inbox

## Tier Limits

| Tier | Bots | Game History | Notes |
|------|------|--------------|-------|
| Guest | 1 (session only) | Not saved | Lost when you leave |
| User (free) | 1 (saved) | Saved | Email or Google login |
| Member | 5 (saved) | Saved | Payment TBD |

## Tech Stack

- **Next.js 14** (App Router, TypeScript)
- **Prisma** + SQLite (dev) / PostgreSQL (prod)
- **NextAuth.js** — Google + email/password
- **Stockfish 16 WASM** — client-side chess engine
- **chess.js** + **react-chessboard** — board and game logic
- **Tailwind CSS** — dark chess theme

## Setup

```bash
# 1. Clone and install
git clone https://github.com/your-username/styledchess
cd styledchess
npm install

# 2. Copy env
cp .env.example .env.local
# Fill in NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SMTP settings

# 3. Create database
npm run db:push

# 4. Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production Deployment (Vercel)

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add environment variables (switch `DATABASE_URL` to PostgreSQL)
4. Deploy — your app will be live at `your-project.vercel.app`

For a custom domain (`styledchess.com`), add it in Vercel's dashboard → Domains.

## Training Algorithm

1. Parse PGN games and replay each game position-by-position
2. Build an **opening book**: `FEN → {move: frequency}` map (first 50 plies)
3. Compute **style metrics**: estimated ELO, aggressiveness, tactical sharpness, opening preferences
4. During gameplay:
   - Opening book positions → use the player's historical moves (weighted by frequency)
   - Unknown positions → Stockfish with skill level and contempt tuned to match the player's style

Training time for 1000 games (40 moves each): **~2–10 seconds** (well within the 48-hour target).

## Game Review

Uses Stockfish WASM running in the browser to evaluate every position, computes centipawn loss per move, and classifies moves:

| Annotation | CP Loss |
|-----------|---------|
| Best ✓ | 0–10 |
| Excellent ! | 11–25 |
| Good | 26–50 |
| Inaccuracy ?! | 51–100 |
| Mistake ? | 101–200 |
| Blunder ?? | 201+ |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | SQLite (`file:./dev.db`) or PostgreSQL URL |
| `NEXTAUTH_URL` | App URL (e.g. `http://localhost:3000`) |
| `NEXTAUTH_SECRET` | Random secret string |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `SMTP_HOST/PORT/USER/PASS` | SMTP for email verification |
