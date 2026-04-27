import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendVerificationCode } from '@/lib/email';
import { z } from 'zod';

const schema = z.object({ email: z.string().email() });

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  const { email } = parsed.data;

  // Check if email already registered
  const existing = await db.user.findUnique({ where: { email } });
  if (existing?.emailVerified) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  // Rate limit: max 3 codes in last 15 minutes
  const recentCodes = await db.emailVerificationCode.count({
    where: {
      email,
      createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
    },
  });
  if (recentCodes >= 3) {
    return NextResponse.json({ error: 'Too many requests. Please wait 15 minutes.' }, { status: 429 });
  }

  const code = generateCode();
  const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await db.emailVerificationCode.create({ data: { email, code, expires } });

  try {
    await sendVerificationCode(email, code);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to send email. Check SMTP settings.' }, { status: 500 });
  }
}
