#!/usr/bin/env python3
"""Trace The Wave's corridor and station precincts from TMR's published corridor maps -> tools/wave_geom.json

Usage: trace_wave.py <repo> [--force] [--debug DIR]

TMR publishes The Wave (Stages 1 and 2) as a PDF of aerial-photo map pages, with the rail corridor drawn in purple
and station precincts in pink on the photo, and street names as text on top. For each map page this script:
  1. picks out the purple and pink areas from the page's photo (the photo itself is greyscale);
  2. works out where the page sits on the ground by matching its street-name labels (e.g. "Caloundra Road",
     "Nicklin Way") to the same named streets in the map's own base map, trying every rotation and scale and keeping
     the fit where the most labels land on their streets; then tightens the fit so each label sits on its street;
  3. turns the coloured areas into map shapes.
Pages whose fit isn't confident (fewer than 4 labels within 25 m of their streets) are skipped and reported.
The shapes from all pages are joined into one corridor and one shape per station precinct.

Runs in the weekly refresh but only re-traces when TMR's PDF changes (its address or size). If the PDF can't be read,
the previous shapes stay.
"""
import sys, os, io, re, json, math, gzip, hashlib
import numpy as np, requests

REPO = sys.argv[1] if len(sys.argv) > 1 else "."
FORCE = "--force" in sys.argv
DEBUG = sys.argv[sys.argv.index("--debug") + 1] if "--debug" in sys.argv else None
OUT = os.path.join(REPO, "tools", "wave_geom.json")
PAGE = "https://www.yoursay-projects.tmr.qld.gov.au/thewaverail/project-location-and-maps"
FALLBACK_PDF = "https://hdp-au-prod-app-qldtmr-yoursay-files.s3.ap-southeast-2.amazonaws.com/1017/7751/4650/26_00011A_TWR_Corridor_Maps_Brand_Update_WEB_V1.pdf"
BBOX = (152.80, -26.98, 153.20, -26.60)        # Beerwah to Maroochydore
LON0, LAT0 = 153.0, -26.8
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110574
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0 (seq-transport-map weekly refresh)"
STATIONS = ["Beerwah", "Bells Creek", "Caloundra", "Aroona", "Birtinya"]


def to_m(lon, lat): return ((lon - LON0) * KX, (lat - LAT0) * KY)
def to_ll(x, y): return (x / KX + LON0, y / KY + LAT0)


def find_pdf():
    try:
        h = S.get(PAGE, timeout=60).text
        m = re.findall(r'https://[^"\']+Corridor_Maps[^"\']+\.pdf', h)
        if m:
            return m[0]
    except Exception:
        pass
    return FALLBACK_PDF


def norm(n):
    n = n.lower().replace("’", "'")
    for a, b in ((" road", " rd"), (" street", " st"), (" drive", " dr"), (" avenue", " ave"), (" boulevard", " bvd"), (" parade", " pde"),
                 (" circuit", " cct"), (" crescent", " cres"), (" highway", " hwy"), (" place", " pl"), (" court", " ct"), (" way", " wy"),
                 (" terrace", " tce"), (" lane", " ln"), (" motorway", " mwy"), (" close", " cl"), (" linkway", " lkwy")):
        n = n.replace(a, b)
    return re.sub(r"[^a-z0-9]", "", n)


def base_roads():
    """Named roads in the area from the base map, as dense point sets in metres, by normalised name."""
    from pmtiles.reader import Reader, MmapSource
    import mapbox_vector_tile
    Z = 14; N = 2 ** Z
    tx = lambda lon: int((lon + 180) / 360 * N)
    ty = lambda lat: int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * N)
    rd = Reader(MmapSource(open(os.path.join(REPO, "tiles", "seq.pmtiles"), "rb")))
    roads = {}
    for x in range(tx(BBOX[0]), tx(BBOX[2]) + 1):
        for y in range(ty(BBOX[3]), ty(BBOX[1]) + 1):
            d = rd.get(Z, x, y)
            if not d:
                continue
            try:
                d = gzip.decompress(d)
            except OSError:
                pass
            L = mapbox_vector_tile.decode(d).get("roads")
            if not L:
                continue
            e = L["extent"]
            for f in L["features"]:
                nm = f["properties"].get("name")
                if not nm or f["geometry"]["type"] not in ("LineString", "MultiLineString"):
                    continue
                lines = f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiLineString" else [f["geometry"]["coordinates"]]
                for ln in lines:
                    pts = []
                    for (px, py) in ln:
                        lon = (x + px / e) / N * 360 - 180
                        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1 - py / e) / N))))
                        pts.append(to_m(lon, lat))
                    for a, b in zip(pts, pts[1:]):           # densify to about 10 m
                        k = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 10))
                        roads.setdefault(norm(nm), []).extend((a[0] + (b[0] - a[0]) * t / k, a[1] + (b[1] - a[1]) * t / k) for t in range(k))
    return {k: np.array(v) for k, v in roads.items()}


