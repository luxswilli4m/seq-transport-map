"""Build per-area timetable files for the map from a Translink GTFS folder.

Usage: python3 tools/build_timetables.py <gtfs_dir> <repo_dir>
Writes data/tt/calendar.json and data/tt/<tile>.json (stops grouped into ~5 km tiles).
"""
import sys, os, json, math, re
import pandas as pd
from collections import defaultdict

G, OUT = sys.argv[1], sys.argv[2]
net = json.load(open(os.path.join(OUT, "data/network.json")))
D = net["data"]; R = D["routes"]; ST = D["stops"]
ridx = {r["n"]: i for i, r in enumerate(R)}

routes = pd.read_csv(os.path.join(G, "routes.txt"), dtype=str)
trips = pd.read_csv(os.path.join(G, "trips.txt"), dtype=str, usecols=["route_id", "service_id", "trip_id", "trip_headsign", "direction_id"])
trips = trips.merge(routes[["route_id", "route_short_name"]], on="route_id")
trips = trips[trips.route_short_name.isin(ridx)]
stops = pd.read_csv(os.path.join(G, "stops.txt"), dtype=str, usecols=["stop_id", "parent_station"])
parent = {a: (b if isinstance(b, str) and b and b != "nan" else a) for a, b in zip(stops.stop_id, stops.parent_station)}
for c in net.get("detached", []): parent[c] = c

# platform / bay labels for stops inside a station (e.g. "Platform 7", "Stop 2a", "Stop A")
import re as _re
_sx = pd.read_csv(os.path.join(G, "stops.txt"), dtype=str, usecols=["stop_id", "stop_name", "parent_station", "platform_code"])
def plabel(name, code):
    name = str(name or "")
    m = _re.search(r",\s*platform\s+(\w+)\s*$", name, _re.I)
    if m: return "Platform " + m.group(1)
    m = _re.search(r"\bstop\s+(\w{1,4})\b", name, _re.I)
    if m: return "Stop " + m.group(1)
    m = _re.search(r",\s*(\w{1,3})\s*$", name)
    if m: return "Stop " + m.group(1)
    if isinstance(code, str) and code.strip() and code != "nan" and len(code) <= 3: return "Stop " + code.strip()
    return None
PL = {}
for sid_, nm_, par_, code_ in zip(_sx.stop_id, _sx.stop_name, _sx.parent_station, _sx.platform_code):
    if isinstance(par_, str) and par_ and par_ != "nan" and parent.get(sid_) != sid_:
        lb = plabel(nm_, code_)
        if lb: PL[sid_] = lb
plabels = sorted(set(PL.values())); pl_index = {l: k for k, l in enumerate(plabels)}
print("platform labels", len(PL), "distinct", len(plabels))

# calendar
cal = pd.read_csv(os.path.join(G, "calendar.txt"), dtype=str)
cdates = pd.read_csv(os.path.join(G, "calendar_dates.txt"), dtype=str)
svc_ids = sorted(set(trips.service_id))
svc_index = {s: k for k, s in enumerate(svc_ids)}
days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
svc = []
calm = cal.set_index("service_id")
for s in svc_ids:
    if s in calm.index:
        row = calm.loc[s]
        mask = "".join(row[d] for d in days)
        svc.append([mask, row["start_date"], row["end_date"]])
    else:
        svc.append(["0000000", "", ""])
add = defaultdict(list); rem = defaultdict(list)
for s, d, t in zip(cdates.service_id, cdates.date, cdates.exception_type):
    if s in svc_index:
        (add if t == "1" else rem)[svc_index[s]].append(d)
for k in range(len(svc)):
    svc[k].append(add.get(k, [])); svc[k].append(rem.get(k, []))

headsigns = sorted(set(trips.trip_headsign.fillna("")))
hs_index = {h: k for k, h in enumerate(headsigns)}
trips["ri"] = trips.route_short_name.map(ridx)
trips["hi"] = trips.trip_headsign.fillna("").map(hs_index)
trips["si"] = trips.service_id.map(svc_index)
tinfo = trips.set_index("trip_id")[["ri", "hi", "si"]]

def mins(t):
    h, m, _ = t.split(":"); return int(h) * 60 + int(m)

