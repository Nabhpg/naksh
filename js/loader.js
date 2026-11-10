/*
 * Loading screen: a generated city street grid with light trails racing along
 * the streets (random walks on a grid graph), plus a progress counter.
 */
const Loader = (() => {
  const el = document.getElementById('loader');
  const cv = document.getElementById('loader-canvas');
  const ctx = cv.getContext('2d');
  const pctEl = document.getElementById('loader-pct');
  const statusEl = document.getElementById('loader-status');
  const barEl = document.getElementById('loader-bar');
  let W, H, DPR, nodes, edges, adj, cars, raf, progress = 0, shown = 0, done = false;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function build() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.width = innerWidth * DPR;
    H = cv.height = innerHeight * DPR;
    cv.style.width = innerWidth + 'px';
    cv.style.height = innerHeight + 'px';

    // irregular grid of blocks = a "city"
    const step = 70 * DPR;
    const cols = Math.ceil(W / step) + 2, rows = Math.ceil(H / step) + 2;
    nodes = []; edges = []; adj = [];
    const id = (c, r) => r * cols + c;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        nodes.push([(c - 1) * step + rand(-14, 14) * DPR, (r - 1) * step + rand(-14, 14) * DPR]);
        adj.push([]);
      }
    const link = (a, b) => { edges.push([a, b]); adj[a].push(b); adj[b].push(a); };
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols && Math.random() > 0.12) link(id(c, r), id(c + 1, r));
        if (r + 1 < rows && Math.random() > 0.12) link(id(c, r), id(c, r + 1));
        if (c + 1 < cols && r + 1 < rows && Math.random() > 0.93) link(id(c, r), id(c + 1, r + 1));
      }

    cars = [];
    for (let i = 0; i < 55; i++) cars.push(newCar());
    ctx.fillStyle = '#0b0a09';
    ctx.fillRect(0, 0, W, H);
  }

  function newCar() {
    let u = (Math.random() * nodes.length) | 0;
    while (!adj[u].length) u = (Math.random() * nodes.length) | 0;
    const v = adj[u][(Math.random() * adj[u].length) | 0];
    // champagne gold trails, a few pearl ones
    const col = Math.random() < 0.8 ? [rand(36, 44), 55, rand(62, 72)] : [40, 35, 90];
    return { u, v, t: 0, speed: rand(0.01, 0.028), col, life: rand(8, 30) };
  }

  function drawStreets() {
    ctx.lineWidth = 1 * DPR;
    ctx.strokeStyle = 'rgba(201,169,110,0.055)';
    ctx.beginPath();
    for (const [a, b] of edges) {
      ctx.moveTo(nodes[a][0], nodes[a][1]);
      ctx.lineTo(nodes[b][0], nodes[b][1]);
    }
    ctx.stroke();
  }

  function frame() {
    // fade previous frame -> trails
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(11,10,9,0.14)';
    ctx.fillRect(0, 0, W, H);
    drawStreets();

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const A = nodes[c.u], B = nodes[c.v];
      const t1 = Math.min(1, c.t + c.speed);
      const x0 = A[0] + (B[0] - A[0]) * c.t, y0 = A[1] + (B[1] - A[1]) * c.t;
      const x1 = A[0] + (B[0] - A[0]) * t1, y1 = A[1] + (B[1] - A[1]) * t1;
      const [h, sat, l] = c.col;
      ctx.strokeStyle = `hsla(${h},${sat}%,${l}%,0.85)`;
      ctx.lineWidth = 1.5 * DPR;
      ctx.shadowColor = `hsla(${h},${sat}%,${l}%,0.9)`;
      ctx.shadowBlur = 8 * DPR;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      c.t = t1;
      if (c.t >= 1) {
        // random walk: continue to a neighbour, avoid going straight back
        const opts = adj[c.v].filter(n => n !== c.u);
        c.u = c.v;
        c.v = (opts.length ? opts : adj[c.v])[(Math.random() * (opts.length || adj[c.v].length)) | 0];
        c.t = 0;
        if (--c.life <= 0) cars[i] = newCar();
      }
    }
    ctx.shadowBlur = 0;

    shown += (progress - shown) * 0.08;
    pctEl.textContent = String(Math.round(shown)).padStart(3, '0');
    barEl.style.width = shown + '%';
    raf = requestAnimationFrame(frame);
  }

  build();
  frame();
  addEventListener('resize', () => { if (!done) build(); });

  return {
    set(p, msg) { progress = Math.max(progress, p); if (msg) statusEl.textContent = msg; },
    finish() {
      return new Promise(res => {
        progress = 100;
        const wait = () => {
          if (shown < 99) return requestAnimationFrame(wait);
          pctEl.textContent = '100';
          done = true;
          el.classList.add('hide');
          setTimeout(() => { cancelAnimationFrame(raf); el.remove(); res(); }, 1100);
        };
        wait();
      });
    },
  };
})();
