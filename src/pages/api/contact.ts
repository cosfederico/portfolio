import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { LIMITS, escapeHtml, parseContact } from "../../lib/contact";
import site from "../../data/site.json";

// On-demand (Worker) route; every other page is prerendered.
export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SEND_FAILED = "Failed to send your message. Please try again later.";

export const POST: APIRoute = async ({ request }) => {
  if (Number(request.headers.get("content-length") ?? 0) > LIMITS.bodyBytes) {
    return json({ ok: false, error: "Request body too large." }, 413);
  }

  const result = parseContact(await request.json().catch(() => null));
  if (!result.ok) return json(result, 400);
  if (result.spam) return json({ ok: true }, 200);
  const { name, email, message } = result.data;

  const { CF_ACCOUNT_ID, CF_EMAIL_API_TOKEN, CF_EMAIL_FROM } = env;
  if (!CF_ACCOUNT_ID || !CF_EMAIL_API_TOKEN || !CF_EMAIL_FROM) {
    console.error("[contact] Missing CF_ACCOUNT_ID / CF_EMAIL_API_TOKEN / CF_EMAIL_FROM.");
    return json({ ok: false, error: "Email isn't configured yet. Please try again later." }, 500);
  }

  // Cloudflare Email Service REST API (setup steps in .dev.vars.example).
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/email/sending/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CF_EMAIL_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: CF_EMAIL_FROM,
        to: site.email,
        reply_to: email,
        subject: `Portfolio - New inquiry from ${name}`,
        text: `From: ${name} <${email}>\n\n${message}`,
        html: `<p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p><p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      console.error("[contact] Cloudflare Email Service rejected the send:", res.status, body);
      return json({ ok: false, error: SEND_FAILED }, 502);
    }
  } catch (err) {
    console.error("[contact] Failed to reach Cloudflare Email Service:", err);
    return json({ ok: false, error: SEND_FAILED }, 502);
  }

  return json({ ok: true }, 200);
};
