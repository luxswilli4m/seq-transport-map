"""Turn the peak-hour recordings into measured travel times for the map.

Usage: python3 tools/build_measured.py <raw_dir> <repo_dir> [--days 28]

<raw_dir> holds the files written by tools/collect_measured.py (peak-YYYY-MM-DD-am.csv.gz and so on). Only the
last --days days (a rolling four weeks by default) are used. Writes:

  data/measured/<route>.json  per direction ("0"/"1") and peak ("am"/"pm"):
      seg   {"A>B": [measured s, timetabled s, trips, p10 s, p90 s]}  from stop A to the next stop B (station ids as in data/rt)
      stop  {"A": [median lateness s, trips]}                          at stop A
      e2e   [[first stop, last stop, measured s, timetabled s, trips], ...]  the commonest whole runs
      trips number of trips recorded
  data/measured/index.json    every route, direction and peak with data, for the "Real time average" tab:
      [route, direction, peak, destination, trips, average s over timetable per stretch, commonest run measured s, timetabled s]
  data/measured/heat.json     each stretch between two stops, with how much longer than timetabled it takes
"""
import sys, os, re, csv, gzip, json, glob, math, argparse, datetime as dt
from collections import defaultdict
from statistics import median

ap = argparse.ArgumentParser()
ap.add_argument("raw"); ap.add_argument("repo"); ap.add_argument("--days", type=int, default=28)
a = ap.parse_args()
REPO = a.repo
OUT = os.path.join(REPO, "data/measured")
BNE = dt.timezone(dt.timedelta(hours=10))
safe = lambda k: re.sub(r"[^A-Za-z0-9_-]", "_", k)

today = dt.datetime.now(BNE).date()
first_day = today - dt.timedelta(days=a.days - 1)
files = []
for f in sorted(glob.glob(os.path.join(a.raw, "**", "peak-*.csv.gz"), recursive=True)):
    m = re.search(r"peak-(\d{4}-\d{2}-\d{2})-(am|pm)", os.path.basename(f))
    if m and dt.date.fromisoformat(m.group(1)) >= first_day: files.append((m.group(1), m.group(2), f))
# one file per day and peak (a re-run could leave two)
files = list({(d, b): f for d, b, f in files}.items())
print("files", len(files))
if not files:
    print("no recordings found; leaving data/measured as it is"); sys.exit(0)

net = json.load(open(os.path.join(REPO, "data/network.json")))
ST = net["data"]["stops"]; R = net["data"]["routes"]
cal = json.load(open(os.path.join(REPO, "data/tt/calendar.json")))
RT = {}
def rt(key):
    if key not in RT:
        p = os.path.join(REPO, "data/rt", safe(key) + ".json")
        RT[key] = json.load(open(p)) if os.path.exists(p) else None
    return RT[key]

# trip -> its readings
runs = defaultdict(list)
for (day, band), f in files:
    with gzip.open(f, "rt") as fi:
        for r in csv.DictReader(fi):
            runs[(band, r["key"], r["dir"], r["trip"], r["date"])].append((int(r["seq"]), r["stop"], int(r["sched"]), int(r["actual"])))

seg = defaultdict(list)      # (key, dir, band, a, b) -> [(measured, timetabled)]
late = defaultdict(list)     # (key, dir, band, c) -> [lateness]
e2e = defaultdict(list)      # (key, dir, band, first, last) -> [(measured, timetabled)]
ntrips = defaultdict(int)
days = defaultdict(set)
for (band, key, d, tid, date), obs in runs.items():
    obs.sort(); cols = []
    for seq, sid, sch, act in obs:
        if abs(act - sch) > 7200 or (cols and cols[-1][0] == sid): continue
        cols.append((sid, sch, act))
    if len(cols) < 2: continue
    ntrips[(key, d, band)] += 1; days[(key, d, band)].add(date)
    for c, sch, act in cols: late[(key, d, band, c)].append(act - sch)
    for (ca, sa, aa), (cb, sb, ab) in zip(cols, cols[1:]):
        m, s = ab - aa, sb - sa
        if m < 0 or s < 0 or m > 3 * s + 900: continue
        seg[(key, d, band, ca, cb)].append((m, s))
    (ca, sa, aa), (cb, sb, ab) = cols[0], cols[-1]
    if ab - aa >= 0: e2e[(key, d, band, ca, cb)].append((ab - aa, sb - sa))

def pct(v, q):
    v = sorted(v); i = (len(v) - 1) * q; lo = math.floor(i); hi = math.ceil(i)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)

out = defaultdict(lambda: defaultdict(dict))
for (key, d, band, ca, cb), v in seg.items():
    ms = [x[0] for x in v]
    out[key][d].setdefault(band, {"seg": {}, "stop": {}, "e2e": []})["seg"][f"{ca}>{cb}"] = [
        round(median(ms)), round(median(x[1] for x in v)), len(v), round(pct(ms, .1)), round(pct(ms, .9))]
for (key, d, band, c), v in late.items():
    out[key][d].setdefault(band, {"seg": {}, "stop": {}, "e2e": []})["stop"][c] = [round(median(v)), len(v)]
