#!/usr/bin/env python3
"""Cross River Rail and The Wave tabs -> data/projects.json

Usage: build_projects.py <repo>

Sites and their short summaries are listed in tools/projects.json. Everything else is filled in automatically each week:
  - Cross River Rail's line: the tunnel alignment from OpenStreetMap (via Overture Maps, "Cross River Rail Up/Down").
  - Site outlines: OpenStreetMap construction and rail-yard areas named for the site (e.g. "Cross River Rail Construction
    site") near it; otherwise an unnamed construction area right at it; otherwise a circle around the station, marked
    approximate. Map shapes are cached in tools/projects_geom.json and re-read only on a new Overture release.
  - Latest official progress: the "At <site>, ..." paragraphs on crossriverrail.qld.gov.au/construction/progress.
  - Status: sentences such as "now open to customers" or "expected to be finished in late 2027" from each site's page.
  - Works notices: the newest notices for the site's area from crossriverrail.qld.gov.au/construction/work-notices.
  - The Wave: corridor and station precincts traced from TMR's published maps (tools/wave_geom.json), with dates
    and documents from TMR's project pages when they can be read.
If an official page can't be read, the previous week's details for it are kept.
"""
import sys, os, io, re, json, math, html, datetime, time
import requests

REPO = sys.argv[1] if len(sys.argv) > 1 else "."
sys.path.insert(0, os.path.join(REPO, "tools"))
CFG = json.load(open(os.path.join(REPO, "tools", "projects.json")))
OUT = os.path.join(REPO, "data", "projects.json")
GEOM = os.path.join(REPO, "tools", "projects_geom.json")
CRR = "https://crossriverrail.qld.gov.au"
STAC = "https://stac.overturemaps.org"
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0 (seq-transport-map weekly refresh; github.com/luxswilli4m/seq-transport-map)"
OLD = json.load(open(OUT)) if os.path.exists(OUT) else {}
MONTHS = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], 1)}


def get(url, tries=3):
    for t in range(tries):
        try:
            r = S.get(url, timeout=60)
            if r.ok:
                return r.text
        except requests.RequestException:
            pass
        time.sleep(2 + 3 * t)
    return None


def text_lines(page):
    s = re.sub(r"(?is)<(script|style|nav|header|footer|noscript)[^>]*>.*?</\1>", " ", page)
    m = re.search(r"(?is)<main[^>]*>(.*)</main>", s); s = m.group(1) if m else s
    s = re.sub(r"(?i)<(br|/p|/h\d|/li|/div)[^>]*>", "\n", s); s = html.unescape(re.sub("<[^>]+>", " ", s))
    return [re.sub(r"\s+", " ", l).strip() for l in s.split("\n") if l.strip()]


def iso(d):
    m = re.match(r"(\w+) (\d+), (\d{4})", d or "")
    return f"{m.group(3)}-{MONTHS.get(m.group(1), 1):02d}-{int(m.group(2)):02d}" if m and m.group(1) in MONTHS else ""


# ---------------------------------------------------------------- official text
def notices(area):
    page = get(f"{CRR}/construction/work-notices/?area=area-{area}" if area else f"{CRR}/construction/work-notices/")
    if not page:
        return None
    out = []
    for li in re.findall(r'(?is)<li class="list-group-item[^"]*">(.*?)</li>', page):
        place = re.search(r'listing-date-place[^>]*>([^<]*)<', li)
        title = re.search(r'<h2[^>]*>\s*<a[^>]*title="([^"]*)"[^>]*href="([^"]+)"', li)
        pdf = re.search(r'href="([^"]+\.pdf)"', li)
        if not (place and title):
            continue
        where, _, date = html.unescape(place.group(1)).rpartition("|")
        out.append({"t": html.unescape(title.group(1)).strip(), "where": where.strip(), "d": iso(date.strip()),
                    "url": title.group(2), "pdf": pdf.group(1) if pdf else ""})
    return out


def progress():
    page = get(f"{CRR}/construction/progress/")
    if not page:
        return None
    lines = text_lines(page); asof = ""
    for l in lines:
        m = re.search(r"up to (\d+ \w+ \d{4})", l)
        if m:
            asof = m.group(1); break
    paras = {}
    for l in lines:
        m = re.match(r"(?:At|In) (?:the )?([A-Z][\w' ]+?), (.+)", l)
        if m:
            paras.setdefault(m.group(1).strip(), []).append(l)
    return {"asof": asof, "at": paras}


STATUS = re.compile(r"(now (fully )?open|currently closed|opened on|has been handed over|expected to (be|commence|open|reopen|start)|"
                    r"major construction .*(complete|underway)|will open|has not yet been determined)", re.I)


