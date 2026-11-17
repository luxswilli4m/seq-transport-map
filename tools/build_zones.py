"""Rebuild the bus route-number zones and the busway lines.

Usage: python3 tools/build_zones.py <gtfs_dir> <repo_dir> [--force]

Only stops with services running in the next 7 days are counted, so new stops and
stations join the zones once they are in service. The result is compared with the
current zones; if a zone vanishes or changes size by more than 25 %, the current
zones are kept and the reason is written to zone_check.txt (the weekly GitHub Action
turns that into a notification). --force skips the check.
"""
import sys, os, json, math, datetime
import numpy as np, pandas as pd
from collections import defaultdict
from shapely.geometry import box, Polygon, MultiPolygon, Point, LineString
from shapely.ops import unary_union
from scipy.spatial import cKDTree
from scipy import ndimage as ndi
from scipy.ndimage import gaussian_filter1d
from PIL import Image, ImageDraw
import contourpy

G, REPO = sys.argv[1], sys.argv[2]; FORCE = "--force" in sys.argv
NET = os.path.join(REPO, "data/network.json")
net = json.load(open(NET)); D = net["data"]; R = D["routes"]; ST = D["stops"]
rd = lambda f, **k: pd.read_csv(os.path.join(G, f), **k)
COL = {1: "#A066F0", 2: "#2F86F5", 3: "#3DDC6F", 4: "#FF9A1F", 5: "#F2453D", 6: "#22D3EE", 7: "#F7D23E"}
GREY = np.array([150, 158, 168]); EXCLUDE = {590, 598, 599}
CBD = (153.0255, -27.4690); CELL = 0.015
KX = 111.32 * math.cos(math.radians(27.5)); KY = 110.57
problems = []

# ---------- 1. stops served by each route series (100–799), services running in the next 7 days
routes = rd("routes.txt", dtype=str)
routes = routes[routes.route_type == "3"].copy()
routes["num"] = pd.to_numeric(routes.route_short_name, errors="coerce")
routes = routes[(routes.num >= 100) & (routes.num < 800) & (~routes.num.isin(EXCLUDE))]
routes["series"] = (routes.num // 100).astype(int)
cal = rd("calendar.txt", dtype=str); cd = rd("calendar_dates.txt", dtype=str)
today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=10))).date()
days = [today + datetime.timedelta(d) for d in range(7)]
active = set()
for d in days:
    ymd = d.strftime("%Y%m%d"); wd = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"][d.weekday()]
    on = set(cal[(cal[wd] == "1") & (cal.start_date <= ymd) & (cal.end_date >= ymd)].service_id)
    on |= set(cd[(cd.date == ymd) & (cd.exception_type == "1")].service_id); on -= set(cd[(cd.date == ymd) & (cd.exception_type == "2")].service_id)
    active |= on
trips = rd("trips.txt", dtype=str, usecols=["route_id", "service_id", "trip_id"])
trips = trips[trips.service_id.isin(active)].merge(routes[["route_id", "route_short_name", "series"]], on="route_id")
st = rd("stop_times.txt", dtype={"trip_id": str, "stop_id": str}, usecols=["trip_id", "stop_id"])
st = st[st.trip_id.isin(set(trips.trip_id))].merge(trips[["trip_id", "series", "route_short_name"]], on="trip_id")
stops = rd("stops.txt", dtype={"stop_id": str}, usecols=["stop_id", "stop_lat", "stop_lon"])
g = st.drop_duplicates(["series", "stop_id"]).merge(stops, on="stop_id")[["series", "stop_id", "stop_lat", "stop_lon"]]
stop_routes = st.drop_duplicates(["stop_id", "route_short_name"]).groupby("stop_id").route_short_name.agg(set).to_dict()
del st
print("series stops", len(g), "active services", len(active))

