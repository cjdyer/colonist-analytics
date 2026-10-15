import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Production-only CSP. It's injected at build time because the React plugin's
// dev server relies on an inline preamble script that a strict CSP would block.
function cspPlugin(apiBase: string): Plugin {
  let apiOrigin = "";
  if (apiBase) {
    const u = new URL(apiBase); // throws on a malformed VITE_API_BASE, failing the build early
    if (u.protocol !== "https:") throw new Error("VITE_API_BASE must use https in production builds.");
    apiOrigin = u.origin;
  }
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
  return {
    name: "inject-csp",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" },
    ],
  };
}

// Relative base so the build works at https://<user>.github.io/<repo>/ without
// knowing the repo name. Routing is hash-based, so no 404.html trick is needed.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    base: "./",
    plugins: [react(), cspPlugin(env.VITE_API_BASE ?? "")],
    build: { outDir: "dist", sourcemap: false },
  };
});
