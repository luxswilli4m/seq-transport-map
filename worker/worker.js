// SEQ Transport Map — live data relay (Cloudflare Worker)
// Passes Translink's public GTFS-Realtime feeds to the map with browser (CORS) access,
// caching each feed for 15 seconds so Translink is called at most 4 times a minute per feed.

const FEEDS = {
  vehicles: "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions",
  trips:    "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/TripUpdates",
  alerts:   "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/Alerts",
};
const ALLOWED_ORIGINS = [
  "https://luxswilli4m.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
];
const CACHE_SECONDS = 15;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

    const name = url.pathname.replace(/^\/+|\/+$/g, "");
    if (name === "") {
      return new Response("SEQ Transport Map live relay. Feeds: /vehicles /trips /alerts", {
        headers: { "Content-Type": "text/plain", ...corsHeaders(origin) },
      });
    }
    const upstream = FEEDS[name];
    if (!upstream) return new Response("Not found", { status: 404, headers: corsHeaders(origin) });

    // Shared edge cache, keyed by feed only (not by visitor).
    const cache = caches.default;
    const cacheKey = new Request("https://relay.cache/" + name);
    let res = await cache.match(cacheKey);
    if (!res) {
      let up;
      try {
        up = await fetch(upstream, { headers: { "User-Agent": "seq-transport-map relay" } });
      } catch (e) {
        return new Response("Upstream unavailable", { status: 502, headers: corsHeaders(origin) });
      }
      if (!up.ok) return new Response("Upstream error " + up.status, { status: 502, headers: corsHeaders(origin) });
      res = new Response(up.body, {
        headers: {
          "Content-Type": "application/x-protobuf",
          "Cache-Control": "public, max-age=" + CACHE_SECONDS,
          "X-Fetched-At": new Date().toISOString(),
        },
      });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(corsHeaders(origin))) out.headers.set(k, v);
    out.headers.set("Cache-Control", "public, max-age=" + CACHE_SECONDS);
    return out;
  },
};
