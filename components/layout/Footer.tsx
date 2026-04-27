export default function Footer() {
  return (
    <footer className="border-t border-chess-border py-8 mt-auto">
      <div className="max-w-7xl mx-auto px-4 text-center text-chess-text-secondary text-sm">
        <p>
          <span className="text-chess-text-primary font-medium">♛ StyledChess</span> — Play chess against
          AI that mimics real players' styles.
        </p>
        <p className="mt-1 text-xs opacity-60">
          Powered by Stockfish. Game data from chess.com and Lichess public APIs.
        </p>
      </div>
    </footer>
  );
}