# ---------- 2. dominant zones on a 1.5 km grid
g["cx"] = (g.stop_lon // CELL).astype(int); g["cy"] = (g.stop_lat // CELL).astype(int)
cnt = g.groupby(["cx", "cy", "series"]).size().unstack(fill_value=0)
dom = {}
for (cx, cy), row in cnt.iterrows():
    s = row.sort_values(ascending=False)
    if s.iloc[0] < 2: continue
    a = s.index[0]
    if len(s) > 1 and s.iloc[1] >= max(3, 0.5 * s.iloc[0]): continue
    dom.setdefault(a, []).append((cx, cy))
def shape(cells, minarea):
    u = unary_union([box(cx * CELL, cy * CELL, (cx + 1) * CELL, (cy + 1) * CELL) for cx, cy in cells])
    u = u.buffer(0.009, join_style=1).buffer(-0.012, join_style=1).buffer(0.004, join_style=1)
    parts = [p for p in (u.geoms if isinstance(u, MultiPolygon) else [u]) if p.area >= minarea]
    def ch(c, it=4):
        c = np.array(c)[:-1]
        for _ in range(it):
            n = np.roll(c, -1, axis=0); c = np.stack([0.75 * c + 0.25 * n, 0.25 * c + 0.75 * n], axis=1).reshape(-1, 2)
        return np.vstack([c, c[:1]])
    out = []
    for p in parts:
        p = p.simplify(0.006)
        out.append(Polygon(ch(p.exterior.coords), [ch(i.coords) for i in p.interiors if len(i.coords) > 3 and Polygon(i).area > CELL * CELL * 2]).buffer(0))
    return out
zones = [(sr, p) for sr, cells in dom.items() for p in shape(cells, CELL * CELL * 3)]

# ---------- 3. overlap / outlying-stop chevron areas (500 m around stops), on a fine Web-Mercator grid
Z, SC, RPX = 11, 1.5, 3
NW = 2 ** Z
def merc(lon, lat): return (lon + 180) / 360 * NW * 256, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * NW * 256
LON0, LON1, LAT0, LAT1 = 152.08, 153.85, -26.28, -28.24
PX0, PY0 = merc(LON0, LAT0); PX1, PY1 = merc(LON1, LAT1)
W, H = int((PX1 - PX0) * SC), int((PY1 - PY0) * SC)
def P(lon, lat): x, y = merc(lon, lat); return ((x - PX0) * SC, (y - PY0) * SC)
def tolonlat(px, py):
    return (px / SC + PX0) / (NW * 256) * 360 - 180, np.degrees(np.arctan(np.sinh(np.pi - 2 * np.pi * (py / SC + PY0) / (NW * 256))))
w3, h3 = W // RPX + 1, H // RPX + 1
lon, lat = tolonlat((np.arange(w3) + 0.5) * RPX, (np.arange(h3) + 0.5) * RPX)
LX, LY = np.meshgrid(lon * KX, lat * KY); pts = np.c_[LX.ravel(), LY.ravel()]
cov = np.zeros(len(pts), np.int32)
for k in range(1, 8):
    sk = g[g.series == k]
    if not len(sk): continue
    d, _ = cKDTree(np.c_[sk.stop_lon * KX, sk.stop_lat * KY]).query(pts, distance_upper_bound=0.5, workers=-1)
    cov |= (np.isfinite(d).astype(np.int32) << (k - 1))
cov = cov.reshape(h3, w3); del pts
own = Image.new("L", (w3, h3), 0); dr = ImageDraw.Draw(own)
for sr, p in zones:
    dr.polygon([(P(a, b)[0] / RPX, P(a, b)[1] / RPX) for a, b in p.exterior.coords], fill=int(sr))
    for hole in p.interiors: dr.polygon([(P(a, b)[0] / RPX, P(a, b)[1] / RPX) for a, b in hole.coords], fill=0)
own = np.array(own).astype(np.int32)
mask = np.where(own > 0, cov & ~(1 << np.clip(own - 1, 0, 7)), cov)
key = own * 256 + mask
dist = np.hypot(LX - CBD[0] * KX, LY - CBD[1] * KY); incbd = (dist < 2.1) & (key > 0)
cbdstops = sorted(g[np.hypot(g.stop_lon * KX - CBD[0] * KX, g.stop_lat * KY - CBD[1] * KY) < 2.1].series.unique())
CBDKEY = 9999; key[incbd] = CBDKEY
def rgb(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)])
def colours(kv):
    if kv == CBDKEY: return [rgb(COL[s]) for s in cbdstops]
    A, m = kv // 256, kv % 256
    return [rgb(COL[c]) for c in ([A] if A else []) + [k for k in range(1, 8) if m >> (k - 1) & 1]] + ([] if A else [GREY])
