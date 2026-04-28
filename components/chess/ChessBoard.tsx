'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, Move } from 'chess.js';
import { useStockfish } from '@/hooks/useStockfish';
import MoveList from './MoveList';
import { StockfishConfig } from '@/types';

interface Props {
  botId: string;
  userColor: 'white' | 'black';
  guestToken?: string;
  stockfishConfig?: StockfishConfig;
  onGameEnd?: (pgn: string, result: string, userColor: string) => void;
}

type MoveAnnotation = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

interface AnnotatedMove {
  san: string;
  color: 'w' | 'b';
  annotation?: MoveAnnotation;
  cpLoss?: number;
}

function cpLossToAnnotation(cpLoss: number): MoveAnnotation {
  if (cpLoss <= 10) return 'best';
  if (cpLoss <= 25) return 'excellent';
  if (cpLoss <= 50) return 'good';
  if (cpLoss <= 100) return 'inaccuracy';
  if (cpLoss <= 200) return 'mistake';
  return 'blunder';
}

export default function ChessBoard({ botId, userColor, guestToken, stockfishConfig, onGameEnd }: Props) {
  const [game, setGame] = useState(() => new Chess());
  const [fen, setFen] = useState('start');
  const [status, setStatus] = useState<'playing' | 'gameover'>('playing');
  const [gameResult, setGameResult] = useState('');
  const [annotatedMoves, setAnnotatedMoves] = useState<AnnotatedMove[]>([]);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [botThinking, setBotThinking] = useState(false);
  const [botError, setBotError] = useState('');
  const stockfish = useStockfish();
  const gameRef = useRef(game);
  const botRequestedRef = useRef(false);

  useEffect(() => { gameRef.current = game; }, [game]);

  const checkGameOver = useCallback((chess: Chess): string | null => {
    if (chess.isCheckmate()) return chess.turn() === 'w' ? '0-1' : '1-0';
    if (chess.isStalemate() || chess.isDraw()) return '1/2-1/2';
    return null;
  }, []);

  const makeBotMove = useCallback(async () => {
    if (botRequestedRef.current) return;
    botRequestedRef.current = true;
    setBotThinking(true);

    const chess = gameRef.current;
    const fenStr = chess.fen();

    try {
      // Ask server for opening book move first
      const res = await fetch(`/api/bots/${botId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: fenStr, guestToken }),
      });

      if (!res.ok) throw new Error('Bot move API failed');
      const data = await res.json();

      let moveStr: string;

      if (data.move) {
        // Opening book move
        moveStr = data.move;
      } else {
        // Use Stockfish with style config
        const cfg = stockfishConfig ?? data.stockfishConfig ?? { skillLevel: 10, contempt: 0 };
        moveStr = await stockfish.getBestMove(fenStr, cfg);
      }

      // Convert UCI move to SAN
      const newGame = new Chess(chess.fen());
      const from = moveStr.slice(0, 2);
      const to = moveStr.slice(2, 4);
      const promotion = moveStr.length > 4 ? moveStr[4] : undefined;

      const moveResult = newGame.move({ from, to, promotion: promotion as any });
      if (!moveResult) throw new Error('Invalid bot move: ' + moveStr);

      setGame(newGame);
      setFen(newGame.fen());
      setLastMove({ from, to });

      setAnnotatedMoves(prev => [...prev, { san: moveResult.san, color: moveResult.color }]);

      const result = checkGameOver(newGame);
      if (result) {
        setStatus('gameover');
        setGameResult(result);
        onGameEnd?.(newGame.pgn(), result, userColor);
      }
    } catch (err: any) {
      console.error('Bot move error:', err);
      setBotError('Bot engine error: ' + (err?.message ?? 'unknown error') + '. Refresh the page to retry.');
    } finally {
      setBotThinking(false);
      botRequestedRef.current = false;
    }
  }, [botId, guestToken, stockfish, stockfishConfig, checkGameOver, onGameEnd, userColor]);

  // Trigger bot move when it's the bot's turn
  useEffect(() => {
    if (status !== 'playing') return;
    if (!stockfish.ready) return;
    const botColor = userColor === 'white' ? 'b' : 'w';
    if (game.turn() === botColor) {
      makeBotMove();
    }
  }, [fen, status, stockfish.ready, userColor, game, makeBotMove]);

  const onPieceDrop = useCallback(
    (sourceSquare: string, targetSquare: string, piece: string): boolean => {
      if (status !== 'playing') return false;
      const myColor = userColor === 'white' ? 'w' : 'b';
      if (game.turn() !== myColor) return false;

      const newGame = new Chess(game.fen());
      const isPromotion =
        piece[1] === 'P' &&
        ((piece[0] === 'w' && targetSquare[1] === '8') ||
          (piece[0] === 'b' && targetSquare[1] === '1'));

      const moveResult = newGame.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: isPromotion ? 'q' : undefined,
      });

      if (!moveResult) return false;

      setGame(newGame);
      setFen(newGame.fen());
      setLastMove({ from: sourceSquare, to: targetSquare });
      setAnnotatedMoves(prev => [...prev, { san: moveResult.san, color: moveResult.color }]);

      const result = checkGameOver(newGame);
      if (result) {
        setStatus('gameover');
        setGameResult(result);
        onGameEnd?.(newGame.pgn(), result, userColor);
      }

      return true;
    },
    [game, userColor, status, checkGameOver, onGameEnd]
  );

  const resign = useCallback(() => {
    const result = userColor === 'white' ? '0-1' : '1-0';
    setStatus('gameover');
    setGameResult(result);
    onGameEnd?.(game.pgn(), result, userColor);
  }, [userColor, game, onGameEnd]);

  const newGame = useCallback(() => {
    const fresh = new Chess();
    setGame(fresh);
    setFen('start');
    setStatus('playing');
    setGameResult('');
    setAnnotatedMoves([]);
    setLastMove(null);
    setBotError('');
    botRequestedRef.current = false;
  }, []);

  const highlightSquares = lastMove
    ? {
        [lastMove.from]: { background: 'rgba(118, 150, 86, 0.4)' },
        [lastMove.to]: { background: 'rgba(118, 150, 86, 0.4)' },
      }
    : {};

  const inCheck = game.inCheck();
  const kingSquare = inCheck
    ? (game.board().flat().find(p => p?.type === 'k' && p.color === game.turn())?.square ?? null)
    : null;

  if (kingSquare) {
    (highlightSquares as any)[kingSquare] = { background: 'rgba(220, 50, 50, 0.5)' };
  }

  const resultText =
    gameResult === '1-0'
      ? 'White wins!'
      : gameResult === '0-1'
      ? 'Black wins!'
      : gameResult === '1/2-1/2'
      ? 'Draw!'
      : '';

  const userResultText = () => {
    if (!gameResult) return '';
    if (gameResult === '1/2-1/2') return "It's a draw!";
    const userWon =
      (gameResult === '1-0' && userColor === 'white') ||
      (gameResult === '0-1' && userColor === 'black');
    return userWon ? 'You won!' : 'You lost!';
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start justify-center w-full">
      {/* Board */}
      <div className="flex flex-col gap-3">
        {/* Bot indicator */}
        <div className="flex items-center gap-2 bg-chess-bg-card rounded-lg px-4 py-2">
          <div className={`w-3 h-3 rounded-full ${botThinking ? 'bg-yellow-400 animate-pulse' : 'bg-chess-green'}`} />
          <span className="text-chess-text-primary text-sm font-medium">
            {botThinking ? 'Bot is thinking...' : 'Bot'}
          </span>
          {status === 'playing' && !botThinking && (
            <span className="text-chess-text-secondary text-xs ml-1">
              {game.turn() === (userColor === 'white' ? 'w' : 'b') ? 'Your turn' : "Bot's turn"}
            </span>
          )}
        </div>

        <div className="rounded-lg overflow-hidden shadow-2xl">
          <Chessboard
            position={fen}
            onPieceDrop={onPieceDrop}
            boardOrientation={userColor}
            customSquareStyles={highlightSquares}
            customBoardStyle={{ borderRadius: '4px' }}
            customDarkSquareStyle={{ backgroundColor: '#b58863' }}
            customLightSquareStyle={{ backgroundColor: '#f0d9b5' }}
            boardWidth={480}
            areArrowsAllowed
          />
        </div>

        {/* Engine error */}
        {botError && (
          <div className="bg-red-900/30 border border-red-600/50 text-red-300 rounded-lg px-3 py-2 text-sm">
            {botError}
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-3">
          {status === 'playing' ? (
            <button
              onClick={resign}
              className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Resign
            </button>
          ) : (
            <button
              onClick={newGame}
              className="flex-1 py-2 bg-chess-green hover:bg-chess-green-dark text-white rounded-lg text-sm font-medium transition-colors"
            >
              New Game
            </button>
          )}
        </div>

        {status === 'gameover' && (
          <div className="bg-chess-bg-card border border-chess-border rounded-lg px-4 py-3 text-center">
            <p className="text-chess-text-primary font-bold text-lg">{userResultText()}</p>
            <p className="text-chess-text-secondary text-sm">{resultText}</p>
          </div>
        )}
      </div>

      {/* Move list */}
      <div className="flex-1 min-w-[200px]">
        <MoveList moves={annotatedMoves} />
      </div>
    </div>
  );
}
