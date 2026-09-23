/// <reference path="../.astro/types.d.ts" />

// Secrets for src/pages/api/contact.ts, read via `import { env } from "cloudflare:workers"`.
// Locally from .dev.vars, in production from the Worker's secrets.
declare namespace Cloudflare {
  interface Env {
    CF_ACCOUNT_ID: string;
    CF_EMAIL_API_TOKEN: string;
    CF_EMAIL_FROM: string;
  }
}

// Minimal typing for the Workers runtime module (full runtime types would
// clash with the DOM lib the rest of the site is checked against).
declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
}
