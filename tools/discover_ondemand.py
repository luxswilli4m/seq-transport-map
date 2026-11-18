#!/usr/bin/env python3
"""Put new Translink on-demand services on the map automatically.

Usage: discover_ondemand.py <gtfs_dir> <repo> [--try PAGE_PATH]

Reads Translink's on-demand hub page (translink.com.au/travel-with-us/on-demand). For every
service it links to that isn't on the map yet (and isn't in "not_drawn" in tools/ondemand.json),
it tries, in order:

  1. map files (KML) on the service's page or on a "map" page linked from it: drawn exactly,
     like Gold Coast and Logan;
  2. a map picture on the page: traced automatically (see tools/trace_ondemand.py), using the
     suburbs named on the page to find roughly where it is. Only kept if the picture lines up
     clearly with the real roads.

Hours ("When you can travel") and key locations given with stop IDs are read from the page text.
What it adds goes into tools/ondemand_auto.json (and the outline into tools/ondemand_traced.json),
and its card on the map says it was added automatically. If neither works, the service is listed
on the map's on-demand card as not drawn yet, and left off until it's added by hand.

--try PAGE_PATH runs the steps for one page (even one already on the map) without saving, for testing.
"""
import sys, os, re, json, html, csv, urllib.parse
GTFS = sys.argv[1] if len(sys.argv) > 2 else None
sys.argv = [sys.argv[0], sys.argv[2]] + sys.argv[3:] if len(sys.argv) > 2 else sys.argv   # trace_ondemand reads argv[1] = repo
import trace_ondemand as T  # noqa: E402

REPO = T.REPO
BASE = T.BASE
CFGP = os.path.join(REPO, "tools", "ondemand.json")
AUTOP = os.path.join(REPO, "tools", "ondemand_auto.json")
CFG = json.load(open(CFGP))
AUTO = json.load(open(AUTOP)) if os.path.exists(AUTOP) else {"_help": "On-demand services added automatically by tools/discover_ondemand.py. Move an entry into tools/ondemand.json to edit it by hand.", "areas": []}
notes = []


