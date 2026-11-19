"""Record how long services actually take during the weekday peaks.

Polls Translink's live GTFS-RT feeds (TripUpdates and VehiclePositions) every 30 seconds through one peak
window and writes, for every trip and stop seen, the timetabled time and the time the service actually got
there. Run once per peak by .github/workflows/measure.yml; tools/build_measured.py turns four weeks of these
files into data/measured/.

Usage: python3 tools/collect_measured.py <repo_dir> --band am|pm --out raw.csv.gz [--gtfs gtfs_dir] [--minutes N]

The windows are Brisbane time on weekdays: AM 6:30-9:30, PM 3:30-6:30. Queensland public holidays and weekends
are skipped (the script exits without writing). School holidays are kept. Without --minutes the script waits for
the window to open and stops when it closes.
"""
import sys, os, io, csv, gzip, json, time, zipfile, argparse, datetime as dt
import requests
from google.transit import gtfs_realtime_pb2 as pb

BNE = dt.timezone(dt.timedelta(hours=10))
WINDOWS = {"am": ((6, 30), (9, 30)), "pm": ((15, 30), (18, 30))}
FEED = "https://gtfsrt.api.translink.com.au/api/realtime/SEQ/"
GTFS_URL = "https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip"
TLINE_BY_COLOUR = {"27855A": "T1", "6CC6E9": "T2", "9B60A6": "T3", "4778B2": "T4", "FFC425": "T5", "D53E45": "T6"}
POLL = 30          # seconds between polls
FRESH = 120        # a stop's last prediction counts only if it was made within this many seconds of the time itself


def peak_day(d):
    import holidays
    return d.weekday() < 5 and d not in holidays.Australia(subdiv="QLD", years=d.year)


def read_csv(z, name, cols):
    with z.open(name) as f:
        r = csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))
        for row in r:
            yield [row.get(c, "") for c in cols]


def lookups(repo, gtfs):
    """trip_id -> (route key, direction) and stop_id -> parent station, with the same keys as data/rt."""
    net = json.load(open(os.path.join(repo, "data/network.json")))
    R = net["data"]["routes"]
    byname = {r["n"]: r for r in R}

    def key(name):
        r = byname[name]
        return TLINE_BY_COLOUR.get(r["c"].lstrip("#").upper(), "T1") if r["t"] == "train" else name

    if gtfs and os.path.isdir(gtfs):
        class Z:
            def open(self, n): return open(os.path.join(gtfs, n), "rb")
        z = Z()
    else:
        print("downloading GTFS", flush=True)
        data = requests.get(GTFS_URL, timeout=300).content
        z = zipfile.ZipFile(io.BytesIO(data))
    rname = {rid: sn for rid, sn in read_csv(z, "routes.txt", ["route_id", "route_short_name"])}
    trips = {}
    for tid, rid, d in read_csv(z, "trips.txt", ["trip_id", "route_id", "direction_id"]):
        sn = rname.get(rid)
        if sn in byname: trips[tid] = (key(sn), d or "0")
    parent = {}
    for sid, ps in read_csv(z, "stops.txt", ["stop_id", "parent_station"]):
        parent[sid] = ps or sid
    for c in net.get("detached", []): parent[c] = c
    return trips, parent


def fetch(name):
    for a in range(3):
        try:
            r = requests.get(FEED + name, timeout=40)
            r.raise_for_status()
            f = pb.FeedMessage(); f.ParseFromString(r.content)
            return f
        except Exception as e:
            print("fetch", name, "failed:", e, flush=True); time.sleep(5)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo"); ap.add_argument("--band", required=True, choices=WINDOWS)
    ap.add_argument("--out", required=True); ap.add_argument("--gtfs"); ap.add_argument("--minutes", type=float)
    a = ap.parse_args()

    now = dt.datetime.now(BNE)
    (h0, m0), (h1, m1) = WINDOWS[a.band]
    start = now.replace(hour=h0, minute=m0, second=0, microsecond=0)
    end = now.replace(hour=h1, minute=m1, second=0, microsecond=0)
    if a.minutes:          # test run: collect from now for a few minutes
        start, end = now, now + dt.timedelta(minutes=a.minutes)
    elif not peak_day(now.date()):
        print(now.date(), "is not a weekday peak day (weekend or Queensland public holiday); nothing to collect")
        return
    elif now >= end:
        print("the", a.band.upper(), "peak has already finished today"); return

    trips, parent = lookups(a.repo, a.gtfs)
    print("trips", len(trips), "stops", len(parent), flush=True)
    if now < start - dt.timedelta(minutes=2):
        print("waiting until", start.strftime("%H:%M"), flush=True)
        time.sleep((start - now).total_seconds() - 60)

    t0, t1 = start.timestamp(), end.timestamp()
    tu_rec = {}   # (trip, date) -> {seq: [stop, sched, actual, seen]}
    vp_rec = {}   # (trip, date, stop) -> first time seen stopped there
    polls = 0
    # keep going a few minutes past the window so stops reached just before it closes get their final reading
    while time.time() < t1 + 300:
        tick = time.time()
        f = fetch("TripUpdates")
        if f:
            ts = f.header.timestamp or tick
            for e in f.entity:
                if not e.HasField("trip_update"): continue
                t = e.trip_update; tid = t.trip.trip_id
                if tid not in trips or t.trip.schedule_relationship == 3: continue
                rec = tu_rec.setdefault((tid, t.trip.start_date), {})
                for u in t.stop_time_update:
                    if u.schedule_relationship == 1: continue          # stop skipped
                    ev = u.departure if u.HasField("departure") and u.departure.time else u.arrival
                    if not ev.time: continue
                    r = rec.get(u.stop_sequence)
                    sched = ev.time - ev.delay if ev.HasField("delay") else (r[1] if r else None)
                    if sched is None: continue
                    rec[u.stop_sequence] = [u.stop_id, sched, ev.time, ts]
        v = fetch("VehiclePositions")
        if v:
            for e in v.entity:
                if not e.HasField("vehicle"): continue
                x = e.vehicle
                if x.current_status != 1 or not x.stop_id or x.trip.trip_id not in trips: continue
                k = (x.trip.trip_id, x.trip.start_date, x.stop_id)
                vp_rec.setdefault(k, x.timestamp or int(tick))
        polls += 1
        if polls % 20 == 0: print(dt.datetime.now(BNE).strftime("%H:%M"), "polls", polls, "trips", len(tu_rec), flush=True)
        time.sleep(max(1, POLL - (time.time() - tick)))

    rows = 0
    with gzip.open(a.out, "wt", newline="") as fo:
        w = csv.writer(fo)
        w.writerow(["band", "key", "dir", "trip", "date", "seq", "stop", "sched", "actual", "src"])
        for (tid, date), rec in tu_rec.items():
            k, d = trips[tid]
            for seq in sorted(rec):
                sid, sched, act, seen = rec[seq]
                vt = vp_rec.get((tid, date, sid))
                if act - seen <= FRESH: src = "tu"
                elif vt: act, src = vt, "vp"
                else: continue                                     # the last reading was a forecast, not a sighting
                if not (t0 <= act <= t1): continue
                w.writerow([a.band, k, d, tid, date, seq, parent.get(sid, sid), sched, act, src]); rows += 1
    print("polls", polls, "trips", len(tu_rec), "rows", rows, "->", a.out)


if __name__ == "__main__":
    main()
