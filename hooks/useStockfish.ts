'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export interface StockfishConfig {
  skillLevel?: number;  // 0-20
  contempt?: number;    // -100 to 100
  moveTime?: number;    // ms (unused now, kept for API compat)
}

export function useStockfish() {
  const workerRef = useRef<Worker | null>(null);
  const resolverRef = useRef<((move: string) => void) | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const worker = new Worker('/stockfish.js');
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent) => {
        const msg = typeof e.data === 'string' ? e.data : e.data?.toString() ?? '';
        if (!msg.startsWith('info')) console.log('[SF worker]', msg.slice(0, 80));

        if (msg === 'uciok') {
          // Disable NNUE so engine works without the 60MB network file
          worker.postMessage('setoption name Use NNUE value false');
          worker.postMessage('isready');
        } else if (msg === 'readyok') {
          setReady(true);
        } else if (msg.startsWith('bestmove')) {
          const parts = msg.split(' ');
          const bestMove = parts[1] ?? '';
          if (resolverRef.current && bestMove && bestMove !== '(none)') {
            resolverRef.current(bestMove);
            resolverRef.current = null;
          } else if (resolverRef.current) {
            // Engine said (none) — no legal moves (shouldn't happen, but handle it)
            resolverRef.current = null;
          }
        }
      };

      worker.onerror = (e) => {
        console.error('Stockfish worker error:', e);
        setReady(false);
      };

      worker.postMessage('uci');

      return () => {
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
    if (config.skillLevel !== undefined) {
      w.postMessage(`setoption name Skill Level value ${config.skillLevel}`);
    }
    if (config.contempt !== undefined) {
      w.postMessage(`setoption name Contempt value ${config.contempt}`);
    }
  }, []);

  const getBestMove = useCallback(
    (fen: string, config?: StockfishConfig): Promise<string> => {
      return new Promise((resolve, reject) => {
        const w = workerRef.current;
        if (!w) {
          reject(new Error('Stockfish not initialized'));
          return;
        }

        // Stop any previous search
        w.postMessage('stop');

        if (config) configure(config);

        resolverRef.current = resolve;

        // Use depth-limited search — much more reliable than movetime in WASM workers
        // because timer callbacks can be unreliable in the Emscripten asyncify runtime.
        const skillLevel = config?.skillLevel ?? 10;
        const depth = Math.max(4, Math.min(16, Math.round(skillLevel * 0.7 + 4)));

        w.postMessage(`position fen ${fen}`);
        w.postMessage(`go depth ${depth}`);

        // Hard timeout fallback (30s should be more than enough for depth ≤ 16)
        const timer = setTimeout(() => {
          if (resolverRef.current) {
            resolverRef.current = null;
            w.postMessage('stop');
            reject(new Error('Stockfish timed out'));
          }
        }, 30_000);

        // Wrap resolve to also clear the timer
        const originalResolver = resolve;
        resolverRef.current = (move: string) => {
          clearTimeout(timer);
          originalResolver(move);
        };
      });
    },
    [configure]
  );

  const analyzePosition = useCallback(
    (fen: string, depth = 10): Promise<{ score: number; bestMove: string; pv: string[] }> => {
      return new Promise((resolve) => {
        const w = workerRef.current;
        if (!w) {
          resolve({ score: 0, bestMove: '', pv: [] });
          return;
        }

        let bestScore = 0;
        let bestMoveStr = '';
        let pvLine: string[] = [];
        let done = false;
        let searchStarted = false;
        let finishTimer: ReturnType<typeof setTimeout>;

        const finish = (result: { score: number; bestMove: string; pv: string[] }) => {
          if (done) return;
          done = true;
          clearTimeout(finishTimer);
          clearTimeout(stopFallback);
          w.removeEventListener('message', handler);
          resolve(result);
        };

        const startSearch = () => {
          searchStarted = true;
          w.postMessage(`position fen ${fen}`);
          w.postMessage(`go depth ${depth}`);
          // If search takes too long, stop it so the worker is freed for the next call
          finishTimer = setTimeout(() => {
            w.postMessage('stop');
            finish({ score: bestScore, bestMove: bestMoveStr, pv: pvLine });
          }, 15_000);
        };

        // If the engine was idle, stop produces no bestmove — start after 100ms anyway
        const stopFallback = setTimeout(() => {
          if (!searchStarted) startSearch();
        }, 100);

        const handler = (e: MessageEvent) => {
          const msg = typeof e.data === 'string' ? e.data : '';
          if (done) return;

          if (!searchStarted) {
            // Waiting for stop-response from any prior search
            if (msg.startsWith('bestmove')) {
              clearTimeout(stopFallback);
              startSearch();
            }
            return;
          }

          if (msg.startsWith('info depth')) {
            const scoreMatch = msg.match(/score cp (-?\d+)/);
            const mateMatch = msg.match(/score mate (-?\d+)/);
            const pvMatch = msg.match(/ pv (.+)/);
            if (scoreMatch) bestScore = parseInt(scoreMatch[1]);
            if (mateMatch) bestScore = parseInt(mateMatch[1]) > 0 ? 30000 : -30000;
            if (pvMatch) pvLine = pvMatch[1].split(' ');
          }

          if (msg.startsWith('bestmove')) {
            bestMoveStr = msg.split(' ')[1] ?? '';
            finish({ score: bestScore, bestMove: bestMoveStr, pv: pvLine });
          }
        };

        console.log('[useStockfish] analyzePosition called, fen:', fen.slice(0, 40), 'depth:', depth);
        // Register handler first, then stop any running search.
        // Handler waits for the stop-response before starting our search.
        w.addEventListener('message', handler);
        w.postMessage('stop');
      });
    },
    []
  );

  return { ready, getBestMove, analyzePosition, configure };
}
