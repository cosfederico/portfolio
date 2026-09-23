import { test } from "node:test";
import assert from "node:assert/strict";
import { parseContact, sanitize, escapeHtml, LIMITS } from "./contact.ts";

const valid = { name: "Ada", email: "ada@example.com", message: "Hello" };

test("accepts a valid message", () => {
  assert.deepEqual(parseContact(valid), { ok: true, spam: false, data: valid });
});

test("rejects non-object bodies", () => {
  for (const body of [null, "x", 42, [valid]]) assert.equal(parseContact(body).ok, false);
});

test("requires every field and a plausible email", () => {
  assert.equal(parseContact({ ...valid, name: "   " }).ok, false);
  assert.equal(parseContact({ ...valid, message: undefined }).ok, false);
  assert.equal(parseContact({ ...valid, email: "not-an-email" }).ok, false);
  assert.equal(parseContact({ ...valid, email: "a@b.co\nBcc: x@y.z" }).ok, false);
});

test("strips header-injection characters from single-line fields", () => {
  const result = parseContact({ ...valid, name: "Ada\r\nBcc: evil@example.com" });
  assert.ok(result.ok && !result.spam);
  assert.equal(result.data.name, "Ada Bcc: evil@example.com");
});

test("keeps newlines in the message, normalizing CRLF and dropping other controls", () => {
  assert.equal(sanitize("a\r\nb\rc\x07d", 100, { multiline: true }), "a\nb\ncd");
});

test("caps field lengths", () => {
  const result = parseContact({ ...valid, name: "x".repeat(500) });
  assert.ok(result.ok && !result.spam);
  assert.equal(result.data.name.length, LIMITS.name);
});

test("honeypot submissions are flagged as spam, not errors", () => {
  assert.deepEqual(parseContact({ ...valid, website: "http://spam.example" }), { ok: true, spam: true });
});

test("escapes HTML", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});
