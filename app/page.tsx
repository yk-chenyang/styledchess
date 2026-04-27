'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Brain, Swords, Upload, Crown, AlertTriangle, X } from 'lucide-react';

function getOrCreateGuestToken(): string {
  if (typeof window === 'undefined') return '';
  let token = sessionStorage.getItem('guestToken');
  if (!token) {
    token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('guestToken', token);
  }
  return token;
}

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [guestDismissed, setGuestDismissed] = useState(false);

  const isLoggedIn = !!session?.user;

  if (isLoggedIn) {
    router.replace('/dashboard');
    return null;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      {/* Guest warning banner */}
      {!guestDismissed && (
        <div className="mb-8 bg-yellow-900/20 border border-yellow-600/40 rounded-xl px-5 py-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-yellow-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="text-yellow-300 font-semibold">You're browsing as a guest</p>
            <p className="text-yellow-200/70 mt-1">
              Guests can create <strong>1 bot</strong> and play unlimited games during this session,
              but <strong>your bot will be lost when you leave</strong>. Sign up to save your bots
              and create more.
            </p>
          </div>
          <button onClick={() => setGuestDismissed(true)} className="text-yellow-400/60 hover:text-yellow-400">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Hero */}
      <div className="text-center mb-16">
        <div className="text-7xl mb-6">♛</div>
        <h1 className="text-5xl font-bold mb-4">
          <span className="text-chess-text-primary">Styled</span>
          <span className="text-chess-green">Chess</span>
        </h1>
        <p className="text-chess-text-secondary text-xl max-w-2xl mx-auto">
          Upload any player's chess game history and challenge an AI that plays in their exact style.
        </p>
        <div className="flex gap-4 justify-center mt-8">
          <Link
            href="/bots/create"
            className="px-8 py-3 bg-chess-green hover:bg-chess-green-dark text-white rounded-xl font-semibold text-lg transition-colors"
          >
            Create a Bot
          </Link>
          <Link
            href="/auth/register"
            className="px-8 py-3 border border-chess-border hover:border-chess-green text-chess-text-primary rounded-xl font-semibold text-lg transition-colors"
          >
            Sign Up Free
          </Link>
        </div>
      </div>

      {/* Features */}
      <div className="grid md:grid-cols-3 gap-6 mb-16">
        <FeatureCard
          icon="🎯"
          title="Style Training"
          desc="Upload PGN games from chess.com or Lichess, or paste manually. Our engine learns openings, tactics, and strategic preferences."
        />
        <FeatureCard
          icon="♟️"
          title="Real-time Play"
          desc="Play on a full interactive chess board. The bot uses your training data for opening moves and Stockfish for deeper positions."
        />
        <FeatureCard
          icon="🔍"
          title="Game Review"
          desc="Review your games with Stockfish-powered analysis. See Best, Good, Inaccuracy, Mistake, and Blunder annotations for every move."
        />
      </div>

      {/* Tiers */}
      <div className="grid md:grid-cols-3 gap-4">
        <TierCard
          icon="👤"
          name="Guest"
          color="border-chess-border"
          features={['1 bot (session only)', 'Unlimited games while on site', 'Bot lost on leave']}
        />
        <TierCard
          icon="🧑"
          name="Free User"
          color="border-chess-green/50"
          highlight
          features={['1 bot saved permanently', 'Unlimited games', 'Game history', 'Email & Google login']}
          cta={{ label: 'Sign Up Free', href: '/auth/register' }}
        />
        <TierCard
          icon={<Crown size={20} className="text-yellow-400" />}
          name="Member"
          color="border-yellow-500/50"
          features={['Up to 5 bots saved', 'Everything in Free', 'Priority support']}
          cta={{ label: 'Upgrade', href: '/upgrade' }}
        />
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="bg-chess-bg-card border border-chess-border rounded-xl p-6">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="text-chess-text-primary font-bold text-lg mb-2">{title}</h3>
      <p className="text-chess-text-secondary text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

function TierCard({
  icon,
  name,
  color,
  features,
  highlight,
  cta,
}: {
  icon: React.ReactNode;
  name: string;
  color: string;
  features: string[];
  highlight?: boolean;
  cta?: { label: string; href: string };
}) {
  return (
    <div className={`bg-chess-bg-card border-2 ${color} rounded-xl p-5 ${highlight ? 'shadow-chess-green/10 shadow-lg' : ''}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">{icon}</span>
        <h3 className="text-chess-text-primary font-bold">{name}</h3>
      </div>
      <ul className="space-y-1.5 mb-4">
        {features.map(f => (
          <li key={f} className="text-chess-text-secondary text-sm flex items-start gap-2">
            <span className="text-chess-green mt-0.5">✓</span> {f}
          </li>
        ))}
      </ul>
      {cta && (
        <Link
          href={cta.href}
          className="block text-center py-2 bg-chess-green hover:bg-chess-green-dark text-white rounded-lg text-sm font-medium transition-colors"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
