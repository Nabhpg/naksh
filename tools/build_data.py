"""
Builds data/cu_data.js from the raw OpenStreetMap download (data_raw/osm_map.json).

What it produces:
  - campus boundary polygon
  - building footprints (with heights for 3D) and which ones are selectable places
  - the walkable graph: every real road / service lane / footpath inside CU, split at
    junctions, weighted by real distance in metres (haversine)
  - each place linked to the nearest point on a real path ("access" edge)

Re-download the raw data with:
  curl -A "ADSA-campus-map" "https://api.openstreetmap.org/api/0.6/map.json?bbox=76.565,30.760,76.585,30.778" -o data_raw/osm_map.json
Then run:  python tools/build_data.py
"""
import json, math, os, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data_raw", "osm_map.json")
OUT = os.path.join(ROOT, "data", "cu_data.js")
CAMPUS_WAY_ID = 1171272464
BUFFER_M = 60  # include paths that come within this distance of the campus boundary

# Points that are not campus places (villages, things outside the campus)
SKIP_NAMES = {"Mamupur", "Lahra", "Golden House PG", "CU transmission link",
              "Chandigarh University", "National Highway 95"}

# Friendlier display names (OSM name -> label shown on the site)
RENAME = {
    "Block-1": "Block 1", "Block-2": "Block 2", "Block-3": "Block 3",
    "Block-5": "Block 5", "Block-7": "Block 7", "LC- Girls Hostel": "LC Girls Hostel",
    "LC-Girls Hostel": "LC Girls Hostel", "food shop": "Food Shop",
    "B3 Academic block": "B3 Academic Block", "Sport Complex": "Sports Complex",
}

# Footprints whose name in OSM is missing or wrong (verified on campus). Overrides any name OSM gives.
BUILDING_NAMES = {
    "way/1216997345": "Tagore Hostel",           # OSM only has a loose "Tagore Hostel" point behind it
    "relation/21474449": "C1 Academic Block",    # OSM labels it via a "Lords Food Court" point inside
}
# OSM points that duplicate a footprint above and should not become separate places
SKIP_NODES = {4393952890}  # "C1" point next to the C1 Academic Block footprint

# Where a building's entrance is (lon, lat). The nearest point on its outline is used and
# linked to the nearest path. Without an entry, the side of the outline facing the nearest path is used.
ENTRANCE_HINTS = {
    "Tagore Hostel": (76.5758702, 30.7659769),   # road side, mid-building
    "B4 Academic Block": (76.5745047, 30.7686263),   # south face, centre door
    "B3 Academic Block": (76.5758458, 30.7685523),   # south face, centre door
}

# Connections that exist on the ground but are missing in OpenStreetMap (verified on campus).
# Each joins an OSM node to the nearest point on an OSM way with a short walkable link.
MANUAL_LINKS = [
    {"node": 10088363301, "way": 744528317,
     "note": "track by Zakir A meets the service road by NC 5 (8.5 m gap in OSM)"},
]

# Buildings missing from OSM entirely: outline traced on the satellite image (lon, lat), verified on campus.
MANUAL_BUILDINGS = [
    {"name": "D8", "levels": 5, "ring": [
        (76.5707722, 30.7727954), (76.5713052, 30.7727867), (76.5713128, 30.7726484), (76.5712444, 30.7725542),
        (76.5708769, 30.7722241), (76.5708967, 30.7721165), (76.5708145, 30.7720298), (76.5706739, 30.7718929),
        (76.5704421, 30.7719499), (76.5703543, 30.7721801), (76.5707728, 30.7722056)]},
]
# Named points missing from OSM (gates etc.)
MANUAL_POINTS = [
    {"name": "Gate 3", "ll": (76.5720200, 30.7738600), "tags": {"barrier": "gate"}},
]

# Whole walkways that exist on the ground but are missing from OSM (traced on the satellite image,
# verified on campus). Points are (lon, lat); both ends are joined onto the nearest OSM road.
MANUAL_PATHS = [
    {"note": "walkway along the east side of the parking lot west of Sukhna Hostel, road to court path",
     "points": [(76.5773633, 30.7704661), (76.577345, 30.770395), (76.5773283, 30.7703103),
                (76.5773056, 30.7702032), (76.5772808, 30.7701157), (76.577265, 30.7700293),
                (76.5772585, 30.7699279)]},
    {"note": "D8 side road past the parking lot, then north-east along the boundary to Gate 3",
     "points": [(76.5706699, 30.771616), (76.5708057, 30.7717914), (76.5710719, 30.7717999), (76.5714161, 30.7718011),
                (76.5719065, 30.7718086), (76.5719096, 30.7721203), (76.5718986, 30.7725606), (76.5718974, 30.7729802),
                (76.5719123, 30.7733661), (76.5719659, 30.7736817), (76.5720062, 30.7738046)]},
]

