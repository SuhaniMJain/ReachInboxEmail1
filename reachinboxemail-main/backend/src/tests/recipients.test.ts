import { describe, expect, it } from "vitest";
import { parseRecipientsFile } from "../services/recipients.service";

describe("recipients file parsing", () => {
  it("parses one-email-per-line text", () => {
    expect(parseRecipientsFile("a@x.com\nb@x.com\nc@x.com")).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("parses CSV with headers and extra columns", () => {
    const csv = "name,email,company\nAlice,alice@corp.com,Acme\nBob,bob@corp.com,Beta\n";
    expect(parseRecipientsFile(csv)).toEqual(["alice@corp.com", "bob@corp.com"]);
  });

  it("extracts addresses from display-name format and dedupes case-insensitively", () => {
    const txt = 'John Doe <john@x.com>; JANE <jane@x.com>; john@X.COM';
    expect(parseRecipientsFile(txt)).toEqual(["john@x.com", "jane@x.com"]);
  });

  it("rejects an empty file", () => {
    expect(() => parseRecipientsFile("   \n  ")).toThrow(/empty/i);
  });

  it("rejects a file with no valid addresses and lists invalid ones", () => {
    expect(() => parseRecipientsFile("not-an-email\nalso@bad")).toThrow(/no valid email/i);
  });
});
