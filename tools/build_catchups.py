#!/usr/bin/env python3
"""Queensland Rail Commuter Catch-Ups -> data/catchups.json

Usage: build_catchups.py <repo>

Reads the list of upcoming sessions (month, station, date, time) from Queensland Rail's Commuter Catch-Ups page and
matches each station to its station on the map. Runs in the weekly refresh; sessions already past are hidden by the
map itself, so the card stays right between refreshes. If the page can't be read, the previous list is kept.
"""
import sys, os, re, json, html, datetime, time
import requests

REPO = sys.argv[1] if len(sys.argv) > 1 else "."
URL = "https://www.queenslandrail.com.au/inthecommunity/communityengagement/commuter-catch-ups"
OUT = os.path.join(REPO, "data", "catchups.json")


def main():
    page = None
    for t in range(3):
        try:
            r = requests.get(URL, headers={"User-Agent": "Mozilla/5.0 (seq-transport-map weekly refresh)"}, timeout=60)
            if r.ok:
                page = r.text; break
        except requests.RequestException:
            pass
        time.sleep(5 + 10 * t)
    if not page:
        print("catch-ups: Queensland Rail's page couldn't be read; keeping the previous list"); return
    stops = json.load(open(os.path.join(REPO, "data", "network.json")))["data"]["stops"]
    by_name = {}
    for k, v in stops.items():
        if v[3] == "train" and k.startswith("place_"):
            by_name.setdefault(re.sub(r" station$", "", v[0]).lower(), k)
    sessions = []
    for t in re.findall(r"(?is)<table.*?</table>", page):
        for tr in re.findall(r"(?is)<tr.*?</tr>", t):
            cells = [re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", " ", c))).strip() for c in re.findall(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>", tr)]
            cells = [c for c in cells if c]
            if len(cells) < 3 or cells[0].lower() == "month":
                continue
            date = next((c for c in cells if re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", c)), None)
            if not date:
                continue
            d, m, y = map(int, date.split("/"))
            i = cells.index(date)
            station = cells[i - 1] if i >= 1 else ""
            when = cells[i + 1] if i + 1 < len(cells) else ""
            sessions.append({"station": station, "date": f"{y:04d}-{m:02d}-{d:02d}", "time": when,
                             "id": by_name.get(station.lower().replace(" station", ""))})
    text = [re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", " ", p))).strip() for p in re.findall(r"(?is)<p[^>]*>(.*?)</p>", page)]
    intro = next((p for p in text if "Commuter Catch-Up" in p and len(p) > 60), "")
    email = (re.findall(r"[\w.]+@qr\.com\.au", html.unescape(page)) or ["CommuterCatchUps@qr.com.au"])[0]
    if not sessions and os.path.exists(OUT):
        old = json.load(open(OUT))
        if old.get("sessions") and not re.search(r"no upcoming|no sessions", page, re.I):
            print("catch-ups: no sessions found on the page; keeping the previous list (the page layout may have changed)"); return
    json.dump({"checked": datetime.date.today().isoformat(), "url": URL, "intro": intro, "email": email, "sessions": sessions},
              open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"catch-ups: {len(sessions)} sessions ({sum(1 for s in sessions if s['id'])} matched to stations)")


if __name__ == "__main__":
    main()
