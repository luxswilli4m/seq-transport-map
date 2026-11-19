"""Turn the AM and PM recordings into measured travel times for the map.

Usage: python3 tools/build_measured.py <raw_dir> <state_dir> <repo_dir>

<raw_dir>   recordings from tools/collect_measured.py (peak-YYYY-MM-DD-am.csv.gz ...), at least the last 40 days
<state_dir> the previous build of data/measured (from the "measured-data" release), so that saved days, months
            and the all-time figures carry over; may be empty
Writes <repo_dir>/data/measured/.

Each day is one of four kinds: t = school-term weekday, s = school-holiday weekday (including student-free days),
w = weekend, p = public holiday (Queensland, with the Brisbane Ekka; checked first). School holidays come from
tools/qld_days.json (tools/build_school_days.py), public holidays from that file and the Python holidays package.

A "piece" is the figures for a set of days, for every route:
  {route: {direction: {"am"|"pm": {"seg": {"A>B": [measured s, timetabled s, trips, p10 s, p90 s]},
                                    "stop": {"A": [median lateness s, trips]},
                                    "e2e": [[first stop, last stop, measured s, timetabled s, runs], ...],
                                    "trips": n, "days": n}}}}
Pieces from recordings are exact medians. Pieces combined from other pieces (all time, and in the browser any mix
of kinds of day, months or days) are weighted by trips: close to the true median, but not exact.

Files (gzipped .json.gz except meta.json and the route-card files; the browser unzips them):
  day/YYYY-MM-DD.json      one day (kept for 12 months; for "specific days")
  month/YYYY-MM-<k>.json   one calendar month, kind of day k (kept for 12 months; the current month so far)
  live/<k>.json            the past 7 days
  w4/<k>.json              the past 4 weeks (28 days)
  all/<k>.json             every finished month since recording began, combined (kept for good)
  heatgeo.json             the path of each stretch between two stops, for the heat map
  meta.json                what exists, date ranges, destinations
  <route>.json, index.json the past 4 weeks on school-term and school-holiday weekdays, for the Measured column
                           on route cards (same format as before)
"""
import sys, os, re, csv, gzip, json, glob, math, shutil, datetime as dt
from collections import defaultdict
from statistics import median

RAW, STATE, REPO = sys.argv[1:4]
OUT = os.path.join(REPO, "data/measured")
BNE = dt.timezone(dt.timedelta(hours=10))
KINDS = "tswp"
KEEP_DAYS = 366                      # day and month files kept for 12 months
safe = lambda k: re.sub(r"[^A-Za-z0-9_-]", "_", k)
today = dt.datetime.now(BNE).date()

# ---------------------------------------------------------------- kinds of day
import holidays
QD = {}
try: QD = json.load(open(os.path.join(REPO, "tools/qld_days.json")))
except Exception: pass
SH = [(dt.date.fromisoformat(a), dt.date.fromisoformat(b)) for a, b in QD.get("sh", [])]
PH = set(QD.get("ph", {}))
def kind(d):
    if d.isoformat() in PH or d in holidays.Australia(subdiv="QLD", years=d.year): return "p"
    if d.weekday() >= 5: return "w"
    if any(a <= d <= b for a, b in SH): return "s"
    return "t"

# ---------------------------------------------------------------- recordings
files = {}
for f in glob.glob(os.path.join(RAW, "**", "peak-*.csv.gz"), recursive=True):
    m = re.search(r"peak-(\d{4}-\d{2}-\d{2})-(am|pm)", os.path.basename(f))
    if m: files[(m.group(1), m.group(2))] = f
days_raw = sorted({d for d, _ in files})
print("recordings", len(files), "days", len(days_raw), days_raw[:1], days_raw[-1:])

_rows = {}
def rows_for(day):
    """{(band, key, dir, trip, date): [(seq, stop, sched, actual)]} for one day"""
    if day in _rows: return _rows[day]
    runs = defaultdict(list)
    for band in ("am", "pm"):
        f = files.get((day, band))
        if not f: continue
        with gzip.open(f, "rt") as fi:
            for r in csv.DictReader(fi):
                runs[(band, r["key"], r["dir"], r["trip"], r["date"])].append((int(r["seq"]), r["stop"], int(r["sched"]), int(r["actual"])))
    _rows[day] = runs
    return runs

def pct(v, q):
    v = sorted(v); i = (len(v) - 1) * q; lo = math.floor(i); hi = math.ceil(i)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)

