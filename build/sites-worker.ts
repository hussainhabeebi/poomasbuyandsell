import handler from "vinext/server/fetch-handler";
import { GUIDES } from "../lib/catalog";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const path = new URL(request.url).pathname.replace(/\/$/, "") || "/";
    // Handle absent catalogue records at the HTTP boundary before framework streaming.
    // Private and withdrawn records must have exactly the same public 404 response.
    if (request.method === "GET" || request.method === "HEAD") {
      if (path.startsWith("/listing/")) {
        if (!env.DB) return new Response("Listing service temporarily unavailable", {status:503,headers:{"Retry-After":"60"}});
        try {
          const slug = path.slice("/listing/".length);
          const listing = await env.DB.prepare("SELECT id FROM listings WHERE slug=? AND status IN ('published','sold')").bind(slug).first();
          if (!listing) return missingPage(request.method);
        } catch (error) {
          console.error("Listing boundary unavailable", error);
          return new Response("Listing service temporarily unavailable", {status:503,headers:{"Retry-After":"60"}});
        }
      }
      if (path.startsWith("/guides/") && !GUIDES.some(g=>path===`/guides/${g.slug}`)) return missingPage(request.method);
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};

function missingPage(method: string) {
  const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Listing unavailable | Poomas Buy & Sell</title><link rel="icon" href="/favicon.svg"><style>body{margin:0;font:16px system-ui;color:#122434;background:#f7f9fa}main{max-width:600px;margin:14vh auto;padding:35px}h1{font-size:42px;letter-spacing:-1.5px;line-height:1.15}p{color:#6b7882;line-height:1.8}a{display:inline-block;background:#d5f467;color:#122434;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:700}small{letter-spacing:2px}</style></head><body><main><small>POOMAS BUY &amp; SELL · 404</small><h1>This opportunity has moved.</h1><p>The page or listing you are looking for is not publicly available. Explore the marketplace for your next opportunity.</p><a href="/">Back to the marketplace</a></main></body></html>';
  return new Response(method==='HEAD'?null:page,{status:404,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
