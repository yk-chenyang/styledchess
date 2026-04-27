import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { trainBot } from '@/lib/chess/trainer';
import { z } from 'zod';

const trainSchema = z.object({
  pgn: z.string().min(1),
  playerColor: z.enum(['white', 'black', 'both']).default('both'),
  guestToken: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const body = await req.json();
  const parsed = trainSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const { pgn, playerColor, guestToken } = parsed.data;

  const bot = await db.chessBot.findUnique({ where: { id: params.id } });
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });

  // Auth check
  const userId = (session?.user as any)?.id;
  if (bot.userId && bot.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!bot.userId && bot.guestToken !== guestToken) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Mark as training
  await db.chessBot.update({
    where: { id: params.id },
    data: { status: 'TRAINING', errorMessage: null },
  });

  try {
    const result = trainBot(pgn, bot.targetName, playerColor);

    // Store training games (up to 1000)
    const gameLines = pgn.split('\n\n[').slice(0, 1000);
    // (we just count; we don't need to store every game PGN separately)

    await db.chessBot.update({
      where: { id: params.id },
      data: {
        status: 'READY',
        styleParams: JSON.stringify(result.styleParams),
        openingBook: JSON.stringify(result.openingBook),
        gamesCount: result.gamesProcessed,
        estimatedElo: result.styleParams.estimatedElo,
        platform: bot.platform,
      },
    });

    return NextResponse.json({
      success: true,
      gamesProcessed: result.gamesProcessed,
      estimatedElo: result.styleParams.estimatedElo,
    });
  } catch (err: any) {
    await db.chessBot.update({
      where: { id: params.id },
      data: { status: 'FAILED', errorMessage: err.message },
    });
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
}