def trim_e2e(L):
    """whole runs: of the runs covering most of the longest one, the commonest first"""
    longest = max((e[3] for e in L), default=0)
    return sorted(L, key=lambda e: (e[3] < 0.8 * longest, -e[4]))[:4]

def piece(days):
    """exact figures for a set of days, from the recordings"""
    seg = defaultdict(list); late = defaultdict(list); e2e = defaultdict(list); ntrips = defaultdict(int); ndays = defaultdict(set)
    for day in days:
        for (band, key, d, tid, date), obs in rows_for(day).items():
            obs = sorted(obs); cols = []; seqs = []
            for seq, sid, sch, act in obs:
                if abs(act - sch) > 7200 or (cols and cols[-1][0] == sid): continue
                cols.append((sid, sch, act)); seqs.append(seq)
            if len(cols) < 2: continue
            g = (key, d, band); ntrips[g] += 1; ndays[g].add(day)
            for c, sch, act in cols: late[g + (c,)].append(act - sch)
            for i, ((ca, sa, aa), (cb, sb, ab)) in enumerate(zip(cols, cols[1:])):
                # only stops next to each other on the trip: if the live feed missed the stops in between,
                # the time across the gap can't be split between them, so that part of the trip is left out
                if seqs[i + 1] != seqs[i] + 1: continue
                m, s = ab - aa, sb - sa
                if m < 0 or s < 0 or m > 3 * s + 900: continue
                seg[g + (ca + ">" + cb,)].append((m, s))
            (ca, sa, aa), (cb, sb, ab) = cols[0], cols[-1]
            if ab - aa >= 0: e2e[g + (ca, cb)].append((ab - aa, sb - sa))
    out = {}
    def slot(g):
        k, d, b = g
        return out.setdefault(k, {}).setdefault(d, {}).setdefault(b, {"seg": {}, "stop": {}, "e2e": [], "trips": ntrips[g], "days": len(ndays[g])})
    for g in ntrips: slot(g)
    for (k, d, b, ab), v in seg.items():
        ms = [x[0] for x in v]
        slot((k, d, b))["seg"][ab] = [round(median(ms)), round(median(x[1] for x in v)), len(v), round(pct(ms, .1)), round(pct(ms, .9))]
    for (k, d, b, c), v in late.items():
        slot((k, d, b))["stop"][c] = [round(median(v)), len(v)]
    for (k, d, b, ca, cb), v in e2e.items():
        if len(v) >= 2: slot((k, d, b))["e2e"].append([ca, cb, round(median(x[0] for x in v)), round(median(x[1] for x in v)), len(v)])
    for k in out:
        for d in out[k]:
            for b, x in out[k][d].items(): x["e2e"] = trim_e2e(x["e2e"])
    return out

def combine(pieces):
    """weighted by trips (the browser does the same in js/app.js mCombine)"""
    acc = {}
    for P in pieces:
        for k, dd in (P or {}).items():
            for d, bb in dd.items():
                for b, x in bb.items():
                    a = acc.setdefault(k, {}).setdefault(d, {}).setdefault(b, {"seg": {}, "stop": {}, "e2e": {}, "trips": 0, "days": 0})
                    a["trips"] += x["trips"]; a["days"] += x["days"]
                    for ab, s in x["seg"].items():
                        t = a["seg"].setdefault(ab, [0, 0, 0, 0, 0])
                        for i in (0, 1, 3, 4): t[i] += s[i] * s[2]
                        t[2] += s[2]
                    for c, s in x["stop"].items():
                        t = a["stop"].setdefault(c, [0, 0]); t[0] += s[0] * s[1]; t[1] += s[1]
                    for e in x["e2e"]:
                        t = a["e2e"].setdefault((e[0], e[1]), [0, 0, 0]); t[0] += e[2] * e[4]; t[1] += e[3] * e[4]; t[2] += e[4]
    for k, dd in acc.items():
        for d, bb in dd.items():
            for b, a in bb.items():
                a["seg"] = {ab: [round(t[0] / t[2]), round(t[1] / t[2]), t[2], round(t[3] / t[2]), round(t[4] / t[2])] for ab, t in a["seg"].items() if t[2]}
                a["stop"] = {c: [round(t[0] / t[1]), t[1]] for c, t in a["stop"].items() if t[1]}
                a["e2e"] = trim_e2e([[ca, cb, round(t[0] / t[2]), round(t[1] / t[2]), t[2]] for (ca, cb), t in a["e2e"].items() if t[2]])
    return acc

