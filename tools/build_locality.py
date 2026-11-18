#!/usr/bin/env python3
"""Station locality maps -> data/locality.json

Usage: build_locality.py <repo>

Reads Translink's Maps page (translink.com.au/plan-your-journey/maps), takes every locality map it
links to, and attaches each one to the matching station(s) on this map. Runs in the weekly refresh,
so new maps, replaced maps (new file links) and removed maps are picked up without anyone stepping in.

Matching is by name, using the stations and stops in data/network.json:
  * the map title ("Boggo Road", "Queen Street station", "Capalaba park 'n' ride") and the station
    name are both reduced to their core name by dropping words like "station", "busway station",
    "bus station", "interchange", "ferry terminal", "park 'n' ride", "platform 2", "stop B";
  * stations and interchanges (train, busway, bus station, ferry, tram, named places) are tried first;
    every one with the same core name gets the map (e.g. both Boggo Road train and busway stations);
  * if there are none, bus stops with that core name are used (e.g. "Adelaide Street" -> its city stops);
  * matches must sit together (within 1.2 km of each other), so a common name elsewhere can't pick up
    the map. Maps that match nothing (e.g. regional Queensland towns, which aren't on this map) are skipped.

Output: {"updated": "YYYY-MM-DD", "maps": {stop_id: [[title, url], ...]}}
If the page can't be read or looks broken, the previous file is kept.
"""
import sys, os, re, json, html, math, datetime, subprocess, urllib.parse

REPO = sys.argv[1] if len(sys.argv) > 1 else "."
PAGE = "https://translink.com.au/plan-your-journey/maps"
OUT = os.path.join(REPO, "data", "locality.json")
STATION_TYPES = {"train", "busway", "busstn", "ferry", "tram"}
DROP = [r"\(pdf\)", r"\blocality map\b", r"\blocality\b", r"\bbusway station\b", r"\bbus station\b", r"\btrain station\b",
        r"\bstation\b", r"\binterchange\b", r"\bferry terminal\b", r"\bpark ?'?n'? ?ride\b", r",?\s*platform \w+",
        r",?\s*stop \w{1,4}\b.*$", r"\bstop \d+\w*\b.*$"]


def fetch(url):
    r = subprocess.run(["curl", "-sSL", "-m", "60", "--fail", "-A", "Mozilla/5.0 seq-transport-map", url], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"could not download {url}")
    return r.stdout.decode("utf-8", "replace")


def core(name):
    s = html.unescape(name).lower().replace("’", "'")
    s = re.sub(r"\s*\((?!pdf)[^)]*\)", lambda m: " " + m.group(0).strip(" ()") if "street" in m.group(0) else "", s)  # "Ipswich (Bell Street)" keeps the street
    for p in DROP:
        s = re.sub(p, " ", s)
    s = s.replace("shopping centre", " ").replace("mt ", "mount ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(w for w in s.split() if w not in ("the", "of"))


def keys(title, url):
    """Names to try for a map: its title, any short name in brackets ("RBWH"), and the file name."""
    ks = [core(title)]
    ks += [core(x) for x in re.findall(r"\(([^)]+)\)", title) if x.lower() != "pdf"]
    slug = urllib.parse.unquote(url.rstrip("/").rsplit("/", 1)[-1])
    slug = re.sub(r"^[\d-]+", "", slug.lower())
    slug = re.sub(r"(locality[-_]map|map|a3|sep\d+|web|aug-\d+)", " ", slug)
    ks.append(core(slug.replace("-", " ").replace("_", " ")))
    return [k for i, k in enumerate(ks) if k and k not in ks[:i]]


def km(a, b):
    return math.hypot((a[2] - b[2]) * 98.7, (a[1] - b[1]) * 110.6)


def together(ids, S):
    """Keep the largest group of stops that are all within 1.2 km of its centre."""
    if not ids:
        return []
    best = []
    for c in ids:
        grp = [i for i in ids if km(S[i], S[c]) <= 1.2]
        if len(grp) > len(best):
            best = grp
    return best


def main():
    S = json.load(open(os.path.join(REPO, "data", "network.json")))["data"]["stops"]
    page = fetch(PAGE)
    # each map link, with the region heading it sits under ("Brisbane region", "Gold Coast region", ...)
    heads = [(m.start(), html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip())
             for m in re.finditer(r"<(h[2-5])[^>]*>(.*?)</\1>", page, re.S)]
    links = []
    for m in re.finditer(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', page, re.S):
        u = html.unescape(m.group(1)); t = html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip()
        if re.search(r"locality", u + t, re.I):
            region = next((h for p, h in reversed(heads) if p < m.start() and h.lower().endswith("region")), "")
            links.append((re.sub(r"\s*\(PDF\)\s*$", "", t, flags=re.I).strip(), u, region))
    if len(links) < 30:
        raise SystemExit(f"only {len(links)} locality maps found on {PAGE}; keeping the previous file")

    by_core = {}
    for sid, st_ in S.items():
        by_core.setdefault(core(st_[0]), []).append(sid)
    is_stn = lambda i: S[i][3] in STATION_TYPES or i.startswith("place_")

    def candidates(title, url):
        ks = keys(title, url)
        for k in ks:                                   # exact name first: stations, then stops
            ids = by_core.get(k, [])
            for pool in ([i for i in ids if is_stn(i)], ids):
                if pool:
                    return pool
        for k in ks:                                   # then a station whose name starts with it ("Aspley" -> "Aspley Hypermarket interchange")
            pool = [i for c, ids in by_core.items() if c.startswith(k + " ") for i in ids if is_stn(i)]
            if pool:
                return pool
        return []

    def groups(ids):
        out, left = [], list(ids)
        while left:
            g = together(left, S)
            out.append(g); left = [i for i in left if i not in g]
        return out

    # first pass: maps with one obvious place give each region's middle; second pass settles the rest
    found = {}
    for title, url, region in links:
        found[(title, url)] = groups(candidates(title, url))
    centre = {}
    for (title, url), gs in found.items():
        if len(gs) == 1:
            r = next(rg for t, u, rg in links if (t, u) == (title, url))
            centre.setdefault(r, []).append(S[gs[0][0]])
    centre = {r: (sum(p[1] for p in v) / len(v), sum(p[2] for p in v) / len(v)) for r, v in centre.items()}

    maps, skipped = {}, []
    for title, url, region in links:
        gs = found[(title, url)]
        if not gs:
            skipped.append(title)
            continue
        if len(gs) > 1 and region in centre:           # same name in two places: the one in this map's region
            c = centre[region]
            gs.sort(key=lambda g: math.hypot((S[g[0]][2] - c[1]) * 98.7, (S[g[0]][1] - c[0]) * 110.6))
        elif len(gs) > 1:
            gs.sort(key=len, reverse=True)
        pick = gs[0]
        for i in pick:
            maps.setdefault(i, [])
            if [title, url] not in maps[i]:
                maps[i].append([title, url])
        print(f"{title:40s} -> {', '.join(S[i][0] for i in pick[:4])}{' …' if len(pick) > 4 else ''}")
    print(f"{len(links)} locality maps, {len(links) - len(skipped)} attached, skipped (no station on this map): {', '.join(skipped)}")
    json.dump({"updated": datetime.date.today().isoformat(), "maps": maps}, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    main()
