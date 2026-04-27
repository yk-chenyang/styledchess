import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getStockfishConfig } from '@/lib/chess/trainer';
import { z } from 'zod';

const moveSchema = z.object({
  fen: z.string().min(1),
  guestToken: z.string().optional(),
});

// Normalize FEN for opening book lookup (drop half-move clock & full-move counter)
function normalizeFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

// Weighted random selection from a move frequency map
function sampleMove(moves: Record<string, number>): string {
  const entries = Object.entries(moves);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let rand = Math.random() * total;
  for (const [move, count] of entries) {
    rand -= count;
    if (rand <= 0) return move;
  }
  return entries[0][0];
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const parsed = moveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const { fen } = parsed.data;

  const bot = await db.chessBot.findUnique({
    where: { id: params.id },
    select: { openingBook: true, styleParams: true, status: true },
  });

  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
  if (bot.status !== 'READY') {
    return NextResponse.json({ error: 'Bot is not ready' }, { status: 409 });
  }

  const normalizedFen = normalizeFen(fen);
  let move: string | null = null;
  let source: 'opening_book' | 'stockfish' = 'stockfish';

  if (bot.openingBook) {
    const book = JSON.parse(bot.openingBook) as Record<string, Record<string, number>>;
    const candidates = book[normalizedFen];
    if (candidates && Object.keys(candidates).length > 0) {
      const totalFreq = Object.values(candidates).reduce((s, v) => s + v, 0);
      // Only use opening book if we have at least 2 observations
      if (totalFreq >= 2) {
        move = sampleMove(candidates);
        source = 'opening_book';
      }
    }
  }

  // Return style params so client can configure Stockfish for non-book positions
  const styleParams = bot.styleParams ? JSON.parse(bot.styleParams) : null;
  const stockfishConfig = styleParams ? getStockfishConfig(styleParams) : null;

  return NextResponse.json({ move, source, stockfishConfig });
}
