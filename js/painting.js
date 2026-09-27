import * as THREE from 'three';
import { env } from './atmosphere.js';

// 像纸雕一样的层叠浮雕：纸面之上 LEVELS 层卡纸，每层都整张落在下一层上。
// 层的形状来自 assets/N-relief.png 的 G 通道，侧壁来自 N-walls.json（都由 tools/prep.py 生成）。
const LEVELS = 5;
const STEP = 0.034;    // 每层卡纸的高度（画面宽 = 1）
const STAGGER = 0.3;   // 升起时下一层比上一层晚多少（以单层升起时长为单位）

// lamps：夜里亮灯的位置（uv，左下角为原点）和光晕半径
export const PAINTINGS = [
  { lamps: [[0.63, 0.68, 0.16], [0.1, 0.17, 0.08]] },
  { lamps: [[0.52, 0.61, 0.14]] },
  { lamps: [[0.62, 0.4, 0.15]] },
  { lamps: [[0.87, 0.82, 0.12], [0.78, 0.5, 0.06]] },
  { lamps: [[0.56, 0.3, 0.14]] },
];

const common = /* glsl */`
  #define LEVELS ${LEVELS}.0
  uniform sampler2D uColor, uRelief;
  uniform float uLift;
  uniform vec3 uPaper;
  uniform vec3 uLamps[2];
  uniform vec3 uTint, uFogColor, uSeasonColor, uLampColor, uSunDir;
  uniform float uFog, uSeasonAmt, uSnow, uNight, uSunStrength;

  float levelAt(vec2 uv) { return texture2D(uRelief, uv).g * LEVELS; }

  // 一层一层依次弹起：每层先冲过头一点再落回
  float rise(float j) {
    float t = clamp(uLift * (1.0 + ${STAGGER} * (LEVELS - 1.0)) - ${STAGGER} * (j - 1.0), 0.0, 1.0) - 1.0;
    return 1.0 + 2.2 * t * t * t + 1.2 * t * t;
  }

  float heightOf(float level) {
    float h = 0.0;
    for (int j = 1; j <= ${LEVELS}; j++) {
      h += ${STEP} * rise(float(j)) * clamp(level - float(j) + 1.0, 0.0, 1.0);
    }
    return h;
  }

  float inkOf(vec3 c) {
    return clamp(1.0 - dot(c, vec3(0.299, 0.587, 0.114)) / dot(uPaper, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  }

  // 按时辰、季节给原画调色：淡彩、积雪、光照、灯火、雾
  vec3 grade(vec3 c, vec2 uv, float light, float snowEdge) {
    float depth = texture2D(uRelief, uv).r;
    float ink = inkOf(c);
    c *= mix(vec3(1.0), uSeasonColor, smoothstep(0.05, 0.45, ink) * uSeasonAmt);
    c = mix(c, vec3(0.95, 0.96, 0.98), (1.0 - ink) * uSnow * 0.3);
    c = mix(c, vec3(0.97, 0.98, 1.0), smoothstep(0.06, 0.3, snowEdge) * uSnow * 0.85);

    float lamp = 0.0;
    for (int i = 0; i < 2; i++) {
      vec3 l = uLamps[i];
      if (l.z > 0.0) lamp += exp(-dot(uv - l.xy, uv - l.xy) / (l.z * l.z));
    }
    c *= uTint * light + uLampColor * lamp * uNight;
    return mix(c, uFogColor, uFog * pow(1.0 - depth, 1.5));
  }
`;

// ===== 每层的正面 =====
const capVertex = /* glsl */`
  ${common}
  uniform float uLevel;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.z = heightOf(uLevel) + uLevel * 0.0004;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const capFragment = /* glsl */`
  ${common}
  uniform float uLevel;
  varying vec2 vUv;

  // 顺着光线往回找，被更高的层挡住就落在阴影里
  float sunShadow(vec2 uv, float h0) {
    vec3 d = uSunDir;
    float reach = (heightOf(LEVELS) - h0) / max(d.z, 0.2);
    float shade = 0.0;
    for (int i = 1; i <= 10; i++) {
      float t = reach * float(i) / 10.0;
      vec2 p = uv + d.xy * t;
      float over = heightOf(levelAt(p)) - (h0 + d.z * t);
      shade = max(shade, smoothstep(0.0, 0.012, over) * (1.0 - float(i) / 14.0));
    }
    return shade;
  }

  void main() {
    vec4 rel = texture2D(uRelief, vUv);
    float level = rel.g * LEVELS;
    // 只画属于这一层的部分；往上多留一圈压在上一层底下，免得接缝处漏光
    if (level < uLevel - 0.5 || level > uLevel + 0.85) discard;

    float h0 = heightOf(uLevel);
    float light = 1.0 - 0.5 * uSunStrength * sunShadow(vUv, h0);
    // 层脚处被周围更高的层挡住些天光
    light *= 1.0 - 0.3 * smoothstep(0.0, 1.2, rel.b * LEVELS - level) * uLift;
    // 越低的层越暗一点，拉开前后
    light *= 0.9 + 0.1 * uLevel / LEVELS;

    vec3 c = texture2D(uColor, vUv).rgb;
    float snowEdge = inkOf(c) - inkOf(texture2D(uColor, vUv + vec2(0.0, 3.0 / 1024.0)).rgb);
    gl_FragColor = vec4(grade(c, vUv, clamp(light, 0.55, 1.0), snowEdge), 1.0);
  }
