import { defineConfig, fontProviders } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://federicocoscia.photos",
  // Every page is prerendered except src/pages/api/contact.ts (prerender = false).
  // Images are optimized once at build time with sharp; nothing is resized at request time.
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [sitemap({ filter: (page) => !page.includes("/api/") })],
  // Keep HTML-aware whitespace collapsing: the v7 default ('jsx') strips the
  // spaces between inline elements that the copy relies on ("my <a>YouTube</a>").
  compressHTML: true,
  fonts: [
    {
      provider: fontProviders.google(),
      name: "DM Sans",
      cssVariable: "--font-dm-sans",
      weights: ["300 700"],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["system-ui", "sans-serif"],
    },
    {
      provider: fontProviders.google(),
      name: "Bricolage Grotesque",
      cssVariable: "--font-bricolage",
      weights: ["400 700"],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["system-ui", "sans-serif"],
    },
  ],
});
