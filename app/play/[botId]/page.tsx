'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ChessBoard from '@/components/chess/ChessBoard';
import GameReview from '@/components/chess/GameReview';
import { StockfishConfig } from '@/types';

export default function PlayPage() {
  const { botId } = useParams<{ botId: string }>();
  const { data: session } = useSession();
  const router = useRouter();
  const [bot, setBot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userColor, setUserColor] = useState<'white' | 'black'>('white');
  const [colorChosen, setColorChosen] = useState(false);
  const [stockfishConfig, setStockfishConfig] = useState<StockfishConfig | null>(null);
  const [gameEnded, setGameEnded] = useState(false);
  const [lastPgn, setLastPgn] = useState('');
  const [lastResult, setLastResult] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [gameKey, setGameKey] = useState(0);

  const guestToken =
    typeof window !== 'undefined' ? sessionStorage.getItem('guestToken') ?? '' : '';

  useEffect(() => {
    fetchBot();
  }, [botId]);

  async function fetchBot() {
    try {
      const url = `/api/bots/${botId}?guestToken=${guestToken}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Bot not found');
      const data = await res.json();
      setBot(data.bot);

      if (data.bot.styleParams) {
        const { getStockfishConfig } = await import('@/lib/chess/trainer');
        const style = JSON.parse(data.bot.styleParams);
        setStockfishConfig(getStockfishConfig(style));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const handleGameEnd = useCallback(
    async (pgn: string, result: string, color: string) => {
      setLastPgn(pgn);
      setLastResult(result);
      setGameEnded(true);

      // Save game if authenticated
      if (session?.user) {
        const userWon =
          (result === '1-0' && color === 'white') || (result === '0-1' && color === 'black');
        await fetch('/api/games', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            botId,
            pgn,
            result,
            userColor: color,
          }),
        });
      }
    },
    [botId, session]
  );

  const startNewGame = useCallback(() => {
    setGameEnded(false);
    setShowReview(false);
    setGameKey(k => k + 1);
    setColorChosen(false);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-2 border-chess-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !bot) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <p className="text-red-400 mb-4">{error || 'Bot not found'}</p>
        <Link href="/" className="text-chess-green hover:underline">← Go home</Link>
      </div>
    );
  }

  if (bot.status !== 'READY') {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <p className="text-chess-text-secondary text-lg mb-4">
          This bot is not ready yet (status: {bot.status}).
        </p>
        {bot.status === 'PENDING' && (
          <Link href={`/bots/create?botId=${botId}`} className="px-6 py-2 bg-chess-green text-white rounded-lg">
            Upload Games
          </Link>
        )}
        {bot.status === 'FAILED' && (
          <p className="text-red-400 text-sm mt-2">{bot.errorMessage}</p>
        )}
      </div>
    );
  }

  if (!colorChosen) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center">
        <div className="bg-chess-bg-card border border-chess-border rounded-xl p-8">
          <h2 className="text-chess-text-primary text-2xl font-bold mb-2">Play vs {bot.name}</h2>
          <p className="text-chess-text-secondary text-sm mb-6">
            Mimics <span className="text-chess-green">{bot.targetName}</span>
            {bot.estimatedElo ? ` · ~${bot.estimatedElo} ELO` : ''}
          </p>
          <p className="text-chess-text-secondary mb-4">Choose your color:</p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={() => { setUserColor('white'); setColorChosen(true); }}
              className="flex-1 py-4 bg-chess-light text-chess-bg-card rounded-xl font-bold text-lg hover:opacity-90 transition-opacity"
            >
              ♔ White
            </button>
            <button
              onClick={() => { setUserColor('black'); setColorChosen(true); }}
              className="flex-1 py-4 bg-chess-dark text-white rounded-xl font-bold text-lg hover:opacity-90 transition-opacity"
            >
              ♚ Black
            </button>
          </div>
          <button
            onClick={() => {
              setUserColor(Math.random() > 0.5 ? 'white' : 'black');
              setColorChosen(true);
            }}
            className="mt-3 w-full py-2 border border-chess-border text-chess-text-secondary rounded-xl text-sm hover:border-chess-green"
          >
            Random
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/bots" className="text-chess-text-secondary text-sm hover:text-chess-green">
            ← My Bots
          </Link>
          <h1 className="text-xl font-bold text-chess-text-primary mt-1">
            vs <span className="text-chess-green">{bot.name}</span>
          </h1>
          {bot.estimatedElo && (
            <p className="text-chess-text-secondary text-sm">Estimated ELO: {bot.estimatedElo}</p>
          )}
        </div>
        {gameEnded && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowReview(!showReview)}
              className="px-4 py-2 border border-chess-border hover:border-chess-green text-chess-text-primary rounded-lg text-sm transition-colors"
            >
              {showReview ? 'Hide Review' : 'Review Game'}
            </button>
            <button
              onClick={startNewGame}
              className="px-4 py-2 bg-chess-green hover:bg-chess-green-dark text-white rounded-lg text-sm font-medium transition-colors"
            >
              New Game
            </button>
          </div>
        )}
      </div>

      {!showReview ? (
        <ChessBoard
          key={gameKey}
          botId={botId as string}
          userColor={userColor}
          guestToken={guestToken}
          stockfishConfig={stockfishConfig ?? undefined}
          onGameEnd={handleGameEnd}
        />
      ) : (
        <div className="bg-chess-bg-card border border-chess-border rounded-xl p-6">
          <h2 className="text-chess-text-primary font-semibold mb-4">Game Review</h2>
          <GameReview pgn={lastPgn} />
        </div>
      )}
    </div>
  );
}
