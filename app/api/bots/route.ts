import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { z } from 'zod';

const BOT_LIMITS = { GUEST: 1, USER: 1, MEMBER: 5, ADMIN: 99 };

const createBotSchema = z.object({
  name: z.string().min(1).max(50),
  targetName: z.string().min(1).max(50),
  platform: z.enum(['chessdotcom', 'lichess', 'manual']).optional(),
  guestToken: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const { searchParams } = new URL(req.url);
  const guestToken = searchParams.get('guestToken');

  if (!session?.user) {
    if (!guestToken) return NextResponse.json({ bots: [] });
    const bots = await db.chessBot.findMany({
      where: { guestToken },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ bots });
  }

  const userId = (session.user as any).id;
  const bots = await db.chessBot.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { games: true } } },
  });

  return NextResponse.json({ bots });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const body = await req.json();
  const parsed = createBotSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  const { name, targetName, platform, guestToken } = parsed.data;

  if (!session?.user) {
    // Guest mode
    if (!guestToken) {
      return NextResponse.json({ error: 'Guest token required' }, { status: 400 });
    }
    const existing = await db.chessBot.count({ where: { guestToken } });
    if (existing >= BOT_LIMITS.GUEST) {
      return NextResponse.json(
        { error: 'LIMIT_REACHED', message: 'Guests can only create 1 bot. Sign up to create more!' },
        { status: 403 }
      );
    }
    const bot = await db.chessBot.create({
      data: { name, targetName, platform, guestToken, status: 'PENDING' },
    });
    return NextResponse.json({ bot }, { status: 201 });
  }

  const userId = (session.user as any).id;
  const role = (session.user as any).role ?? 'USER';
  const limit = BOT_LIMITS[role as keyof typeof BOT_LIMITS] ?? 1;

  const existing = await db.chessBot.count({ where: { userId } });
  if (existing >= limit) {
    const upgradeMsg =
      role === 'USER'
        ? 'Users can only create 1 bot. Upgrade to Member to create up to 5!'
        : 'You have reached the maximum of 5 bots for Members.';
    return NextResponse.json(
      { error: 'LIMIT_REACHED', message: upgradeMsg },
      { status: 403 }
    );
  }

  const bot = await db.chessBot.create({
    data: { name, targetName, platform, userId, status: 'PENDING' },
  });

  return NextResponse.json({ bot }, { status: 201 });
}
