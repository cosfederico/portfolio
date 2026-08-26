import type { APIRoute } from "astro";

// This endpoint only ever runs on the server, never at build time.
export const prerender = false;

interface ContactPayload {
  name: string;
  email: string;
  message: string;
}

const TO_ADDRESS = "cosciafederico@outlook.com";

const MAX_NAME_LENGTH = 20;
const MAX_EMAIL_LENGTH = 254; // practical email address limit per RFC 5321
const MAX_MESSAGE_LENGTH = 5000;
const MAX_BODY_BYTES = 20_000; // 20 KB - well above any legitimate submission

// Simple for now: "is this shaped like an email", not a full RFC 5322
// parser. `\s` already excludes newlines/tabs, so this alone rejects most
// embedded-control-character attempts; `sanitize()` below is the backstop.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// Strips ASCII control characters (C0 + DEL) and caps length. For single-line
// fields (name, email) every control character - including \r and \n, which
// could otherwise smuggle extra lines into a header-ish value like the email
// subject or `reply_to` - collapses to a space. For the message body,
// `keepNewlines` preserves \n (normalizing \r\n/\r to it) since it's meant to
// be multi-line, while still stripping everything else.
function sanitize(value: string, maxLength: number, { keepNewlines = false } = {}): string {
  const cleaned = keepNewlines
    ? value.replace(/\r\n?/g, "\n").replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, "")
    : value.replace(/[\x00-\x1F\x7F]/g, " ").replace(/ {2,}/g, " ");
  return cleaned.trim().slice(0, maxLength);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "Request body too large." }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request body." }, 400);
  }


  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonResponse({ ok: false, error: "Invalid request body." }, 400);
  }
  const payload = body as Partial<ContactPayload>;

  const name = typeof payload.name === "string" ? sanitize(payload.name, MAX_NAME_LENGTH) : "";
  const email = typeof payload.email === "string" ? sanitize(payload.email, MAX_EMAIL_LENGTH) : "";
  const message =
    typeof payload.message === "string" ? sanitize(payload.message, MAX_MESSAGE_LENGTH, { keepNewlines: true }) : "";

  if (!name || !email || !message) {
    return jsonResponse({ ok: false, error: "Name, email, and message are all required." }, 400);
  }

  if (!EMAIL_RE.test(email)) {
    return jsonResponse({ ok: false, error: "That email address doesn't look valid." }, 400);
  }

  const { CF_ACCOUNT_ID, CF_EMAIL_API_TOKEN, CF_EMAIL_FROM } = locals.runtime.env;
  if (!CF_ACCOUNT_ID || !CF_EMAIL_API_TOKEN || !CF_EMAIL_FROM) {
    console.error("[contact] Missing CF_ACCOUNT_ID / CF_EMAIL_API_TOKEN / CF_EMAIL_FROM env vars.");
    return jsonResponse({ ok: false, error: "Email isn't configured yet. Please try again later." }, 500);
  }

  let cfRes: Response;
  try {
    cfRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/email/sending/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_EMAIL_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: CF_EMAIL_FROM,
        to: TO_ADDRESS,
        reply_to: email,
        subject: `Portfolio - New inquiry from ${name}`,
        text: `From: ${name} <${email}>\n\n${message}`,
        html: `<p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p><p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`,
      }),
    });
  } catch (err) {
    console.error("[contact] Failed to reach Cloudflare Email Service:", err);
    return jsonResponse({ ok: false, error: "Failed to send your message. Please try again later." }, 502);
  }

  const result = await cfRes.json().catch(() => null);
  if (!cfRes.ok || !result?.success) {
    console.error("[contact] Cloudflare Email Service rejected the send:", cfRes.status, result);
    return jsonResponse({ ok: false, error: "Failed to send your message. Please try again later." }, 502);
  }

  return jsonResponse({ ok: true }, 200);
};
