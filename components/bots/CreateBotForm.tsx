'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Globe, FileText, User } from 'lucide-react';

type Platform = 'chessdotcom' | 'lichess' | 'manual';
type PlayerColor = 'white' | 'black' | 'both';

interface Props {
  guestToken?: string;
  existingBotId?: string;  // if we already created the bot, just need to train
}

export default function CreateBotForm({ guestToken, existingBotId }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<'info' | 'games'>('info');
  const [botName, setBotName] = useState('');
  const [targetName, setTargetName] = useState('');
  const [platform, setPlatform] = useState<Platform>('chessdotcom');
  const [playerColor, setPlayerColor] = useState<PlayerColor>('both');
  const [botId, setBotId] = useState(existingBotId ?? '');
  const [importUsername, setImportUsername] = useState('');
  const [maxGames, setMaxGames] = useState(500);
  const [manualPgn, setManualPgn] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pgn, setPgn] = useState('');
  const [importCount, setImportCount] = useState(0);
  const [error, setError] = useState('');
  const [trainingStatus, setTrainingStatus] = useState('');

  async function createBot() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: botName, targetName, platform, guestToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'LIMIT_REACHED') {
          setError(data.message);
          return;
        }
        throw new Error(data.error ?? 'Failed to create bot');
      }
      setBotId(data.bot.id);
      setStep('games');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function importFromPlatform() {
    setImporting(true);
    setError('');
    try {
      const endpoint = platform === 'chessdotcom' ? '/api/import/chessdotcom' : '/api/import/lichess';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: importUsername || targetName, maxGames }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Import failed');
      setPgn(data.pgn);
      setImportCount(data.count);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function trainBot() {
    const pgnToUse = platform === 'manual' ? manualPgn : pgn;
    if (!pgnToUse.trim()) {
      setError('Please provide game data first');
      return;
    }
    if (!botId) {
      setError('Bot not created yet');
      return;
    }

    setLoading(true);
    setError('');
    setTrainingStatus('Training in progress...');

    try {
      const res = await fetch(`/api/bots/${botId}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pgn: pgnToUse, playerColor, guestToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Training failed');

      setTrainingStatus(`Done! Processed ${data.gamesProcessed} games. Estimated ELO: ${data.estimatedElo}`);
      setTimeout(() => router.push(`/play/${botId}`), 1500);
    } catch (err: any) {
      setError(err.message);
      setTrainingStatus('');
    } finally {
      setLoading(false);
    }
  }

  if (trainingStatus && !error) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 border-4 border-chess-green border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-chess-text-primary text-lg font-medium">{trainingStatus}</p>
        {trainingStatus.startsWith('Done') && (
          <p className="text-chess-text-secondary text-sm mt-2">Redirecting to game...</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-900/20 border border-red-600/50 text-red-400 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {step === 'info' ? (
        <div className="space-y-4">
          <div>
            <label className="block text-chess-text-secondary text-sm font-medium mb-1">Bot Name</label>
            <input
              type="text"
              value={botName}
              onChange={e => setBotName(e.target.value)}
              placeholder="e.g. Magnus Style Bot"
              className="w-full bg-chess-bg border border-chess-border rounded-lg px-3 py-2 text-chess-text-primary placeholder:text-chess-text-secondary focus:outline-none focus:border-chess-green"
            />
          </div>

          <div>
            <label className="block text-chess-text-secondary text-sm font-medium mb-1">
              Target Player Name
            </label>
            <input
              type="text"
              value={targetName}
              onChange={e => setTargetName(e.target.value)}
              placeholder="Username whose style to mimic"
              className="w-full bg-chess-bg border border-chess-border rounded-lg px-3 py-2 text-chess-text-primary placeholder:text-chess-text-secondary focus:outline-none focus:border-chess-green"
            />
          </div>

          <div>
            <label className="block text-chess-text-secondary text-sm font-medium mb-2">Platform</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'chessdotcom', label: 'chess.com', icon: <Globe size={16} /> },
                { key: 'lichess',     label: 'lichess',   icon: <Globe size={16} /> },
                { key: 'manual',      label: 'Manual PGN', icon: <FileText size={16} /> },
              ] as const).map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => setPlatform(key)}
                  className={`flex items-center gap-2 justify-center py-2 rounded-lg border text-sm font-medium transition-colors
                    ${platform === key
                      ? 'border-chess-green bg-chess-green/10 text-chess-green'
                      : 'border-chess-border text-chess-text-secondary hover:border-chess-green/50'
                    }`}
                >
                  {icon}{label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-chess-text-secondary text-sm font-medium mb-2">
              Target Player's Color
            </label>
            <div className="flex gap-2">
              {(['both', 'white', 'black'] as const).map(c => (
                <button
                  key={c}
                  onClick={() => setPlayerColor(c)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium capitalize transition-colors
                    ${playerColor === c
                      ? 'border-chess-green bg-chess-green/10 text-chess-green'
                      : 'border-chess-border text-chess-text-secondary hover:border-chess-green/50'
                    }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={createBot}
            disabled={loading || !botName.trim() || !targetName.trim()}
            className="w-full py-3 bg-chess-green hover:bg-chess-green-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? 'Creating...' : 'Create Bot →'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-chess-text-primary font-semibold text-lg">
            Upload Games for <span className="text-chess-green">{targetName}</span>
          </h3>

          {platform !== 'manual' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-chess-text-secondary text-sm font-medium mb-1">
                  {platform === 'chessdotcom' ? 'chess.com' : 'Lichess'} Username
                </label>
                <input
                  type="text"
                  value={importUsername}
                  onChange={e => setImportUsername(e.target.value)}
                  placeholder={`${platform === 'chessdotcom' ? 'chess.com' : 'Lichess'} username`}
                  className="w-full bg-chess-bg border border-chess-border rounded-lg px-3 py-2 text-chess-text-primary placeholder:text-chess-text-secondary focus:outline-none focus:border-chess-green"
                />
              </div>
              <div>
                <label className="block text-chess-text-secondary text-sm font-medium mb-1">
                  Max games to import
                </label>
                <input
                  type="number"
                  min={10}
                  max={1000}
                  value={maxGames}
                  onChange={e => setMaxGames(parseInt(e.target.value))}
                  className="w-full bg-chess-bg border border-chess-border rounded-lg px-3 py-2 text-chess-text-primary focus:outline-none focus:border-chess-green"
                />
              </div>
              <button
                onClick={importFromPlatform}
                disabled={importing}
                className="w-full py-2 bg-chess-bg-hover hover:bg-chess-border border border-chess-border text-chess-text-primary rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {importing ? 'Importing...' : `Import from ${platform === 'chessdotcom' ? 'chess.com' : 'Lichess'}`}
              </button>
              {importCount > 0 && (
                <p className="text-chess-green text-sm">✓ Imported {importCount} games</p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-chess-text-secondary text-sm font-medium mb-1">
                Paste PGN games
              </label>
              <textarea
                value={manualPgn}
                onChange={e => setManualPgn(e.target.value)}
                placeholder="[Event &quot;...&quot;]&#10;[White &quot;Player1&quot;]&#10;[Black &quot;Player2&quot;]&#10;&#10;1. e4 e5 2. Nf3 Nc6 ...&#10;&#10;Paste multiple games separated by empty lines"
                rows={10}
                className="w-full bg-chess-bg border border-chess-border rounded-lg px-3 py-2 text-chess-text-primary placeholder:text-chess-text-secondary focus:outline-none focus:border-chess-green font-mono text-sm"
              />
            </div>
          )}

          <div className="bg-chess-bg-hover border border-chess-border rounded-lg p-3 text-xs text-chess-text-secondary">
            <strong className="text-chess-text-primary">Training info:</strong> We'll analyze the game positions,
            build an opening book, and extract the player's style. Training typically completes in under a minute.
          </div>

          <button
            onClick={trainBot}
            disabled={loading || (platform !== 'manual' ? importCount === 0 : !manualPgn.trim())}
            className="w-full py-3 bg-chess-green hover:bg-chess-green-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Upload size={18} />
            {loading ? 'Training...' : 'Train Bot'}
          </button>
        </div>
      )}
    </div>
  );
}
