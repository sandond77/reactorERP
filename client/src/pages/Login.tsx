import { Zap } from 'lucide-react';

const ERROR_MESSAGES: Record<string, string> = {
  not_allowed: 'This email is not on the beta access list. Contact the admin to request access.',
  auth_failed: 'Sign-in failed. Please try again.',
};

export function Login() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  const errorMessage = error ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.auth_failed : null;

  return (
    <div className="min-h-svh bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 mb-4">
            <Zap size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">Reactor</h1>
          <p className="text-sm text-zinc-500 mt-1">Trading Card Inventory Manager</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          {errorMessage && (
            <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3">
              {errorMessage}
            </div>
          )}
          <a
            href="/api/v1/auth/google"
            className="flex items-center justify-center gap-3 w-full bg-white text-zinc-900 font-semibold text-sm px-4 py-4 rounded-xl active:bg-zinc-100 hover:bg-zinc-100 transition-colors"
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </a>
        </div>
        <p className="text-center text-xs text-zinc-600 mt-6">
          On mobile? After signing in, visit <span className="text-zinc-400">/mobile</span> for the AI agent.
        </p>
      </div>
    </div>
  );
}
