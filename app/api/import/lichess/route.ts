import { NextRequest, NextResponse } from 'next/server';
import { fetchRecentGames } from '@/lib/import/lichess';
import { z } from 'zod';

const schema = z.object({
  username: z.string().min(1).max(50),
  maxGames: z.number().min(1).max(1000).default(500),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const { username, maxGames } = parsed.data;

  try {
    const games = await fetchRecentGames(username, maxGames);
    const combinedPgn = games.map(g => g.pgn).join('\n\n');
    return NextResponse.json({ pgn: combinedPgn, count: games.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