for (key, d, band, ca, cb), v in e2e.items():
    if len(v) < 2: continue
    out[key][d].setdefault(band, {"seg": {}, "stop": {}, "e2e": []})["e2e"].append(
        [ca, cb, round(median(x[0] for x in v)), round(median(x[1] for x in v)), len(v)])

os.makedirs(OUT, exist_ok=True)
for f in glob.glob(os.path.join(OUT, "*.json")): os.remove(f)
index = []
for key, dd in out.items():
    for d, bb in dd.items():
        for band, x in bb.items():
            # whole runs: of the runs covering most of the longest recorded run, the commonest first
            longest = max((e[3] for e in x["e2e"]), default=0)
            x["e2e"].sort(key=lambda e: (e[3] < 0.8 * longest, -e[4])); x["e2e"] = x["e2e"][:4]
            x["trips"] = ntrips[(key, d, band)]; x["days"] = len(days[(key, d, band)])
            t = (rt(key) or {}).get(d) or {}
            hs = cal["hs"][t["top"][0]] if t.get("top") else ""
            segs = x["seg"].values()
            tot_n = sum(s[2] for s in segs) or 1
            extra = sum((s[0] - s[1]) * s[2] for s in segs) / tot_n          # average seconds over timetable per stretch
            e = x["e2e"][0] if x["e2e"] else None
            index.append([key, d, band, hs, x["trips"], round(extra, 1), e[2] if e else None, e[3] if e else None])
    json.dump(dd, open(os.path.join(OUT, safe(key) + ".json"), "w"), separators=(",", ":"))
dates = sorted(d for d, _ in [k for k, _ in files])
meta = {"from": dates[0] if dates else None, "to": dates[-1] if dates else None, "files": len(files),
        "days": len(set(dates)), "window": a.days, "built": dt.datetime.now(BNE).strftime("%Y-%m-%d %H:%M")}
json.dump({"meta": meta, "v": sorted(index, key=lambda r: (r[0], r[2], r[1]))}, open(os.path.join(OUT, "index.json"), "w"), separators=(",", ":"))

# ---------------------------------------------------------------------------
# heat map: each stretch between two stops, all routes on it combined, drawn along the route's own path
def dec(s):
    p = []; i = lat = lng = 0
    while i < len(s):
        for k in range(2):
            sh = r = 0
            while True:
                b = ord(s[i]) - 63; i += 1; r |= (b & 31) << sh; sh += 5
                if b < 32: break
            v = ~(r >> 1) if r & 1 else r >> 1
            if k == 0: lat += v
            else: lng += v
        p.append((lng / 1e5, lat / 1e5))
    return p

def near(p, pt, lo):
    """index of the path point nearest pt, at or after lo"""
    cx = math.cos(math.radians(pt[1]))
    best = lo; bd = 1e18
    for i in range(lo, len(p)):
        dd = ((p[i][0] - pt[0]) * cx) ** 2 + (p[i][1] - pt[1]) ** 2
        if dd < bd: bd, best = dd, i
    return best

# combine routes per stop pair: weighted by trips
pair = defaultdict(lambda: {"am": [0, 0, 0], "pm": [0, 0, 0], "r": set()})   # band -> [sum extra*n, sum sched*n, n]
for key, dd in out.items():
    for d, bb in dd.items():
        for band, x in bb.items():
            for k, s in x["seg"].items():
                A, B = k.split(">")
                if A == B or A not in ST or B not in ST: continue
                p = pair[(A, B)]; p[band][0] += (s[0] - s[1]) * s[2]; p[band][1] += s[1] * s[2]; p[band][2] += s[2]; p["r"].add(key)

# geometry: from any route whose stop list has A then B next to each other
geo = {}
want = set(pair)
for ri, r in enumerate(R):
    for d in r["d"]:
        s = d["s"]; P = None; lo = 0
        for A, B in zip(s, s[1:]):
            if (A, B) not in want or (A, B) in geo: continue
            if P is None: P = dec(d["p"])
            ia = near(P, (ST[A][2], ST[A][1]), 0); ib = near(P, (ST[B][2], ST[B][1]), ia)
            if ib - ia < 400: geo[(A, B)] = [(ST[A][2], ST[A][1])] + P[ia + 1:ib] + [(ST[B][2], ST[B][1])]
def enc(pts):
    """the same polyline encoding network.json uses (lat, lng)"""
    out_ = []; plat = plng = 0
    for x, y in pts:
        la, ln = round(y * 1e5), round(x * 1e5)
        for v in (la - plat, ln - plng):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20: out_.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out_.append(chr(v + 63))
        plat, plng = la, ln
    return "".join(out_)
heat = []
for (A, B), p in pair.items():
    g = geo.get((A, B)) or [(ST[A][2], ST[A][1]), (ST[B][2], ST[B][1])]
    row = [A, B, enc(g)]
    for band in ("am", "pm"):
        sx, ss, n = p[band]
        row += [round(sx / n) if n else None, round(ss / n) if n else None, n]
    row.append(sorted(p["r"], key=lambda k: (len(k), k))[:12])
    heat.append(row)
json.dump({"meta": meta, "s": heat}, open(os.path.join(OUT, "heat.json"), "w"), separators=(",", ":"))
print("routes", len(out), "versions", len(index), "stretches", len(heat), "from", meta["from"], "to", meta["to"])
