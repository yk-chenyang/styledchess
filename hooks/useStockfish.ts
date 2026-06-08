'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export interface StockfishConfig {
  skillLevel?: number;  // 0-20
  contempt?: number;    // -100 to 100
  moveTime?: number;    // kept for API compat
}

export function useStockfish() {
  const workerRef = useRef<Worker | null>(null);
  const [ready, setReady] = useState(false);

  /**
   * Single message dispatcher.
   * All worker messages route here first. When a getBestMove / analyzePosition
   * call is in flight it sets this ref to its own handler, which returns true
   * to consume the message. Unhandled messages fall through to UCI init logic.
   */
  const activeCallbackRef = useRef<((msg: string) => boolean) | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const worker = new Worker('/stockfish.js');
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent) => {
        const msg = typeof e.data === 'string' ? e.data : (e.data?.toString() ?? '');

        // Route to the active operation first
        if (activeCallbackRef.current) {
          const consumed = activeCallbackRef.current(msg);
          if (consumed) return;
        }

        // UCI init / idle handling
        if (msg === 'uciok') {
          // NNUE is on by default in sf16-nnue — do NOT disable it.
          // A small hash table helps avoid re-searching transpositions within one position.
          worker.postMessage('setoption name Hash value 16');
          worker.postMessage('isready');
        } else if (msg === 'readyok') {
          setReady(true);
        }
        // bestmove with no active callback → stale, ignored
      };

      worker.onerror = (e) => {
        console.error('Stockfish worker error:', e);
      };

      worker.postMessage('uci');

      return () => {
        activeCallbackRef.current = null;
        try { worker.postMessage('quit'); } catch {}
        worker.terminate();
      };
    } catch (err) {
      console.error('Could not start Stockfish worker:', err);
    }
  }, []);

  const configure = useCallback((config: StockfishConfig) => {
    const w = workerRef.current;
    if (!w) return;
    if (config.skillLevel !== undefined)
      w.postMessage(`setoption name Skill Level value ${config.skillLevel}`);
    if (config.contempt !== undefined)
      w.postMessage(`setoption name Contempt value ${config.contempt}`);
  }, []);

  /**
   * Stop any in-flight search and wait for the engine to become idle.
   * Resolves immediately if the engine was already idle (50 ms fallback).
   */
  const stopAndWait = useCallback((): Promise<void> => {
    return new Promise<void>((resolve) => {
      const w = workerRef.current;
      if (!w) { resolve(); return; }

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(fallback);
        // Only clear our own callback
        if (activeCallbackRef.current === handler) activeCallbackRef.current = null;
        resolve();
      };

      // If the engine is already idle stop produces no output → 10 ms fallback
      const fallback = setTimeout(finish, 10);

      const handler = (msg: string): boolean => {
        if (msg.startsWith('bestmove')) { finish(); return true; }
        return false; // let non-bestmove messages fall through (e.g. info lines)
      };

      activeCallbackRef.current = handler;
      w.postMessage('stop');
    });
  }, []);

  // ─── getBestMove ──────────────────────────────────────────────────────────

  const getBestMove = useCallback(
    async (fen: string, config?: StockfishConfig): Promise<string> => {
      const w = workerRef.current;
      if (!w) throw new Error('Stockfish not initialized');

      await stopAndWait();
      if (config) configure(config);

      const skillLevel = config?.skillLevel ?? 10;
      const depth = Math.max(4, Math.min(16, Math.round(skillLevel * 0.7 + 4)));

      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (activeCallbackRef.current === handler) activeCallbackRef.current = null;
          w.postMessage('stop');
          reject(new Error('Stockfish timed out'));
        }, 30_000);

        const handler = (msg: string): boolean => {
          if (msg.startsWith('bestmove')) {
            clearTimeout(timer);
            activeCallbackRef.current = null;
            const move = msg.split(' ')[1] ?? '';
            if (move && move !== '(none)') resolve(move);
            else reject(new Error('Engine returned no move'));
            return true;
          }
          return false;
        };

        activeCallbackRef.current = handler;
        w.postMessage(`position fen ${fen}`);
        w.postMessage(`go depth ${depth}`);
      });
    },
    [configure, stopAndWait],
  );

  // ─── analyzePosition ─────────────────────────────────────────────────────
  //
  // Uses MultiPV=2 by default so we can tell when the played move is one of
  // the engine's top-2 choices (→ Best), vs. merely close to best (→ Great).
  // topMoves[0] is the #1 engine line, topMoves[1] is #2 (if available).

  const analyzePosition = useCallback(
    async (
      fen: string,
      depth = 16,
      multiPv = 2,
    ): Promise<{
      score: number;
      bestMove: string;
      pv: string[];
      topMoves: Array<{ move: string; score: number }>;
    }> => {
      const w = workerRef.current;
      if (!w) return { score: 0, bestMove: '', pv: [], topMoves: [] };

      await stopAndWait();

      // Set MultiPV before the search begins
      w.postMessage(`setoption name MultiPV value ${multiPv}`);

      return new Promise((resolve) => {
        let bestScore = 0;
        let bestMoveStr = '';
        let pvLine: string[] = [];
        // Keyed by multipv rank (1-based); updated on every info depth line
        const pvMap = new Map<number, { score: number; move: string }>();

        const buildTopMoves = () =>
          Array.from(pvMap.entries())
            .sort(([a], [b]) => a - b)
            .map(([, d]) => d);

        const finish = (bm: string) => {
          clearTimeout(timer);
          if (activeCallbackRef.current === handler) activeCallbackRef.current = null;
          // Reset MultiPV so bot-play is unaffected
          w.postMessage('setoption name MultiPV value 1');
          const topMoves = buildTopMoves();
          resolve({
            score: bestScore,
            bestMove: bm || (topMoves[0]?.move ?? ''),
            pv: pvLine,
            topMoves,
          });
        };

        const timer = setTimeout(() => {
          if (activeCallbackRef.current !== handler) return;
          activeCallbackRef.current = (msg: string): boolean => {
            if (msg.startsWith('bestmove')) {
              activeCallbackRef.current = null;
              const bm = msg.split(' ')[1] ?? '';
              w.postMessage('setoption name MultiPV value 1');
              const topMoves = buildTopMoves();
              resolve({
                score: bestScore,
                bestMove: bm || bestMoveStr,
                pv: pvLine,
                topMoves,
              });
              return true;
            }
            return false;
          };
          w.postMessage('stop');
        }, 20_000);

        const handler = (msg: string): boolean => {
          if (msg.startsWith('info')) {
            const scp   = msg.match(/score cp (-?\d+)/);
            const smate = msg.match(/score mate (-?\d+)/);
            const pvM   = msg.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
            const mpvM  = msg.match(/ multipv (\d+)/);
            const fullPv = msg.match(/ pv (.+)/);

            let score = 0;
            if (scp)   score = parseInt(scp[1]);
            if (smate) score = parseInt(smate[1]) > 0 ? 30_000 : -30_000;

            const pvIdx    = mpvM ? parseInt(mpvM[1]) : 1;
            const firstMv  = pvM ? pvM[1] : '';

            if (firstMv) pvMap.set(pvIdx, { score, move: firstMv });

            // Update primary score / PV from the #1 line
            if (pvIdx === 1) {
              if (scp || smate) bestScore = score;
              if (fullPv) pvLine = fullPv[1].split(' ');
            }
            return true;
          }
          if (msg.startsWith('bestmove')) {
            bestMoveStr = msg.split(' ')[1] ?? '';
            finish(bestMoveStr);
            return true;
          }
          return false;
        };

        activeCallbackRef.current = handler;
        w.postMessage(`position fen ${fen}`);
        w.postMessage(`go depth ${depth}`);
      });
    },
    [stopAndWait],
  );

  return { ready, getBestMove, analyzePosition, configure };
}