# last stop of each trip (arrival only, not a departure)
seqs = pd.read_csv(os.path.join(G, "stop_times.txt"), dtype={"trip_id": str}, usecols=["trip_id", "stop_sequence"])
last_seq = seqs.groupby("trip_id").stop_sequence.max().to_dict(); del seqs
print("stop_times rows (all trips):", sum(1 for _ in open(os.path.join(G, "stop_times.txt"))) - 1)
# stop_times in chunks
groups = defaultdict(list)  # (stop, ri, hi, si, platform) -> [minutes]
for chunk in pd.read_csv(os.path.join(G, "stop_times.txt"), dtype=str, usecols=["trip_id", "departure_time", "stop_id", "stop_sequence", "pickup_type"], chunksize=2_000_000):
    chunk = chunk[chunk.trip_id.isin(tinfo.index)]
    chunk = chunk[chunk.pickup_type.fillna("0") != "1"]  # skip set-down-only stops
    chunk = chunk.join(tinfo, on="trip_id")
    chunk = chunk[chunk.stop_sequence.astype(int) != chunk.trip_id.map(last_seq)]
    chunk["sid"] = chunk.stop_id.map(parent)
    for sid, ri, hi, si, dep, raw in zip(chunk.sid, chunk.ri, chunk.hi, chunk.si, chunk.departure_time, chunk.stop_id):
        if sid in ST:
            lb = PL.get(raw) if raw != sid else None
            groups[(sid, int(ri), int(hi), int(si), pl_index[lb] if lb else -1)].append(mins(dep))

tiles = defaultdict(dict)
def tile_of(s): return f"{math.floor(s[1]*20)}_{math.floor(s[2]*20)}"
for (sid, ri, hi, si, pi), times in groups.items():
    times = sorted(set(times))
    deltas = [times[0]] + [b - a for a, b in zip(times, times[1:])]
    # a negative 4th value marks the platform: -(index+1) into calendar.json "pl"
    tiles[tile_of(ST[sid])].setdefault(sid, []).append([ri, hi, si] + ([-(pi + 1)] if pi >= 0 else []) + deltas)

odir = os.path.join(OUT, "data/tt"); os.makedirs(odir, exist_ok=True)
for f in os.listdir(odir): os.remove(os.path.join(odir, f))
total = 0
for t, d in tiles.items():
    s = json.dumps(d, separators=(",", ":")); total += len(s)
    open(os.path.join(odir, t + ".json"), "w").write(s)
json.dump({"svc": svc, "hs": headsigns, "pl": plabels, "plid": {k: pl_index[v] for k, v in PL.items()}}, open(os.path.join(odir, "calendar.json"), "w"), separators=(",", ":"))
print("tiles", len(tiles), "MB", round(total / 1e6, 1), "services", len(svc), "headsigns", len(headsigns))

# ---------------------------------------------------------------------------
# Per-route timetables (like Translink's route pages): every stop, every trip,
# by direction. Bus/ferry/tram keyed by route name; trains keyed by line T1–T6.
TLINE_BY_COLOUR = {"27855A": "T1", "6CC6E9": "T2", "9B60A6": "T3", "4778B2": "T4", "FFC425": "T5", "D53E45": "T6"}
rinfo = routes.set_index("route_short_name")
def route_key(name):
    r = R[ridx[name]]
    if r["t"] == "train":
        return TLINE_BY_COLOUR.get(r["c"].lstrip("#").upper(), "T1")
    return name
trips["key"] = trips.route_short_name.map(route_key)
trips["dir"] = pd.read_csv(os.path.join(G, "trips.txt"), dtype=str, usecols=["trip_id", "direction_id"]).set_index("trip_id").direction_id.reindex(trips.trip_id).fillna("0").values
st_all = pd.read_csv(os.path.join(G, "stop_times.txt"), dtype=str, usecols=["trip_id", "departure_time", "stop_id", "stop_sequence"])
st_all = st_all[st_all.trip_id.isin(set(trips.trip_id))]
st_all["seq"] = st_all.stop_sequence.astype(int)
st_all["m"] = st_all.departure_time.map(mins)
st_all["sid"] = st_all.stop_id.map(parent)
st_all["pl"] = st_all.stop_id.map(lambda x: pl_index.get(PL.get(x), -1)).astype(int)   # platform / stop letter used
st_all = st_all.sort_values(["trip_id", "seq"])
tmeta = trips.set_index("trip_id")[["key", "dir", "hi", "si"]]
by_trip = {tid: (g.sid.tolist(), g.m.tolist(), g.pl.tolist()) for tid, g in st_all.groupby("trip_id", sort=False)}
del st_all

