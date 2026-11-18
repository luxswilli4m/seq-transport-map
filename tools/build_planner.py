#!/usr/bin/env python3
"""Build data/plan/<YYYYMMDD>.json: one compact timetable per day for "Best connections".

Usage: build_planner.py <gtfs_dir> <repo> [days]   (default 8 days from today, Brisbane time)

Each file lists stop keys (stations/stops as in data/network.json), and trip patterns:
  {"r": route index, "h": headsign index, "s": [stop indexes], "pl": [platform label index or -1],
   "t": [[first departure minute, minutes to next stop, ...], ...]   (trips sorted by first departure)}
"""
import sys, os, json, re, datetime
import pandas as pd
from collections import defaultdict

G, REPO = sys.argv[1], sys.argv[2]
DAYS = int(sys.argv[3]) if len(sys.argv) > 3 else 8
net = json.load(open(os.path.join(REPO, "data/network.json")))
R = net["data"]["routes"]; ST = net["data"]["stops"]
ridx = {r["n"]: i for i, r in enumerate(R)}
cal_tt = json.load(open(os.path.join(REPO, "data/tt/calendar.json")))
hs_index = {h: k for k, h in enumerate(cal_tt["hs"])}
pl_labels = cal_tt.get("pl", []); plid = cal_tt.get("plid", {})

routes = pd.read_csv(os.path.join(G, "routes.txt"), dtype=str)
trips = pd.read_csv(os.path.join(G, "trips.txt"), dtype=str).merge(routes[["route_id", "route_short_name"]], on="route_id")
trips = trips[trips.route_short_name.isin(ridx)]
stops = pd.read_csv(os.path.join(G, "stops.txt"), dtype=str, usecols=["stop_id", "parent_station"])
parent = {a: (b if isinstance(b, str) and b and b != "nan" else a) for a, b in zip(stops.stop_id, stops.parent_station)}
for c in net.get("detached", []): parent[c] = c

def mins(t): h, m, _ = t.split(":"); return int(h) * 60 + int(m)
st = pd.read_csv(os.path.join(G, "stop_times.txt"), dtype=str, usecols=["trip_id", "departure_time", "arrival_time", "stop_id", "stop_sequence"])
st = st[st.trip_id.isin(set(trips.trip_id))]
st["seq"] = st.stop_sequence.astype(int); st = st.sort_values(["trip_id", "seq"])
st["sid"] = st.stop_id.map(parent)
st["m"] = st.departure_time.fillna(st.arrival_time).map(mins)
tinfo = trips.set_index("trip_id")
pat_key = {}; trip_rows = {}
A_t, A_s, A_r, A_m = st.trip_id.tolist(), st.sid.tolist(), st.stop_id.tolist(), [int(x) for x in st.m.tolist()]
bounds = []; i = 0; n = len(A_t)
while i < n:
    j = i
    while j < n and A_t[j] == A_t[i]: j += 1
    bounds.append((i, j)); i = j
for i, j in bounds:
    tid = A_t[i]
    keep = [k for k in range(i, j) if A_s[k] in ST]
    sids = [A_s[k] for k in keep]
    if len(sids) < 2: continue
    m = [A_m[k] for k in keep]; raw = [A_r[k] for k in keep]
    t = tinfo.loc[tid]
    key = (int(ridx[t.route_short_name]), hs_index.get(t.trip_headsign if isinstance(t.trip_headsign, str) else "", 0), tuple(sids),
           tuple(int(plid.get(x, -1)) if x != parent.get(x) else -1 for x in raw))
    pat_key[tid] = key
    trip_rows[tid] = [m[0]] + [b - a for a, b in zip(m, m[1:])]
del st

cal = pd.read_csv(os.path.join(G, "calendar.txt"), dtype=str).set_index("service_id")
cd = pd.read_csv(os.path.join(G, "calendar_dates.txt"), dtype=str)
add = defaultdict(set); rem = defaultdict(set)
for s, d, e in zip(cd.service_id, cd.date, cd.exception_type): (add if e == "1" else rem)[d].add(s)
DOW = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
def active(day):
    ymd = day.strftime("%Y%m%d"); out = set(add[ymd])
    for s, row in cal.iterrows():
        if row.start_date <= ymd <= row.end_date and row[DOW[day.weekday()]] == "1" and s not in rem[ymd]: out.add(s)
    return out

odir = os.path.join(REPO, "data/plan"); os.makedirs(odir, exist_ok=True)
for f in os.listdir(odir): os.remove(os.path.join(odir, f))
today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=10)).date()
for k in range(-1, DAYS):
    day = today + datetime.timedelta(days=k); svc = active(day)
    tids = [t for t in trips.trip_id[trips.service_id.isin(svc)] if t in pat_key]
    pats = defaultdict(list)
    for t in tids: pats[pat_key[t]].append(trip_rows[t])
    keys = sorted({s for (_, _, ss, _) in pats for s in ss}); si = {s: i for i, s in enumerate(keys)}
    P = [{"r": r, "h": h, "s": [si[x] for x in ss], "pl": list(pl), "t": sorted(tl)} for (r, h, ss, pl), tl in pats.items()]
    out = {"day": day.strftime("%Y%m%d"), "s": keys, "p": P}
    fn = os.path.join(odir, day.strftime("%Y%m%d") + ".json")
    json.dump(out, open(fn, "w"), separators=(",", ":"))
    print(day, "trips", len(tids), "patterns", len(P), "KB", os.path.getsize(fn) // 1024)
# list of days on hand, for the date menu on the Best connections card
json.dump({"days": sorted(f[:8] for f in os.listdir(odir) if re.fullmatch(r"\d{8}\.json", f))}, open(os.path.join(odir, "index.json"), "w"))
