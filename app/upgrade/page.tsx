import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Link from 'next/link';
import { Crown, Check } from 'lucide-react';

export default async function UpgradePage() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;

  if (role === 'MEMBER') {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <Crown size={48} className="text-yellow-400 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-chess-text-primary mb-2">You're already a Member!</h1>
        <p className="text-chess-text-secondary mb-6">You have access to all Member features.</p>
        <Link href="/dashboard" className="px-6 py-2 bg-chess-green text-white rounded-lg font-medium">
          Go to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <Crown size={48} className="text-yellow-400 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-chess-text-primary mb-2">Upgrade to Member</h1>
        <p className="text-chess-text-secondary">Unlock more bots and premium features</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-chess-bg-card border border-chess-border rounded-xl p-6">
          <h2 className="text-chess-text-primary font-bold text-lg mb-4">Free</h2>
          <ul className="space-y-2 text-sm">
            {['1 saved bot', 'Unlimited games', 'Game history', 'Game review'].map(f => (
              <li key={f} className="flex items-center gap-2 text-chess-text-secondary">
                <Check size={14} className="text-chess-green" /> {f}
              </li>
            ))}
          </ul>
          <div className="mt-6 text-center text-chess-text-secondary font-bold text-2xl">$0</div>
        </div>

        <div className="bg-chess-bg-card border-2 border-yellow-500/60 rounded-xl p-6 relative">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-500 text-black text-xs font-bold px-3 py-1 rounded-full">
            RECOMMENDED
          </div>
          <h2 className="text-yellow-400 font-bold text-lg mb-4 flex items-center gap-2">
            <Crown size={18} /> Member
          </h2>
          <ul className="space-y-2 text-sm">
            {[
              'Up to 5 saved bots',
              'Unlimited games',
              'Full game history',
              'Game review with analysis',
              'Priority support',
            ].map(f => (
              <li key={f} className="flex items-center gap-2 text-chess-text-secondary">
                <Check size={14} className="text-yellow-400" /> {f}
              </li>
            ))}
          </ul>
          <div className="mt-6 text-center text-yellow-400 font-bold text-2xl">$X / month</div>
        </div>
      </div>

      {/* Payment placeholder */}
      <div className="bg-chess-bg-card border border-yellow-500/30 rounded-xl p-8 text-center">
        <Crown size={32} className="text-yellow-400 mx-auto mb-3" />
        <h3 className="text-chess-text-primary font-semibold text-lg mb-2">Payment Coming Soon</h3>
        <p className="text-chess-text-secondary text-sm max-w-sm mx-auto">
          We're setting up our payment system. Check back soon to upgrade your account and unlock
          up to 5 bots!
        </p>
        <div className="mt-6 p-4 bg-chess-bg rounded-lg border border-chess-border text-xs text-chess-text-secondary font-mono">
          [ Payment integration placeholder — Stripe / PayPal to be integrated ]
        </div>
      </div>

      <div className="text-center mt-6">
        <Link href="/dashboard" className="text-chess-text-secondary text-sm hover:text-chess-green">
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
