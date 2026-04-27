'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export interface StockfishConfig {
  skillLevel?: number;  // 0-20
  contempt?: number;    // -100 to 100
  moveTime?: number;    // ms
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
        if (msg === 'uciok') {
          worker.postMessage('isready');
        } else if (msg === 'readyok') {
          setReady(true);
        } else if (msg.startsWith('bestmove')) {
          const parts = msg.split(' ');
          const bestMove = parts[1] ?? '';
          if (resolverRef.current && bestMove && bestMove !== '(none)') {
            resolverRef.current(bestMove);
            resolverRef.current = null;
          }
        }
      };

      worker.onerror = (e) => {
        console.error('Stockfish worker error:', e);
      };

      worker.postMessage('uci');

      return () => {
        worker.postMessage('quit');
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

        // Cancel any in-progress analysis
        w.postMessage('stop');

        if (config) configure(config);

        resolverRef.current = resolve;

        const moveTime = config?.moveTime ?? 1000;
        w.postMessage('ucinewgame');
        w.postMessage(`position fen ${fen}`);
        w.postMessage(`go movetime ${moveTime}`);

        // Safety timeout
        setTimeout(() => {
          if (resolverRef.current) {
            resolverRef.current = null;
            reject(new Error('Stockfish timed out'));
          }
        }, moveTime + 5000);
      });
    },
    [configure]
  );

  const analyzePosition = useCallback(
    (fen: string, depth = 18): Promise<{ score: number; bestMove: string; pv: string[] }> => {
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

        const handler = (e: MessageEvent) => {
          const msg = typeof e.data === 'string' ? e.data : '';
          if (done) return;

          if (msg.startsWith('info depth')) {
            const scoreMatch = msg.match(/score cp (-?\d+)/);
            const mateMatch = msg.match(/score mate (-?\d+)/);
            const pvMatch = msg.match(/ pv (.+)/);
            if (scoreMatch) bestScore = parseInt(scoreMatch[1]);
            if (mateMatch) bestScore = parseInt(mateMatch[1]) > 0 ? 30000 : -30000;
            if (pvMatch) pvLine = pvMatch[1].split(' ');
          }

          if (msg.startsWith('bestmove')) {
            done = true;
            bestMoveStr = msg.split(' ')[1] ?? '';
            w.removeEventListener('message', handler);
            resolve({ score: bestScore, bestMove: bestMoveStr, pv: pvLine });
          }
        };

        w.addEventListener('message', handler);
        w.postMessage('stop');
        w.postMessage(`position fen ${fen}`);
        w.postMessage(`go depth ${depth}`);
      });
    },
    []
  );

  return { ready, getBestMove, analyzePosition, configure };
}
