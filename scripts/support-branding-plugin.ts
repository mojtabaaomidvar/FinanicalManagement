import type { Plugin } from "vite";
import { supportAppDescription, supportAppName, supportPageTitle } from "../src/features/support/branding";

const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** Keep support installation metadata separate from the household PWA. */
export function supportBrandingPlugin(): Plugin {
  return {
    name: "support-branding",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        if (!context.filename.replaceAll("\\", "/").endsWith("/support.html")) return html;
        return html.replaceAll("__SUPPORT_APP_NAME__", escapeHtml(supportAppName))
          .replaceAll("__SUPPORT_PAGE_TITLE__", escapeHtml(supportPageTitle))
          .replaceAll("__SUPPORT_APP_DESCRIPTION__", escapeHtml(supportAppDescription))
          .replace(/<link\b[^>]*\bhref="\/manifest\.webmanifest"[^>]*>/g, "")
          .replace(/<script\b[^>]*\bsrc="\/registerSW\.js"[^>]*>[\s\S]*?<\/script>/g, "");
      },
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "support.webmanifest",
        source: JSON.stringify({
          id: "/", start_url: "/", scope: "/", name: supportAppName, short_name: supportAppName,
          description: supportAppDescription, lang: "fa", dir: "rtl", display: "standalone",
          background_color: "#f4f6f2", theme_color: "#213a2f",
          icons: [
            { src: "/icons/support-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/support-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icons/support-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        }),
      });
    },
  };
}
