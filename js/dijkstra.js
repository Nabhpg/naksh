/*
 * Dijkstra's shortest path on the CU walking graph.
 *
 * Graph:   nodes = road/footpath junctions & bends from OpenStreetMap (lon, lat)
 *          edges = real path segments, weight = length in metres (haversine)
 * Queue:   binary min-heap with lazy deletion  ->  O((V + E) log V)
 *
 * Besides the answer, dijkstra() records every step (settle / relax) so the
 * UI can replay exactly what the algorithm did.
 */

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }

  push(item, key) {
    const a = this.a;
    a.push({ item, key });
    let i = a.length - 1;
    while (i > 0) {                       // sift up
      const p = (i - 1) >> 1;
      if (a[p].key <= a[i].key) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {                          // sift down
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Build an adjacency list: adj[u] = [{ v, w, edge }] (undirected). */
function buildAdjacency(nodeCount, edges) {
  const adj = Array.from({ length: nodeCount }, () => []);
  edges.forEach(([u, v, w], i) => {
    adj[u].push({ v, w, edge: i });
    adj[v].push({ v: u, w, edge: i });
  });
  return adj;
}

/**
 * @returns {{ path:number[], distance:number, steps:Array, settledCount:number,
 *             relaxCount:number, pushes:number, ms:number }}
 * steps: { t:'settle', u, d }  |  { t:'relax', u, v, d, edge }
 */
function dijkstra(adj, source, target) {
  const t0 = performance.now();
  const n = adj.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const steps = [];
  const pq = new MinHeap();
  let relaxCount = 0, pushes = 1, settledCount = 0;

  dist[source] = 0;
  pq.push(source, 0);

  while (pq.size) {
    const { item: u, key: d } = pq.pop();
    if (done[u]) continue;                // stale entry (lazy deletion)
    done[u] = 1;
    settledCount++;
    steps.push({ t: 'settle', u, d });
    if (u === target) break;              // target settled -> its distance is final

    for (const { v, w, edge } of adj[u]) {
      if (done[v]) continue;
      const nd = d + w;
      if (nd < dist[v]) {                 // relaxation
        dist[v] = nd;
        prev[v] = u;
        pq.push(v, nd);
        pushes++;
        relaxCount++;
        steps.push({ t: 'relax', u, v, d: nd, edge });
      }
    }
  }

  const path = [];
  if (dist[target] < Infinity) {
    for (let x = target; x !== -1; x = prev[x]) path.push(x);
    path.reverse();
  }
  return {
    path, distance: dist[target], dist, prev, steps, settledCount, relaxCount, pushes,
    ms: performance.now() - t0,
  };
}
