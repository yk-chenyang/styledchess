export type UserRole = 'USER' | 'MEMBER' | 'ADMIN';
export type BotStatus = 'PENDING' | 'TRAINING' | 'READY' | 'FAILED';
export type PlayerColor = 'white' | 'black';
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface BotStyleParams {
  estimatedElo: number;
  aggressiveness: number;
  tacticalSharpness: number;
  avgGameLength: number;
  openingPreferences: { name: string; frequency: number }[];
  winRate: number;
  drawRate: number;
  colorPreference: string;
  totalGames: number;
}

export interface BotSummary {
  id: string;
  name: string;
  status: BotStatus;
  targetName: string;
  platform?: string | null;
  gamesCount: number;
  estimatedElo?: number | null;
  styleParams?: BotStyleParams | null;
  createdAt: string;
}

export interface GameSummary {
  id: string;
  botId: string;
  botName: string;
  result: GameResult;
  userColor: PlayerColor;
  accuracy?: number | null;
  createdAt: string;
}

// Stockfish configuration derived from style params
export interface StockfishConfig {
  skillLevel: number;   // 0-20
  contempt: number;     // -100 to 100
  moveTime: number;     // milliseconds
}
