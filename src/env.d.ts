/// <reference path="../.astro/types.d.ts" />

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

interface Env {
  CF_ACCOUNT_ID: string;
  CF_EMAIL_API_TOKEN: string;
  CF_EMAIL_FROM: string;
}

declare namespace App {
  interface Locals extends Runtime {}
}
