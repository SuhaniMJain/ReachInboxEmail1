import type { EmailStatus } from "../types";

const STYLES: Record<EmailStatus, string> = {
  SCHEDULED: "bg-sky-50 text-sky-700 ring-sky-200",
  SENDING: "bg-amber-50 text-amber-700 ring-amber-200",
  SENT: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  FAILED: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      {status.toLowerCase()}
    </span>
  );
}
