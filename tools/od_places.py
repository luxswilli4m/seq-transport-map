"""Find on-demand key locations that Translink lists by name only.

Used by build_ondemand.py when a destination doesn't match a Translink stop, a base-map place or a
label on Translink's own map picture. Two open place databases are tried, in order:

  1. OpenStreetMap's place search (nominatim.openstreetmap.org; not map tiles).
  2. Overture Maps places (overturemaps.org): an open database of over 60 million businesses and
     places from Meta, Microsoft, Foursquare and others. Only the slice covering SEQ is read, straight
     from Overture's public files, and only when there is something left to find.

The same checks apply to both. A result only counts if
  * its own name has most of the destination's distinctive words (not just the suburb, or words like
    "centre"), or, when the destination is only a suburb plus a word like "Plaza", has all its words;
  * it isn't a suburb, road, track, bus stop or parcel locker, and (Overture) its confidence is 0.6+;
  * it's in the suburb the destination names, if it names one; and
  * it's inside the zone or within 2 km of it (8 km for Logan's destinations, which are outside the
    pick-up suburbs).
If several results qualify and they're more than 500 m apart, the one nearest the named suburb wins;
with no suburb to go by, it's left unmarked rather than guessed.

Every answer is saved in tools/ondemand_places.json with the sources already tried, so each name is
looked up once per source, not every week. Delete an entry there to search again. Hand fixes can go
under "manual": {"Name": [lon, lat]} and always win.
"""
import json, os, re, io, time, math, itertools, subprocess, urllib.parse

UA = "seq-transport-map (github.com/luxswilli4m/seq-transport-map)"
BAD_TYPES = {"administrative", "suburb", "locality", "neighbourhood", "hamlet", "postcode", "track", "bus_stop",
             "platform", "residential", "unclassified", "tertiary", "secondary", "primary", "service", "footway",
             "path", "city", "town", "village", "quarter", "station", "storage_facility", "real_estate_service",
             "historic_site"}
GENERIC = {"the", "and", "of", "at", "shops", "shop", "club", "centre", "center", "shopping", "island", "co",
           "community", "plaza"}
SEQ = (151.8, -28.4, 153.6, -26.0)


def _toks(s):
    return [t for t in re.split(r"[^a-z0-9']+", s.lower().replace(".", "")) if t]


