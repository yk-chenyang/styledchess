'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { useStockfish } from '@/hooks/useStockfish';

// ─── Types ────────────────────────────────────────────────────────────────────

type Annotation = 'brilliant' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

interface MoveResult {
  annotation: Annotation;
  cpLoss: number;
  bestMove: string;  // UCI best move for the position BEFORE this move
  scoreBefore: number;
}

interface ParsedMove {
  san: string;
  from: string;
  to: string;
  color: 'w' | 'b';
  promotion?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cpLossToAnnotation(cpLoss: number): Annotation {
  if (cpLoss <= 5)   return 'best';
  if (cpLoss <= 20)  return 'excellent';
  if (cpLoss <= 50)  return 'good';
  if (cpLoss <= 100) return 'inaccuracy';
  if (cpLoss <= 200) return 'mistake';
  return 'blunder';
}

/** chess.com accuracy formula: 103.1668 * e^(-0.04354 * cpLoss) - 3.1668 */
function cpLossToAccuracy(cpLoss: number): number {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * cpLoss) - 3.1668));
}

const ANNOT_CFG: Record<Annotation, { label: string; symbol: string; color: string; arrowColor: string; bg: string }> = {
  brilliant:  { label: 'Brilliant',  symbol: '!!', color: '#1baca6', arrowColor: 'rgba(27,172,166,0.85)',  bg: 'bg-teal-900/40 border-teal-500' },
  best:       { label: 'Best',       symbol: '✓',  color: '#769656', arrowColor: 'rgba(118,150,86,0.85)', bg: 'bg-green-900/30 border-green-600' },
  excellent:  { label: 'Excellent',  symbol: '!',  color: '#4a9eff', arrowColor: 'rgba(74,158,255,0.85)', bg: 'bg-blue-900/30 border-blue-500' },
  good:       { label: 'Good',       symbol: '',   color: '#a0b090', arrowColor: 'rgba(160,176,144,0.7)', bg: 'bg-green-900/10 border-green-800' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', color: '#eab308', arrowColor: 'rgba(234,179,8,0.85)',  bg: 'bg-yellow-900/30 border-yellow-600' },
  mistake:    { label: 'Mistake',    symbol: '?',  color: '#f97316', arrowColor: 'rgba(249,115,22,0.85)', bg: 'bg-orange-900/30 border-orange-600' },
  blunder:    { label: 'Blunder',    symbol: '??', color: '#ef4444', arrowColor: 'rgba(239,68,68,0.85)',  bg: 'bg-red-900/30 border-red-600' },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { pgn: string }

export default function GameReview({ pgn }: Props) {
  // Parsed game data (populated immediately from PGN)
  const [fenHistory, setFenHistory] = useState<string[]>([]);
  const [moves, setMoves]           = useState<ParsedMove[]>([]);
  const [viewIndex, setViewIndex]   = useState(0);

  // Analysis results (populated asynchronously)
  const [results, setResults]     = useState<Map<number, MoveResult>>(new Map());
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [analyzeError, setAnalyzeError] = useState('');

  const stockfish = useStockfish();
  const moveListRef = useRef<HTMLDivElement>(null);
  const analyzingRef = useRef(false); // guard against double-click

  // ─── Parse PGN into FEN history immediately ────────────────────────────────

  useEffect(() => {
    if (!pgn) return;
    try {
      const game = new Chess();
      game.loadPgn(pgn);
      const history = game.history({ verbose: true });

      const fens: string[] = [];
      const parsedMoves: ParsedMove[] = [];
      const replay = new Chess();
      fens.push(replay.fen());

      for (const m of history) {
        try {
          const result = replay.move({ from: m.from, to: m.to, promotion: m.promotion });
          if (!result) break;
          fens.push(replay.fen());
          parsedMoves.push({ san: m.san, from: m.from, to: m.to, color: m.color as 'w' | 'b', promotion: m.promotion });
        } catch { break; }
      }

      setFenHistory(fens);
      setMoves(parsedMoves);
      setViewIndex(fens.length - 1); // start at the final position
      setResults(new Map());
      setAnalyzeError('');
    } catch (e) {
      console.error('[GameReview] PGN parse error:', e);
      setAnalyzeError('Could not parse game PGN.');
    }
  }, [pgn]);

  // ─── Scroll active move into view ─────────────────────────────────────────

  useEffect(() => {
    const el = moveListRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [viewIndex]);

  // ─── Keyboard navigation ──────────────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft')  setViewIndex(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setViewIndex(i => Math.min(fenHistory.length - 1, i + 1));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [fenHistory.length]);

  // ─── Async analysis ───────────────────────────────────────────────────────

  const analyze = useCallback(async () => {
    if (!stockfish.ready || analyzingRef.current || moves.length === 0) return;
    analyzingRef.current = true;
    setAnalyzing(true);
    setResults(new Map());
    setAnalyzeError('');

    const newResults = new Map<number, MoveResult>();

    for (let i = 0; i < moves.length; i++) {
      setProgress(Math.round(((i + 1) / moves.length) * 100));

      try {
        const fenBefore = fenHistory[i];
        const fenAfter  = fenHistory[i + 1];
        if (!fenBefore || !fenAfter) continue;

        const [before, after] = await Promise.all([
          // Can't be truly parallel (same engine), so run sequentially
          stockfish.analyzePosition(fenBefore, 8),
          Promise.resolve(null), // placeholder
        ]);
        const afterResult = await stockfish.analyzePosition(fenAfter, 8);

        const move = moves[i];
        // CP from moving side's perspective
        const cpBefore = move.color === 'w' ? before.score  : -before.score;
        const cpAfter  = move.color === 'w' ? -afterResult.score : afterResult.score;
        const cpLoss   = Math.max(0, cpBefore - cpAfter);

        const annotation = cpLossToAnnotation(cpLoss);

        newResults.set(i, { annotation, cpLoss, bestMove: before.bestMove, scoreBefore: before.score });
        // Live update — spread so React sees a new Map reference
        setResults(new Map(newResults));
      } catch {
        // skip this move on error
      }
    }

    if (newResults.size === 0) {
      setAnalyzeError('Analysis failed. The engine may not be ready — wait a moment and try again.');
    }

    setAnalyzing(false);
    setProgress(0);
    analyzingRef.current = false;
  }, [stockfish, moves, fenHistory]);

  // ─── Derived display values ───────────────────────────────────────────────

  const displayFen = fenHistory[viewIndex] ?? 'start';
  const viewMove   = moves[viewIndex - 1];   // move that led to current position
  const viewResult = results.get(viewIndex - 1); // analysis of that move

  // Highlight squares
  const highlightSquares = useMemo(() => {
    const sq: Record<string, React.CSSProperties> = {};
    if (viewMove) {
      sq[viewMove.from] = { background: 'rgba(118,150,86,0.35)' };
      sq[viewMove.to]   = { background: 'rgba(118,150,86,0.55)' };
    }
    try {
      const tmp = new Chess(displayFen);
      if (tmp.inCheck()) {
        const king = tmp.board().flat().find(p => p?.type === 'k' && p.color === tmp.turn());
        if (king) sq[king.square] = { background: 'rgba(220,50,50,0.55)' };
      }
    } catch {}
    return sq;
  }, [viewMove, displayFen]);

  // Arrows: played move (annotation color) + best move (green if different)
  const arrows = useMemo((): [string, string, string][] => {
    const arr: [string, string, string][] = [];
    if (!viewMove) return arr;

    const annotColor = viewResult
      ? ANNOT_CFG[viewResult.annotation].arrowColor
      : 'rgba(118,150,86,0.7)';
    arr.push([viewMove.from, viewMove.to, annotColor]);

    if (viewResult?.bestMove && viewResult.bestMove.length >= 4) {
      const bf = viewResult.bestMove.slice(0, 2);
      const bt = viewResult.bestMove.slice(2, 4);
      if (bf !== viewMove.from || bt !== viewMove.to) {
        arr.push([bf, bt, 'rgba(0,200,120,0.9)']);
      }
    }
    return arr;
  }, [viewMove, viewResult]);

  // Accuracy stats
  const { whiteAcc, blackAcc } = useMemo(() => {
    const w: number[] = [], b: number[] = [];
    results.forEach((r, i) => {
      const arr = moves[i]?.color === 'w' ? w : b;
      arr.push(cpLossToAccuracy(r.cpLoss));
    });
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
    return { whiteAcc: avg(w), blackAcc: avg(b) };
  }, [results, moves]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (fenHistory.length === 0) {
    return (
      <div className="text-chess-text-secondary text-sm py-4 text-center">
        {analyzeError || 'No game data available.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">

      {/* ── Left: Board + nav ── */}
      <div className="flex flex-col gap-3">

        {/* Accuracy bar */}
        {(whiteAcc !== null || blackAcc !== null) && (
          <div className="flex gap-6 bg-chess-bg-card border border-chess-border rounded-lg px-4 py-2 text-sm">
            <AccBar label="White" pct={whiteAcc} />
            <AccBar label="Black" pct={blackAcc} />
          </div>
        )}

        {/* Board */}
        <div className="rounded-lg overflow-hidden shadow-2xl">
          <Chessboard
            position={displayFen}
            boardWidth={480}
            arePiecesDraggable={false}
            customSquareStyles={highlightSquares}
            customArrows={arrows as any}
            customBoardStyle={{ borderRadius: '4px' }}
            customDarkSquareStyle={{ backgroundColor: '#b58863' }}
            customLightSquareStyle={{ backgroundColor: '#f0d9b5' }}
          />
        </div>

        {/* Nav controls */}
        <div className="flex items-center gap-1.5">
          <NavBtn onClick={() => setViewIndex(0)} disabled={viewIndex === 0} title="Start">⏮</NavBtn>
          <NavBtn onClick={() => setViewIndex(i => Math.max(0, i - 1))} disabled={viewIndex === 0} title="Prev (←)">◀</NavBtn>
          <NavBtn onClick={() => setViewIndex(i => Math.min(fenHistory.length - 1, i + 1))} disabled={viewIndex === fenHistory.length - 1} title="Next (→)">▶</NavBtn>
          <NavBtn onClick={() => setViewIndex(fenHistory.length - 1)} disabled={viewIndex === fenHistory.length - 1} title="End">⏭</NavBtn>
          <span className="text-chess-text-secondary text-xs ml-1">
            {viewIndex === 0 ? 'Start' : `Move ${viewIndex} / ${moves.length}`}
          </span>
        </div>

        {/* Current move detail */}
        {viewMove && (
          <div className={`border rounded-lg px-4 py-3 text-sm ${viewResult ? ANNOT_CFG[viewResult.annotation].bg : 'bg-chess-bg-card border-chess-border'}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-chess-text-primary text-base">
                {Math.ceil(viewIndex / 2)}{viewMove.color === 'b' ? '…' : '.'} {viewMove.san}
                {viewResult && ANNOT_CFG[viewResult.annotation].symbol && (
                  <sup className="ml-1 text-sm">{ANNOT_CFG[viewResult.annotation].symbol}</sup>
                )}
              </span>
              {viewResult && (
                <span className="font-semibold text-sm" style={{ color: ANNOT_CFG[viewResult.annotation].color }}>
                  {ANNOT_CFG[viewResult.annotation].label}
                </span>
              )}
            </div>
            {viewResult && viewResult.cpLoss > 5 && (
              <p className="text-chess-text-secondary mt-1">
                −{viewResult.cpLoss} cp
                {viewResult.bestMove && (
                  <> · Best: <code className="text-chess-green font-mono">{viewResult.bestMove.slice(0,2)}→{viewResult.bestMove.slice(2,4)}</code></>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Right: Move list + analyze button ── */}
      <div className="flex-1 min-w-[220px] flex flex-col gap-3">

        {/* Analyze button */}
        <button
          onClick={analyze}
          disabled={analyzing || !stockfish.ready}
          className="w-full py-2 bg-chess-green hover:bg-chess-green-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {analyzing
            ? <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                Analyzing… {progress}%
              </span>
            : results.size > 0
            ? 'Re-analyze'
            : 'Analyze Game'}
        </button>

        {analyzeError && (
          <div className="bg-red-900/30 border border-red-600/50 text-red-300 rounded-lg px-3 py-2 text-sm">
            {analyzeError}
          </div>
        )}

        {/* Progress bar while analyzing */}
        {analyzing && (
          <div className="w-full bg-chess-border rounded-full h-1.5">
            <div
              className="bg-chess-green h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Move list */}
        <div
          ref={moveListRef}
          className="bg-chess-bg-card border border-chess-border rounded-lg p-3 max-h-[520px] overflow-y-auto"
        >
          <div className="space-y-0.5">
            {Array.from({ length: Math.ceil(moves.length / 2) }, (_, pairIdx) => {
              const wIdx = pairIdx * 2;
              const bIdx = pairIdx * 2 + 1;
              const wMove = moves[wIdx];
              const bMove = moves[bIdx];
              return (
                <div key={pairIdx} className="flex items-center gap-0.5 text-sm">
                  <span className="text-chess-text-secondary w-8 text-right shrink-0 mr-1 select-none">
                    {pairIdx + 1}.
                  </span>
                  {wMove && (
                    <MoveButton
                      move={wMove}
                      result={results.get(wIdx)}
                      isActive={viewIndex === wIdx + 1}
                      onClick={() => setViewIndex(wIdx + 1)}
                    />
                  )}
                  {bMove ? (
                    <MoveButton
                      move={bMove}
                      result={results.get(bIdx)}
                      isActive={viewIndex === bIdx + 1}
                      onClick={() => setViewIndex(bIdx + 1)}
                    />
                  ) : <span className="w-20" />}
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-chess-text-secondary text-xs text-center opacity-60">
          ← → arrow keys to navigate
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NavBtn({ onClick, disabled, title, children }: {
  onClick: () => void; disabled: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-2 py-1.5 bg-chess-bg-card hover:bg-chess-bg-hover disabled:opacity-30 rounded text-chess-text-primary text-sm transition-colors"
    >
      {children}
    </button>
  );
}

function AccBar({ label, pct }: { label: string; pct: number | null }) {
  if (pct === null) return (
    <div className="flex items-center gap-2">
      <span className="text-chess-text-secondary w-12">{label}</span>
      <span className="text-chess-text-secondary text-xs">–</span>
    </div>
  );
  const color = pct >= 85 ? '#769656' : pct >= 65 ? '#eab308' : '#ef4444';
  return (
    <div className="flex items-center gap-2">
      <span className="text-chess-text-secondary w-12">{label}</span>
      <div className="w-24 bg-chess-border rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="font-semibold text-chess-text-primary" style={{ color }}>{pct}%</span>
    </div>
  );
}

function MoveButton({ move, result, isActive, onClick }: {
  move: ParsedMove;
  result?: MoveResult;
  isActive: boolean;
  onClick: () => void;
}) {
  const cfg = result ? ANNOT_CFG[result.annotation] : null;

  return (
    <button
      data-active={isActive ? 'true' : undefined}
      onClick={onClick}
      className={`
        w-20 text-left px-1.5 py-0.5 rounded font-mono text-sm transition-colors select-none
        ${isActive
          ? 'bg-chess-green/30 ring-1 ring-chess-green/60'
          : 'hover:bg-chess-bg-hover'}
      `}
      style={{ color: cfg?.color ?? '#c8c8c8' }}
    >
      {move.san}
      {cfg?.symbol && (
        <sup className="text-xs ml-0.5 opacity-90">{cfg.symbol}</sup>
      )}
    </button>
  );
}
