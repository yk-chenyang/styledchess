'use client';

import { useEffect, useRef } from 'react';

export interface AnnotatedMove {
  san: string;
  color: 'w' | 'b';
  from?: string;
  to?: string;
  annotation?: string;
  cpLoss?: number;
}

const annotationColors: Record<string, string> = {
  best:       'text-chess-green',
  excellent:  'text-blue-400',
  good:       'text-green-400',
  inaccuracy: 'text-yellow-400',
  mistake:    'text-orange-400',
  blunder:    'text-red-400',
};

const annotationSymbols: Record<string, string> = {
  best:       '✓',
  excellent:  '!',
  good:       '',
  inaccuracy: '?!',
  mistake:    '?',
  blunder:    '??',
};

interface Props {
  moves: AnnotatedMove[];
  /** Index of the currently-viewed move (0-based). -1 = before any move. */
  currentIndex?: number;
  onMoveClick?: (index: number) => void;
}

export default function MoveList({ moves, currentIndex = -1, onMoveClick }: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Scroll active move into view whenever it changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentIndex]);

  // Group into pairs: white + black
  const pairs: { moveNum: number; wIdx: number; bIdx?: number }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({ moveNum: Math.floor(i / 2) + 1, wIdx: i, bIdx: moves[i + 1] ? i + 1 : undefined });
  }

  return (
    <div className="bg-chess-bg-card border border-chess-border rounded-lg p-4 h-full min-h-[200px] max-h-[520px] overflow-y-auto">
      <h3 className="text-chess-text-secondary text-xs uppercase tracking-wider font-semibold mb-3">
        Moves
      </h3>

      {pairs.length === 0 ? (
        <p className="text-chess-text-secondary text-sm">No moves yet</p>
      ) : (
        <div className="space-y-0.5">
          {pairs.map(({ moveNum, wIdx, bIdx }) => (
            <div key={moveNum} className="flex items-center gap-0.5 text-sm">
              <span className="text-chess-text-secondary w-8 text-right shrink-0 mr-1">{moveNum}.</span>

              <MoveBtn
                move={moves[wIdx]}
                isActive={wIdx === currentIndex}
                onClick={() => onMoveClick?.(wIdx)}
                ref={wIdx === currentIndex ? activeRef : undefined}
              />

              {bIdx !== undefined ? (
                <MoveBtn
                  move={moves[bIdx]}
                  isActive={bIdx === currentIndex}
                  onClick={() => onMoveClick?.(bIdx)}
                  ref={bIdx === currentIndex ? activeRef : undefined}
                />
              ) : (
                <span className="w-20" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { forwardRef } from 'react';

const MoveBtn = forwardRef<HTMLButtonElement, {
  move: AnnotatedMove;
  isActive: boolean;
  onClick: () => void;
}>(function MoveBtn({ move, isActive, onClick }, ref) {
  const annotClass = move.annotation ? annotationColors[move.annotation] : 'text-chess-text-primary';
  const symbol     = move.annotation ? (annotationSymbols[move.annotation] ?? '') : '';

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={`
        w-20 text-left px-1.5 py-0.5 rounded font-mono text-sm transition-colors
        ${isActive
          ? 'bg-chess-green/30 text-chess-text-primary ring-1 ring-chess-green/60'
          : 'hover:bg-chess-bg-hover text-chess-text-primary'}
        ${annotClass}
      `}
    >
      {move.san}
      {symbol && <sup className="text-xs ml-0.5 opacity-80">{symbol}</sup>}
    </button>
  );
});
