'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, Move, Square } from 'chess.js';
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

export interface AnnotatedMove {
  san: string;
  color: 'w' | 'b';
  from: string;
  to: string;
  annotation?: string;
  cpLoss?: number;
}

function getGameOver(chess: Chess): { result: string; reason: string } | null {
  if (chess.isCheckmate()) {
    return { result: chess.turn() === 'w' ? '0-1' : '1-0', reason: 'Checkmate' };
  }
  if (chess.isStalemate()) return { result: '1/2-1/2', reason: 'Stalemate' };
  if (chess.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'Draw by repetition' };
  if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'Insufficient material' };
  if (chess.isDraw()) return { result: '1/2-1/2', reason: 'Draw (50-move rule)' };
  return null;
}

export default function ChessBoard({ botId, userColor, guestToken, stockfishConfig, onGameEnd }: Props) {
  // --- Core game state ---
  const [game, setGame] = useState(() => new Chess());
  const gameRef = useRef(game);
  useEffect(() => { gameRef.current = game; }, [game]);

  // FEN history: index 0 = starting position, index N = after N half-moves
  const [fenHistory, setFenHistory] = useState<string[]>(() => [new Chess().fen()]);
  const fenHistoryRef = useRef(fenHistory);
  useEffect(() => { fenHistoryRef.current = fenHistory; }, [fenHistory]);

  // Which position in history the board is displaying
  const [viewIndex, setViewIndex] = useState(0);

  const [status, setStatus] = useState<'playing' | 'gameover'>('playing');
  const [gameResult, setGameResult] = useState('');
  const [gameResultReason, setGameResultReason] = useState('');
  const [annotatedMoves, setAnnotatedMoves] = useState<AnnotatedMove[]>([]);
  const [botThinking, setBotThinking] = useState(false);
  const [botError, setBotError] = useState('');
  const stockfish = useStockfish();
  const botRequestedRef = useRef(false);

  // Single Chess instance that accumulates every move — gives us a valid full PGN
  const masterGameRef = useRef(new Chess());

  const isAtLatest = viewIndex === fenHistory.length - 1;

  // --- Apply a completed move to all state ---
  const applyMove = useCallback((
    newGame: Chess,
    moveResult: Move,
    from: string,
    to: string,
  ) => {
    const newFen = newGame.fen();
    // Use ref so async bot calls always see fresh history
    const newHistory = [...fenHistoryRef.current, newFen];
    setFenHistory(newHistory);
    setViewIndex(newHistory.length - 1);   // jump to latest
    setGame(newGame);
    setAnnotatedMoves(prev => [...prev, { san: moveResult.san, color: moveResult.color, from, to }]);

    // Keep masterGame in sync — this is the only Chess instance with complete history
    try {
      masterGameRef.current.move({ from, to, promotion: moveResult.promotion });
    } catch {}

    const over = getGameOver(newGame);
    if (over) {
      setStatus('gameover');
      setGameResult(over.result);
      setGameResultReason(over.reason);
      // masterGame.pgn() contains the full move history from move 1
      onGameEnd?.(masterGameRef.current.pgn(), over.result, userColor);
    }
  }, [onGameEnd, userColor]);

  // --- Bot move ---
  const makeBotMove = useCallback(async () => {
    if (botRequestedRef.current) return;
    botRequestedRef.current = true;
    setBotThinking(true);

    const chess = gameRef.current;
    const fenStr = chess.fen();

    try {
      const res = await fetch(`/api/bots/${botId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: fenStr, guestToken }),
      });
      if (!res.ok) throw new Error('Bot move API failed');
      const data = await res.json();

      let moveStr: string;
      if (data.move) {
        moveStr = data.move;
      } else {
        const cfg = stockfishConfig ?? data.stockfishConfig ?? { skillLevel: 10, contempt: 0 };
        moveStr = await stockfish.getBestMove(fenStr, cfg);
      }

      const newGame = new Chess(chess.fen());
      const from = moveStr.slice(0, 2);
      const to   = moveStr.slice(2, 4);
      const promotion = moveStr.length > 4 ? moveStr[4] : undefined;
      const moveResult = newGame.move({ from, to, promotion: promotion as any });
      if (!moveResult) throw new Error('Invalid bot move: ' + moveStr);

      applyMove(newGame, moveResult, from, to);
    } catch (err: any) {
      console.error('Bot move error:', err);
      setBotError('Bot engine error: ' + (err?.message ?? 'unknown error') + '. Refresh to retry.');
    } finally {
      setBotThinking(false);
      botRequestedRef.current = false;
    }
  }, [botId, guestToken, stockfish, stockfishConfig, applyMove]);

  // Trigger bot move when it's the bot's turn
  useEffect(() => {
    if (status !== 'playing') return;
    if (!stockfish.ready) return;
    const botColor = userColor === 'white' ? 'b' : 'w';
    if (game.turn() === botColor) makeBotMove();
  }, [game, status, stockfish.ready, userColor, makeBotMove]);

  // --- Keyboard navigation ---
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't steal arrow keys when user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft')  setViewIndex(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setViewIndex(i => Math.min(fenHistoryRef.current.length - 1, i + 1));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // --- User piece drop (non-promotion) ---
  const onPieceDrop = useCallback(
    (sourceSquare: string, targetSquare: string, piece: string): boolean => {
      if (status !== 'playing' || !isAtLatest) return false;
      const myColor = userColor === 'white' ? 'w' : 'b';
      if (game.turn() !== myColor) return false;

      const newGame = new Chess(game.fen());
      // Don't attempt promotion here — onPromotionPieceSelect handles it
      let moveResult: Move | null = null;
      try {
        moveResult = newGame.move({ from: sourceSquare, to: targetSquare });
      } catch { return false; }
      if (!moveResult) return false;

      applyMove(newGame, moveResult, sourceSquare, targetSquare);
      return true;
    },
    [game, userColor, status, isAtLatest, applyMove],
  );

  // Tell react-chessboard when to show the promotion dialog
  const onPromotionCheck = useCallback(
    (sourceSquare: string, targetSquare: string, piece: string): boolean => {
      if (status !== 'playing' || !isAtLatest) return false;
      const myColor = userColor === 'white' ? 'w' : 'b';
      if (game.turn() !== myColor) return false;
      return (
        (piece === 'wP' && sourceSquare[1] === '7' && targetSquare[1] === '8') ||
        (piece === 'bP' && sourceSquare[1] === '2' && targetSquare[1] === '1')
      );
    },
    [game, userColor, status, isAtLatest],
  );

  // Handle the chosen promotion piece
  const onPromotionPieceSelect = useCallback(
    (piece?: string, from?: Square, to?: Square): boolean => {
      if (!piece || !from || !to) return false;
      if (status !== 'playing' || !isAtLatest) return false;
      const myColor = userColor === 'white' ? 'w' : 'b';
      if (game.turn() !== myColor) return false;

      // react-chessboard gives e.g. 'wQ', 'bR' — we need lowercase for chess.js
      const promotionPiece = piece[1]?.toLowerCase() as 'q' | 'r' | 'b' | 'n';
      const newGame = new Chess(game.fen());
      let moveResult: Move | null = null;
      try { moveResult = newGame.move({ from, to, promotion: promotionPiece }); } catch { return false; }
      if (!moveResult) return false;

      applyMove(newGame, moveResult, from, to);
      return true;
    },
    [game, userColor, status, isAtLatest, applyMove],
  );

  // --- Game controls ---
  const resign = useCallback(() => {
    const result = userColor === 'white' ? '0-1' : '1-0';
    setStatus('gameover');
    setGameResult(result);
    setGameResultReason('Resignation');
    onGameEnd?.(masterGameRef.current.pgn(), result, userColor);
  }, [userColor, onGameEnd]);

  const resetGame = useCallback(() => {
    const fresh = new Chess();
    masterGameRef.current = new Chess(); // reset full-history tracker
    setGame(fresh);
    setFenHistory([fresh.fen()]);
    fenHistoryRef.current = [fresh.fen()];
    setViewIndex(0);
    setStatus('playing');
    setGameResult('');
    setGameResultReason('');
    setAnnotatedMoves([]);
    setBotError('');
    botRequestedRef.current = false;
  }, []);

  // --- Display ---
  const displayFen = fenHistory[viewIndex] ?? new Chess().fen();

  // Highlight the move that LED TO the current view position
  const viewMove = annotatedMoves[viewIndex - 1];
  const highlightSquares = useMemo(() => {
    const sq: Record<string, React.CSSProperties> = {};
    if (viewMove) {
      sq[viewMove.from] = { background: 'rgba(118, 150, 86, 0.4)' };
      sq[viewMove.to]   = { background: 'rgba(118, 150, 86, 0.4)' };
    }
    try {
      const tmp = new Chess(displayFen);
      if (tmp.inCheck()) {
        const king = tmp.board().flat().find(p => p?.type === 'k' && p.color === tmp.turn());
        if (king) sq[king.square] = { background: 'rgba(220, 50, 50, 0.5)' };
      }
    } catch {}
    return sq;
  }, [viewMove, displayFen]);

  const userResultText = () => {
    if (!gameResult) return '';
    if (gameResult === '1/2-1/2') return "It's a draw!";
    const userWon =
      (gameResult === '1-0' && userColor === 'white') ||
      (gameResult === '0-1' && userColor === 'black');
    return userWon ? '🎉 You won!' : 'You lost.';
  };

  const resultLine = gameResult === '1-0' ? 'White wins'
    : gameResult === '0-1' ? 'Black wins'
    : 'Draw';

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start justify-center w-full">
      {/* Board column */}
      <div className="flex flex-col gap-3">

        {/* Status bar */}
        <div className="flex items-center gap-2 bg-chess-bg-card rounded-lg px-4 py-2">
          <div className={`w-3 h-3 rounded-full shrink-0 ${botThinking ? 'bg-yellow-400 animate-pulse' : 'bg-chess-green'}`} />
          <span className="text-chess-text-primary text-sm font-medium">
            {botThinking ? 'Bot is thinking…' : 'Bot'}
          </span>
          {status === 'playing' && !botThinking && (
            <span className="text-chess-text-secondary text-xs ml-1">
              {game.turn() === (userColor === 'white' ? 'w' : 'b') ? 'Your turn' : "Bot's turn"}
            </span>
          )}
          {!isAtLatest && (
            <span className="ml-auto text-xs text-chess-text-secondary italic">Browsing history</span>
          )}
        </div>

        {/* Board */}
        <div className="rounded-lg overflow-hidden shadow-2xl">
          <Chessboard
            position={displayFen}
            onPieceDrop={onPieceDrop}
            onPromotionCheck={onPromotionCheck as any}
            onPromotionPieceSelect={onPromotionPieceSelect as any}
            promotionDialogVariant="modal"
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

        {/* Navigation + controls row */}
        <div className="flex items-center gap-1.5">
          {/* History navigation */}
          <button
            onClick={() => setViewIndex(0)}
            disabled={viewIndex === 0}
            title="Go to start"
            className="px-2 py-1.5 bg-chess-bg-card hover:bg-chess-bg-hover disabled:opacity-30 rounded text-chess-text-primary text-sm transition-colors"
          >⏮</button>
          <button
            onClick={() => setViewIndex(i => Math.max(0, i - 1))}
            disabled={viewIndex === 0}
            title="Previous move (←)"
            className="px-2 py-1.5 bg-chess-bg-card hover:bg-chess-bg-hover disabled:opacity-30 rounded text-chess-text-primary text-sm transition-colors"
          >◀</button>
          <button
            onClick={() => setViewIndex(i => Math.min(fenHistory.length - 1, i + 1))}
            disabled={isAtLatest}
            title="Next move (→)"
            className="px-2 py-1.5 bg-chess-bg-card hover:bg-chess-bg-hover disabled:opacity-30 rounded text-chess-text-primary text-sm transition-colors"
          >▶</button>
          <button
            onClick={() => setViewIndex(fenHistory.length - 1)}
            disabled={isAtLatest}
            title="Go to latest"
            className="px-2 py-1.5 bg-chess-bg-card hover:bg-chess-bg-hover disabled:opacity-30 rounded text-chess-text-primary text-sm transition-colors"
          >⏭</button>

          <span className="text-chess-text-secondary text-xs mx-1">
            {viewIndex === 0 ? 'Start' : `Move ${viewIndex}`}
          </span>

          {/* Game action */}
          <div className="ml-auto">
            {status === 'playing' ? (
              <button
                onClick={resign}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Resign
              </button>
            ) : (
              <button
                onClick={resetGame}
                className="px-4 py-1.5 bg-chess-green hover:bg-chess-green-dark text-white rounded-lg text-sm font-medium transition-colors"
              >
                New Game
              </button>
            )}
          </div>
        </div>

        {/* Game over banner */}
        {status === 'gameover' && (
          <div className="bg-chess-bg-card border border-chess-border rounded-lg px-4 py-3 text-center">
            <p className="text-chess-text-primary font-bold text-lg">{userResultText()}</p>
            <p className="text-chess-text-secondary text-sm">{resultLine} · {gameResultReason}</p>
          </div>
        )}
      </div>

      {/* Move list */}
      <div className="flex-1 min-w-[200px]">
        <MoveList
          moves={annotatedMoves}
          currentIndex={viewIndex - 1}   // -1 = before any move
          onMoveClick={(i) => setViewIndex(i + 1)}
        />
      </div>
    </div>
  );
}
