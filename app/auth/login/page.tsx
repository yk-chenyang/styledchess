'use client';

import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      if (result.error === 'EMAIL_NOT_VERIFIED') {
        setError('Please verify your email before logging in.');
      } else {
        setError('Invalid email or password.');
      }
      return;
    }

    router.push(callbackUrl);
  }

  async function handleGoogle() {
    await signIn('google', { callbackUrl });
  }

  return (
    <div className="min-h-[calc(100vh-112px)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-4xl">♛</span>
          <h1 className="text-2xl font-bold text-chess-text-primary mt-2">Welcome back</h1>
          <p className="text-chess-text-secondary text-sm mt-1">Sign in to your StyledChess account</p>
        </div>

        <div className="bg-chess-bg-card border border-chess-border rounded-xl p-6 space-y-4">
          {/* Google */}
          <button
            onClick={handleGoogle}
            className="w-full flex items-center justify-center gap-3 py-2.5 border border-chess-border rounded-lg text-chess-text-primary hover:bg-chess-bg-hover transition-colors text-sm font-medium"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-chess-border" />
            <span className="text-chess-text-secondary text-xs">or</span>
            <div className="flex-1 h-px bg-chess-border" />
          </div>

          {/* Email/password */}
          <form onSubmit={handleCredentials} className="space-y-3">
            <div>
              <label className="block text-chess-text-secondary text-xs font-medium mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full bg-chess-bg border border-chess-border rounded-lg px-3 py-2 text-chess-text-primary placeholder:text-chess-text-secondary focus:outline-none focus:border-chess-green text-sm"
              />
            </div>
            <div>
              <label className="block text-chess-text-secondary text-xs font-medium mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-chess-bg border border-chess-border rounded-lg px-3 py-2 text-chess-text-primary focus:outline-none focus:border-chess-green text-sm"
              />
            </div>

            {error && (
              <p className="text-red-400 text-xs bg-red-900/20 border border-red-600/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-chess-green hover:bg-chess-green-dark disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-chess-text-secondary text-sm mt-4">
          Don't have an account?{' '}
          <Link href="/auth/register" className="text-chess-green hover:underline font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><div className="w-8 h-8 border-2 border-chess-green border-t-transparent rounded-full animate-spin" /></div>}>
      <LoginForm />
    </Suspense>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}