def page_text(h):
    t = re.sub(r"<script.*?</script>|<style.*?</style>|<nav.*?</nav>|<footer.*?</footer>", "", h, flags=re.S)
    t = re.sub(r"<(br|/p|/li|/h\d|/div|/td|/tr)[^>]*>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    return [re.sub(r"\s+", " ", html.unescape(l)).strip() for l in t.split("\n") if l.strip()]


def section(lines, start, stop_words):
    out, on = [], False
    for l in lines:
        if not on and l.lower().startswith(start):
            on = True
            continue
        if on:
            if any(l.lower().startswith(w) for w in stop_words):
                break
            out.append(l)
    return out


def suburbs_index(gtfs):
    """suburb name -> list of stop [lon, lat], from the ', Suburb' ending of Translink's stop descriptions."""
    idx = {}
    with open(os.path.join(gtfs, "stops.txt"), encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            m = re.search(r",\s*([A-Z][A-Za-z' -]+)$", r.get("stop_desc") or "")
            if m:
                idx.setdefault(m.group(1).strip(), []).append([float(r["stop_lon"]), float(r["stop_lat"])])
    return idx


def stops_ll(gtfs):
    d = {}
    with open(os.path.join(gtfs, "stops.txt"), encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            d[r["stop_id"]] = r["stop_name"]
    return d


def try_page(path, gtfs, save):
    url = BASE + path
    h = T.fetch(url).decode("utf-8", "replace")
    m = re.search(r"<title>(.*?)</title>", h, re.S)
    name = html.unescape(m.group(1)).split("|")[0].strip() if m else path.rsplit("/", 1)[-1].replace("-", " ").title()
    if "on demand" not in name.lower():
        name += " on demand"
    lines = page_text(h)
    hours = "; ".join(l.rstrip(".:") for l in section(lines, "when you can travel", ("make a booking", "booking", "fares", "how to book", "feedback"))
                      if re.search(r"\d", l))[:300] or None
    intro = next((l for l in lines if re.search(r"on demand is|on-demand is|flexible, shared|pre-booked", l, re.I)), "")
    how = (intro + " " if intro else "") + "Added automatically from Translink's page, so check there for booking details."
    # key locations given with stop IDs ("The Buzz - stop IDs 320611 and 320612")
    dests = []
    for l in lines:
        mm = re.match(r"(.{3,80}?)\s*[-–]\s*stop IDs?\s+([\d ,and]+)", l, re.I)
        if mm:
            dests.append({"n": mm.group(1).strip(), "stops": re.findall(r"\d{5,7}", mm.group(2))})
    slug = re.sub(r"[^a-z0-9]+", "_", path.rsplit("/", 1)[-1].lower()).strip("_")
    area = {"id": "auto_" + slug, "name": name, "page": url, "how": how, "auto": True}

    # 1. map files (KML) on the page, or on a map page linked from it
    cands = [path] + sorted({urllib.parse.urlparse(urllib.parse.urljoin(url, html.unescape(u))).path
                             for u, t in re.findall(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', h, re.S)
                             if re.search(r"map|zone|area|site", u + re.sub("<[^>]+>", "", t), re.I)
                             and urllib.parse.urljoin(url, u).startswith(BASE)})
    for p in cands[:8]:
        try:
            ph = h if p == path else T.fetch(BASE + p).decode("utf-8", "replace")
        except Exception:
            continue
        if re.search(r'href="[^"]+\.km[lz]"', ph, re.I):
            area["map_page"] = p
            if hours:
                area["how"] += " Hours: " + hours + "."
            print(f"{path}: map files found on {p}")
            return area, "map files"

    # 2. a map picture, traced
    if not gtfs:
        return None, "no map files, and no timetable data to place a map picture"
    subs = suburbs_index(gtfs)
    text = " ".join(lines)
    hit = [s for s in subs if len(s) > 3 and re.search(r"\b" + re.escape(s) + r"\b", text)]
    hit = [s for s in hit if s.lower() not in ("city", "central", "station")]
    if not hit:
        return None, "no map files, and no suburbs on the page to place a map picture"
    guess = [subs[s] for s in hit]
    pics = []
    for u, t in re.findall(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', h, re.S):
        u = html.unescape(u)
        if "widen.net/s/" in u and re.search(r"map|zone", u + t, re.I):
            pics.append({"page": url, "match": re.escape(urllib.parse.unquote(u.split("?")[0]))})
    for u in re.findall(r'src="([^"]+)"', h):
        u = html.unescape(u)
        if re.search(r"map|roam|zone", urllib.parse.unquote(u), re.I) and "framework" not in u and "logo" not in u.lower():
            fn = urllib.parse.unquote(u.split("?")[0]).rsplit("/", 1)[-1]
            pics.append({"page": url, "match": re.escape(fn)})
    for pic in pics:
        for outline in ("navy", "pink"):
            try:
                purl = T.find_picture(pic)
                data = T.fetch(purl)
                ring, fit, aff = T.trace(data, guess, outline, os.environ.get("TRACE_DEBUG") and f"/tmp/discover_{slug}.png", wide=True)
            except Exception as e:
                print(f"{path}: picture {pic['match'][:50]} ({outline}) not usable: {e}")
                continue
            print(f"{path}: picture {purl} ({outline}): roads matched {fit['hit']:.0%} vs {fit['base']:.0%} nudged")
            if not fit["ok"]:
                continue
            zid = "auto_" + slug
            pic = dict(pic, outline=outline)
            area.update({"traced": True, "groups": [{"name": (re.sub(r"(?i)\bon[ -]demand\b", "", name).strip() or name) + " roam zone", "zone": zid,
                                                     "hours": hours, "picture": pic, "dests": dests}]})
            if save:
                import hashlib
                T.TRACED[zid] = ring
                T.META[zid] = {"url": purl, "sha": hashlib.sha1(data).hexdigest(), "affine": aff}
            return area, "map picture (traced)"
    return None, "no map files, and no map picture that lined up clearly with the roads"


def main():
    gtfs = GTFS
    if "--try" in sys.argv:
        a, how = try_page(sys.argv[sys.argv.index("--try") + 1], gtfs, False)
        print(how)
        print(json.dumps(a, indent=1, ensure_ascii=False)[:3000])
        return
    hub = T.fetch(BASE + "/travel-with-us/on-demand").decode("utf-8", "replace")
    areas = CFG["areas"] + AUTO["areas"]
    known = {urllib.parse.urlparse(a["page"]).path.rstrip("/") for a in areas} | set(CFG.get("not_drawn", {}))
    known |= {a.get("map_page", "").rstrip("/") for a in areas}
    known |= set(AUTO.get("failed", {}))
    new = []
    for u in re.findall(r'href="([^"]+)"', hub):
        p = urllib.parse.urlparse(urllib.parse.urljoin(BASE, html.unescape(u))).path.rstrip("/")
        if (re.match(r"^/travel-with-us/on-demand/[a-z0-9-]+$", p) or re.match(r"^/[a-z0-9-]*on-demand$", p)) \
                and p not in ("/travel-with-us/on-demand", "/travel-with-us/on-demand/terms-and-conditions") and p not in known and p not in new:
            new.append(p)
    changed = False
    for p in new:
        try:
            a, how = try_page(p, gtfs, True)
        except Exception as e:
            a, how = None, f"error: {e}"
        if a:
            AUTO["areas"].append(a); changed = True
            notes.append(f"**Added automatically:** {a['name']} ({BASE + p}), from its {how}. Check the area and the card wording "
                         f"on the map. To edit it, move its entry from tools/ondemand_auto.json into tools/ondemand.json.")
        else:
            AUTO.setdefault("failed", {})[p] = how; changed = True
            notes.append(f"**New on-demand service not drawn:** {BASE + p} ({how}). It needs adding by hand. "
                         f"It won't be reported again; remove it from \"failed\" in tools/ondemand_auto.json to retry.")
    if changed:
        json.dump(AUTO, open(AUTOP, "w"), indent=1, ensure_ascii=False)
        json.dump(T.TRACED, open(T.TPATH, "w"), indent=0)
    if notes:   # shown on the map (auto-added cards say so; failures are listed on the on-demand card), not raised as issues
        print("\n".join(notes))
    else:
        print("no new on-demand services")


if __name__ == "__main__":
    main()
