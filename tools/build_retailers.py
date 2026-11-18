#!/usr/bin/env python3
"""go card vendors -> data/retailers.json

Uses the same feed as Translink's "go card retailer locations" page
(https://translink.com.au/tickets-and-fares/go-card/locations), which asks
/api/v1.0/retailer/bounds/N/S/E/W/<product>/<service> for each card type and
service. Every combination is fetched over a box that covers all of SEQ and
the results are merged by retailer id.

Output: {"updated": "YYYY-MM-DD", "r": [[id, name, address, lon, lat, kind, caps], ...]}
  kind: "m" fare machine, "t" retailer / station counter
  caps: short codes (see CAP below)
"""
import json, os, sys, time, urllib.request, datetime

API = "https://translink.com.au/api/v1.0/retailer/bounds/-24.0/-29.5/154.5/150.5/{p}/{s}?_format=json"
PRODUCTS = {"1": "go card", "4": "go explore card"}
SERVICES = {"1": "Buy", "2": "Top up", "4": "Refund", "5": "Change expiry"}
CAP = {  # Translink wording -> code used by the map
    "Buy go card": "gb", "Top up go card": "gt", "Refund go card": "gr",
    "Change expiry date go card": "ge", "Register go card": "gg",
    "View balance go card": "gv", "View history go card": "gh",
    "Buy go explore card": "eb", "Top up go explore card": "et", "Reload go explore card": "el",
}
MACHINE = {"4", "5", "7"}  # bus, rail, tram fare machines


def get(url):
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "seq-transport-map (github.com/luxswilli4m/seq-transport-map)"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            print("retry", url, e, file=sys.stderr)
            time.sleep(3 * (i + 1))
    raise SystemExit("could not fetch " + url)


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "data", "retailers.json")
    U = {}
    for p in PRODUCTS:
        for s in SERVICES:
            rows = get(API.format(p=p, s=s)) or []
            if isinstance(rows, dict):
                rows = list(rows.values())
            print(PRODUCTS[p], SERVICES[s], len(rows))
            for r in rows:
                U[r["id"]] = r
    unknown = set()
    R = []
    for r in sorted(U.values(), key=lambda r: int(r["id"])):
        caps = []
        for t in (r.get("service_product") or "").split(","):
            t = t.strip()
            if not t:
                continue
            if t in CAP:
                caps.append(CAP[t])
            else:
                unknown.add(t)
        try:
            lon, lat = round(float(r["longitude"]), 6), round(float(r["latitude"]), 6)
        except (TypeError, ValueError):
            continue
        kind = "m" if str(r.get("type_id")) in MACHINE else "t"
        R.append([int(r["id"]), r["name"].strip(), (r.get("address") or "").strip(), lon, lat, kind, "".join(sorted(set(caps), key=list(CAP.values()).index))])
    if unknown:
        print("unmapped services (shown as-is is not supported yet):", sorted(unknown), file=sys.stderr)
    if len(R) < 200:
        raise SystemExit(f"only {len(R)} retailers - feed looks broken, keeping the old file")
    d = {"updated": datetime.date.today().isoformat(), "r": R}
    with open(out, "w") as f:
        json.dump(d, f, separators=(",", ":"), ensure_ascii=False)
    print(len(R), "retailers ->", out)


if __name__ == "__main__":
    main()
