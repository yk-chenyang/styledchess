'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import BotCard from '@/components/bots/BotCard';
import { Plus } from 'lucide-react';

export default function BotsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [bots, setBots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const guestToken =
    typeof window !== 'undefined' ? sessionStorage.getItem('guestToken') ?? '' : '';

  useEffect(() => {
    if (status === 'loading') return;
    fetchBots();
  }, [status]);

  async function fetchBots() {
    try {
      const url = session?.user ? '/api/bots' : `/api/bots?guestToken=${guestToken}`;
      const res = await fetch(url);
      const data = await res.json();
      setBots(data.bots ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function deleteBot(id: string) {
    if (!confirm('Delete this bot and all its games?')) return;
    await fetch(`/api/bots/${id}?guestToken=${guestToken}`, { method: 'DELETE' });
    setBots(prev => prev.filter(b => b.id !== id));
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 text-center">
        <div className="w-8 h-8 border-2 border-chess-green border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-chess-text-primary">My Bots</h1>
        <Link
          href="/bots/create"
          className="flex items-center gap-2 px-4 py-2 bg-chess-green hover:bg-chess-green-dark text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> New Bot
        </Link>
      </div>

      {bots.length === 0 ? (
        <div className="bg-chess-bg-card border border-chess-border rounded-xl p-12 text-center">
          <p className="text-chess-text-secondary text-lg mb-4">You haven't created any bots yet</p>
          <Link href="/bots/create" className="px-6 py-2 bg-chess-green text-white rounded-lg font-medium">
            Create Your First Bot
          </Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bots.map(bot => (
            <BotCard key={bot.id} bot={bot} onDelete={deleteBot} />
          ))}
        </div>
      )}
    </div>
  );
}
