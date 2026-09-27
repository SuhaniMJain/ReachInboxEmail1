import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, oauthUrl } from "../services/api";
import type { SlackStatus } from "../types";

/**
 * "Connect Slack" — starts the real Slack OAuth flow (full-page redirect to the
 * backend endpoint). Once connected, rate-limit notifications are DM'd on Slack.
 */
export function SlackButton() {
  const [status, setStatus] = useState<SlackStatus | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.slackStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("slack");
    if (flag === "connected") {
      toast.success("Slack connected");
      void load();
    } else if (flag === "error") {
      toast.error("Slack connection was cancelled or failed");
    } else if (flag === "not_configured") {
      toast.error("Slack is not configured — set SLACK_CLIENT_ID / SLACK_CLIENT_SECRET in backend/.env (see README)");
    }
    if (flag) window.history.replaceState({}, "", "/dashboard");
  }, [load]);

  if (status?.connected) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Slack connected{status.teamName ? ` · ${status.teamName}` : ""}
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        window.location.href = oauthUrl("/api/slack/connect");
      }}
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M5.04 15.12a2.52 2.52 0 0 1-2.52 2.52A2.52 2.52 0 0 1 0 15.12a2.52 2.52 0 0 1 2.52-2.52h2.52v2.52Zm1.26 0a2.52 2.52 0 0 1 2.52-2.52 2.52 2.52 0 0 1 2.52 2.52v6.34A2.52 2.52 0 0 1 8.82 24a2.52 2.52 0 0 1-2.52-2.52v-6.36ZM8.82 5.04a2.52 2.52 0 0 1-2.52-2.52A2.52 2.52 0 0 1 8.82 0a2.52 2.52 0 0 1 2.52 2.52v2.52H8.82Zm0 1.26a2.52 2.52 0 0 1 2.52 2.52 2.52 2.52 0 0 1-2.52 2.52H2.48A2.52 2.52 0 0 1 0 8.82a2.52 2.52 0 0 1 2.52-2.52h6.3Z" opacity=".6" />
        <path d="M18.96 8.82a2.52 2.52 0 0 1 2.52-2.52A2.52 2.52 0 0 1 24 8.82a2.52 2.52 0 0 1-2.52 2.52h-2.52V8.82Zm-1.26 0a2.52 2.52 0 0 1-2.52 2.52 2.52 2.52 0 0 1-2.52-2.52V2.48A2.52 2.52 0 0 1 15.18 0a2.52 2.52 0 0 1 2.52 2.52v6.3ZM15.18 18.96a2.52 2.52 0 0 1 2.52 2.52A2.52 2.52 0 0 1 15.18 24a2.52 2.52 0 0 1-2.52-2.52v-2.52h2.52Zm0-1.26a2.52 2.52 0 0 1-2.52-2.52 2.52 2.52 0 0 1-2.52 2.52v6.34A2.52 2.52 0 0 1 10.14 24a2.52 2.52 0 0 1 2.52-2.52v-6.3h2.52Z" opacity=".6" />
      </svg>
      Connect Slack
    </button>
  );
}
