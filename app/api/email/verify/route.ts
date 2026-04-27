import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  password: z.string().min(8),
  name: z.string().min(1).max(50),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
  }

  const { email, code, password, name } = parsed.data;

  const verification = await db.emailVerificationCode.findFirst({
    where: { email, code, expires: { gte: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!verification) {
    return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 400 });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await db.user.upsert({
    where: { email },
    update: { name, password: hashedPassword, emailVerified: new Date() },
    create: { email, name, password: hashedPassword, emailVerified: new Date() },
  });

  // Clean up used verification codes
  await db.emailVerificationCode.deleteMany({ where: { email } });

  return NextResponse.json({ success: true });
}
