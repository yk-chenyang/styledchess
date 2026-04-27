// Chess.com Public API - no auth required for public game data
const BASE = 'https://api.chess.com/pub';

export interface ChessComGame {
  pgn: string;
  time_class: string;
  time_control: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
  end_time: number;
  url: string;
}

export interface ChessComArchive {
  archives: string[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'StyledChess/1.0 (styledchess.com)' },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Player not found on chess.com`);
    throw new Error(`Chess.com API error: ${res.status}`);
  }
  return res.json();
}

export async function getPlayerArchives(username: string): Promise<string[]> {
  const data = await fetchJson<ChessComArchive>(`${BASE}/player/${username}/games/archives`);
  return data.archives;
}

export async function getGamesFromArchive(archiveUrl: string): Promise<ChessComGame[]> {
  const data = await fetchJson<{ games: ChessComGame[] }>(archiveUrl);
  return data.games ?? [];
}

export async function fetchRecentGames(
  username: string,
  maxGames = 500
): Promise<{ pgn: string; playerColor: string }[]> {
  const archives = await getPlayerArchives(username);
  // Fetch from most recent archives first
  const recentArchives = archives.reverse();

  const result: { pgn: string; playerColor: string }[] = [];

  for (const archiveUrl of recentArchives) {
    if (result.length >= maxGames) break;
    const games = await getGamesFromArchive(archiveUrl);

    for (const game of games) {
      if (result.length >= maxGames) break;
      if (!game.pgn) continue;

      const playerColor =
        game.white.username.toLowerCase() === username.toLowerCase() ? 'white' : 'black';

      result.push({ pgn: game.pgn, playerColor });
    }
  }

  return result;
}
