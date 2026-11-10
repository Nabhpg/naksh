/*
 * NAKSH — campus navigation for Chandigarh University.
 * Map: Esri World Imagery (satellite) + OpenStreetMap-derived buildings & paths (data/cu_data.js)
 */
(() => {
  const D = window.CU_DATA;
  const nodes = D.graph.nodes;
  const edges = D.graph.edges;
  const places = D.places;
  const adj = buildAdjacency(nodes.length, edges);

  // ---------- palette (keep in sync with css/style.css) ----------
  const C = {
    ink: '#0b0a09', mask: '#070605',
    gold: '#c9a96e', goldHi: '#e9d6ad', goldLo: '#8a7148', ivory: '#f4eee3',
    A: '#efe4cf', B: '#c98b6b', hover: '#fbf3e4',
    // building fills (3D, darker) and outlines (lighter) per kind
    fill: { academic: '#9a8662', hostel: '#7f7178', other: '#6d7c71', none: '#22211e' },
    // storey ledges / cornice (a touch lighter) and rooftop tanks (a touch darker)
    ledge: { academic: '#b8a27a', hostel: '#9b8d95', other: '#8c9d91', none: '#2e2c28' },
    tank: { academic: '#75664c', hostel: '#5f545a', other: '#526057', none: '#1b1a18' },
    line: { academic: '#d9bf8c', hostel: '#b9a2ad', other: '#a3b8a8', none: '#3a3631' },
    wave: ['#7a6038', '#c49a5a', '#f0d9a8'],
  };
  const KIND_LABEL = { academic: 'Academic', hostel: 'Residence', food: 'Dining', leisure: 'Sports & Leisure',
    gate: 'Gate & Parking', service: 'Services' };
  const WALK_SPEED = 1.3; // m/s

  // ---------- derived data ----------
  const bldOfPlace = {};
  D.buildings.features.forEach(f => {
    const pid = f.properties.place;
    f.properties.kind = pid >= 0 ? places[pid].kind : 'none';
    if (pid >= 0) bldOfPlace[pid] = f.id;
  });
  const pointPlaces = places.filter(p => !(p.id in bldOfPlace));

  // ---------- building details: storey ledges every 3.6 m, a roof cornice, rooftop water tanks ----------
  const details = (() => {
    const MY = 111320, MX = Math.cos(30.77 * Math.PI / 180) * MY, out = [];
    const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
    for (const f of D.buildings.features) {
      const r = f.geometry.coordinates[0], { h, kind } = f.properties, o = r[0];
      const loc = r.map(([x, y]) => [(x - o[0]) * MX, (y - o[1]) * MY]);
      const n = loc.length - 1;
      const cx = loc.slice(0, n).reduce((s, p) => s + p[0], 0) / n, cy = loc.slice(0, n).reduce((s, p) => s + p[1], 0) / n;
      let far = loc[0], ext = 0;
      loc.forEach(p => { const d = Math.hypot(p[0] - cx, p[1] - cy); if (d > ext) { ext = d; far = p; } });
      const toLL = ([x, y]) => [o[0] + x / MX, o[1] + y / MY];
      const grown = m => loc.map(([x, y]) => toLL([cx + (x - cx) * (1 + m / ext), cy + (y - cy) * (1 + m / ext)]));
      const ring = grown(0.45);           // sits 45 cm proud of the wall
      for (let z = 3.6; z < h - 1; z += 3.6)
        out.push({ type: 'Feature', properties: { kind, base: z - 0.22, top: z + 0.12, t: 'ledge' }, geometry: { type: 'Polygon', coordinates: [ring] } });
      out.push({ type: 'Feature', properties: { kind, base: h - 0.1, top: h + 0.55, t: 'ledge' }, geometry: { type: 'Polygon', coordinates: [grown(0.3)] } });
      if (kind === 'none' || h < 12) continue;
      // one or two tanks along the building's long axis
      const ux = (far[0] - cx) / ext, uy = (far[1] - cy) / ext, vx = -uy, vy = ux;
      for (const t of ext > 30 ? [-0.3, 0.3] : [0]) {
        const c = [cx + ux * ext * t, cy + uy * ext * t];
        if (!inside(c, loc)) continue;
        const a = 2.6, b = 2.2;
        const box = [[a, b], [-a, b], [-a, -b], [a, -b], [a, b]].map(([p, q]) => toLL([c[0] + ux * p + vx * q, c[1] + uy * p + vy * q]));
        out.push({ type: 'Feature', properties: { kind, base: h + 0.5, top: h + 3.2, t: 'tank' }, geometry: { type: 'Polygon', coordinates: [box] } });
      }
    }
    return { type: 'FeatureCollection', features: out };
  })();
  const ptsGeo = { type: 'FeatureCollection', features: pointPlaces.map(p => ({
    type: 'Feature', id: p.id, properties: { place: p.id, kind: p.kind, name: p.name },
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) };
  const accessGeo = { type: 'FeatureCollection', features: edges.filter(e => e[3] === 1).map(([u, v]) => ({
    type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [nodes[u], nodes[v]] } })) };

  const ring = D.campus.geometry.coordinates[0];
  const bb = ring.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
    [180, 90, -180, -90]);
  const center = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
  const mask = { type: 'Feature', geometry: { type: 'Polygon',
    coordinates: [[[70, 20], [85, 20], [85, 38], [70, 38], [70, 20]], ring] } };

  const $ = id => document.getElementById(id);
  $('g-v').textContent = nodes.length;
  $('g-e').textContent = edges.length;

  // ---------- map ----------
  Loader.set(20, 'Loading imagery');
  const map = new maplibregl.Map({
    container: 'map',
    center, zoom: 14.6, pitch: 0, bearing: 0,
    maxPitch: 70,
    maxBounds: [[bb[0] - 0.025, bb[1] - 0.02], [bb[2] + 0.025, bb[3] + 0.02]],
    attributionControl: { compact: true },
    style: {
      version: 8,
      sources: {
        sat: { type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics · Paths & buildings © OpenStreetMap contributors' },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': C.ink } },
        { id: 'sat', type: 'raster', source: 'sat', paint: {
          'raster-saturation': -0.62, 'raster-contrast': 0.08, 'raster-brightness-max': 0.74, 'raster-brightness-min': 0.02,
          'raster-opacity': 1, 'raster-opacity-transition': { duration: 700 } } },
      ],
    },
  });
  ['scrollZoom', 'dragPan', 'dragRotate', 'doubleClickZoom', 'touchZoomRotate', 'keyboard', 'boxZoom']
    .forEach(h => map[h].disable());
  window.cuMap = map; // handy for debugging from the browser console
  // keep the canvas matched to its container (it can start at 0x0 while the page is still laying out)
  new ResizeObserver(() => map.resize()).observe($('map'));

  const GEO = (data, extra = {}) => ({ type: 'geojson', data, ...extra });
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const MODE = ['coalesce', ['feature-state', 'mode'], 0];
  const byKind = table => ['match', ['get', 'kind'], 'academic', table.academic, 'hostel', table.hostel,
    'none', table.none, table.other];
  const byMode = base => ['case', ['==', MODE, 2], C.A, ['==', MODE, 3], C.B, ['==', MODE, 1], C.hover, base];

  map.on('load', () => {
    Loader.set(55, 'Mapping campus graph');
    map.setLight({ anchor: 'viewport', color: '#f6ecda', intensity: 0.42, position: [1.4, 215, 35] });
    map.addSource('mask', GEO(mask));
    map.addSource('campus', GEO(D.campus));
    map.addSource('roads', GEO(D.roads));
    map.addSource('access', GEO(accessGeo));
    map.addSource('areas', GEO(D.areas));
    map.addSource('bld', GEO(D.buildings));
    map.addSource('bld-details', GEO(details));
    map.addSource('pts', GEO(ptsGeo));
    map.addSource('explore', GEO(EMPTY));
    map.addSource('heads', GEO(EMPTY));
    map.addSource('route', GEO(EMPTY, { lineMetrics: true }));
    map.addSource('comet', GEO(EMPTY));

    map.addLayer({ id: 'mask', type: 'fill', source: 'mask', paint: { 'fill-color': C.mask, 'fill-opacity': 0.58 } });
    map.addLayer({ id: 'campus-glow', type: 'line', source: 'campus',
      paint: { 'line-color': C.gold, 'line-width': 12, 'line-blur': 12, 'line-opacity': 0.16 } });
    map.addLayer({ id: 'campus-line', type: 'line', source: 'campus',
      paint: { 'line-color': C.gold, 'line-width': 1, 'line-dasharray': [4, 3], 'line-opacity': 0.7 } });
    map.addLayer({ id: 'areas', type: 'fill', source: 'areas', paint: { 'fill-color': C.line.other, 'fill-opacity': 0.07 } });
    map.addLayer({ id: 'roads-glow', type: 'line', source: 'roads', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': C.gold, 'line-blur': 4, 'line-opacity': 0.08,
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 10] } });
    map.addLayer({ id: 'roads', type: 'line', source: 'roads', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': C.goldHi, 'line-opacity': 0.3,
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.4, 18, ['match', ['get', 'hw'], 'footway', 1, 1.8]] } });
    map.addLayer({ id: 'access', type: 'line', source: 'access',
      paint: { 'line-color': C.goldHi, 'line-opacity': 0.25, 'line-width': 0.8, 'line-dasharray': [1, 2.5] } });

    // Dijkstra exploration wave
    const waveColor = ['interpolate', ['linear'], ['get', 'd'], 0, C.wave[0], 0.6, C.wave[1], 1, C.wave[2]];
    map.addLayer({ id: 'explore-glow', type: 'line', source: 'explore', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': waveColor, 'line-width': 8, 'line-blur': 7, 'line-opacity': 0.35,
        'line-opacity-transition': { duration: 1200 } } });
    map.addLayer({ id: 'explore', type: 'line', source: 'explore', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': waveColor, 'line-width': 1.8, 'line-opacity': 0.95, 'line-opacity-transition': { duration: 1200 } } });
    map.addLayer({ id: 'heads', type: 'circle', source: 'heads',
      paint: { 'circle-radius': 2.6, 'circle-color': C.ivory, 'circle-blur': 0.3,
        'circle-stroke-color': C.gold, 'circle-stroke-width': 3, 'circle-stroke-opacity': 0.35 } });

    // building footprints + 3D
    map.addLayer({ id: 'bld-hit', type: 'fill', source: 'bld', paint: { 'fill-color': '#000', 'fill-opacity': 0 } });
    map.addLayer({ id: 'bld-outline', type: 'line', source: 'bld',
      paint: { 'line-color': byMode(byKind(C.line)),
        'line-width': ['case', ['>', MODE, 0], 2.4, 1], 'line-blur': ['case', ['>', MODE, 0], 1.2, 0.3],
        'line-opacity': ['case', ['==', ['get', 'kind'], 'none'], 0.3, 0.85] } });
    map.addLayer({ id: 'bld-3d', type: 'fill-extrusion', source: 'bld',
      paint: {
        'fill-extrusion-color': byMode(byKind(C.fill)),
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-opacity': 0.94,
        'fill-extrusion-vertical-gradient': true,
      } });
    map.addLayer({ id: 'bld-details', type: 'fill-extrusion', source: 'bld-details',
      paint: {
        'fill-extrusion-color': ['match', ['get', 't'], 'tank', byKind(C.tank), byKind(C.ledge)],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-height': ['get', 'top'],
        'fill-extrusion-opacity': 0.94,
      } });

    // point places (no footprint in OSM)
    map.addLayer({ id: 'pts-halo', type: 'circle', source: 'pts',
      paint: { 'circle-radius': ['case', ['>', MODE, 0], 16, 10], 'circle-blur': 1,
        'circle-color': byMode(byKind(C.line)), 'circle-opacity': 0.4 } });
    map.addLayer({ id: 'pts', type: 'circle', source: 'pts',
      paint: { 'circle-radius': ['case', ['>', MODE, 0], 6, 4],
        'circle-color': byMode(byKind(C.line)), 'circle-stroke-color': C.ink, 'circle-stroke-width': 1.5 } });

    // shortest path: dark casing for contrast, warm glow, then the gradient line
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 8, 18, 13], 'line-color': C.ink, 'line-opacity': 0 } });
    map.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 14, 18, 26], 'line-blur': 14,
        'line-opacity': 0.85, 'line-gradient': gradientAt(0) } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 4.5, 18, 8], 'line-gradient': gradientAt(0) } });
    map.addLayer({ id: 'route-flow', type: 'line', source: 'route', layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-width': 1.6, 'line-color': C.ivory, 'line-opacity': 0, 'line-dasharray': [0, 4, 3] } });
    map.addLayer({ id: 'comet', type: 'circle', source: 'comet',
      paint: { 'circle-radius': 5.5, 'circle-color': C.ivory, 'circle-blur': 0.2,
        'circle-stroke-color': C.gold, 'circle-stroke-width': 6, 'circle-stroke-opacity': 0.3 } });

    Loader.set(75, 'Streaming imagery');
    let finished = false;
    const finish = () => { if (finished) return; finished = true; Loader.set(100, 'Ready'); Loader.finish().then(startIntro); };
    map.once('idle', () => setTimeout(finish, 600));
    setTimeout(finish, 6000); // don't wait forever on slow networks
  });
  setTimeout(() => Loader.set(40, 'Fetching geometry'), 500);

  // ---------- intro: scroll parts the clouds ----------
  let finalCam, earlyScroll = 0;
  const earlyWheel = e => { earlyScroll += e.deltaY; };
  addEventListener('wheel', earlyWheel, { passive: true }); // remember scrolling done while loading
  function startIntro() {
    map.resize();
    const cam = map.cameraForBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 40 });
    finalCam = { center, zoom: cam.zoom + 0.55, pitch: 55, bearing: -22 };
    const z0 = cam.zoom - 0.6;
    removeEventListener('wheel', earlyWheel);
    // visitors coming back from another page descend through the clouds on their own
    const seen = sessionStorage.getItem('naksh-intro-seen') === '1';
    let target = seen ? 1 : Math.max(0, Math.min(0.6, earlyScroll / 1600)), cur = 0, entered = false;
    const introEl = $('intro');

    const onWheel = e => { e.preventDefault(); target = Math.max(0, Math.min(1, target + e.deltaY / 1600)); };
    let ty = null;
    const onTs = e => { ty = e.touches[0].clientY; };
    const onTm = e => { e.preventDefault(); const y = e.touches[0].clientY; target = Math.max(0, Math.min(1, target + (ty - y) / 550)); ty = y; };
    const onKey = e => { if (['ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) target = 1; };
    addEventListener('wheel', onWheel, { passive: false });
    addEventListener('touchstart', onTs, { passive: true });
    addEventListener('touchmove', onTm, { passive: false });
    addEventListener('keydown', onKey);

    const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    (function tick() {
      cur += (target - cur) * 0.05;
      if (target >= 1 && cur > 0.995) cur = 1;
      const e = ease(cur);
      Clouds.setProgress(cur);
      introEl.style.opacity = Math.max(0, 1 - cur * 2.4);
      introEl.style.transform = `translateY(${-cur * 60}px) scale(${1 + cur * 0.06})`;
      map.jumpTo({ center, zoom: z0 + (finalCam.zoom - z0) * e, pitch: 55 * e, bearing: finalCam.bearing * e });
      if (cur >= 1 && !entered) {
        entered = true;
        removeEventListener('wheel', onWheel); removeEventListener('touchstart', onTs);
        removeEventListener('touchmove', onTm); removeEventListener('keydown', onKey);
        Clouds.remove(); introEl.remove();
        sessionStorage.setItem('naksh-intro-seen', '1');
        enterApp();
        return;
      }
      requestAnimationFrame(tick);
    })();
  }

  function enterApp() {
    ['scrollZoom', 'dragPan', 'dragRotate', 'doubleClickZoom', 'touchZoomRotate', 'keyboard'].forEach(h => map[h].enable());
    ['header', 'prompt', 'toolbar', 'card', 'legend'].forEach((id, i) =>
      setTimeout(() => $(id).classList.remove('hidden'), i * 120));
    ready = true;
    syncCard();
  }

  // ---------- hover & selection ----------
  let ready = false, hovered = null, phase = 'A', selA = null, selB = null, markerA = null, markerB = null, animToken = 0;
  const tip = $('tooltip');

  function setMode(pid, mode) {
    if (pid == null) return;
    if (pid in bldOfPlace) map.setFeatureState({ source: 'bld', id: bldOfPlace[pid] }, { mode });
    else map.setFeatureState({ source: 'pts', id: pid }, { mode });
  }
  const baseMode = pid => pid === selA ? 2 : pid === selB ? 3 : 0;

  function placeAt(point) {
    const fs = map.queryRenderedFeatures(point, { layers: ['pts', 'bld-3d', 'bld-hit'] });
    for (const f of fs) { const pid = f.properties.place; if (pid != null && pid >= 0) return pid; }
    return null;
  }

  function setPrompt(text, cls) { $('prompt-text').textContent = text; $('prompt').className = 'prompt ui ' + (cls || ''); }

  // A/B chips + expanding card
  function syncCard() {
    const set = (id, pid) => {
      $('sel-' + id).textContent = pid == null ? 'Choose on map' : places[pid].name;
      $('pt-' + id).classList.toggle('set', pid != null);
    };
    set('a', selA); set('b', selB);
    $('pt-a').classList.toggle('current', phase === 'A');
    $('pt-b').classList.toggle('current', phase === 'B');
    $('card').classList.toggle('expanded', selA != null && selB != null);
  }

  map.on('mousemove', e => {
    if (!ready) return;
    const pid = placeAt(e.point);
    if (pid !== hovered) {
      if (hovered != null) setMode(hovered, baseMode(hovered));
      hovered = pid;
      if (pid != null && baseMode(pid) === 0) setMode(pid, 1);
    }
    map.getCanvas().style.cursor = pid != null ? 'pointer' : '';
    if (pid == null) { tip.classList.remove('show'); return; }
    const p = places[pid];
    tip.querySelector('.tt-name').textContent = p.name;
    tip.querySelector('.tt-kind').textContent = KIND_LABEL[p.kind] || p.kind;
    tip.querySelector('.tt-hint').textContent =
      pid === selA ? 'Origin' : pid === selB ? 'Destination' :
      phase === 'B' ? 'Click to set as destination' : phase === 'RUN' ? 'Computing…' : 'Click to set as origin';
    tip.style.left = e.originalEvent.clientX + 'px';
    tip.style.top = e.originalEvent.clientY + 'px';
    tip.classList.add('show');
  });
  map.getCanvas().addEventListener('mouseleave', () => tip.classList.remove('show'));

  map.on('click', e => {
    if (!ready || phase === 'RUN') return;
    const pid = placeAt(e.point);
    if (pid == null) return;
    if (phase === 'DONE') clearRoute();
    if (phase === 'A') {
      selA = pid; setMode(pid, 2);
      markerA = pin('a', places[pid]);
      phase = selB == null ? 'B' : 'RUN';
      setPrompt('Now select your destination', 'b');
      syncCard();
      if (selB != null) run();
    } else if (phase === 'B' && pid !== selA) {
      selB = pid; setMode(pid, 3);
      markerB = pin('b', places[pid]);
      syncCard();
      run();
    }
  });

  function pin(cls, p) {
    const el = document.createElement('div');
    el.className = 'pin ' + cls;
    el.innerHTML = `<div class="pulse"></div><div class="ring"></div><div class="core">${cls.toUpperCase()}</div>`;
    return new maplibregl.Marker({ element: el }).setLngLat(nodes[p.node]).addTo(map);
  }

  // ---------- run Dijkstra + animate ----------
  function run() {
    phase = 'RUN';
    syncCard();
    setPrompt("Running Dijkstra's algorithm", 'run');
    tip.classList.remove('show');
    resetStats();
    const res = dijkstra(adj, places[selA].node, places[selB].node);
    const token = ++animToken;

    // frame the route, leaving room for the header, toolbar and card
    const pts = res.path.length ? res.path.map(i => nodes[i]) : [nodes[places[selA].node], nodes[places[selB].node]];
    const b = pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]);
    const narrow = innerWidth < 900;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
      padding: narrow ? { top: 130, bottom: 260, left: 40, right: 90 } : { top: 150, bottom: 120, left: 420, right: 140 },
      pitch: map.getPitch(), bearing: map.getBearing(), duration: 1200, maxZoom: 18 });

    setTimeout(() => {
      if (token !== animToken) return;
      animateExplore(res, token).then(() => token === animToken && animatePath(res, token));
    }, 1250);
  }

  function animateExplore(res, token) {
    const relax = res.steps.filter(s => s.t === 'relax');
    const T = Math.min(4200, Math.max(2200, relax.length * 6));
    const EDGE_MS = 340;
    const total = res.distance || 1;
    const done = [];
    let next = 0;
    const active = [];
    map.setPaintProperty('explore', 'line-opacity', 0.95);
    map.setPaintProperty('explore-glow', 'line-opacity', 0.35);
    const settles = res.steps.filter(s => s.t === 'settle');

    return new Promise(resolve => {
      const t0 = performance.now();
      (function frame(now) {
        if (token !== animToken) return resolve();
        const t = now - t0;
        while (next < relax.length && (next / relax.length) * T <= t) {
          active.push({ s: relax[next], start: t0 + (next / relax.length) * T });
          next++;
        }
        const live = [], heads = [];
        for (let i = active.length - 1; i >= 0; i--) {
          const { s, start } = active[i];
          const k = Math.min(1, (now - start) / EDGE_MS);
          const A = nodes[s.u], B = nodes[s.v];
          const P = [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k];
          const f = { type: 'Feature', properties: { d: Math.min(1.2, s.d / total) },
            geometry: { type: 'LineString', coordinates: [A, P] } };
          if (k >= 1) { done.push(f); active.splice(i, 1); }
          else { live.push(f); heads.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: P } }); }
        }
        map.getSource('explore').setData({ type: 'FeatureCollection', features: done.concat(live) });
        map.getSource('heads').setData({ type: 'FeatureCollection', features: heads });

        $('st-settled').textContent = Math.round(settles.length * Math.min(1, t / T));
        $('st-relax').textContent = Math.min(next, relax.length);

        if (next >= relax.length && active.length === 0) {
          map.getSource('heads').setData(EMPTY);
          map.setPaintProperty('explore', 'line-opacity', 0.3);
          map.setPaintProperty('explore-glow', 'line-opacity', 0.08);
          return resolve();
        }
        requestAnimationFrame(frame);
      })(t0);
    });
  }

  // colour along the path: pearl (A) -> gold -> rose copper (B), visible up to progress p
  function mix(a, b, t) {
    const h = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
    const A = h(a), B = h(b);
    return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
  }
  function colorAt(t) { return t < 0.5 ? mix(C.A, C.gold, t * 2) : mix(C.gold, C.B, (t - 0.5) * 2); }
  function gradientAt(p) {
    if (p <= 0) return ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)'];
    if (p >= 0.999) return ['interpolate', ['linear'], ['line-progress'], 0, C.A, 0.5, C.gold, 1, C.B];
    const stops = [0, C.A];
    if (p > 0.5) stops.push(0.5, C.gold);
    stops.push(p, colorAt(p), Math.min(0.9999, p + 0.0005), 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)');
    return ['interpolate', ['linear'], ['line-progress'], ...stops];
  }

  function animatePath(res, token) {
    const coords = res.path.map(i => nodes[i]);
    if (coords.length < 2) { setPrompt('No path found', 'done'); phase = 'DONE'; syncCard(); return; }
    setPrompt('Shortest path found', 'done');
    map.getSource('route').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    map.setPaintProperty('route-casing', 'line-opacity', 0.55);

    // cumulative length (approx) for the comet position
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
      const [x0, y0] = coords[i - 1], [x1, y1] = coords[i];
      cum.push(cum[i - 1] + Math.hypot((x1 - x0) * Math.cos(y0 * Math.PI / 180), y1 - y0));
    }
    const L = cum[cum.length - 1];
    const pointAt = p => {
      const target = p * L;
      let i = 1; while (i < cum.length - 1 && cum[i] < target) i++;
      const k = (target - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      const A = coords[i - 1], B = coords[i];
      return [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k];
    };

    const DUR = Math.min(3200, Math.max(1700, res.distance * 2.2));
    const t0 = performance.now();
    (function frame(now) {
      if (token !== animToken) return;
      const raw = Math.min(1, (now - t0) / DUR);
      const p = 1 - Math.pow(1 - raw, 3);
      map.setPaintProperty('route', 'line-gradient', gradientAt(p));
      map.setPaintProperty('route-glow', 'line-gradient', gradientAt(p));
      map.getSource('comet').setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pointAt(p) } });
      if (raw < 1) return requestAnimationFrame(frame);
      map.getSource('comet').setData(EMPTY);
      showStats(res);
      startFlow(token);
      phase = 'DONE';
      syncCard();
      setPrompt('Route ready · click any place to begin again', 'done');
    })(t0);
  }

  // gentle flow along the finished route
  const DASHES = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
    [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
  function startFlow(token) {
    map.setPaintProperty('route-flow', 'line-opacity', 0.7);
    let step = 0, last = 0;
    (function frame(now) {
      if (token !== animToken) return;
      if (now - last > 70) { map.setPaintProperty('route-flow', 'line-dasharray', DASHES[step]); step = (step + 1) % DASHES.length; last = now; }
      requestAnimationFrame(frame);
    })(0);
  }

  function showStats(res) {
    const m = res.distance;
    const secs = Math.round(m / WALK_SPEED);
    $('st-dist').textContent = m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
    $('st-time').textContent = secs < 60 ? secs + ' s' : `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, '0')}`;
    $('st-settled').textContent = res.settledCount;
    $('st-relax').textContent = res.relaxCount;
    $('st-pathn').textContent = res.path.length;
    $('st-ms').textContent = res.ms.toFixed(2) + ' ms';
  }
  function resetStats() {
    ['st-dist', 'st-time', 'st-settled', 'st-relax', 'st-pathn', 'st-ms'].forEach(id => $(id).textContent = '—');
  }

  function clearVisuals() {
    animToken++;
    ['explore', 'heads', 'route', 'comet'].forEach(s => map.getSource(s).setData(EMPTY));
    map.setPaintProperty('route', 'line-gradient', gradientAt(0));
    map.setPaintProperty('route-glow', 'line-gradient', gradientAt(0));
    map.setPaintProperty('route-flow', 'line-opacity', 0);
    map.setPaintProperty('route-casing', 'line-opacity', 0);
    resetStats();
  }

  function clearRoute() {
    clearVisuals();
    [selA, selB].forEach(p => p != null && setMode(p, 0));
    selA = selB = null;
    markerA && markerA.remove(); markerB && markerB.remove(); markerA = markerB = null;
    phase = 'A';
    syncCard();
    setPrompt('Select your starting point');
  }

  // chips: A restarts the selection, B re-picks only the destination
  $('pt-a').onclick = () => { if (ready) clearRoute(); };
  $('pt-b').onclick = () => {
    if (!ready || selA == null) return;
    clearVisuals();
    if (selB != null) setMode(selB, 0);
    selB = null; markerB && markerB.remove(); markerB = null;
    phase = 'B';
    syncCard();
    setPrompt('Now select your destination', 'b');
  };

  // ---------- toolbar ----------
  $('btn-reset').onclick = () => clearRoute();
  $('btn-home').onclick = () => finalCam && map.flyTo({ ...finalCam, pitch: is3D ? 55 : 0, duration: 1600 });
  let is3D = true, tech = false;
  $('btn-3d').onclick = e => {
    is3D = !is3D;
    e.currentTarget.classList.toggle('active', is3D);
    e.currentTarget.dataset.label = is3D ? '3D buildings' : 'Flat view';
    map.setPaintProperty('bld-3d', 'fill-extrusion-height', is3D ? ['get', 'h'] : 0.5);
    map.setLayoutProperty('bld-details', 'visibility', is3D ? 'visible' : 'none');
    map.easeTo({ pitch: is3D ? 55 : 0, duration: 1000 });
  };
  $('btn-view').onclick = e => {
    tech = !tech;
    e.currentTarget.classList.toggle('active', tech);
    e.currentTarget.dataset.label = tech ? 'Blueprint view' : 'Satellite view';
    map.setPaintProperty('sat', 'raster-opacity', tech ? 0.1 : 1);
    map.setPaintProperty('roads', 'line-opacity', tech ? 0.8 : 0.3);
    map.setPaintProperty('roads-glow', 'line-opacity', tech ? 0.25 : 0.08);
  };
})();
