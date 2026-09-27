import * as THREE from 'three';

export const SEASONS = ['春', '夏', '秋', '冬'];

// 一天中的光景：[时刻, 光色, 雾色, 雾浓度, 夜色程度]
const DAY = [
  [0,    [0.40, 0.45, 0.66], [0.10, 0.12, 0.20], 0.10, 1.0],
  [4.5,  [0.42, 0.46, 0.66], [0.14, 0.16, 0.25], 0.12, 1.0],
  [6,    [0.86, 0.78, 0.80], [0.88, 0.87, 0.90], 0.60, 0.3],
  [8,    [1.00, 0.98, 0.95], [0.93, 0.93, 0.91], 0.30, 0.0],
  [12,   [1.06, 1.04, 1.00], [0.96, 0.94, 0.89], 0.06, 0.0],
  [16,   [1.06, 0.99, 0.90], [0.96, 0.91, 0.82], 0.10, 0.0],
  [18,   [1.10, 0.80, 0.60], [0.96, 0.70, 0.50], 0.28, 0.15],
  [19.5, [0.62, 0.57, 0.74], [0.36, 0.36, 0.52], 0.15, 0.65],
  [21,   [0.40, 0.45, 0.66], [0.10, 0.12, 0.20], 0.10, 1.0],
  [24,   [0.40, 0.45, 0.66], [0.10, 0.12, 0.20], 0.10, 1.0],
];

// 四季：墨色上的淡彩、整体光色偏移、额外的雾、积雪
const SEASON_LOOK = [
  { wash: [0.86, 1.08, 0.86], washAmt: 0.45, tint: [1.00, 1.00, 0.98], fog: 0.05, snow: 0 },
  { wash: [0.72, 1.10, 0.78], washAmt: 0.38, tint: [1.02, 1.02, 0.96], fog: 0.00, snow: 0 },
  { wash: [1.30, 0.94, 0.58], washAmt: 0.6, tint: [1.04, 0.98, 0.90], fog: 0.05, snow: 0 },
  { wash: [0.90, 0.95, 1.06], washAmt: 0.40, tint: [0.96, 0.99, 1.06], fog: 0.10, snow: 1 },
];

const v3 = a => new THREE.Vector3(...a);

export const env = {
  uniforms: {
    uTint: { value: v3([1, 1, 1]) },
    uFogColor: { value: v3([1, 1, 1]) },
    uFog: { value: 0 },
    uNight: { value: 0 },
    uSeasonColor: { value: v3([1, 1, 1]) },
    uSeasonAmt: { value: 0 },
    uSnow: { value: 0 },
    uSunDir: { value: v3([0, 0, 1]) },
    uSunStrength: { value: 0 },
    uLampColor: { value: v3([2.2, 1.3, 0.55]) },
  },
};

function sampleDay(hour) {
  let i = 0;
  while (DAY[i + 1][0] < hour) i++;
  const [h0, ...a] = DAY[i], [h1, ...b] = DAY[i + 1];
  const t = (hour - h0) / (h1 - h0);
  const mix = (x, y) => Array.isArray(x) ? x.map((v, k) => v + (y[k] - v) * t) : x + (y - x) * t;
  const [tint, fogColor, fog, night] = a.map((x, k) => mix(x, b[k]));
  return { tint, fogColor, fog, night };
}

// 太阳 6~18 点、月亮 18~6 点从左往右划过画面上方；返回弧上的角度（0~π）
const arc = (hour, rise) => ((hour - rise + 24) % 24) / 12 * Math.PI;
const skyPosition = a => new THREE.Vector3(-Math.cos(a) * 0.6, 0.6 + Math.sin(a) * 0.2, 0.22);

