"""Queensland school holidays and public holidays, for sorting measured travel times by kind of day.

Usage: python3 tools/build_school_days.py <repo_dir>

Reads the Department of Education's school calendar (education.qld.gov.au, an .ics file listing school holidays
and public holidays) and writes tools/qld_days.json:
  {"sh": [[first day, last day], ...]   school holidays and student-free days (state schools), inclusive, YYYY-MM-DD
   "ph": {"YYYY-MM-DD": name}           public holidays from the calendar (the Brisbane Ekka included)}
tools/build_measured.py adds the public holidays from the Python holidays package (Queensland, which also includes
the Ekka) so a missing calendar entry doesn't matter. Other regional show holidays are not counted, and the
Christmas Eve evening holiday (6 pm-midnight) is left out because it falls after the PM window.
If the calendar can't be read, the previous file stays.
"""
import sys, os, re, json, datetime as dt
import requests

URL = "https://education.qld.gov.au/about/Documents/qld-school-holidays.ics"
out = os.path.join(sys.argv[1], "tools/qld_days.json")
try:
    r = requests.get(URL, timeout=60, headers={"User-Agent": "seq-transport-map (unofficial map)"})
    r.raise_for_status()
    t = r.text.replace("\r\n ", "").replace("\r\n", "\n")
except Exception as e:
    print("school calendar unavailable, keeping the previous list:", e); sys.exit(0)

d = lambda s: dt.date(int(s[:4]), int(s[4:6]), int(s[6:8]))
sh, ph = set(), {}
for ev in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", t, re.S):
    m = re.search(r"\nSUMMARY[^:]*:(.*)", ev); a = re.search(r"DTSTART[^:]*:(\d{8})", ev); b = re.search(r"DTEND[^:]*:(\d{8})", ev)
    if not (m and a): continue
    name = m.group(1).strip(); start = d(a.group(1)); end = d(b.group(1)) - dt.timedelta(days=1) if b else start
    if end < start: end = start
    if re.search(r"school holidays|student free|development day", name, re.I):   # no students travelling
        sh.add((start.isoformat(), end.isoformat()))
    elif re.search(r"public holiday", name, re.I) and not re.search(r"6\s*pm|evening", name, re.I):
        x = start
        while x <= end:
            ph[x.isoformat()] = re.sub(r"\s*Public Holiday\s*$", "", name); x += dt.timedelta(days=1)
if not sh:
    print("no school holidays found in the calendar; keeping the previous list"); sys.exit(0)
json.dump({"source": URL, "checked": dt.date.today().isoformat(), "sh": sorted(sh), "ph": dict(sorted(ph.items()))},
          open(out, "w"), indent=0)
print("school holiday periods", len(sh), "public holidays", len(ph), "->", out)
