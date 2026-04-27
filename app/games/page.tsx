import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Swords } from 'lucide-react';

export default async function GamesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/auth/login');

  const userId = (session.user as any).id;
  const games = await db.chessGame.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { bot: { select: { name: true, targetName: true } } },
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-chess-text-primary mb-6">Game History</h1>

      {games.length === 0 ? (
        <div className="bg-chess-bg-card border border-chess-border rounded-xl p-12 text-center">
          <p className="text-chess-text-secondary text-lg mb-4">No games played yet</p>
          <Link href="/bots" className="px-6 py-2 bg-chess-green text-white rounded-lg font-medium">
            Play a Bot
          </Link>
        </div>
      ) : (
        <div className="bg-chess-bg-card border border-chess-border rounded-xl overflow-hidden">
          {games.map((game, i) => {
            const userWon =
              (game.result === '1-0' && game.userColor === 'white') ||
              (game.result === '0-1' && game.userColor === 'black');
            const isDraw = game.result === '1/2-1/2';

            return (
              <div
                key={game.id}
                className={`flex items-center justify-between px-5 py-4 ${
                  i < games.length - 1 ? 'border-b border-chess-border' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-10 rounded-full ${
                      isDraw ? 'bg-chess-text-secondary' : userWon ? 'bg-chess-green' : 'bg-red-500'
                    }`}
                  />
                  <div>
                    <div className="text-chess-text-primary font-medium text-sm">
                      vs <span className="text-chess-green">{game.bot.name}</span>
                    </div>
                    <div className="text-chess-text-secondary text-xs mt-0.5">
                      Playing as {game.userColor} ·{' '}
                      {new Date(game.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {game.accuracy != null && (
                    <span className="text-chess-text-secondary text-sm">
                      {Math.round(game.accuracy)}% accuracy
                    </span>
                  )}
                  <span
                    className={`font-semibold text-sm ${
                      isDraw ? 'text-chess-text-secondary' : userWon ? 'text-chess-green' : 'text-red-400'
                    }`}
                  >
                    {isDraw ? 'Draw' : userWon ? 'Win' : 'Loss'}
                  </span>
                  <Link
                    href={`/play/${game.botId}?review=${game.id}`}
                    className="text-xs text-chess-text-secondary hover:text-chess-green"
                  >
                    Review
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