def labels(page, roads):
    """Street labels on the map: rotated text (callout boxes are horizontal), whose name is a base-map street."""
    out = {}
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"]).strip()
            if len(t) < 5 or norm(t) not in roads:
                continue
            dx, dy = l["dir"]
            if abs(dy) < 0.03 and not re.search(r"(Road|Street|Drive|Way|Avenue|Boulevard|Parade|Highway|Motorway|Circuit|Crescent|Place|Court|Terrace|Lane|Close)$", t):
                continue
            x0, y0, x1, y1 = l["bbox"]
            out[((round((x0 + x1) / 2), round((y0 + y1) / 2)))] = norm(t)
    return [(np.array(k, float), v) for k, v in out.items()]


def fit(labs, roads):
    """Similarity transform page -> metres (page y flipped) maximising labels that land on their own street."""
    P = np.array([[p[0], -p[1]] for p, _ in labs]); names = [n for _, n in labs]
    R_ = [roads[n] for n in names]
    best = (0, None)
    allpts = np.concatenate(R_); lid = np.concatenate([np.full(len(r), i) for i, r in enumerate(R_)])
    for s in np.exp(np.linspace(math.log(0.6), math.log(14), 34)):           # metres per PDF point
        for th in np.radians(np.arange(0, 360, 2)):
            c, sn = math.cos(th), math.sin(th)
            sp = s * np.stack([c * P[:, 0] - sn * P[:, 1], sn * P[:, 0] + c * P[:, 1]], 1)
            t = allpts - sp[lid]                                              # where the page origin would be
            k = np.floor(t / 40).astype(np.int64); key = (k[:, 0] + 100000) * 200000 + (k[:, 1] + 100000)
            u = np.unique(key * 64 + lid) // 64                               # one vote per label per bin
            vals, cnt = np.unique(u, return_counts=True)
            j = cnt.argmax()
            if cnt[j] > best[0]:
                kx, ky = divmod(int(vals[j]), 200000)
                best = (int(cnt[j]), (s, th, (np.array([kx - 100000, ky - 100000]) + 0.5) * 40))
    if not best[1]:
        return None
    s, th, t = best[1]
    # tighten: each label pulled onto the nearest point of its own street, solve similarity by least squares, repeat
    A = np.array([s * math.cos(th), s * math.sin(th)]); T = t.copy()
    for _ in range(15):
        a, b = A
        Q = np.stack([a * P[:, 0] - b * P[:, 1] + T[0], b * P[:, 0] + a * P[:, 1] + T[1]], 1)
        tgt = np.array([R_[i][np.argmin(((R_[i] - Q[i]) ** 2).sum(1))] for i in range(len(P))])
        err = np.hypot(*(tgt - Q).T)
        keep = err < max(25, np.median(err) * 2.5)
        if keep.sum() < 3:
            break
        X = []; Y = []
        for (px, py), (gx, gy) in zip(P[keep], tgt[keep]):
            X += [[px, -py, 1, 0], [py, px, 0, 1]]; Y += [gx, gy]
        a, b, tx_, ty_ = np.linalg.lstsq(np.array(X), np.array(Y), rcond=None)[0]
        A = np.array([a, b]); T = np.array([tx_, ty_])
    a, b = A
    Q = np.stack([a * P[:, 0] - b * P[:, 1] + T[0], b * P[:, 0] + a * P[:, 1] + T[1]], 1)
    err = np.array([np.sqrt(((R_[i] - Q[i]) ** 2).sum(1).min()) for i in range(len(P))])
    return {"a": float(a), "b": float(b), "t": T.tolist(), "inliers": int((err < 25).sum()), "n": len(P), "median": float(np.median(err))}


