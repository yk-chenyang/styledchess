'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { useStockfish } from '@/hooks/useStockfish';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * All 10 chess.com annotation categories, ordered worst → best.
 *
 * book     – Opening-theory move (excluded from accuracy).
 * miss     – Failed to capitalise on opponent's mistake/blunder.
 */
type Annotation =
  | 'blunder'     // ?? deep red  — WPL > 20 %
  | 'miss'        // ✗  red-orange — failed to seize clear opportunity
  | 'mistake'     // ?  orange    — WPL 10-20 %
  | 'inaccuracy'  // ?! yellow    — WPL 5-10 %
  | 'good'        //    teal-grey — WPL 2-5 %
  | 'excellent'   //    lime      — WPL 0-2 %
  | 'book'        //    tan       — opening theory (no WPL)
  | 'best'        // ✓  green     — engine's top move
  | 'great'       // !  blue      — creative non-top but nearly equal
  | 'brilliant';  // !! teal      — sacrifice that gains win probability

interface MoveResult {
  annotation: Annotation;
  wpl: number;
  cpLoss: number;
  bestMove: string;   // UCI of engine's #1 suggestion
}

interface ParsedMove {
  san: string;
  from: string;
  to: string;
  color: 'w' | 'b';
  promotion?: string;
}

// ─── Annotation config (colours / symbols matching chess.com) ─────────────────