def order_stops(patterns):
    """patterns: list of (keys, weight). Returns a merged order (topological, ties by mean position)."""
    from collections import defaultdict
    succ = defaultdict(set); indeg = defaultdict(int); pos = defaultdict(list); nodes = set()
    for keys, w in patterns:
        n = len(keys)
        for i, k in enumerate(keys):
            nodes.add(k); pos[k].append((i / max(n - 1, 1), w))
        for a, b in zip(keys, keys[1:]):
            if b not in succ[a]: succ[a].add(b); indeg[b] += 1
    avg = {k: sum(p * w for p, w in v) / sum(w for _, w in v) for k, v in pos.items()}
    out = []; ready = [k for k in nodes if indeg[k] == 0]; left = set(nodes)
    while left:
        if not ready:
            k = min(left, key=lambda x: avg[x]); ready = [k]
        nxt = [x for x in ready if out and x in succ[out[-1]]]  # keep a branch together
        pick = min(nxt, key=lambda x: avg[x]) if nxt else min(ready, key=lambda x: avg[x])
        ready.remove(pick); k = pick
        if k not in left: continue
        out.append(k); left.discard(k)
        for nb in succ[k]:
            indeg[nb] -= 1
            if indeg[nb] <= 0 and nb in left and nb not in ready: ready.append(nb)
    return out

rdir = os.path.join(OUT, "data/rt"); os.makedirs(rdir, exist_ok=True)
for f in os.listdir(rdir): os.remove(os.path.join(rdir, f))
groups = defaultdict(list)
for tid, (key, d, hi, si) in tmeta.iterrows():
    if tid in by_trip: groups[(key, d)].append((tid, int(hi), int(si)))
files = defaultdict(dict); rt_total = 0
for (key, d), tl in groups.items():
    pat = defaultdict(int); tkeys = {}
    for tid, hi, si in tl:
        sids = by_trip[tid][0]; seen = defaultdict(int); ks = []
        for x in sids:
            seen[x] += 1; ks.append(x + ("#%d" % seen[x] if seen[x] > 1 else ""))
        tkeys[tid] = ks; pat[tuple(ks)] += 1
    order = order_stops(list(pat.items()))
    col = {k: i for i, k in enumerate(order)}
    uniq = {}; tpl = {}
    for tid, hi, si in tl:
        ks = tkeys[tid]; _, ms, pls = by_trip[tid]
        row = [-1] * len(order); prow = [-1] * len(order)
        for k, m, pl in zip(ks, ms, pls): row[col[k]] = m; prow[col[k]] = pl
        first = min(m for m in row if m >= 0)
        rel = tuple(m - first if m >= 0 else -1 for m in row)
        u = uniq.setdefault((hi, first, rel), [])
        u.append(si); tpl.setdefault((hi, first, rel), prow)
    keys_sorted = sorted(uniq, key=lambda x: x[1])
    tripsout = [[hi, sorted(set(uniq[(hi, first, rel)])), first] + list(rel) for (hi, first, rel) in keys_sorted]
    # platforms: the usual platform or stop letter at each stop ("p", indexes into calendar.json "pl"), and the trips
    # that use a different one ("px": {trip row: {stop column: platform}})
    pdef = []
    for c in range(len(order)):
        cnt = defaultdict(int)
        for kk in keys_sorted:
            if tpl[kk][c] >= 0: cnt[tpl[kk][c]] += 1
        pdef.append(max(cnt, key=cnt.get) if cnt else -1)
    px = {}
    for r_, kk in enumerate(keys_sorted):
        diff = {str(c): v for c, v in enumerate(tpl[kk]) if v >= 0 and v != pdef[c]}
        if diff: px[str(r_)] = diff
    hcount = defaultdict(int)
    for tid, hi, si in tl: hcount[hi] += 1
    files[key][d] = {"o": [k.split("#")[0] for k in order], "top": [h for h, _ in sorted(hcount.items(), key=lambda x: -x[1])[:3]], "t": tripsout}
    if any(v >= 0 for v in pdef): files[key][d]["p"] = pdef
    if px: files[key][d]["px"] = px
for key, dd in files.items():
    s = json.dumps(dd, separators=(",", ":")); rt_total += len(s)
    open(os.path.join(rdir, re.sub(r"[^A-Za-z0-9_-]", "_", key) + ".json"), "w").write(s)
print("route tables", len(files), "MB", round(rt_total / 1e6, 1))
