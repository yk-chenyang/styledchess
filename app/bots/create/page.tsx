'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import CreateBotForm from '@/components/bots/CreateBotForm';
import Link from 'next/link';

export default function CreateBotPage() {
  const { data: session } = useSession();

  const guestToken =
    typeof window !== 'undefined'
      ? (() => {
          let t = sessionStorage.getItem('guestToken');
          if (!t) {
            t = Math.random().toString(36).slice(2) + Date.now().toString(36);
            sessionStorage.setItem('guestToken', t);
          }
          return t;
        })()
      : '';

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <div className="mb-6">
        <Link href={session?.user ? '/dashboard' : '/'} className="text-chess-text-secondary text-sm hover:text-chess-green">
          ← Back
        </Link>
        <h1 className="text-2xl font-bold text-chess-text-primary mt-3">Create New Bot</h1>
        <p className="text-chess-text-secondary text-sm mt-1">
          Train an AI to play like any chess player by uploading their game history.
        </p>
      </div>

      <div className="bg-chess-bg-card border border-chess-border rounded-xl p-6">
        <CreateBotForm guestToken={session?.user ? undefined : guestToken} />
      </div>
    </div>
  );
}
