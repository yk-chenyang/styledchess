'use client';

import Link from 'next/link';
import { BotStyleParams } from '@/types';
import { Swords, Brain, Trophy, Clock } from 'lucide-react';

interface Bot {
  id: string;
  name: string;
  status: string;
  targetName: string;
  platform?: string | null;
  gamesCount: number;
  estimatedElo?: number | null;
  styleParams?: string | null;
  createdAt: string | Date;
}

const statusConfig = {
  PENDING:  { label: 'Pending',  color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  TRAINING: { label: 'Training', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse' },
  READY:    { label: 'Ready',    color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  FAILED:   { label: 'Failed',   color: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

interface Props {
  bot: Bot;
  onDelete?: (id: string) => void;
}

export default function BotCard({ bot, onDelete }: Props) {
  const status = statusConfig[bot.status as keyof typeof statusConfig] ?? statusConfig.PENDING;
  const style: BotStyleParams | null = bot.styleParams ? JSON.parse(bot.styleParams) : null;

  return (
    <div className="bg-chess-bg-card border border-chess-border rounded-xl p-5 hover:border-chess-green/50 transition-colors group">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-chess-text-primary font-bold text-lg leading-tight">{bot.name}</h3>
          <p className="text-chess-text-secondary text-sm mt-0.5">
            Mimics{' '}
            <span className="text-chess-green font-medium">{bot.targetName}</span>
            {bot.platform && (
              <span className="ml-1 text-xs opacity-70">
                ({bot.platform === 'chessdotcom' ? 'chess.com' : bot.platform === 'lichess' ? 'lichess' : 'manual'})
              </span>
            )}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full border ${status.color}`}>
          {status.label}
        </span>
      </div>

      {style && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <Stat icon={<Trophy size={14} />} label="Est. ELO" value={bot.estimatedElo ?? style.estimatedElo ?? '?'} />
          <Stat icon={<Brain size={14} />} label="Games" value={bot.gamesCount} />
          <Stat
            icon={<Swords size={14} />}
            label="Style"
            value={
              style.aggressiveness >= 0.6 ? 'Aggressive' :
              style.aggressiveness <= 0.3 ? 'Solid' : 'Balanced'
            }
          />
          <Stat icon={<Clock size={14} />} label="Avg length" value={`${Math.round(style.avgGameLength)} moves`} />
        </div>
      )}

      <div className="flex gap-2 mt-4">
        {bot.status === 'READY' ? (
          <Link
            href={`/play/${bot.id}`}
            className="flex-1 text-center py-2 bg-chess-green hover:bg-chess-green-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            Play
          </Link>
        ) : bot.status === 'PENDING' ? (
          <Link
            href={`/bots/create?botId=${bot.id}`}
            className="flex-1 text-center py-2 bg-chess-bg-hover hover:bg-chess-border text-chess-text-primary rounded-lg text-sm font-medium transition-colors"
          >
            Upload Games
          </Link>
        ) : (
          <div className="flex-1 text-center py-2 bg-chess-bg-hover text-chess-text-secondary rounded-lg text-sm">
            {bot.status === 'TRAINING' ? 'Training...' : 'Failed'}
          </div>
        )}
        {onDelete && (
          <button
            onClick={() => onDelete(bot.id)}
            className="px-3 py-2 text-red-400 hover:bg-red-900/20 rounded-lg text-sm transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="text-chess-text-secondary">{icon}</span>
      <span className="text-chess-text-secondary">{label}:</span>
      <span className="text-chess-text-primary font-medium">{value}</span>
    </div>
  );
}
