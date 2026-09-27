import { useAuth } from "../hooks/useAuth";

/** Login screen — real Google OAuth, then redirect to the dashboard. */
export function LoginPage() {
  const { startGoogleLogin } = useAuth();
  const error = new URLSearchParams(window.location.search).get("error");
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl text-white">✉️</span>
        <h1 className="text-xl font-bold text-slate-900">Outbox Email Scheduler</h1>
        <p className="mt-1 text-sm text-slate-500">
          Schedule campaigns to thousands of leads with rate limits, retries and Slack alerts.
        </p>
        {error === "google_not_configured" && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800">
            Google login is not configured yet. Set <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code> in{" "}
            <code className="font-mono text-xs">backend/.env</code> and restart the backend — the README ("Google OAuth")
            walks through the Google Cloud Console steps.
          </div>
        )}
        <button
          onClick={startGoogleLogin}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5">
            <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.8 2.9c2.3-2.1 3.6-5.2 3.6-8.6z" />
            <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-3.9 3C3.4 21.3 7.4 24 12 24z" />
            <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-3.9-3C.6 8.2 0 10 0 12s.6 3.8 1.3 5.4l3.9-3z" />
            <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.6 1.4L19 3c-2-1.8-4.7-3-7-3C7.4 0 3.4 2.7 1.3 6.6l3.9 3c1-2.9 3.7-4.9 6.9-4.9z" />
          </svg>
          Continue with Google
        </button>
        <p className="mt-6 text-xs text-slate-400">You will be redirected to Google, then back to your dashboard.</p>
      </div>
    </div>
  );
}