def status_lines(url):
    page = get(url)
    if not page:
        return None
    out = []
    for l in text_lines(page):
        if 25 < len(l) < 320 and STATUS.search(l) and not l.lower().startswith(("check ", "register ", "view ", "remember ")) and l not in out:
            out.append(l)
        if len(out) >= 3:
            break
    return out


# ---------------------------------------------------------------- map shapes (OpenStreetMap via Overture, cached per release)
def overture_rows(rel, theme, typ, bb, cols):
    import pyarrow.parquet as pq, pyarrow.compute as pc
    from od_places import _HTTPRangeFile
    n = int(S.get(f"{STAC}/{rel}/{theme}/{typ}/collection.json", timeout=60).json()["partition:file_count"]); rows = []
    for i in range(n):
        it = S.get(f"{STAC}/{rel}/{theme}/{typ}/{i:05d}/{i:05d}.json", timeout=60).json(); b = it["bbox"]
        if not (b[0] <= bb[2] and b[2] >= bb[0] and b[1] <= bb[3] and b[3] >= bb[1]):
            continue
        url = [a["href"] for a in it["assets"].values() if "amazonaws.com" in a["href"]][0]
        f = pq.ParquetFile(io.BufferedReader(_HTTPRangeFile(url), buffer_size=16 << 20)); md = f.metadata
        ix = {md.schema.column(k).path: k for k in range(md.num_columns)}
        for r in range(md.num_row_groups):
            st = lambda c: md.row_group(r).column(ix[c]).statistics
            if not (st("bbox.xmin").min <= bb[2] and st("bbox.xmax").max >= bb[0] and st("bbox.ymin").min <= bb[3] and st("bbox.ymax").max >= bb[1]):
                continue
            tb = f.read_row_group(r, columns=cols + ["bbox"]); bx = tb.column("bbox").combine_chunks()
            m = pc.and_(pc.and_(pc.less_equal(pc.struct_field(bx, "xmin"), bb[2]), pc.greater_equal(pc.struct_field(bx, "xmax"), bb[0])),
                        pc.and_(pc.less_equal(pc.struct_field(bx, "ymin"), bb[3]), pc.greater_equal(pc.struct_field(bx, "ymax"), bb[1])))
            rows += tb.filter(m).to_pylist()
    return rows


def shapes(sites):
    from shapely import wkb
    from shapely.geometry import mapping
    cache = json.load(open(GEOM)) if os.path.exists(GEOM) else {}
    try:
        rel = S.get(f"{STAC}/catalog.json", timeout=60).json()["latest"]
    except Exception:
        rel = cache.get("release")
    if cache.get("release") == rel and cache.get("sites") == sorted(s["id"] for s in sites):
        return cache
    pts = [s["_ll"] for s in sites]
    boxes = []   # one box per cluster of sites (Brisbane, Gold Coast)
    for p in pts:
        for b in boxes:
            if abs(p[0] - (b[0] + b[2]) / 2) < 0.15 and abs(p[1] - (b[1] + b[3]) / 2) < 0.15:
                b[0], b[1], b[2], b[3] = min(b[0], p[0]), min(b[1], p[1]), max(b[2], p[0]), max(b[3], p[1]); break
        else:
            boxes.append([p[0], p[1], p[0], p[1]])
    land, line = [], []
    for b in boxes:
        bb = (b[0] - 0.006, b[1] - 0.006, b[2] + 0.006, b[3] + 0.006)
        for r in overture_rows(rel, "base", "land_use", bb, ["names", "class", "geometry"]):
            if r["class"] in ("construction", "railway"):
                land.append({"name": ((r.get("names") or {}).get("primary") or ""), "class": r["class"], "g": mapping(wkb.loads(r["geometry"]))})
        for r in overture_rows(rel, "transportation", "segment", bb, ["names", "subtype", "geometry"]):
            nm = ((r.get("names") or {}).get("primary") or "")
            if r["subtype"] == "rail" and nm.startswith("Cross River Rail"):
                line.append([[round(x, 6), round(y, 6)] for x, y in wkb.loads(r["geometry"]).coords])
    if not line and cache.get("line"):
        line = cache["line"]
    out = {"release": rel, "sites": sorted(s["id"] for s in sites), "land": land, "line": line}
    json.dump(out, open(GEOM, "w"), separators=(",", ":"))
    return out


