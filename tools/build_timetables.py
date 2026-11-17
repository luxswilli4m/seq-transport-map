"""Build per-area timetable files for the map from a Translink GTFS folder.

Usage: python3 tools/build_timetables.py <gtfs_dir> <repo_dir>
Writes data/tt/calendar.json and data/tt/<tile>.json (stops grouped into ~5 km tiles).
"""
import sys, os, json, math
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
groups = defaultdict(list)  # (stop, ri, hi, si) -> [minutes]
for chunk in pd.read_csv(os.path.join(G, "stop_times.txt"), dtype=str, usecols=["trip_id", "departure_time", "stop_id", "stop_sequence", "pickup_type"], chunksize=2_000_000):
    chunk = chunk[chunk.trip_id.isin(tinfo.index)]
    chunk = chunk[chunk.pickup_type.fillna("0") != "1"]  # skip set-down-only stops
    chunk = chunk.join(tinfo, on="trip_id")
    chunk = chunk[chunk.stop_sequence.astype(int) != chunk.trip_id.map(last_seq)]
    chunk["sid"] = chunk.stop_id.map(parent)
    for sid, ri, hi, si, dep in zip(chunk.sid, chunk.ri, chunk.hi, chunk.si, chunk.departure_time):
        if sid in ST:
            groups[(sid, int(ri), int(hi), int(si))].append(mins(dep))

tiles = defaultdict(dict)
def tile_of(s): return f"{math.floor(s[1]*20)}_{math.floor(s[2]*20)}"
for (sid, ri, hi, si), times in groups.items():
    times = sorted(set(times))
    deltas = [times[0]] + [b - a for a, b in zip(times, times[1:])]
    tiles[tile_of(ST[sid])].setdefault(sid, []).append([ri, hi, si] + deltas)

odir = os.path.join(OUT, "data/tt"); os.makedirs(odir, exist_ok=True)
for f in os.listdir(odir): os.remove(os.path.join(odir, f))
total = 0
for t, d in tiles.items():
    s = json.dumps(d, separators=(",", ":")); total += len(s)
    open(os.path.join(odir, t + ".json"), "w").write(s)
json.dump({"svc": svc, "hs": headsigns}, open(os.path.join(odir, "calendar.json"), "w"), separators=(",", ":"))
print("tiles", len(tiles), "MB", round(total / 1e6, 1), "services", len(svc), "headsigns", len(headsigns))