ischev = lambda kv: kv != 0 and (kv == CBDKEY or kv % 256 != 0)
for _ in range(2):
    chs = [kv for kv in np.unique(key) if ischev(kv) and kv != CBDKEY]; cm = np.isin(key, chs)
    best = np.zeros(key.shape, np.float32); bl = key.copy()
    for kv in chs:
        s_ = ndi.uniform_filter((key == kv).astype(np.float32), 9); upd = cm & (s_ > best); best[upd] = s_[upd]; bl[upd] = kv
    key = np.where(cm, bl, key)
for kv in [k for k in np.unique(key) if ischev(k) and k != CBDKEY]:
    lab, n = ndi.label(key == kv)
    if n == 0: continue
    sizes = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    for i, sz in enumerate(sizes, 1):
        if sz >= 14: continue
        comp = lab == i; ring = ndi.binary_dilation(comp, iterations=2) & ~comp
        nb = np.array([v for v in key[ring] if ischev(v)])
        if len(nb): vals, cts = np.unique(nb, return_counts=True); key[comp] = vals[cts.argmax()]
gx = (np.arange(w3) + 0.5) * RPX; gy = (np.arange(h3) + 0.5) * RPX
OUT = {"zones": [], "chev": [], "dots": [], "loop": None, "labels": []}
for sr, p in zones:
    rings = [list(p.exterior.coords)] + [list(i.coords) for i in p.interiors]
    OUT["zones"].append({"s": int(sr), "r": [[[round(y, 5), round(x, 5)] for x, y in rg] for rg in rings]})
    if p.area > 0.006: rp = p.representative_point(); OUT["labels"].append({"s": int(sr), "p": [round(rp.y, 4), round(rp.x, 4)]})
for kv in np.unique(key):
    if not ischev(kv): continue
    bl = ndi.gaussian_filter((key == kv).astype(np.float32), 1.1); rings = []
    for ln in contourpy.contour_generator(gx, gy, bl).lines(0.5):
        if len(ln) < 4: continue
        lo_, la_ = tolonlat(ln[:, 0], ln[:, 1]); rings.append([[round(y, 5), round(x, 5)] for x, y in zip(lo_, la_)][::2])
    if rings: OUT["chev"].append({"c": ["#%02x%02x%02x" % tuple(c_) for c_ in colours(kv)], "r": rings})

# ---------- 4. dotted links: outlying stops, and separated patches of a zone
def dec(s):
    pts = []; i = la = lo = 0
    while i < len(s):
        for k in range(2):
            sh = res = 0
            while True:
                b = ord(s[i]) - 63; i += 1; res |= (b & 0x1f) << sh; sh += 5
                if b < 0x20: break
            v = ~(res >> 1) if res & 1 else res >> 1
            if k == 0: la += v
            else: lo += v
        pts.append((lo / 1e5, la / 1e5))
    return pts
paths = {r["n"]: [dec(d["p"]) for d in r["d"]] for r in R if r["t"] == "bus"}
ZU = unary_union([p for _, p in zones]); ZB = ZU.buffer(0.002)
remote = g[[not ZU.buffer(0.012).contains(Point(a, b)) for a, b in zip(g.stop_lon, g.stop_lat)]]
rr = defaultdict(list)
for sid, lo_, la_ in zip(remote.stop_id, remote.stop_lon, remote.stop_lat):
    for rt in stop_routes.get(sid, ()): rr[rt].append(Point(lo_, la_))
drawn = None
def add_dot(part):
    global drawn
    for seg in getattr(part, "geoms", [part]):
        if seg.is_empty or seg.length < 0.004: continue
        OUT["dots"].append([[round(y, 5), round(x, 5)] for x, y in seg.coords])
        drawn = seg.buffer(0.0015) if drawn is None else drawn.union(seg.buffer(0.0015))
