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
- **Light and dark maps** — light by default.

## Data and credits

- Timetable, routes and stops: Translink GTFS open data (refreshed weekly), Queensland Government. Route paths are simplified.
- Base map: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database Licence; tiles from [Protomaps](https://protomaps.com) (`tiles/seq.pmtiles`, South East Queensland extract).
- Map rendering: [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause), [PMTiles](https://github.com/protomaps/PMTiles) and [@protomaps/basemaps](https://github.com/protomaps/basemaps) (BSD-3-Clause). Fonts: Noto Sans (SIL Open Font Licence).

## What things mean

**Bus zones.** Brisbane bus routes are numbered by area: 1xx routes mostly run in the south, 2xx in the east, 3xx in the north, and so on. Each coloured shape shows where a three-digit series mostly stops. It's a rule of thumb rather than an official boundary. Striped (chevron) areas are places where stops from more than one series overlap, or where a few stops sit outside their series' main area. Dotted lines link outlying stops back to their zone.

**Busways.** Purple is the Northern Busway, teal the South East Busway (including the Woolloongabba spur) and orange the Eastern Busway. A thinner dashed section means buses run on ordinary roads between those stations. Ringed dots are busway stations.

**Trains, ferries and tram.** Train lines are drawn in Translink's line colours (T1 to T6). Ferries are blue-green and the G:link tram is yellow. Bus stops appear when you zoom in.

**Times.** In the Next column, green is a live prediction from the bus or train itself, amber means it's running late, and grey is the scheduled time. A dash means nothing more is running today.

**Alerts.** The ⚠ Alerts button turns orange when Translink has posted alerts. Each alert is tagged with when it applies, what it affects (a train line, bus route, station or stop) and whether it's a Disruption (unplanned, including cancelled trips) or Planned works.

**Saved stops and routes.** Tap ☆ to save. Saved items are kept in your browser on this device only. The ★ Stops and ★ Routes buttons and the saved items themselves change colour:

- **Orange:** there's a current alert for that stop or route.
- **Red:** a trip on that route, or through that stop, has been cancelled and hasn't reached its start time yet. Red clears once the cancelled trip's start time has passed.
- **Half red, half orange:** both of the above.

**School routes.** The School routes button lists Translink's school-only buses by number and name. They aren't drawn on the map. Some share numbers with everyday routes (school route S700 is not everyday route 700), which is why they're kept on a separate list.

## How it works behind the scenes

Everything is static files served by GitHub Pages. There is no server or database. `data/network.json` holds the routes, stops, zones and busways; `tiles/seq.pmtiles` holds the base map, which the browser reads in small pieces as you move around. Timetables are split into small area files in `data/tt/` (one per stop area) and `data/rt/` (one per route), loaded only when needed. `data/school.json` holds the school route list.

**Live data** (vehicle positions, arrival predictions, cancellations and alerts) comes from Translink's GTFS-Realtime feeds (CC BY 4.0) through a small Cloudflare Worker relay (`worker/worker.js`), which adds browser access and caches each feed for 15 seconds.

**Where locations come from.** Nobody types in coordinates. Translink publishes every stop with its exact latitude and longitude, and every route with the GPS path its buses follow. The build scripts look stations up by name and take their position from Translink's data. Each busway is drawn by following a real bus's path between one station and the next. Bus zones are worked out by placing every stop on a grid of 1.5 km squares and colouring each square by the route series that stops there most.

## How to update information

### The weekly refresh (automatic)

Every Monday at about 3:17 am Brisbane time a GitHub Action (`.github/workflows/refresh-data.yml`) downloads Translink's latest data and rebuilds everything: routes, stops, timetables, school routes, bus zones and busways. It commits the result if anything changed. You can also run it any time from the **Actions** tab: **Refresh Translink data → Run workflow**.

Bus zones and busways only change once the change is live, meaning buses are actually running the new routes or stopping at the new station within the next 7 days. Announced but not-yet-running changes are ignored until then.

### The safety check

Before replacing the zones and busways, the refresh compares the new version with the current one. If a zone would disappear or change size by more than 25 %, or a busway station name can't be found in Translink's data, it **keeps the old zones and busways** and opens a **GitHub issue** in this repository explaining what happened in plain English. GitHub emails you about new issues. Everything else (timetables, stops, alerts) still updates as normal.

When you get one of these issues, check the map against Translink's network. Then either:

- **If the change is genuine** (for example a big network change), go to **Actions → Refresh Translink data → Run workflow**, tick **force_zones**, and run it. This accepts the new zones.
- **If a station name couldn't be found**, fix the spelling in `tools/busways.json` (see below), then run the workflow normally.

Close the issue once it's sorted.

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

**Extending a busway at the end** works the same way: add the new station as the last item (and add a comma to the line above it). **Removing a station:** delete its line, taking care with commas. **Sections on ordinary roads** (drawn thinner) are listed under `"on_road_sections"` at the bottom of the file as pairs of neighbouring stations.

### Other things you can change by hand

- **Busway colours and names:** the `"colour"` and `"name"` fields in `tools/busways.json`.
- **Disclaimer and help text:** `index.html`, inside `<div id="info">`.
- **Live relay:** `worker/worker.js`, redeployed through the Cloudflare dashboard.