def fit_weak(labs, roads, north, scales):
    """For pages with only 2-3 street names: rotation from the north arrow, scale from the neighbouring pages, and only
    the position solved from the street names. Needs at least two names agreeing within 25 m."""
    if north is None or len(labs) < 2:
        return None
    P = np.array([[p[0], -p[1]] for p, _ in labs]); R_ = [roads[n] for _, n in labs]
    th0 = math.atan2(1, 0) - math.atan2(-north[1], north[0])
    allpts = np.concatenate(R_); lid = np.concatenate([np.full(len(r), i) for i, r in enumerate(R_)])
    best = None
    for s in scales:
        for dth in np.radians(np.arange(-6, 7, 1)):
            th = th0 + dth; c, sn = math.cos(th), math.sin(th)
            sp = s * np.stack([c * P[:, 0] - sn * P[:, 1], sn * P[:, 0] + c * P[:, 1]], 1)
            t = allpts - sp[lid]; k = np.floor(t / 15).astype(np.int64); key = (k[:, 0] + 1000000) * 2000000 + (k[:, 1] + 1000000)
            u = np.unique(key * 64 + lid) // 64; vals, cnt = np.unique(u, return_counts=True); j = cnt.argmax()
            if cnt[j] >= 2 and (best is None or cnt[j] > best[0]):
                kx, ky = divmod(int(vals[j]), 2000000)
                T = (np.array([kx - 1000000, ky - 1000000]) + 0.5) * 15
                Q = sp + T; err = np.array([np.sqrt(((R_[i] - Q[i]) ** 2).sum(1).min()) for i in range(len(P))])
                best = (int(cnt[j]), {"a": s * c, "b": s * sn, "t": T.tolist(), "inliers": int((err < 25).sum()), "n": len(P), "median": float(np.median(err)), "weak": True})
    return best[1] if best else None


def band_ends(page, doc):
    """Page coordinates of the two ends of the purple corridor on a page (furthest apart along its main direction)."""
    import cv2
    best = max(page.get_images(full=True), key=lambda im: im[2] * im[3])
    img = cv2.imdecode(np.frombuffer(doc.extract_image(best[0])["image"], np.uint8), cv2.IMREAD_COLOR)
    rect = page.get_image_rects(best[0])[0]; h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); H, Sv, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    ys, xs = np.nonzero((H >= 110) & (H <= 130) & (Sv >= 55) & (Sv <= 150) & (V >= 110))
    if len(xs) < 500:
        return None
    P = np.stack([rect.x0 + (xs + .5) / w * rect.width, rect.y0 + (ys + .5) / h * rect.height], 1)
    c = P.mean(0); u = np.linalg.svd(P - c, full_matrices=False)[2][0]; d = (P - c) @ u
    return P[d < np.percentile(d, 1)].mean(0), P[d > np.percentile(d, 99)].mean(0)


def fit_chain(page, doc, labs, roads, north, scales, known):
    """For pages with a single street name: of the positions that put that name on its street (rotation from the north
    arrow, scale from neighbouring pages), take the one where the page's corridor ends join the traced corridor."""
    from scipy.spatial import cKDTree
    ends = band_ends(page, doc)
    if north is None or not labs or ends is None or not len(known):
        return None
    tree = cKDTree(known); th0 = math.atan2(1, 0) - math.atan2(-north[1], north[0]); best = None
    E = np.array([[ends[0][0], -ends[0][1]], [ends[1][0], -ends[1][1]]])
    for (p, n) in labs:
        pts = roads[n][::2]; q = np.array([p[0], -p[1]])
        for s in scales:
            for dth in np.radians(np.arange(-6, 7, 2)):
                th = th0 + dth; c, sn = math.cos(th), math.sin(th); R = np.array([[c, -sn], [sn, c]]) * s
                T = pts - R @ q                              # every position putting the name on its street
                e0 = T + R @ E[0]; e1 = T + R @ E[1]
                d0, _ = tree.query(e0); d1, _ = tree.query(e1)
                score = np.minimum(d0, 600) + np.minimum(d1, 600)
                j = int(score.argmin())
                if best is None or score[j] < best[0]:
                    best = (float(score[j]), {"a": s * c, "b": s * sn, "t": T[j].tolist(), "inliers": 1, "n": len(labs), "median": 0.0, "weak": True, "joined": [float(d0[j]), float(d1[j])]})
    # at least one end must join the traced corridor closely
    return best[1] if best and min(best[1]["joined"]) < 80 else None


