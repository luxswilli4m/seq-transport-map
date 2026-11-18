#!/usr/bin/env python3
"""Build data/ondemand.json: Translink on-demand service areas and key destinations.

Usage: build_ondemand.py <gtfs_dir> <repo>

Reads Translink's on-demand web pages, downloads the map files (KML) they link to,
and reads Logan's destinations table. Destinations without their own map file are
pinned automatically when their name confidently matches a Translink stop or a named
place in the base map (tiles/seq.pmtiles); the rest are listed as "not marked on map".

Areas are configured in tools/ondemand.json. If a page or file can't be read, the
previous data/ondemand.json is kept and a message is added to zone_check.txt (the
weekly refresh turns that into a GitHub issue).
"""
import sys, os, re, json, csv, math, gzip, html, subprocess, datetime, urllib.parse
import xml.etree.ElementTree as ET

GTFS, REPO = sys.argv[1], sys.argv[2]
CFG = json.load(open(os.path.join(REPO, "tools", "ondemand.json")))
_AUTO = os.path.join(REPO, "tools", "ondemand_auto.json")
if os.path.exists(_AUTO):   # services added automatically by tools/discover_ondemand.py
    CFG["areas"] = CFG["areas"] + json.load(open(_AUTO)).get("areas", [])
OUT = os.path.join(REPO, "data", "ondemand.json")
BASE = "https://translink.com.au"
problems = []


def fetch(url):
    r = subprocess.run(["curl", "-sSL", "-m", "60", "--fail", "-A", "Mozilla/5.0 seq-transport-map", url],
                       capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"could not download {url}")
    return r.stdout


def kml_links(page_html):
    return sorted(set(urllib.parse.urljoin(BASE, h) for h in re.findall(r'href="([^"]+\.km[lz])"', page_html, re.I)))


def parse_kml(data):
    """Return list of (name, kind, coords) where kind is 'poly' or 'pt'."""
    s = data.decode("utf-8", "replace")
    s = re.sub(r'xmlns(:\w+)?="[^"]*"', "", s)
    s = re.sub(r"<(/?)\w+:", r"<\1", s)
    root = ET.fromstring(s.encode())
    out = []
    for pm in root.iter("Placemark"):
        nm = (pm.findtext("name") or "").strip()
        for poly in pm.iter("Polygon"):
            ring = poly.find(".//outerBoundaryIs//coordinates")
            if ring is not None:
                pts = [[round(float(a), 5), round(float(b), 5)] for a, b, *_ in
                       (c.split(",") for c in ring.text.split())]
                out.append((nm, "poly", pts))
        for pt in pm.iter("Point"):
            c = pt.findtext("coordinates").strip().split(",")
            out.append((nm, "pt", [round(float(c[0]), 5), round(float(c[1]), 5)]))
    return out


def table_rows(page_html):
    """Logan-style table: each row = (list of suburbs, list of destinations)."""
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", page_html, re.S):
        tds = re.findall(r"<td>(.*?)</td>", tr, re.S)
        if len(tds) == 2:
            li = lambda t: [html.unescape(re.sub(r"<[^>]+>", "", x)).strip() for x in re.findall(r"<li>(.*?)</li>", t, re.S)]
            rows.append((li(tds[0]), li(tds[1])))
    return rows


# ---------- automatic place matching
GENERIC = {"shopping", "centre", "center", "station", "bus", "train", "busway", "the", "and", "of", "stop", "platform"}


def toks(s):
    s = s.lower().replace("'n'", "n").replace("&", " and ")
    return [t for t in re.split(r"[^a-z0-9]+", s) if t]


def dist(a, b):
    kx = 111.32 * math.cos(math.radians(b[1]))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110.57)


def centroid(pts):
    return [round(sum(p[0] for p in pts) / len(pts), 5), round(sum(p[1] for p in pts) / len(pts), 5)]


STOP_LL = {}


