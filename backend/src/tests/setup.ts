/**
 * Per-worker test setup. vitest's `test.env` already pinned REDIS_URL (db 9)
 * and EMAIL_SEARCH_INDEX (emails_test) before any app module loads, so the
 * suite cannot interfere with — or be polluted by — any other instance
 * sharing localhost Redis db 0 or the dev Elasticsearch index.
 *
 * The test index is wiped and recreated with the EXACT production mapping via
 * ensureEmailIndex(): if it were auto-created by the first bulk write, ES would
 * dynamic-map `status` as text and the keyword terms filter would match nothing.
 */
import { es, ensureEmailIndex } from "../services/search.service";
import { env } from "../config/env";

// setupFiles execute at module top level (no default-export hook is called).
await es.indices
  .delete({ index: env.EMAIL_SEARCH_INDEX }, { ignore: [404] })
  .catch(() => undefined);
await ensureEmailIndex();
