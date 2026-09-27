import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { EmailItem } from "../types";

export type EmailKind = "scheduled" | "sent";

/**
 * Reusable hook for the Elasticsearch-backed email search tables:
 * loading / error / empty states, query, pagination and polling refresh
 * so scheduled→sent transitions appear without a manual reload.
 */
export function useEmails(kind: EmailKind, pollMs = 5000) {
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const fn = kind === "scheduled" ? api.scheduled : api.sent;
      const res = await fn({ q: query || undefined, page, pageSize });
      if (!mounted.current) return;
      setEmails(res.emails);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      if (mounted.current) setError((err as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [kind, query, page]);

  useEffect(() => {
    setLoading(true);
    void load();
    const timer = setInterval(() => void load(), pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  return { emails, total, page, setPage, query, setQuery, loading, error, refetch: load, pageSize };
}
