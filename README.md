# QLD SEQ Public Transport Interactive Map — Unofficial

An interactive map of South East Queensland public transport: the Northern, South East and Eastern busways, bus route numbering zones, train lines, ferries, the G:link tram, and every bus stop.

**Live map:** https://luxswilli4m.github.io/seq-transport-map/

> **Unofficial product.** This map is not produced, endorsed or maintained by Translink or the Queensland Government. It is an independent visualisation of Translink open data, provided for information and consultation only. Routes, stops and services change — always check [translink.com.au](https://translink.com.au) or the MyTranslink app before travelling. No warranty is given as to accuracy or completeness.

## Features

- **Route search** — bus numbers (e.g. 397, M1), train lines (e.g. Cleveland), ferries (F1) and the G:link tram. Shows the full path and the stops in order for each direction.
- **Station, stop, street and suburb search** — jump to any stop or station and see every route serving it.
- **Show all routes** — from any stop or station, draw every route serving it with its destination; tap a line to open that route, and ‹ to return to the stop.
- **Layers** — bus zones, busways, bus stations, bus stops, trains, ferries and tram, each switchable.
- **Light and dark maps** — light by default.

## Data and credits

- Timetable, routes and stops: Translink GTFS open data (feed of 14 Nov 2026), Queensland Government. Route paths are simplified.
- Base map: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database Licence; tiles from [Protomaps](https://protomaps.com) (`tiles/seq.pmtiles`, South East Queensland extract).
- Map rendering: [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause), [PMTiles](https://github.com/protomaps/PMTiles) and [@protomaps/basemaps](https://github.com/protomaps/basemaps) (BSD-3-Clause). Fonts: Noto Sans (SIL Open Font Licence).

## Live data

Live vehicle positions, arrival predictions and service alerts come from Translink's GTFS-Realtime feeds (CC BY 4.0) through a small Cloudflare Worker relay (`worker/worker.js`), which adds browser access and caches each feed for 15 seconds.

## How it works

Everything is static files served by GitHub Pages — there is no server or database. `data/network.json` holds the routes, stops, zones and busways; `tiles/seq.pmtiles` holds the base map, which the browser reads in small pieces as you move around.

Timetables are split into small area files in `data/tt/`, loaded only for the stop you open.

**Automatic refresh:** every Monday a GitHub Action (`.github/workflows/refresh-data.yml`) downloads the latest Translink GTFS, rebuilds `data/network.json` and `data/tt/` with the scripts in `tools/`, and commits the result if anything changed. It can also be run by hand from the Actions tab (**Refresh Translink data → Run workflow**). Bus zones and busway geometry are kept as they are.
