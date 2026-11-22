"""Rail replacement buses -> data/railbus.json, from Translink's SEQ GTFS.

Usage: python3 tools/build_railbus.py <gtfs_dir> <repo_dir>

Translink publishes planned rail replacement buses in its timetable feed as routes named
"Rail Replacement Bus" (R295, R584 ...), with their real road paths, stops and dates, usually
about four weeks ahead. This groups them into closures (routes that run on the same days and
replace the same stretch of track), and works out the closed stretch of railway between the
stations the buses connect, so the map can grey it out and name the stations.
Permanent rail buses (e.g. 649 Caboolture - Nambour) aren't included.
Run daily (railbus.yml) and in the weekly refresh. Keeps the previous file if the feed has no data.
"""
import sys, os, json, math, heapq, datetime as dt
from collections import defaultdict
import pandas as pd
from shapely.geometry import LineString, Point
from shapely.ops import substring

G, OUT = sys.argv[1], sys.argv[2]
DEST = os.path.join(OUT, "data/railbus.json")
rd = lambda f, **k: pd.read_csv(os.path.join(G, f), **k)
BNE = dt.timezone(dt.timedelta(hours=10))
today = dt.datetime.now(BNE).date()

r = rd("routes.txt", dtype=str)
rb = r[(r.route_long_name.fillna("").str.strip().str.lower() == "rail replacement bus") & (r.route_type == "3")]
if rb.empty:
    print("No rail replacement buses in the feed.")
t = rd("trips.txt", dtype=str)
s = rd("stops.txt", dtype={"stop_id": str, "parent_station": str})
cal = rd("calendar.txt", dtype=str)
cd = rd("calendar_dates.txt", dtype=str)
S = s.set_index("stop_id")

def km(a, b):  # (lon, lat) pairs
    return math.hypot((a[0] - b[0]) * 99.4, (a[1] - b[1]) * 110.6)

# ---- service dates
def dates_of(sid):
    out = set()
    c = cal[cal.service_id == sid]
    if len(c):
        c = c.iloc[0]
        d0 = dt.datetime.strptime(c.start_date, "%Y%m%d").date(); d1 = dt.datetime.strptime(c.end_date, "%Y%m%d").date()
        days = [c.monday, c.tuesday, c.wednesday, c.thursday, c.friday, c.saturday, c.sunday]
        d = d0
        while d <= d1:
            if days[d.weekday()] == "1": out.add(d)
            d += dt.timedelta(days=1)
    for _, x in cd[cd.service_id == sid].iterrows():
        d = dt.datetime.strptime(x.date, "%Y%m%d").date()
        if x.exception_type == "1": out.add(d)
        else: out.discard(d)
    return out

# ---- rail network: stations, all-stops edges, shapes
rtr = r[r.route_type == "2"]
tt = t[t.route_id.isin(rtr.route_id)]
rbt = t[t.route_id.isin(rb.route_id)]
need = set(tt.trip_id) | set(rbt.trip_id)
st = rd("stop_times.txt", usecols=["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"], dtype={"trip_id": str, "stop_id": str})
st = st[st.trip_id.isin(need)]
par = S.parent_station.to_dict()
top = lambda x: par.get(x) if isinstance(par.get(x), str) and par.get(x) != "nan" else x
st["sid"] = st.stop_id.map(top)

# rail patterns (stations in order) with one shape each
rseq = {k: g.sort_values("stop_sequence").sid.tolist() for k, g in st[st.trip_id.isin(set(tt.trip_id))].groupby("trip_id")}
pat = {}
for _, x in tt.iterrows():
    sq = tuple(rseq.get(x.trip_id, []))
    if len(sq) > 1 and sq not in pat: pat[sq] = x.shape_id
stations = {sid for sq in pat for sid in sq}
SLL = {sid: (float(S.at[sid, "stop_lon"]), float(S.at[sid, "stop_lat"])) for sid in stations}
SNAME = {sid: str(S.at[sid, "stop_name"]).replace(" station", "").strip() for sid in stations}
# an edge between neighbouring stations on some pattern; an express hop (stations between it on another pattern) is dropped
cons, between = defaultdict(set), set()
for sq in pat:
    for i in range(len(sq) - 1): cons[(sq[i], sq[i + 1])].add(sq)
    pos = {x: i for i, x in enumerate(sq)}
    for a in sq:
        for b in sq:
            if pos[b] - pos[a] > 1: between.add((a, b)); between.add((b, a))
edges = {e: p for e, p in cons.items() if e not in between}
adj = defaultdict(list)
for (a, b) in edges:
    w = km(SLL[a], SLL[b]); adj[a].append((b, w)); adj[b].append((a, w))

def path(a, b):
    if a == b: return [a]
    dist, prev, q = {a: 0}, {}, [(0, a)]
    while q:
        d, u = heapq.heappop(q)
        if u == b: break
        if d > dist[u]: continue
        for v, w in adj[u]:
            if d + w < dist.get(v, 1e9): dist[v] = d + w; prev[v] = u; heapq.heappush(q, (d + w, v))
    if b not in prev: return None
    out = [b]
    while out[-1] != a: out.append(prev[out[-1]])
    return out[::-1]