function targetLook(hour, season) {
  const day = sampleDay(hour);
  const look = SEASON_LOOK[season];
  const sun = arc(hour, 6), moon = arc(hour, 18);
  const lightAngle = sun <= Math.PI ? sun : moon;
  return {
    tint: day.tint.map((v, k) => v * look.tint[k]),
    fogColor: day.fogColor,
    fog: Math.min(day.fog + look.fog, 0.75),
    night: day.night,
    wash: look.wash,
    washAmt: look.washAmt * (1 - day.night * 0.6),
    snow: look.snow,
    sunDir: [-Math.cos(lightAngle) * 0.9, 0.35, 0.3 + Math.sin(lightAngle)],
    sunStrength: sun <= Math.PI ? 0.6 : 0.25,
    sunAlpha: sun <= Math.PI ? Math.min(Math.sin(sun) * 6, 1) : 0,
    moonAlpha: moon <= Math.PI ? Math.min(Math.sin(moon) * 6, 1) : 0,
    sunPos: skyPosition(Math.min(sun, Math.PI)),
    moonPos: skyPosition(Math.min(moon, Math.PI)),
  };
}

function discTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 朱红的日、带光晕的月
function createSkyBodies() {
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    transparent: true, depthWrite: false,
    map: discTexture(ctx => {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(196,52,36,1)');
      g.addColorStop(0.55, 'rgba(183,58,42,1)');
      g.addColorStop(0.62, 'rgba(183,58,42,0.25)');
      g.addColorStop(1, 'rgba(183,58,42,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }),
  }));
  sun.scale.setScalar(0.16);

  const moon = new THREE.Sprite(new THREE.SpriteMaterial({
    transparent: true, depthWrite: false,
    map: discTexture(ctx => {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(250,244,222,1)');
      g.addColorStop(0.36, 'rgba(244,236,210,1)');
      g.addColorStop(0.42, 'rgba(230,226,240,0.35)');
      g.addColorStop(1, 'rgba(200,210,240,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }),
  }));
  moon.scale.setScalar(0.26);
  return { sun, moon };
}

// ===== 飘落物：春花瓣、夏萤火、秋叶、冬雪 =====
const PARTICLE_COUNT = [80, 60, 50, 280];

const particleVertex = /* glsl */`
  attribute vec4 aSeed;
  uniform float uTime, uType, uSize, uViewportHeight;
  varying float vSeed, vAngle, vBlink;
  void main() {
    vec3 p;
    float t = uTime;
    if (uType == 1.0) {
      p = vec3(aSeed.x - 0.5 + 0.06 * sin(t * 0.6 + aSeed.w * 20.0),
               aSeed.y * 0.8 - 0.45 + 0.05 * sin(t * 0.45 + aSeed.w * 13.0),
               0.04 + aSeed.z * 0.3 + 0.03 * sin(t * 0.8 + aSeed.w * 7.0));
    } else {
      float speed = uType == 3.0 ? 0.07 : 0.05;
      float y = 0.62 - mod(aSeed.y * 1.3 + t * speed * (0.7 + 0.6 * aSeed.w), 1.3);
      float sway = sin(t * (0.8 + aSeed.w) + aSeed.x * 30.0) * (uType == 3.0 ? 0.02 : 0.05);
      p = vec3(aSeed.x * 1.2 - 0.6 + sway, y, 0.03 + aSeed.z * 0.42);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float scale = length(modelViewMatrix[0].xyz);
    gl_PointSize = uSize * (0.6 + 0.8 * aSeed.w) * scale * projectionMatrix[1][1] * uViewportHeight * 0.5 / -mv.z;
    vSeed = aSeed.w;
    vAngle = t * (aSeed.w - 0.5) * 3.0 + aSeed.x * 6.283;
    vBlink = 0.55 + 0.45 * sin(t * (2.0 + aSeed.w * 2.0) + aSeed.x * 50.0);
  }
`;

const particleFragment = /* glsl */`
  uniform float uType, uAlpha;
  uniform vec3 uTint;
  varying float vSeed, vAngle, vBlink;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float s = sin(vAngle), c = cos(vAngle);
    p = mat2(c, -s, s, c) * p;
    vec3 color;
    float a;
    if (uType == 0.0) {        // 花瓣：略带缺口的椭圆
      a = 1.0 - smoothstep(0.8, 1.0, length(p * vec2(1.7, 1.0)));
      a *= smoothstep(0.0, 0.25, length(p - vec2(0.0, 1.0)));
      color = mix(vec3(0.98, 0.80, 0.84), vec3(0.95, 0.66, 0.72), vSeed) * uTint;
    } else if (uType == 1.0) { // 萤火
      float r = length(p);
      a = (exp(-r * r * 6.0) + 0.6 * (1.0 - smoothstep(0.0, 0.18, r))) * vBlink;
      color = vec3(0.85, 1.0, 0.55);
    } else if (uType == 2.0) { // 叶：两头尖的叶片
      a = 1.0 - smoothstep(0.85, 1.0, abs(p.x) * 2.2 + p.y * p.y);
      color = mix(vec3(0.85, 0.55, 0.18), vec3(0.72, 0.24, 0.12), vSeed) * uTint;
    } else {                   // 雪
      a = 1.0 - smoothstep(0.35, 1.0, length(p));
      color = mix(vec3(1.0), uTint, 0.3);
    }
    if (a < 0.02) discard;
    gl_FragColor = vec4(color, a * uAlpha);
  }
`;

function createParticles() {
  const n = Math.max(...PARTICLE_COUNT);
  const seeds = new Float32Array(n * 4).map(() => Math.random());
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const uniforms = {
    uTime: { value: 0 }, uType: { value: 0 }, uAlpha: { value: 0 },
    uSize: { value: 0.02 }, uViewportHeight: { value: 1000 }, uTint: env.uniforms.uTint,
  };
  const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms, vertexShader: particleVertex, fragmentShader: particleFragment,
    transparent: true, depthWrite: false,
  }));
  points.frustumCulled = false;
  return { points, uniforms };
}

