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
  4. checks the result. If the picture lined up well with the roads and the area still overlaps the
     old one, the new outline replaces the old one in tools/ondemand_traced.json. If not, the previous
     outline is kept and an amber note on the map's On demand card says Translink's map changed but
     couldn't be traced confidently. It's tried again whenever Translink changes the picture again.

Needs: numpy, scipy, shapely, pillow, opencv-python-headless, pmtiles, mapbox-vector-tile.
"""
import sys, os, re, json, math, gzip, hashlib, subprocess, html, io, datetime
import numpy as np

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))   # this file lives in <repo>/tools
FORCE = sys.argv[sys.argv.index("--force") + 1] if "--force" in sys.argv else None
CFG = json.load(open(os.path.join(REPO, "tools", "ondemand.json")))
_AUTO = os.path.join(REPO, "tools", "ondemand_auto.json")
if os.path.exists(_AUTO):
    CFG["areas"] = CFG["areas"] + json.load(open(_AUTO)).get("areas", [])
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


def trace(img_bytes, old_zone, outline="navy", debug=None, wide=False, need_outline=True):
    """Return (outline [[lon,lat],...], fit, affine) for the largest navy-outlined area in the picture.
    With need_outline=False the picture is only lined up (outline None), e.g. to read key locations."""
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
    if inside is None and need_outline:
        raise RuntimeError("couldn't find a closed navy roam-zone outline in the picture")
    if inside is None:
        poly = None
        if not wide:
            wide, old_zone = True, [old_zone]
    else:
        m = cv2.dilate(inside, np.ones((kk, kk), np.uint8))   # back out to the middle of the outline
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((kk + 10, kk + 10), np.uint8))   # rejoin parts split by a label across the zone
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        poly = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 2.0, True)[:, 0, :].astype(float)

    # roads in the picture: white lines (legend box masked out by keeping only the map part)
    mn = im.min(axis=2).astype(np.uint8)
    tophat = cv2.morphologyEx(mn, cv2.MORPH_TOPHAT, np.ones((9, 9), np.uint8))
    white = ((mn > 246) | (tophat > 6)).astype(np.uint8)   # roads: white, or lighter than what's around them
    strict = (mn > 246).astype(np.uint8)                      # clearly white roads only
    thick = cv2.dilate(cv2.morphologyEx(strict, cv2.MORPH_OPEN, np.ones((21, 21), np.uint8)), np.ones((9, 9), np.uint8))
    strict[thick > 0] = 0                                     # ...not white panels such as the key box
    dt = cv2.distanceTransform(1 - white, cv2.DIST_L2, 5)
    groups = old_zone if wide else [old_zone]          # wide: a list of point groups (suburbs) where it might be
    allp = [p for gp in groups for p in gp]
    ox = [p[0] for p in allp]; oy = [p[1] for p in allp]
    lon0, lat0 = (min(ox) + max(ox)) / 2, (min(oy) + max(oy)) / 2
    mg = 0.1 if wide else 0.06
    P = load_roads([min(ox) - mg, min(oy) - mg, max(ox) + mg, max(oy) + mg])
    if len(P) < 200:
        raise RuntimeError("not enough base-map roads to line the picture up")
    X, Y = P[:, 0] - lon0, P[:, 1] - lat0

    def proj(p, X=X, Y=Y):
        ax, ay, bx, by = p
        return ax * X + bx, ay * Y + by

    def cost(p, X=X, Y=Y, cap=25):
        x, y = proj(p, X, Y)
        ok = (x >= 0) & (x < W - 1) & (y >= 0) & (y < H - 1)
        if ok.sum() < min(300, 0.05 * len(X)):
            return 1e9
        if wide and (np.ptp(x[ok]) < 0.6 * W or np.ptp(y[ok]) < 0.6 * H):   # real roads must spread across the picture
            return 1e9
        return float(np.mean(np.minimum(dt[y[ok].astype(int), x[ok].astype(int)], cap)))

    # first guess: the new outline's box sits where the old area's box was
    if poly is not None:
        px0, px1, py0, py1 = poly[:, 0].min(), poly[:, 0].max(), poly[:, 1].min(), poly[:, 1].max()
    else:
        px0, px1, py0, py1 = W * 0.2, W * 0.8, H * 0.2, H * 0.8
    ax = (px1 - px0) / (max(ox) - min(ox)); ay = -(py1 - py0) / (max(oy) - min(oy))
    s = (abs(ax) + abs(ay) * math.cos(math.radians(lat0))) / 2
    ax, ay = s, -s / math.cos(math.radians(lat0))
    bx = (px0 + px1) / 2 - ax * ((min(ox) + max(ox)) / 2 - lon0)
    by = (py0 + py1) / 2 - ay * ((min(oy) + max(oy)) / 2 - lat0)
    best = None
    if not wide:
        for f in (0.85, 0.92, 1, 1.08, 1.17):
            for dx in (-0.12, -0.06, 0, 0.06, 0.12):
                for dy in (-0.12, -0.06, 0, 0.06, 0.12):
                    p = [ax * f, ay * f, bx + dx * W, by + dy * H]
                    c = cost(p)
                    if best is None or c < best[0]:
                        best = (c, p)
        res = minimize(cost, best[1], method="Nelder-Mead", options={"maxiter": 4000, "xatol": 0.01, "fatol": 1e-4})
    else:
        # first trace of a new area: try each named suburb as the middle, and a range of map scales
        rs = np.random.default_rng(0).choice(len(X), min(len(X), 5000), replace=False)
        Xs, Ys = X[rs], Y[rs]
        cx, cy = (px0 + px1) / 2, (py0 + py1) / 2
        cents = [(np.mean([p[0] for p in gp]), np.mean([p[1] for p in gp])) for gp in groups] + [(np.mean(ox), np.mean(oy))]
        cos0 = math.cos(math.radians(lat0)); cands = []
        # score a guess both ways: real roads landing on drawn white roads (precision), and drawn white roads
        # with a real road under them (recall). One-way scoring is fooled by squeezing many real roads into the picture.
        F4 = 4
        sd = cv2.resize(strict, (W // F4, H // F4), interpolation=cv2.INTER_AREA) > 0
        sdt = cv2.distanceTransform((~sd).astype(np.uint8), cv2.DIST_L2, 3)
        nroad = max(1, int(sd.sum()))
        rs2 = np.random.default_rng(1).choice(len(X), min(len(X), 40000), replace=False)
        Xf, Yf = X[rs2], Y[rs2]
        # normalised correlation of the two road drawings (blurred, quarter size): squeezing many real roads
        # into the picture doesn't help, because only the pattern counts, not how much ink there is
        BP = {}
        for sg in (8.0, 3.0, 1.5):
            b_ = cv2.GaussianBlur(sd.astype(np.float32), (0, 0), sg).ravel()
            BP[sg] = (b_ - b_.mean()) / (b_.std() + 1e-9)
        def fscore(p, Xa=Xf, Ya=Yf, sg=1.5):
            x, y = proj(p, Xa, Ya); x = (x / F4).astype(int); y = (y / F4).astype(int)
            ok = (x >= 0) & (x < W // F4) & (y >= 0) & (y < H // F4)
            if ok.sum() < 100:
                return 0.0
            ras = np.zeros(sd.shape, np.float32); ras[y[ok], x[ok]] = 1
            ras = cv2.GaussianBlur(ras, (0, 0), sg).ravel()
            sdv = ras.std()
            return float((ras * BP[sg]).sum() / (sdv * len(ras) + 1e-9)) if sdv > 0 else 0.0
        for (clon, clat) in cents:
            for sc in np.geomspace(8000, 70000, 14):
                a_, b_ = sc, -sc / cos0
                for dx in np.linspace(-0.3, 0.3, 9):
                    for dy in np.linspace(-0.3, 0.3, 9):
                        p = [a_, b_, cx - a_ * (clon - lon0) + dx * W, cy - b_ * (clat - lat0) + dy * H]
                        cands.append((-fscore(p, sg=8.0), p))
        cands.sort(key=lambda t: t[0])
        res = None
        full = lambda q: [q[0], -q[0] / cos0, q[1], q[2]]      # north-up, true proportions
        best_q = None
        for _, p in cands[:12]:
            q0 = [p[0], p[2], p[3]]
            q = q0
            for sg, st_ in ((8.0, 60), (3.0, 20), (1.5, 8)):     # coarse to fine
                q = minimize(lambda q: -fscore(full(q), sg=sg), q, method="Nelder-Mead",
                             options={"maxiter": 500, "xatol": 0.5, "fatol": 1e-5, "initial_simplex": [q, [q[0] * (1 + st_ / 1500), q[1], q[2]], [q[0], q[1] + st_, q[2]], [q[0], q[1], q[2] + st_]]}).x
            f = fscore(full(q))
            if os.environ.get("TRACE_DEBUG"):
                print("   cand", [round(v) for v in q], "fscore", round(f, 3))
            if best_q is None or f > best_q[0]:
                best_q = (f, q)
        # polish close to the best two-way match only (scale within 4 %, shift within 25 px), keeping it north-up
        q0 = best_q[1]
        lo = [q0[0] * 0.96, q0[1] - 25, q0[2] - 25]; hi = [q0[0] * 1.04, q0[1] + 25, q0[2] + 25]
        q = minimize(lambda q: cost(full(q)), q0, method="Powell", bounds=list(zip(lo, hi)), options={"xtol": 0.01, "ftol": 1e-5}).x
        res = minimize(lambda q: cost(full(q)), q, method="Nelder-Mead", options={"maxiter": 1}); res.x = np.array(full(q)); res.fun = cost(full(q))
    ax, ay, bx, by = res.x
    if os.environ.get("TRACE_DEBUG"):
        print("  affine", [round(v, 1) for v in res.x], "centre", round(lon0, 4), round(lat0, 4), "cost", round(res.fun, 2))
    def hits(p):
        x, y = proj(p); ok = (x >= 0) & (x < W - 1) & (y >= 0) & (y < H - 1)
        return float(np.mean(dt[y[ok].astype(int), x[ok].astype(int)] < 3)) if ok.sum() > 300 else 0.0
    # how many real roads land on a drawn road, here vs. with the picture nudged 40 px: a true fit stands out
    hit = hits(res.x)
    base = float(np.mean([hits([ax, ay, bx + dx, by + dy]) for dx, dy in ((40, 0), (-40, 0), (0, 40), (0, -40))]))
    fit = {"hit": round(hit, 3), "base": round(base, 3), "ok": hit >= 0.45 and hit >= 1.6 * base}
    if debug:
        import cv2 as _c
        v = np.ascontiguousarray(im[..., ::-1].astype(np.uint8))
        x, y = proj(res.x)
        for xi, yi in zip(x.astype(int), y.astype(int)):
            if 0 <= xi < W and 0 <= yi < H: v[yi, xi] = (0, 0, 255)
        if poly is not None:
            _c.polylines(v, [poly.astype(np.int32)], True, (0, 200, 0), 3)
        _c.imwrite(debug, v)
    aff = {"ax": float(ax), "ay": float(ay), "bx": float(bx), "by": float(by), "lon0": float(lon0), "lat0": float(lat0), "w": W, "h": H}
    if poly is None:
        return None, fit, aff
    ring = [[round((x - bx) / ax + lon0, 5), round((y - by) / ay + lat0, 5)] for x, y in poly]
    ring.append(ring[0])
    return ring, fit, aff


def read_labels(img_bytes, names):
    """Read the picture's text (OCR) and find, for each key-location name, the icon or numbered circle
    next to its label. Returns {name: (x, y)} in picture pixels for the names it could find."""
    import cv2, difflib, pytesseract
    from PIL import Image
    pim = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    im = np.array(pim).astype(int); H, W = im.shape[:2]
    s1 = max(1, math.ceil(1500 / W))
    words = []
    # several OCR passes (sizes, page modes, colour/grey) catch more labels than any single one
    for sc, psm, grey in ((s1, 11, True), (s1, 3, False), (s1, 12, False), (2 * s1, 12, False), (2 * s1, 11, True)):
        big = pim.resize((W * sc, H * sc))
        if grey:
            big = big.convert("L")
        d = pytesseract.image_to_data(big, output_type=pytesseract.Output.DICT, config=f"--psm {psm}")
        for i, t in enumerate(d["text"]):
            t = re.sub(r"[^a-z0-9']", "", t.lower())
            if len(t) >= 2 and float(d["conf"][i]) > 30:
                w = (t, d["left"][i] / sc, d["top"][i] / sc, d["width"][i] / sc, d["height"][i] / sc)
                if not any(o[0] == t and abs(o[1] - w[1]) < 5 and abs(o[2] - w[2]) < 5 for o in words):
                    words.append(w)
    # markers: black icons and filled navy number circles
    dark = ((im.max(axis=2) < 90) | ((im[..., 0] < 90) & (im[..., 1] < 100) & (im[..., 2] > 55) & (im[..., 2] - im[..., 0] > 18))).astype(np.uint8)
    ke = max(3, round(W / 266))
    blob = cv2.dilate(cv2.erode(dark, np.ones((ke, ke), np.uint8)), np.ones((ke + 4, ke + 4), np.uint8))
    nb, lb, sb, cen = cv2.connectedComponentsWithStats(blob)
    marks = [tuple(cen[i]) for i in range(1, nb) if 0.008 * W <= sb[i, 3] <= 0.035 * W and sb[i, 2] < 4 * sb[i, 3]]

    def like(t, w):
        return difflib.SequenceMatcher(None, t, w).ratio() >= 0.8 or (len(t) >= 5 and len(w) >= 4 and (t.startswith(w) or w.startswith(t)))

    found = {}
    for name in names:
        toks = [t for t in re.split(r"[^a-z0-9']+", name.lower().replace(".", "")) if len(t) >= 2]
        if not toks:
            continue
        need = 1 if len(toks) == 1 else max(2, math.ceil(0.75 * len(toks)))
        cand = {t: [w for w in words if like(t, w[0])] for t in toks}
        best = None
        for t0 in toks:
            for w0 in cand[t0]:           # build the label around each place a word of the name appears
                pick, lh = [w0], w0[4]
                for t in toks:
                    if t == t0:
                        continue
                    near = [w for w in cand[t] if abs(w[2] - w0[2]) < 4.5 * lh and abs(w[1] - w0[1]) < 14 * lh and w not in pick]
                    if near:
                        pick.append(min(near, key=lambda w: abs(w[2] - w0[2]) + abs(w[1] - w0[1])))
                if len(pick) < need:
                    continue
                x0 = min(w[1] for w in pick); y0 = min(w[2] for w in pick)
                x1 = max(w[1] + w[3] for w in pick); y1 = max(w[2] + w[4] for w in pick)
                key = (-len(pick) / len(toks), (x1 - x0) + (y1 - y0))
                if best is None or key < best[0]:
                    best = (key, (x0, y0, x1, y1), lh)
        if not best:
            continue
        x0, y0, x1, y1 = best[1]; lh = best[2]
        gap = lambda m: math.hypot(max(x0 - m[0], 0, m[0] - x1), max(y0 - m[1], 0, m[1] - y1))
        near = [m for m in marks if gap(m) < 4 * lh]
        if near:
            m = min(near, key=gap)
            found[name] = (m[0], m[1], gap(m), best[0][0])
    # one icon belongs to one label: if two names landed on the same icon, keep the better-read one
    out = {}
    for n, (x, y, g, k) in found.items():
        rival = [o for o, v in found.items() if o != n and abs(v[0] - x) < 2 and abs(v[1] - y) < 2]
        if all((k, g) < (found[o][3], found[o][2]) for o in rival):
            out[n] = (round(x, 1), round(y, 1))
    return out


def fit_labels(px, known):
    """Line the picture up from key locations whose real position is known (Translink stops etc.).
    px: {name: (x, y)}, known: {name: [lon, lat]}. Returns a pixel -> [lon, lat] function, or None."""
    pts = [(px[n], known[n]) for n in px if n in known]
    if len(pts) < 2:
        return None
    lat0 = sum(ll[1] for _, ll in pts) / len(pts); c = math.cos(math.radians(lat0))
    # north-up map with true proportions: x = s*lon*c + bx, y = -s*lat + by
    A, b = [], []
    for (x, y), (lon, lat) in pts:
        A.append([lon * c, 1, 0]); b.append(x)
        A.append([-lat, 0, 1]); b.append(y)
    sol, *_ = np.linalg.lstsq(np.array(A), np.array(b), rcond=None)
    s_, bx, by = sol
    if s_ <= 0:
        return None
    to_ll = lambda x, y: [round((x - bx) / (s_ * c), 6), round((by - y) / s_, 6)]
    err = [math.dist(to_ll(*p), ll) * 100000 for p, ll in pts]    # metres, roughly
    if max(err) > 250:
        return None
    return to_ll


def overlap(a, b):
    from shapely.geometry import Polygon
    A, B = Polygon(a).buffer(0), Polygon(b).buffer(0)
    return A.intersection(B).area / max(A.union(B).area, 1e-12), A.area / max(B.area, 1e-12)


def main():
    global changed
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
                today = datetime.date.today().isoformat()
                if pic.get("auto") is False:
                    # shown on the map's on-demand card (see build_ondemand.py), not raised as an issue
                    if old.get("pending_sha") != sha:
                        META[zid] = {**old, "pending_url": url, "pending_sha": sha, "pending_since": today,
                                     "pending_why": "Translink's map for this area has labels drawn across its edge, so it can't be re-traced automatically"}
                        changed = True
                    print(f"{zid}: picture changed, can't be re-traced automatically; noted on the map")
                    continue
                ring, fit, aff = trace(data, TRACED[zid], pic.get("outline", "navy"), os.environ.get("TRACE_DEBUG") and f"/tmp/trace_{zid}.png")
                iou, ratio = overlap(ring, TRACED[zid])
                print(f"{zid}: re-traced, roads matched {fit['hit']:.0%} (vs {fit['base']:.0%} when nudged), overlap {iou:.2f}, size x{ratio:.2f}")
                if not fit["ok"] or iou < 0.6 or not 0.5 < ratio < 2:
                    # not confident: keep the previous outline and say so on the map's on-demand card
                    if old.get("pending_sha") != sha:
                        META[zid] = {**old, "pending_url": url, "pending_sha": sha, "pending_since": today,
                                     "pending_why": "the new map couldn't be lined up with the roads confidently" if not fit["ok"]
                                     else "the new area was too different from the old one to accept without a check"}
                        changed = True
                    continue
                TRACED[zid] = ring
                keep = {k: v for k, v in old.items() if k in ("labels", "labels_key", "dropped")}   # lets the build spot key locations Translink removed
                META[zid] = {**keep, "url": url, "sha": sha, "affine": aff, "updated": today}; changed = True
                print(f"{zid}: outline updated from Translink's new map")
            except Exception as e:
                notes.append(f"{area['name']} ({g['name']}): couldn't check the map picture ({e}). The map keeps the current outline.")

    if changed:
        with open(TPATH, "w") as f:
            json.dump(TRACED, f, indent=0)
    if notes:
        with open(os.path.join(REPO, "zone_check.txt"), "a") as f:
            f.write("\n### On-demand map pictures\n\n" + "\n".join("- " + n for n in notes) + "\n")
        print("\n".join(notes))


if __name__ == "__main__":
    main()
