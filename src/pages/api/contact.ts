import type { APIRoute } from "astro";

// This endpoint only ever runs on the server, never at build time.
export const prerender = false;

interface ContactPayload {
  name: string;
  email: string;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let payload: Partial<ContactPayload>;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request body." }, 400);
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";

  if (!name || !email || !message) {
    return jsonResponse({ ok: false, error: "Name, email, and message are all required." }, 400);
  }

  if (!EMAIL_RE.test(email)) {
    return jsonResponse({ ok: false, error: "Please input a valid email address." }, 400);
  }

  // TODO: actually send an email (e.g. via Resend, Postmark, or SMTP) once a
  // provider is chosen. For now, just log the submission to the terminal so
  // the flow can be wired up and tested end-to-end.
  console.log("[contact] New inquiry received:", {
    name,
    email,
    message,
    receivedAt: new Date().toISOString(),
  });

  return jsonResponse({ ok: true }, 200);
};
