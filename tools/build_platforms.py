#!/usr/bin/env python3
"""Build data/platforms.json: platform areas and numbers for the BAU stations.

Usage: build_platforms.py <gtfs_dir> <repo>

Platform areas are the platform shapes in the base map (OpenStreetMap, tiles/seq.pmtiles), plus
OpenStreetMap platform outlines from Overture Maps for platforms the base map leaves out (underground
busway platforms); where neither has a shape, a small square marks the platform at Translink's position;
platform numbers are the positions of each platform / bay in Translink's stop list.
Stations are listed in BAU below (same as the BAU menu in index.html).
"""
import sys, os, json, math, gzip, re, csv
from shapely.geometry import Polygon, Point, shape
from shapely.ops import unary_union, transform

G, REPO = sys.argv[1], sys.argv[2]
BAU = ["place_qsbs", "place_ccbs", "place_romsta", "place_helsta"]
# stations drawn alongside a BAU station (not in the BAU menu themselves): Roma Street busway's bus platforms 1 and 2
EXTRA = ["place_rompl"]
RADIUS = 0.35
MATCH = float(os.environ.get("PLAT_MATCH", 25))  # metres  # km around the station to look for platform areas

from pmtiles.reader import Reader, MmapSource
import mapbox_vector_tile
rd = Reader(MmapSource(open(os.path.join(REPO, "tiles", "seq.pmtiles"), "rb")))
Z = 14; N = 2 ** Z
def tx(lon): return int((lon + 180) / 360 * N)
def ty(lat): r = math.radians(lat); return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * N)
def lonlat(x, y, px, py, ext):
    lon = (x + px / ext) / N * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1 - py / ext) / N))))
    return lon, lat

stops = {r["stop_id"]: r for r in csv.DictReader(open(os.path.join(G, "stops.txt"), encoding="utf-8-sig"))}
def plabel(name, code):
    m = re.search(r",\s*platform\s+(\w+)\s*$", name, re.I)
    if m: return m.group(1)
    m = re.search(r"\bstop\s+(\w{1,4})\b", name, re.I)
    if m: return m.group(1)
    m = re.search(r",\s*(\w{1,3})\s*$", name)
    if m: return m.group(1)
    return None

# ---------- platform outlines from Overture Maps (OpenStreetMap platforms the base map leaves out, such as
# the underground Queen Street bus station and Cultural Centre busway platforms). Kept in
# tools/platform_shapes.json and re-downloaded only when Overture publishes a new release.
def overture_platforms():
    cache_p = os.path.join(REPO, "tools", "platform_shapes.json")
    cache = json.load(open(cache_p)) if os.path.exists(cache_p) else {}
    ids = BAU + EXTRA
    pts_ = [(float(stops[i]["stop_lon"]), float(stops[i]["stop_lat"])) for i in ids if i in stops]
    bb = (min(p[0] for p in pts_) - 0.01, min(p[1] for p in pts_) - 0.01, max(p[0] for p in pts_) + 0.01, max(p[1] for p in pts_) + 0.01)
    try:
        import io, requests, pyarrow.parquet as pq, pyarrow.compute as pc
        from shapely import wkb
        sys.path.insert(0, os.path.join(REPO, "tools"))
        from od_places import _HTTPRangeFile
        stac = "https://stac.overturemaps.org"
        rel = requests.get(f"{stac}/catalog.json", timeout=60).json()["latest"]
        if cache.get("release") == rel and cache.get("bbox") == [round(v, 4) for v in bb]:
            return cache["polys"]
        n = int(requests.get(f"{stac}/{rel}/base/infrastructure/collection.json", timeout=60).json()["partition:file_count"])
        polys = []
        for i in range(n):
            it = requests.get(f"{stac}/{rel}/base/infrastructure/{i:05d}/{i:05d}.json", timeout=60).json(); b = it["bbox"]
            if not (b[0] <= bb[2] and b[2] >= bb[0] and b[1] <= bb[3] and b[3] >= bb[1]):
                continue
            url = [a["href"] for a in it["assets"].values() if "amazonaws.com" in a["href"]][0]
            f = pq.ParquetFile(io.BufferedReader(_HTTPRangeFile(url), buffer_size=8 << 20)); md = f.metadata
            cols = [md.schema.column(k).path for k in range(md.num_columns)]; ix = {c: k for k, c in enumerate(cols)}
            keep = []
            for r in range(md.num_row_groups):
                stt = lambda c: md.row_group(r).column(ix[c]).statistics
                if stt("bbox.xmin").max >= bb[0] and stt("bbox.xmax").min <= bb[2] and stt("bbox.ymin").max >= bb[1] and stt("bbox.ymax").min <= bb[3]:
                    keep.append(r)
            if not keep:
                continue
            tb = f.read_row_groups(keep, columns=["geometry", "bbox", "class", "names"])
            bx = tb.column("bbox").combine_chunks(); x = pc.struct_field(bx, "xmin"); y = pc.struct_field(bx, "ymin")
            tb = tb.filter(pc.and_(pc.and_(pc.greater_equal(x, bb[0]), pc.less_equal(x, bb[2])), pc.and_(pc.greater_equal(y, bb[1]), pc.less_equal(y, bb[3]))))
            tb = tb.filter(pc.equal(tb.column("class"), "platform"))
            for r in tb.to_pylist():
                g = wkb.loads(r["geometry"])
                for gg in getattr(g, "geoms", [g]):
                    if gg.geom_type == "Polygon" and gg.area > 0:
                        polys.append({"n": (r["names"] or {}).get("primary") or "", "c": [[round(a, 6), round(c, 6)] for a, c in gg.exterior.coords]})
        if len(polys) < 5:
            raise RuntimeError(f"only {len(polys)} platform outlines found")
        json.dump({"release": rel, "bbox": [round(v, 4) for v in bb], "polys": polys}, open(cache_p, "w"), separators=(",", ":"))
        print(f"Overture {rel}: {len(polys)} platform outlines")
        return polys
    except Exception as e:      # unreachable: use the last download (or the base map alone)
        print("Overture platform outlines not updated:", e)
        return cache.get("polys", [])

