"""Find on-demand key locations that Translink lists by name only, using OpenStreetMap's place search.

Used by build_ondemand.py when a destination doesn't match a Translink stop or a base-map place.

  * Searches nominatim.openstreetmap.org (OpenStreetMap's place search, not map tiles) inside the
    area around the service's zone, trying the full name, then the name without suburb words,
    then the distinctive words alone (e.g. "Woolworths").
  * A result only counts if its own name has most of the destination's distinctive words (not just
    the suburb or words like "centre"), it isn't a suburb, road, track or bus stop, it's in the suburb
    the destination names (if it names one), and it's inside the zone or within 2 km of it
    (8 km for Logan's destinations, which are outside the pick-up suburbs). If several results qualify and they're more than 500 m apart, the one nearest the
    suburb named in the destination wins; if there's no suburb to go by, it's left unmarked.
  * Every answer (found or not) is saved in tools/ondemand_places.json, so each name is searched
    once, not every week. Delete an entry there to search again.
  * Hand fixes go in the same file under "manual": {"Name": [lon, lat]} and always win.
"""
import json, os, re, time, math, subprocess, urllib.parse

UA = "seq-transport-map (github.com/luxswilli4m/seq-transport-map)"
BAD_TYPES = {"administrative", "suburb", "locality", "neighbourhood", "hamlet", "postcode", "track", "bus_stop",
             "platform", "residential", "unclassified", "tertiary", "secondary", "primary", "service", "footway",
             "path", "city", "town", "village", "quarter", "station"}
GENERIC = {"the", "and", "of", "at", "shops", "shop", "club", "centre", "center", "shopping", "island", "co",
           "community", "plaza"}


def _toks(s):
    return [t for t in re.split(r"[^a-z0-9']+", s.lower().replace(".", "")) if t]


class Places:
    def __init__(self, repo, suburbs):
        self.path = os.path.join(repo, "tools", "ondemand_places.json")
        self.db = json.load(open(self.path)) if os.path.exists(self.path) else {
            "_help": "On-demand key locations found with OpenStreetMap's place search (tools/od_places.py). "
                     "'found' is a cache (delete an entry to search again). Put hand fixes in 'manual' as "
                     "\"Name\": [lon, lat]; they always win.", "manual": {}, "found": {}}
        self.suburbs = suburbs      # {"Cornubia": [lon, lat], ...}
        self.changed = False
        self.log = []

    def save(self):
        if self.changed:
            json.dump(self.db, open(self.path, "w"), indent=1, ensure_ascii=False)

    def _search(self, q, vb):
        u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
            {"q": q, "format": "jsonv2", "limit": 10, "countrycodes": "au", "bounded": 1,
             "viewbox": ",".join(f"{v:.4f}" for v in vb)})
        r = subprocess.run(["curl", "-sS", "-m", "30", "-A", UA, u], capture_output=True, text=True)
        time.sleep(1.1)        # OpenStreetMap's fair-use limit: at most one search a second
        if r.returncode != 0:
            raise RuntimeError("OpenStreetMap search unreachable")
        try:
            return json.loads(r.stdout or "[]")
        except ValueError:
            return []

    def find(self, name, zones, maxkm=2.0):
        """Return ([lon, lat], source) or (None, None)."""
        if name in self.db["manual"]:
            return self.db["manual"][name], "manual"
        if name in self.db["found"]:
            hit = self.db["found"][name]
            return (hit.get("ll"), "osm") if hit.get("ll") else (None, None)
        from shapely.geometry import Polygon, Point
        from shapely.ops import unary_union
        zone = unary_union([Polygon(z).buffer(0) for z in zones])
        x0, y0, x1, y1 = zone.bounds
        m = maxkm / 100 + 0.005
        vb = [x0 - m, y1 + m, x1 + m, y0 - m]
        words = _toks(name)
        subs = [s_ for s_ in self.suburbs if re.search(r"\b" + re.escape(s_.lower()) + r"\b", name.lower())]
        subs.sort(key=len, reverse=True)
        sub_toks = {t for s_ in subs for t in _toks(s_)}
        distinct = [w for w in words if w not in GENERIC and w not in sub_toks]
        import itertools
        variants = [name.replace(".", ""), " ".join(w for w in words if w not in sub_toks)]
        for k in range(len(distinct), 0, -1):
            for c in itertools.combinations(distinct, k):
                if subs:
                    variants.append(subs[0] + " " + " ".join(c))
                variants.append(" ".join(c))

        def good(r):
            rn = set(_toks(r.get("name") or ""))
            if r.get("type") in BAD_TYPES or not rn:
                return False
            if distinct:   # most of the distinctive words must be in the place's own name
                need = len(distinct) if len(distinct) <= 2 else math.ceil(len(distinct) * 2 / 3)
                if len(rn & set(distinct)) < need:
                    return False
            elif not set(words) <= rn | {"shops", "centre", "shopping"}:   # e.g. "Bongaree Plaza" must be called that
                return False
            return True

        def in_suburb(r, p):
            if not subs:
                return True
            if subs[0].lower() in (r.get("display_name") or "").lower():
                return True
            c = self.suburbs.get(subs[0])
            return bool(c) and math.dist(p, c) * 100 <= 2.5

        seen, best = set(), None
        try:
            for v in variants:
                v = v.strip()
                if not v or v in seen:
                    continue
                seen.add(v)
                ok = []
                for r in self._search(v, vb):
                    p = [round(float(r["lon"]), 6), round(float(r["lat"]), 6)]
                    if not good(r) or not in_suburb(r, p) or zone.distance(Point(p)) * 100 > maxkm:
                        continue
                    ok.append((r.get("name"), r.get("type"), p))
                if not ok:
                    continue
                spread = max(math.dist(a[2], b[2]) for a in ok for b in ok) * 100
                if spread <= 0.5:
                    best = ok[0]
                elif subs and subs[0] in self.suburbs:
                    c = self.suburbs[subs[0]]
                    best = min(ok, key=lambda o: math.dist(o[2], c))
                else:
                    self.log.append(f"{name}: several different places called '{v}' near the zone, left unmarked")
                    continue
                break
        except RuntimeError as e:
            self.log.append(f"{name}: {e}; will try again next week")
            return None, None
        if best:
            self.db["found"][name] = {"ll": best[2], "osm_name": best[0], "osm_type": best[1]}
        else:
            self.db["found"][name] = {"ll": None}
        self.changed = True
        return (best[2], "osm") if best else (None, None)