loops = []
for rt, pl in rr.items():
    near = unary_union([q.buffer(0.012) for q in pl])
    ps = paths.get(rt, [])
    if len(ps) == 1 and Point(ps[0][0]).distance(Point(ps[0][-1])) < 0.003 and LineString(ps[0]).length > 0.02:
        loops.append(ps[0]); continue  # one-way loop: drawn whole with arrows
    for pth in ps:
        if len(pth) < 2: continue
        diff = LineString(pth).difference(ZB)
        for part in getattr(diff, "geoms", [diff]):
            if part.is_empty or part.length < 0.008 or not part.intersects(near): continue
            if drawn is not None: part = part.difference(drawn)
            add_dot(part)
by = defaultdict(list)
for s_, p in zones: by[s_].append(p)
def gaps(coords):
    out = []; cur = []; inside = []
    for c in coords:
        if ZU.contains(Point(c)): inside.append(c)
        else:
            if cur and inside:
                if (LineString(inside).length if len(inside) > 1 else 0) < 0.004: cur += inside
                else: out.append(cur); cur = []
            inside = []; cur.append(c)
    if cur: out.append(cur)
    return [LineString(x) for x in out if len(x) > 1]
for s_, ps in by.items():
    if len(ps) < 2: continue
    main = max(ps, key=lambda p: p.area)
    for patch in ps:
        if patch is main: continue
        others = [q for q in ps if q is not patch]
        rts = {rt for sid, lo_, la_ in zip(g.stop_id, g.stop_lon, g.stop_lat) if patch.buffer(0.003).contains(Point(lo_, la_)) for rt in stop_routes.get(sid, ()) if rt.isdigit() and int(rt) // 100 == s_}
        for rt in sorted(rts):
            for pth in paths.get(rt, []):
                for part in gaps(pth):
                    if part.length < 0.004: continue
                    a, b = Point(part.coords[0]), Point(part.coords[-1]); near = lambda pt, Pp: Pp.distance(pt) < 0.008
                    if not ((near(a, patch) and any(near(b, q) for q in others)) or (near(b, patch) and any(near(a, q) for q in others))): continue
                    add_dot(part if drawn is None else part.difference(drawn))
if loops:  # largest one-way loop (e.g. 652 Beachmere), legs offset so it reads as a circuit
    lp = max(loops, key=lambda p: LineString(p).length)
    pp = np.array([P(a, b) for a, b in lp]); pp = np.c_[gaussian_filter1d(pp[:, 0], 3, mode="nearest"), gaussian_filter1d(pp[:, 1], 3, mode="nearest")]
    tg = np.gradient(pp, axis=0); tg /= np.maximum(np.linalg.norm(tg, axis=1), 1e-6)[:, None]; pp = pp + np.c_[-tg[:, 1], tg[:, 0]] * 7
    lo_, la_ = tolonlat(pp[:, 0], pp[:, 1]); OUT["loop"] = [[round(b, 5), round(a, 5)] for a, b in zip(lo_, la_)]

# ---------- 5. busways from tools/busways.json, traced along real bus paths
cfg = json.load(open(os.path.join(REPO, "tools/busways.json")))
byname = {}
for sid, v in ST.items():
    if v[3] in ("busway", "busstn", "bus"): byname.setdefault(v[0].lower(), sid)
allpaths = [np.array([(y, x) for x, y in p]) for ps in paths.values() for p in ps]
def kmd(a, b): return math.hypot((a[0] - b[0]) * KY, (a[1] - b[1]) * KX)
pairs = []; bws = {}; busway_ok = True
road = {tuple(x) for x in cfg.get("on_road_sections", [])}
for key_, bw in cfg["busways"].items():
    seq = bw["stations"]; grp = bw.get("part_of", key_)
    for nm in seq:
        sid = byname.get(nm.lower())
        if not sid: problems.append(f"Busway station '{nm}' ({bw['name']}) was not found in Translink's stops — check the spelling in tools/busways.json."); busway_ok = False; continue
        e = bws.setdefault(sid, {"b": [], "road": False})
        if grp not in e["b"]: e["b"].append(grp)
    for a, b in zip(seq[:-1], seq[1:]):
        sa, sb = byname.get(a.lower()), byname.get(b.lower())
        if not sa or not sb: continue
        A = np.array(ST[sa][1:3]); B = np.array(ST[sb][1:3]); best = None
        for TOL in (0.12, 0.25, 0.4):
            if best: break
            for p in allpaths:
                da = np.hypot((p[:, 0] - A[0]) * KY, (p[:, 1] - A[1]) * KX); db = np.hypot((p[:, 0] - B[0]) * KY, (p[:, 1] - B[1]) * KX)
                ia, ib = da.argmin(), db.argmin()
                if da[ia] > TOL or db[ib] > TOL: continue
                sub = p[ia:ib + 1] if ia <= ib else p[ib:ia + 1][::-1]
                L = np.hypot(np.diff(sub[:, 0]) * KY, np.diff(sub[:, 1]) * KX).sum()
                if L > kmd(A, B) * 2.2 + 0.3: continue
                sc = da[ia] + db[ib] + 0.05 * L
                if best is None or sc < best[0]: best = (sc, sub)
        seg = best[1].tolist() if best else [A.tolist(), B.tolist()]
        isroad = (a, b) in road or (b, a) in road
        pairs.append([key_, a, b, [[round(x, 5), round(y, 5)] for x, y in seg], 1 if isroad else 0])
for a, b in road:
    for nm in (a, b):
        sid = byname.get(nm.lower())
        if sid and sid in bws and all(((nm in pr) and (pr in road or pr[::-1] in road)) for pr in [(x[1], x[2]) for x in pairs if nm in (x[1], x[2])]): bws[sid]["road"] = True
colours = {k: v.get("colour") for k, v in cfg["busways"].items()}; names = {k: v["name"] for k, v in cfg["busways"].items() if "part_of" not in v}

# ---------- 6. safety check against the current zones
def areas(zs):
    a = defaultdict(float)
    for z in zs: a[z["s"]] += Polygon([(x, y) for y, x in z["r"][0]]).area
    return a
old_a, new_a = areas(net["zones"].get("zones", [])), areas(OUT["zones"])
for s_ in sorted(set(old_a) | set(new_a)):
    o, n = old_a.get(s_, 0), new_a.get(s_, 0)
    if o > 0.004 and n == 0: problems.append(f"The {s_}xx zone would disappear entirely.")
    elif o > 0.004 and abs(n - o) / o > 0.25: problems.append(f"The {s_}xx zone would change size by {round((n - o) / o * 100)} % (limit 25 %).")
zone_ok = FORCE or not [p for p in problems if "zone" in p]
if zone_ok:
    net["zones"] = OUT
if busway_ok or FORCE:
    net["busway"] = {"pairs": pairs, "colours": colours, "names": names}; net["bwStations"] = bws
    for sid in bws:
        if sid in ST: ST[sid][3] = "busway"
    for sid, v in ST.items():
        if v[3] == "busway" and sid not in bws: v[3] = "busstn"
json.dump(net, open(NET, "w"), separators=(",", ":"))
msg = os.path.join(REPO, "zone_check.txt")
if problems and not FORCE:
    open(msg, "w").write("The weekly map refresh kept some parts of the map as they were:\n\n" + "\n".join("- " + p for p in problems) +
                         ("\n\nBus zones were NOT updated." if not zone_ok else "") + ("\nBusways were NOT updated." if not busway_ok else "") +
                         "\n\nTimetables, stations and live data were still updated. Once checked, run the 'Refresh Translink data' workflow with 'force zones' ticked to accept the change.\n")
elif os.path.exists(msg): os.remove(msg)
print("zones", len(OUT["zones"]), "chev", len(OUT["chev"]), "dots", len(OUT["dots"]), "loop", bool(OUT["loop"]), "busway pairs", len(pairs), "busway stations", len(bws))
print("zone areas old/new:", {s: (round(old_a.get(s, 0), 4), round(new_a.get(s, 0), 4)) for s in sorted(set(old_a) | set(new_a))})
print("problems:", problems or "none", "| zones updated:", zone_ok, "| busways updated:", busway_ok or FORCE)