def dump(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if path.endswith(".gz"):
        with gzip.open(path, "wt", compresslevel=9) as f: json.dump(obj, f, separators=(",", ":"))
    else: json.dump(obj, open(path, "w"), separators=(",", ":"))

def load(path):
    try:
        if path.endswith(".gz"):
            with gzip.open(path, "rt") as f: return json.load(f)
        return json.load(open(path))
    except Exception: return None

# ---------------------------------------------------------------- start from the previous build
if os.path.isdir(OUT): shutil.rmtree(OUT)
os.makedirs(OUT)
for sub in ("day", "month", "all"):
    if os.path.isdir(os.path.join(STATE, sub)): shutil.copytree(os.path.join(STATE, sub), os.path.join(OUT, sub))
for f in ("heatgeo.json.gz", "meta.json"):
    if os.path.exists(os.path.join(STATE, f)): shutil.copy(os.path.join(STATE, f), os.path.join(OUT, f))
meta = load(os.path.join(OUT, "meta.json")) or {}
meta.setdefault("days", {}); meta.setdefault("months", {}); meta.setdefault("all", {"months": []})
if not files and not meta["days"]:
    print("no recordings and nothing saved yet"); dump(meta, os.path.join(OUT, "meta.json")); sys.exit(0)

# days: (re)build every day we have recordings for (a day gains its PM recording later in the day)
for day in days_raw:
    dump(piece([day]), os.path.join(OUT, "day", day + ".json.gz"))
    meta["days"][day] = kind(dt.date.fromisoformat(day))

# months: rebuild each month by kind of day, when the recordings here still cover every recorded day of it
by_month = defaultdict(list)
for day in meta["days"]: by_month[day[:7]].append(day)
for mon, ds in sorted(by_month.items()):
    first = dt.date.fromisoformat(mon + "-01")
    nxt = (first.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    if not all(d in days_raw for d in ds):
        continue                                                   # some of its recordings have expired: keep the saved month
    kinds = {}
    for k in KINDS:
        for f in glob.glob(os.path.join(OUT, "month", f"{mon}-{k}.json.gz")): os.remove(f)
        kd = [d for d in ds if meta["days"][d] == k]
        if kd:
            dump(piece(kd), os.path.join(OUT, "month", f"{mon}-{k}.json.gz")); kinds[k] = len(kd)
    meta["months"][mon] = {"kinds": kinds, "days": len(ds), "from": min(ds), "to": max(ds), "final": today >= nxt}

# all time: add each finished month once
for mon, info in sorted(meta["months"].items()):
    if not info.get("final") or mon in meta["all"]["months"]: continue
    for k in KINDS:
        p = os.path.join(OUT, "month", f"{mon}-{k}.json.gz")
        if not os.path.exists(p): continue
        dump(combine([load(os.path.join(OUT, "all", k + ".json.gz")), load(p)]), os.path.join(OUT, "all", k + ".json.gz"))
    meta["all"]["months"].append(mon)
    meta["all"].setdefault("from", info["from"]); meta["all"]["to"] = info["to"]

# live (7 days) and last 4 weeks (28 days), by kind of day
for name, n in (("live", 7), ("w4", 28)):
    lo = (today - dt.timedelta(days=n - 1)).isoformat()
    ds = [d for d in days_raw if d >= lo]
    meta[name] = {"from": min(ds) if ds else None, "to": max(ds) if ds else None, "kinds": {}}
    for k in KINDS:
        kd = [d for d in ds if meta["days"][d] == k]
        if kd: dump(piece(kd), os.path.join(OUT, name, k + ".json.gz")); meta[name]["kinds"][k] = len(kd)

# drop days and months older than 12 months (all time keeps them)
cut = (today - dt.timedelta(days=KEEP_DAYS)).isoformat()
for d in [d for d in meta["days"] if d < cut]:
    meta["days"].pop(d)
    try: os.remove(os.path.join(OUT, "day", d + ".json.gz"))
    except FileNotFoundError: pass
for mon in [m for m in meta["months"] if m + "-31" < cut]:
    meta["months"].pop(mon)
    for f in glob.glob(os.path.join(OUT, "month", mon + "-*.json.gz")): os.remove(f)

# ---------------------------------------------------------------- route cards: past 4 weeks, weekdays
cal = json.load(open(os.path.join(REPO, "data/tt/calendar.json")))
def rt(key):
    p = os.path.join(REPO, "data/rt", safe(key) + ".json")
    return load(p) if os.path.exists(p) else None
lo = (today - dt.timedelta(days=27)).isoformat()
cd = sorted(d for d in days_raw if d >= lo and meta["days"][d] in "ts")
card = piece(cd)
index = []; hs = {}
def heads(key):
    t = rt(key) or {}
    return {d: (cal["hs"][t[d]["top"][0]] if t[d].get("top") else "") for d in t}
for key, dd in card.items():
    hs[key] = heads(key)
    for d, bb in dd.items():
        for band, x in bb.items():
            segs = x["seg"].values(); n = sum(s[2] for s in segs) or 1
            e = x["e2e"][0] if x["e2e"] else None
            index.append([key, d, band, hs[key].get(d, ""), x["trips"], round(sum((s[0] - s[1]) * s[2] for s in segs) / n, 1), e[2] if e else None, e[3] if e else None])
    dump(dd, os.path.join(OUT, safe(key) + ".json"))
built = dt.datetime.now(BNE).strftime("%Y-%m-%d %H:%M")
dump({"meta": {"from": cd[0] if cd else None, "to": cd[-1] if cd else None, "days": len(cd), "window": 28, "built": built},
      "v": sorted(index, key=lambda r: (r[0], r[2], r[1]))}, os.path.join(OUT, "index.json"))

# destinations for every route recorded (labels in the Real time average list)
seen = set()
for p in glob.glob(os.path.join(OUT, "*", "*.json.gz")):
    if "/day/" in p: continue
    seen.update((load(p) or {}).keys())
if meta["days"]: seen.update(load(os.path.join(OUT, "day", max(meta["days"]) + ".json.gz")) or {})
meta["hs"] = {**meta.get("hs", {}), **hs, **{k: heads(k) for k in seen if k not in hs and k not in meta.get("hs", {})}}

# ---------------------------------------------------------------- heat map paths for every stretch seen
geo = load(os.path.join(OUT, "heatgeo.json.gz")) or {}
net = json.load(open(os.path.join(REPO, "data/network.json")))
ST = net["data"]["stops"]; R = net["data"]["routes"]
want = set()
for p in [os.path.join(OUT, "day", d + ".json.gz") for d in days_raw] + glob.glob(os.path.join(OUT, "all", "*.json.gz")):
    for dd in (load(p) or {}).values():
        for bb in dd.values():
            for x in bb.values(): want.update(ab for ab in x["seg"] if ab not in geo)
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
def enc(pts):
    o = []; plat = plng = 0
    for x, y in pts:
        la, ln = round(y * 1e5), round(x * 1e5)
        for v in (la - plat, ln - plng):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20: o.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            o.append(chr(v + 63))
        plat, plng = la, ln
    return "".join(o)
def near(p, pt, lo):
    cx = math.cos(math.radians(pt[1])); best = lo; bd = 1e18
    for i in range(lo, len(p)):
        dd = ((p[i][0] - pt[0]) * cx) ** 2 + (p[i][1] - pt[1]) ** 2
        if dd < bd: bd, best = dd, i
    return best
if want:
    for r in R:
        for d in r["d"]:
            s = d["s"]; P = None
            for A, B in zip(s, s[1:]):
                ab = A + ">" + B
                if ab not in want or ab in geo or A not in ST or B not in ST: continue
                if P is None: P = dec(d["p"])
                ia = near(P, (ST[A][2], ST[A][1]), 0); ib = near(P, (ST[B][2], ST[B][1]), ia)
                if ib - ia < 400: geo[ab] = enc([(ST[A][2], ST[A][1])] + P[ia + 1:ib] + [(ST[B][2], ST[B][1])])
    for ab in want:
        if ab in geo: continue
        A, B = ab.split(">")
        if A in ST and B in ST and A != B: geo[ab] = enc([(ST[A][2], ST[A][1]), (ST[B][2], ST[B][1])])
dump(geo, os.path.join(OUT, "heatgeo.json.gz"))

meta["built"] = built; meta["first"] = min(meta["days"]) if meta["days"] else None
meta["days"] = dict(sorted(meta["days"].items())); meta["months"] = dict(sorted(meta["months"].items()))
dump(meta, os.path.join(OUT, "meta.json"))
size = sum(os.path.getsize(p) for p in glob.glob(os.path.join(OUT, "**", "*.json*"), recursive=True))
print("days", len(meta["days"]), "months", len(meta["months"]), "all-time months", len(meta["all"]["months"]),
      "card routes", len(card), "stretch paths", len(geo), "MB", round(size / 1e6, 1))
