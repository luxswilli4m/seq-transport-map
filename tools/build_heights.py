#!/usr/bin/env python3
"""Walking heights for the Best connections Walking card -> data/heights/

Usage: build_heights.py <repo> [--force] [--only x,y]

Saves a copy of the Queensland Government's elevation data (QldDem: bare-ground LiDAR, 1 m across urban SEQ;
© State of Queensland, CC BY 4.0) for everywhere within 2 km of a Translink stop, so the Walking card reads heights
from this site instead of depending on the Queensland service being up when someone checks a walk.

Source: QldDem's cached elevation tiles (zoom 15, LERC-compressed, about 4 m a pixel here). Four of them make one
saved tile at zoom 14 (about 8.5 m a pixel; the card smooths over 30 m anyway), in the map's own tile grid.

Saved as data/heights/14/<x>/<y>.png: 257 x 257 heights on the tile's corners and edges, each stored as tenths of a
metre above -100 m in red (high byte) and green (low byte); 0 means no data. data/heights/meta.json lists the tiles
and the QldDem version they came from.

Runs in the weekly refresh. It downloads again only when Queensland republishes QldDem (its version name changes),
or for tiles newly needed because new stops opened.
"""
import sys, os, io, json, math, time, datetime, concurrent.futures as cf
import numpy as np, requests, lerc
from PIL import Image

REPO = sys.argv[1] if len(sys.argv) > 1 else "."
FORCE = "--force" in sys.argv
ONLY = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
SVC = "https://spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer"
OUT = os.path.join(REPO, "data", "heights")
Z, RADIUS_KM = 14, 2.0
SEQ = (151.8, -28.4, 153.6, -26.0)
S = requests.Session(); S.headers["User-Agent"] = "seq-transport-map weekly refresh (github.com/luxswilli4m/seq-transport-map)"


def tile_of(lon, lat, z):
    n = 2 ** z; r = math.radians(lat)
    return int((lon + 180) / 360 * n), int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)


def needed():
    stops = json.load(open(os.path.join(REPO, "data", "network.json")))["data"]["stops"]
    out = set()
    for v in stops.values():
        lat, lon = v[1], v[2]
        if not (SEQ[0] <= lon <= SEQ[2] and SEQ[1] <= lat <= SEQ[3]):
            continue
        dlat = RADIUS_KM / 110.6; dlon = RADIUS_KM / (111.32 * math.cos(math.radians(lat)))
        x0, y0 = tile_of(lon - dlon, lat + dlat, Z); x1, y1 = tile_of(lon + dlon, lat - dlat, Z)
        out.update((x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1))
    return out


def src_tile(z, x, y):
    for attempt in range(4):
        try:
            r = S.get(f"{SVC}/tile/{z}/{y}/{x}", timeout=60)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            res = lerc.decode(r.content)
            arr, mask = res[1], res[2] if len(res) > 2 else None
            arr = np.array(arr, dtype=np.float64)
            if mask is not None and np.ndim(mask) == 2:
                arr[~np.asarray(mask, bool)] = np.nan
            arr[(arr < -100) | (arr > 2000)] = np.nan
            return arr
        except Exception:
            time.sleep(2 + attempt * 3)
    raise RuntimeError(f"QldDem tile {z}/{x}/{y} failed")


def build_tile(x, y):
    g = np.full((513, 513), np.nan)
    for dx in (0, 1):
        for dy in (0, 1):
            a = src_tile(Z + 1, 2 * x + dx, 2 * y + dy)
            if a is not None and a.shape == (257, 257):
                g[dy * 256:dy * 256 + 257, dx * 256:dx * 256 + 257] = a
    h = g[::2, ::2]                       # 257 x 257 on the zoom-14 tile's corners and edges
    if np.isnan(h).all():
        return None
    v = np.where(np.isnan(h), 0, np.clip(np.round((h + 100) * 10), 1, 65535)).astype(np.uint32)
    rgb = np.zeros((257, 257, 3), np.uint8); rgb[..., 0] = v >> 8; rgb[..., 1] = v & 255
    os.makedirs(os.path.join(OUT, str(Z), str(x)), exist_ok=True)
    Image.fromarray(rgb, "RGB").save(os.path.join(OUT, str(Z), str(x), f"{y}.png"), optimize=True)
    return True


def main():
    os.makedirs(OUT, exist_ok=True)
    meta_p = os.path.join(OUT, "meta.json")
    meta = json.load(open(meta_p)) if os.path.exists(meta_p) else {}
    if ONLY:
        x, y = map(int, ONLY.split(",")); print("built" if build_tile(x, y) else "no data"); return
    version = None
    for attempt in range(3):   # QldDem's version name; if the service can't be reached, try again next week
        try:
            version = S.get(f"{SVC}/info/iteminfo?f=json", timeout=60).json().get("name"); break
        except Exception:
            time.sleep(5 + 10 * attempt)
    if not version:
        print("heights: Queensland's elevation service couldn't be reached; keeping the saved heights"); return
    want = needed()
    same = meta.get("version") == version and not FORCE
    have = {tuple(t) for t in meta.get("tiles", [])} if same else set()
    empty = {tuple(t) for t in meta.get("empty", [])} if same else set()   # tiles with no heights at all (open sea)
    have |= empty
    todo = sorted(want - have)
    print(f"heights: QldDem {version}; {len(want)} tiles needed, {len(todo)} to download")
    if not todo and set(map(tuple, meta.get("tiles", []))) <= want:
        return
    done, failed = set((have - empty) & want), 0
    with cf.ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(build_tile, x, y): (x, y) for x, y in todo}
        for i, f in enumerate(cf.as_completed(futs)):
            try:
                if f.result():
                    done.add(futs[f])
                else:
                    empty.add(futs[f])
            except Exception as e:
                failed += 1
            if i % 100 == 0:
                print(f"  {i}/{len(todo)}", flush=True)
    # tidy tiles no longer needed (e.g. a stop closed)
    for x, y in {tuple(t) for t in meta.get("tiles", [])} - want:
        p = os.path.join(OUT, str(Z), str(x), f"{y}.png")
        if os.path.exists(p):
            os.remove(p)
    json.dump({"version": version, "built": datetime.date.today().isoformat(), "z": Z, "radius_km": RADIUS_KM,
               "tiles": sorted([list(t) for t in done]), "empty": sorted([list(t) for t in empty & want])}, open(meta_p, "w"), separators=(",", ":"))
    print(f"heights: {len(done)} tiles saved, {failed} failed (tried again next week)")
    if failed and not done:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
