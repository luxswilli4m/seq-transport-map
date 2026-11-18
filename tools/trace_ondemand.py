#!/usr/bin/env python3
"""Keep the traced on-demand areas (Ipswich, Bribie Island, Yarrabilba) up to date.

Usage: trace_ondemand.py <repo> [--force ZONE]

Translink only publishes these service areas as map pictures. For each traced zone,
tools/ondemand.json says which Translink page shows the picture ("picture": page + a
pattern that picks the right picture on that page). Every week this script:

  1. finds the picture on the page and downloads it;
  2. if it is the same picture as last time (same fingerprint), does nothing;
  3. if it changed, re-traces it: picks out the dark navy roam-zone outline, lines the
     picture up with the real road network from the base map (tiles/seq.pmtiles), and
     turns the outline into map coordinates;
     (Bribie Island's picture has too many labels across its outline for this, so it is
     marked "auto": false and a change there only raises an issue.)
  4. checks the result. If the picture lined up well and the area is still in the same
     place (overlaps the old one), the new outline replaces the old one in
     tools/ondemand_traced.json and a note goes into zone_check.txt so a GitHub issue
     tells you it changed. If not, the old outline is kept and the issue asks for a look.

Needs: numpy, scipy, shapely, pillow, opencv-python-headless, pmtiles, mapbox-vector-tile.
"""
import sys, os, re, json, math, gzip, hashlib, subprocess, html, io
import numpy as np

REPO = sys.argv[1]
FORCE = sys.argv[sys.argv.index("--force") + 1] if "--force" in sys.argv else None
CFG = json.load(open(os.path.join(REPO, "tools", "ondemand.json")))
TPATH = os.path.join(REPO, "tools", "ondemand_traced.json")
TRACED = json.load(open(TPATH))
META = TRACED.setdefault("_pictures", {})
BASE = "https://translink.com.au"
notes = []


def fetch(url):
    r = subprocess.run(["curl", "-sSL", "-m", "90", "--fail", "-A", "Mozilla/5.0 seq-transport-map", url], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"could not download {url}")
    return r.stdout


def find_picture(pic):
    """Return the full-size picture URL that the page currently shows for this zone."""
    page = fetch(pic["page"]).decode("utf-8", "replace")
    urls = [html.unescape(u) for u in re.findall(r'(?:src|href)="([^"]+)"', page)]
    pat = re.compile(pic["match"], re.I)
    for u in urls:
        if not pat.search(urllib_unquote(u)):
            continue
        if u.startswith("//"):
            u = "https:" + u
        elif u.startswith("/"):
            u = BASE + u
        # a widen.net share page (PDF viewer): use its picture preview instead
        if "widen.net/s/" in u:
            sp = fetch(u).decode("utf-8", "replace")
            m = re.search(r'og:image" content="([^"]+)"', sp)
            if not m:
                continue
            host = re.match(r"https://[^/]+", u).group(0)
            return host + m.group(1).split("?")[0] + "?w=2048"
        if "widen.net/content/" in u:
            return u.split("?")[0] + "?w=2048"
        # Drupal image styles -> the original upload
        m = re.match(r"(https://translink\.com\.au)/sites/default/files/styles/[^/]+/public/(.+?)(\?.*)?$", u)
        if m:
            return f"{m.group(1)}/sites/default/files/{m.group(2)}"
        return u
    raise RuntimeError(f"no picture matching '{pic['match']}' on {pic['page']}")


def urllib_unquote(s):
    import urllib.parse
    return urllib.parse.unquote(s)


# ---------- base-map roads, for lining the picture up
def load_roads(bbox):
    from pmtiles.reader import Reader, MmapSource
    import mapbox_vector_tile
    z = 14; n = 2 ** z
    tx = lambda lon: int((lon + 180) / 360 * n)
    def ty(lat):
        r = math.radians(lat); return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)
    rd = Reader(MmapSource(open(os.path.join(REPO, "tiles", "seq.pmtiles"), "rb")))
    pts = []
    for x in range(tx(bbox[0]), tx(bbox[2]) + 1):
        for y in range(ty(bbox[3]), ty(bbox[1]) + 1):
            d = rd.get(z, x, y)
            if not d:
                continue
            try:
                d = gzip.decompress(d)
            except OSError:
                pass
            lay = mapbox_vector_tile.decode(d).get("roads")
            if not lay:
                continue
            ext = lay.get("extent", 4096)
            for f in lay["features"]:
                nm = f["properties"].get("name") or ""
                if not nm or re.search(r"break|track|trail|cycleway|rail|path|walk", nm, re.I):
                    continue
                g = f["geometry"]
                lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"] if g["type"] == "MultiLineString" else []
                for L in lines:
                    ll = [((x + px / ext) / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1 - py / ext) / n))))) for px, py in L]
                    for (a, b), (c, e) in zip(ll, ll[1:]):
                        k = max(1, int(max(abs(c - a), abs(e - b)) / 0.0002))
                        for t in np.linspace(0, 1, k, endpoint=False):
                            pts.append((a + (c - a) * t, b + (e - b) * t))
    return np.array(pts)