`;

// ===== 层与层之间的侧壁：卡纸的切口 =====
const wallVertex = /* glsl */`
  ${common}
  attribute float aLevel, aTop;
  varying vec2 vUv;
  varying float vTop;
  void main() {
    vUv = uv;
    vTop = aTop;
    vec3 p = position;
    p.z = mix(heightOf(aLevel - 1.0), heightOf(aLevel), aTop) + aLevel * 0.0004;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const wallFragment = /* glsl */`
  ${common}
  varying vec2 vUv;
  varying float vTop;
  void main() {
    // 侧壁朝外的方向：层号下降最快的方向
    vec2 e = vec2(3.0 / 1024.0, 0.0);
    vec2 g = vec2(levelAt(vUv + e.xy) - levelAt(vUv - e.xy), levelAt(vUv + e.yx) - levelAt(vUv - e.yx));
    vec3 n = vec3(-g / max(length(g), 1e-4), 0.0);

    float facing = dot(n, uSunDir);
    float light = mix(1.0, 0.72 + 0.4 * facing, uSunStrength + 0.3);
    light *= mix(0.74, 1.0, smoothstep(0.0, 0.8, vTop));   // 贴近下一层处暗一些
    light += 0.08 * smoothstep(0.85, 1.0, vTop);            // 切口上沿的一线亮边

    // 切口是纸的本色，只透出一点点墨色
    vec3 c = mix(uPaper * 1.06, texture2D(uColor, vUv, 2.0).rgb, 0.25);
    gl_FragColor = vec4(grade(c, vUv, clamp(light, 0.45, 1.1), 0.0), 1.0);
  }
`;

function wallGeometry({ walls }) {
  const pos = [], uv = [], level = [], top = [], index = [];
  for (const [k, ...flat] of walls) {
    const base = pos.length / 3;
    const n = flat.length / 2;
    for (let i = 0; i < n; i++) {
      const u = flat[2 * i] / 4096, v = flat[2 * i + 1] / 4096;
      for (const t of [0, 1]) {
        pos.push(u - 0.5, v - 0.5, 0);
        uv.push(u, v);
        level.push(k);
        top.push(t);
      }
      if (i > 0) {
        const a = base + 2 * (i - 1), b = base + 2 * i;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('aLevel', new THREE.Float32BufferAttribute(level, 1));
  geometry.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
  geometry.setIndex(index);
  return geometry;
}

export function createPainting(index, paper) {
  const loader = new THREE.TextureLoader();
  const color = loader.load(`./assets/${index + 1}-color.jpg`);
  color.anisotropy = 4;
  // 层号贴图按阈值取形状，不能用 mipmap，否则远看时层的边缘会缩进去
  const relief = loader.load(`./assets/${index + 1}-relief.png`);
  relief.generateMipmaps = false;
  relief.minFilter = THREE.LinearFilter;

  const lamps = PAINTINGS[index].lamps.map(l => new THREE.Vector3(...l));
  while (lamps.length < 2) lamps.push(new THREE.Vector3());

  const uniforms = {
    ...env.uniforms,
    uColor: { value: color },
    uRelief: { value: relief },
    uLift: { value: 0 },
    uPaper: { value: new THREE.Vector3(...paper.map(v => v / 255)) },
    uLamps: { value: lamps },
  };

  const group = new THREE.Group();
  const plane = new THREE.PlaneGeometry(1, 1);
  for (let k = 0; k <= LEVELS; k++) {
    const cap = new THREE.Mesh(plane, new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uLevel: { value: k } },
      vertexShader: capVertex, fragmentShader: capFragment, side: THREE.DoubleSide,
    }));
    cap.frustumCulled = false;
    cap.renderOrder = LEVELS - k;   // 先画上层，下层被挡住的部分省掉
    group.add(cap);
  }

  fetch(`./assets/${index + 1}-walls.json`).then(r => r.json()).then(data => {
    const walls = new THREE.Mesh(wallGeometry(data), new THREE.ShaderMaterial({
      uniforms, vertexShader: wallVertex, fragmentShader: wallFragment, side: THREE.DoubleSide,
    }));
    walls.frustumCulled = false;
    group.add(walls);
  });

  return { group, lift: uniforms.uLift };
}