const ANNOT: Record<Annotation, {
  label: string;
  symbol: string;
  color: string;
  arrowColor: string;
  bg: string;
  graphDot: string | null;
}> = {
  brilliant:  { label:'Brilliant',  symbol:'!!', color:'#1baca6', arrowColor:'rgba(27,172,166,0.85)',  bg:'bg-teal-900/40 border-teal-500',      graphDot:'#1baca6' },
  great:      { label:'Great',      symbol:'!',  color:'#5882cd', arrowColor:'rgba(88,130,205,0.85)',  bg:'bg-blue-900/30 border-blue-500',      graphDot:'#5882cd' },
  best:       { label:'Best',       symbol:'✓',  color:'#769656', arrowColor:'rgba(118,150,86,0.85)',  bg:'bg-green-900/30 border-green-600',    graphDot:null      },
  excellent:  { label:'Excellent',  symbol:'',   color:'#96c44a', arrowColor:'rgba(150,196,74,0.8)',   bg:'bg-lime-900/20 border-lime-700',      graphDot:null      },
  good:       { label:'Good',       symbol:'',   color:'#7a9e5f', arrowColor:'rgba(122,158,95,0.7)',   bg:'bg-green-900/10 border-green-900',    graphDot:null      },
  book:       { label:'Book',       symbol:'',   color:'#b5a05a', arrowColor:'rgba(181,160,90,0.7)',   bg:'bg-yellow-900/10 border-yellow-900',  graphDot:null      },
  inaccuracy: { label:'Inaccuracy', symbol:'?!', color:'#e8c94c', arrowColor:'rgba(232,201,76,0.85)',  bg:'bg-yellow-900/30 border-yellow-600',  graphDot:'#e8c94c' },
  mistake:    { label:'Mistake',    symbol:'?',  color:'#e67e22', arrowColor:'rgba(230,126,34,0.85)',  bg:'bg-orange-900/30 border-orange-600',  graphDot:'#e67e22' },
  miss:       { label:'Miss',       symbol:'✗',  color:'#e05000', arrowColor:'rgba(224,80,0,0.85)',    bg:'bg-orange-900/40 border-orange-700',  graphDot:'#e05000' },
  blunder:    { label:'Blunder',    symbol:'??', color:'#e74c3c', arrowColor:'rgba(231,76,60,0.85)',   bg:'bg-red-900/30 border-red-600',        graphDot:'#e74c3c' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Win probability (0-100 %) for the side with `cp` centipawn advantage.
 * Uses chess.com's published sigmoid coefficient (0.003682).
 */
function cpToWinPct(cp: number): number {
  return 100 / (1 + Math.exp(-0.003682 * cp));
}

/**
 * Win-probability loss (WPL) from the MOVING side's perspective.
 *   beforeScore – engine score from the mover's view (positive = they're winning)
 *   afterScore  – engine score from the opponent's view after the move
 *
 * Positive WPL = mover lost win probability (bad move).
 * Negative WPL = mover gained win probability (great/brilliant move).
 */
function computeWPL(beforeScore: number, afterScore: number): number {
  return cpToWinPct(beforeScore) - cpToWinPct(-afterScore);
}

function computeCpLoss(beforeScore: number, afterScore: number): number {
  return Math.max(0, beforeScore + afterScore);
}

/**
 * Classify a single move using chess.com's 10-category system.
 *
 * @param wpl          Win-probability loss % (negative = gained win%)
 * @param topMoves     Engine's top-N moves from MultiPV (sorted best-first)
 * @param playedUci    The UCI string of the move that was actually played
 * @param plyIndex     0-based half-move index in the game
 * @param isBook       Whether the position/move is in the opening book
 * @param prevAnnot    Annotation of the immediately preceding move (opponent's)
 * @param beforeScore  Engine score from the mover's view BEFORE this move
 * @param legalCount   Number of legal moves available to the mover
 */
function classifyMove(
  wpl: number,
  topMoves: Array<{ move: string; score: number }>,
  playedUci: string,
  plyIndex: number,
  isBook: boolean,
  prevAnnot: Annotation | undefined,
  beforeScore: number,
  legalCount: number,
): Annotation {
  // ── Book ──────────────────────────────────────────────────────────────────
  if (isBook) return 'book';

  const isOpening = plyIndex < 10;                   // first 5 moves each side
  const isForced  = legalCount <= 3;                 // near-forced position

  // ── Is the played move in the engine's top-N list? ────────────────────────
  const playedFrom4 = playedUci.slice(0, 4);
  const isInTop = topMoves.length > 0 &&
    topMoves.some(tm => tm.move.slice(0, 4) === playedFrom4);

  // ── Brilliant ─────────────────────────────────────────────────────────────
  // Non-top move that actually IMPROVED win probability — a creative sacrifice.
  // Excluded from opening (many moves appear equal at any depth) and forced
  // positions (the only move tends to look great by elimination).
  if (wpl <= -3.0 && !isInTop && !isOpening && !isForced) return 'brilliant';

  // ── Best ──────────────────────────────────────────────────────────────────
  // Played move matches one of the engine's top-N choices.
  if (isInTop) return 'best';

  // ── Great ─────────────────────────────────────────────────────────────────
  // Not in top-N but essentially equal in evaluation — a creative find.
  // chess.com is very sparing with this (typically 0-2 per game per player).
  // Disallowed in the opening (many moves look equal) and forced positions
  // (limited choice makes it trivial to be "close to best").
  if (wpl <= 1.0 && !isOpening && !isForced) return 'great';

  // ── Miss ──────────────────────────────────────────────────────────────────
  // The OPPONENT's previous move was a Mistake or Blunder, handing the current
  // player a clear advantage (beforeScore > 80 cp).  The current player failed
  // to capitalise on that gift.  WPL is capped at 30 % — anything beyond that
  // is so bad it rises to a Blunder even in context.
  const prevWasBad   = prevAnnot === 'blunder' || prevAnnot === 'mistake';
  const hadOpportunity = beforeScore > 80;          // mover had ≥ ~1 pawn advantage
  if (prevWasBad && hadOpportunity && wpl > 5.0 && wpl <= 30.0) return 'miss';

  // ── Standard centipawn-loss bands ─────────────────────────────────────────
  // These naturally become lenient when the mover is already severely losing
  // (their max possible WPL is bounded by their remaining win probability).
  if (wpl <=  2.0) return 'excellent';
  if (wpl <=  5.0) return 'good';
  if (wpl <= 10.0) return 'inaccuracy';
  if (wpl <= 20.0) return 'mistake';
  return 'blunder';
}

/**
 * Per-move accuracy (0-100 %) using chess.com's published formula.
 *
 * At NNUE depth 16 the WPL values are close to chess.com's depth-20+ output,
 * so no calibration multiplier is needed.
 */
function wplToAccuracy(wpl: number): number {
  return Math.max(0, Math.min(100,
    103.1668 * Math.exp(-0.04354 * Math.max(0, wpl)) - 3.1668,
  ));
}

// ─── Lichess opening-book detection ──────────────────────────────────────────

/**
 * Returns true if `playedUci` appears in the Lichess Masters opening database
 * for the given `fen`.  Used to classify opening-theory moves as "Book".
 *
 * Failures (network error, timeout, API unavailable) silently return false so
 * analysis continues normally without book labels.
 */
async function checkBookMove(fen: string, playedUci: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(
      `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}&topGames=0&recentGames=0`,
      { signal: controller.signal },
    );
    clearTimeout(id);
    if (!res.ok) return false;
    const data = await res.json() as {
      moves?: Array<{ uci: string; white: number; black: number; draws: number }>;
    };
    const from4 = playedUci.slice(0, 4);
    return !!(data.moves?.some(
      m => m.uci.slice(0, 4) === from4 && (m.white + m.black + m.draws) > 0,
    ));
  } catch {
    return false;
  }
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

  const toY = (cp: number | null) => {
    const pct = cpToWinPct(cp ?? 0);
    return 2 + ((100 - pct) / 100) * (GRAPH_H - 4);
  };

  const midY = toY(0);
  const xAt  = (i: number) => n <= 1 ? W / 2 : (i / (n - 1)) * W;
  const pts  = scores.map((s, i) => [xAt(i), toY(s)] as [number, number]);

  const curvePath = pts.length < 2
    ? ''
    : pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  const whiteFill = pts.length < 2
    ? ''
    : [
        `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`,
        ...pts.slice(1).map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`),
        `L${pts[n - 1][0].toFixed(1)},${GRAPH_H}`,
        `L${pts[0][0].toFixed(1)},${GRAPH_H}`,
        'Z',
      ].join(' ');

  const dots = Array.from(results.entries())
    .filter(([, r]) => ANNOT[r.annotation].graphDot !== null)
    .map(([i, r]) => {
      const posIdx = i + 1;
      return { x: xAt(posIdx), y: toY(scores[posIdx] ?? null), color: ANNOT[r.annotation].graphDot! };
    });

  const indX = viewIndex >= 0 && viewIndex < n ? xAt(viewIndex) : null;
  const indY = indX !== null ? toY(scores[viewIndex] ?? null) : null;

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel  = (e.clientX - rect.left) / rect.width;
    onNavigate(Math.round(rel * (n - 1)));
  };

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden border border-chess-border"
      style={{ height: GRAPH_H, background: '#1a1a2a' }}
    >
      <svg width={W} height={GRAPH_H} className="block cursor-pointer" onClick={handleClick}>
        <rect x={0} y={0} width={W} height={GRAPH_H} fill="#1a1a2a" />

        {hasData && (
          <>
            <path d={whiteFill} fill="rgba(230,230,230,0.90)" />
            <line x1={0} y1={midY} x2={W} y2={midY}
              stroke="rgba(160,160,160,0.2)" strokeWidth="1" />
            <path d={curvePath} fill="none"
              stroke="rgba(200,200,200,0.55)" strokeWidth="1.5" />
            {dots.map((d, k) => (
              <circle key={k} cx={d.x} cy={d.y} r={4}
                fill={d.color} stroke="rgba(0,0,0,0.5)" strokeWidth={1} />
            ))}
          </>
        )}

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

  const [results, setResults]     = useState<Map<number, MoveResult>>(new Map());
  const [posScores, setPosScores] = useState<(number | null)[]>([]);
  const posScoresRef              = useRef<(number | null)[]>([]);

  const [analyzing, setAnalyzing]       = useState(false);
  const [progress, setProgress]         = useState(0);
  const [analyzeError, setAnalyzeError] = useState('');
  const [bookingStatus, setBookingStatus] = useState('');

  const stockfish    = useStockfish();
  const moveListRef  = useRef<HTMLDivElement>(null);
  const analyzingRef = useRef(false);

  // ─── Parse PGN ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!pgn?.trim()) return;
    try {
      const loader = new Chess();
      loader.loadPgn(pgn);
      const sanHistory = loader.history();
      const headers    = loader.header() as Record<string, string>;
      const startFen   = headers['FEN'] ??
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

      const replay        = new Chess(startFen);
      const fens: string[]         = [replay.fen()];
      const parsedMoves: ParsedMove[] = [];

      for (const san of sanHistory) {
        try {
          const m = replay.move(san);
          if (!m) break;
          fens.push(replay.fen());
          parsedMoves.push({
            san: m.san, from: m.from, to: m.to,
            color: m.color as 'w' | 'b', promotion: m.promotion,
          });
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
  //
  // Phase 0 – Book detection (Lichess Masters API, up to first 20 half-moves).
  // Phase 1 – Analyze each of the N+1 positions ONCE with MultiPV=2, depth 16.
  // Phase 2 – As each consecutive pair of positions is ready, classify the move
  //           between them and update the UI progressively.
  //
  // Key improvements vs. a single-PV approach:
  //   • A move in the engine's top-2 is labelled Best (not inflated to Great).
  //   • Great only fires for genuinely creative non-top moves (WPL ≤ 1 %).
  //   • Miss fires when the opponent blundered/mistook and the mover didn't cash in.
  //   • Book moves are excluded from accuracy and shown with a book label.

  const analyze = useCallback(async () => {
    if (!stockfish.ready || analyzingRef.current || moves.length === 0) return;
    analyzingRef.current = true;
    setAnalyzing(true);
    setResults(new Map());
    setPosScores(new Array(fenHistory.length).fill(null));
    posScoresRef.current = new Array(fenHistory.length).fill(null);
    setAnalyzeError('');
    setProgress(0);

    // Reset to full engine strength (bot-play may have lowered skill level)
    stockfish.configure({ skillLevel: 20, contempt: 0 });

    // ── Phase 0: Book detection ──────────────────────────────────────────────

    const bookStatus = new Array(moves.length).fill(false);
    setBookingStatus('Checking opening book…');
    let whiteBookDone = false, blackBookDone = false;
    const maxBookPly = Math.min(moves.length, 20);
    for (let i = 0; i < maxBookPly; i++) {
      if (whiteBookDone && blackBookDone) break;
      if (moves[i].color === 'w' && whiteBookDone) continue;
      if (moves[i].color === 'b' && blackBookDone) continue;

      const fen        = fenHistory[i];
      const playedUci  = moves[i].from + moves[i].to + (moves[i].promotion ?? '');
      const isBook     = await checkBookMove(fen, playedUci);
      bookStatus[i]    = isBook;

      if (!isBook) {
        if (moves[i].color === 'w') whiteBookDone = true;
        else                         blackBookDone = true;
      }
    }
    setBookingStatus('');

    // ── Phase 1 + 2: Engine analysis & classification ────────────────────────

    const newResults = new Map<number, MoveResult>();
    const posAnalyses: Array<{
      score: number;
      bestMove: string;
      pv: string[];
      topMoves: Array<{ move: string; score: number }>;
    } | null> = new Array(fenHistory.length).fill(null);

    let prevAnnot: Annotation | undefined = undefined;

    for (let i = 0; i < fenHistory.length; i++) {
      setProgress(Math.round(((i + 1) / fenHistory.length) * 100));
      const fen = fenHistory[i];
      if (!fen) continue;

      try {
        const result = await stockfish.analyzePosition(fen, 16);
        posAnalyses[i] = result;

        // Update evaluation graph (white-perspective score)
        const turn = fen.split(' ')[1];
        posScoresRef.current[i] = turn === 'w' ? result.score : -result.score;
        setPosScores([...posScoresRef.current]);

        // Once we have two consecutive positions, classify the move between them
        if (i > 0 && posAnalyses[i - 1] !== null) {
          const before   = posAnalyses[i - 1]!;
          const after    = result;
          const moveIdx  = i - 1;

          const wpl       = computeWPL(before.score, after.score);
          const cpLoss    = computeCpLoss(before.score, after.score);
          const playedUci = moves[moveIdx].from + moves[moveIdx].to +
                            (moves[moveIdx].promotion ?? '');

          // Count legal moves from the position before this move
          let legalCount = 20; // default (non-forced)
          try { legalCount = new Chess(fenHistory[moveIdx]).moves().length; } catch {}

          const annotation = classifyMove(
            wpl,
            before.topMoves,
            playedUci,
            moveIdx,
            bookStatus[moveIdx],
            prevAnnot,
            before.score,
            legalCount,
          );

          // Store engine's #1 suggestion (top of MultiPV)
          const bestMoveUci = before.topMoves[0]?.move ?? before.bestMove;

          newResults.set(moveIdx, { annotation, wpl, cpLoss, bestMove: bestMoveUci });
          setResults(new Map(newResults));
          prevAnnot = annotation;
        }
      } catch {
        // skip on engine error
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

  const arrows = useMemo((): [string, string, string][] => {
    if (!viewMove) return [];
    const arr: [string, string, string][] = [];
    const ac = viewResult ? ANNOT[viewResult.annotation].arrowColor : 'rgba(118,150,86,0.7)';
    arr.push([viewMove.from, viewMove.to, ac]);

    // chess.com does NOT show the engine's best-move arrow when the player
    // already played a Book, Best, Great, or Brilliant move.
    const suppressBest = viewResult &&
      (['book', 'best', 'great', 'brilliant'] as Annotation[]).includes(viewResult.annotation);

    if (!suppressBest && viewResult) {
      const bm = viewResult.bestMove ?? '';
      if (bm.length >= 4) {
        const bf = bm.slice(0, 2), bt = bm.slice(2, 4);
        if (bf !== viewMove.from || bt !== viewMove.to)
          arr.push([bf, bt, 'rgba(0,200,120,0.9)']);
      }
    }
    return arr;
  }, [viewMove, viewResult]);

  // Per-colour accuracy — Book moves are excluded (chess.com convention)
  const { whiteAcc, blackAcc } = useMemo(() => {
    const w: number[] = [], b: number[] = [];
    results.forEach((r, i) => {
      if (r.annotation === 'book') return;
      (moves[i]?.color === 'w' ? w : b).push(wplToAccuracy(r.wpl));
    });
    const avg = (a: number[]) =>
      a.length
        ? parseFloat((a.reduce((s, v) => s + v, 0) / a.length).toFixed(1))
        : null;
    return { whiteAcc: avg(w), blackAcc: avg(b) };
  }, [results, moves]);

  // Per-colour category counts (10 categories)
  const categoryCounts = useMemo(() => {
    const empty = (): Record<Annotation, number> => ({
      brilliant: 0, great: 0, best: 0, excellent: 0, good: 0,
      book: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0,
    });
    const w = empty(), b = empty();
    results.forEach((r, i) => {
      (moves[i]?.color === 'w' ? w : b)[r.annotation]++;
    });
    return { white: w, black: b };
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

      {/* ── Evaluation graph ─────────────────────────────────────── */}
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

          {/* Accuracy + category summary */}
          {(whiteAcc !== null || blackAcc !== null) && (
            <div className="bg-chess-bg-card border border-chess-border rounded-lg px-4 py-3">
              <div className="flex gap-8 mb-2">
                <AccBar label="White" pct={whiteAcc} />
                <AccBar label="Black" pct={blackAcc} />
              </div>
              <CategoryTable
                whiteCounts={categoryCounts.white}
                blackCounts={categoryCounts.black}
              />
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
            <NavBtn onClick={() => setViewIndex(0)}
              disabled={viewIndex === 0} title="Start">⏮</NavBtn>
            <NavBtn onClick={() => setViewIndex(i => Math.max(0, i - 1))}
              disabled={viewIndex === 0} title="← Prev">◀</NavBtn>
            <NavBtn onClick={() => setViewIndex(i => Math.min(fenHistory.length - 1, i + 1))}
              disabled={viewIndex === fenHistory.length - 1} title="Next →">▶</NavBtn>
            <NavBtn onClick={() => setViewIndex(fenHistory.length - 1)}
              disabled={viewIndex === fenHistory.length - 1} title="End">⏭</NavBtn>
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
                  {Math.ceil(viewIndex / 2)}{viewMove.color === 'b' ? '…' : '.'}&nbsp;{viewMove.san}
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

              {/* Show WPL / best-move hint only for "bad" or noteworthy moves */}
              {viewResult && viewResult.annotation !== 'book' && viewResult.wpl > 0.5 && (
                <p className="text-chess-text-secondary mt-1 text-xs">
                  −{viewResult.wpl.toFixed(1)}&thinsp;% win probability
                  {viewResult.cpLoss > 0 && <> · −{viewResult.cpLoss}&thinsp;cp</>}
                  {/* Only show best-move hint when player didn't already play great */}
                  {!(['book', 'best', 'great', 'brilliant'] as Annotation[])
                      .includes(viewResult.annotation) &&
                    (viewResult.bestMove?.length ?? 0) >= 4 && (
                      <> · Best:&nbsp;<code className="font-mono"
                          style={{ color: ANNOT.best.color }}>
                        {viewResult.bestMove!.slice(0, 2)}→{viewResult.bestMove!.slice(2, 4)}
                      </code></>
                    )
                  }
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right: analyze button + move list */}
        <div className="flex-1 min-w-[220px] flex flex-col gap-3">

          <button
            onClick={analyze}
            disabled={analyzing || !stockfish.ready}
            className="w-full py-2 bg-chess-green hover:bg-chess-green-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {analyzing
              ? <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {bookingStatus || `Analyzing… ${progress}%`}
                </span>
              : results.size > 0 ? 'Re-analyze' : 'Analyze Game'}
          </button>

          {analyzeError && (
            <div className="bg-red-900/30 border border-red-600/50 text-red-300 rounded-lg px-3 py-2 text-sm">
              {analyzeError}
            </div>
          )}

          {analyzing && !bookingStatus && (
            <div className="w-full bg-chess-border rounded-full h-1">
              <div className="bg-chess-green h-1 rounded-full transition-all duration-300"
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
          {analyzing && !bookingStatus && (
            <p className="text-chess-text-secondary text-xs text-center opacity-60 select-none">
              Deep analysis (NNUE depth 16) — typically 1–3 min for a full game
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NavBtn({
  onClick, disabled, title, children,
}: {
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
  const color = pct === null ? '#888' : pct >= 80 ? '#769656' : pct >= 60 ? '#e8c94c' : '#e74c3c';
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

/**
 * 10-category move-count table matching chess.com's summary panel.
 * Only rows where at least one player has ≥ 1 move are shown.
 */
function CategoryTable({
  whiteCounts,
  blackCounts,
}: {
  whiteCounts: Record<Annotation, number>;
  blackCounts: Record<Annotation, number>;
}) {
  // chess.com's top-to-bottom ordering
  const rows: Annotation[] = [
    'brilliant', 'great', 'best', 'excellent', 'good',
    'book', 'inaccuracy', 'mistake', 'miss', 'blunder',
  ];
  const visible = rows.filter(a => (whiteCounts[a] ?? 0) > 0 || (blackCounts[a] ?? 0) > 0);
  if (visible.length === 0) return null;

  return (
    <div className="border-t border-chess-border pt-2 mt-1">
      {visible.map(ann => {
        const w   = whiteCounts[ann] ?? 0;
        const b   = blackCounts[ann] ?? 0;
        const cfg = ANNOT[ann];
        return (
          <div key={ann} className="flex items-center text-xs py-0.5 gap-1">
            <span style={{ color: cfg.color }}
              className="w-5 text-center font-bold shrink-0 leading-none">
              {cfg.symbol || '·'}
            </span>
            <span className="text-chess-text-secondary flex-1 truncate">{cfg.label}</span>
            <span className="w-7 text-right font-mono tabular-nums"
              style={{ color: w > 0 ? cfg.color : '#4a4a5a' }}>{w}</span>
            <span className="text-chess-text-secondary opacity-30 px-0.5">|</span>
            <span className="w-7 text-left font-mono tabular-nums"
              style={{ color: b > 0 ? cfg.color : '#4a4a5a' }}>{b}</span>
          </div>
        );
      })}
    </div>
  );
}

function MoveBtn({
  move, result, isActive, onClick,
}: {
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