def shapes_on(page, doc, tf):
    """Purple (corridor) and pink (station) areas of the page's photo, as polygons in lon/lat."""
    import cv2
    from shapely.geometry import Polygon
    best = max(page.get_images(full=True), key=lambda im: im[2] * im[3])
    img = cv2.imdecode(np.frombuffer(doc.extract_image(best[0])["image"], np.uint8), cv2.IMREAD_COLOR)
    rect = page.get_image_rects(best[0])[0]; h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); H, Sv, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    masks = {"corridor": ((H >= 110) & (H <= 130) & (Sv >= 55) & (Sv <= 150) & (V >= 110)),
             "station": (((H >= 155) | (H <= 3)) & (Sv >= 110) & (V >= 130))}
    a, b = tf["a"], tf["b"]; T = tf["t"]
    out = {}
    for k, m in masks.items():
        m = cv2.morphologyEx(m.astype(np.uint8) * 255, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        polys = []
        for c in cs:
            if cv2.contourArea(c) < 150:
                continue
            ring = []
            for (px, py) in c[:, 0, :]:
                X = rect.x0 + (px + 0.5) / w * rect.width; Y = rect.y0 + (py + 0.5) / h * rect.height
                ring.append(to_ll(a * X - b * (-Y) + T[0], b * X + a * (-Y) + T[1]))
            if len(ring) >= 4:
                g = Polygon(ring).buffer(0)
                if not g.is_empty:
                    polys.append(g)
        out[k] = polys
    return out


def main():
    import pymupdf as fitz
    from shapely.geometry import mapping, Point
    from shapely.ops import unary_union
    old = json.load(open(OUT)) if os.path.exists(OUT) else {}
    url = find_pdf()
    try:
        r = S.get(url, timeout=120); r.raise_for_status(); pdf = r.content
    except Exception as e:
        print("wave: couldn't read TMR's corridor maps; keeping the previous shapes:", e); return
    sig = hashlib.sha1(pdf).hexdigest()[:16]
    if old.get("sig") == sig and not FORCE:
        print("wave: corridor maps unchanged"); return
    roads = base_roads(); doc = fitz.open(stream=pdf, filetype="pdf")
    corr, stations, report, fits, weak = [], [], [], {}, []
    for i, page in enumerate(doc):
        if not page.get_images() or not page.get_text().strip():
            continue
        labs = labels(page, roads)
        if not re.search(r"Rail corridor", page.get_text()):
            continue
        tf = fit(labs, roads) if len(labs) >= 4 else None
        if tf and tf["inliers"] >= 4 and tf["median"] <= 25:
            fits[i] = tf
        else:
            weak.append((i, labs))
    for i, labs in weak:   # rotation from the north arrow, scale from the nearest well-fitted pages
        near = sorted(fits, key=lambda j: abs(j - i))[:3]
        sc = sorted(math.hypot(fits[j]["a"], fits[j]["b"]) for j in near)
        scales = np.linspace(min(sc) * 0.97, max(sc) * 1.03, 7) if sc else []
        tf = fit_weak(labs, roads, north_arrow(doc[i]), scales)
        if tf and tf["inliers"] >= 2 and tf["median"] <= 25:
            fits[i] = tf
        else:
            report.append(f"page {i + 1}: only {len(labs)} street names to place it by; corridor joined across it instead")
    # pages with a single street name: placed so their corridor joins the corridor already traced either side
    done = {i: shapes_on(doc[i], doc, fits[i]) for i in fits}
    known = [to_m(x, y) for sh in done.values() for g in sh["corridor"] for x, y in g.exterior.coords]
    for i, labs in weak:
        if i in fits:
            continue
        near = sorted(fits, key=lambda j: abs(j - i))[:3]; sc = sorted(math.hypot(fits[j]["a"], fits[j]["b"]) for j in near)
        tf = fit_chain(doc[i], doc, labs, roads, north_arrow(doc[i]), np.linspace(min(sc) * 0.97, max(sc) * 1.03, 5), np.array(known))
        if tf:
            fits[i] = tf; done[i] = shapes_on(doc[i], doc, tf)
            report = [r for r in report if not r.startswith(f"page {i + 1}:")]
    # pages placed from only one to three street names must agree with a neighbouring page where they overlap
    from scipy.spatial import cKDTree
    def agree(i):
        mine = np.array([to_m(x, y) for g in done[i]["corridor"] for x, y in g.exterior.coords])
        others = [to_m(x, y) for j in done if j != i and not fits[j].get("weak") for g in done[j]["corridor"] for x, y in g.exterior.coords]
        if not len(mine) or not others:
            return False
        d, _ = cKDTree(np.array(others)).query(mine)
        near = d < 250
        return near.sum() >= 30 and (d[near] < 25).mean() >= 0.6
    for i in [i for i in fits if fits[i].get("weak")]:
        if not agree(i):
            report = [r for r in report if not r.startswith(f"page {i + 1}:")] + [f"page {i + 1}: couldn't be placed to agree with its neighbours; corridor joined across it instead"]
            del fits[i]; del done[i]
    for i in sorted(fits):
        tf = fits[i]; sh = done[i]
        corr += sh["corridor"]; stations += [(g, i) for g in sh["station"]]
        report.append(f"page {i + 1}: {tf['inliers']}/{tf['n']} street names on their streets (median {tf['median']:.0f} m){' using the north arrow' if tf.get('weak') else ''}{' and joining its neighbours' if tf.get('joined') else ''}")
        if DEBUG:
            os.makedirs(DEBUG, exist_ok=True)
            json.dump({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"k": k}, "geometry": mapping(g if k == "corridor" else g)} for k in sh for g in sh[k]]},
                      open(os.path.join(DEBUG, f"page{i + 1}.geojson"), "w"))
    report.sort(key=lambda r: int(r.split()[1].rstrip(":")))
    print("\n".join(report))
    if not corr:
        print("wave: nothing traced; keeping the previous shapes"); return
    C = unary_union([g.buffer(0.00004) for g in corr]).buffer(-0.00004)
    # join the gaps left by pages that couldn't be placed: from the end of one traced piece to the start of the next
    pieces = sorted((list(C.geoms) if hasattr(C, "geoms") else [C]), key=lambda g: -g.area)
    pieces = [g for g in pieces if g.area * KX * KY > 2000]
    def ends(g):
        P = np.array([to_m(x, y) for x, y in g.exterior.coords]); c = P.mean(0)
        u = np.linalg.svd(P - c, full_matrices=False)[2][0]; d = (P - c) @ u
        return [P[d.argmin()], P[d.argmax()]]
    joins = []
    if len(pieces) > 1:   # chain pieces from Beerwah (south-west) along the route by nearest ends
        E = {k: ends(g) for k, g in enumerate(pieces)}
        start = min(E, key=lambda k: min(e[0] + e[1] for e in E[k]))
        order = [start]; left = set(E) - {start}
        cur = max(E[start], key=lambda e: e[0] + e[1])
        while left:
            k, e_in = min(((k, e) for k in left for e in E[k]), key=lambda ke: np.hypot(*(ke[1] - cur)))
            if np.hypot(*(e_in - cur)) > 8000:
                break
            if np.hypot(*(e_in - cur)) > 40:
                joins.append([list(to_ll(*cur)), list(to_ll(*e_in))])
            other = [e for e in E[k] if e is not e_in][0]
            order.append(k); left.discard(k); cur = other
    St = unary_union([g.buffer(0.00004) for g, _ in stations]).buffer(-0.00004)
    parts = [g for g in (list(St.geoms) if hasattr(St, "geoms") else [St]) if g.area * KX * KY > 3000]
    out = {"sig": sig, "pdf": url, "corridor": mapping(C.simplify(0.00003)), "joins": [[[round(v, 6) for v in p] for p in j] for j in joins],
           "stations": [mapping(g.simplify(0.00002)) for g in parts], "report": report}
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print(f"wave: corridor traced from {len(fits)} pages; {len(out['stations'])} station areas")



