// Validation for the contact form endpoint (src/pages/api/contact.ts), kept
// free of Astro/Cloudflare imports so it can be unit tested with node:test.

export const LIMITS = {
  name: 100,
  email: 254, // practical address limit per RFC 5321
  message: 5000,
  bodyBytes: 20_000,
} as const;

export interface ContactMessage {
  name: string;
  email: string;
  message: string;
}

export type ParseResult =
  | { ok: true; spam: false; data: ContactMessage }
  | { ok: true; spam: true }
  | { ok: false; error: string };

// "Shaped like an email", not a full RFC 5322 parser. `\s` also rejects
// embedded newlines/tabs.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Strips ASCII control characters (C0 + DEL) and caps length. Single-line
// fields collapse every control character - \r and \n included, which could
// otherwise smuggle extra lines into the subject or reply_to - to a space.
// Multi-line fields keep \n (normalizing \r\n and \r to it).
export function sanitize(value: string, maxLength: number, { multiline = false } = {}): string {
  const cleaned = multiline
    ? value.replace(/\r\n?/g, "\n").replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, "")
    : value.replace(/[\x00-\x1F\x7F]/g, " ").replace(/ {2,}/g, " ");
  return cleaned.trim().slice(0, maxLength);
}

const field = (body: Record<string, unknown>, key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");

export function parseContact(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body." };
  }
  const input = body as Record<string, unknown>;

  // Honeypot: a field hidden from people but filled in by naive bots. Bots get
  // a normal-looking success so they don't adapt; nothing is sent.
  if (field(input, "website").trim()) return { ok: true, spam: true };

  const name = sanitize(field(input, "name"), LIMITS.name);
  const email = sanitize(field(input, "email"), LIMITS.email);
  const message = sanitize(field(input, "message"), LIMITS.message, { multiline: true });

  if (!name || !email || !message) return { ok: false, error: "Name, email, and message are all required." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That email address doesn't look valid." };

  return { ok: true, spam: false, data: { name, email, message } };
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
