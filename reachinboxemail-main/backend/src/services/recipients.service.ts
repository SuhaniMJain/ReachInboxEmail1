import { ValidationError } from "../utils/errors";
import { env } from "../config/env";

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function isValidEmail(addr: string): boolean {
  return addr.length <= 254 && EMAIL_RE.test(addr);
}

/**
 * Parse a CSV/TSV/TXT list of email leads.
 * Accepts: one email per line, comma/semicolon/tab separated values,
 * header rows and extra columns (a column containing valid emails is detected).
 * Returns unique, valid, ordered addresses; throws on an empty/invalid file.
 */
export function parseRecipientsFile(content: string): string[] {
  if (!content || !content.trim()) {
    throw new ValidationError("Recipient file is empty");
  }
  const found = new Set<string>();
  const invalid: string[] = [];

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    for (const cell of cells) {
      if (!cell) continue;
      // Extract bare address from formats like "John Doe <john@x.com>"
      const angle = cell.match(/<([^>]+)>/);
      const candidate = (angle ? angle[1] : cell).trim();
      if (!candidate) continue;
      if (isValidEmail(candidate)) {
        found.add(candidate.toLowerCase());
      } else if (candidate.includes("@")) {
        invalid.push(candidate);
      }
      // cells without "@" are ignored (headers, names, other columns)
    }
  }

  if (found.size === 0) {
    throw new ValidationError(
      invalid.length > 0
        ? `No valid email addresses found. Invalid entries: ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? ` (+${invalid.length - 5} more)` : ""}`
        : "No valid email addresses found in file",
    );
  }
  if (found.size > env.MAX_RECIPIENTS_PER_FILE) {
    throw new ValidationError(`File contains ${found.size} recipients; limit is ${env.MAX_RECIPIENTS_PER_FILE}`);
  }
  return [...found];
}
