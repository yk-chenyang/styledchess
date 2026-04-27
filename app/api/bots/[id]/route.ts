import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const { searchParams } = new URL(req.url);
  const guestToken = searchParams.get('guestToken');

  const bot = await db.chessBot.findUnique({
    where: { id: params.id },
    include: { _count: { select: { games: true, trainingGames: true } } },
  });

  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });

  // Auth check
  const userId = (session?.user as any)?.id;
  if (bot.userId && bot.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!bot.userId && bot.guestToken && bot.guestToken !== guestToken) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ bot });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const { searchParams } = new URL(req.url);
  const guestToken = searchParams.get('guestToken');

  const bot = await db.chessBot.findUnique({ where: { id: params.id } });
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });

  const userId = (session?.user as any)?.id;
  if (bot.userId && bot.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!bot.userId && bot.guestToken !== guestToken) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db.chessBot.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
