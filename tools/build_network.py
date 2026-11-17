"""Rebuild the routes/stops/search part of data/network.json from a Translink GTFS folder.

Usage: python3 tools/build_network.py <gtfs_dir> <repo_dir>
Keeps the hand-built layers (bus zones, busway geometry, busway station list) from the
existing network.json and replaces routes, stops, suburbs, streets and the feed date.
"""
import sys, os, re, json
import pandas as pd
from collections import Counter
from shapely.geometry import LineString

G, OUT = sys.argv[1], sys.argv[2]
NET = os.path.join(OUT, "data/network.json")
old = json.load(open(NET))
rd = lambda f, **k: pd.read_csv(os.path.join(G, f), **k)
r = rd("routes.txt", dtype=str)
t = rd("trips.txt", dtype=str)
s = rd("stops.txt", dtype={"stop_id": str, "parent_station": str})
st = rd("stop_times.txt", usecols=["trip_id", "stop_id", "stop_sequence"], dtype={"trip_id": str, "stop_id": str})
sh = rd("shapes.txt", dtype={"shape_id": str})

def enc(coords, prec=5):
    out = []; px = py = 0
    for lon, lat in coords:
        la, lo = int(round(lat * 10**prec)), int(round(lon * 10**prec))
        for v in (la - py, lo - px):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20: out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        py, px = la, lo
    return "".join(out)
def simplify(pts, tol=0.00006):
    return list(LineString(pts).simplify(tol).coords) if len(pts) > 2 else pts

par = s.set_index("stop_id").parent_station.to_dict()
def top(x): p = par.get(x); return p if isinstance(p, str) and p != "nan" else x
st["sid"] = st.stop_id.map(top)

t = t.merge(r[["route_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"]], on="route_id")
tripcount = t.groupby(["route_short_name", "direction_id", "shape_id"]).size().reset_index(name="n")
best = tripcount.sort_values("n", ascending=False).drop_duplicates(["route_short_name", "direction_id"])
need = set(best.shape_id)
sh = sh[sh.shape_id.isin(need)].sort_values(["shape_id", "shape_pt_sequence"])
SH = {k: g[["shape_pt_lon", "shape_pt_lat"]].values.tolist() for k, g in sh.groupby("shape_id")}
t["nst"] = t.trip_id.map(st.groupby("trip_id").size())
rep = t[t.shape_id.isin(need)].sort_values("nst", ascending=False).drop_duplicates(["route_short_name", "direction_id", "shape_id"])
stseq = {k: g.sort_values("stop_sequence").sid.tolist() for k, g in st[st.trip_id.isin(set(rep.trip_id))].groupby("trip_id")}
TYPE = {"3": "bus", "2": "train", "4": "ferry", "0": "tram"}
routes = []; ridx = {}
info = t.drop_duplicates("route_short_name").set_index("route_short_name")
for name, grp in best.groupby("route_short_name"):
    i0 = info.loc[name]; dirs = []
    for _, b in grp.iterrows():
        tr = rep[(rep.route_short_name == name) & (rep.shape_id == b.shape_id) & (rep.direction_id == b.direction_id)]
        if not len(tr): continue
        tr = tr.iloc[0]
        dirs.append({"h": tr.trip_headsign if isinstance(tr.trip_headsign, str) else "", "p": enc(simplify(SH[b.shape_id])), "s": stseq.get(tr.trip_id, [])})
    ridx[name] = len(routes)
    routes.append({"n": name, "l": i0.route_long_name, "t": TYPE.get(i0.route_type, "bus"), "c": "#" + (i0.route_color if isinstance(i0.route_color, str) else "888888"),
                   "tc": "#" + (i0.route_text_color if isinstance(i0.route_text_color, str) else "FFFFFF"), "d": dirs})

sr = st[["trip_id", "sid"]].drop_duplicates().merge(t[["trip_id", "route_short_name"]], on="trip_id")[["sid", "route_short_name"]].drop_duplicates()
srm = sr.groupby("sid").route_short_name.apply(lambda x: sorted({ridx[v] for v in x if v in ridx})).to_dict()
ss = s[s.stop_id.isin(set(srm))].copy()
BWS = old.get("bwStations", {})
def kind(row):
    ty = {routes[i]["t"] for i in srm.get(row.stop_id, [])}
    for k in ("train", "ferry", "tram"):
        if k in ty: return k
    if row.stop_id in BWS: return "busway"
    return "busstn" if re.search(r"\bstation\b", row.stop_name, re.I) and str(row.location_type) == "1" else "bus"
ss["k"] = ss.apply(kind, axis=1)
ss["suburb"] = ss.stop_desc.fillna("").astype(str).str.rsplit(",", n=1).str[-1].str.strip()
ss.loc[ss.suburb.str.lower() == "nan", "suburb"] = ""
stops = {row.stop_id: [row.stop_name, round(row.stop_lat, 5), round(row.stop_lon, 5), row.k, row.suburb, srm[row.stop_id]] for row in ss.itertuples()}

sub = ss[ss.suburb != ""].groupby("suburb").agg(lat=("stop_lat", "median"), lon=("stop_lon", "median"), n=("stop_id", "size")).reset_index()
sub = sub[(sub.n >= 2) & (sub.suburb.str.len() > 2)]
pat = re.compile(r"^(.*?)\s+(?:stop\s+\w+\s+)?(?:at|near|opp|opposite|before|after|and|,|&)\b", re.I)
rows = []
for row in ss[ss.k == "bus"].itertuples():
    m = pat.match(row.stop_name); nm = (m.group(1) if m else row.stop_name).strip()
    nm = re.sub(r"\s+stop\s+\w+$", "", nm, flags=re.I)
    if len(nm) < 4 or re.search(r"\d{2,}", nm): continue
    rows.append((nm.title(), row.suburb, row.stop_lat, row.stop_lon))
stg = pd.DataFrame(rows, columns=["street", "suburb", "lat", "lon"]).groupby(["street", "suburb"]).agg(lat=("lat", "mean"), lon=("lon", "mean")).reset_index()

feed = ""
try:
    fi = rd("feed_info.txt", dtype=str)
    d = (fi.get("feed_start_date") if "feed_start_date" in fi else None)
    if d is not None and isinstance(d.iloc[0], str): feed = pd.to_datetime(d.iloc[0]).strftime("%-d %b %Y")
except Exception: pass
if not feed:
    import datetime; feed = datetime.date.today().strftime("%-d %b %Y")

kids = {}
for a, b in zip(s.stop_id, s.parent_station):
    if isinstance(b, str) and b in stops: kids.setdefault(b, []).append(a)

old["data"] = {"routes": routes, "stops": stops,
               "suburbs": [[a, round(b, 5), round(c, 5)] for a, b, c in zip(sub.suburb, sub.lat, sub.lon)],
               "streets": [[a, b, round(c, 5), round(d, 5)] for a, b, c, d in zip(stg.street, stg.suburb, stg.lat, stg.lon)],
               "feed": feed}
old["kids"] = kids
json.dump(old, open(NET, "w"), separators=(",", ":"))
print("routes", len(routes), dict(Counter(x["t"] for x in routes)), "stops", len(stops), dict(Counter(v[3] for v in stops.values())), "feed", feed)
