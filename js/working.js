/*
 * NAKSH · Working page
 * Every number shown here is computed live from the real campus graph (data/cu_data.js)
 * using the same dijkstra.js that powers the map.
 */
(() => {
  const D = window.CU_DATA;
  const NODES = D.graph.nodes, EDGES = D.graph.edges, PLACES = D.places;
  const V = NODES.length, E = EDGES.length;
  const ADJ = buildAdjacency(V, EDGES);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const NS = 'http://www.w3.org/2000/svg';
  const S = (tag, attrs = {}, parent) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };
  const fmtM = m => (m === Infinity ? '∞' : m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = t => 1 - Math.pow(1 - t, 3);
  const SHORT = n => n.replace(' Academic Block', '').replace(' (Boys hostel)', '').replace(' (Boys Hostel)', '')
    .replace(' Hostel', '').replace('D6 (Star Library)', 'D6 Library');

  // =========================================================================
  //  Syntax highlighting (tiny tokenizer, comments set in italic serif)
  // =========================================================================
  const KW = new Set(['function', 'const', 'let', 'for', 'of', 'if', 'return', 'while', 'new', 'class', 'break', 'continue']);
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function highlight(line) {
    const ci = line.indexOf('//');
    const code = ci >= 0 ? line.slice(0, ci) : line;
    const com = ci >= 0 ? line.slice(ci) : '';
    let out = '';
    const re = /(\s+)|([A-Za-z_$][\w$]*)|(\d+(?:\.\d+)?)|('[^']*')|(.)/g;
    let m;
    while ((m = re.exec(code))) {
      const [tok, ws, id, num, str, ch] = m;
      if (ws) out += ws;
      else if (id) {
        const nextCh = code.slice(re.lastIndex).trimStart()[0];
        const cls = KW.has(id) ? 't-kw' : nextCh === '(' ? 't-fn' : '';
        out += cls ? `<span class="${cls}">${id}</span>` : id;
      } else if (num) out += `<span class="t-num">${num}</span>`;
      else if (str) out += `<span class="t-str">${esc(str)}</span>`;
      else out += `<span class="${'{}()[];,.'.includes(ch) ? 't-pun' : 't-op'}">${esc(ch)}</span>`;
    }
    if (com) out += `<span class="t-com">${esc(com)}</span>`;
    return out;
  }

  // =========================================================================
  //  Tracer: a code listing that steps line by line with live values
  // =========================================================================
  const ICON = {
    prev: '<svg viewBox="0 0 16 16"><path d="M4 3h1.6v10H4zM14 3v10L6.5 8z"/></svg>',
    next: '<svg viewBox="0 0 16 16"><path d="M10.4 3H12v10h-1.6zM2 3v10l7.5-5z"/></svg>',
    play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11L13.5 8z"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><path d="M4 3h3v10H4zM9 3h3v10H9z"/></svg>',
    replay: '<svg viewBox="0 0 16 16"><path d="M8 3a5 5 0 1 1-4.6 3H1.8A6.5 6.5 0 1 0 8 1.5V0L5 2.5 8 5z"/></svg>',
  };
  class Tracer {
    constructor(el, { file, fn, code, intro, render, baseMs = 1000 }) {
      this.el = el; this.render = render; this.baseMs = baseMs; this.speed = 1;
      this.i = -1; this.steps = []; this.timer = null; this.playing = false; this.userPaused = false;
      el.innerHTML = `
        <div class="cc-top"><span class="cc-file">${file} · <b>${fn}</b></span><span class="cc-dots"><i></i><i></i><i></i></span></div>
        <div class="code"><div class="hl"></div></div>
        <div class="say"><span>${intro}</span></div>
        <div class="ctrl">
          <button class="b-prev" title="Previous step">${ICON.prev}</button>
          <button class="play b-play" title="Play / pause">${ICON.play}</button>
          <button class="b-next" title="Next step">${ICON.next}</button>
          <div class="scrub"><i></i><b></b></div>
          <span class="stepno">0 / 0</span>
          <button class="speed" title="Speed">1×</button>
        </div>`;
      this.codeEl = $('.code', el); this.hl = $('.hl', el); this.sayEl = $('.say', el);
      this.lines = code.split('\n').map((src, k) => {
        const ln = document.createElement('div');
        ln.className = 'ln';
        ln.innerHTML = `<span class="no">${String(k + 1).padStart(2, '0')}</span><span class="src">${highlight(src) || ' '}</span><span class="ghost"></span>`;
        this.codeEl.appendChild(ln);
        return ln;
      });
      $('.b-prev', el).onclick = () => { this.pause(true); this.go(this.i - 1); };
      $('.b-next', el).onclick = () => { this.pause(true); this.go(this.i + 1); };
      $('.b-play', el).onclick = () => (this.playing ? this.pause(true) : this.play());
      $('.speed', el).onclick = e => {
        this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 0.5 : 1;
        e.currentTarget.textContent = (this.speed === 0.5 ? '½' : this.speed) + '×';
      };
      const scrub = $('.scrub', el);
      const seek = e => {
        const r = scrub.getBoundingClientRect();
        this.go(Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * (this.steps.length - 1)));
      };
      scrub.addEventListener('pointerdown', e => { this.pause(true); seek(e); scrub.setPointerCapture(e.pointerId); scrub.onpointermove = seek; });
      scrub.addEventListener('pointerup', () => { scrub.onpointermove = null; });
      // play when scrolled into view, pause when it leaves
      new IntersectionObserver(([en]) => {
        if (en.isIntersecting && !this.userPaused && this.i < this.steps.length - 1) this.play();
        else if (!en.isIntersecting) this.pause(false);
      }, { threshold: 0.45 }).observe(el);
    }
    setSteps(steps, intro) {
      this.pause(false);
      this.steps = steps; this.i = -1;
      this.codeEl.classList.remove('running');
      this.lines.forEach(l => { l.classList.remove('act', 'has-ghost'); $('.ghost', l).classList.remove('show'); });
      if (intro) this.say(intro);
      this.updateUi();
      this.render(steps[0].state, steps[0], -1);
    }
    say(html) { this.sayEl.innerHTML = `<span>${html}</span>`; }
    go(i) {
      if (!this.steps.length) return;
      i = clamp(i, 0, this.steps.length - 1);
      const forward = i === this.i + 1;
      this.i = i;
      const st = this.steps[i];
      const [a, b] = Array.isArray(st.line) ? st.line : [st.line, st.line];
      this.codeEl.classList.add('running');
      this.lines.forEach((l, k) => {
        const n = k + 1;
        l.classList.toggle('act', n >= a && n <= b);
        const g = $('.ghost', l), txt = st.ghost && st.ghost[n];
        if (txt) { g.textContent = txt; g.classList.add('show'); l.classList.add('has-ghost'); }
        else { g.classList.remove('show'); l.classList.remove('has-ghost'); }
      });
      const la = this.lines[a - 1], lb = this.lines[b - 1];
      this.hl.style.transform = `translateY(${la.offsetTop}px)`;
      this.hl.style.height = (lb.offsetTop + lb.offsetHeight - la.offsetTop) + 'px';
      if (st.say) this.say(st.say);
      this.render(st.state, st, i, forward);
      this.updateUi();
    }
    updateUi() {
      const n = this.steps.length, p = n > 1 ? Math.max(0, this.i) / (n - 1) : 0;
      $('.scrub i', this.el).style.width = p * 100 + '%';
      $('.scrub b', this.el).style.left = p * 100 + '%';
      $('.stepno', this.el).textContent = `${Math.max(0, this.i + 1)} / ${n}`;
      const btn = $('.b-play', this.el);
      btn.innerHTML = this.playing ? ICON.pause : this.i >= n - 1 && n ? ICON.replay : ICON.play;
    }
    play() {
      if (this.i >= this.steps.length - 1) this.i = -1;
      this.playing = true; this.userPaused = false;
      clearTimeout(this.timer);
      const tick = () => {
        if (!this.playing) return;
        this.go(this.i + 1);
        if (this.i >= this.steps.length - 1) { this.playing = false; this.updateUi(); return; }
        this.timer = setTimeout(tick, (this.steps[this.i].ms || 1) * this.baseMs / this.speed);
      };
      this.timer = setTimeout(tick, this.i < 0 ? 350 : 0);
      this.updateUi();
    }
    pause(byUser) {
      this.playing = false; clearTimeout(this.timer);
      if (byUser) this.userPaused = true;
      this.updateUi();
    }
  }

  // =========================================================================
  //  Geometry helpers
  // =========================================================================
  const LAT0 = 30.7686, COS = Math.cos(LAT0 * Math.PI / 180);
  const proj = ([lon, lat]) => [lon * COS, -lat];
  function fit(points, w, h, pad) {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min((w - 2 * pad) / (x1 - x0 || 1), (h - 2 * pad) / (y1 - y0 || 1));
    const ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
    return points.map(([x, y]) => [ox + (x - x0) * s, oy + (y - y0) * s]);
  }
  function haversine([x1, y1], [x2, y2]) {
    const R = 6371000, r = Math.PI / 180;
    const dy = (y2 - y1) * r, dx = (x2 - x1) * r;
    const h = Math.sin(dy / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin(dx / 2) ** 2;
    return { d: 2 * R * Math.asin(Math.sqrt(h)), dy, dx, h };
  }

  // =========================================================================
  //  A small "place graph": 10 real places, real walking distances
  // =========================================================================
  const WANT = ['Gate 1', 'B1 Academic Block', 'B4 Academic Block', 'C1 Academic Block', 'C2 Academic Block',
    'D6 (Star Library)', 'Fountain Park', 'Tagore Hostel', 'NC 4 (Boys hostel)', 'Zakir A (Boys Hostel)',
    'Shivalik Hostel', 'A2'];
  const PG = (() => {
    let chosen = WANT.map(n => PLACES.find(p => p.name === n)).filter(Boolean);
    // all-pairs walking distance on the real graph
    const full = chosen.map(p => dijkstra(ADJ, p.node, -1).dist);
    chosen = chosen.filter((p, i) => chosen.every(q => full[i][q.node] < Infinity)).slice(0, 10);
    const dist = chosen.map(p => dijkstra(ADJ, p.node, -1).dist);
    const n = chosen.length, d = (i, j) => dist[i][chosen[j].node];
    // keep an edge only if no third place lies (almost) on the way: a sparse, honest "road map" of places
    let edges = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dij = d(i, j);
      const between = chosen.some((_, k) => k !== i && k !== j && d(i, k) + d(k, j) <= dij * 1.07);
      if (!between) edges.push([i, j, Math.round(dij)]);
    }
    // cap degree at 4 (drop the longest extras) without disconnecting
    edges.sort((a, b) => a[2] - b[2]);
    const deg = Array(n).fill(0), kept = [];
    for (const e of edges) if (deg[e[0]] < 4 && deg[e[1]] < 4) { kept.push(e); deg[e[0]]++; deg[e[1]]++; }
    edges = kept;
    const adj = Array.from({ length: n }, () => []);
    edges.forEach(([u, v, w], k) => { adj[u].push({ v, w, k }); adj[v].push({ v: u, w, k }); });
    const raw = chosen.map(p => proj([p.lon, p.lat]));
    return { places: chosen, names: chosen.map(p => SHORT(p.name)), full: chosen.map(p => p.name), raw, edges, adj, n };
  })();

  // spread positions so labels never collide (keeps the real layout recognisable)
  function layout(raw, w, h, pad, minGap) {
    // schematic "metro map" fit: blend true position with rank order on each axis, so tight clusters
    // open up while every place keeps its real north/south/east/west order
    const rankMix = vals => {
      const lo = Math.min(...vals), hi = Math.max(...vals), order = [...vals].sort((a, b) => a - b);
      return vals.map(v => 0.4 * (v - lo) / (hi - lo || 1) + 0.6 * order.indexOf(v) / (vals.length - 1 || 1));
    };
    const rx = rankMix(raw.map(q => q[0])), ry = rankMix(raw.map(q => q[1]));
    raw = raw.map((_, i) => [rx[i], ry[i]]);
    const xs = raw.map(q => q[0]), ys = raw.map(q => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let sx = (w - 2 * pad) / (x1 - x0 || 1), sy = (h - 2 * pad) / (y1 - y0 || 1);
    sx = Math.min(sx, sy * 2); sy = Math.min(sy, sx * 2);
    const ox = (w - (x1 - x0) * sx) / 2, oy = (h - (y1 - y0) * sy) / 2;
    const p = raw.map(([x, y]) => [ox + (x - x0) * sx, oy + (y - y0) * sy]);
    const home = p.map(q => [...q]);
    for (let it = 0; it < 400; it++) {
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
        const dx = p[j][0] - p[i][0], dy = p[j][1] - p[i][1], dd = Math.hypot(dx, dy) || 0.01;
        if (dd < minGap) {
          const f = (minGap - dd) / dd * 0.25;
          p[i][0] -= dx * f; p[i][1] -= dy * f; p[j][0] += dx * f; p[j][1] += dy * f;
        }
      }
      p.forEach((q, i) => {
        q[0] += (home[i][0] - q[0]) * 0.02; q[1] += (home[i][1] - q[1]) * 0.02;
        q[0] = clamp(q[0], pad, w - pad); q[1] = clamp(q[1], pad, h - pad);
      });
    }
    return p;
  }

  const tip = $('#edge-tip');
  function graphStage(svg, W, H, opts = {}) {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    const pos = layout(PG.raw, W, H, 54, opts.gap || 78);
    const gE = S('g', {}, svg), gW = S('g', {}, svg), gN = S('g', {}, svg);
    const edges = PG.edges.map(([u, v, w]) => {
      const [x1, y1] = pos[u], [x2, y2] = pos[v];
      const line = S('line', { x1, y1, x2, y2, class: 'g-e' }, gE);
      const hit = S('line', { x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': 14, style: 'cursor:help' }, gE);
      hit.addEventListener('mousemove', e => {
        tip.textContent = `${PG.names[u]} ↔ ${PG.names[v]} · ${w} m of real walking path`;
        tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.classList.add('show');
      });
      hit.addEventListener('mouseleave', () => tip.classList.remove('show'));
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, L = Math.hypot(x2 - x1, y2 - y1) || 1;
      const nx = -(y2 - y1) / L * 9, ny = (x2 - x1) / L * 9;
      const label = S('text', { x: mx + nx, y: my + ny + 3, class: 'g-w', 'text-anchor': 'middle' }, gW);
      label.textContent = w;
      return { line, label };
    });
    const nodes = PG.names.map((name, i) => {
      const [x, y] = pos[i];
      const g = S('g', { class: 'g-n', transform: `translate(${x},${y})` }, gN);
      S('circle', { class: 'ring', r: 9 }, g);
      S('circle', { class: 'c', r: 7 }, g);
      const lab = S('text', { class: 'lab', y: 22, 'text-anchor': 'middle' }, g); lab.textContent = name;
      const dist = S('text', { class: 'dist', y: -14, 'text-anchor': 'middle' }, g);
      return { g, dist };
    });
    return { pos, edges, nodes };
  }

  // =========================================================================
  //  PROLOGUE: the living campus graph
  // =========================================================================
  (function hero() {
    const cv = $('#hero-graph'), ctx = cv.getContext('2d');
    const readout = $('#hero-readout');
    let W, H, DPR, P = [], placeP = [], visible = true, mouse = null, lastClick = 0;
    const waves = [];
    const SPEED = 560; // metres of wavefront per second

    function resize() {
      DPR = Math.min(devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * DPR; cv.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      // campus sits to the right of the headline on wide screens
      const wide = W > 1000;
      const box = wide ? { x: W * 0.42, y: 70, w: W * 0.56, h: H - 120 } : { x: 0, y: 70, w: W, h: H - 100 };
      // fit the campus boundary into the box; roads beyond the wall simply run off the edges
      const ring = D.campus.geometry.coordinates[0].map(proj), all = NODES.map(proj);
      const fitted = fit(ring.concat(all), box.w, box.h, 20);           // fallback scale
      const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const sc = Math.min((box.w - 40) / (x1 - x0), (box.h - 40) / (y1 - y0));
      const ox = box.x + (box.w - (x1 - x0) * sc) / 2, oy = box.y + (box.h - (y1 - y0) * sc) / 2;
      P = isFinite(sc) ? all.map(([x, y]) => [ox + (x - x0) * sc, oy + (y - y0) * sc]) : fitted.slice(ring.length);
      placeP = PLACES.map(p => P[p.node]);
    }
    resize();
    addEventListener('resize', resize);

    function nearestNode(x, y) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < V; i++) { const d = (P[i][0] - x) ** 2 + (P[i][1] - y) ** 2; if (d < bd) { bd = d; best = i; } }
      return best;
    }
    function nearestPlace(x, y, maxPx = 90) {
      let best = null, bd = maxPx * maxPx;
      PLACES.forEach((p, i) => { const d = (placeP[i][0] - x) ** 2 + (placeP[i][1] - y) ** 2; if (d < bd) { bd = d; best = p; } });
      return best;
    }
    function launch(src, label) {
      const res = dijkstra(ADJ, src, -1);
      let maxD = 0, reached = 0;
      for (let i = 0; i < V; i++) if (res.dist[i] < Infinity) { reached++; maxD = Math.max(maxD, res.dist[i]); }
      waves.push({ dist: res.dist, prev: res.prev, t0: performance.now(), maxD, src });
      if (waves.length > 3) waves.shift();
      readout.innerHTML = `<div class="src">${label}</div>` +
        `<div><b>${reached}</b> of ${V} vertices settled in <b>${res.ms.toFixed(2)} ms</b></div>` +
        `<div>farthest reachable junction · <b>${fmtM(maxD)}</b></div>`;
    }
    cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const n = nearestNode(x, y), pl = nearestPlace(P[n][0], P[n][1]);
      lastClick = performance.now();
      launch(n, pl ? `from near ${pl.name}` : `from junction #${n}`);
    });
    cv.addEventListener('mousemove', e => { const r = cv.getBoundingClientRect(); mouse = [e.clientX - r.left, e.clientY - r.top]; });
    cv.addEventListener('mouseleave', () => { mouse = null; });
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) requestAnimationFrame(draw); }, { threshold: 0.05 }).observe(cv);

    const autoPick = ['Gate 1', 'Tagore Hostel', 'Shivalik Hostel', 'NC 4 (Boys hostel)', 'D6 (Star Library)', 'B1 Academic Block'];
    let autoIdx = 0;
    function auto() {
      const name = autoPick[autoIdx++ % autoPick.length];
      const p = PLACES.find(q => q.name === name) || PLACES[0];
      launch(p.node, `from ${p.name}`);
    }
    setTimeout(auto, 900);
    setInterval(() => { if (visible && performance.now() - lastClick > 9000) auto(); }, 7500);

    function draw(now) {
      if (!visible) return;
      ctx.clearRect(0, 0, W, H);
      // base graph
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(201,169,110,0.13)';
      ctx.beginPath();
      for (const [u, v] of EDGES) { ctx.moveTo(P[u][0], P[u][1]); ctx.lineTo(P[v][0], P[v][1]); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(201,169,110,0.28)';
      for (let i = 0; i < V; i++) ctx.fillRect(P[i][0] - 0.6, P[i][1] - 0.6, 1.2, 1.2);

      // waves: the true Dijkstra wavefront, travelling along real paths in order of distance
      ctx.globalCompositeOperation = 'lighter';
      for (const wv of waves) {
        const F = (now - wv.t0) / 1000 * SPEED;
        const life = 1 - clamp((F - wv.maxD) / 2600, 0, 1);
        if (life <= 0) continue;
        for (let k = 0; k < E; k++) {
          const [u, v, w] = EDGES[k];
          const du = wv.dist[u], dv = wv.dist[v];
          if (du === Infinity) continue;
          const tree = wv.prev[v] === u || wv.prev[u] === v;
          for (const [a, b, da] of [[u, v, du], [v, u, dv]]) {
            const len = clamp(F - da, 0, w);
            if (len <= 0) continue;
            if (!tree && len > w / 2 + 1 && da !== Math.min(du, dv)) continue;
            const t = tree ? len / w : Math.min(len, w / 2) / w;
            const x = P[a][0] + (P[b][0] - P[a][0]) * t, y = P[a][1] + (P[b][1] - P[a][1]) * t;
            const age = F - (da + len);
            const head = Math.exp(-age / 260);
            const alpha = (tree ? 0.16 : 0.07) * life + 0.85 * head * life;
            ctx.strokeStyle = `rgba(233,206,150,${alpha.toFixed(3)})`;
            ctx.lineWidth = tree ? 1.5 : 1;
            ctx.beginPath(); ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(x, y); ctx.stroke();
            if (len < w && tree && head > 0.6) {
              ctx.fillStyle = `rgba(255,240,210,${(0.9 * life).toFixed(3)})`;
              ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 6.283); ctx.fill();
            }
          }
        }
        // source beacon
        const [sx, sy] = P[wv.src];
        const r = 4 + ((now - wv.t0) / 30) % 26;
        ctx.strokeStyle = `rgba(239,228,207,${(0.6 * life * (1 - r / 30)).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.283); ctx.stroke();
        ctx.fillStyle = `rgba(239,228,207,${life.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(sx, sy, 3, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // places as small diamonds; name the one under the cursor
      ctx.fillStyle = 'rgba(233,214,173,0.55)';
      for (const [x, y] of placeP) { ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x + 3, y); ctx.lineTo(x, y + 3); ctx.lineTo(x - 3, y); ctx.fill(); }
      if (mouse) {
        const g = ctx.createRadialGradient(mouse[0], mouse[1], 0, mouse[0], mouse[1], 120);
        g.addColorStop(0, 'rgba(201,169,110,0.10)'); g.addColorStop(1, 'rgba(201,169,110,0)');
        ctx.fillStyle = g; ctx.fillRect(mouse[0] - 120, mouse[1] - 120, 240, 240);
        const pl = nearestPlace(mouse[0], mouse[1], 26);
        if (pl) {
          const [x, y] = P[pl.node];
          ctx.font = '500 17px "Cormorant Garamond", serif';
          ctx.fillStyle = '#f4eee3';
          ctx.fillText(pl.name, x + 10, y - 8);
        }
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);

    // count-up stats
    const target = { V, E, P: PLACES.length };
    $$('[data-count]').forEach(el => {
      const to = target[el.dataset.count], t0 = performance.now();
      (function f(now) { const t = clamp((now - t0) / 1800, 0, 1); el.textContent = Math.round(to * ease(t)); if (t < 1) requestAnimationFrame(f); })(t0);
    });
    // parallax fade as you scroll away
    addEventListener('scroll', () => {
      const y = scrollY, h = innerHeight;
      cv.style.transform = `translateY(${y * 0.35}px)`;
      cv.style.opacity = String(clamp(1 - y / (h * 0.9), 0, 1));
    }, { passive: true });
  })();

  // =========================================================================
  //  I · Roads become a graph
  // =========================================================================
  (function chapterRoad() {
    // a real road from the campus data: the longest one with 6–10 points, inside the campus
    const cand = D.roads.features.filter(f => f.geometry.coordinates.length >= 6 && f.geometry.coordinates.length <= 10);
    const lenOf = f => f.geometry.coordinates.reduce((s, p, i, a) => s + (i ? haversine(a[i - 1], p).d : 0), 0);
    // prefer a road that bends: score by the smaller side of its bounding box (in metres)
    const spread = f => {
      const c = f.geometry.coordinates.map(proj), xs = c.map(p => p[0]), ys = c.map(p => p[1]);
      return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 111000 + lenOf(f) * 0.05;
    };
    cand.sort((a, b) => spread(b) - spread(a));
    const road = (cand.find(f => f.properties.hw !== 'track') || cand[0]);
    const pts = road.geometry.coordinates;
    $('#road-name').textContent = `${road.properties.hw} road · ${pts.length} points`;

    const svg = $('#stage-road'), W = 600, H = 340;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const xy = fit(pts.map(proj), W, H, 46);
    const path = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    S('path', { d: path, class: 'g-road' }, svg);
    const segEls = [], wEls = [];
    for (let i = 0; i + 1 < xy.length; i++) {
      const [x1, y1] = xy[i], [x2, y2] = xy[i + 1];
      segEls.push(S('line', { x1, y1, x2, y2, class: 'g-e', opacity: 0 }, svg));
      const L = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / L * 14, ny = (x2 - x1) / L * 14;
      const t = S('text', { x: (x1 + x2) / 2 + nx, y: (y1 + y2) / 2 + ny + 3, class: 'g-w', 'text-anchor': 'middle', opacity: 0 }, svg);
      wEls.push(t);
    }
    const ptEls = xy.map(([x, y], i) => {
      const c = S('circle', { cx: x, cy: y, r: 4.5, class: 'g-pt' }, svg);
      const t = S('text', { x: x, y: y - 11, class: 'g-w', 'text-anchor': 'middle' }, svg); t.textContent = 'P' + i;
      return c;
    });

    const code = `// an OSM road is a list of [lon, lat] points
function addRoad(graph, pts) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const w = haversine(a, b);      // in metres
    graph.addEdge(a, b, w);         // both ways
  }
}

// distance along the Earth's surface
function haversine([x1, y1], [x2, y2]) {
  const R = 6371000, r = Math.PI / 180;
  const dy = (y2 - y1) * r, dx = (x2 - x1) * r;
  const h = sin(dy / 2) ** 2
          + cos(y1 * r) * cos(y2 * r) * sin(dx / 2) ** 2;
  return 2 * R * asin(sqrt(h));
}`;
    const steps = [];
    let total = 0;
    const st = (seg, active, extra = {}) => ({ seg, active, total, ...extra });
    steps.push({ line: 2, ms: 1.6, ghost: { 2: `${pts.length} points` },
      say: `This road arrives from OpenStreetMap as <b>${pts.length} GPS points</b>. On its own it's just a drawing. The graph doesn't exist yet.`,
      state: st(0, -1) });
    for (let i = 0; i + 1 < pts.length; i++) {
      const hv = haversine(pts[i], pts[i + 1]);
      steps.push({ line: [3, 4], ms: i < 2 ? 1.1 : 0.6, ghost: { 3: `i = ${i}`, 4: `P${i} → P${i + 1}` },
        say: `Take neighbouring points <b>P${i}</b> and <b>P${i + 1}</b>. They will become the two ends of one edge.`, state: st(i, i) });
      if (i === 0) {
        steps.push({ line: 12, ms: 1.2, ghost: { 12: 'Earth radius' }, say: 'How far apart are they? On a sphere you can\'t just use Pythagoras, so we use the <b>haversine formula</b>.', state: st(i, i) });
        steps.push({ line: 13, ms: 1.3, ghost: { 13: `Δφ ${(hv.dy * 1e6).toFixed(2)} µrad` }, say: 'Convert the differences in latitude and longitude to radians.', state: st(i, i) });
        steps.push({ line: [14, 15], ms: 1.3, ghost: { 14: `h = ${hv.h.toExponential(2)}` }, say: 'Combine them into <b>h</b>, which measures how far apart the two points are on the sphere.', state: st(i, i) });
        steps.push({ line: 16, ms: 1.3, ghost: { 16: `= ${hv.d.toFixed(1)} m` }, say: `Turn that back into a real length: <b>${hv.d.toFixed(1)} metres</b> of road.`, state: st(i, i) });
      }
      total += hv.d;
      steps.push({ line: [5, 6], ms: i < 2 ? 1.2 : 0.7, ghost: { 5: `w = ${hv.d.toFixed(1)} m`, 6: 'edge added' },
        say: `Edge <b>P${i} — P${i + 1}</b> joins the graph with weight <b>${hv.d.toFixed(1)} m</b>.`, state: st(i + 1, i, { w: hv.d }) });
    }
    steps.push({ line: 8, ms: 2, ghost: { 8: `${pts.length - 1} edges · ${total.toFixed(0)} m` },
      say: `The whole road is now <b>${pts.length - 1} weighted edges</b>. Doing this for all ${D.roads.features.length} campus roads gives the graph Dijkstra works on.`,
      state: st(pts.length - 1, -1) });

    const weights = []; for (let i = 0; i + 1 < pts.length; i++) weights.push(haversine(pts[i], pts[i + 1]).d);
    const tr = new Tracer($('#code-road'), {
      file: 'graph.js', fn: 'addRoad()', code, baseMs: 1000,
      intro: 'Press play, or just scroll here, to watch a real campus road become edges of the graph.',
      render(s) {
        segEls.forEach((el, i) => { el.setAttribute('opacity', i < s.seg ? 1 : 0); el.classList.toggle('on', i === s.active && i < s.seg); });
        wEls.forEach((el, i) => { el.setAttribute('opacity', i < s.seg ? 1 : 0); el.textContent = weights[i].toFixed(1); el.classList.toggle('on', i === s.active); });
        ptEls.forEach((el, i) => el.classList.toggle('on', s.active >= 0 && (i === s.active || i === s.active + 1)));
        $('#road-seg').textContent = s.seg;
        $('#road-len').textContent = s.total.toFixed(1) + ' m';
      },
    });
    tr.setSteps(steps);
  })();

  // =========================================================================
  //  II · Adjacency list
  // =========================================================================
  (function chapterAdj() {
    const stage = graphStage($('#stage-adj'), 600, 360, { gap: 74 });
    const table = $('#adj-table');
    const rows = PG.names.map(n => {
      const r = document.createElement('div');
      r.className = 'adj-row';
      r.innerHTML = `<span class="who">${n}</span><span class="chips"></span>`;
      table.appendChild(r);
      return r;
    });
    const code = `// one list per vertex: who it touches, how far
const adj = Array.from({ length: V }, () => []);

for (const [u, v, w] of edges) {
  adj[u].push({ v, w });
  adj[v].push({ v: u, w });     // walk either way
}

// neighbours of u are simply adj[u]: no scanning`;
    const steps = [{ line: 2, ms: 1.6, ghost: { 2: `V = ${PG.n} empty lists` },
      say: `Start with <b>${PG.n} empty lists</b>, one for each place.`, state: { k: 0, cur: -1 } }];
    PG.edges.forEach(([u, v, w], k) => {
      steps.push({ line: 4, ms: k < 3 ? 1 : 0.55, ghost: { 4: `${PG.names[u]} – ${PG.names[v]}, ${w} m` },
        say: `Next edge: <b>${PG.names[u]}</b> to <b>${PG.names[v]}</b>, ${w} m of real walking path.`, state: { k, cur: k, half: 0 } });
      steps.push({ line: [5, 6], ms: k < 3 ? 1.1 : 0.55, ghost: { 5: `adj[${PG.names[u]}] ← ${PG.names[v]}`, 6: `adj[${PG.names[v]}] ← ${PG.names[u]}` },
        say: `Write it into <b>both</b> lists, because a path can be walked in either direction.`, state: { k: k + 1, cur: k, half: 1 } });
    });
    const entries = PG.edges.length * 2;
    steps.push({ line: 9, ms: 2, ghost: { 9: `${PG.n} + ${entries} entries` },
      say: `Done: <b>${PG.n} lists holding ${entries} entries</b>. A ${PG.n}×${PG.n} matrix would need ${PG.n * PG.n} cells. For the real campus that's ${V} + ${2 * E} entries instead of ${(V * V).toLocaleString()} cells.`,
      state: { k: PG.edges.length, cur: -1 } });

    new Tracer($('#code-adj'), {
      file: 'graph.js', fn: 'buildAdjacency()', code, baseMs: 1000,
      intro: 'Each edge gets written into the lists of both places it connects.',
      render(s) {
        stage.edges.forEach((e, i) => {
          const seen = i < s.k || i === s.cur;
          e.line.style.opacity = seen ? 1 : 0.12; e.label.style.opacity = seen ? 1 : 0;
          e.line.classList.toggle('on', i === s.cur);
          e.label.classList.toggle('on', i === s.cur);
        });
        const cur = s.cur >= 0 ? PG.edges[s.cur] : null;
        stage.nodes.forEach((n, i) => n.g.classList.toggle('front', !!cur && (cur[0] === i || cur[1] === i)));
        rows.forEach((r, i) => {
          const list = [];
          PG.edges.forEach(([u, v, w], k) => {
            if (k < s.k) { if (u === i) list.push([v, w]); if (v === i) list.push([u, w]); }
          });
          const chips = $('.chips', r);
          const html = list.map(([v, w]) => `<span class="chip">${PG.names[v]} · ${w}</span>`).join('');
          if (chips.dataset.n !== String(list.length)) { chips.innerHTML = html; chips.dataset.n = list.length; }
          r.classList.toggle('on', !!cur && (cur[0] === i || cur[1] === i));
        });
      },
    }).setSteps(steps);
  })();

  // =========================================================================
  //  III · Min-heap
  // =========================================================================
  (function chapterHeap() {
    const svg = $('#stage-heap'), W = 600, H = 420;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const gEdges = S('g', {}, svg), gNodes = S('g', {}, svg);
    const arrEl = $('#heap-array');

    // real keys: walking distances from Gate 1 (or the first place) to other places
    const srcIdx = 0;
    const dRow = dijkstra(ADJ, PG.places[srcIdx].node, -1).dist;
    const items = PG.places.slice(1, 7).map((p, i) => ({ id: i, name: PG.names[i + 1], key: Math.round(dRow[p.node]) }));
    const desc = [...items].sort((a, b) => b.key - a.key);
    const order = [desc[1], desc[3], desc[0], desc[5], desc[2], desc[4]].filter(Boolean);

    const code = `class MinHeap {
  push(item, key) {
    a.push({ item, key });         // new leaf at the end
    let i = a.length - 1;
    while (i > 0 && a[up(i)].key > a[i].key) {
      swap(i, up(i));              // bubble up
      i = up(i);
    }
  }
  pop() {
    const top = a[0];              // always the minimum
    a[0] = a.pop();                // last leaf to the root
    let i = 0, c;
    while ((c = minChild(i)) >= 0 && a[c].key < a[i].key) {
      swap(i, c);                  // sink down
      i = c;
    }
    return top;
  }
}`;
    const steps = [];
    const a = [];
    const snap = (extra = {}) => ({ a: a.map(x => ({ ...x })), cmp: [], out: null, ...extra });
    const up = i => (i - 1) >> 1;
    steps.push({ line: 1, ms: 1.4, say: `The keys are real walking distances from <b>${PG.names[srcIdx]}</b>. Smaller keys float to the top.`, state: snap() });
    for (const it of order) {
      a.push({ ...it });
      let i = a.length - 1;
      steps.push({ line: 3, ms: 1, ghost: { 3: `${it.name} · ${it.key} m` }, say: `Push <b>${it.name}</b> (${it.key} m) as a new leaf at index ${i}.`, state: snap({ cmp: [i] }) });
      while (i > 0) {
        const p = up(i), bigger = a[p].key > a[i].key;
        steps.push({ line: 5, ms: 0.9, ghost: { 5: `${a[p].key} > ${a[i].key} ${bigger ? '✓' : '✗'}` },
          say: bigger ? `Its parent <b>${a[p].name}</b> (${a[p].key} m) is larger, so they're in the wrong order.`
            : `Parent <b>${a[p].name}</b> (${a[p].key} m) is smaller. The heap rule holds again, so stop.`, state: snap({ cmp: [i, p] }) });
        if (!bigger) break;
        [a[i], a[p]] = [a[p], a[i]];
        steps.push({ line: [6, 7], ms: 0.9, ghost: { 6: `swap ${i} ↔ ${p}` }, say: `Swap them. <b>${a[p].name}</b> climbs one level.`, state: snap({ cmp: [p] }) });
        i = p;
      }
      if (i === 0) steps.push({ line: 5, ms: 0.8, ghost: { 5: 'i = 0, at the root' }, say: `<b>${a[0].name}</b> reached the root: it is now the smallest key.`, state: snap({ cmp: [0] }) });
    }
    for (let k = 0; k < 2; k++) {
      const top = a[0];
      steps.push({ line: 11, ms: 1.2, ghost: { 11: `${top.name} · ${top.key} m` }, say: `Pop: the root, <b>${top.name}</b>, is the minimum. We get it in O(1).`, state: snap({ cmp: [0], out: top }) });
      const last = a.pop();
      if (a.length) {
        a[0] = last;
        steps.push({ line: 12, ms: 1.1, ghost: { 12: `${last.name} → root` }, say: `Move the last leaf, <b>${last.name}</b>, up to the root. Now it has to sink back down.`, state: snap({ cmp: [0], out: top }) });
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let c = -1;
          if (l < a.length) c = l;
          if (r < a.length && a[r].key < a[l].key) c = r;
          if (c < 0) { steps.push({ line: 14, ms: 0.9, ghost: { 14: 'no children, stop' }, say: 'It\'s a leaf now, so the heap is valid again.', state: snap({ cmp: [i], out: top }) }); break; }
          const go = a[c].key < a[i].key;
          steps.push({ line: 14, ms: 0.9, ghost: { 14: `${a[c].key} < ${a[i].key} ${go ? '✓' : '✗'}` },
            say: go ? `Its smaller child <b>${a[c].name}</b> (${a[c].key} m) beats it, so swap.` : `Both children are larger. <b>${a[i].name}</b> stays where it is.`,
            state: snap({ cmp: [i, c], out: top }) });
          if (!go) break;
          [a[i], a[c]] = [a[c], a[i]];
          steps.push({ line: [15, 16], ms: 0.9, ghost: { 15: `swap ${i} ↔ ${c}` }, say: `<b>${a[c].name}</b> sinks one level.`, state: snap({ cmp: [c], out: top }) });
          i = c;
        }
      }
      steps.push({ line: 18, ms: 1.3, ghost: { 18: `→ ${top.name}` }, say: `Returned <b>${top.name}</b> in O(log n): at most one swap per level, and only ${Math.ceil(Math.log2(a.length + 2))} levels.`, state: snap({ out: top, gone: true }) });
    }

    const nodeEls = {};
    items.forEach(it => {
      const g = S('g', { class: 'hn' }, gNodes);
      S('circle', { r: 25 }, g);
      const k = S('text', { class: 'key', y: 4 }, g); k.textContent = it.key;
      const nm = S('text', { class: 'nm', y: 42 }, g); nm.textContent = it.name;
      g.style.opacity = 0;
      nodeEls[it.id] = g;
    });
    const posOf = (i) => {
      const d = Math.floor(Math.log2(i + 1)), first = 2 ** d - 1, slot = i - first, count = 2 ** d;
      return [(slot + 0.5) / count * W, 60 + d * 110];
    };
    new Tracer($('#code-heap'), {
      file: 'dijkstra.js', fn: 'class MinHeap', code, baseMs: 1000,
      intro: 'Watch the heap rule (no parent larger than its children) get restored after every push and pop.',
      render(s) {
        gEdges.innerHTML = '';
        for (let i = 1; i < s.a.length; i++) {
          const [x1, y1] = posOf((i - 1) >> 1), [x2, y2] = posOf(i);
          S('line', { x1, y1, x2, y2, class: 'h-edge' }, gEdges);
        }
        const present = new Set(s.a.map(x => x.id));
        items.forEach(it => {
          const g = nodeEls[it.id];
          const idx = s.a.findIndex(x => x.id === it.id);
          if (idx >= 0) {
            const [x, y] = posOf(idx);
            g.style.transform = `translate(${x}px, ${y}px)`; g.style.opacity = 1;
            g.classList.toggle('cmp', s.cmp.includes(idx)); g.classList.toggle('root', idx === 0); g.classList.remove('out');
          } else if (s.out && s.out.id === it.id) {
            g.style.transform = `translate(${W - 60}px, ${H - 50}px) scale(.85)`; g.style.opacity = s.gone ? 0.0 : 1;
            g.classList.add('out'); g.classList.remove('cmp', 'root');
          } else if (!present.has(it.id)) {
            g.style.opacity = 0; g.style.transform = `translate(${W - 60}px, ${H - 50}px) scale(.6)`;
          }
        });
        arrEl.innerHTML = s.a.map((x, i) => `<div class="cell ${s.cmp.includes(i) ? 'cmp' : ''} ${i === 0 ? 'root' : ''}"><small>[${i}]</small><b>${x.key}</b><span>${x.name}</span></div>`).join('')
          || '<span class="pq-empty">empty</span>';
      },
    }).setSteps(steps);
  })();

  // =========================================================================
  //  IV · Dijkstra, step by step
  // =========================================================================
  (function chapterDijkstra() {
    const stage = graphStage($('#stage-dj'), 600, 440, { gap: 82 });
    const fromSel = $('#dj-from'), toSel = $('#dj-to');
    PG.full.forEach((n, i) => { fromSel.add(new Option(n, i)); toSel.add(new Option(n, i)); });
    // default: the pair that is farthest apart, for the longest story
    let best = [0, 1, 0];
    for (let i = 0; i < PG.n; i++) {
      const r = trace(i, -1).final;
      r.dist.forEach((d, j) => { if (d > best[2] && d < Infinity) best = [i, j, d]; });
    }
    fromSel.value = best[0]; toSel.value = best[1];

    const code = `function dijkstra(adj, source, target) {
  const dist = Array(V).fill(Infinity);
  const prev = Array(V).fill(-1), done = new Set();
  const heap = new MinHeap();
  dist[source] = 0;
  heap.push(source, 0);
  while (heap.size) {
    const { item: u, key: d } = heap.pop();
    if (done.has(u)) continue;     // stale copy
    done.add(u);                   // d is final now
    if (u === target) break;
    for (const { v, w } of adj[u]) {
      if (d + w < dist[v]) {       // shorter via u?
        dist[v] = d + w;
        prev[v] = u;
        heap.push(v, d + w);
      }
    }
  }
  return buildPath(prev, target);
}

function buildPath(prev, target) {
  const path = [];
  for (let x = target; x !== -1; x = prev[x])
    path.unshift(x);               // walk back to A
  return path;
}`;

    // run the algorithm on the place graph, recording a full snapshot after every decision
    function trace(src, dst) {
      const n = PG.n, N = PG.names;
      const dist = Array(n).fill(Infinity), prev = Array(n).fill(-1), done = Array(n).fill(false);
      let heap = [];
      const steps = [];
      const snap = (x = {}) => ({ dist: [...dist], prev: [...prev], done: [...done], heap: heap.map(h => ({ ...h })),
        src, dst, cur: -1, edge: -1, ok: null, path: [], ...x });
      steps.push({ line: [2, 4], ms: 1.8, ghost: { 2: 'all ∞' }, say: 'At the start nothing is known, so every distance is <b>∞</b>.', state: snap() });
      dist[src] = 0; heap.push({ v: src, d: 0 });
      steps.push({ line: [5, 6], ms: 1.6, ghost: { 5: `dist[${N[src]}] = 0`, 6: `heap = [${N[src]} · 0]` },
        say: `The source <b>${N[src]}</b> is 0 m from itself. It goes into the heap first.`, state: snap() });
      let settledN = 0;
      while (heap.length) {
        heap.sort((a, b) => a.d - b.d);
        const { v: u, d } = heap.shift();
        steps.push({ line: 8, ms: 1.2, ghost: { 8: `u = ${N[u]}, d = ${d} m` },
          say: `Pop <b>${N[u]}</b> at <b>${d} m</b>, the closest place not yet settled.`, state: snap({ cur: u }) });
        if (done[u]) {
          steps.push({ line: 9, ms: 1.1, ghost: { 9: 'already settled, skip' },
            say: `<b>${N[u]}</b> was already settled by a shorter route, so this older copy is skipped (lazy deletion).`, state: snap({ cur: u }) });
          continue;
        }
        done[u] = true; settledN++;
        steps.push({ line: 10, ms: 1.1, ghost: { 10: `settled ${settledN} / ${n}` },
          say: `<b>${N[u]} = ${d} m</b> is now final. Every other route would be longer, because no edge has a negative length.`, state: snap({ cur: u }) });
        if (u === dst) {
          steps.push({ line: 11, ms: 1.6, ghost: { 11: '✓ destination reached' },
            say: `That's the destination. Stop here: ${n - settledN} place${n - settledN === 1 ? '' : 's'} never needed to be settled.`, state: snap({ cur: u }) });
          break;
        }
        for (const { v, w, k } of PG.adj[u]) {
          if (done[v]) continue;
          const nd = d + w, old = dist[v], ok = nd < old;
          steps.push({ line: [12, 13], ms: 1.1, ghost: { 13: `${d} + ${w} = ${nd} ${ok ? '<' : '≥'} ${fmtM(old)}` },
            say: ok ? `Through <b>${N[u]}</b>, ${N[v]} is <span class="ok">${nd} m</span> away, shorter than ${fmtM(old)}.`
              : `Through <b>${N[u]}</b>, ${N[v]} would be <span class="no">${nd} m</span>, not better than ${fmtM(old)}. Keep the old value.`,
            state: snap({ cur: u, edge: k, ok }) });
          if (ok) {
            dist[v] = nd; prev[v] = u; heap.push({ v, d: nd });
            steps.push({ line: [14, 16], ms: 1.1, ghost: { 14: `dist[${N[v]}] = ${nd}`, 15: `came from ${N[u]}`, 16: 'queued' },
              say: `Record <b>${nd} m</b> for ${N[v]}, remember it came from ${N[u]}, and queue it.`, state: snap({ cur: u, edge: k, ok, flash: v }) });
          }
        }
      }
      const final = { dist: [...dist], prev: [...prev] };
      if (dst >= 0 && dist[dst] < Infinity) {
        const path = [];
        steps.push({ line: 20, ms: 1.2, ghost: { 20: `prev[] has ${prev.filter(p => p >= 0).length} links` },
          say: 'Only distances were stored, but each place also remembers where its best route came from.', state: snap({ cur: dst }) });
        for (let x = dst; x !== -1; x = prev[x]) {
          path.unshift(x);
          steps.push({ line: [25, 26], ms: 0.9, ghost: { 25: `x = ${N[x]}`, 26: `path: ${path.length} stop${path.length > 1 ? 's' : ''}` },
            say: x === src ? `Back at <b>${N[x]}</b>. The chain of <i>prev</i> links is the route.` : `<b>${N[x]}</b> came from <b>${N[prev[x]]}</b>. Follow the link back.`,
            state: snap({ cur: x, path: [...path] }) });
        }
        steps.push({ line: 27, ms: 3, ghost: { 27: `${path.length} stops · ${dist[dst]} m` },
          say: `Shortest walk: <b>${path.map(i => N[i]).join(' → ')}</b>, ${dist[dst]} m in total.`, state: snap({ path: [...path], doneAll: true }) });
      }
      return { steps, final };
    }

    const edgeIndex = (a, b) => PG.edges.findIndex(([u, v]) => (u === a && v === b) || (u === b && v === a));
    const pq = $('#pq-items');
    const tr = new Tracer($('#code-dj'), {
      file: 'dijkstra.js', fn: 'dijkstra()', code, baseMs: 1050,
      intro: 'Pick any two places above, or press play.',
      render(s, step, i, forward) {
        const pathEdges = new Set();
        for (let k = 1; k < s.path.length; k++) pathEdges.add(edgeIndex(s.path[k - 1], s.path[k]));
        const treeEdges = new Set();
        s.prev.forEach((p, v) => { if (p >= 0) treeEdges.add(edgeIndex(p, v)); });
        stage.edges.forEach((e, k) => {
          const isPath = pathEdges.has(k);
          e.line.classList.toggle('path', isPath);
          e.line.classList.toggle('on', !isPath && k === s.edge && s.ok);
          e.line.classList.toggle('bad', !isPath && k === s.edge && s.ok === false);
          e.line.classList.toggle('tree', !isPath && treeEdges.has(k) && k !== s.edge);
          e.label.classList.toggle('on', k === s.edge || isPath);
          e.line.style.opacity = s.path.length && !isPath && s.doneAll ? 0.35 : 1;
        });
        const inHeap = new Set(s.heap.map(h => h.v));
        stage.nodes.forEach((n, v) => {
          const c = n.g.classList;
          c.toggle('src', v === s.src); c.toggle('dst', v === s.dst);
          c.toggle('done', s.done[v]); c.toggle('front', !s.done[v] && inHeap.has(v));
          c.toggle('cur', v === s.cur);
          n.dist.textContent = fmtM(s.dist[v]);
          if (forward && s.flash === v) { c.remove('flash'); void n.g.getBBox(); c.add('flash'); }
        });
        const sorted = [...s.heap].sort((a, b) => a.d - b.d);
        pq.innerHTML = sorted.length
          ? sorted.map((h, k) => `<span class="pq-item ${k === 0 ? 'min' : ''} ${s.done[h.v] ? 'stale' : ''}">${PG.names[h.v]} <b>${h.d} m</b></span>`).join('')
          : '<span class="pq-empty">empty</span>';
      },
    });
    const reload = () => {
      const a = +fromSel.value, b = +toSel.value;
      if (a === b) { toSel.value = (b + 1) % PG.n; return reload(); }
      tr.setSteps(trace(a, b).steps, `From <b>${PG.full[a]}</b> to <b>${PG.full[b]}</b>. Press play, or step through at your own pace.`);
    };
    fromSel.onchange = toSel.onchange = () => { reload(); tr.play(); };
    reload();
  })();

  // =========================================================================
  //  V · Complexity + live benchmark
  // =========================================================================
  (function chapterComplexity() {
    const naive = V * V, heap = Math.round((V + E) * Math.log2(V));
    let ran = false;
    new IntersectionObserver(([en]) => {
      if (!en.isIntersecting || ran) return;
      ran = true;
      const t0 = performance.now();
      (function f(now) {
        const t = ease(clamp((now - t0) / 2200, 0, 1));
        $('#cx-naive').textContent = Math.round(naive * t).toLocaleString();
        $('#cx-heap').textContent = Math.round(heap * t).toLocaleString();
        $('#cx-ratio').textContent = Math.round((naive / heap) * t) + '×';
        if (t < 1) requestAnimationFrame(f);
      })(t0);
      $('#bar-naive').style.width = '100%';
      $('#bar-heap').style.width = (heap / naive * 100).toFixed(1) + '%';
    }, { threshold: 0.4 }).observe($('.complexity'));

    const btn = $('#bench-run'), spark = $('#bench-spark'), sctx = spark.getContext('2d');
    btn.onclick = () => {
      btn.disabled = true; btn.textContent = 'Running…';
      const N = 500, times = [], settled = [];
      const dpr = Math.min(devicePixelRatio || 1, 2);
      spark.width = spark.clientWidth * dpr; spark.height = spark.clientHeight * dpr;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = spark.clientWidth, h = spark.clientHeight;
      // warm up the JIT first so the chart measures the algorithm, not the compiler
      for (let j = 0; j < 40; j++) dijkstra(ADJ, PLACES[j % PLACES.length].node, PLACES[(j * 7 + 3) % PLACES.length].node);
      let k = 0;
      (function chunk() {
        for (let j = 0; j < 20 && k < N; j++, k++) {
          const a = PLACES[(Math.random() * PLACES.length) | 0].node;
          let b = PLACES[(Math.random() * PLACES.length) | 0].node;
          if (a === b) b = PLACES[(PLACES.findIndex(p => p.node === a) + 1) % PLACES.length].node;
          const t0 = performance.now();
          const r = dijkstra(ADJ, a, b);
          times.push(performance.now() - t0); settled.push(r.settledCount);
        }
        const avg = times.reduce((s, x) => s + x, 0) / times.length;
        const avgS = settled.reduce((s, x) => s + x, 0) / settled.length;
        $('#b-avg').textContent = avg.toFixed(3) + ' ms';
        $('#b-max').textContent = Math.max(...times).toFixed(2) + ' ms';
        $('#b-set').textContent = Math.round(avgS);
        $('#b-pct').textContent = Math.round(avgS / V * 100) + '%';
        // sparkline: each run's time
        sctx.clearRect(0, 0, w, h);
        const mx = Math.max(...times), bw = w / N;
        times.forEach((t, i) => {
          const bh = Math.max(1, t / mx * (h - 6));
          sctx.fillStyle = `rgba(201,169,110,${0.35 + 0.65 * t / mx})`;
          sctx.fillRect(i * bw, h - bh, Math.max(1, bw - 0.5), bh);
        });
        sctx.strokeStyle = 'rgba(233,214,173,.7)'; sctx.setLineDash([3, 4]);
        const ay = h - avg / mx * (h - 6);
        sctx.beginPath(); sctx.moveTo(0, ay); sctx.lineTo(w, ay); sctx.stroke(); sctx.setLineDash([]);
        if (k < N) requestAnimationFrame(chunk);
        else { btn.disabled = false; btn.textContent = 'Run again'; }
      })();
    };
  })();

  // =========================================================================
  //  VI · Pipeline: a pulse of light travels through the stations
  // =========================================================================
  (function chapterPipeline() {
    $('#pipe-size').textContent = `${V} vertices · ${E} edges`;
    const wrap = $('#pipeline'), svg = $('#pipe-line'), stations = $$('.station', wrap);
    let marks = [];
    function build() {
      const r = wrap.getBoundingClientRect();
      marks = stations.map(s => { const m = $('.st-mark', s).getBoundingClientRect(); return m.left + m.width / 2 - r.left; });
      svg.setAttribute('viewBox', `0 0 ${r.width} 2`);
      svg.innerHTML = '';
      S('line', { x1: marks[0], y1: 1, x2: marks[marks.length - 1], y2: 1, stroke: 'rgba(201,169,110,.25)', 'stroke-width': 1 }, svg);
      const defs = S('defs', {}, svg);
      const lg = S('linearGradient', { id: 'pulseG' }, defs);
      S('stop', { offset: '0', 'stop-color': '#e9d6ad', 'stop-opacity': 0 }, lg);
      S('stop', { offset: '1', 'stop-color': '#f4eee3', 'stop-opacity': 1 }, lg);
      S('rect', { id: 'pulse', x: 0, y: 0, width: 120, height: 2, fill: 'url(#pulseG)' }, svg);
    }
    build(); addEventListener('resize', build);
    let vis = false;
    new IntersectionObserver(([en]) => { vis = en.isIntersecting; }, { threshold: 0.3 }).observe(wrap);
    const T = 5200;
    (function f(now) {
      requestAnimationFrame(f);
      if (!vis || marks.length < 2) return;
      const t = (now % T) / T, x0 = marks[0], x1 = marks[marks.length - 1];
      const x = x0 + (x1 - x0) * ease(t);
      const p = $('#pulse', svg); if (p) p.setAttribute('x', x - 120);
      stations.forEach((s, i) => s.classList.toggle('lit', x >= marks[i] - 4 && x <= marks[i] + 160));
    })(0);
  })();

  // =========================================================================
  //  VII · Stack cards: soft light follows the cursor
  // =========================================================================
  $$('.tech').forEach(c => c.addEventListener('mousemove', e => {
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', e.clientX - r.left + 'px'); c.style.setProperty('--my', e.clientY - r.top + 'px');
  }));

  // =========================================================================
  //  Page chrome: reveal, chapter rail, reading progress
  // =========================================================================
  $$('.ch-head, .duo, .dj-controls, .complexity, .bench, .pipeline, .stack, .foot').forEach(el => el.classList.add('reveal'));
  const rev = new IntersectionObserver(ens => ens.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); rev.unobserve(en.target); } }),
    { threshold: 0.12 });
  $$('.reveal').forEach(el => rev.observe(el));
  const railLinks = $$('.rail a');
  const secObs = new IntersectionObserver(ens => ens.forEach(en => {
    if (en.isIntersecting) railLinks.forEach(a => a.classList.toggle('on', a.dataset.ch === en.target.dataset.ch));
  }), { rootMargin: '-45% 0px -50% 0px' });
  $$('section[data-ch]').forEach(s => secObs.observe(s));
  const prog = $('#read-progress');
  addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    prog.style.width = (scrollY / (max || 1) * 100) + '%';
  }, { passive: true });
})();
