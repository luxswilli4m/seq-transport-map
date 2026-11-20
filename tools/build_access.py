"""Station accessibility and lift locations, for station cards and Journey Search.

Usage: python3 tools/build_access.py <repo_dir>

Writes data/access.json:
  "st":    Queensland Rail's station details for every SEQ train station (its "Your station" pages): the access
           level it publishes (independent / assisted / limited access), accessibility features (lift, escalator,
           ramps, stairs, level boarding, boarding ramp, hearing loop, accessible toilet and parking ...), its
           platform notes, and links to the station's accessibility map (picture and PDF) and audio description.
           Keyed by the map's station ids (Queensland Rail lists Translink's stop ids for each station).
  "lifts": lifts mapped in OpenStreetMap across SEQ (highway=elevator points and lines, lift doors, entrances with a
           lift), [lon, lat], from the Overpass API. The
           Journey Search walking routes use them to get around steps.
  "bs":    Brisbane City Council's bus stop accessibility audit (data.brisbane.qld.gov.au, "Bus Stop locations",
           CC BY 4.0), for stops in the Brisbane City Council area: {stop id: [stop type, boarding point, road gradient,
           cross fall, tactile indicators, last audit date]}, ratings E(asy) / M(edium) / H(ard).
Each part keeps its previous copy if its source can't be read this week.
"""
import sys, os, re, json, html, time, datetime as dt
import requests

REPO = sys.argv[1]
OUT = os.path.join(REPO, "data/access.json")
UA = {"User-Agent": "seq-transport-map (unofficial map; weekly refresh)", "Accept": "application/json"}
QR = "https://www.queenslandrail.com.au/SPWebApp/api/sd/"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter"]
SEQ_BBOX = (-28.40, 152.35, -26.10, 153.60)        # south, west, north, east

try: old = json.load(open(OUT))
except Exception: old = {}
net = json.load(open(os.path.join(REPO, "data/network.json")))
ST = net["data"]["stops"]
parent = {}
for p, ks in net.get("kids", {}).items():
    for k in ks: parent[k] = p

# features shown on station cards, in this order, with short labels
FEATS = [("Lift", "Lift"), ("Escalator", "Escalator"), ("Accessible ramp", "Accessible ramp"), ("Steep ramp", "Steep ramp"),
         ("Stairs", "Stairs"), ("Pedestrian footbridge", "Footbridge"), ("Level crossing", "Level crossing"),
         ("Level boarding to vehicle", "Level boarding"), ("Boarding ramp available", "Boarding ramp available"),
         ("Boarding ramp required", "Boarding ramp needed"), ("Assisted boarding point", "Assisted boarding point"),
         ("Platform rubber gap fillers", "Platform gap fillers"),
         ("Tactile Ground Surface Indicators (platform edges)", "Tactile platform edges"), ("Hearing loop available", "Hearing loop"),
         ("Accessible toilet (LH)", "Accessible toilet"), ("Accessible toilet (RH)", "Accessible toilet"),
         ("Accessible adult change facilities", "Adult change facilities"), ("Accessible parking", "Accessible parking"),
         ("Accessible Kiss ’n’ Ride", "Accessible kiss 'n' ride"), ("Assistance Animal Relief Area", "Assistance animal relief area"),
         ("Unattended site", "Unattended station")]
LABEL = dict(FEATS)

def text_items(h):
    """bullet points from a bit of HTML, as plain text"""
    if not h: return []
    h = re.sub(r"(?i)<br\s*/?>", "\n", h)
    items = re.findall(r"(?is)<li[^>]*>(.*?)</li>", h) or [h]
    out = []
    for it in items:
        t = html.unescape(re.sub(r"<[^>]+>", " ", it)).replace("​", "")
        t = re.sub(r"\s+", " ", t).strip()
        if t: out.append(t)
    return out

def level(z):
    z = (z or "").lower()
    return "limited" if "limited" in z else "assisted" if "assisted" in z else "independent" if "independ" in z else None

