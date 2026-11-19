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
- Addresses: G-NAF © Geoscape Australia, licensed under the [G-NAF End User Licence Agreement](https://data.gov.au/dataset/geocoded-national-address-file-g-naf), via [Overture Maps](https://overturemaps.org) (CDLA Permissive 2.0). Landmarks: OpenStreetMap.
- Elevation: Queensland Government QldDem elevation service (© State of Queensland, CC BY 4.0); backup: [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/) (SRTM, public domain).
- Elevation tile decoding: [LERC](https://github.com/Esri/lerc) by Esri (Apache 2.0), in `lib/lerc/`.
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

**Platform areas (BAU stations).** Zoomed right in on Queen Street, Cultural Centre, Roma Street or Helensvale, platforms are shaded blue with numbered badges (1, 2 … or bays like 1a, A). Shaded shapes are OpenStreetMap's platform outlines: from the base map where it has them (Roma Street and Helensvale train platforms), and from Overture Maps for the ones the base map leaves out, such as the underground Queen Street bus station and Cultural Centre busway platforms. These come from `tools/platform_shapes.json`, which is downloaded again only when Overture publishes a new monthly release. Each platform gets an outline whenever one can be matched: first any outline it sits on (within 25 m); failing that, an outline named exactly like it ("Roma Street busway, platform 1", up to 150 m away) or named for the station and its number ("Cultural Centre Platform 1", up to 60 m). Only when none of these exists is a small square drawn at Translink's position (today that's just Helensvale's bus bays A–F, which nobody has mapped yet). Overture's copy of OpenStreetMap is checked for a new release every week, so when someone maps a missing platform, its square turns into an outline by itself. Roma Street also shows the busway station's bus platforms 1 and 2, using only the OpenStreetMap outlines named for those bus platforms ("Roma Street busway, platform 1"), so they never borrow the train platform shapes beside them. Built by `tools/build_platforms.py` (station list at the top of that file) and refreshed weekly.

**Best connections** (More ▾, or the ⇄ Connections button next to the name on any stop or station card, which fills in that stop as the start and adds a ‹ back button to return) finds the quickest ways between stations, stops, places and street addresses. *When* offers **Leave now**, **Leave at…** or **Arrive by…**; the last two add a date menu (every day the downloaded timetables cover, listed in `data/plan/index.json`) and a time. *Arrive by* looks through departures in the four hours before your time and shows the latest ones that still get you there by then. A *Changes* slider sets how many changes to allow: Direct (the default, showing the next few direct departures, or the fewest-change options with a note if nothing is direct), up to 1, 2 or 3, or Any. The *Walk up to* slider (100–2000 m, default 1000 m) sets how far it will walk to change or finish, and to start from a nearby stop if nothing leaves from yours. From a stop or station, services leaving there come first; from a place or address you walk to the stops within that distance. If walking to a nearby stop would get you there at least 15 minutes sooner, that is added as an extra option at the bottom, marked in amber. It shows up to three options, fewest changes first (the fastest is tagged), and while a journey is shown the rest of the map is hidden until you leave the card, each with the platform or stop to board at, walks, number of stops, and live timing for the first leg. It runs entirely in the browser from one compact timetable per day (`data/plan/`, built weekly by `tools/build_planner.py` for the next 14 days, so there's always at least a week ahead). Only the day you pick is downloaded, about 240 KB. It doesn't work out fares, and every result links to Translink's journey planner.

**From and To.** Typing in either box shows one scrollable list: stations and stops first, then places (landmarks such as stadiums, hospitals, universities, schools, shopping centres, parks, beaches and venues, each with its official street address underneath), then street addresses (number, street, suburb and postcode). Businesses aren't listed. Only if nothing matches does a **Search online** row appear, which looks the words up once in OpenStreetMap's search, limited to South East Queensland (and to the suburb, if you typed one). A start filled in from a stop card stays until you edit the box; then it's cleared and you choose your own. Addresses are every SEQ street address in G-NAF, Australia's national address file (© Geoscape Australia, G-NAF licence), read from Overture Maps' public copy; units are dropped, leaving about 1.6 million. They're split into small files by the first two letters of the street name (`data/addr/`), so only the file for what you're typing is downloaded. Places are the base map's own named landmarks (OpenStreetMap), each given the nearest official G-NAF address. Built by `tools/build_addresses.py`, which runs weekly but downloads only when Overture publishes a new release. Journey ends can be a stop or a map point, so *Use my location* can be added later without changes to the planner.

**Walking.** Every walk follows the base map's streets, footpaths and paths (OpenStreetMap, read from the map's own tiles in your browser by `js/walk.js`), and walking times come from the real distance at about 80 m a minute. If no route can be found in the map data, the walk falls back to a straight-line estimate with a 25% allowance. **Avoid steps** keeps walks off steps wherever the map has another way; a journey whose walk can't avoid steps is tagged *Includes steps*. **Walk all the way** is offered when walking is within your *Walk up to* distance, or gets there no later than the fastest service (for *Arrive by*, lets you leave no earlier); it's listed first only when it's the quickest.

**Walking card.** Each journey with a walk has a slim dark-blue **Walking ›** button on its times row, with an orange **!** beside it if any of its walks has a steep stretch or steps. It opens a card listing each walk ("First walk: A to B", "Second walk: …") with its distance and time, total climb ↗ and descent ↘, a label (Flat under 2%, Gentle up to 5%, Moderate up to 7.1%, Steep over 7.1%, Very steep over 12.5%), an elevation profile with flagged stretches shaded, and a list of flags. ‹ goes back to your results. Flags follow the Australian Standard for access and mobility, **AS 1428.1**, and the **Disability Standards for Accessible Public Transport (DSAPT)**:

- Walkway: up to 1 in 20 (5%, 2.9°), treated as level.
- Ramp: 1 in 20 to 1 in 14 (5% to 7.1%), the steepest an accessible ramp may be.
- **Steeper than an accessible ramp**: over 1 in 14 (7.1%, 4.1°). Flagged orange.
- **Steeper than a kerb ramp**: over 1 in 8 (12.5%, 7.1°). Flagged red.
- Beyond assisted access: over 1 in 4 (25%, 14°), noted on the flag.

"1 in 14" means rising 1 m for every 14 m along. Each flag gives the steepest gradient as a percentage, in degrees and as 1 in …, with its length, uphill or downhill, the street, and how far into the walk it starts. Only stretches of about 30 m or more are flagged; steps are flagged separately (from OpenStreetMap). Heights come from the Queensland Government's elevation data (**QldDem**, `spatial-img.information.qld.gov.au`), which across built-up SEQ is 1 m LiDAR of the bare ground. The map keeps its own copy for everywhere within 2 km of a stop (`data/heights/`, about 1,400 tiles, built by `tools/build_heights.py`). Each tile is a 257 × 257 PNG of heights to 0.1 m at about 8.5 m spacing, so walks there don't depend on Queensland's service being up. The weekly refresh checks QldDem's version name and downloads again only when Queensland republishes, or for new tiles when new stops open. Walks outside the saved area ask the live service. It's read as the service's cached elevation tiles (about 4 m a pixel, roughly a second each; asking point by point takes 15 seconds or more), decoded with Esri's open-source LERC decoder in `lib/lerc/` (Apache 2.0), which loads only when a walk's heights are needed. Heights are smoothed over about 30 m. Bridges, tunnels, and paths under cover or through buildings (found from the base map's building outlines) are taken as straight between their ends, because bare-ground heights aren't known under roofs; stretches of 10 m or more under cover are listed on the card as *Under cover or through a building* (slope not measured) and don't trigger the orange !. Unnamed footpaths are described by the street they run beside only when they're within 15 m of it; up to 40 m away they read *the footpath near* that street. Only if neither has heights are satellite heights used: Amazon's open terrain tiles (`elevation-tiles-prod.s3.amazonaws.com`, 30 m SRTM). Because those include buildings and trees (a CBD block can read as a 50 m hill), the card says so and shows only steps, not the climb or steep stretches. It's a guide, not official accessibility advice.

**Cross River Rail and The Wave** (under More ▾) work like On demand: the other layers clear and the project's sites are drawn; tap a site on the map or in the list for its card, ‹ goes back to the project's main card, and – shrinks the card. Each main card summarises what the Queensland Government, TMR and the Cross River Rail Delivery Authority have published (timing and cost as most recently stated), lists the sites, and ends with links to the official and related sites. It's an unofficial summary; check the official sites.

- *Cross River Rail*: the tunnel route and work sites come from OpenStreetMap (via Overture Maps): the "Cross River Rail Up/Down" tracks and construction areas named for the project, such as "Cross River Rail Construction site". Stations with no mapped site boundary get a circle. Each site's card shows a short summary, its current status from its official page (for example "now open to customers"), the latest official progress update for it (the "At Albert Street, …" paragraphs on crossriverrail.qld.gov.au/construction/progress), and the newest works notices for its area with their PDFs. Those parts update every week by themselves. Sites and summaries are listed in `tools/projects.json`.
- *The Wave*: the rail corridor and station precincts (Beerwah, Bells Creek (Aura), Caloundra, Aroona, Birtinya) are traced from TMR's Corridor Alignment Map PDF by `tools/trace_wave.py`. Each map page's purple corridor and pink stations are picked out of its aerial photo. The page is placed on the ground by matching its street names to the same streets in the base map, trying every rotation and scale. Pages with few street names use their north arrow and the neighbouring pages' scale, and must agree with a neighbouring page where they overlap, or they're left out. Gaps left by pages that can't be placed (two forest pages and two around Bells Creek) are joined with a dashed line, and Bells Creek (Aura) station is placed between Aura Boulevard and Bells Creek Arterial Road as TMR's map 9 shows. Stage 3 (metro) is traced from TMR's overview map. It's placed from TMR's interactive-map markers and the real road network, then pinned at the hospital station (Eccles Boulevard at Doherty Street), Birtinya and the airport. It's solid to Mountain Creek (corridor maps published June 2026) and dashed beyond, where TMR is still investigating the route. Stage 3 station cards use TMR's own marker descriptions, and the main card lists the latest documents on TMR's project pages. Everything re-traces itself only when TMR changes its maps.

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

Destinations are pinned automatically when their name confidently matches a Translink stop or a named place in the base map. If neither works, `tools/od_places.py` looks the name up with OpenStreetMap's place search (nominatim.openstreetmap.org, not map tiles). It only accepts a result whose own name has most of the destination's distinctive words, that sits in the suburb the destination names, and that is in or near the zone. If there are several such places far apart, it leaves the destination unmarked rather than guessing. These pins say "(approximate location)" on the card. Each name is searched once and the answer kept in **`tools/ondemand_places.json`**, so the weekly refresh only searches names it hasn't seen before. To fix or add a pin by hand, put `"Name": [longitude, latitude]` under `manual` in that file; hand pins always win. For the areas Translink publishes as map pictures (Ipswich, Bribie Island, Yarrabilba and any picture-based service added automatically), the build also reads the picture itself: it reads the labels with OCR (tesseract), finds the icon or numbered circle next to each key location's label, and converts that spot to map coordinates. It lines the picture up using the key locations whose positions are already known from Translink stops, or else the road alignment saved when the area was traced, and only uses it if the known ones land within 250 m of where they should.

Translink draws its icons beside the labels rather than on the exact building, so the icon is used as a guide to *which* place is meant rather than as the pin itself. For each key location on a picture, the build collects every matching record from the base map, OpenStreetMap and Overture Maps. A record counts if it shares most of its words with Translink's name, both ways, so "Redbank Plains Shopping Village" matches but "Redbank Plains Soccer Field" doesn't. It then takes the one within 600 m of Translink's icon, preferring the closest name, then the most trusted source (Translink stops and the base map, then OpenStreetMap, then Overture), then the nearest. If nothing matches, the pin goes on Translink's icon. A key location given by Translink stop IDs (like Yarrabilba's) always stays on those stops. The matching records are looked up once and kept in `tools/ondemand_places.json`, so weekly runs don't search again. If OpenStreetMap or Overture can't be reached, the build carries on with what it has, raises no issue, and tries again the next week. The labels are re-read whenever Translink changes the picture or the list of key locations changes, so moved icons move their pins. If a key location disappears from an updated picture, you get a GitHub issue suggesting it be removed from the list. As a last resort, anything still unmarked is looked up in **Overture Maps**, an open places database (from Meta, Microsoft, Foursquare and others) that is especially good on shops and shopping centres. Only the part covering SEQ is read, straight from Overture's public files, and only when there's a name left to find, so most weeks it isn't downloaded at all. The same name, suburb and distance checks apply, and these pins are also marked approximate. Anything still not found is listed in the card as "(not marked on map)".

The list of areas, the links to Translink's pages, and the short "how it works" text on each card live in **`tools/ondemand.json`**.

**Traced areas (Ipswich, Bribie Island, Yarrabilba).** Translink only publishes these as map pictures, so their outlines are traced from the pictures and stored in **`tools/ondemand_traced.json`**. Each week `tools/trace_ondemand.py` finds the current picture on Translink's page (the `picture` entry in `tools/ondemand.json` says which page and which picture) and compares it with last week's.

- **Picture unchanged:** nothing happens.
- **Picture changed:** the outline is re-traced automatically. The script picks out the roam-zone outline, lines the picture up with the real road network, and converts it to map coordinates. If it lines up well and the new area still overlaps the old one by at least 60 %, the map updates by itself. If not (Bribie Island's picture, with labels drawn across its edge, often falls in this group), the previous outline stays and an amber note on the On demand card tells viewers that Translink's map has changed and to check Translink's page. The note clears itself the next time Translink publishes a picture that traces confidently.
- **Key locations removed by Translink:** when a new picture no longer shows a key location that was on the old one, it comes off the map automatically. If it reappears on a later picture, it comes back. To stop a poor read of a new picture removing things by mistake, nothing is removed unless the new picture was read about as well as the old one.

Key locations, hours and start dates for traced areas are in `tools/ondemand.json`. Yarrabilba's key locations are pinned at the stop IDs Translink lists for them. Edit hours or key locations by hand if Translink's page changes.

**New services are added automatically.** Each week `tools/discover_ondemand.py` reads Translink's on-demand hub page (translink.com.au/travel-with-us/on-demand). For any service it links to that isn't on the map and isn't in the `not_drawn` list in `tools/ondemand.json` (currently Toowoomba and Hervey Bay, which are outside SEQ, and Tamborine Mountain, which has no area map), it:

1. looks for map files (KML) on the service's page, or on a map page linked from it, and draws them exactly, like Gold Coast and Logan;
2. otherwise looks for a map picture on the page and traces it. It finds roughly where the area is from the suburbs named on the page, then searches for the position and scale where the picture's roads line up with the real roads. The trace is only kept if the fit is clear.

Hours ("When you can travel") and any key locations listed with stop IDs are read from the page. The service then appears on the map with a note on its card saying it was added automatically and hasn't been checked. Automatic entries live in `tools/ondemand_auto.json`; move one into `tools/ondemand.json` to tidy its wording by hand. After that, its map files or picture are re-checked every week like the others. If neither approach works, the On demand card lists the service as not drawn yet (amber note). It is noted under `failed` in `tools/ondemand_auto.json` so it isn't retried every week; delete it from there to retry.

### Other things you can change by hand

- **Lost property contacts:** `data/lostproperty.json`. Each operator has a `link` and `phone`; fill them in and they appear on the Lost property card (blank ones show "Contact details coming soon"). The weekly refresh never changes this file.

- **Busway colours and names:** the `"colour"` and `"name"` fields in `tools/busways.json`.
- **Disclaimer and help text:** `index.html`, inside `<div id="info">`.
- **Live relay:** `worker/worker.js`, redeployed through the Cloudflare dashboard.

## go card vendors (More ▾)

Shows every go card retailer, station ticket office and fare machine on the map (orange for counters and shops, grey for fare machines), using the same feed as Translink's [go card retailer locations](https://translink.com.au/tickets-and-fares/go-card/locations) page. The panel filters by what you want to do (buy, top up, refund, change expiry) and by card type (go card, go explore card, or fare machines only), and lists the closest matches to the middle of the map. Tapping a dot opens that location's card with ticks and crosses for each service, plus a link to its page on Translink's site, and a ‹ back button to the vendor list. On these cards the close button is a minimiser (– / +): it shrinks the card to its title bar at the same width, and tapping the title or + brings it back. Turn the layer off from More ▾ to close it. Other layers are hidden while it's on, as with On demand.

`tools/build_retailers.py` rebuilds `data/retailers.json` in the weekly refresh. If the feed fails, the previous file is kept.

## Minutes from your stop (route cards)

When you open a route or train line from a stop or station card, the route card adds a blue column counting minutes from that stop ("Here", then 2 min, 4 min… to the end of the line). It sits next to the existing column of minutes from the first stop, and uses the same scheduled trip. Stops before yours are left blank. Platforms and same-named stations nearby (for example, a busway station's platforms) count as the same place.

## Station locality maps

Station cards show a **Locality map ↗** button next to **Show all routes** when Translink publishes a locality map for that station. It opens Translink's map in a new tab. Stations with more than one map, such as Capalaba (station and park 'n' ride), show one button per map, labelled with the map's name.

`tools/build_locality.py` rebuilds `data/locality.json` in the weekly refresh. It reads Translink's Maps page (translink.com.au/plan-your-journey/maps) and matches each map to stations by name. It ignores words like "station", "busway station", "interchange", "ferry terminal" and "park 'n' ride", and also tries short names in brackets ("RBWH") and the map's file name ("pa-hospital", "scuh"). Stations are preferred over bus stops. Where a name exists in two places (Queen Street, Griffith University), the one in the same region as the map's section on Translink's page wins. New, replaced and removed maps flow through automatically. Maps for places not on this map (regional Queensland, or Exhibition station, which isn't in the timetable) are skipped. If the page can't be read, the previous file is kept.

## BAU stations

The **BAU ▾** menu and the platform outlines both come from one list: **`tools/bau.json`**. To add a BAU location, add the station's name exactly as it appears on its station card (for example `"Toowong station"`), commit, and run the refresh (or wait for Monday). The station then appears in the BAU menu, labelled with the kinds of service that stop there. Its platforms are drawn when zoomed in: outlines where OpenStreetMap has them (from the base map or Overture), numbered squares where it doesn't. A station of the same name within 400 m (like Roma Street busway beside Roma Street train station) has its platforms drawn too, using only outlines named exactly for its own platforms (squares otherwise). If a name doesn't match any station, you get a GitHub issue saying so.