def load_stops():
    out = []
    with open(os.path.join(GTFS, "stops.txt"), encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            ll = [float(r["stop_lon"]), float(r["stop_lat"])]
            out.append((r["stop_name"], ll))
            STOP_LL[r["stop_id"]] = ll
            if r.get("stop_code"):
                STOP_LL.setdefault(r["stop_code"], ll)
    return out


def dest_pin(d, stops, pois, near):
    """A destination is a name (matched automatically) or {"n": name, "stops": [stop ids Translink gives]}."""
    if isinstance(d, dict):
        lls = [STOP_LL[s] for s in d.get("stops", []) if s in STOP_LL]
        if lls:
            return {"n": d["n"], "ll": [round(sum(p[0] for p in lls) / len(lls), 6), round(sum(p[1] for p in lls) / len(lls), 6)]}
        if d.get("stops"):
            problems.append(f"{d['n']}: stop {', '.join(d['stops'])} isn't in Translink's stop list any more.")
        return {"n": d["n"], "ll": match(d["n"], stops, pois, near)}
    return {"n": d, "ll": match(d, stops, pois, near)}


def load_pois(bbox):
    try:
        from pmtiles.reader import Reader, MmapSource
        import mapbox_vector_tile
    except ImportError:
        print("pmtiles/mapbox-vector-tile not installed: base-map places skipped")
        return []
    z = 14
    n = 2 ** z
    def tx(lon): return int((lon + 180) / 360 * n)
    def ty(lat):
        r = math.radians(lat)
        return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)
    rd = Reader(MmapSource(open(os.path.join(REPO, "tiles", "seq.pmtiles"), "rb")))
    out = []
    for x in range(tx(bbox[0]), tx(bbox[2]) + 1):
        for y in range(ty(bbox[3]), ty(bbox[1]) + 1):
            d = rd.get(z, x, y)
            if not d:
                continue
            try:
                d = gzip.decompress(d)
            except OSError:
                pass
            t = mapbox_vector_tile.decode(d)
            lay = t.get("pois")
            if not lay:
                continue
            ext = lay.get("extent", 4096)
            for f in lay["features"]:
                nm = f["properties"].get("name")
                g = f["geometry"]
                if not nm or g["type"] != "Point":
                    continue
                px, py = g["coordinates"]
                lon = (x + px / ext) / n * 360 - 180
                lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1 - py / ext) / n))))
                out.append((nm, [lon, lat]))
    return out


def match(dest, stops, pois, near):
    """Return [lon,lat] if the destination confidently matches, else None."""
    dt = toks(dest)
    key = [t for t in dt if t not in GENERIC]
    if not key:
        return None
    is_stn = "station" in dt or ("park" in dt and "ride" in dt)
    hits = []
    if is_stn:
        phrase = " ".join(key)
        for nm, ll in stops:
            ct = toks(nm)
            head = " ".join(t for t in ct[:len(key) + 2] if t not in GENERIC)
            # e.g. "Browns Plains station, stop 3A"  /  "Greenbank RSL park 'n' ride"
            if (" ".join(ct).startswith(phrase) and ("station" in ct or "ride" in ct)) and head.startswith(phrase):
                hits.append(ll)
    else:
        for nm, ll in pois + stops:
            ct = set(toks(nm))
            if all(k in ct for k in key):
                hits.append(ll)
    hits = [h for h in hits if dist(h, near) < 12]
    if not hits:
        return None
    c = centroid(hits)
    if max(dist(h, c) for h in hits) > 0.5:   # matches spread out: ambiguous, don't guess
        return None
    return c