OV_POLYS = [Polygon(p["c"]).buffer(0) for p in overture_platforms()]

out = []
for sid in BAU + EXTRA:
    st = stops.get(sid)
    if not st: print("missing", sid); continue
    lo0, la0 = float(st["stop_lon"]), float(st["stop_lat"])
    kx = 111.32 * math.cos(math.radians(la0)); ky = 110.57
    dlo, dla = RADIUS / kx, RADIUS / ky
    polys = []
    for x in range(tx(lo0 - dlo), tx(lo0 + dlo) + 1):
        for y in range(ty(la0 + dla), ty(la0 - dla) + 1):
            d = rd.get(Z, x, y)
            if not d: continue
            try: d = gzip.decompress(d)
            except OSError: pass
            lay = mapbox_vector_tile.decode(d).get("landuse")
            if not lay: continue
            ext = lay.get("extent", 4096)
            for f in lay["features"]:
                if f["properties"].get("kind") != "platform": continue
                g = shape(f["geometry"])
                g = transform(lambda px, py, z=None, x=x, y=y: tuple(zip(*[lonlat(x, y, a, b, ext) for a, b in zip(px, py)])), g)
                polys.append(g.buffer(0))
    if sid not in EXTRA:
        polys += [g for g in OV_POLYS if g.distance(Point(lo0, la0)) * 111000 < RADIUS * 1000]
    area = unary_union(polys) if polys else None
    pts = []
    for k, s in stops.items():
        if s.get("parent_station") != sid: continue
        lb = None if re.search(r"\bstop\s+\d{3}\b", s["stop_name"], re.I) else plabel(s["stop_name"], s.get("platform_code"))
        if lb and not any(p["n"] == lb for p in pts):   # one number per platform (a station entry can repeat platform 1)
            pts.append({"n": lb, "ll": [round(float(s["stop_lon"]), 6), round(float(s["stop_lat"]), 6)]})
    # Helensvale's platforms 1, 2, 4 and 5 are listed without a parent; add same-named platforms within 300 m
    base = st["stop_name"].lower().replace(" busway station", "").replace(" bus station", "").replace(" station", "")
    for k, s in stops.items():
        if s.get("parent_station") or k == sid or not s["stop_name"].lower().startswith(base): continue
        if math.hypot((float(s["stop_lon"]) - lo0) * kx, (float(s["stop_lat"]) - la0) * ky) > 0.3: continue
        lb = plabel(s["stop_name"], s.get("platform_code")) if re.search(r"platform", s["stop_name"], re.I) else None
        if lb and not any(p["n"] == lb for p in pts): pts.append({"n": lb, "ll": [round(float(s["stop_lon"]), 6), round(float(s["stop_lat"]), 6)]})
    # keep only platform areas that actually hold one of this station's platforms (within 25 m)
    keep = []
    if area is not None and sid not in EXTRA:   # bus platforms get their own squares, never the rail platform shapes beside them
        for g in getattr(area, "geoms", [area]):
            if g.area <= 0: continue
            if any(g.distance(Point(p["ll"])) * 111000 < MATCH for p in pts):
                keep.append([[round(a, 6), round(b, 6)] for a, b in g.exterior.coords])
    # where the base map has no platform shape, mark the platform/bay with a small box (about 12 m square)
    from shapely.affinity import scale
    shapes_ = [Polygon(a) for a in keep]
    for p in pts:
        P = Point(p["ll"])
        if any(g.distance(P) * 111000 < MATCH for g in shapes_): continue
        b = scale(P.buffer(6 / 111000, cap_style=3), xfact=111.32 / kx, yfact=1)
        keep.append([[round(a, 6), round(c, 6)] for a, c in b.exterior.coords]); p["box"] = 1
    out.append({"id": sid, "name": st["stop_name"], "areas": keep, "pts": sorted(pts, key=lambda p: (int(re.match(r"\d*", p["n"]).group() or 999), p["n"]))})
    if area is not None: print("  nearest area to each number (m):", [round(min(g.distance(Point(p["ll"])) for g in getattr(area,"geoms",[area]))*111000) for p in pts])
    print(st["stop_name"], "areas", len(keep), "numbers", [p["n"] for p in pts])
json.dump({"stations": out}, open(os.path.join(REPO, "data", "platforms.json"), "w"), separators=(",", ":"))