def north_arrow(page):
    """Direction of north on the page, as a unit vector in page coordinates (y down), or None. The north arrow (top
    right) is a navy arrowhead of four corners: tip, two wings and a notch. North points from the notch to the tip."""
    W = page.rect.width; best = None
    for d in page.get_drawings():
        r = d["rect"]; f = d.get("fill")
        if not (f and abs(f[0] - 0.024) < 0.03 and abs(f[2] - 0.447) < 0.05 and 12 < max(r.width, r.height) < 45 and r.x0 > W - 260 and r.y0 < 360):
            continue
        pts = []
        for it in d["items"]:
            for q in it[1:]:
                if hasattr(q, "x") and not any(abs(q.x - u[0]) < .5 and abs(q.y - u[1]) < .5 for u in pts):
                    pts.append((q.x, q.y))
        if len(pts) == 4 and (best is None or r.width * r.height > best[0]):
            best = (r.width * r.height, np.array(pts))
    if not best:
        return None
    P = best[1]; c = P.mean(0)
    notch = P[np.argmin(((P - c) ** 2).sum(1))]; tip = P[np.argmax(((P - notch) ** 2).sum(1))]
    v = tip - notch
    return v / np.linalg.norm(v)



# ---------------------------------------------------------------- Stage 3 (metro), from TMR's overview map picture
S3PAGE = "https://www.yoursay-projects.tmr.qld.gov.au/the-wave-stage3-metro/new-public-transport-corridor"