stations = {}
try:
    names = requests.get(QR + "GetStationNames", headers=UA, timeout=60).json()
    for n in names:
        d = None
        for a in range(3):
            try:
                d = requests.get(QR + "GetStationDetails", params={"id": n}, headers=UA, timeout=60).json(); break
            except Exception: time.sleep(3)
        if not d: continue
        ids = []
        for s in d.get("stops") or []:
            sid = s if s in ST else parent.get(s)
            if sid and sid in ST and sid not in ids: ids.append(sid)
        if not ids: continue
        have = {f["nm"] for f in d.get("facs", []) if f.get("exists")}
        feats = []
        for k, lab in FEATS:
            if k in have and lab not in feats: feats.append(lab)
        rec = {"n": d.get("Title") or n, "lvl": level(d.get("zn")), "f": feats, "plat": text_items(d.get("sginfor")),
               "map": d.get("stationmaporiginal1") or "", "pdf": d.get("pdffile") or "", "audio": d.get("audiofile") or ""}
        for sid in ids: stations[sid] = rec
    print("Queensland Rail stations", len(names), "matched", len({id(v) for v in stations.values()}), "ids", len(stations))
except Exception as e:
    print("Queensland Rail station details unavailable, keeping the previous copy:", e)
if len(stations) < 100: stations = old.get("st", {})

lifts = None
# lifts mapped as points or as short lines (highway=elevator), and doors or entrances tagged as lift doors
bb = ",".join(map(str, SEQ_BBOX))
q = (f'[out:json][timeout:180];(node["highway"="elevator"]({bb});way["highway"="elevator"]({bb});'
     f'node["door"="elevator"]({bb});node["entrance"]["elevator"="yes"]({bb}););out center;')
for url in OVERPASS:
    try:
        r = requests.post(url, data={"data": q}, headers={"User-Agent": UA["User-Agent"]}, timeout=180)
        r.raise_for_status()
        els = r.json().get("elements", [])
        pts = [(e["lon"], e["lat"]) if "lat" in e else (e["center"]["lon"], e["center"]["lat"]) for e in els if "lat" in e or "center" in e]
        lifts = []
        for x, y in sorted(pts):             # the same lift mapped twice (a point and its doors): keep one within 5 m
            if not any(abs(x - a) < 5e-5 and abs(y - b) < 5e-5 for a, b in lifts[-40:]): lifts.append((round(x, 6), round(y, 6)))
        print("OpenStreetMap lifts", len(lifts), "from", url); break
    except Exception as e:
        print("Overpass", url, "failed:", e)
if not lifts or len(lifts) < 50: lifts = old.get("lifts", [])

bs = {}
try:
    rows = None
    for a in range(4):
        try:
            rows = requests.get("https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/brisbane-bus-stops/exports/json",
                                headers=UA, timeout=180).json(); break
        except Exception as e: print("Brisbane bus stops, try", a + 1, "failed:", e); time.sleep(10)
    R1 = lambda v: (v or "")[:1].upper() if (v or "")[:1].upper() in "EMH" else ""
    for r in rows or []:
        sid = str(r.get("hastus") or "").strip()
        if sid not in ST and sid not in parent: continue
        typ = re.sub(r"^\d+\s*-\s*", "", r.get("bus_stop_type") or "")
        tac = {"Y": 1, "N": 0}.get((r.get("tactile_ground_surf_indicat_y_n") or "").upper())
        bs[sid] = [typ, R1(r.get("boarding_point")), R1(r.get("road_gradient")), R1(r.get("cross_fall")), tac, (r.get("date_of_last_audit") or "")[:10]]
    print("Brisbane City Council bus stops", len(rows or []), "matched", len(bs))
except Exception as e:
    print("Brisbane bus stop accessibility unavailable, keeping the previous copy:", e)
if len(bs) < 3000: bs = old.get("bs", {})

json.dump({"checked": dt.date.today().isoformat(), "st": stations, "lifts": [list(x) for x in lifts], "bs": bs}, open(OUT, "w"), separators=(",", ":"))
print("wrote", OUT, "stations", len(stations), "lifts", len(lifts), "Brisbane bus stops", len(bs))
