# QLD SEQ Public Transport Interactive Map — Unofficial

An interactive map of South East Queensland public transport: the Northern, South East and Eastern busways, bus route numbering zones, train lines, ferries, the G:link tram, and every bus stop.

**Live map:** https://luxswilli4m.github.io/seq-transport-map/

> **Unofficial product.** This map is not produced, endorsed or maintained by Translink or the Queensland Government. It is an independent visualisation of Translink open data, provided for information and consultation only. Routes, stops and services change — always check [translink.com.au](https://translink.com.au) or the MyTranslink app before travelling. No warranty is given as to accuracy or completeness.

## Features

- **Route search** — bus numbers (e.g. 397, M1), train lines (e.g. Cleveland), ferries (F1) and the G:link tram. Shows the full path and the stops in order for each direction.
- **Station, stop, street and suburb search** — jump to any stop or station and see every route serving it.
- **Show all routes** — from any stop or station, draw every route serving it with its destination; tap a line to open that route, and ‹ to return to the stop.
- **Layers** — bus zones, busways, bus stations, bus stops, trains, ferries and tram, each switchable.
- **Live data** — vehicle positions, arrival predictions, cancellations and service alerts.
- **Saved stops and routes** — with full route timetables and alert colours.
- **School routes list** — every school-only bus by number and name.
- **On demand** — Translink on-demand service areas and their destinations (Gold Coast, Logan, Ipswich Flexilink and Bribie Island).
- **Journey planner** — a link to Translink's official journey planner.
- **Light and dark maps** — light by default.

## Data and credits

- Timetable, routes and stops: Translink GTFS open data (refreshed weekly), Queensland Government. Route paths are simplified.
- Base map: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database Licence; tiles from [Protomaps](https://protomaps.com) (`tiles/seq.pmtiles`, South East Queensland extract).
- Map rendering: [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause), [PMTiles](https://github.com/protomaps/PMTiles) and [@protomaps/basemaps](https://github.com/protomaps/basemaps) (BSD-3-Clause). Fonts: Noto Sans (SIL Open Font Licence).

## What things mean

**Bus zones.** Brisbane bus routes are numbered by area: 1xx routes mostly run in the south, 2xx in the east, 3xx in the north, and so on. Each coloured shape shows where a three-digit series mostly stops. It's a rule of thumb rather than an official boundary. Striped (chevron) areas are places where stops from more than one series overlap, or where a few stops sit outside their series' main area. Dotted lines link outlying stops back to their zone.

**Outliers** are stops a route series serves more than about 400 m outside its zone; they get a striped patch. **Dotted lines** link outlying stops back to their zone along the roads buses actually take, including route variants that only some trips run (for example route 515's extension to Willowbank). Tap a dotted line to see which route it is, whether it's a variant, how many trips run that way, today's times, and the full timetable.

**Route variants.** Many routes have trips that leave the main route to serve extra stops. A route card lists these under "Some trips also run via", with roughly what share of trips use them, and draws them as a dashed line. The full timetable includes every trip and every stop, with a dash where a trip doesn't stop (the same layout as Translink's timetables).

**Busways.** Purple is the Northern Busway, teal the South East Busway (including the Woolloongabba spur) and orange the Eastern Busway. A thinner dashed section means buses run on ordinary roads between those stations. Ringed dots are busway stations.

**Trains, ferries and tram.** Train lines are drawn in Translink's line colours (T1 to T6), side by side wherever lines share track, like Translink's network map. Which lines share each stretch is worked out automatically from the track each line's own trains run on. Ferries are blue-green and the G:link tram is yellow. Bus stops appear when you zoom in.

**Route cards.** Each stop shows the scheduled time and minutes from the first stop for one run: the next full-length trip, or the exact service you're following.

**Interchanges.** Stations that share a name with nearby stops (within 300 m) get mode buttons beside Show all routes, for example Helensvale: Train · Bus · G:link, and Roma Street: Train · Bus. Each button shows that mode's departures from all of the station's stops, labelled with the stop or platform (Stop A to F, L1 bus stop, Platform 4). Worked out automatically from Translink's stop names.

**Platforms.** At stations and multi-bay stops, each row shows the platform or stop for the next departure (for example "Platform 9" or "Stop 1f"), taken from Translink's timetable. Later departures that leave from a different platform show a small tag beside the time. If the live feed says a service is using a different platform, the label turns amber and reads "Now platform 7".

**Times.** In the Next column, green is a live prediction from the bus or train itself, amber means it's running late, and grey is the scheduled time. A dash means nothing more is running today.

**Fleet numbers.** Every bus carries a fleet number from its operator (Brisbane City Council buses use 4 digits; other operators number their own fleets, so short numbers like 10 or 101 are normal). Once a bus is on the road, its number appears in three places: in the subtitle when you tap a live vehicle ("Fleet number 1234"), in a "Fleet number" row on saved-route timetables, and under live times on stop cards ("Bus 1234"). Trains send a service code (for example 1A57) rather than a train-set number, so train lines show "Service number" instead, and stop cards don't show it. Ferries send the vessel's name, shown as "Vessel".

**Following a live vehicle.** Tap a moving bus, train, ferry or tram on the map, or tap a route in a stop or station card (it follows the next live service on that row), and its route card shows that vehicle's own scheduled time at each stop (beside the minutes from its first stop) and its progress: stops it has already served are greyed out and marked **Departed**, stops it's within 500 m of say **Arriving**, and the rest say **Not arrived**. It updates every 20 seconds.

**Alerts.** The ⚠ Alerts button turns orange when Translink has posted alerts. Each alert is tagged with when it applies, what it affects (a train line, bus route, station or stop) and whether it's a Disruption (unplanned, including cancelled trips) or Planned works.

**Layer filters** (the buttons under the search bars) are remembered on your device, so the map opens the way you left it. Light/dark is remembered too.

**Saved stops and routes.** Tap ☆ to save. Saved items are kept in your browser on this device only. The ★ Stops and ★ Routes buttons and the saved items themselves change colour:

- **Orange:** there's a current alert for that stop or route.
- **Red:** a trip on that route, or through that stop, has been cancelled and hasn't reached its start time yet. Red clears once the cancelled trip's start time has passed.
- **Half red, half orange:** both of the above.

**BAU ▾ menu.** Quick zoom to key stations: Queen Street bus station, Cultural Centre, Roma Street and Helensvale. Each opens that station's card. To change the list, edit the `data-bau` buttons in `index.html` (each uses the station's id from `data/network.json`).

**Platform areas (BAU stations).** Zoomed right in on Queen Street, Cultural Centre, Roma Street or Helensvale, platforms are shaded blue with numbered badges (1, 2 … or bays like 1a, A). Shaded shapes come from OpenStreetMap's platform outlines where they exist (Roma Street and Helensvale train platforms); elsewhere a small box marks each platform or bay at Translink's position. Built by `tools/build_platforms.py` (station list at the top of that file) and refreshed weekly.

**More ▾ menu.** Extras live under **More ▾** in the top bar: On demand, School routes, Lost property and a link to Translink's feedback form, with room for future additions. **Journey planner ↗** sits next to ★ Routes.

**School routes.** School routes (under More ▾) lists Translink's school-only buses by number and name. They aren't drawn on the map. Some share numbers with everyday routes (school route S700 is not everyday route 700), which is why they're kept on a separate list.

**On demand.** The On demand button shades Translink's on-demand (pre-booked, flexible bus) service areas in navy and marks their destinations and key locations with yellow dots. Tap an area for how it works and where it goes. Destinations that couldn't be placed automatically are still listed, marked "(not marked on map)". Turning On demand on hides the other map layers; turning it off brings them back as they were. Gold Coast and Logan come from Translink's own map files and are exact. Ipswich Flexilink (zones C and D) and Bribie Island are traced from Translink's map pictures, so their edges are approximate; Bribie shows its start date until the service begins. Tamborine Mountain and Yarrabilba aren't drawn yet.

## How it works behind the scenes

Everything is static files served by GitHub Pages. There is no server or database. `data/network.json` holds the routes, stops, zones and busways; `tiles/seq.pmtiles` holds the base map, which the browser reads in small pieces as you move around. Timetables are split into small area files in `data/tt/` (one per stop area) and `data/rt/` (one per route), loaded only when needed. `data/school.json` holds the school route list.

**Live data** (vehicle positions, arrival predictions, cancellations and alerts) comes from Translink's GTFS-Realtime feeds (CC BY 4.0) through a small Cloudflare Worker relay (`worker/worker.js`), which adds browser access and caches each feed for 15 seconds.

**Where locations come from.** Nobody types in coordinates. Translink publishes every stop with its exact latitude and longitude, and every route with the GPS path its buses follow. The build scripts look stations up by name and take their position from Translink's data. Each busway is drawn by following a real bus's path between one station and the next. Bus zones are worked out by placing every stop on a grid of 1.5 km squares and colouring each square by the route series that stops there most.

## How to update information

### The weekly refresh (automatic)

Every Monday at about 3:17 am Brisbane time a GitHub Action (`.github/workflows/refresh-data.yml`) downloads Translink's latest data and rebuilds everything: routes, stops, timetables, school routes, bus zones, busways and on-demand areas. It commits the result if anything changed. You can also run it any time from the **Actions** tab: **Refresh Translink data → Run workflow**.

Bus zones and busways only change once the change is live, meaning buses are actually running the new routes or stopping at the new station within the next 7 days. Announced but not-yet-running changes are ignored until then.

### The safety check

Before replacing the zones and busways, the refresh compares the new version with the current one. If a zone would disappear or change size by more than 25 %, or a busway station name can't be found in Translink's data, it **keeps the old zones and busways** and opens a **GitHub issue** in this repository explaining what happened in plain English. GitHub emails you about new issues. Everything else (timetables, stops, alerts) still updates as normal.

When you get one of these issues, check the map against Translink's network. Then either:

- **If the change is genuine** (for example a big network change), go to **Actions → Refresh Translink data → Run workflow**, tick **force_zones**, and run it. This accepts the new zones.
- **If a station name couldn't be found**, fix the spelling in `tools/busways.json` (see below), then run the workflow normally.

Close the issue once it's sorted.

**Outliers without a dotted line.** The refresh also checks that every outlier patch got a dotted line. If one didn't (no bus path back to the zone could be found), it opens a GitHub issue listing where and which routes. Nothing is held back; it's just a heads-up to look at.

**Train line labels.** Translink colours some through-running trains by their far end (for example Gold Coast trains continuing to Doomben are coloured as the Doomben line). The map labels each train by the line that actually serves the station you're looking at, worked out automatically from each line's own routes, so these show correctly after every refresh.

### Adding a busway station (step by step)

New busway stations aren't detected automatically, because Translink's data doesn't say which stops are "busway stations". The list lives in one file, **`tools/busways.json`**, and adding a station is a one-line change.

1. **Wait until the station is open** and appears in Translink's data. Search for it on the map; if it shows up, it's in the data. Note its exact name, spelling included (for example `Buranda busway station`, not `Buranda Busway Station`).
2. **Open `tools/busways.json`** on GitHub and click the pencil icon (Edit this file).
3. **Find the busway.** Each busway has an entry: `"N"` Northern (stations list starts line 7), `"SE"` South East (line 23), `"SP"` the Woolloongabba spur (line 43) and `"E"` Eastern (line 51). Inside each is a `"stations"` list in travel order, end to end.
4. **Add the new name in its correct position** between the two stations it sits between. Each name is in double quotes and followed by a comma, except the last one in the list.
5. **Commit the change** (green button, "Commit changes").
6. **Run the refresh:** Actions → Refresh Translink data → Run workflow. After a few minutes the busway will be redrawn through the new station. If the name doesn't match, you'll get a GitHub issue saying which name wasn't found, and nothing on the map changes.

**Example.** Say a new station called "Example Road station" opened on the South East Busway between Greenslopes and Holland Park West. Lines 29 to 31 currently read:

```json
        "Buranda busway station",
        "Greenslopes station",
        "Holland Park West station",
```

You'd add one line so it reads:

```json
        "Buranda busway station",
        "Greenslopes station",
        "Example Road station",
        "Holland Park West station",
```

That's it. The build finds "Example Road station" in Translink's stop list, takes its position, and traces the busway from Greenslopes to Example Road and on to Holland Park West along the paths buses actually drive.

**Hand-drawn sections.** Where there's no bus path to trace, a section can be drawn by hand. Add `"extra": true` to draw it as well as the traced path (for example the Brisbane Metro tunnel from King George Square down Albert Street to Queen Street bus station, alongside the bus corridor). These live under `"manual_sections"` at the bottom of `tools/busways.json`: the two station names and a list of points as `[latitude, longitude]`, which you can copy from Google Maps by right-clicking the map. Run the workflow afterwards to redraw.

**Extending a busway at the end** works the same way: add the new station as the last item (and add a comma to the line above it). **Removing a station:** delete its line, taking care with commas. **Sections on ordinary roads** (drawn thinner) are listed under `"on_road_sections"` at the bottom of the file as pairs of neighbouring stations.

### On-demand areas

The shapes come from map files (KML) that Translink links on its own on-demand pages: the Gold Coast maps page and the Logan "sites" page. Logan's destinations come from the table on Translink's Logan destinations page. The weekly refresh re-reads these pages, so new or changed areas on those pages appear automatically.

Destinations are pinned automatically when their name confidently matches a Translink stop or a named place in the base map. Otherwise they're listed in the card as "(not marked on map)" rather than guessed.

The list of areas, the links to Translink's pages, and the short "how it works" text on each card live in **`tools/ondemand.json`**.

**Traced areas (Ipswich, Bribie Island).** Translink only publishes these as pictures, so their outlines were traced once, by lining each picture up with the real road network and picking out the boundary line, and are stored in **`tools/ondemand_traced.json`**. They don't update themselves. If Translink changes one of these areas, it needs re-tracing (ask for it to be redone). Their key locations, hours and start date are in `tools/ondemand.json`; edit those by hand if Translink's page changes. If Translink moves a page, the refresh keeps the previous areas on the map and opens a GitHub issue. Fix the page address in that file, then run the workflow.

### Other things you can change by hand

- **Lost property contacts:** `data/lostproperty.json`. Each operator has a `link` and `phone`; fill them in and they appear on the Lost property card (blank ones show "Contact details coming soon"). The weekly refresh never changes this file.

- **Busway colours and names:** the `"colour"` and `"name"` fields in `tools/busways.json`.
- **Disclaimer and help text:** `index.html`, inside `<div id="info">`.
- **Live relay:** `worker/worker.js`, redeployed through the Cloudflare dashboard.