def stage3(roads_all):
    """Trace Stage 3 from TMR's overview map: the medium-blue line with white dashes, from the Sunshine Coast University
    Hospital to the airport with the spur to Maroochydore CBD. The picture is north-up; it's placed from its markers (whose
    positions TMR publishes for its interactive map) next to known places, then tightened so the picture's grey roads sit
    on the real roads. Returns lines, station points and a note, or None."""
    import cv2
    from skimage.morphology import skeletonize
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    from scipy.ndimage import distance_transform_edt
    page = S.get(S3PAGE, timeout=60).text
    img_url = re.findall(r'https://[^"\']+Stage_3[^"\']+WPM[^"\']+\.jpg', page)
    i = page.find('"posX"'); j = page.rfind('[{"id":', 0, i)
    if not img_url or j < 0:
        return None
    markers, _ = json.JSONDecoder().raw_decode(page[j:])
    im = cv2.imdecode(np.frombuffer(S.get(img_url[0], timeout=120).content, np.uint8), cv2.IMREAD_COLOR); h, w = im.shape[:2]
    Bc, Gc, Rc = [im[..., k].astype(int) for k in range(3)]
    mk = {}
    for m in markers:
        mk[m["title"]] = (m["posX"] / 100 * w, m["posY"] / 100 * h, re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", html_unescape(m.get("description") or ""))).strip())
    # 1. control points: marker next to a known place
    ctrl = []
    places = {p[0]: (p[3], p[4]) for p in json.load(open(os.path.join(REPO, "data", "addr", "places.json")))}
    pairs = [("Sunshine Coast University Hospital station", places.get("Sunshine Coast University Hospital")),
             ("Sunshine Coast Airport precinct", (153.08883, -26.60535))]   # the airport terminal
    for t, ll in pairs:
        if t in mk and ll:
            ctrl.append(((mk[t][0], mk[t][1]), to_m(*ll)))
    old = json.load(open(OUT)) if os.path.exists(OUT) else {}
    if len(ctrl) < 2:
        return None
    (p1, g1), (p2, g2) = ctrl[:2]
    s0 = math.hypot(g2[0] - g1[0], g2[1] - g1[1]) / math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    T0 = np.array(g1) - s0 * np.array([p1[0], -p1[1]])
    # 2. tighten: the picture's grey roads onto the real roads (scale and position; the picture is north-up)
    grey = (np.abs(Bc - Gc) < 10) & (np.abs(Gc - Rc) < 10) & (Bc > 150) & (Bc < 222)
    grey[: int(h * 0.15), : int(w * 0.7)] = False
    ys, xs = np.nonzero(grey); pick = np.random.default_rng(1).choice(len(xs), min(4000, len(xs)), replace=False)
    GP = np.stack([xs[pick], -ys[pick]], 1).astype(float)
    allr = np.concatenate(list(roads_all.values())); lo = allr.min(0) - 2000; res = 8.0
    shape = (int((allr[:, 1].max() + 2000 - lo[1]) / res) + 1, int((allr[:, 0].max() + 2000 - lo[0]) / res) + 1)
    grid = np.ones(shape, bool); ij = ((allr - lo) / res).astype(int); grid[ij[:, 1], ij[:, 0]] = False
    dist = distance_transform_edt(grid) * res
    def score(s_, T):
        q = ((s_ * GP + T - lo) / res).astype(int)
        ok = (q[:, 0] >= 0) & (q[:, 1] >= 0) & (q[:, 0] < shape[1]) & (q[:, 1] < shape[0])
        d = np.full(len(q), 80.0); d[ok] = np.minimum(dist[q[ok, 1], q[ok, 0]], 80); return d.mean()
    best = (score(s0, T0), s0, T0)
    for s_ in s0 * np.linspace(0.85, 1.15, 31):
        for dx in np.arange(-800, 801, 40):
            for dy in np.arange(-800, 801, 40):
                T = T0 + [dx, dy] + (s0 - s_) * np.array([p1[0], -p1[1]])
                v = score(s_, T)
                if v < best[0]:
                    best = (v, s_, T)
    v, s_, T = best
    for _ in range(2):   # finer
        for ds in np.linspace(0.985, 1.015, 7):
            for dx in np.arange(-40, 41, 8):
                for dy in np.arange(-40, 41, 8):
                    T2 = T + [dx, dy]; v2 = score(s_ * ds, T2)
                    if v2 < v:
                        v, s_, T = v2, s_ * ds, T2
    to = lambda x, y: to_ll(s_ * x + T[0], -s_ * y + T[1])
    # 3. the dashed blue line, thinned to a centreline
    blue = (Bc > 140) & (Gc > 55) & (Gc < 130) & (Rc < 70); blue[: int(h * 0.15), : int(w * 0.7)] = False
    white = (Bc > 225) & (Gc > 225) & (Rc > 225)
    cl = cv2.morphologyEx(blue.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)).astype(bool)
    near_dash = cv2.dilate((cl & white).astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool)
    line = cl & near_dash
    n, lab, st, _ = cv2.connectedComponentsWithStats(line.astype(np.uint8)); keep = np.zeros_like(line)
    for k in range(1, n):
        if st[k, 4] > 3000:
            keep |= lab == k
    sk = skeletonize(keep); ys, xs = np.nonzero(sk); idx = -np.ones(sk.shape, int); idx[ys, xs] = np.arange(len(xs))
    rows, cols, wts = [], [], []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx or dy:
                y2, x2 = ys + dy, xs + dx; ok = (y2 >= 0) & (x2 >= 0) & (y2 < h) & (x2 < w)
                nb = np.full(len(xs), -1); nb[ok] = idx[y2[ok], x2[ok]]; ok = nb >= 0
                rows += list(np.nonzero(ok)[0]); cols += list(nb[ok]); wts += [math.hypot(dx, dy)] * int(ok.sum())
    # where the solid interchange band crosses the line its dashes stop, leaving a short break: bridge breaks under 90 px
    from scipy.sparse.csgraph import connected_components
    from scipy.spatial import cKDTree
    G0 = coo_matrix((wts, (rows, cols)), shape=(len(xs), len(xs))).tocsr(); nc, comp = connected_components(G0, directed=False)
    P = np.stack([xs, ys], 1)
    for a_ in range(nc):
        for b_ in range(a_ + 1, nc):
            ia, ib = np.nonzero(comp == a_)[0], np.nonzero(comp == b_)[0]
            if len(ia) < 50 or len(ib) < 50:
                continue
            d, k = cKDTree(P[ib]).query(P[ia]); m = int(d.argmin())
            if d[m] < 90:
                rows += [ia[m], ib[k[m]]]; cols += [ib[k[m]], ia[m]]; wts += [float(d[m])] * 2
    Gr = coo_matrix((wts, (rows, cols)), shape=(len(xs), len(xs))).tocsr()
    snap = lambda t: int(np.argmin((xs - mk[t][0]) ** 2 + (ys - mk[t][1]) ** 2))
    def path(a, b):
        _, pred = dijkstra(Gr, indices=a, return_predecessors=True); out = [b]
        while out[-1] != a and pred[out[-1]] >= 0:
            out.append(pred[out[-1]])
        return out[::-1] if out[-1] == a else []
    lines = []
    main = path(snap("Sunshine Coast University Hospital station"), snap("Sunshine Coast Airport precinct"))
    spur = path(snap("Maroochydore CBD station precinct"), main[len(main) // 2]) if main and "Maroochydore CBD station precinct" in mk else []
    for pth, nm in ((main, "main"), (spur, "spur")):
        if len(pth) > 10:
            c = [to(xs[k], ys[k]) for k in pth[::6]]
            lines.append({"name": nm, "coords": [[round(x, 6), round(y, 6)] for x, y in c]})
    # pin the stations TMR's detailed maps place exactly, and bend the rest of the line smoothly between them: the
    # overview draws station icons side by side, so it's only good to a few hundred metres near them
    from scipy.spatial import cKDTree
    pins = []
    if "ecclesbvd" in roads_all and "dohertyst" in roads_all:      # hospital station: Eccles Boulevard at Doherty Street
        d, k = cKDTree(roads_all["dohertyst"]).query(roads_all["ecclesbvd"]); pins.append(("Sunshine Coast University Hospital station", roads_all["ecclesbvd"][int(d.argmin())]))
    rail = [np.array(to_m(*shape_centroid(g))) for g in (old.get("stations") or [])]
    if rail and "Birtinya station precinct" in mk:                 # Birtinya: beside the rail station
        b0 = np.array(to_m(*to(*mk["Birtinya station precinct"][:2]))); pins.append(("Birtinya station precinct", min(rail, key=lambda q: np.hypot(*(q - b0)))))
    pins.append(("Sunshine Coast Airport precinct", np.array(to_m(153.08883, -26.60535))))
    src = [np.array(to_m(*to(*mk[t][:2]))) for t, _ in pins if t in mk]; dst = [q for t, q in pins if t in mk]
    def bend(lon, lat):
        q = np.array(to_m(lon, lat)); w = np.array([1 / (np.hypot(*(q - s0)) ** 2 + 300 ** 2) for s0 in src])
        off = sum(wi * (d0 - s0) for wi, s0, d0 in zip(w, src, dst)) / w.sum() if len(w) else 0
        return to_ll(*(q + off))
    for l in lines:
        l["coords"] = [[round(v, 6) for v in bend(*c)] for c in l["coords"]]
    pts = []
    for t, (x, y, d) in mk.items():
        pts.append({"title": t, "ll": [round(v, 6) for v in bend(*to(x, y))], "about": d})
    return {"lines": lines, "markers": pts, "fit_m": round(v, 1), "img": img_url[0]}


def shape_centroid(g):
    from shapely.geometry import shape as _sh
    c = _sh(g).centroid; return (c.x, c.y)


def html_unescape(s):
    import html as _h
    return _h.unescape(s)


def main_all():
    main()
    try:
        roads = base_roads()
        s3 = stage3(roads)
    except Exception as e:
        print("wave stage 3: couldn't trace; keeping the previous lines:", e); return
    if not s3:
        print("wave stage 3: map not found; keeping the previous lines"); return
    g = json.load(open(OUT)) if os.path.exists(OUT) else {}
    g["stage3"] = s3; json.dump(g, open(OUT, "w"), separators=(",", ":"))
    print(f"wave stage 3: {len(s3['lines'])} lines, {len(s3['markers'])} map markers, roads within {s3['fit_m']} m on average")


if __name__ == "__main__":
    main_all()