const PARTICLE_SIZE = [0.018, 0.03, 0.03, 0.012];

// 整套氛围：一个 group 挂到当前识别到的画上；每帧 update 时平滑过渡到目标光景
export function createAtmosphere() {
  const group = new THREE.Group();
  const { sun, moon } = createSkyBodies();
  const particles = createParticles();
  group.add(sun, moon, particles.points);

  let target = null, current = null, season = 0, visibleSeason = 0;

  const lerp = (a, b, k) => Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * k)
    : a.isVector3 ? a.clone().lerp(b, k) : a + (b - a) * k;

  return {
    group,
    set(hour, s) {
      target = targetLook(hour, s);
      season = s;
      if (!current) current = target;
    },
    update(dt, time, lift, viewportHeight) {
      const k = 1 - Math.exp(-dt * 6);
      current = Object.fromEntries(Object.entries(current).map(([key, v]) => [key, lerp(v, target[key], k)]));

      const u = env.uniforms;
      u.uTint.value.set(...current.tint);
      u.uFogColor.value.set(...current.fogColor);
      u.uFog.value = current.fog;
      u.uNight.value = current.night;
      u.uSeasonColor.value.set(...current.wash);
      u.uSeasonAmt.value = current.washAmt;
      u.uSnow.value = current.snow;
      u.uSunDir.value.set(...current.sunDir).normalize();
      u.uSunStrength.value = current.sunStrength;

      sun.position.copy(current.sunPos);
      moon.position.copy(current.moonPos);
      sun.material.opacity = current.sunAlpha * lift;
      moon.material.opacity = current.moonAlpha * lift;

      // 换季时先让旧的飘落物淡出，再换成新的
      const pu = particles.uniforms;
      const want = season === visibleSeason ? (season === 1 ? current.night : 1) : 0;
      pu.uAlpha.value += (want * lift - pu.uAlpha.value) * k;
      if (season !== visibleSeason && pu.uAlpha.value < 0.03) visibleSeason = season;
      pu.uType.value = visibleSeason;
      pu.uSize.value = PARTICLE_SIZE[visibleSeason];
      pu.uTime.value = time;
      pu.uViewportHeight.value = viewportHeight;
      particles.points.geometry.setDrawRange(0, PARTICLE_COUNT[visibleSeason]);
    },
  };
}
