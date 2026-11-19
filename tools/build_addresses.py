#!/usr/bin/env python3
"""Street addresses and landmarks for the Best connections search -> data/addr/

Usage: build_addresses.py <repo> [--force]

Addresses: every SEQ address in G-NAF, Australia's national address file (© Geoscape Australia,
open G-NAF licence), read from Overture Maps' public copy (overturemaps.org "addresses" theme, which
carries G-NAF for Australia) so only the SEQ slice is downloaded. Unit numbers are dropped (a building's
units share its position), leaving about 1.6 million street addresses.

Landmarks: named places people travel to (stadiums, hospitals, universities, schools, shopping centres,
parks, beaches, venues, attractions, libraries...) from the map's own base map (OpenStreetMap names). No businesses. Each gets the official G-NAF address nearest to it, so "Suncorp Stadium" shows with the
address people would look up.

Output (all small JSON files, fetched by the map only as you type):
  data/addr/<ab>.json      streets whose name starts with "ab": [[street, suburb, postcode, [numbers], [lon*1e5 deltas], [lat*1e5 deltas]], ...]
  data/addr/places.json    landmarks: [[name, kind, address, lon, lat, rank (lower = better known)], ...]
  data/addr/meta.json      {"release": Overture release, "addresses": n, "landmarks": n}

Runs in the weekly refresh but only downloads when Overture publishes a new release (monthly).
"""
import sys, os, io, re, json, math, datetime, collections

REPO = sys.argv[1] if len(sys.argv) > 1 else "."
FORCE = "--force" in sys.argv
OUT = os.path.join(REPO, "data", "addr")
SEQ = (151.8, -28.4, 153.6, -26.0)
STAC = "https://stac.overturemaps.org"
sys.path.insert(0, os.path.join(REPO, "tools"))
from od_places import _HTTPRangeFile  # noqa: E402

OSM_KIND = {
    "park": "Park", "dog_park": "Park", "village_green": "Park", "common": "Park", "picnic_site": "Park", "garden": "Garden",
    "nature_reserve": "Nature reserve", "protected_area": "Nature reserve", "national_park": "National park",
    "school": "School", "college": "TAFE or college", "university": "University", "peak": "Lookout or mountain",
    "recreation_ground": "Sports ground", "sports_centre": "Sports centre", "sports_hall": "Sports centre", "stadium": "Stadium",
    "community_centre": "Community centre", "social_centre": "Community centre", "townhall": "Civic centre", "library": "Library",
    "mall": "Shopping centre", "marketplace": "Market", "golf_course": "Golf course", "cemetery": "Cemetery",
    "hospital": "Hospital", "beach": "Beach", "swimming_area": "Beach", "police": "Police station", "courthouse": "Courthouse",
    "attraction": "Attraction", "museum": "Museum", "gallery": "Gallery", "arts_centre": "Gallery", "theatre": "Theatre",
    "cinema": "Cinema", "swimming_pool": "Swimming pool", "water_park": "Theme park", "theme_park": "Theme park", "zoo": "Zoo",
    "aquarium": "Aquarium", "aerodrome": "Airport", "marina": "Marina", "events_venue": "Venue", "exhibition_centre": "Venue",
    "conference_centre": "Venue", "music_venue": "Venue", "amphitheatre": "Venue", "memorial": "Memorial", "fort": "Historic site",
    "heritage": "Historic site", "pedestrian": "Plaza", "camp_site": "Campground", "place_of_worship": "Place of worship",
    "skatepark": "Park", "bike_park": "Park", "ice_rink": "Sports centre", "government": "Government office",
}

def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def osm_landmarks():
    import gzip
    from pmtiles.reader import Reader, MmapSource
    import mapbox_vector_tile
    Z = 14; N = 2 ** Z
    tx = lambda lon: int((lon + 180) / 360 * N)
    ty = lambda lat: int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * N)
    rd = Reader(MmapSource(open(os.path.join(REPO, "tiles", "seq.pmtiles"), "rb")))
    got = []
    for x in range(tx(SEQ[0]), tx(SEQ[2]) + 1):
        for y in range(ty(SEQ[3]), ty(SEQ[1]) + 1):
            d = rd.get(Z, x, y)
            if not d:
                continue
            try:
                d = gzip.decompress(d)
            except OSError:
                pass
            L = mapbox_vector_tile.decode(d).get("pois")
            if not L:
                continue
            for ft in L["features"]:
                pr = ft["properties"]; kind = OSM_KIND.get(pr.get("kind")); nm = (pr.get("name") or "").strip()
                if not kind or not nm or ft["geometry"]["type"] != "Point":
                    continue
                px, py = ft["geometry"]["coordinates"]; e = L["extent"]
                lon = (x + px / e) / N * 360 - 180
                lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1 - py / e) / N))))
                got.append((nm, kind, int(pr.get("min_zoom") or 15), lon, lat))
    got.sort(key=lambda p: p[2]); kept, byname = [], collections.defaultdict(list)
    for p in got:            # one entry per place: same name within 300 m
        k = norm(p[0])
        if any(math.hypot((p[3] - q[3]) * 98.7, (p[4] - q[4]) * 110.6) < 0.3 for q in byname[k]):
            continue
        byname[k].append(p); kept.append(p)
    return kept


def title(s):
    s = " ".join(w.capitalize() for w in s.lower().split())
    s = re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), s)
    s = re.sub(r"\b(O)'([a-z])", lambda m: m.group(1) + "'" + m.group(2).upper(), s)
    return s


def key2(street):
    k = re.sub(r"[^a-z0-9]", "", street.lower())
    return (k[:2] or "__").ljust(2, "_")


