import type { EmailItem } from "../types";
import { StatusBadge } from "./StatusBadge";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface Props {
  emails: EmailItem[];
  timeColumn: "scheduledAt" | "sentAt";
}

/** Shared table for the Scheduled and Sent tabs (DRY). */
export function EmailTable({ emails, timeColumn }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Subject</th>
            <th className="px-4 py-3">{timeColumn === "scheduledAt" ? "Scheduled time" : "Sent time"}</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {emails.map((e) => (
            <tr key={e.id} className="hover:bg-slate-50/70">
              <td className="max-w-[260px] truncate px-4 py-3 font-medium text-slate-800" title={e.recipient}>
                {e.recipient}
              </td>
              <td className="max-w-[260px] truncate px-4 py-3 text-slate-600" title={e.subject}>
                {e.subject}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                {fmt(timeColumn === "scheduledAt" ? e.scheduledAt : e.sentAt)}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={e.status} />
                {e.status === "FAILED" && e.lastError && (
                  <p className="mt-1 max-w-[220px] truncate text-xs text-rose-500" title={e.lastError}>
                    {e.lastError}
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
