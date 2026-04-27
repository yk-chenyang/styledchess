'use client';

import { useState, useCallback } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { useStockfish } from '@/hooks/useStockfish';

interface MoveReview {
  moveNum: number;
  color: 'w' | 'b';
  san: string;
  fen: string;
  cpBefore: number;
  cpAfter: number;
  cpLoss: number;
  annotation: 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
  bestMove: string;
}

const annotationConfig = {
  best:       { label: 'Best',       color: '#769656', symbol: '✓', bg: 'bg-green-900/30 border-green-600' },
  excellent:  { label: 'Excellent',  color: '#4a9eff', symbol: '!', bg: 'bg-blue-900/30 border-blue-500' },
  good:       { label: 'Good',       color: '#22c55e', symbol: '',  bg: 'bg-green-900/20 border-green-700' },
  inaccuracy: { label: 'Inaccuracy', color: '#eab308', symbol: '?!',bg: 'bg-yellow-900/30 border-yellow-600' },
  mistake:    { label: 'Mistake',    color: '#f97316', symbol: '?', bg: 'bg-orange-900/30 border-orange-600' },
  blunder:    { label: 'Blunder',    color: '#ef4444', symbol: '??',bg: 'bg-red-900/30 border-red-600' },
};

function cpLossToAnnotation(cpLoss: number): MoveReview['annotation'] {
  if (cpLoss <= 10)  return 'best';
  if (cpLoss <= 25)  return 'excellent';
  if (cpLoss <= 50)  return 'good';
  if (cpLoss <= 100) return 'inaccuracy';
  if (cpLoss <= 200) return 'mistake';
  return 'blunder';
}

interface Props {
  pgn: string;
}

export default function GameReview({ pgn }: Props) {
  const [reviews, setReviews] = useState<MoveReview[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const stockfish = useStockfish();

  const analyze = useCallback(async () => {
    if (!stockfish.ready) return;
    setAnalyzing(true);
    setReviews([]);

    const game = new Chess();
    game.loadPgn(pgn);
    const history = game.history({ verbose: true });

    const positions: { fen: string; move: (typeof history)[0] }[] = [];
    const replay = new Chess();

    for (const move of history) {
      positions.push({ fen: replay.fen(), move });
      replay.move(move.san);
    }

    const results: MoveReview[] = [];

    for (let i = 0; i < positions.length; i++) {
      setProgress(Math.round((i / positions.length) * 100));
      const { fen, move } = positions[i];

      try {
        // Evaluate position before the move
        const before = await stockfish.analyzePosition(fen, 16);
        // Make the move and evaluate after
        const afterGame = new Chess(fen);
        afterGame.move(move.san);
        const after = await stockfish.analyzePosition(afterGame.fen(), 16);

        // CP loss from perspective of the moving side
        const cpBefore = move.color === 'w' ? before.score : -before.score;
        const cpAfter = move.color === 'w' ? -after.score : after.score;
        const cpLoss = Math.max(0, cpBefore - cpAfter);

        results.push({
          moveNum: Math.floor(i / 2) + 1,
          color: move.color as 'w' | 'b',
          san: move.san,
          fen,
          cpBefore,
          cpAfter,
          cpLoss,
          annotation: cpLossToAnnotation(cpLoss),
          bestMove: before.bestMove,
        });
      } catch {
        // Skip failed analyses
      }
    }

    setReviews(results);
    setCurrentIndex(0);
    setAnalyzing(false);
    setProgress(0);
  }, [pgn, stockfish]);

  const currentReview = reviews[currentIndex];
  const displayFen = currentReview?.fen ?? 'start';

  const avgAccuracy = reviews.length > 0
    ? Math.round(
        (reviews.reduce((sum, r) => sum + Math.max(0, 100 - r.cpLoss / 2), 0) / reviews.length)
      )
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <button
          onClick={analyze}
          disabled={analyzing || !stockfish.ready}
          className="px-4 py-2 bg-chess-green hover:bg-chess-green-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {analyzing ? `Analyzing... ${progress}%` : 'Analyze Game'}
        </button>
        {avgAccuracy !== null && (
          <span className="text-chess-text-secondary text-sm">
            Your accuracy: <strong className="text-chess-text-primary">{avgAccuracy}%</strong>
          </span>
        )}
      </div>

      {reviews.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="rounded-lg overflow-hidden">
            <Chessboard
              position={displayFen}
              boardWidth={400}
              areArrowsAllowed={false}
              customDarkSquareStyle={{ backgroundColor: '#b58863' }}
              customLightSquareStyle={{ backgroundColor: '#f0d9b5' }}
            />
          </div>

          <div className="flex-1 space-y-2">
            {currentReview && (
              <div className={`border rounded-lg px-4 py-3 ${annotationConfig[currentReview.annotation].bg}`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-chess-text-primary">
                    {currentReview.moveNum}. {currentReview.color === 'b' ? '...' : ''}{currentReview.san}
                    <sup className="ml-1 text-sm">{annotationConfig[currentReview.annotation].symbol}</sup>
                  </span>
                  <span className="text-sm font-semibold" style={{ color: annotationConfig[currentReview.annotation].color }}>
                    {annotationConfig[currentReview.annotation].label}
                  </span>
                </div>
                {currentReview.cpLoss > 10 && (
                  <p className="text-chess-text-secondary text-sm mt-1">
                    -{currentReview.cpLoss} centipawns. Best: <code className="text-chess-green">{currentReview.bestMove}</code>
                  </p>
                )}
              </div>
            )}

            <div className="max-h-64 overflow-y-auto space-y-0.5">
              {reviews.map((r, idx) => {
                const cfg = annotationConfig[r.annotation];
                return (
                  <button
                    key={idx}
                    onClick={() => setCurrentIndex(idx)}
                    className={`w-full text-left px-3 py-1 rounded text-sm flex items-center gap-2 transition-colors
                      ${idx === currentIndex ? 'bg-chess-bg-hover' : 'hover:bg-chess-bg-hover/50'}`}
                  >
                    <span className="text-chess-text-secondary w-8 text-right">
                      {r.moveNum}{r.color === 'b' ? '...' : '.'}
                    </span>
                    <span className="font-mono text-chess-text-primary">{r.san}</span>
                    {r.annotation !== 'good' && (
                      <span className="ml-auto text-xs font-semibold" style={{ color: cfg.color }}>
                        {cfg.symbol || cfg.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                className="px-3 py-1 bg-chess-bg-hover hover:bg-chess-border rounded text-sm text-chess-text-primary"
              >
                ←
              </button>
              <button
                onClick={() => setCurrentIndex(Math.min(reviews.length - 1, currentIndex + 1))}
                className="px-3 py-1 bg-chess-bg-hover hover:bg-chess-border rounded text-sm text-chess-text-primary"
              >
                →
              </button>
              <span className="text-chess-text-secondary text-sm flex items-center">
                {currentIndex + 1} / {reviews.length}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