def trace(img_bytes, old_zone, outline="navy", debug=None):
    """Return (outline [[lon,lat],...], fit) for the largest navy-outlined area in the picture."""
    import cv2
    from scipy.optimize import minimize
    from PIL import Image
    im = np.array(Image.open(io.BytesIO(img_bytes)).convert("RGB")).astype(int)
    H, W = im.shape[:2]
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    if outline == "pink":     # Ipswich zone D is drawn in pink
        navy0 = ((r > 180) & (g < 140) & (b > 110) & (r - g > 70)).astype(np.uint8)
    else:
        navy0 = ((r < 90) & (g < 100) & (b > 55) & (b - r > 18)).astype(np.uint8)
    # black location icons (round, about 20-45 px) often sit on top of the outline: count them as outline too
    ko = 3 if W >= 1600 else 2
    navy0 = cv2.morphologyEx(navy0, cv2.MORPH_OPEN, np.ones((ko, ko), np.uint8))   # drop thin navy street labels, keep the thick outline
    blk = (im.max(axis=2) < 90).astype(np.uint8)
    ke = max(3, round(W / 266))       # thicker than any text stroke, thinner than an icon
    core = cv2.erode(blk, np.ones((ke, ke), np.uint8))
    blob = cv2.dilate(core, np.ones((ke + 8, ke + 8), np.uint8))
    nb, lb, sb, _ = cv2.connectedComponentsWithStats(blob)
    for i in range(1, nb):
        x0, y0, w0, h0, a0 = sb[i]
        if 0.012 * W <= h0 <= 0.035 * W and w0 < 3.5 * h0:     # one icon, or two or three side by side
            cv2.rectangle(navy0, (int(x0), int(y0)), (int(x0 + w0), int(y0 + h0)), 1, -1)
    e = 8                      # ignore frame lines along the picture's edges
    navy0[:e, :] = 0; navy0[-e:, :] = 0; navy0[:, :e] = 0; navy0[:, -e:] = 0
    inside = None
    for k in (5, 9, 13, 17, 21):      # close small gaps where the outline crosses labels
        navy = cv2.dilate(navy0, np.ones((k, k), np.uint8))
        ff = navy * 255
        for sx, sy in ((2, 2), (W - 3, 2), (2, H - 3), (W - 3, H - 3)):
            if ff[sy, sx] == 0:
                cv2.floodFill(ff, np.zeros((H + 2, W + 2), np.uint8), (sx, sy), 128)
        cand = (ff == 0).astype(np.uint8)
        nlab, lab, st, _ = cv2.connectedComponentsWithStats(cand)
        parts = []
        for i in range(1, nlab):
            area = st[i, cv2.CC_STAT_AREA]
            if area < 0.002 * H * W:
                continue
            x0, y0, w0, h0 = st[i, :4]
            if area > 0.96 * w0 * h0 or (im[lab == i].min(axis=1) > 248).mean() > 0.5:   # the white key/legend box
                continue
            parts.append((i, area))
        if parts and max(a for _, a in parts) >= 0.03 * H * W:
            big = max(a for _, a in parts)
            inside = np.isin(lab, [i for i, a in parts if a >= 0.02 * big]).astype(np.uint8); kk = k
            break
    if inside is None:
        raise RuntimeError("couldn't find a closed navy roam-zone outline in the picture")
    m = cv2.dilate(inside, np.ones((kk, kk), np.uint8))   # back out to the middle of the outline
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((kk + 10, kk + 10), np.uint8))   # rejoin parts split by a label across the zone
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    poly = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 2.0, True)[:, 0, :].astype(float)

    # roads in the picture: white lines (legend box masked out by keeping only the map part)
    mn = im.min(axis=2).astype(np.uint8)
    tophat = cv2.morphologyEx(mn, cv2.MORPH_TOPHAT, np.ones((9, 9), np.uint8))
    white = ((mn > 246) | (tophat > 6)).astype(np.uint8)   # roads: white, or lighter than what's around them
    dt = cv2.distanceTransform(1 - white, cv2.DIST_L2, 5)
    ox = [p[0] for p in old_zone]; oy = [p[1] for p in old_zone]
    lon0, lat0 = (min(ox) + max(ox)) / 2, (min(oy) + max(oy)) / 2
    P = load_roads([min(ox) - 0.06, min(oy) - 0.06, max(ox) + 0.06, max(oy) + 0.06])
    if len(P) < 200:
        raise RuntimeError("not enough base-map roads to line the picture up")
    X, Y = P[:, 0] - lon0, P[:, 1] - lat0

    def proj(p, X=X, Y=Y):
        ax, ay, bx, by = p
        return ax * X + bx, ay * Y + by

    def cost(p):
        x, y = proj(p)
        ok = (x >= 0) & (x < W - 1) & (y >= 0) & (y < H - 1)
        if ok.sum() < 300:
            return 1e9
        return float(np.mean(np.minimum(dt[y[ok].astype(int), x[ok].astype(int)], 25)))

    # first guess: the new outline's box sits where the old area's box was
    px0, px1, py0, py1 = poly[:, 0].min(), poly[:, 0].max(), poly[:, 1].min(), poly[:, 1].max()
    ax = (px1 - px0) / (max(ox) - min(ox)); ay = -(py1 - py0) / (max(oy) - min(oy))
    s = (abs(ax) + abs(ay) * math.cos(math.radians(lat0))) / 2
    ax, ay = s, -s / math.cos(math.radians(lat0))
    bx = (px0 + px1) / 2 - ax * ((min(ox) + max(ox)) / 2 - lon0)
    by = (py0 + py1) / 2 - ay * ((min(oy) + max(oy)) / 2 - lat0)
    best = None
    for f in (0.85, 0.92, 1, 1.08, 1.17):
        for dx in (-0.12, -0.06, 0, 0.06, 0.12):
            for dy in (-0.12, -0.06, 0, 0.06, 0.12):
                p = [ax * f, ay * f, bx + dx * W, by + dy * H]
                c = cost(p)
                if best is None or c < best[0]:
                    best = (c, p)
    res = minimize(cost, best[1], method="Nelder-Mead", options={"maxiter": 4000, "xatol": 0.01, "fatol": 1e-4})
    ax, ay, bx, by = res.x
    x, y = proj(res.x); ok = (x >= 0) & (x < W - 1) & (y >= 0) & (y < H - 1)
    fit = float(np.median(dt[y[ok].astype(int), x[ok].astype(int)]))   # half the real roads sit within this many pixels of a drawn road
    if debug:
        import cv2 as _c
        v = np.ascontiguousarray(im[..., ::-1].astype(np.uint8))
        x, y = proj(res.x)
        for xi, yi in zip(x.astype(int), y.astype(int)):
            if 0 <= xi < W and 0 <= yi < H: v[yi, xi] = (0, 0, 255)
        _c.polylines(v, [poly.astype(np.int32)], True, (0, 200, 0), 3)
        _c.imwrite(debug, v)
    ring = [[round((x - bx) / ax + lon0, 5), round((y - by) / ay + lat0, 5)] for x, y in poly]
    ring.append(ring[0])
    return ring, fit


