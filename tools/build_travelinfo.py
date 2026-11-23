"""Travel information for the map's Legend/information box -> data/travelinfo.json

Usage: python3 tools/build_travelinfo.py <repo_dir>

Reads a short list of Translink pages (paying, go card, fares, concessions, tickets and refunds,
using public transport, accessibility, contacts) and keeps each page's headings and paragraphs,
so the map can show and search them. Run weekly by the refresh workflow. A page that can't be read
keeps its previous copy; if nothing can be read the old file stays as it is.
"""
import sys, os, re, json, time, datetime as dt
import requests
from bs4 import BeautifulSoup

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
DEST = os.path.join(OUT, "data/travelinfo.json")
BASE = "https://translink.com.au"
UA = {"User-Agent": "Mozilla/5.0 (SEQ transport map; weekly refresh)"}

# topic, extra search words, pages
TOPICS = [
    ("Paying with a bank card or phone (contactless)", "tap on tap off contactless visa mastercard debit credit apple pay google wallet samsung pay smart ticketing amex american express card clash validator",
     ["/tickets-and-fares/contactless-payments", "/tickets-and-fares/contactless-payments/how-to-use-contactless-payments", "/tickets-and-fares/contactless-payment-support"]),
    ("go card", "go card top up auto top up buy balance register",
     ["/tickets-and-fares/go-card", "/tickets-and-fares/go-card/about-go-card", "/tickets-and-fares/go-card/buy-and-top-up", "/tickets-and-fares/go-card/auto-top-up"]),
    ("Fares and zones", "fare 50 cent price cost zone",
     ["/tickets-and-fares/fares-and-zones"]),
    ("Concessions", "concession seniors student pensioner children child free veterans discount",
     ["/tickets-and-fares/concessions"]),
    ("Buying and refunding tickets", "refund buy ticket paper ticket single",
     ["/tickets-and-fares/buy-and-refund-tickets"]),
    ("Using public transport", "pram bike pets luggage etiquette safety travel",
     ["/travel-with-us/using-public-transport"]),
    ("Accessibility", "wheelchair mobility aid disability assistance hearing vision accessible",
     ["/travel-with-us/accessibility"]),
    ("Contacts", "phone call contact help 13 12 30 feedback complaint lost property",
     ["/contact-us"]),
]

def clean(t):
    t = re.sub(r"\s+", " ", t or "").strip()
    return t.replace("✔️", "✔").replace(" ,", ",")

def page(path):
    r = requests.get(BASE + path, headers=UA, timeout=30)
    r.raise_for_status()
    s = BeautifulSoup(r.text, "html.parser")
    main = s.find(id="column-main")
    if not main: raise ValueError("no content")
    h1 = [h for h in main.find_all("h1") if clean(h.get_text())][:1]
    title = clean(h1[0].get_text()) if h1 else path.rsplit("/", 1)[-1].replace("-", " ").capitalize()
    for bad in main.select("nav, script, style, .breadcrumb, form, .visually-hidden, .sr-only"):
        bad.decompose()
    secs, cur, seen = [], {"h": "", "t": []}, set()
    for el in main.find_all(["h2", "h3", "h4", "p", "li", "td"]):
        if el.name in ("h2", "h3", "h4"):
            h = clean(el.get_text(" "))
            if not h or h.lower() in ("breadcrumb", "was this page helpful?"): continue
            if cur["t"]: secs.append(cur)
            cur = {"h": h, "t": []}; continue
        if el.name == "li" and el.find(["p", "li"]): continue          # take the inner paragraphs instead
        if el.name == "p" and el.find_parent("td"): continue
        x = clean(el.get_text(" "))
        if len(x) < 3 or x in seen or re.match(r"^(was this page helpful|share|print)\b", x, re.I): continue
        seen.add(x); cur["t"].append(("• " if el.name == "li" else "") + x)
    if cur["t"]: secs.append(cur)
    return {"title": title, "url": BASE + path, "s": secs}

old = {}
if os.path.exists(DEST):
    try: old = {p["url"]: p for t in json.load(open(DEST))["topics"] for p in t["pages"]}
    except Exception: old = {}
topics, ok = [], 0
for name, words, paths in TOPICS:
    pages = []
    for p in paths:
        try:
            pg = page(p); pg["checked"] = dt.date.today().isoformat(); pages.append(pg); ok += 1
            print("ok ", p, len(pg["s"]), "sections")
        except Exception as e:
            print("keep", p, e)
            if BASE + p in old: pages.append(old[BASE + p])
        time.sleep(1)
    if pages: topics.append({"t": name, "k": words, "pages": pages})
if not ok and os.path.exists(DEST):
    print("Nothing could be read; keeping the previous file."); sys.exit(0)
json.dump({"built": dt.date.today().isoformat(), "topics": topics}, open(DEST, "w"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(topics)} topics, {ok} pages read -> {DEST} ({os.path.getsize(DEST)//1024} kB)")
