import { useEmails, type EmailKind } from "../hooks/useEmails";
import { EmailTable } from "./EmailTable";
import { ErrorState, Spinner } from "./States";
import { Pagination } from "./Pagination";

/** Shared panel for the Scheduled / Sent tabs: search box, table, states, pagination. */
export function EmailsPanel({ kind, searchPlaceholder }: { kind: EmailKind; searchPlaceholder: string }) {
  const { emails, total, page, setPage, query, setQuery, loading, error, refetch, pageSize } = useEmails(kind);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder={searchPlaceholder}
          className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        <span className="text-sm text-slate-500">{total} total</span>
      </div>

      {loading ? (
        <Spinner label={`Loading ${kind} emails…`} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void refetch()} />
      ) : emails.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-slate-200 bg-white py-16 text-center">
          <span className="text-3xl">{kind === "scheduled" ? "🗓️" : "📤"}</span>
          <p className="font-medium text-slate-700">
            {kind === "scheduled" ? "No scheduled emails yet" : "No sent emails yet"}
          </p>
          <p className="text-sm text-slate-500">
            {kind === "scheduled" ? "Compose a campaign to see it here." : "Sent and failed emails will appear here."}
          </p>
        </div>
      ) : (
        <>
          <EmailTable emails={emails} timeColumn={kind === "scheduled" ? "scheduledAt" : "sentAt"} />
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
