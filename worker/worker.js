// SEQ Transport Map — live data relay (Cloudflare Worker)
// Passes Translink's public GTFS-Realtime feeds to the map with browser (CORS) access,
// caching each feed for 15 seconds so Translink is called at most 4 times a minute per feed.
//
// It also makes sure the travel-time recordings start (GitHub's own timer can be late or skip runs).
// Cloudflare runs scheduled() at the Cron Triggers set on the worker (UTC):
//   0,20 20 * * *   6:00 and 6:20 am Brisbane, before the AM window (6:30-9:30)
//   0,20 5 * * *    3:00 and 3:20 pm Brisbane, before the PM window (3:30-6:30)
// Each time it asks GitHub whether a "Measure travel times" run is already running or waiting; if not, it starts
// one (which also restarts the waiter chain). Needs the secret GITHUB_TOKEN: a fine-grained GitHub token limited to
// luxswilli4m/seq-transport-map with "Actions: read and write".

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

const REPO = "luxswilli4m/seq-transport-map";

async function gh(env, path, init) {
  return fetch("https://api.github.com/repos/" + REPO + path, {
    ...init,
    headers: {
      "Authorization": "Bearer " + env.GITHUB_TOKEN,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "seq-transport-map relay",
      ...(init && init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

async function startRecordingIfNeeded(env, band) {
  if (!env.GITHUB_TOKEN) { console.log("no GITHUB_TOKEN secret set"); return "no token"; }
  const since = Date.now() - 3 * 3600 * 1000;
  for (const status of ["in_progress", "queued", "waiting", "pending"]) {
    const r = await gh(env, "/actions/workflows/measure.yml/runs?per_page=10&status=" + status);
    if (!r.ok) { console.log("GitHub said " + r.status + " (check the token)"); return "error " + r.status; }
    const runs = (await r.json()).workflow_runs || [];
    if (runs.some(x => Date.parse(x.created_at) > since)) { console.log(band + ": a recording is already " + status); return "already " + status; }
  }
  const d = await gh(env, "/actions/workflows/measure.yml/dispatches", {
    method: "POST", body: JSON.stringify({ ref: "main", inputs: { band } }),
  });
  console.log(band + ": nothing running, started a recording (" + d.status + ")");
  return d.ok ? "started" : "error " + d.status;
}

export default {
  async scheduled(event, env, ctx) {
    const hour = new Date(event.scheduledTime).getUTCHours();   // 20 UTC = 6 am Brisbane, 5 UTC = 3 pm
    const band = hour >= 12 ? "am" : "pm";
    ctx.waitUntil(startRecordingIfNeeded(env, band));
  },

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
