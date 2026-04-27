import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { z } from 'zod';

const saveGameSchema = z.object({
  botId: z.string(),
  pgn: z.string(),
  result: z.enum(['1-0', '0-1', '1/2-1/2', '*']),
  userColor: z.enum(['white', 'black']),
  accuracy: z.number().min(0).max(100).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ games: [] });

  const userId = (session.user as any).id;
  const { searchParams } = new URL(req.url);
  const botId = searchParams.get('botId');

  const games = await db.chessGame.findMany({
    where: { userId, ...(botId ? { botId } : {}) },
    include: { bot: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return NextResponse.json({ games });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const body = await req.json();
  const parsed = saveGameSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const { botId, pgn, result, userColor, accuracy } = parsed.data;

  const userId = (session?.user as any)?.id ?? null;

  const game = await db.chessGame.create({
    data: { botId, pgn, result, userColor, accuracy: accuracy ?? null, userId },
  });

  return NextResponse.json({ game }, { status: 201 });
}
