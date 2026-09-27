import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MindARThree } from '../vendor/mindar/mindar-image-three.prod.js';
import { PAINTINGS, createPainting } from './painting.js';
import { createAtmosphere, SEASONS } from './atmosphere.js';

const $ = id => document.getElementById(id);
const container = $('app');
const hint = $('hint');

// ===== 时辰与季节 =====
const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const PERIODS = [[5, '夜'], [7, '清晨'], [11, '上午'], [13, '正午'], [17, '下午'], [19.5, '黄昏'], [24, '夜']];
const seasonOfMonth = m => [3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3][m];

const atmosphere = createAtmosphere();
const state = { hour: 12, season: 0, followClock: true };

function applyTime() {
  const { hour, season } = state;
  const h = Math.floor(hour) % 24, m = Math.round((hour % 1) * 60);
  $('shichen').textContent = `${SHICHEN[Math.floor(((hour + 1) % 24) / 2)]}时 · ${PERIODS.find(([end]) => hour < end)[1]}`;
  $('clock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  $('hour').value = hour;
  document.querySelectorAll('#seasons button').forEach((b, i) => b.classList.toggle('on', i === season));
  $('now').classList.toggle('on', state.followClock);
  atmosphere.set(hour, season);
}

function syncClock() {
  const d = new Date();
  state.hour = d.getHours() + d.getMinutes() / 60;
  state.season = seasonOfMonth(d.getMonth());
  applyTime();
}

$('hour').addEventListener('input', e => {
  state.hour = +e.target.value;
  state.followClock = false;
  applyTime();
});
$('seasons').innerHTML = SEASONS.map(s => `<button type="button" class="pill">${s}</button>`).join('');
document.querySelectorAll('#seasons button').forEach((b, i) => b.addEventListener('click', () => {
  state.season = i;
  state.followClock = false;
  applyTime();
}));
$('now').addEventListener('click', () => {
  state.followClock = true;
  syncClock();
});
setInterval(() => state.followClock && syncClock(), 30000);
syncClock();

// ===== 画面 =====
const paper = await fetch('./assets/paper.json').then(r => r.json());
const paintings = PAINTINGS.map((_, i) => createPainting(i, paper[i + 1]));

// 浮起动画：lift 从 0 走到 1，各层依次弹起的节奏在着色器里
const LIFT_MS = 2200;
let active = null, liftStart = 0, lastLost = { painting: null, at: 0 };

function show(index, parent) {
  const p = paintings[index];
  active = p;
  parent.add(atmosphere.group);
  // 短暂丢失又找回（手抖）时不重新播放升起动画
  if (lastLost.painting === p && performance.now() - lastLost.at < 3000) return;
  paintings.forEach(q => { q.lift.value = 0; });
  liftStart = performance.now();
}

function tick(renderer, time, dt) {
  if (active) active.lift.value = Math.min((performance.now() - liftStart) / LIFT_MS, 1);
  atmosphere.update(dt, time, active ? active.lift.value : 0, renderer.domElement.height);
}

function loop(renderer, scene, camera, beforeRender) {
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    beforeRender?.();
    tick(renderer, clock.elapsedTime, dt);
    renderer.render(scene, camera);
  });
}

// ===== 预览模式：没有相机时直接在屏幕上看 =====
function startPreview() {
  document.body.classList.add('preview');
  hint.classList.add('hide');
  container.innerHTML = '';

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 20);
  camera.position.set(0.3, -0.3, 1.9);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.05, 0.1);
  controls.enableDamping = true;
  controls.minDistance = 0.8;
  controls.maxDistance = 6;

  const stage = new THREE.Group();
  paintings.forEach(p => { p.group.visible = false; stage.add(p.group); });
  scene.add(stage);

  // 竖屏时拉远一些，让整幅画放得下
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    const fit = 0.62 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(camera.aspect, 1));
    camera.position.sub(controls.target).setLength(Math.max(fit, 1.9)).add(controls.target);
  };
  addEventListener('resize', resize);
  resize();

  const picker = $('picker');
  picker.innerHTML = PAINTINGS.map((_, i) => `<button type="button" class="pill">${'一二三四五'[i]}</button>`).join('');
  const buttons = [...picker.children];
  const select = i => {
    paintings.forEach((p, k) => { p.group.visible = k === i; });
    buttons.forEach((b, k) => b.classList.toggle('on', k === i));
    show(i, stage);
  };
  buttons.forEach((b, i) => b.addEventListener('click', () => select(i)));
  select(0);

  loop(renderer, scene, camera, () => controls.update());
}

// ===== AR 模式 =====
function showDiag(title, msg, allowPreview) {
  $('diagTitle').textContent = title;
  $('diagMsg').innerHTML = msg;
  $('diagPreview').hidden = !allowPreview;
  $('diag').classList.add('show');
}

$('diagPreview').addEventListener('click', () => {
  $('diag').classList.remove('show');
  startPreview();
});

async function startAR() {
  const mindar = new MindARThree({
    container,
    imageTargetSrc: './targets.mind',
    maxTrack: 1,
    uiScanning: 'no',
    uiError: 'no',
    filterMinCF: 0.0001,
    filterBeta: 0.001,
  });
  const { renderer, scene, camera } = mindar;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  paintings.forEach((p, i) => {
    const anchor = mindar.addAnchor(i);
    anchor.group.add(p.group);
    anchor.onTargetFound = () => {
      hint.classList.add('hide');
      show(i, anchor.group);
    };
    anchor.onTargetLost = () => {
      hint.classList.remove('hide');
      if (active === p) active = null;
      lastLost = { painting: p, at: performance.now() };
    };
  });

  try {
    await mindar.start();
  } catch {
    mindar.ui.hideLoading();
    const wechat = /MicroMessenger/i.test(navigator.userAgent);
    showDiag('相机没有打开',
      wechat ? '请点右上角「···」，选择「在浏览器打开」后再试'
             : '请允许浏览器使用相机，然后刷新页面', true);
    return;
  }
  loop(renderer, scene, camera);
}

const params = new URLSearchParams(location.search);
if (params.has('preview')) {
  startPreview();
} else if (!window.isSecureContext) {
  showDiag('需要 https 地址', '手机浏览器只允许 https 网页使用相机，请使用部署后的 https 网址', true);
} else {
  startAR();
}