# Places where an OSM way passes through the campus wall but there is no opening on the ground.
# The segment of `way` crossing the boundary nearest `near` (local metres, x=east, y=north) is removed.
WALL_CUTS = [
    {"way": 1102489365, "near": (-66, -403),
     "note": "track between Zakir and NC hostels does not exit through the north wall"},
]

R = 6371008.8
LAT0, LON0 = 30.7686, 76.5739
KX = math.cos(math.radians(LAT0)) * math.pi / 180 * R
KY = math.pi / 180 * R


def xy(lon, lat):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def unxy(x, y):
    return (LON0 + x / KX, LAT0 + y / KY)


def hav(a, b):
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def pip(pt, poly):
    x, y = pt
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-30) + xi:
            inside = not inside
        j = i
    return inside


def seg_proj(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
    q = (ax + t * dx, ay + t * dy)
    return t, q, math.hypot(px - q[0], py - q[1])


def dist_to_poly(p, poly):
    if pip(p, poly):
        return 0
    return min(seg_proj(p, poly[i], poly[i + 1])[2] for i in range(len(poly) - 1))


def centroid(poly):
    # area-weighted centroid in local metres
    A = cx = cy = 0
    for i in range(len(poly) - 1):
        x0, y0 = poly[i]; x1, y1 = poly[i + 1]
        c = x0 * y1 - x1 * y0
        A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    if abs(A) < 1e-9:
        return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))
    return (cx / (3 * A), cy / (3 * A))