def overture_files(rel, theme, typ):
    import requests
    n = int(requests.get(f"{STAC}/{rel}/{theme}/{typ}/collection.json", timeout=60).json()["partition:file_count"])
    out = []
    for i in range(n):
        it = requests.get(f"{STAC}/{rel}/{theme}/{typ}/{i:05d}/{i:05d}.json", timeout=60).json(); b = it["bbox"]
        if b[0] <= SEQ[2] and b[2] >= SEQ[0] and b[1] <= SEQ[3] and b[3] >= SEQ[1]:
            out.append([a["href"] for a in it["assets"].values() if "amazonaws.com" in a["href"]][0])
    return out


def read_seq(url, cols):
    import pyarrow.parquet as pq, pyarrow.compute as pc
    f = pq.ParquetFile(io.BufferedReader(_HTTPRangeFile(url), buffer_size=16 << 20)); md = f.metadata
    names = [md.schema.column(i).path for i in range(md.num_columns)]; ix = {c: i for i, c in enumerate(names)}
    for r in range(md.num_row_groups):
        st = lambda c: md.row_group(r).column(ix[c]).statistics
        if not (st("bbox.xmin").max >= SEQ[0] and st("bbox.xmax").min <= SEQ[2] and st("bbox.ymin").max >= SEQ[1] and st("bbox.ymax").min <= SEQ[3]):
            continue
        tb = f.read_row_group(r, columns=cols + ["bbox"])
        b = tb.column("bbox").combine_chunks(); x = pc.struct_field(b, "xmin"); y = pc.struct_field(b, "ymin")
        tb = tb.filter(pc.and_(pc.and_(pc.greater_equal(x, SEQ[0]), pc.less_equal(x, SEQ[2])), pc.and_(pc.greater_equal(y, SEQ[1]), pc.less_equal(y, SEQ[3]))))
        yield from tb.to_pylist()


def main():
    import requests
    os.makedirs(OUT, exist_ok=True)
    meta_p = os.path.join(OUT, "meta.json")
    meta = json.load(open(meta_p)) if os.path.exists(meta_p) else {}
    rel = requests.get(f"{STAC}/catalog.json", timeout=60).json()["latest"]
    if meta.get("release") == rel and not FORCE:
        print("addresses: Overture", rel, "already used; nothing to do"); return

    # ---------- addresses (G-NAF via Overture)
    seen, streets = set(), collections.defaultdict(list)
    for url in overture_files(rel, "addresses", "address"):
        for r in read_seq(url, ["street", "number", "postcode", "address_levels", "country"]):
            if r.get("country") not in (None, "AU") or not r["street"] or not r["number"]:
                continue
            lv = r["address_levels"] or []
            if lv and lv[0]["value"] != "QLD":
                continue
            sub = lv[1]["value"] if len(lv) > 1 else ""
            k = (r["street"], r["number"], sub)
            if k in seen:
                continue
            seen.add(k)
            streets[(r["street"], sub, r["postcode"] or "")].append((r["number"], r["bbox"]["xmin"], r["bbox"]["ymin"]))
    if len(seen) < 1_000_000:
        raise SystemExit(f"only {len(seen)} SEQ addresses read; keeping the previous files")
    print("addresses:", len(seen), "on", len(streets), "streets")

    def numkey(n):
        m = re.match(r"(\d+)", n)
        return (0 if m else 1, int(m.group(1)) if m else 0, n)

    chunks = collections.defaultdict(list)
    grid = collections.defaultdict(list)          # for giving landmarks their official address
    for (st, sub, pc_), pts in streets.items():
        pts.sort(key=lambda p: numkey(p[0]))
        lon = [round(p[1] * 1e5) for p in pts]; lat = [round(p[2] * 1e5) for p in pts]
        dl = [lon[0]] + [lon[i] - lon[i - 1] for i in range(1, len(lon))]
        dt = [lat[0]] + [lat[i] - lat[i - 1] for i in range(1, len(lat))]
        chunks[key2(st)].append([title(st), title(sub), pc_, [p[0].lower() for p in pts], dl, dt])
        for p in pts:
            if not p[0].upper().startswith("LOT"):
                grid[(int(p[1] * 500), int(p[2] * 500))].append((p[1], p[2], f"{p[0]} {title(st)}, {title(sub)}", title(st).lower()))
    for f in os.listdir(OUT):
        if re.fullmatch(r"[a-z0-9_]{2}\.json", f):
            os.remove(os.path.join(OUT, f))
    for k, v in chunks.items():
        v.sort(key=lambda s: (s[0], s[1]))
        json.dump(v, open(os.path.join(OUT, f"{k}.json"), "w"), separators=(",", ":"), ensure_ascii=False)

    # ---------- landmarks: the base map's own named places (OpenStreetMap, so curated names), no businesses
    places = osm_landmarks()
    out = []
    for nm, kind, rank, x, y in places:
        cx, cy = int(x * 500), int(y * 500); best = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for ax, ay, label, st in grid.get((cx + dx, cy + dy), []):
                    d = math.hypot((ax - x) * 98.7, (ay - y) * 110.6)
                    if d <= 0.25 and (best is None or d < best[0]):
                        best = (d, label)
        out.append([nm, kind, best[1] if best else "", round(x, 5), round(y, 5), rank])
    out.sort(key=lambda p: p[0].lower())
    json.dump(out, open(os.path.join(OUT, "places.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    json.dump({"release": rel, "built": datetime.date.today().isoformat(), "addresses": len(seen), "streets": len(streets),
               "landmarks": len(out)}, open(meta_p, "w"))
    print("landmarks:", len(out), "| with an official address:", sum(1 for p in out if p[2]))


if __name__ == "__main__":
    main()
