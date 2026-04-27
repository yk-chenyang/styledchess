export interface ParsedGame {
  moves: string[];
  headers: Record<string, string>;
  playerColor: 'white' | 'black' | null;
  result: string;
}

// Split a multi-game PGN string into individual game strings
export function splitPgn(pgn: string): string[] {
  const games: string[] = [];
  const lines = pgn.split('\n');
  let current: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // A new game starts when we see a [Event header after having moves
    if (trimmed.startsWith('[Event ') && current.some(l => !l.startsWith('[') && l.trim() !== '')) {
      const gameText = current.join('\n').trim();
      if (gameText) games.push(gameText);
      current = [line];
    } else {
      current.push(line);
    }
  }
  const last = current.join('\n').trim();
  if (last) games.push(last);

  return games.filter(g => g.length > 0);
}

// Parse PGN headers from a game string
export function parseHeaders(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const headerRegex = /\[(\w+)\s+"([^"]*)"\]/g;
  let match;
  while ((match = headerRegex.exec(pgn)) !== null) {
    headers[match[1]] = match[2];
  }
  return headers;
}

// Extract raw moves text (after all headers)
export function extractMovesText(pgn: string): string {
  // Remove header lines
  const withoutHeaders = pgn.replace(/\[.*?\]\s*/g, '').trim();
  // Remove comments {comment}
  const withoutComments = withoutHeaders.replace(/\{[^}]*\}/g, '');
  // Remove variations (...)
  const withoutVariations = withoutComments.replace(/\([^)]*\)/g, '');
  // Remove move numbers and result
  return withoutVariations
    .replace(/\d+\.\.\./g, '')
    .replace(/\d+\./g, '')
    .replace(/1-0|0-1|1\/2-1\/2|\*/g, '')
    .trim();
}

// Parse a single game PGN into structured data
export function parseSingleGame(pgn: string, targetPlayer?: string): ParsedGame | null {
  try {
    const headers = parseHeaders(pgn);
    const movesText = extractMovesText(pgn);
    const result = headers['Result'] ?? '*';

    // Parse moves as tokens
    const rawMoves = movesText.split(/\s+/).filter(m => m.length > 0 && !/^\d/.test(m) && m !== '*');

    // Determine player color if targetPlayer is given
    let playerColor: 'white' | 'black' | null = null;
    if (targetPlayer) {
      const white = (headers['White'] ?? '').toLowerCase();
      const black = (headers['Black'] ?? '').toLowerCase();
      const target = targetPlayer.toLowerCase();
      if (white === target || white.startsWith(target)) playerColor = 'white';
      else if (black === target || black.startsWith(target)) playerColor = 'black';
    }

    return { moves: rawMoves, headers, playerColor, result };
  } catch {
    return null;
  }
}

// Parse a multi-game PGN file into an array of games
export function parsePgn(pgn: string, targetPlayer?: string): ParsedGame[] {
  const gameStrings = splitPgn(pgn);
  const games: ParsedGame[] = [];

  for (const gameStr of gameStrings) {
    const parsed = parseSingleGame(gameStr, targetPlayer);
    if (parsed && parsed.moves.length > 0) {
      games.push(parsed);
    }
  }

  return games;
}
