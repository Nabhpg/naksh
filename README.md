# NAKSH — Campus Cartography · Chandigarh University

Shortest-path navigation across Chandigarh University, built on the real campus road network
(OpenStreetMap) with Dijkstra's algorithm and a binary min-heap.

**Live:** https://naksh-cu.netlify.app

Advanced Data Structures & Algorithms project, Sections 704-A & 706-A:
- Nabh Priya Gautam (25BCS11922)
- Ritika Rana (25BCS10664)

## Pages
- `index.html`: the map. Pick A and B, watch Dijkstra explore, see the shortest path.
- `working.html`: how it works (graph, adjacency list, min-heap, Dijkstra, complexity, tech stack).
- `team.html`: the makers.

## Project layout
```
index.html, working.html, team.html   pages
css/        styles (style.css shared, working.css, team.css)
js/         dijkstra.js (graph + heap + algorithm), app.js (map), working.js, team.js, clouds.js, loader.js
data/       cu_data.js: the generated campus graph (do not edit by hand)
data_raw/   osm_map.json: raw OpenStreetMap download for the campus
tools/      build_data.py (raw OSM -> cu_data.js), deploy.sh (publish to Netlify)
```

## Run locally (Mac)
```bash
cd naksh
python3 -m http.server 5173
```
Open http://localhost:5173.

## Change the map data
All fixes live at the top of `tools/build_data.py`: `BUILDING_NAMES`, `ENTRANCE_HINTS`,
`MANUAL_LINKS`, `MANUAL_PATHS`, `MANUAL_BUILDINGS`, `MANUAL_POINTS`, `WALL_CUTS`.
After editing, rebuild the graph:
```bash
python3 tools/build_data.py
```
To refresh the raw OpenStreetMap data first:
```bash
curl -A "naksh-campus-map" "https://api.openstreetmap.org/api/0.6/map.json?bbox=76.565,30.760,76.585,30.778" -o data_raw/osm_map.json
```

## Deploy to Netlify
Needs Node.js. Log in once with `npx netlify-cli login`, then:
```bash
bash tools/deploy.sh
```
This publishes to the same link, https://naksh-cu.netlify.app.

## Credits
Map data © OpenStreetMap contributors (ODbL) · Imagery © Esri, Maxar, Earthstar Geographics · Map engine: MapLibre GL JS.
