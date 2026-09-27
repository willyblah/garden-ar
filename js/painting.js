import * as THREE from 'three';
import { env } from './atmosphere.js';

// 画面宽 = 1，浮雕最高处离纸面的距离
const RELIEF_HEIGHT = 0.3;
const SEGMENTS = 192;

// lamps：夜里亮灯的位置（uv，左下角为原点）和光晕半径
export const PAINTINGS = [
  { lamps: [[0.63, 0.68, 0.16], [0.1, 0.17, 0.08]] },
  { lamps: [[0.52, 0.61, 0.14]] },
  { lamps: [[0.62, 0.4, 0.15]] },
  { lamps: [[0.87, 0.82, 0.12], [0.78, 0.5, 0.06]] },
  { lamps: [[0.56, 0.3, 0.14]] },
];

const common = /* glsl */`
  uniform sampler2D uColor, uDepth;
  uniform float uLift;
  uniform vec3 uPaper;
  uniform vec3 uLamps[2];
  uniform vec3 uTint, uFogColor, uSeasonColor, uLampColor, uSunDir;
  uniform float uFog, uSeasonAmt, uSnow, uNight, uSunStrength;

  float reliefHeight(vec2 uv) {
    return texture2D(uDepth, uv).b * ${RELIEF_HEIGHT.toFixed(3)} * uLift;
  }

  float inkOf(vec3 c) {
    return clamp(1.0 - dot(c, vec3(0.299, 0.587, 0.114)) / dot(uPaper, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  }

  // 按时辰、季节给原画调色：淡彩、积雪、光照、灯火、雾
  vec3 grade(vec3 c, vec2 uv, float depth, float light, float snowEdge) {
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

const reliefVertex = /* glsl */`
  ${common}
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.z += reliefHeight(uv);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const reliefFragment = /* glsl */`
  ${common}
  varying vec2 vUv;
  void main() {
    vec4 dc = texture2D(uDepth, vUv);
    if (dc.g > 0.5 && uLift > 0.15) discard;

    vec2 e = vec2(2.0 / 512.0, 0.0);
    float hx = reliefHeight(vUv + e.xy) - reliefHeight(vUv - e.xy);
    float hy = reliefHeight(vUv + e.yx) - reliefHeight(vUv - e.yx);
    vec3 n = normalize(vec3(-hx, -hy, 2.0 * e.x));
    // 只让背光面变暗，不提亮受光面，免得冲淡墨色
    float light = clamp(1.0 + uSunStrength * (dot(n, uSunDir) - uSunDir.z), 0.65, 1.0);

    vec3 c = texture2D(uColor, vUv).rgb;
    float snowEdge = inkOf(c) - inkOf(texture2D(uColor, vUv + vec2(0.0, 3.0 / 1024.0)).rgb);
    gl_FragColor = vec4(grade(c, vUv, dc.r, light, snowEdge), 1.0);
  }
`;

// 挖空处露出的底板：纸色里隐约透出原画，压暗一些，像是被前面的景物挡住了光
const backFragment = /* glsl */`
  ${common}
  varying vec2 vUv;
  void main() {
    vec3 c = mix(uPaper, texture2D(uColor, vUv, 3.0).rgb, 0.45);
    gl_FragColor = vec4(grade(c, vUv, texture2D(uDepth, vUv).r, 0.72, 0.0), 1.0);
  }
`;

export function createPainting(index, paper) {
  const loader = new THREE.TextureLoader();
  const color = loader.load(`./assets/${index + 1}-color.jpg`);
  const depth = loader.load(`./assets/${index + 1}-depth.png`);
  color.anisotropy = 4;

  const lamps = PAINTINGS[index].lamps.map(l => new THREE.Vector3(...l));
  while (lamps.length < 2) lamps.push(new THREE.Vector3());

  const uniforms = {
    ...env.uniforms,
    uColor: { value: color },
    uDepth: { value: depth },
    uLift: { value: 0 },
    uPaper: { value: new THREE.Vector3(...paper.map(v => v / 255)) },
    uLamps: { value: lamps },
  };
  const material = fragmentShader => new THREE.ShaderMaterial({
    uniforms, vertexShader: reliefVertex, fragmentShader, side: THREE.DoubleSide,
  });

  const group = new THREE.Group();

  const back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material(backFragment));
  back.position.z = -0.004;

  const relief = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, SEGMENTS, SEGMENTS), material(reliefFragment));
  relief.frustumCulled = false;

  group.add(back, relief);
  return { group, lift: uniforms.uLift };
}
