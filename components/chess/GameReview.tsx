'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { useStockfish } from '@/hooks/useStockfish';

// ─── Types ────────────────────────────────────────────────────────────────────

// Ordered worst → best (matches chess.com category order)
type Annotation =
  | 'blunder'     // ?? red
  | 'mistake'     // ?  orange
  | 'inaccuracy'  // ?! yellow
  | 'good'        //    green-grey (no symbol)
  | 'excellent'   //    light green (no symbol)
  | 'best'        // ✓  green  (matched engine's top move)
  | 'great'       // !  blue   (very close but different from engine's top)
  | 'brilliant';  // !! teal   (impressive sacrifice / improvement)

interface MoveResult {
  annotation: Annotation;
  wpl: number;      // win-probability loss % (used for classification & accuracy)
  cpLoss: number;   // raw centipawn loss (shown in detail panel)
  bestMove: string;
}

interface ParsedMove {
  san: string;
  from: string;
  to: string;
  color: 'w' | 'b';
  promotion?: string;
}

// ─── Annotation config (colors matching chess.com) ───────────────────────────

const ANNOT: Record<Annotation, {
  label: string;
  symbol: string;
  color: string;        // text / accent
  arrowColor: string;   // played-move arrow
  bg: string;           // detail-panel tailwind
  graphDot: string | null;  // dot on graph (null = don't show)
}> = {
  brilliant:  { label:'Brilliant',  symbol:'!!', color:'#1baca6', arrowColor:'rgba(27,172,166,0.85)',  bg:'bg-teal-900/40 border-teal-500',     graphDot:'#1baca6' },
  great:      { label:'Great',      symbol:'!',  color:'#5882cd', arrowColor:'rgba(88,130,205,0.85)',  bg:'bg-blue-900/30 border-blue-500',     graphDot:'#5882cd' },
  best:       { label:'Best',       symbol:'✓',  color:'#769656', arrowColor:'rgba(118,150,86,0.85)', bg:'bg-green-900/30 border-green-600',   graphDot:null },
  excellent:  { label:'Excellent',  symbol:'',   color:'#96c44a', arrowColor:'rgba(150,196,74,0.8)',  bg:'bg-lime-900/20 border-lime-700',     graphDot:null },
  good:       { label:'Good',       symbol:'',   color:'#7a9e5f', arrowColor:'rgba(122,158,95,0.7)',  bg:'bg-green-900/10 border-green-900',   graphDot:null },
  inaccuracy: { label:'Inaccuracy', symbol:'?!', color:'#e8c94c', arrowColor:'rgba(232,201,76,0.85)', bg:'bg-yellow-900/30 border-yellow-600', graphDot:'#e8c94c' },
  mistake:    { label:'Mistake',    symbol:'?',  color:'#e67e22', arrowColor:'rgba(230,126,34,0.85)', bg:'bg-orange-900/30 border-orange-600', graphDot:'#e67e22' },
  blunder:    { label:'Blunder',    symbol:'??', color:'#e74c3c', arrowColor:'rgba(231,76,60,0.85)',  bg:'bg-red-900/30 border-red-600',       graphDot:'#e74c3c' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Win probability for the side with `cp` centipawn advantage (0–100 %).
 * Uses the same sigmoid coefficient chess.com's engine pipeline uses.
 */
function cpToWinPct(cp: number): number {
  return 100 / (1 + Math.exp(-0.003682 * cp));
}

/**
 * Win-probability loss (WPL) for the side that just moved, in percentage points.
 *
 * Both parameters come straight from analyzePosition():
 *   beforeScore  – eval from the MOVING side's perspective (positive = they're winning)
 *   afterScore   – eval from the OPPONENT's perspective after the move (positive = opponent winning)
 *
 * Because the side-to-move flips after the move, the moving side's win %
 * after the move is cpToWinPct(-afterScore).
 *
 * The same formula works for both white and black.
 * Positive WPL = lost win probability (bad move).
 * Negative WPL = gained win probability (great / brilliant move).
 */
function computeWPL(beforeScore: number, afterScore: number): number {
  return cpToWinPct(beforeScore) - cpToWinPct(-afterScore);
}

/**
 * Raw centipawn loss (for display only – NOT used for classification).
 * Same symmetry trick: max(0, beforeScore + afterScore).
 */
function computeCpLoss(beforeScore: number, afterScore: number): number {
  return Math.max(0, beforeScore + afterScore);
}

/**
 * Classify a move by win-probability loss (WPL), with opening-phase awareness.
 *
 * TWO root causes of "Great" inflation were fixed here:
 *
 * 1. Opening-phase exclusion (plyIndex < 12):
 *    At depth 8, the engine often rates e4/d4, e5/c5, etc. as virtually
 *    identical (WPL ≈ 0).  Whichever you play that isn't the engine's
 *    first-listed move would trigger "Great" under the old threshold.
 *    Chess.com avoids this by categorising opening moves as "Book".
 *    We exclude the first 12 half-moves from Brilliant/Great entirely.
 *
 * 2. Tighter "Great" WPL threshold (0.2 % instead of 0.5 %):
 *    0.2 % WPL from equal ≈ 0.5 cp — well below depth-8 noise (≈ ±15 cp).
 *    In practice this fires only when the engine's evaluations for two
 *    moves are genuinely indistinguishable, which is rare outside the
 *    opening.  Target: 0–2 "Great" moves per typical game.
 *
 * WPL thresholds (unchanged from previous version):
 *   0.2 % ≈  1 cp   Best / Great ceiling
 *   2   % ≈  9 cp   Excellent
 *   5   % ≈ 23 cp   Good
 *   8   % ≈ 40 cp   Inaccuracy
 *  16   % ≈ 90 cp   Mistake  (≈ pawn from equal)
 *  >16  %           Blunder
 */
function classifyMove(wpl: number, isBestMove: boolean, plyIndex: number): Annotation {
  const isOpening = plyIndex < 12; // first 6 moves per side — treat as opening phase

  // Brilliant: gained win probability, non-engine move, outside opening
  if (wpl <= -2.0 && !isBestMove && !isOpening) return 'brilliant';

  // Best: matched engine's top choice
  if (isBestMove && wpl <= 0.5) return 'best';

  // Great: VERY strict — different from engine's top but essentially equal quality.
  // Excluded from the opening where many moves have equal depth-8 evals.
  // 0.2 % threshold ≈ 0.5 cp precision — almost never fires at depth 8.
  if (!isBestMove && wpl <= 0.2 && !isOpening) return 'great';

  if (wpl <=  2.0) return 'excellent';
  if (wpl <=  5.0) return 'good';
  if (wpl <=  8.0) return 'inaccuracy';
  if (wpl <= 16.0) return 'mistake';
  return 'blunder';
}

/**
 * Per-move accuracy (0–100 %) aligned with chess.com's scale.
 *
 * Chess.com runs depth 20+ with NNUE, so their WPL values for blunders
 * are much larger (35-45 %) than ours at depth 8 (15-22 %).  Without
 * calibration, our blunders get ~35 % per-move accuracy instead of
 * near-0 %, making game accuracy stay artificially high (e.g. 93 %
 * despite a blunder, vs. chess.com's 70-80 %).
 *
 * Applying a ×2 depth-calibration factor to WPL before the formula
 * compensates: our 22 % WPL blunder is treated as 44 % WPL, giving
 * ~10 % per-move accuracy instead of ~35 %.  This brings game accuracy
 * into the realistic 75-85 % range for a game with one blunder.
 */
function wplToAccuracy(wpl: number): number {
  const DEPTH_CALIBRATION = 2.0; // compensates for depth-8 vs chess.com's depth-20+
  return Math.max(0, Math.min(100,
    103.1668 * Math.exp(-0.04354 * Math.max(0, wpl) * DEPTH_CALIBRATION) - 3.1668,
  ));
}

// ─── EvalGraph ───────────────────────────────────────────────────────────────

const GRAPH_H = 76;

function EvalGraph({
  scores,
  results,
  viewIndex,
  onNavigate,
}: {
  scores: (number | null)[];
  results: Map<number, MoveResult>;
  viewIndex: number;
  onNavigate: (idx: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(480);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = scores.length;
  const hasData = scores.some(s => s !== null);

  // Convert white-perspective cp → Y pixel (top = white winning max, bottom = black winning max)
  const toY = (cp: number | null) => {
    const pct = cpToWinPct(cp ?? 0); // 0–100, 50 = equal
    // pct=100 → y=2 (top, white winning)
    // pct=50  → y=GRAPH_H/2 (middle)
    // pct=0   → y=GRAPH_H-2 (bottom, black winning)
    return 2 + ((100 - pct) / 100) * (GRAPH_H - 4);
  };

  const midY = toY(0); // ≈ GRAPH_H/2

  const xAt = (i: number) =>
    n <= 1 ? W / 2 : (i / (n - 1)) * W;

  // Build SVG path of the evaluation curve
  const pts = scores.map((s, i) => [xAt(i), toY(s)] as [number, number]);

  const curvePath = pts.length < 2
    ? ''
    : pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  // White-territory fill: from the curve DOWN to the bottom edge
  const whiteFill = pts.length < 2
    ? ''
    : [
        `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`,
        ...pts.slice(1).map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`),
        `L${pts[n - 1][0].toFixed(1)},${GRAPH_H}`,
        `L${pts[0][0].toFixed(1)},${GRAPH_H}`,
        'Z',
      ].join(' ');

  // Dots for notable moves (inaccuracy / mistake / blunder / great / brilliant)
  const dots = Array.from(results.entries())
    .filter(([, r]) => ANNOT[r.annotation].graphDot !== null)
    .map(([i, r]) => {
      const posIdx = i + 1; // result[i] describes move i, leading to position i+1
      return { x: xAt(posIdx), y: toY(scores[posIdx] ?? null), color: ANNOT[r.annotation].graphDot! };
    });

  // Indicator for current position
  const indX = viewIndex >= 0 && viewIndex < n ? xAt(viewIndex) : null;
  const indY = indX !== null ? toY(scores[viewIndex] ?? null) : null;

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    onNavigate(Math.round(rel * (n - 1)));
  };

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden border border-chess-border"
      style={{ height: GRAPH_H, background: '#1a1a2a' }}
    >
      <svg width={W} height={GRAPH_H} className="block cursor-pointer" onClick={handleClick}>
        {/* Dark background */}
        <rect x={0} y={0} width={W} height={GRAPH_H} fill="#1a1a2a" />

        {hasData && (
          <>
            {/* White territory (below curve = white winning) */}
            <path d={whiteFill} fill="rgba(230,230,230,0.90)" />

            {/* Midline */}
            <line x1={0} y1={midY} x2={W} y2={midY}
              stroke="rgba(160,160,160,0.2)" strokeWidth="1" />

            {/* Evaluation curve */}
            <path d={curvePath} fill="none"
              stroke="rgba(200,200,200,0.55)" strokeWidth="1.5" />

            {/* Annotation dots on the curve */}
            {dots.map((d, k) => (
              <circle key={k} cx={d.x} cy={d.y} r={4}
                fill={d.color} stroke="rgba(0,0,0,0.5)" strokeWidth={1} />
            ))}
          </>
        )}

        {/* Current-position indicator */}
        {indX !== null && (
          <>
            <line x1={indX} y1={0} x2={indX} y2={GRAPH_H}
              stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
            {indY !== null && (
              <circle cx={indX} cy={indY} r={5}
                fill="white" stroke="rgba(0,0,0,0.45)" strokeWidth={1.5} />
            )}
          </>
        )}
      </svg>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { pgn: string }

export default function GameReview({ pgn }: Props) {
  const [fenHistory, setFenHistory] = useState<string[]>([]);
  const [moves, setMoves]           = useState<ParsedMove[]>([]);
  const [viewIndex, setViewIndex]   = useState(0);

  const [results, setResults]           = useState<Map<number, MoveResult>>(new Map());
  /** White-perspective centipawn score for each position (index = viewIndex). */
  const [posScores, setPosScores]       = useState<(number | null)[]>([]);
  const posScoresRef                    = useRef<(number | null)[]>([]);

  const [analyzing, setAnalyzing]       = useState(false);
  const [progress, setProgress]         = useState(0);
  const [analyzeError, setAnalyzeError] = useState('');

  const stockfish    = useStockfish();
  const moveListRef  = useRef<HTMLDivElement>(null);
  const analyzingRef = useRef(false);

  // ─── Parse PGN immediately ────────────────────────────────────────────────

  useEffect(() => {
    if (!pgn?.trim()) return;
    try {
      const loader = new Chess();
      loader.loadPgn(pgn);
      const sanHistory = loader.history();
      const headers = loader.header() as Record<string, string>;
      const startFen = headers['FEN'] ??
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

      const replay = new Chess(startFen);
      const fens: string[] = [replay.fen()];
      const parsedMoves: ParsedMove[] = [];

      for (const san of sanHistory) {
        try {
          const m = replay.move(san);
          if (!m) break;
          fens.push(replay.fen());
          parsedMoves.push({ san: m.san, from: m.from, to: m.to,
            color: m.color as 'w' | 'b', promotion: m.promotion });
        } catch { break; }
      }

      setFenHistory(fens);
      setMoves(parsedMoves);
      setViewIndex(fens.length - 1);
      setResults(new Map());
      setPosScores(new Array(fens.length).fill(null));
      posScoresRef.current = new Array(fens.length).fill(null);
      setAnalyzeError('');
    } catch (e) {
      console.error('[GameReview] PGN parse error:', e);
      setAnalyzeError('Could not parse game PGN.');
    }
  }, [pgn]);

  // ─── Scroll active move into view ─────────────────────────────────────────

  useEffect(() => {
    moveListRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [viewIndex]);

  // ─── Keyboard navigation ──────────────────────────────────────────────────

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft')  setViewIndex(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setViewIndex(i => Math.min(fenHistory.length - 1, i + 1));
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [fenHistory.length]);

  // ─── Analysis ─────────────────────────────────────────────────────────────

  const analyze = useCallback(async () => {
    if (!stockfish.ready || analyzingRef.current || moves.length === 0) return;
    analyzingRef.current = true;
    setAnalyzing(true);
    setResults(new Map());
    setPosScores(new Array(fenHistory.length).fill(null));
    posScoresRef.current = new Array(fenHistory.length).fill(null);
    setAnalyzeError('');

    const newResults = new Map<number, MoveResult>();

    for (let i = 0; i < moves.length; i++) {
      setProgress(Math.round(((i + 1) / moves.length) * 100));
      const fenBefore = fenHistory[i];
      const fenAfter  = fenHistory[i + 1];
      if (!fenBefore || !fenAfter) continue;

      try {
        const before      = await stockfish.analyzePosition(fenBefore, 8);
        const afterResult = await stockfish.analyzePosition(fenAfter,  8);

        // White-perspective scores for the evaluation graph
        // FEN second field is the side to move ('w' or 'b')
        const turnBefore = fenBefore.split(' ')[1];
        const turnAfter  = fenAfter.split(' ')[1];
        const whiteCpBefore = turnBefore === 'w' ?  before.score : -before.score;
        const whiteCpAfter  = turnAfter  === 'w' ? afterResult.score : -afterResult.score;

        posScoresRef.current[i]     = whiteCpBefore;
        posScoresRef.current[i + 1] = whiteCpAfter;
        setPosScores([...posScoresRef.current]);

        // Win-probability loss drives classification (context-aware, mirrors chess.com).
        // Raw cpLoss is kept for the detail panel display only.
        const wpl        = computeWPL(before.score, afterResult.score);
        const cpLoss     = computeCpLoss(before.score, afterResult.score);
        const playedUci  = moves[i].from + moves[i].to;
        const isBestMove = before.bestMove.slice(0, 4) === playedUci;
        const annotation = classifyMove(wpl, isBestMove, i);

        newResults.set(i, { annotation, wpl, cpLoss, bestMove: before.bestMove });
        setResults(new Map(newResults));
      } catch {
        // skip on error
      }
    }

    if (newResults.size === 0)
      setAnalyzeError('Analysis produced no results. Try again in a moment.');

    setAnalyzing(false);
    setProgress(0);
    analyzingRef.current = false;
  }, [stockfish, moves, fenHistory]);

  // ─── Derived values ───────────────────────────────────────────────────────

  const displayFen = fenHistory[viewIndex] ?? 'start';
  const viewMove   = moves[viewIndex - 1];
  const viewResult = results.get(viewIndex - 1);

  const highlightSquares = useMemo(() => {
    const sq: Record<string, React.CSSProperties> = {};
    if (viewMove) {
      sq[viewMove.from] = { background: 'rgba(118,150,86,0.30)' };
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

  // Arrows: played move (colored by annotation) + engine's best (green) if different
  const arrows = useMemo((): [string, string, string][] => {
    if (!viewMove) return [];
    const arr: [string, string, string][] = [];
    const ac = viewResult ? ANNOT[viewResult.annotation].arrowColor : 'rgba(118,150,86,0.7)';
    arr.push([viewMove.from, viewMove.to, ac]);
    const bm = viewResult?.bestMove ?? '';
    if (bm.length >= 4) {
      const bf = bm.slice(0, 2);
      const bt = bm.slice(2, 4);
      if (bf !== viewMove.from || bt !== viewMove.to)
        arr.push([bf, bt, 'rgba(0,200,120,0.9)']);
    }
    return arr;
  }, [viewMove, viewResult]);

  // Per-color accuracy
  const { whiteAcc, blackAcc } = useMemo(() => {
    const w: number[] = [], b: number[] = [];
    results.forEach((r, i) => {
      (moves[i]?.color === 'w' ? w : b).push(wplToAccuracy(r.wpl));
    });
    const avg = (a: number[]) => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : null;
    return { whiteAcc: avg(w), blackAcc: avg(b) };
  }, [results, moves]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (fenHistory.length === 0) {
    return (
      <div className="text-chess-text-secondary text-sm py-6 text-center">
        {analyzeError || 'No game data available.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Evaluation graph — full width ─────────────────────────── */}
      <EvalGraph
        scores={posScores}
        results={results}
        viewIndex={viewIndex}
        onNavigate={setViewIndex}
      />

      {/* ── Board + move list ─────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* Left: board + accuracy + nav + detail */}
        <div className="flex flex-col gap-3">

          {/* Accuracy bars (shown once analysis has results) */}
          {(whiteAcc !== null || blackAcc !== null) && (
            <div className="flex gap-8 bg-chess-bg-card border border-chess-border rounded-lg px-4 py-2.5">
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

          {/* Navigation */}
          <div className="flex items-center gap-1.5">
            <NavBtn onClick={() => setViewIndex(0)}                             disabled={viewIndex === 0}                    title="Start">⏮</NavBtn>
            <NavBtn onClick={() => setViewIndex(i => Math.max(0, i - 1))}       disabled={viewIndex === 0}                    title="← Prev">◀</NavBtn>
            <NavBtn onClick={() => setViewIndex(i => Math.min(fenHistory.length - 1, i + 1))} disabled={viewIndex === fenHistory.length - 1} title="Next →">▶</NavBtn>
            <NavBtn onClick={() => setViewIndex(fenHistory.length - 1)}         disabled={viewIndex === fenHistory.length - 1} title="End">⏭</NavBtn>
            <span className="text-chess-text-secondary text-xs ml-1 select-none">
              {viewIndex === 0 ? 'Start' : `Move ${viewIndex} / ${moves.length}`}
            </span>
          </div>

          {/* Move detail panel */}
          {viewMove && (
            <div className={`border rounded-lg px-4 py-3 text-sm
              ${viewResult ? ANNOT[viewResult.annotation].bg : 'bg-chess-bg-card border-chess-border'}`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-chess-text-primary text-base">
                  {Math.ceil(viewIndex / 2)}{viewMove.color === 'b' ? '…' : '.'} {viewMove.san}
                  {viewResult?.annotation && ANNOT[viewResult.annotation].symbol && (
                    <sup className="ml-1 text-sm">{ANNOT[viewResult.annotation].symbol}</sup>
                  )}
                </span>
                {viewResult && (
                  <span className="font-semibold" style={{ color: ANNOT[viewResult.annotation].color }}>
                    {ANNOT[viewResult.annotation].label}
                  </span>
                )}
              </div>
              {viewResult && viewResult.wpl > 0.5 && (
                <p className="text-chess-text-secondary mt-1 text-xs">
                  −{viewResult.wpl.toFixed(1)} % win probability
                  {viewResult.cpLoss > 0 && <> · −{viewResult.cpLoss} cp</>}
                  {(viewResult.bestMove?.length ?? 0) >= 4 && (
                    <> · Best: <code className="font-mono" style={{ color: ANNOT.best.color }}>
                      {viewResult.bestMove!.slice(0, 2)}→{viewResult.bestMove!.slice(2, 4)}
                    </code></>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right: analyze button + move list */}
        <div className="flex-1 min-w-[220px] flex flex-col gap-3">

          {/* Analyze button */}
          <button
            onClick={analyze}
            disabled={analyzing || !stockfish.ready}
            className="w-full py-2 bg-chess-green hover:bg-chess-green-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {analyzing
              ? <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Analyzing… {progress}%
                </span>
              : results.size > 0 ? 'Re-analyze' : 'Analyze Game'}
          </button>

          {analyzeError && (
            <div className="bg-red-900/30 border border-red-600/50 text-red-300 rounded-lg px-3 py-2 text-sm">
              {analyzeError}
            </div>
          )}

          {analyzing && (
            <div className="w-full bg-chess-border rounded-full h-1">
              <div className="bg-chess-green h-1 rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }} />
            </div>
          )}

          {/* Move list */}
          <div ref={moveListRef}
            className="bg-chess-bg-card border border-chess-border rounded-lg p-3 max-h-[480px] overflow-y-auto">
            <div className="space-y-0.5">
              {Array.from({ length: Math.ceil(moves.length / 2) }, (_, p) => {
                const wi = p * 2, bi = p * 2 + 1;
                return (
                  <div key={p} className="flex items-center gap-0.5 text-sm">
                    <span className="text-chess-text-secondary w-8 text-right shrink-0 mr-1 select-none">
                      {p + 1}.
                    </span>
                    <MoveBtn move={moves[wi]} result={results.get(wi)}
                      isActive={viewIndex === wi + 1} onClick={() => setViewIndex(wi + 1)} />
                    {moves[bi]
                      ? <MoveBtn move={moves[bi]} result={results.get(bi)}
                          isActive={viewIndex === bi + 1} onClick={() => setViewIndex(bi + 1)} />
                      : <span className="w-20" />}
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-chess-text-secondary text-xs text-center opacity-50 select-none">
            ← → arrow keys to navigate · click graph to jump
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NavBtn({ onClick, disabled, title, children }: {
  onClick: () => void; disabled: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className="px-2 py-1.5 bg-chess-bg-card hover:bg-chess-bg-hover disabled:opacity-30 rounded text-chess-text-primary text-sm transition-colors">
      {children}
    </button>
  );
}

function AccBar({ label, pct }: { label: string; pct: number | null }) {
  const color = pct === null ? '#888' : pct >= 85 ? '#769656' : pct >= 65 ? '#e8c94c' : '#e74c3c';
  return (
    <div className="flex items-center gap-2">
      <span className="text-chess-text-secondary text-sm w-10">{label}</span>
      {pct !== null ? (
        <>
          <div className="w-20 bg-chess-border rounded-full h-1.5">
            <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
          </div>
          <span className="text-sm font-semibold" style={{ color }}>{pct}%</span>
        </>
      ) : <span className="text-chess-text-secondary text-xs">–</span>}
    </div>
  );
}

function MoveBtn({ move, result, isActive, onClick }: {
  move?: ParsedMove; result?: MoveResult; isActive: boolean; onClick: () => void;
}) {
  if (!move) return <span className="w-20" />;
  const cfg = result ? ANNOT[result.annotation] : null;
  return (
    <button
      data-active={isActive ? 'true' : undefined}
      onClick={onClick}
      className={`w-20 text-left px-1.5 py-0.5 rounded font-mono text-sm transition-colors select-none
        ${isActive ? 'bg-chess-green/30 ring-1 ring-chess-green/60' : 'hover:bg-chess-bg-hover'}`}
      style={{ color: cfg?.color ?? '#c8c8c8' }}
    >
      {move.san}
      {cfg?.symbol ? <sup className="text-xs ml-0.5 opacity-90">{cfg.symbol}</sup> : null}
    </button>
  );
}