class Places:
    def __init__(self, repo, suburbs):
        self.path = os.path.join(repo, "tools", "ondemand_places.json")
        self.db = json.load(open(self.path)) if os.path.exists(self.path) else {}
        self.db.setdefault("_help", "On-demand key locations found with OpenStreetMap search and Overture Maps (tools/od_places.py). "
                                    "'found' is a cache (delete an entry to search again). Put hand fixes in 'manual' as "
                                    "\"Name\": [lon, lat]; they always win.")
        self.db.setdefault("manual", {}); self.db.setdefault("found", {})
        self.suburbs = suburbs      # {"Cornubia": [lon, lat], ...}
        self.changed = False
        self.log = []
        self._overture = None

    def save(self):
        if self.changed:
            json.dump(self.db, open(self.path, "w"), indent=1, ensure_ascii=False)

    # ---------- shared checks
    def _setup(self, name, zones, maxkm):
        from shapely.geometry import Polygon
        from shapely.ops import unary_union
        zone = unary_union([Polygon(z).buffer(0) for z in zones])
        x0, y0, x1, y1 = zone.bounds
        m = maxkm / 100 + 0.005
        words = _toks(name)
        subs = sorted([s for s in self.suburbs if re.search(r"\b" + re.escape(s.lower()) + r"\b", name.lower())], key=len, reverse=True)
        sub_toks = {t for s in subs for t in _toks(s)}
        distinct = [w for w in words if w not in GENERIC and w not in sub_toks]
        return dict(zone=zone, box=(x0 - m, y0 - m, x1 + m, y1 + m), words=words, subs=subs, sub_toks=sub_toks, distinct=distinct, maxkm=maxkm)

    def _ok(self, c, r):
        """r: {"name", "type", "ll", "where"} -> passes the checks?"""
        from shapely.geometry import Point
        rn = set(_toks(r["name"] or ""))
        if r.get("type") in BAD_TYPES or not rn:
            return False
        if c["distinct"]:
            need = len(c["distinct"]) if len(c["distinct"]) <= 2 else math.ceil(len(c["distinct"]) * 2 / 3)
            if len(rn & set(c["distinct"])) < need:
                return False
        elif not set(c["words"]) <= rn | {"shops", "centre", "shopping"}:
            return False
        if c["subs"]:
            s0 = c["subs"][0]
            if s0.lower() not in (r.get("where") or "").lower() and s0.lower() not in (r["name"] or "").lower():
                cen = self.suburbs.get(s0)
                if not cen or math.dist(r["ll"], cen) * 100 > 2.5:
                    return False
        return c["zone"].distance(Point(r["ll"])) * 100 <= c["maxkm"]

    def _choose(self, name, c, ok):
        if not ok:
            return None
        spread = max(math.dist(a["ll"], b["ll"]) for a in ok for b in ok) * 100
        if spread <= 0.5:
            return max(ok, key=lambda r: r.get("conf", 1))
        if c["subs"] and c["subs"][0] in self.suburbs:
            cen = self.suburbs[c["subs"][0]]
            return min(ok, key=lambda r: math.dist(r["ll"], cen))
        self.log.append(f"{name}: several different places match, left unmarked")
        return None

    # ---------- entry point
    def find(self, name, zones, maxkm=2.0, sources=("osm",)):
        """Return ([lon, lat], source) or (None, None)."""
        if name in self.db["manual"]:
            return self.db["manual"][name], "manual"
        hit = self.db["found"].get(name) or {}
        if hit.get("ll"):
            return hit["ll"], hit.get("src", "osm")
        tried = set(hit.get("tried", ["osm"] if name in self.db["found"] else []))
        c = None
        for src in sources:
            if src in tried:
                continue
            c = c or self._setup(name, zones, maxkm)
            try:
                best = self._osm(name, c) if src == "osm" else self._overture_find(name, c)
            except Exception as e:
                self.log.append(f"{name}: {src} lookup failed ({e}); will try again next week")
                continue
            tried.add(src)
            if best:
                self.db["found"][name] = {"ll": best["ll"], "src": src, "matched": best["name"], "type": best.get("type"), "tried": sorted(tried)}
                self.changed = True
                return best["ll"], src
            self.db["found"][name] = {"ll": None, "tried": sorted(tried)}
            self.changed = True
        return None, None

    def candidates(self, name, zones, maxkm=2.0, sources=("osm", "overture")):
        """Every place passing the checks, from each source (looked up once, then kept in the cache).
        Returns [{"name", "ll", "src"}]. Used where Translink's map picture says roughly where it is,
        so the build can take the database record nearest to Translink's own icon."""
        cache = self.db.setdefault("candidates", {}).setdefault(name, {})
        out, c = [], None
        for src in sources:
            if src not in cache:
                c = c or self._setup(name, zones, maxkm)
                try:
                    found = self._osm(name, c, every=True) if src == "osm" else self._overture_all(c)
                except Exception as e:     # a source being down never stops the build; it's retried next week
                    self.log.append(f"{name}: {src} lookup failed ({e}); will try again next week")
                    continue
                cache[src] = [{"name": r["name"], "ll": r["ll"]} for r in found]
                self.changed = True
            out += [dict(r, src=src) for r in cache[src]]
        return out

    # ---------- OpenStreetMap
    def _search(self, q, box):
        u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
            {"q": q, "format": "jsonv2", "limit": 10, "countrycodes": "au", "bounded": 1,
             "viewbox": f"{box[0]:.4f},{box[3]:.4f},{box[2]:.4f},{box[1]:.4f}"})
        r = subprocess.run(["curl", "-sS", "-m", "30", "-A", UA, u], capture_output=True, text=True)
        time.sleep(1.1)        # OpenStreetMap's fair-use limit: at most one search a second
        if r.returncode != 0:
            raise RuntimeError("OpenStreetMap search unreachable")
        try:
            return json.loads(r.stdout or "[]")
        except ValueError:
            return []

    def _osm(self, name, c, every=False):
        variants = [name.replace(".", ""), " ".join(w for w in c["words"] if w not in c["sub_toks"])]
        for k in range(len(c["distinct"]), 0, -1):
            for comb in itertools.combinations(c["distinct"], k):
                if c["subs"]:
                    variants.append(c["subs"][0] + " " + " ".join(comb))
                variants.append(" ".join(comb))
        seen, allok = set(), []
        for v in variants:
            v = v.strip()
            if not v or v in seen:
                continue
            seen.add(v)
            ok = []
            for r in self._search(v, c["box"]):
                rr = {"name": r.get("name"), "type": r.get("type"), "where": r.get("display_name"),
                      "ll": [round(float(r["lon"]), 6), round(float(r["lat"]), 6)]}
                if self._ok(c, rr):
                    ok.append(rr)
            if every:
                allok += [r for r in ok if r["ll"] not in [a["ll"] for a in allok]]
                continue
            best = self._choose(name, c, ok)
            if best:
                return best
        return allok if every else None

    # ---------- Overture Maps
    def _overture_rows(self):
        if self._overture is not None:
            return self._overture
        import requests, pyarrow.parquet as pq, pyarrow.compute as pc
        stac = "https://stac.overturemaps.org"
        try:
            rel = requests.get(f"{stac}/catalog.json", timeout=60).json()["latest"]
            files = []
            n = int(requests.get(f"{stac}/{rel}/places/place/collection.json", timeout=60).json()["partition:file_count"])
            for i in range(n):
                it = requests.get(f"{stac}/{rel}/places/place/{i:05d}/{i:05d}.json", timeout=60).json()
                b = it["bbox"]
                if b[0] <= SEQ[2] and b[2] >= SEQ[0] and b[1] <= SEQ[3] and b[3] >= SEQ[1]:
                    files += [a["href"] for a in it["assets"].values() if "amazonaws.com" in a["href"]][:1]
        except Exception as e:
            raise RuntimeError(f"Overture Maps unreachable ({e})")
        rows = []
        for url in files:
            f = pq.ParquetFile(io.BufferedReader(_HTTPRangeFile(url), buffer_size=8 << 20))
            md = f.metadata
            names = [md.schema.column(i).path for i in range(md.num_columns)]
            ix = {nm: i for i, nm in enumerate(names)}
            keep = []
            for r in range(md.num_row_groups):      # only the parts of the file that cover SEQ
                st = lambda nm: md.row_group(r).column(ix[nm]).statistics
                if st("bbox.xmin").max >= SEQ[0] and st("bbox.xmax").min <= SEQ[2] and st("bbox.ymin").max >= SEQ[1] and st("bbox.ymax").min <= SEQ[3]:
                    keep.append(r)
            if not keep:
                continue
            tb = f.read_row_groups(keep, columns=["names", "bbox", "basic_category", "addresses", "confidence"])
            b = tb.column("bbox").combine_chunks()
            x, y = pc.struct_field(b, "xmin"), pc.struct_field(b, "ymin")
            tb = tb.filter(pc.and_(pc.and_(pc.greater_equal(x, SEQ[0]), pc.less_equal(x, SEQ[2])),
                                   pc.and_(pc.greater_equal(y, SEQ[1]), pc.less_equal(y, SEQ[3]))))
            for r in tb.to_pylist():
                nm = (r["names"] or {}).get("primary")
                if not nm or (r["confidence"] or 0) < 0.6:
                    continue
                ad = (r["addresses"] or [None])[0] or {}
                rows.append({"name": nm, "type": r.get("basic_category"), "where": ad.get("locality") or "",
                             "conf": r["confidence"], "ll": [round(r["bbox"]["xmin"], 6), round(r["bbox"]["ymin"], 6)]})
        print(f"Overture Maps {rel}: {len(rows)} SEQ places loaded")
        self._overture = rows
        return rows

    def _overture_all(self, c):
        x0, y0, x1, y1 = c["box"]
        key = set(c["distinct"] or c["words"])
        return [r for r in self._overture_rows()
                if x0 <= r["ll"][0] <= x1 and y0 <= r["ll"][1] <= y1 and key & set(_toks(r["name"])) and self._ok(c, r)]

    def _overture_find(self, name, c):
        return self._choose(name, c, self._overture_all(c))


class _HTTPRangeFile(io.RawIOBase):
    """Read-only seekable file over HTTP range requests, so only the needed parts are downloaded."""
    def __init__(self, url):
        import requests
        self.url, self.s, self.pos = url, requests.Session(), 0
        r = self.s.head(url, timeout=60); r.raise_for_status()
        self.size = int(r.headers["Content-Length"])

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, wh=0):
        self.pos = off if wh == 0 else self.pos + off if wh == 1 else self.size + off
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size:
            return 0
        end = min(self.size, self.pos + len(b)) - 1
        r = self.s.get(self.url, headers={"Range": f"bytes={self.pos}-{end}"}, timeout=180); r.raise_for_status()
        d = r.content; b[:len(d)] = d; self.pos += len(d)
        return len(d)
