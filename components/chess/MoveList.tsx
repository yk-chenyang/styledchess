'use client';

import { useEffect, useRef } from 'react';

interface AnnotatedMove {
  san: string;
  color: 'w' | 'b';
  annotation?: string;
  cpLoss?: number;
}

const annotationColors: Record<string, string> = {
  best: 'text-chess-green',
  excellent: 'text-blue-400',
  good: 'text-green-400',
  inaccuracy: 'text-yellow-400',
  mistake: 'text-orange-400',
  blunder: 'text-red-400',
};

const annotationSymbols: Record<string, string> = {
  best: '✓',
  excellent: '!',
  good: '',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

interface Props {
  moves: AnnotatedMove[];
}

export default function MoveList({ moves }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [moves.length]);

  // Group moves into pairs (white + black)
  const pairs: { moveNum: number; white?: AnnotatedMove; black?: AnnotatedMove }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({
      moveNum: Math.floor(i / 2) + 1,
      white: moves[i],
      black: moves[i + 1],
    });
  }

  return (
    <div className="bg-chess-bg-card border border-chess-border rounded-lg p-4 h-full min-h-[200px] max-h-[520px] overflow-y-auto">
      <h3 className="text-chess-text-secondary text-xs uppercase tracking-wider font-semibold mb-3">
        Moves
      </h3>

      {pairs.length === 0 ? (
        <p className="text-chess-text-secondary text-sm">Game not started yet</p>
      ) : (
        <div className="space-y-0.5">
          {pairs.map(({ moveNum, white, black }) => (
            <div key={moveNum} className="flex items-center gap-1 text-sm">
              <span className="text-chess-text-secondary w-8 text-right shrink-0">{moveNum}.</span>
              <MoveToken move={white} />
              {black && <MoveToken move={black} />}
            </div>
          ))}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function MoveToken({ move }: { move?: AnnotatedMove }) {
  if (!move) return <span className="w-20" />;
  const annotClass = move.annotation ? annotationColors[move.annotation] : 'text-chess-text-primary';
  const symbol = move.annotation ? annotationSymbols[move.annotation] : '';

  return (
    <span className={`w-20 font-mono ${annotClass}`}>
      {move.san}
      {symbol && <sup className="text-xs ml-0.5">{symbol}</sup>}
    </span>
  );
}
