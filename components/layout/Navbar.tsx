'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { useState } from 'react';
import { Crown, LogOut, User, ChevronDown } from 'lucide-react';

export default function Navbar() {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = (session?.user as any)?.role;

  return (
    <nav className="bg-chess-bg-card border-b border-chess-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <span className="text-2xl">♛</span>
          <span className="text-chess-text-primary">Styled</span>
          <span className="text-chess-green">Chess</span>
        </Link>

        <div className="flex items-center gap-6 text-sm">
          {session?.user ? (
            <>
              <Link href="/dashboard" className="text-chess-text-secondary hover:text-chess-text-primary transition-colors">
                Dashboard
              </Link>
              <Link href="/bots" className="text-chess-text-secondary hover:text-chess-text-primary transition-colors">
                My Bots
              </Link>
              <Link href="/games" className="text-chess-text-secondary hover:text-chess-text-primary transition-colors">
                Games
              </Link>

              <div className="relative">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center gap-2 text-chess-text-primary hover:text-chess-green transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-chess-green/20 border border-chess-green/40 flex items-center justify-center">
                    <User size={14} className="text-chess-green" />
                  </div>
                  <span className="hidden sm:block max-w-[100px] truncate">{session.user.name ?? session.user.email}</span>
                  {role === 'MEMBER' && <Crown size={12} className="text-yellow-400" />}
                  <ChevronDown size={14} />
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-9 w-48 bg-chess-bg-card border border-chess-border rounded-lg shadow-xl py-1 z-50">
                    {role !== 'MEMBER' && (
                      <Link
                        href="/upgrade"
                        className="flex items-center gap-2 px-4 py-2 text-sm text-yellow-400 hover:bg-chess-bg-hover"
                        onClick={() => setMenuOpen(false)}
                      >
                        <Crown size={14} /> Upgrade to Member
                      </Link>
                    )}
                    <button
                      onClick={() => { setMenuOpen(false); signOut({ callbackUrl: '/' }); }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-chess-text-secondary hover:bg-chess-bg-hover hover:text-red-400 transition-colors"
                    >
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="text-chess-text-secondary hover:text-chess-text-primary transition-colors">
                Login
              </Link>
              <Link
                href="/auth/register"
                className="px-4 py-1.5 bg-chess-green hover:bg-chess-green-dark text-white rounded-lg font-medium transition-colors"
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
