// Lichess API - public game data available without auth
const BASE = 'https://lichess.org/api';

export async function fetchRecentGames(
  username: string,
  maxGames = 500
): Promise<{ pgn: string; playerColor: string }[]> {
  const url = `${BASE}/games/user/${encodeURIComponent(username)}?max=${maxGames}&pgnInJson=false&clocks=false&evals=false&opening=true`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/x-ndjson',
      'User-Agent': 'StyledChess/1.0 (styledchess.com)',
    },
  });

  if (!res.ok) {
    if (res.status === 404) throw new Error(`Player not found on lichess.org`);
    throw new Error(`Lichess API error: ${res.status}`);
  }

  // Lichess returns ndjson — one JSON object per line
  const text = await res.text();
  const lines = text.split('\n').filter(l => l.trim().length > 0);

  const result: { pgn: string; playerColor: string }[] = [];

  for (const line of lines) {
    try {
      const game = JSON.parse(line);
      if (!game.pgn && !game.moves) continue;

      const playerColor =
        (game.players?.white?.user?.name ?? '').toLowerCase() === username.toLowerCase()
          ? 'white'
          : 'black';

      // Reconstruct PGN if available; otherwise use moves
      const pgn = game.pgn ?? buildPgnFromGame(game);
      if (pgn) result.push({ pgn, playerColor });
    } catch {
      // Skip malformed lines
    }
  }

  return result;
}

function buildPgnFromGame(game: any): string | null {
  if (!game.moves) return null;
  const headers = [
    `[Event "Lichess ${game.speed ?? 'Game'}"]`,
    `[Site "https://lichess.org/${game.id}"]`,
    `[Date "${game.createdAt ? new Date(game.createdAt).toISOString().slice(0, 10).replace(/-/g, '.') : '???'}"]`,
    `[White "${game.players?.white?.user?.name ?? '?'}"]`,
    `[Black "${game.players?.black?.user?.name ?? '?'}"]`,
    `[WhiteElo "${game.players?.white?.rating ?? '?'}"]`,
    `[BlackElo "${game.players?.black?.rating ?? '?'}"]`,
    `[Result "${formatResult(game.winner)}"]`,
    game.opening ? `[Opening "${game.opening.name}"]` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `${headers}\n\n${game.moves} ${formatResult(game.winner)}\n`;
}

function formatResult(winner?: string): string {
  if (winner === 'white') return '1-0';
  if (winner === 'black') return '0-1';
  return '1/2-1/2';
}
