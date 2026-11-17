"""Build data/school.json: school-only bus routes from Translink's (pilot) SEQ school GTFS feed.

Usage: python3 tools/build_school.py <school_gtfs_dir> <regular_gtfs_dir> <repo_dir>
Lists route number and name only (no maps, timetables or live data).
"""
import sys, os, re, json, datetime
import pandas as pd
S, G, REPO = sys.argv[1:4]
sch = pd.read_csv(os.path.join(S, "routes.txt"), dtype=str)
reg = set(pd.read_csv(os.path.join(G, "routes.txt"), dtype=str).route_short_name)
sch = sch[(sch.route_type == "3") & (~sch.route_short_name.isin(reg))].drop_duplicates("route_short_name")
def k(n):
    m = re.match(r"^([A-Za-z]*)(\d+)", n); return (m.group(1), int(m.group(2))) if m else (n, 0)
rows = sorted(([r.route_short_name, (r.route_long_name or "").strip()] for r in sch.itertuples()), key=lambda x: k(x[0]))
json.dump({"updated": datetime.date.today().strftime("%-d %b %Y"), "routes": rows}, open(os.path.join(REPO, "data/school.json"), "w"), separators=(",", ":"))
print("school routes", len(rows))