# ---------- build
try:
    stops = load_stops()
    areas = []
    TRACED = json.load(open(os.path.join(REPO, "tools", "ondemand_traced.json")))
    for a in CFG["areas"]:
        if a.get("traced"):
            # shapes traced from Translink's map pictures (tools/ondemand_traced.json); pins matched by name
            groups = []
            for g in a["groups"]:
                z = TRACED[g["zone"]]
                b = [min(p[0] for p in z) - 0.08, min(p[1] for p in z) - 0.08, max(p[0] for p in z) + 0.08, max(p[1] for p in z) + 0.08]
                pois = load_pois(b)
                groups.append({"name": g["name"], "zones": [z], "hours": g.get("hours"),
                               "dests": [dest_pin(d, stops, pois, centroid(z)) for d in g["dests"]]})
            out = {k: a[k] for k in ("id", "name", "page", "how")}
            out.update({"groups": groups, "traced": True, "dlabel": "Key locations"})
            if a.get("auto"):
                out["auto"] = True
            if a.get("starts"):
                out["starts"] = a["starts"]
            areas.append(out)
            print(f"{a['name']}: traced, {len(groups)} groups")
            for g in groups:
                for d in g["dests"]:
                    print(f"   {'pin ' if d['ll'] else '----'} {d['n']}")
            continue
        page = fetch(BASE + a["map_page"]).decode("utf-8", "replace")
        feats = []
        for u in kml_links(page):
            feats += parse_kml(fetch(u))
        polys = [(n, c) for n, k, c in feats if k == "poly"]
        pts = [(n, c) for n, k, c in feats if k == "pt"]
        if not polys:
            raise RuntimeError(f"no service areas found on {BASE + a['map_page']}")
        allpts = [p for _, c in polys for p in c]
        bbox = [min(p[0] for p in allpts) - 0.08, min(p[1] for p in allpts) - 0.08,
                max(p[0] for p in allpts) + 0.08, max(p[1] for p in allpts) + 0.08]
        groups = []
        if a.get("destinations_page"):
            pois = load_pois(bbox)
            rows = table_rows(fetch(BASE + a["destinations_page"]).decode("utf-8", "replace"))
            if not rows:
                raise RuntimeError(f"destinations table not found on {BASE + a['destinations_page']}")
            byname = {n.strip().lower(): c for n, c in polys}
            for subs, dests in rows:
                zs = [byname[s.lower()] for s in subs if s.lower() in byname]
                missing = [s for s in subs if s.lower() not in byname]
                if missing:
                    problems.append(f"{a['name']}: no map file found for {', '.join(missing)}.")
                near = centroid([p for z in zs for p in z]) if zs else centroid(allpts)
                groups.append({"name": ", ".join(subs), "zones": zs, "pickup": ", ".join(subs),
                               "dests": [{"n": d, "ll": match(d, stops, pois, near)} for d in dests]})
        else:
            for n, c in sorted(polys, key=lambda x: a.get("zone_names", {}).get(x[0], x[0])):
                nice = a.get("zone_names", {}).get(n) or (re.sub(r"(?<=[a-z])(?=[A-Z])", " ", re.sub(r"_[A-Z]{1,3}$", "", n)).replace("_", " ").strip() or n)
                groups.append({"name": nice, "zones": [c], "dests": None})
            a_dests = [{"n": n, "ll": c} for n, c in pts]
        out = {k: a[k] for k in ("id", "name", "page", "how")}
        out["groups"] = groups
        if a.get("auto"):
            out["auto"] = True
        if not a.get("destinations_page"):
            out["dests"] = a_dests
        areas.append(out)
        print(f"{a['name']}: {len(polys)} areas, {len(groups)} groups")
        for g in groups:
            for d in (g["dests"] or []):
                print(f"   {'pin ' if d['ll'] else '----'} {d['n']}")
        for d in out.get("dests", []):
            print(f"   pin  {d['n']}")
except Exception as e:
    problems.append(f"On-demand areas could not be updated: {e}. The map keeps showing the previous version.")
    areas = None

# (new services on Translink's hub page are found and added by tools/discover_ondemand.py)

if problems:
    with open(os.path.join(REPO, "zone_check.txt"), "a") as f:
        f.write("\n### On-demand service areas\n\n" + "\n".join("- " + p for p in problems) +
                "\n\nCheck Translink's on-demand pages (translink.com.au/ondemand) and update tools/ondemand.json if a page has moved.\n")
    print("\n".join(problems))

if areas is not None:
    json.dump({"updated": datetime.date.today().isoformat(), "areas": areas}, open(OUT, "w"), separators=(",", ":"))
    print("wrote", OUT, os.path.getsize(OUT), "bytes")