need_sh = set(pat.values())
shp = rd("shapes.txt", dtype={"shape_id": str})
rb_shapes = set(rbt.shape_id.dropna())
shp = shp[shp.shape_id.isin(need_sh | rb_shapes)].sort_values(["shape_id", "shape_pt_sequence"])
SH = {k: g[["shape_pt_lon", "shape_pt_lat"]].values.tolist() for k, g in shp.groupby("shape_id")}

def rnd(cs, tol=0.00004):
    ls = LineString(cs).simplify(tol) if len(cs) > 2 else LineString(cs)
    return [[round(x, 5), round(y, 5)] for x, y in ls.coords]

edge_geo = {}
def track(a, b):
    key = tuple(sorted((a, b)))
    if key in edge_geo: return edge_geo[key]
    sq = min(edges.get((a, b)) or edges.get((b, a)))   # fixed choice, so daily runs give identical files
    cs = SH.get(pat[sq])
    g = None
    if cs and len(cs) > 1:
        ln = LineString(cs); pa, pb = ln.project(Point(SLL[a])), ln.project(Point(SLL[b]))
        if abs(pb - pa) > 1e-6:
            seg = substring(ln, min(pa, pb), max(pa, pb))
            if seg.geom_type == "LineString" and len(seg.coords) > 1: g = rnd(list(seg.coords))
    edge_geo[key] = g or [list(SLL[a]), list(SLL[b])]
    return edge_geo[key]

def nearest_station(sid, limit=0.7):
    ll = (float(S.at[sid, "stop_lon"]), float(S.at[sid, "stop_lat"]))
    best = min(sorted(stations), key=lambda x: km(SLL[x], ll))
    return best if km(SLL[best], ll) <= limit else None

def hm(x):
    h, m, _ = map(int, str(x).split(":")); return h * 60 + m

# ---- each rail replacement route
routes = {}
svc_dates = {}
for _, rr in rb.iterrows():
    ts = rbt[rbt.route_id == rr.route_id]
    if ts.empty: continue
    sts = st[st.trip_id.isin(set(ts.trip_id))].sort_values(["trip_id", "stop_sequence"])
    by_trip = {k: g for k, g in sts.groupby("trip_id")}
    win = defaultdict(lambda: [10 ** 6, 0])   # date -> [first departure, last arrival] minutes after midnight (can pass 24:00)
    stops, pairs = {}, defaultdict(int)
    for _, x in ts.iterrows():
        g = by_trip.get(x.trip_id)
        if g is None or len(g) < 2: continue
        if x.service_id not in svc_dates: svc_dates[x.service_id] = dates_of(x.service_id)
        d0, d1 = hm(g.departure_time.iloc[0]), hm(g.arrival_time.iloc[-1])
        for d in svc_dates[x.service_id]:
            if d < today - dt.timedelta(days=1): continue
            w = win[d]; w[0] = min(w[0], d0); w[1] = max(w[1], d1)
        for sid in g.stop_id: stops[sid] = 1
        A, B = nearest_station(g.stop_id.iloc[0]), nearest_station(g.stop_id.iloc[-1])
        if A and B and A != B: pairs[tuple(sorted((A, B)))] += 1
    if not win: continue
    # the route's main runs (odd one-off trips, e.g. a first bus from further out, don't widen the closure)
    tot = sum(pairs.values()) or 1
    main = [pr for pr, n in pairs.items() if n >= 2 and n / tot >= 0.05]
    paths = [p for p in (path(a, b) for a, b in main) if p]
    served = []
    for sid in stops:   # stations the buses stop at (a stop within 350 m)
        n = nearest_station(sid, 0.35)
        if n and n not in served: served.append(n)
    for a, b in main:
        for x in (a, b):
            if x not in served: served.append(x)
    shapes = [rnd(SH[shid]) for shid in ts.shape_id.value_counts().index if shid in SH]
    routes[rr.route_short_name] = dict(
        n=rr.route_short_name, id=rr.route_id,
        days={d.isoformat(): w for d, w in win.items()},
        main=main, paths=paths, served=served, shapes=shapes,
        stops=[[sid, str(S.at[sid, "stop_name"]), round(float(S.at[sid, "stop_lon"]), 5), round(float(S.at[sid, "stop_lat"]), 5)] for sid in stops],
        trips=int(len(ts)))

# ---- group routes into closures: same days (at least one in common) and the same track or stations
names = sorted(routes)
parent = {n: n for n in names}
def find(x):
    while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
    return x
