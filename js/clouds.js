/*
 * Intro cloud deck, rendered by a WebGL fragment shader.
 *   - two layers of domain-warped fractal noise (far + near) for depth/parallax
 *   - lit by a low, warm sun from the upper left; denser cores self-shadow
 *   - Clouds.setProgress(p), p in [0,1]: a gap opens in the middle and the deck
 *     drifts outward and thins, revealing the campus underneath
 * Falls back to a soft CSS haze when WebGL is unavailable.
 */
const Clouds = (() => {
  const canvas = document.getElementById('clouds');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  let p = 0, alive = true;

  if (!gl) {
    canvas.style.background = 'radial-gradient(ellipse at 50% 40%, rgba(236,226,208,.85), rgba(120,110,98,.92))';
    return {
      setProgress(v) { p = v; canvas.style.opacity = String(Math.max(0, 1 - v * 1.4)); },
      remove() { canvas.remove(); },
    };
  }

  const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
  const FRAG = `
    precision highp float;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uP;

    float hash(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 m = mat2(1.62, 1.18, -1.18, 1.62);
      for (int i = 0; i < 6; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
      return v;
    }
    // density of one layer at screen position c (aspect-corrected, centred)
    float density(vec2 c, float scale, float drift, float seed, float depth) {
      float side = c.x < 0.0 ? -1.0 : 1.0;
      float part = pow(uP, 1.25) * (0.9 + 0.7 * depth);
      vec2 q = c - vec2(side * part, -uP * 0.12 * depth);      // deck slides outward
      vec2 s = q * scale + vec2(uTime * drift + seed, seed * 0.37);
      vec2 w = vec2(fbm(s * 0.6 + vec2(0.0, uTime * 0.01)), fbm(s * 0.6 + vec2(5.2, 1.3)));
      // big rounded billows + fine detail, lightly warped (strong warping reads as marble)
      float d = fbm(s + 0.55 * w) * 0.75 + noise(s * 0.45 + 7.0) * 0.35;
      float cover = 0.50 + uP * 0.30;                          // thins as we descend
      d = smoothstep(cover, cover + 0.20, d);
      float gap = smoothstep(0.0, 0.32, abs(c.x) - part * 0.55); // opening in the middle
      return d * mix(1.0, gap, smoothstep(0.0, 0.15, uP));
    }
    vec4 shade(vec2 c, float scale, float drift, float seed, float depth) {
      float d = density(c, scale, drift, seed, depth);
      if (d <= 0.001) return vec4(0.0);
      vec2 sun = normalize(vec2(-0.75, 0.55)) * 0.06;
      float dl = density(c + sun, scale, drift, seed, depth);
      float lit = clamp(0.6 + (d - dl) * 1.6, 0.0, 1.0);        // brighter where density falls toward the sun
      vec3 shadow = vec3(0.30, 0.29, 0.31);
      vec3 mid    = vec3(0.71, 0.67, 0.62);
      vec3 light  = vec3(0.98, 0.93, 0.84);
      vec3 col = mix(shadow, mid, smoothstep(0.0, 0.55, lit));
      col = mix(col, light, smoothstep(0.5, 1.0, lit));
      col *= mix(1.0, 0.82, smoothstep(0.55, 1.0, d));           // thick cores a touch darker
      float a = d * (0.97 - 0.2 * (1.0 - depth));
      return vec4(col * a, a);
    }
    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      vec2 c = uv - 0.5;
      c.x *= uRes.x / uRes.y;
      vec4 far  = shade(c, 2.3, 0.010, 3.0, 0.55);
      vec4 near = shade(c, 1.5, 0.018, 11.0, 1.0);
      vec4 col = near + far * (1.0 - near.a);
      // warm atmospheric haze behind the deck, gone once we are below the clouds
      float haze = (0.42 - 0.22 * length(c)) * (1.0 - smoothstep(0.0, 0.55, uP));
      vec3 hz = mix(vec3(0.42, 0.39, 0.35), vec3(0.78, 0.72, 0.62), uv.y);
      col.rgb += hz * haze * (1.0 - col.a);
      col.a += haze * (1.0 - col.a);
      col *= 1.0 - smoothstep(0.82, 1.0, uP);                     // final fade
      gl_FragColor = col;
    }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, 'uRes');
  const uTime = gl.getUniformLocation(prog, 'uTime');
  const uP = gl.getUniformLocation(prog, 'uP');

  const SCALE = 0.5; // render at half resolution; clouds are soft so this is invisible and much faster
  function resize() {
    canvas.width = Math.max(1, Math.round(innerWidth * SCALE));
    canvas.height = Math.max(1, Math.round(innerHeight * SCALE));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  addEventListener('resize', resize);

  const t0 = performance.now();
  (function frame(now) {
    if (!alive) return;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - t0) / 1000);
    gl.uniform1f(uP, p);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  })(t0);

  return {
    setProgress(v) { p = v; },
    remove() { alive = false; removeEventListener('resize', resize); canvas.remove(); },
  };
})();