def outline(site, land):
    from shapely.geometry import shape, Point, mapping
    from shapely.ops import unary_union
    x, y = site["_ll"]; P = Point(x, y); k = math.cos(math.radians(y))
    dist = lambda g: math.hypot(*(lambda c: ((c[0] - x) * 111.32 * k, (c[1] - y) * 110.57))(g.centroid.coords[0])) * 1000
    near = lambda g, m: g.distance(P) * 111000 <= m
    want = (site.get("osm") or "").lower()
    named = [shape(l["g"]) for l in land if want and want in l["name"].lower() and near(shape(l["g"]), 450)]
    if named:
        return mapping(unary_union(named).simplify(0.00001)), False
    plain = [shape(l["g"]) for l in land if l["class"] == "construction" and not l["name"] and near(shape(l["g"]), 40)]
    if plain:
        return mapping(unary_union(plain).simplify(0.00001)), False
    r = 0.0009   # about 90-100 m
    return mapping(P.buffer(r).simplify(0.00002)), True


def rnd(g):
    def f(c):
        return [round(c[0], 6), round(c[1], 6)] if isinstance(c[0], (int, float)) else [f(i) for i in c]
    return {"type": g["type"], "coordinates": f(g["coordinates"])}


# ---------------------------------------------------------------- build
def build_crr(stops):
    cfg = CFG["crr"]; old = {s["id"]: s for s in (OLD.get("crr") or {}).get("sites", [])}
    sites = []
    for s in cfg["sites"]:
        s = dict(s)
        if isinstance(s["at"], str):
            m = stops.get(s["at"].lower())
            if not m:
                print("projects: can't find", s["at"], "in the stops; skipping"); continue
            s["_ll"] = m
        else:
            s["_ll"] = s["at"]
        sites.append(s)
    geom = shapes(sites)
    prog = progress(); old_crr = OLD.get("crr") or {}
    latest = notices("") or old_crr.get("latest", [])
    by_area = {}
    out = []
    for s in sites:
        o = old.get(s["id"], {})
        area = s.get("notices")
        if area not in by_area:
            by_area[area] = notices(area)
        ns = by_area[area]
        if ns is not None:
            shared = sum(1 for t in sites if t.get("notices") == area) > 1
            if shared:   # an area shared by several sites: keep notices that name this one
                ns = [n for n in ns if s["name"].lower() in (n["t"] + " " + n["where"]).lower()]
            ns = ns[:5]
        else:
            ns = o.get("notices", [])
        st = status_lines(s["page"]); st = st if st is not None else o.get("status", [])
        key = s.get("progress") or s["name"]; at = (prog or {}).get("at", {})
        pr = at.get(key) or next((v for k, v in at.items() if re.sub(r" (station|area|Yard)$", "", k) == key), None) if prog else None
        pr = " ".join(pr) if pr else (o.get("progress", "") if not prog else "")
        shp, approx = outline(s, geom["land"])
        out.append({"id": s["id"], "name": s["name"], "kind": s["kind"], "group": s.get("group", s["kind"]), "about": s["about"], "page": s["page"], "status": st,
                    "progress": pr, "notices": ns, "shape": rnd(shp), "approx": approx, "ll": [round(v, 6) for v in s["_ll"]]})
    return {"name": cfg["name"], "colour": cfg["colour"], "sub": cfg.get("sub", ""), "mapnote": cfg.get("mapnote", ""), "focus": cfg.get("focus"), "overview": cfg["overview"], "links": cfg["links"],
            "progress_asof": (prog or {}).get("asof") or old_crr.get("progress_asof", ""), "latest": latest[:6],
            "line": geom["line"], "sites": out}


def wave_docs(urls, old):
    """Newest documents listed on TMR's The Wave pages (title and PDF link), in the order TMR lists them."""
    out = []
    for u in urls:
        page = get(u)
        if page is None:
            return old
        for href, t in re.findall(r'<a[^>]+href="(https://www\.yoursay-projects\.tmr\.qld\.gov\.au/download_file/\d+/\d+)"[^>]*>(.*?)</a>', page, re.S):
            t = re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", " ", t))).strip()
            m = re.match(r"(.+?)\s+PDF\s*\(", t)
            if m and not any(o["url"] == href for o in out):
                out.append({"t": m.group(1).strip(), "url": href, "pdf": "", "d": ""})
    return out