def main():
    d = json.load(open(RAW, encoding="utf8"))
    els = d["elements"]
    N = {e["id"]: (e["lon"], e["lat"]) for e in els if e["type"] == "node"}
    W = {e["id"]: e for e in els if e["type"] == "way"}
    apply_manual_links(N, W)
    apply_manual_paths(N, W)

    campus_ll = [N[n] for n in W[CAMPUS_WAY_ID]["nodes"]]
    campus = [xy(*p) for p in campus_ll]
    apply_wall_cuts(N, W, campus)

    def near_campus(ll):
        return dist_to_poly(xy(*ll), campus) <= BUFFER_M

    # ---------- buildings ----------
    buildings = []
    for e in els:
        t = e.get("tags", {})
        if "building" not in t:
            continue
        if e["type"] == "way":
            ring = [N[n] for n in e["nodes"] if n in N]
        elif e["type"] == "relation":
            outer = [m for m in e.get("members", []) if m.get("role") == "outer" and m["ref"] in W]
            if not outer:
                continue
            ring = [N[n] for n in W[outer[0]["ref"]]["nodes"] if n in N]
        else:
            continue
        if len(ring) < 4:
            continue
        ringxy = [xy(*p) for p in ring]
        c = centroid(ringxy)
        if not near_campus(unxy(*c)):
            continue
        levels = t.get("building:levels") or t.get("level")
        try:
            h = float(t.get("height")) if t.get("height") else float(levels) * 3.6 if levels else None
        except ValueError:
            h = None
        buildings.append({"osm": f"{e['type']}/{e['id']}", "name": t.get("name"), "ring": ring,
                          "ringxy": ringxy, "c": c, "h": h, "tags": t})

    for k, M in enumerate(MANUAL_BUILDINGS, 1):
        ring = [tuple(p) for p in M["ring"]]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        ringxy = [xy(*p) for p in ring]
        buildings.append({"osm": f"manual/{k}", "name": M["name"], "ring": ring, "ringxy": ringxy,
                          "c": centroid(ringxy), "h": M.get("levels", 4) * 3.6, "tags": {"building": "yes", "name": M["name"]}})

    # named building *nodes* (e.g. "Block-1") -> give the name to the footprint they sit in
    places_pt = []
    for k, M in enumerate(MANUAL_POINTS, 1):
        places_pt.append({"osm": f"manual-point/{k}", "name": M["name"], "ll": tuple(M["ll"]), "tags": M.get("tags", {})})
    for e in els:
        t = e.get("tags", {})
        if e["type"] != "node" or "name" not in t or t["name"] in SKIP_NAMES or e["id"] in SKIP_NODES:
            continue
        p = (e["lon"], e["lat"])
        if not near_campus(p):
            continue
        host = next((b for b in buildings if pip(xy(*p), b["ringxy"])), None)
        if host and not host["name"]:
            host["name"] = t["name"]
            host["tags"] = {**host["tags"], **t}
        elif host:
            continue  # already named footprint, skip duplicate label
        else:
            places_pt.append({"osm": f"node/{e['id']}", "name": t["name"], "ll": p, "tags": t})

    # manual name fixes win over anything OSM says (and drop tags like amenity=restaurant)
    for b in buildings:
        if b["osm"] in BUILDING_NAMES:
            b["name"] = BUILDING_NAMES[b["osm"]]
            b["tags"] = {"building": "yes", "name": b["name"]}

    # named non-building areas (park, gate)
    for e in els:
        t = e.get("tags", {})
        if e["type"] != "way" or "building" in t or "name" not in t or t["name"] in SKIP_NAMES:
            continue
        if "highway" in t or e["id"] == CAMPUS_WAY_ID:
            continue
        ring = [N[n] for n in e["nodes"] if n in N]
        if not ring:
            continue
        rxy = [xy(*p) for p in ring]
        c = centroid(rxy) if ring[0] == ring[-1] and len(ring) > 3 else (
            sum(p[0] for p in rxy) / len(rxy), sum(p[1] for p in rxy) / len(rxy))
        ll = unxy(*c)
        if near_campus(ll):
            places_pt.append({"osm": f"way/{e['id']}", "name": t["name"], "ll": ll, "tags": t,
                              "area": ring if ring[0] == ring[-1] and len(ring) > 3 else None})

    # ---------- walkable graph ----------
    road_ways = []
    for e in W.values():
        t = e.get("tags", {})
        hw = t.get("highway")
        if not hw or hw in ("trunk", "motorway", "construction", "proposed"):
            continue
        if t.get("access") in ("private", "no") and hw != "service":
            continue
        lls = [N[n] for n in e["nodes"] if n in N]
        if any(near_campus(p) for p in lls):
            road_ways.append(e)

    use = collections.Counter()
    for e in road_ways:
        for n in e["nodes"]:
            use[n] += 1
    adj = collections.defaultdict(dict)
    for e in road_ways:
        ns = [n for n in e["nodes"] if n in N]
        for a, b in zip(ns, ns[1:]):
            if a == b:
                continue
            w = hav(N[a], N[b])
            adj[a][b] = w
            adj[b][a] = w

    # keep the largest connected component (paths you can actually reach)
    seen, comps = set(), []
    for s in adj:
        if s in seen:
            continue
        comp, stack = [], [s]
        seen.add(s)
        while stack:
            u = stack.pop(); comp.append(u)
            for v in adj[u]:
                if v not in seen:
                    seen.add(v); stack.append(v)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    main_c = set(comps[0])
    print(f"graph components: {[len(c) for c in comps[:8]]} -> keeping {len(main_c)} nodes")

    # edges as list
    edge_list = {}
    for a in main_c:
        for b, w in adj[a].items():
            if a < b:
                edge_list[(a, b)] = w

    # ---------- snap places onto the nearest real path ----------
    # buildings may only connect to paths inside the campus wall (never to an outside road)
    def inside(p):
        return dist_to_poly(p, campus) <= 3
    seg_xy = [(a, b, A, B) for (a, b) in edge_list
              for A, B in [(xy(*N[a]), xy(*N[b]))] if inside(A) and inside(B)]

    def snap(pxy):
        best = None
        for a, b, A, B in seg_xy:
            t, q, dd = seg_proj(pxy, A, B)
            if best is None or dd < best[0]:
                best = (dd, a, b, t, q)
        return best

    places = []
    for b in buildings:
        if not b["name"] or b["name"] in SKIP_NAMES:
            continue
        # anchor = point on footprint edge closest to the nearest path (acts as the "entrance")
        ring = b["ringxy"]
        hint = ENTRANCE_HINTS.get(RENAME.get(b["name"], b["name"]))
        target = xy(*hint) if hint else snap(b["c"])[4]
        ent = min((seg_proj(target, ring[i], ring[i + 1])[1] for i in range(len(ring) - 1)),
                  key=lambda q: math.hypot(q[0] - target[0], q[1] - target[1]))
        sn = snap(ent)
        places.append({"name": RENAME.get(b["name"], b["name"]), "osm": b["osm"], "kind": kind_of(b["name"], b["tags"]),
                       "c": unxy(*b["c"]), "entrance": unxy(*ent), "snap": sn, "building": b})
    for p in places_pt:
        pxy = xy(*p["ll"])
        places.append({"name": RENAME.get(p["name"], p["name"]), "osm": p["osm"], "kind": kind_of(p["name"], p["tags"]),
                       "c": p["ll"], "entrance": p["ll"], "snap": snap(pxy), "area": p.get("area")})

    # de-duplicate names (e.g. two "State Bank of India" points, two LC hostel labels)
    uniq = {}
    for p in places:
        if p["name"] not in uniq or (p.get("building") and not uniq[p["name"]].get("building")):
            uniq[p["name"]] = p
    places = list(uniq.values())

    # split edges at snap points
    splits = collections.defaultdict(list)
    for i, p in enumerate(places):
        dd, a, b, t, q = p["snap"]
        splits[(a, b)].append((t, i, q))

    node_ids, coords = {}, []

    def nid(key, ll):
        if key not in node_ids:
            node_ids[key] = len(coords)
            coords.append([round(ll[0], 7), round(ll[1], 7)])
        return node_ids[key]

    edges = []
    for (a, b), w in edge_list.items():
        ia, ib = nid(a, N[a]), nid(b, N[b])
        if (a, b) not in splits:
            edges.append([ia, ib, round(w, 2), 0])
            continue
        chain = [(0.0, ia, N[a])]
        for t, i, q in sorted(splits[(a, b)]):
            ll = unxy(*q)
            chain.append((t, nid(("snap", i), ll), ll))
        chain.append((1.0, ib, N[b]))
        for (t0, u, llu), (t1, v, llv) in zip(chain, chain[1:]):
            if u != v:
                edges.append([u, v, round(max(hav(llu, llv), 0.01), 2), 0])

    out_places = []
    for i, p in enumerate(places):
        s = node_ids[("snap", i)]
        pn = nid(("place", i), p["entrance"])
        edges.append([pn, s, round(max(hav(p["entrance"], coords[s]), 0.01), 2), 1])  # access link
        out_places.append({"id": i, "name": p["name"], "kind": p["kind"], "node": pn,
                           "lon": round(p["c"][0], 7), "lat": round(p["c"][1], 7),
                           "osm": p["osm"]})
        if p.get("building"):
            p["building"]["place"] = i

    # ---------- GeoJSON for display ----------
    def default_h(b):
        if b["h"]:
            return b["h"]
        n = (b["name"] or "").lower()
        if "hostel" in n or n.startswith("nc") or "zakir" in n:
            return 20
        if "block" in n or n[:1] in "abcd" and len(n) <= 3:
            return 18
        return 9

    bfeat = []
    for b in buildings:
        ring = [[round(x, 7), round(y, 7)] for x, y in b["ring"]]
        bfeat.append({"type": "Feature", "id": len(bfeat),
                      "properties": {"name": RENAME.get(b["name"], b["name"]) if b["name"] else "",
                                     "place": b.get("place", -1), "h": default_h(b)},
                      "geometry": {"type": "Polygon", "coordinates": [ring]}})

    rfeat = []
    for e in road_ways:
        lls = [[round(x, 7), round(y, 7)] for x, y in (N[n] for n in e["nodes"] if n in N)]
        if len(lls) > 1 and any(n in main_c for n in e["nodes"]):
            rfeat.append({"type": "Feature", "properties": {"hw": e["tags"]["highway"]},
                          "geometry": {"type": "LineString", "coordinates": lls}})

    area_feat = []
    for p in places:
        if p.get("area"):
            area_feat.append({"type": "Feature", "properties": {"name": p["name"]},
                              "geometry": {"type": "Polygon", "coordinates": [[list(x) for x in p["area"]]]}})

    data = {
        "source": "OpenStreetMap contributors (ODbL)",
        "campus": {"type": "Feature", "properties": {},
                   "geometry": {"type": "Polygon", "coordinates": [[[round(x, 7), round(y, 7)] for x, y in campus_ll]]}},
        "buildings": {"type": "FeatureCollection", "features": bfeat},
        "roads": {"type": "FeatureCollection", "features": rfeat},
        "areas": {"type": "FeatureCollection", "features": area_feat},
        "graph": {"nodes": coords, "edges": edges},
        "places": out_places,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf8") as f:
        f.write("// Generated by tools/build_data.py from OpenStreetMap data (c) OpenStreetMap contributors, ODbL.\n")
        f.write("window.CU_DATA = ")
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")
    print(f"buildings {len(bfeat)}, roads {len(rfeat)}, graph nodes {len(coords)}, edges {len(edges)}, places {len(out_places)}")
    for p in out_places:
        print(f"  {p['name']:<28} {p['kind']:<9} {places[p['id']]['snap'][0]:6.1f} m from path")


def apply_manual_links(N, W):
    """Insert a junction on the target way at the point nearest the node, then add a link way."""
    for k, L in enumerate(MANUAL_LINKS, 1):
        p = xy(*N[L["node"]])
        ns = W[L["way"]]["nodes"]
        best = min(((seg_proj(p, xy(*N[a]), xy(*N[b])), i) for i, (a, b) in enumerate(zip(ns, ns[1:]))),
                   key=lambda r: r[0][2])
        (t, q, dd), i = best
        if t <= 0.01 or t >= 0.99:
            j = ns[i] if t <= 0.01 else ns[i + 1]       # close enough to an existing node
        else:
            j = -k                                       # synthetic junction node
            N[j] = unxy(*q)
            ns.insert(i + 1, j)
        W[-k] = {"type": "way", "id": -k, "nodes": [L["node"], j],
                 "tags": {"highway": "footway", "manual": "yes", "note": L["note"]}}
        print(f"manual link {k}: node {L['node']} -> way {L['way']} ({dd:.1f} m)")


def apply_manual_paths(N, W):
    """Add each traced walkway as a footway; snap both ends onto the nearest road segment."""
    roads = [w for w in W.values() if w.get("tags", {}).get("highway") not in (None, "trunk")]
    for k, M in enumerate(MANUAL_PATHS, 1):
        ids = []
        for i, ll in enumerate(M["points"]):
            nid = -1000 * k - i
            N[nid] = tuple(ll)
            ids.append(nid)
        for end in (0, -1):
            p = xy(*N[ids[end]])
            best = None
            for w in roads:
                ns = w["nodes"]
                for i, (a, b) in enumerate(zip(ns, ns[1:])):
                    if a not in N or b not in N:
                        continue
                    t, q, dd = seg_proj(p, xy(*N[a]), xy(*N[b]))
                    if best is None or dd < best[0]:
                        best = (dd, w, i, t, q)
            dd, w, i, t, q = best
            if dd > 15:
                print(f"manual path {k}: {'start' if end == 0 else 'end'} left open (nearest road {dd:.0f} m away)")
                continue
            ns = w["nodes"]
            if t <= 0.02 or t >= 0.98:
                j = ns[i] if t <= 0.02 else ns[i + 1]
            else:
                j = -1000 * k - 900 - (0 if end == 0 else 1)
                N[j] = unxy(*q)
                ns.insert(i + 1, j)
            ids.insert(0, j) if end == 0 else ids.append(j)
            print(f"manual path {k}: {'start' if end == 0 else 'end'} joined to way {w['id']} ({dd:.1f} m)")
        W[-2000 - k] = {"type": "way", "id": -2000 - k, "nodes": ids,
                        "tags": {"highway": "footway", "manual": "yes", "note": M["note"]}}


def apply_wall_cuts(N, W, campus):
    """Split a way at the segment where it crosses the campus boundary (no gate there)."""
    for k, C in enumerate(WALL_CUTS, 1):
        ns = W[C["way"]]["nodes"]
        crossings = []
        for i, (a, b) in enumerate(zip(ns, ns[1:])):
            A, B = xy(*N[a]), xy(*N[b])
            if pip(A, campus) != pip(B, campus):
                mid = ((A[0] + B[0]) / 2, (A[1] + B[1]) / 2)
                crossings.append((math.dist(mid, C["near"]), i))
        if not crossings:
            print(f"wall cut {k}: no boundary crossing found on way {C['way']}")
            continue
        dd, i = min(crossings)
        tail = ns[i + 1:]
        del ns[i + 1:]
        if len(tail) > 1:
            W[-100 - k] = {**W[C["way"]], "id": -100 - k, "nodes": tail}
        print(f"wall cut {k}: way {C['way']} cut at segment {i} ({dd:.0f} m from marked point)")


def kind_of(name, tags):
    n = name.lower()
    if "hostel" in n or n.startswith("nc ") or "zakir" in n or "sukhna" in n or "tagore" in n or "shivalik" in n:
        return "hostel"
    if tags.get("amenity") in ("restaurant", "fast_food", "cafe") or "food" in n or "cafe" in n:
        return "food"
    if "gate" in n or "parking" in n:
        return "gate"
    if tags.get("leisure") or "sport" in n or "park" in n:
        return "leisure"
    if tags.get("amenity") == "bank":
        return "service"
    return "academic"


if __name__ == "__main__":
    main()
