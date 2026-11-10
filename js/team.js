/*
 * NAKSH · Team page
 * Background: the real campus graph, with a shortest path endlessly tracing between two places (A → B).
 */
(() => {
  const D = window.CU_DATA, NODES = D.graph.nodes, EDGES = D.graph.edges, PLACES = D.places;
  const ADJ = buildAdjacency(NODES.length, EDGES);
  const cv = document.getElementById('team-graph'), ctx = cv.getContext('2d');
  const COS = Math.cos(30.7686 * Math.PI / 180);
  const proj = ([lon, lat]) => [lon * COS, -lat];

  // routes to cycle through: real shortest paths across campus
  const pairs = [['Gate 1', 'Tagore Hostel'], ['Shivalik Hostel', 'NC 4 (Boys hostel)'], ['D6 (Star Library)', 'Zakir A (Boys Hostel)']]
    .map(([a, b]) => [PLACES.find(p => p.name === a), PLACES.find(p => p.name === b)])
    .filter(([a, b]) => a && b)
    .map(([a, b]) => dijkstra(ADJ, a.node, b.node).path)
    .filter(p => p.length > 1);

  let W, H, P = [];
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ring = D.campus.geometry.coordinates[0].map(proj), all = NODES.map(proj);
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min(W * 0.9 / (x1 - x0), H * 0.95 / (y1 - y0));
    const ox = (W - (x1 - x0) * s) / 2, oy = (H - (y1 - y0) * s) / 2;
    P = all.map(([x, y]) => [ox + (x - x0) * s, oy + (y - y0) * s]);
  }
  resize(); addEventListener('resize', resize);

  let route = 0, t0 = performance.now();
  const DUR = 4200, HOLD = 1600;
  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(201,169,110,0.09)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [u, v] of EDGES) { ctx.moveTo(P[u][0], P[u][1]); ctx.lineTo(P[v][0], P[v][1]); }
    ctx.stroke();

    if (pairs.length) {
      const path = pairs[route % pairs.length].map(i => P[i]);
      const t = now - t0, p = Math.min(1, t / DUR), fade = t > DUR ? 1 - Math.min(1, (t - DUR) / HOLD) : 1;
      // cumulative screen length
      const cum = [0];
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
      const L = cum[cum.length - 1] * (1 - Math.pow(1 - p, 3));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const [w, a] of [[7, 0.12], [2, 0.75]]) {
        ctx.strokeStyle = `rgba(233,214,173,${a * fade})`; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(path[0][0], path[0][1]);
        let head = path[0];
        for (let i = 1; i < path.length; i++) {
          if (cum[i] <= L) { ctx.lineTo(path[i][0], path[i][1]); head = path[i]; }
          else { const k = (L - cum[i - 1]) / (cum[i] - cum[i - 1]); head = [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k]; ctx.lineTo(head[0], head[1]); break; }
        }
        ctx.stroke();
        if (w === 2 && p < 1) { ctx.fillStyle = `rgba(255,244,222,${fade})`; ctx.beginPath(); ctx.arc(head[0], head[1], 3, 0, 6.283); ctx.fill(); }
      }
      const beacon = ([x, y], col) => {
        const r = 4 + (now / 40) % 18;
        ctx.strokeStyle = col.replace('A', String(0.5 * fade * (1 - r / 22))); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.stroke();
        ctx.fillStyle = col.replace('A', String(fade)); ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 6.283); ctx.fill();
      };
      beacon(path[0], 'rgba(239,228,207,A)');
      beacon(path[path.length - 1], 'rgba(201,139,107,A)');
      if (t > DUR + HOLD) { route++; t0 = now; }
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  // names reveal letter by letter
  document.querySelectorAll('[data-split]').forEach((el, k) => {
    const base = 0.75 + k * 0.25;
    el.innerHTML = [...el.textContent].map((c, i) =>
      c === ' ' ? '<span class="sp"></span>' : `<span class="ch" style="animation-delay:${(base + i * 0.035).toFixed(3)}s">${c}</span>`).join('');
  });

  // gentle 3D tilt and a light that follows the cursor
  document.querySelectorAll('[data-tilt]').forEach(card => {
    // the entrance animation would otherwise keep overriding the tilt transform
    card.addEventListener('animationend', e => { if (e.target === card) { card.style.opacity = 1; card.style.animation = 'none'; } });
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `perspective(900px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg)`;
      card.style.setProperty('--mx', (x + 0.5) * 100 + '%'); card.style.setProperty('--my', (y + 0.5) * 100 + '%');
    });
    card.addEventListener('mouseleave', () => { card.style.transform = ''; });
  });
})();