pedges = lambda x: {tuple(sorted((p[i], p[i + 1]))) for p in x["paths"] for i in range(len(p) - 1)}
for i, a in enumerate(names):
    for b in names[i + 1:]:
        A, B = routes[a], routes[b]
        da, db = set(A["days"]), set(B["days"])
        # same closure: mostly the same days, and the same stretch of track or stations
        if len(da & db) / len(da | db) >= 0.5 and (pedges(A) & pedges(B) or set(A["served"]) & set(B["served"])):
            parent[find(a)] = find(b)
groups = defaultdict(list)
for n in names: groups[find(n)].append(n)

GAP = 2   # a run of up to 2 stations the buses skip still counts as closed (express buses run alongside all-stops ones)
closures = []
for ns in groups.values():
    rs = [routes[n] for n in ns]
    days = defaultdict(lambda: [10 ** 6, 0])
    for x in rs:
        for d, w in x["days"].items():
            days[d][0] = min(days[d][0], w[0]); days[d][1] = max(days[d][1], w[1])
    served = {sid for x in rs for sid in x["served"]}
    segs = set()
    for x in rs:
        for p in x["paths"]:
            idx = [i for i, sid in enumerate(p) if sid in served]
            for i, j in zip(idx, idx[1:]):
                if j - i - 1 <= GAP:
                    for k in range(i, j): segs.add(tuple(sorted((p[k], p[k + 1]))))
    deg = defaultdict(int)
    for a, b in segs: deg[a] += 1; deg[b] += 1
    on_track = set(deg)
    leaves = [x for x in on_track if deg[x] == 1]
    ends = defaultdict(int)
    for x in rs:
        for a, b in x["main"]: ends[a] += 1; ends[b] += 1
    # name: the station most buses run from, to the far ends of the closed track ("Roma Street ↔ Banoon & Cleveland")
    hub = max(leaves or ends, key=lambda z: (ends.get(z, 0), z)) if (leaves or ends) else None
    others = sorted([z for z in leaves if z != hub], key=lambda z: -km(SLL[z], SLL[hub])) if hub else []
    if hub and others:
        title = f"{SNAME[hub]} ↔ " + " & ".join(SNAME[z] for z in others[:3]) + (f" & {len(others) - 3} more" if len(others) > 3 else "")
    elif hub:
        far = [z for z in ends if z != hub]
        title = f"{SNAME[hub]} ↔ {SNAME[max(far, key=lambda z: km(SLL[z], SLL[hub]))]}" if far else SNAME[hub]
    else:
        title = " / ".join(ns)
    # stations along the closed track, from the hub outwards; then stations the buses connect to off the closed track
    order = []
    if hub in on_track:   # one branch at a time, nearest first
        seen, stack = set(), [hub]
        while stack:
            u = stack.pop()
            if u in seen: continue
            seen.add(u); order.append(u)
            nb = [b if a == u else a for a, b in segs if u in (a, b)]
            stack += sorted([v for v in nb if v not in seen], key=lambda v: -km(SLL[v], SLL[u]))
    order += sorted(on_track - set(order), key=lambda z: SNAME[z])
    extra = sorted({z for z in ends if z not in on_track}, key=lambda z: SNAME[z])
    # kind: 1 = end of the closed track or where buses start, 0 = closed station in between, 2 = buses connect here (track open)
    kind = lambda z: 2 if z not in on_track else 1 if (deg[z] == 1 or z in ends) else 0
    closures.append(dict(
        id="-".join(ns), title=title, routes=ns,
        days={d: days[d] for d in sorted(days)},
        stations=[[sid, SNAME[sid], round(SLL[sid][0], 5), round(SLL[sid][1], 5), kind(sid)] for sid in order + extra],
        track=[track(a, b) for a, b in sorted(segs)]))
closures.sort(key=lambda c: (min(c["days"]), c["title"]))

if not closures and os.path.exists(DEST) and rb.empty:
    print("Feed has no rail replacement buses; leaving the previous file."); sys.exit(0)
out = dict(built=dt.datetime.now(BNE).isoformat(timespec="minutes"), feed_from=today.isoformat(), closures=closures,
           routes={n: {k: v for k, v in x.items() if k not in ("main", "paths", "served")} for n, x in routes.items()})
os.makedirs(os.path.dirname(DEST), exist_ok=True)
json.dump(out, open(DEST, "w"), separators=(",", ":"), ensure_ascii=False)
# small index for every page load: colours the More menu item and adds notices to station cards
idx = dict(built=out["built"], closures=[dict(id=c["id"], title=c["title"], routes=c["routes"], days=c["days"],
           st={x[0]: x[4] for x in c["stations"]}) for c in closures])
json.dump(idx, open(os.path.join(OUT, "data/railbus-days.json"), "w"), separators=(",", ":"), ensure_ascii=False)
print(f"{len(closures)} closures from {len(routes)} rail replacement routes -> {DEST} ({os.path.getsize(DEST) // 1024} kB)")
for c in closures:
    print(" ", c["title"], "|", ", ".join(c["routes"]), "|", list(c["days"])[0], "to", list(c["days"])[-1], "|", len(c["stations"]), "stations,", len(c["track"]), "track pieces")