def build_wave():
    from shapely.geometry import shape, Point, LineString, mapping
    from shapely.ops import unary_union
    cfg = CFG.get("wave")
    if not cfg:
        return OLD.get("wave")
    gp = os.path.join(REPO, "tools", "wave_geom.json")
    g = json.load(open(gp)) if os.path.exists(gp) else {}
    old = OLD.get("wave") or {}
    s3 = g.get("stage3") or {}; markers = {m["title"]: m for m in s3.get("markers", [])}
    traced = [shape(x) for x in g.get("stations", [])]
    # joins across map pages that couldn't be placed are dashed; short ones where a station precinct fills the gap aren't drawn
    lines = [{"name": "Rail corridor (joined between map pages)", "planned": 1, "coords": j} for j in g.get("joins", [])
             if not any(LineString(j).distance(t) < 0.001 for t in traced) and math.hypot((j[0][0] - j[1][0]) * 99.4, (j[0][1] - j[1][1]) * 110.6) > 0.3]
    # Stage 3: confirmed corridor to Mountain Creek drawn solid, the rest (still being investigated) dashed
    mc = markers.get("Mountain Creek station precinct")
    for l in s3.get("lines", []):
        c = l["coords"]
        if l["name"] == "main" and mc:
            k = min(range(len(c)), key=lambda i: (c[i][0] - mc["ll"][0]) ** 2 + (c[i][1] - mc["ll"][1]) ** 2)
            lines.append({"name": "Metro corridor, Birtinya to Mountain Creek", "planned": 0, "coords": c[:k + 1]})
            lines.append({"name": "Metro corridor beyond Mountain Creek (being investigated)", "planned": 1, "coords": c[k:]})
        else:
            lines.append({"name": "Metro corridor to Maroochydore CBD (being investigated)", "planned": 1, "coords": c})
    sites = []
    for s in cfg["sites"]:
        mk = markers.get(s.get("marker", ""), {})
        about, status = s.get("about") or mk.get("about", ""), []
        if s.get("about") and mk.get("about"):
            status = [mk["about"]]
        shp, ll, approx = None, None, False
        if s.get("shape") == "corridor" and g.get("corridor"):
            shp = g["corridor"]; C = shape(shp); mid = Point(153.04, -26.83)
            from shapely.ops import nearest_points
            c = nearest_points(C, mid)[0]; ll = [c.x, c.y]
        elif s.get("shape") == "stage3" and s3.get("lines"):
            L = unary_union([LineString(l["coords"]) for l in s3["lines"]]); shp = mapping(L.buffer(0.0004).simplify(0.0001))
            c = L.interpolate(0.35, normalized=True); ll = [c.x, c.y]; approx = True
        elif s.get("near"):
            P = Point(*s["near"]); hit = [t for t in traced if t.distance(P) < 0.008]
            if hit:
                t = min(hit, key=lambda t: t.distance(P)); shp = mapping(t); c = t.representative_point(); ll = [c.x, c.y]
            else:
                shp = mapping(P.buffer(0.0014).simplify(0.00002)); ll = s["near"]; approx = True
        elif mk:
            ll = mk["ll"]; shp = mapping(Point(*ll).buffer(0.0012).simplify(0.00002)); approx = True
        if s.get("shape") == "corridor":
            approx = False
        sites.append({"id": s["id"], "name": s["name"], "kind": s["kind"], "group": s.get("group", s["kind"]), "about": about, "status": status,
                      "page": s["page"], "shape": rnd(shp) if shp else None, "ll": [round(v, 6) for v in ll] if ll else None, "approx": approx,
                      "approxnote": s.get("approxnote", "") if (approx or s.get("shape") == "corridor") else "", "notices": [], "progress": ""})
    docs = wave_docs(cfg.get("docs", []), old.get("documents", []))
    return {"name": cfg["name"], "colour": cfg["colour"], "sub": cfg.get("sub", ""), "mapnote": cfg.get("mapnote", ""), "focus": cfg.get("focus"),
            "overview": cfg["overview"], "links": cfg["links"], "lines": lines, "sites": sites, "documents": docs[:8],
            "maps": {"rail": g.get("pdf", ""), "stage3": s3.get("img", "")}}


def main():
    net = json.load(open(os.path.join(REPO, "data", "network.json")))["data"]["stops"]
    stops = {}
    for v in net.values():
        if v[3] in ("train",):
            stops.setdefault(v[0].lower(), [v[2], v[1]])
    res = {"built": datetime.date.today().isoformat(), "crr": build_crr(stops), "wave": build_wave()}
    json.dump(res, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
    c = res["crr"]
    print(f"projects: Cross River Rail {len(c['sites'])} sites ({sum(1 for s in c['sites'] if not s['approx'])} mapped outlines), "
          f"{len(c['line'])} line pieces, progress up to {c['progress_asof'] or '?'}, {sum(len(s['notices']) for s in c['sites'])} site notices")


if __name__ == "__main__":
    main()
