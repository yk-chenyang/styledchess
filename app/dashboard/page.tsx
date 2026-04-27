import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Crown, Plus, Swords } from 'lucide-react';
import BotCard from '@/components/bots/BotCard';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/auth/login');

  const userId = (session.user as any).id;
  const role = (session.user as any).role ?? 'USER';

  const [bots, recentGames] = await Promise.all([
    db.chessBot.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    db.chessGame.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { bot: { select: { name: true } } },
    }),
  ]);

  const botLimit = role === 'MEMBER' ? 5 : 1;
  const canCreateBot = bots.length < botLimit;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-chess-text-primary">
            Welcome back, {session.user.name?.split(' ')[0] ?? 'Player'}
          </h1>
          <p className="text-chess-text-secondary text-sm mt-1 flex items-center gap-1">
            {role === 'MEMBER' ? (
              <><Crown size={14} className="text-yellow-400" /> Member</>
            ) : (
              'Free User'
            )}
            {' · '}{bots.length}/{botLimit} bots
          </p>
        </div>
        {canCreateBot ? (
          <Link
            href="/bots/create"
            className="flex items-center gap-2 px-4 py-2 bg-chess-green hover:bg-chess-green-dark text-white rounded-lg font-medium text-sm transition-colors"
          >
            <Plus size={16} /> New Bot
          </Link>
        ) : (
          <Link
            href="/upgrade"
            className="flex items-center gap-2 px-4 py-2 border border-yellow-500/50 text-yellow-400 rounded-lg font-medium text-sm hover:bg-yellow-900/20 transition-colors"
          >
            <Crown size={16} /> Upgrade for more bots
          </Link>
        )}
      </div>

      {/* Upgrade nudge for USER */}
      {role === 'USER' && bots.length >= 1 && (
        <div className="mb-6 bg-yellow-900/10 border border-yellow-500/30 rounded-xl px-5 py-3 flex items-center justify-between">
          <div className="text-sm">
            <span className="text-yellow-300 font-semibold">Want more bots?</span>
            <span className="text-chess-text-secondary ml-2">Upgrade to Member to create up to 5 bots.</span>
          </div>
          <Link href="/upgrade" className="text-yellow-400 text-sm font-medium hover:underline">
            Upgrade →
          </Link>
        </div>
      )}

      {/* Bots */}
      <section className="mb-10">
        <h2 className="text-chess-text-primary font-semibold text-lg mb-4">My Bots</h2>
        {bots.length === 0 ? (
          <div className="bg-chess-bg-card border border-chess-border rounded-xl p-8 text-center">
            <p className="text-chess-text-secondary text-lg mb-4">No bots yet</p>
            <Link href="/bots/create" className="px-6 py-2 bg-chess-green text-white rounded-lg font-medium hover:bg-chess-green-dark">
              Create Your First Bot
            </Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bots.map(bot => (
              <BotCard key={bot.id} bot={bot} />
            ))}
          </div>
        )}
      </section>

      {/* Recent Games */}
      {recentGames.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-chess-text-primary font-semibold text-lg">Recent Games</h2>
            <Link href="/games" className="text-chess-text-secondary text-sm hover:text-chess-green">
              View all →
            </Link>
          </div>
          <div className="bg-chess-bg-card border border-chess-border rounded-xl overflow-hidden">
            {recentGames.map((game, i) => {
              const userWon =
                (game.result === '1-0' && game.userColor === 'white') ||
                (game.result === '0-1' && game.userColor === 'black');
              const isDraw = game.result === '1/2-1/2';
              return (
                <div
                  key={game.id}
                  className={`flex items-center justify-between px-4 py-3 ${i < recentGames.length - 1 ? 'border-b border-chess-border' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <Swords size={16} className="text-chess-text-secondary" />
                    <div>
                      <span className="text-chess-text-primary text-sm font-medium">vs {game.bot.name}</span>
                      <span className="text-chess-text-secondary text-xs ml-2">
                        as {game.userColor}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {game.accuracy && (
                      <span className="text-chess-text-secondary text-xs">{Math.round(game.accuracy)}% acc</span>
                    )}
                    <span
                      className={`text-sm font-semibold ${
                        isDraw ? 'text-chess-text-secondary' : userWon ? 'text-chess-green' : 'text-red-400'
                      }`}
                    >
                      {isDraw ? 'Draw' : userWon ? 'Win' : 'Loss'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
