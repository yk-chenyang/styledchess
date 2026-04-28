import { Chess } from 'chess.js';
import { parsePgn, ParsedGame } from './pgn-parser';

export interface StyleParams {
  estimatedElo: number;
  aggressiveness: number;      // 0-1
  tacticalSharpness: number;   // 0-1 (captures / total moves)
  avgGameLength: number;
  openingPreferences: { name: string; frequency: number }[];
  winRate: number;
  drawRate: number;
  colorPreference: 'white' | 'black' | 'both';
  totalGames: number;
}

// FEN normalized (drop half-move clock and full-move counter)
export type OpeningBook = Record<string, Record<string, number>>;

export interface TrainingResult {
  styleParams: StyleParams;
  openingBook: OpeningBook;
  gamesProcessed: number;
}

function normalizeFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

function getOpeningName(headers: Record<string, string>): string {
  return headers['Opening'] ?? headers['ECO'] ?? 'Unknown';
}

function estimateElo(wins: number, draws: number, losses: number, avgOpponentElo?: number): number {
  const total = wins + draws + losses;
  if (total === 0) return 1200;
  const score = (wins + draws * 0.5) / total;
  // Expected score formula; if no opponent elo, estimate from win rate
  const baseElo = avgOpponentElo ?? 1200;
  // W = 1 / (1 + 10^((oppElo - myElo)/400))
  // Invert: myElo = oppElo - 400 * log10(1/score - 1)
  if (score <= 0) return Math.max(100, baseElo - 400);
  if (score >= 1) return Math.min(3000, baseElo + 400);
  return Math.round(baseElo - 400 * Math.log10(1 / score - 1));
}

export function trainBot(
  pgn: string,
  targetPlayer: string,
  playerColor: 'white' | 'black' | 'both' = 'both'
): TrainingResult {
  const games = parsePgn(pgn, targetPlayer);

  const openingBook: OpeningBook = {};
  const openingFreq: Record<string, number> = {};

  let wins = 0, draws = 0, losses = 0;
  let totalMoves = 0, totalCaptures = 0, totalAttacks = 0;
  let totalGameLength = 0;
  let opponentEloSum = 0, opponentEloCount = 0;
  let gamesProcessed = 0;

  // Max opening book depth (first N plies for white + black)
  const MAX_BOOK_DEPTH = 50;

  for (const game of games) {
    const chess = new Chess();
    let playerIsWhite: boolean | null = null;

    if (game.playerColor === 'white') playerIsWhite = true;
    else if (game.playerColor === 'black') playerIsWhite = false;
    else if (playerColor === 'white') playerIsWhite = true;
    else if (playerColor === 'black') playerIsWhite = false;
    // else both — we record all moves as "player moves"

    // Determine win/draw/loss
    const result = game.result;
    if (playerIsWhite !== null) {
      if (result === '1-0') { if (playerIsWhite) wins++; else losses++; }
      else if (result === '0-1') { if (!playerIsWhite) wins++; else losses++; }
      else if (result === '1/2-1/2') draws++;
    } else {
      // "both" mode — approximate
      if (result === '1/2-1/2') draws++;
      else if (result === '1-0' || result === '0-1') wins += 0.5, losses += 0.5;
    }

    // Opponent ELO
    const whiteElo = parseInt(game.headers['WhiteElo'] ?? '0');
    const blackElo = parseInt(game.headers['BlackElo'] ?? '0');
    if (playerIsWhite === true && blackElo > 0) { opponentEloSum += blackElo; opponentEloCount++; }
    else if (playerIsWhite === false && whiteElo > 0) { opponentEloSum += whiteElo; opponentEloCount++; }

    // Opening name
    const opening = getOpeningName(game.headers);
    openingFreq[opening] = (openingFreq[opening] ?? 0) + 1;

    // Play through game and build opening book
    let ply = 0;
    for (const san of game.moves) {
      const isPlayerTurn =
        playerColor === 'both' ||
        (playerIsWhite === true && chess.turn() === 'w') ||
        (playerIsWhite === false && chess.turn() === 'b');

      const fen = normalizeFen(chess.fen());

      let moveResult;
      try {
        moveResult = chess.move(san);
        if (!moveResult) break;
      } catch {
        break;
      }

      if (isPlayerTurn) {
        totalMoves++;
        if (san.includes('x')) totalCaptures++;
        if (san.includes('+') || san.includes('#')) totalAttacks++;

        // Store as UCI (e.g. "e7e5", "g8f6") so the board can apply it directly.
        // SAN varies by context; UCI from+to is unambiguous.
        if (ply < MAX_BOOK_DEPTH) {
          const uci = moveResult.from + moveResult.to + (moveResult.promotion ?? '');
          if (!openingBook[fen]) openingBook[fen] = {};
          openingBook[fen][uci] = (openingBook[fen][uci] ?? 0) + 1;
        }
      }

      ply++;
    }

    totalGameLength += ply;
    gamesProcessed++;
  }

  if (gamesProcessed === 0) {
    throw new Error('No valid games could be processed from the PGN data.');
  }

  const avgOpponentElo = opponentEloCount > 0 ? opponentEloSum / opponentEloCount : undefined;
  const estimatedElo = estimateElo(wins, draws, losses, avgOpponentElo);
  const total = wins + draws + losses;

  const topOpenings = Object.entries(openingFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, frequency: count / gamesProcessed }));

  const styleParams: StyleParams = {
    estimatedElo,
    aggressiveness: totalMoves > 0 ? Math.min(1, (totalAttacks / totalMoves) * 5) : 0.5,
    tacticalSharpness: totalMoves > 0 ? totalCaptures / totalMoves : 0.3,
    avgGameLength: gamesProcessed > 0 ? totalGameLength / gamesProcessed : 40,
    openingPreferences: topOpenings,
    winRate: total > 0 ? wins / total : 0,
    drawRate: total > 0 ? draws / total : 0,
    colorPreference: playerColor,
    totalGames: gamesProcessed,
  };

  return { styleParams, openingBook, gamesProcessed };
}

// Given style params, compute Stockfish configuration
export function getStockfishConfig(style: StyleParams): {
  skillLevel: number;
  contempt: number;
  moveTime: number;
} {
  // Skill level: 0-20 mapped from ELO 800-2800
  const skillLevel = Math.min(20, Math.max(0, Math.round((style.estimatedElo - 800) / 100)));
  // Contempt: aggressive players get positive contempt (prefer fighting)
  const contempt = Math.round((style.aggressiveness - 0.5) * 100);
  // Move time in ms: higher skill = more time to think
  const moveTime = 500 + skillLevel * 100;

  return { skillLevel, contempt, moveTime };
}