def overlap(a, b):
    from shapely.geometry import Polygon
    A, B = Polygon(a).buffer(0), Polygon(b).buffer(0)
    return A.intersection(B).area / max(A.union(B).area, 1e-12), A.area / max(B.area, 1e-12)


changed = False
for area in CFG["areas"]:
    if not area.get("traced"):
        continue
    for g in area["groups"]:
        pic, zid = g.get("picture"), g["zone"]
        if not pic:
            continue
        try:
            url = find_picture(pic)
            data = fetch(url)
            sha = hashlib.sha1(data).hexdigest()
            old = META.get(zid, {})
            if old.get("sha") == sha and FORCE != zid:
                print(f"{zid}: picture unchanged")
                continue
            if not old.get("sha") and zid in TRACED and FORCE != zid:
                META[zid] = {"url": url, "sha": sha}; changed = True     # first run: remember the picture
                print(f"{zid}: picture recorded")
                continue
            if pic.get("auto") is False:
                notes.append(f"{area['name']} ({g['name']}): Translink changed the map picture. This one can't be re-traced "
                             f"automatically (labels and icons sit across the outline), so the map keeps the previous outline. "
                             f"Ask for it to be re-traced. Picture: {url}")
                META[zid] = {**old, "pending_url": url, "pending_sha": sha}; changed = True
                continue
            ring, fit = trace(data, TRACED[zid], pic.get("outline", "navy"), os.environ.get("TRACE_DEBUG") and f"/tmp/trace_{zid}.png")
            iou, ratio = overlap(ring, TRACED[zid])
            print(f"{zid}: re-traced, fit {fit:.2f} px, overlap {iou:.2f}, size x{ratio:.2f}")
            if fit > 3.0 or iou < 0.6 or not 0.5 < ratio < 2:
                notes.append(f"{area['name']} ({g['name']}): Translink changed the map picture, but the automatic re-trace "
                             f"didn't line up confidently (fit {fit:.1f}, overlap {iou:.0%}). The map keeps the previous outline. "
                             f"Picture: {url}")
                META[zid] = {**old, "pending_url": url, "pending_sha": sha}; changed = True
                continue
            TRACED[zid] = ring
            META[zid] = {"url": url, "sha": sha}; changed = True
            if iou < 0.97:
                notes.append(f"{area['name']} ({g['name']}): Translink changed the map picture, so the outline was re-traced "
                             f"automatically ({abs(ratio - 1):.0%} {'bigger' if ratio >= 1 else 'smaller'}; {iou:.0%} overlap with the old one). "
                             f"Worth a quick look on the map. Picture: {url}")
        except Exception as e:
            notes.append(f"{area['name']} ({g['name']}): couldn't check the map picture ({e}). The map keeps the current outline.")

if changed:
    with open(TPATH, "w") as f:
        json.dump(TRACED, f, indent=0)
if notes:
    with open(os.path.join(REPO, "zone_check.txt"), "a") as f:
        f.write("\n### On-demand map pictures\n\n" + "\n".join("- " + n for n in notes) + "\n")
    print("\n".join(notes))
