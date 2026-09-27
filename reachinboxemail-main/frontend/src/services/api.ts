import type {
  EmailSearchResponse,
  MeResponse,
  ScheduleRequest,
  ScheduleResponse,
  Sender,
  SlackStatus,
  UploadResponse,
} from "../types";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401) {
    throw new ApiError(401, "Not authenticated");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      message = data?.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

/** Full-page navigations for OAuth flows (Google login, Slack connect). */
export function oauthUrl(path: string): string {
  return `${BASE}${path}`;
}

export const api = {
  me: () => request<MeResponse>("/api/auth/me"),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  senders: () => request<{ senders: Sender[] }>("/api/senders"),
  createSender: (data: { fromName: string; fromEmail: string; isDefault?: boolean }) =>
    request<{ sender: Sender }>("/api/senders", { method: "POST", body: JSON.stringify(data) }),

  uploadRecipients: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<UploadResponse>("/api/emails/upload", { method: "POST", body: form });
  },

  schedule: (data: ScheduleRequest) =>
    request<ScheduleResponse>("/api/emails/schedule", { method: "POST", body: JSON.stringify(data) }),

  scheduled: (params: { q?: string; page?: number; pageSize?: number }) =>
    request<EmailSearchResponse>(`/api/emails/scheduled?${qs(params)}`),

  sent: (params: { q?: string; page?: number; pageSize?: number }) =>
    request<EmailSearchResponse>(`/api/emails/sent?${qs(params)}`),

  slackStatus: () => request<SlackStatus>("/api/slack/status"),
};

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, String(v));
  }
  return search.toString();
}
