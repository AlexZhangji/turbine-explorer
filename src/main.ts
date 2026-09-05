import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createTurbineModel, rotateRotor, updateFlow } from './turbine';
import { TurbineAudio } from './audio';
import { serviceInterlock, serviceTarget, servicePose } from './service-state';
import { installComponentInspector } from './component-inspector';
import { installLanguage } from './i18n';
import { installExhibition } from './exhibition';
import { RATED_POWER_MW, energyKWh } from './energy';
import { createOperatingEffects } from './operating-effects';
import './style.css';
import './typography.css';
import { renderPixelRatio, onRenderQuality } from './render-quality';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('Canvas not found');
const pageParams = new URLSearchParams(window.location.search);
const filmPresentation = pageParams.get('presentation') !== 'console';
if (filmPresentation) document.body.classList.add('film-presentation');
// Keep the existing controls and listeners, but lay panels out in one scrollable rail.
const consoleStack = document.createElement('aside');
consoleStack.className = 'console-stack';
consoleStack.setAttribute('aria-label', '运行参数与发电量');
for (const selector of ['.motion-panel', '.generation-panel', '.spec-panel']) {
  const panel = document.querySelector(selector);
  if (panel) consoleStack.append(panel);
}
document.querySelector('#app')?.append(consoleStack);
const captureSize = pageParams.get('capture') === '1' ? { width: 1440, height: 840 } : null;
let compareSplitActive = false;
const fullSurfaceWidth = () => captureSize?.width ?? window.innerWidth;
const surfaceWidth = () => fullSurfaceWidth();
const surfaceHeight = () => captureSize?.height ?? window.innerHeight;
if (captureSize) {
  document.documentElement.style.width = `${captureSize.width}px`;
  document.documentElement.style.height = `${captureSize.height}px`;
  document.body.style.width = `${captureSize.width}px`;
  document.body.style.height = `${captureSize.height}px`;
  const app = document.querySelector<HTMLElement>('#app');
  if (app) {
    app.style.width = `${captureSize.width}px`;
    app.style.height = `${captureSize.height}px`;
  }
  canvas.style.position = 'absolute';
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
RectAreaLightUniformsLib.init();
renderer.setPixelRatio(renderPixelRatio(surfaceWidth(), surfaceHeight()));
renderer.setSize(surfaceWidth(), surfaceHeight());
renderer.shadowMap.enabled = pageParams.get('shadows') !== '0';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = null;
const sceneFog = new THREE.FogExp2(0x071018, .0105);
scene.fog = sceneFog;

const camera = new THREE.PerspectiveCamera(32, surfaceWidth() / surfaceHeight(), .1, 120);
camera.position.set(-11.2, 6.2, 18.2);
const updateCameraFraming = () => {
  const aspect = surfaceWidth() / surfaceHeight();
  const designAspect = 1.6;
  const designFov = THREE.MathUtils.degToRad(32);
  camera.fov = aspect >= designAspect
    ? 32
    : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(designFov / 2) * designAspect / aspect));
  const appClasses = document.querySelector('#app')?.classList;
  const railVisible = !appClasses?.contains('clean-view') && !appClasses?.contains('console-hidden');
  if (railVisible && surfaceWidth() > 900 && !captureSize) {
    const railSpace = 324;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      * surfaceWidth() / (surfaceWidth() - railSpace)));
    camera.setViewOffset(surfaceWidth(), surfaceHeight(), railSpace / 2, 0, surfaceWidth(), surfaceHeight());
  } else if (appClasses?.contains('exhibition-mode')) {
    camera.clearViewOffset();
  } else camera.clearViewOffset();
  camera.updateProjectionMatrix();
};
updateCameraFraming();

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = .075;
controls.minDistance = 10;
controls.maxDistance = 48;
controls.zoomSpeed = .55;
controls.rotateSpeed = .62;
controls.enablePan = true;
controls.panSpeed = .52;
controls.screenSpacePanning = true;
controls.zoomToCursor = true;
controls.target.set(.5, .1, 0);
controls.autoRotate = false;

function createTurbineStudioEnvironment(highKey = false) {
  const environment = new THREE.Scene();
  environment.background = new THREE.Color(highKey ? 0xe7e9e6 : 0x737b7e);

  const ambientWrap = new THREE.Mesh(
    new THREE.SphereGeometry(24, 48, 24),
    new THREE.MeshBasicMaterial({ color: highKey ? 0x555c60 : 0x7d8588, side: THREE.BackSide }),
  );
  environment.add(ambientWrap);

  const card = (
    color: number,
    width: number,
    height: number,
    position: THREE.Vector3Tuple,
    rotation: THREE.Euler,
  ) => {
    const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(...position);
    mesh.rotation.copy(rotation);
    environment.add(mesh);
  };

  // The clean reference view uses a high-key product studio. Broad white cards
  // form long gradients, while two medium cards preserve the dark rotor read.
  card(highKey ? 0xffffff : 0xd7dad8, 20, 6.4, [0, 7, 1], new THREE.Euler(Math.PI / 2, 0, 0));
  card(highKey ? 0xf4f5f3 : 0xb5c0c3, 20, 5.2, [0, 1.5, 7], new THREE.Euler(0, 0, 0));
  card(highKey ? 0x454a4b : 0x98a3a7, 17, 3.4, [0, .2, -7], new THREE.Euler(0, 0, 0));
  card(highKey ? 0xf8f8f5 : 0xc3c3bd, 7, 6, [-9, 1.2, 0], new THREE.Euler(0, Math.PI / 2, 0));
  card(highKey ? 0x4f5556 : 0x9ba9ae, 7, 4.4, [10, 2.4, -1], new THREE.Euler(0, Math.PI / 2, 0));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 22),
    new THREE.MeshBasicMaterial({ color: highKey ? 0x555b5d : 0x596266, side: THREE.DoubleSide }),
  );
  ground.position.y = -6;
  ground.rotation.x = -Math.PI / 2;
  environment.add(ground);
  return environment;
}

const pmrem = new THREE.PMREMGenerator(renderer);
const environment = createTurbineStudioEnvironment();
const cleanEnvironment = createTurbineStudioEnvironment(true);
const cardEnvironment = pmrem.fromScene(environment, .11).texture;
const cleanCardEnvironment = pmrem.fromScene(cleanEnvironment, .025).texture;
scene.environment = cleanCardEnvironment;
scene.environmentRotation.set(.02, -.38, 0);
scene.environmentIntensity = .76;
const disposeEnvironmentScene = (environmentScene: THREE.Scene) => environmentScene.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  object.geometry.dispose();
  if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
  else object.material.dispose();
});
disposeEnvironmentScene(environment);
disposeEnvironmentScene(cleanEnvironment);

const environmentMode = pageParams.get('env');
const environmentRotationDegrees = Number(pageParams.get('envrot') ?? 100);
const environmentRotationY = THREE.MathUtils.degToRad(Number.isFinite(environmentRotationDegrees) ? environmentRotationDegrees : 100);
const useCardEnvironment = !environmentMode || environmentMode === 'cards' || pageParams.get('blockout') === '1';
let hdrEnvironmentTexture: THREE.Texture | null = null;
if (useCardEnvironment) {
  pmrem.dispose();
} else {
  const hdrUrl = environmentMode === 'contrast'
    ? '/environment/studio_kontrast_02_1k.hdr'
    : '/environment/poly_haven_studio_1k.hdr';
  new RGBELoader()
    .setDataType(THREE.HalfFloatType)
    .load(
      hdrUrl,
      (texture) => {
        const hdrEnvironment = pmrem.fromEquirectangular(texture).texture;
        texture.dispose();
        hdrEnvironmentTexture = hdrEnvironment;
        if (!cleanViewActive) {
          scene.environment = hdrEnvironment;
          scene.environmentRotation.set(0, environmentRotationY, 0);
          scene.environmentIntensity = .9;
        }
        pmrem.dispose();
        document.querySelector('#app')?.setAttribute('data-environment', 'studio-hdr');
      },
      undefined,
      (error) => {
        console.warn('Studio HDR failed to load, retaining procedural reflection cards.', error);
        pmrem.dispose();
        document.querySelector('#app')?.setAttribute('data-environment', 'procedural-cards');
      },
    );
}

const hemi = new THREE.HemisphereLight(0xc4d5dc, 0x48545a, .32);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xeaf7ff, .54);
key.position.set(-5, 10, 8);
key.castShadow = true;
key.shadow.mapSize.set(1536, 1536);
key.shadow.camera.left = -12;
key.shadow.camera.right = 12;
key.shadow.camera.top = 8;
key.shadow.camera.bottom = -8;
key.shadow.bias = -.00025;
key.shadow.normalBias = .035;
key.shadow.camera.near = .5;
key.shadow.camera.far = 45;
scene.add(key);
const rim = new THREE.DirectionalLight(0x91cbe2, .26);
rim.position.set(9, 2, -9);
scene.add(rim);
const inletFill = new THREE.DirectionalLight(0xe2edf2, .1);
inletFill.position.set(-12, 1.5, 5);
scene.add(inletFill);
const bladeRake = new THREE.DirectionalLight(0xc3dce7, .1);
bladeRake.position.set(-2.5, 1.2, 10);
scene.add(bladeRake);
const studioStrip = new THREE.RectAreaLight(0xe7f2f7, 1.15, 15, 5.8);
studioStrip.position.set(-1.4, 7.4, 7.8);
studioStrip.lookAt(.4, -.4, 0);
scene.add(studioStrip);
const sideStrip = new THREE.RectAreaLight(0x9bcfe2, .58, 11, 3.2);
sideStrip.position.set(6.8, 2.6, -7.2);
sideStrip.lookAt(1.1, -.2, 0);
scene.add(sideStrip);
const underFill = new THREE.DirectionalLight(0x668da2, .035);
underFill.position.set(-4, -5, 6);
scene.add(underFill);
const warm = new THREE.PointLight(0xffe7cf, .22, 12, 1.5);
warm.position.set(2.6, 0, -2.4);
scene.add(warm);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 36),
  new THREE.MeshPhysicalMaterial({ color: 0x071018, roughness: .62, metalness: .34, transparent: true, opacity: .84 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -3.55;
floor.receiveShadow = true;
scene.add(floor);
floor.visible = false;

const grid = new THREE.GridHelper(42, 42, 0x315a70, 0x172b38);
grid.position.y = -3.53;
grid.material.transparent = true;
grid.material.opacity = .34;
scene.add(grid);
grid.visible = false;

const model = createTurbineModel();
model.root.position.y = -.18;
model.casing.visible = false;
scene.add(model.root);

// Dashed assembly guides are annotations, never stretched service pipes.
const assemblyGuides = model.combustorModules.map(module => {
  const socket = new THREE.Vector3(1.85, 2.67, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), module.rotation.x);
  const geometry = new THREE.BufferGeometry().setFromPoints([socket, socket]);
  const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: 0x97aeb8, dashSize: .1, gapSize: .08, transparent: true, opacity: .65 }));
  line.name = `${module.name}-assembly-guide`;
  line.visible = false;
  model.combustion.add(line);
  return { module, socket, line };
});

if (pageParams.get('blockout') === '1') {
  const neutralMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b9296,
    roughness: .72,
    metalness: 0,
  });
  model.root.traverse((object) => {
    if (object instanceof THREE.Mesh) object.material = neutralMaterial;
  });
}

const renderTarget = new THREE.WebGLRenderTarget(surfaceWidth(), surfaceHeight(), { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, renderTarget);
composer.addPass(new RenderPass(scene, camera));
const ssao = new SSAOPass(scene, camera, surfaceWidth(), surfaceHeight());
ssao.kernelRadius = pageParams.get('ao') === '0' ? 0 : 6;
ssao.minDistance = .0015;
ssao.maxDistance = .075;
composer.addPass(ssao);
composer.addPass(new OutputPass());

const syncSurfaceLayout = () => {
  const width = surfaceWidth();
  const height = surfaceHeight();
  camera.aspect = width / height;
  updateCameraFraming();
  renderer.setPixelRatio(renderPixelRatio(width, height));
  composer.setPixelRatio(renderer.getPixelRatio());
  renderer.setSize(width, height);
  composer.setSize(width, height);
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
};

onRenderQuality(syncSurfaceLayout);
const state = {
  spin: !captureSize,
  casing: false,
  flow: false,
  explodeStage: 0,
  labels: false,
  truth: false,
  speedPercent: 35,
  loadPercent: 100,
  kinematicDemo: false,
};
const turbineAudio = new TurbineAudio();
let audioVolumePercent = 25;
function setAudioVolume(percent:number) {
  audioVolumePercent = Math.max(0, Math.min(100, percent));
  turbineAudio.setVolume(audioVolumePercent);
  document.querySelector<HTMLInputElement>('#volume-control')!.value = String(audioVolumePercent);
  document.querySelector('#volume-value')!.textContent = `${audioVolumePercent}%`;
}
document.querySelector<HTMLInputElement>('#volume-control')?.addEventListener('input', event => {
  setAudioVolume(Number((event.target as HTMLInputElement).value));
});
document.querySelector('#audio-preview')?.addEventListener('click', () => {
  void turbineAudio.preview().then(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-action="sound"]')!;
    button.classList.add('active');
    button.setAttribute('aria-pressed', 'true');
    button.innerHTML = '<span>06</span> 声音已开启';
  }).catch(() => { document.querySelector('#audio-status')!.textContent = '音频未启动，请再次点击试听'; });
});
document.querySelector('#speaker-test')?.addEventListener('click', () => {
  void turbineAudio.testSpeakers().then(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-action="sound"]')!;
    button.classList.add('active');
    button.setAttribute('aria-pressed', 'true');
    button.innerHTML = '<span>06</span> 声音已开启';
  }).catch(() => { document.querySelector('#audio-status')!.textContent = '音频未启动，请再次点击试听'; });
});
let serviceBlend = 0;
const serviceInterlocked = () => serviceInterlock(state.explodeStage, serviceBlend);
let activeReviewView = 'reference';

function syncCombustorVisibility() {
  const hideForHotSection = activeReviewView === 'hotpath' && !state.casing && state.explodeStage === 0;
  model.combustorModules.forEach((module) => {
    module.visible = !hideForHotSection
      && (state.casing || Boolean(module.userData.cutawayVisible));
  });
}

function syncHousingUI() {
  document.querySelectorAll<HTMLButtonElement>('[data-housing]').forEach(button => {
    const selected = (button.dataset.housing === 'enclosed') === state.casing;
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelector('#app')?.setAttribute('data-housing', state.casing ? 'enclosed' : 'cutaway');
  document.querySelector('[data-action="casing"]')?.classList.toggle('active', state.casing);
}

function setHousingMode(enclosed: boolean) {
  state.casing = enclosed;
  setServiceStage(0);
  syncHousingUI();
  const url = new URL(window.location.href);
  url.searchParams.set('housing', enclosed ? 'enclosed' : 'cutaway');
  url.searchParams.delete('casing');
  url.searchParams.delete('service');
  window.history.replaceState(null, '', url);
}

document.querySelectorAll<HTMLButtonElement>('[data-housing]').forEach(button => {
  button.addEventListener('click', () => setHousingMode(button.dataset.housing === 'enclosed'));
});

let motionStudyActive = false;
const motionStudyEntries: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; highlighted: THREE.Material | THREE.Material[] }[] = [];
function setMotionStudy(enabled: boolean) {
  if (enabled && motionStudyEntries.length === 0) {
    const register = (object: THREE.Object3D, color: number) => {
      if (!(object instanceof THREE.Mesh)) return;
      const tint = (material: THREE.Material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return material;
        const copy = material.clone();
        copy.color.setHex(color);
        copy.roughness = Math.max(.32, copy.roughness);
        return copy;
      };
      motionStudyEntries.push({ mesh: object, original: object.material,
        highlighted: Array.isArray(object.material) ? object.material.map(tint) : tint(object.material) });
    };
    model.rotor.traverse(object => register(object, 0x488da3));
    model.stator.traverse(object => { if (object.userData.bladeRow) register(object, 0xbd9457); });
  }
  motionStudyActive = enabled;
  motionStudyEntries.forEach(entry => { entry.mesh.material = enabled ? entry.highlighted : entry.original; });
  document.querySelector('[data-motion-study]')?.setAttribute('aria-pressed', String(enabled));
  const legend = document.querySelector<HTMLElement>('.motion-legend');
  if (legend) legend.hidden = !enabled;
  if (enabled) setHousingMode(false);
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.set('study', 'motion');
  else url.searchParams.delete('study');
  window.history.replaceState(null, '', url);
}
document.querySelector('[data-motion-study]')?.addEventListener('click', () => setMotionStudy(!motionStudyActive));

const basePositions = {
  rotor: model.rotor.position.clone(),
  stator: model.stator.position.clone(),
  lowerCasing: model.lowerCasing.position.clone(),
  combustion: model.combustion.position.clone(),
  casing: model.casing.position.clone(),
  compressorCasing: model.casingSections.compressor.position.clone(),
  combustionCasing: model.casingSections.combustion.position.clone(),
  turbineCasing: model.casingSections.turbine.position.clone(),
  exhaust: model.exhaust.position.clone(),
};
const baseRotations = {
  compressorCasing: model.casingSections.compressor.rotation.clone(),
  combustionCasing: model.casingSections.combustion.rotation.clone(),
  turbineCasing: model.casingSections.turbine.rotation.clone(),
};

const speedControl = document.querySelector<HTMLInputElement>('#speed-control');
const speedValue = document.querySelector<HTMLElement>('#speed-value');
const speedState = document.querySelector<HTMLElement>('#speed-state');
const speedLiveBar = document.querySelector<HTMLElement>('#speed-live-bar');
const motionNote = document.querySelector<HTMLElement>('#motion-note');
const kinematicButton = document.querySelector<HTMLButtonElement>('[data-action="kinematic"]');
const generationPanel = document.querySelector<HTMLElement>('.generation-panel');
const generationStatus = document.querySelector<HTMLElement>('#generation-status');
const generationMW = document.querySelector<HTMLElement>('#generation-mw');
const generationKWh = document.querySelector<HTMLElement>('#generation-kwh');
const fuelInput = document.querySelector<HTMLElement>('#fuel-input');
const generationChip = document.querySelector<HTMLElement>('.generation-chip');
const generationChipStatus = document.querySelector<HTMLElement>('#generation-chip-status');
const generationChipMW = document.querySelector<HTMLElement>('#generation-chip-mw');
const generationChipKWh = document.querySelector<HTMLElement>('#generation-chip-kwh');
const generationChipRate = document.querySelector<HTMLElement>('#generation-chip-rate');
const loadControl = document.querySelector<HTMLInputElement>('#load-control');
const loadValue = document.querySelector<HTMLElement>('#load-value');
const speedToRadians = (percent: number) => percent <= 0 ? 0 : .08 + 4.72 * Math.pow(percent / 100, 1.55);
const updateMotionPanel = () => {
  if (speedValue) speedValue.textContent = state.spin || state.kinematicDemo ? `${state.speedPercent}%` : '已暂停';
  kinematicButton?.classList.toggle('active', state.kinematicDemo);
  document.querySelector('.motion-panel')?.classList.toggle('interlocked', serviceInterlocked() && !state.kinematicDemo);
  if (motionNote) {
    motionNote.textContent = state.explodeStage > 0
      ? state.kinematicDemo
        ? '仅演示动静部件关系，展开状态不发电。真实检修时禁止运行。'
        : '结构展开，运行已联锁。可单独开启转动示意，观察哪些部件转动。'
      : serviceBlend > .003 ? '组件正在归位，运行保持锁定。归位后需要手动启动。'
      : '此滑块只改变视觉转速，不是实际转速，也不改变发电负载。';
  }
};

function setServiceStage(stage: number) {
  if (stage > 0 || state.explodeStage > 0) {
    setOperatingCycle(false);
    state.spin = false;
    state.kinematicDemo = false;
    document.querySelector('[data-action="spin"]')?.classList.remove('active');
  }
  state.explodeStage = THREE.MathUtils.clamp(Math.round(stage), 0, 2);
  document.querySelector('#app')?.setAttribute('data-service', String(state.explodeStage));
  model.casing.visible = state.casing;
  syncCombustorVisibility();
  const button = document.querySelector<HTMLButtonElement>('[data-action="explode"]');
  button?.classList.toggle('active', state.explodeStage > 0);
  if (button) {
    button.innerHTML = state.explodeStage === 0
      ? '<span>04</span> 结构展开'
      : state.explodeStage === 1
        ? '<span>04</span> 热端检视'
        : '<span>04</span> 收回组件';
  }
  const serviceStatus = document.querySelector<HTMLElement>('#service-status');
  if (serviceStatus) serviceStatus.dataset.stage = String(state.explodeStage);
  const url = new URL(window.location.href);
  if (state.explodeStage === 0) url.searchParams.delete('service');
  else url.searchParams.set('service', state.explodeStage === 1 ? 'hotpath' : 'major');
  if (!state.flow) url.searchParams.delete('operation');
  url.searchParams.delete('demo');
  window.history.replaceState(null, '', url);
  syncHousingUI();
  updateMotionPanel();
}

function setOperatingCycle(enabled: boolean) {
  enabled = enabled && !serviceInterlocked();
  state.flow = enabled;
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.set('operation', '1');
  else url.searchParams.delete('operation');
  window.history.replaceState(null, '', url);
  model.flow.visible = enabled;
  model.operationGlow.visible = enabled;
  document.querySelector('#service-status')?.classList.toggle('operation', enabled);
  document.querySelector<HTMLButtonElement>('[data-action="flow"]')?.classList.toggle('active', enabled);
  if (enabled) {
    state.spin = true;
    if (state.speedPercent === 0) {
      state.speedPercent = 12;
      if (speedControl) speedControl.value = '12';
    }
    document.querySelector<HTMLButtonElement>('[data-action="spin"]')?.classList.add('active');
  }
}

document.querySelectorAll<HTMLButtonElement>('.control').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'sound') {
      void turbineAudio.toggle().then((enabled) => {
        button.classList.toggle('active', enabled);
        button.setAttribute('aria-pressed', String(enabled));
        button.innerHTML = `<span>06</span> ${enabled ? '声音已开启' : '开启声音'}`;
      }).catch(() => {
        const status = document.querySelector('#audio-status');
        if (status) status.textContent = '音频未启动，请点试听重试';
      });
      return;
    }
    if (action === 'explode') {
      const nextStage = state.explodeStage === 0 ? 2 : 0;
      turbineAudio.serviceTransition(nextStage);
      setServiceStage(nextStage);
      setConsoleHidden(nextStage > 0);
      setReviewView('hero');
      return;
    }
    if (action !== 'spin' && action !== 'casing' && action !== 'flow' && action !== 'labels') return;
    if ((action === 'flow' || action === 'spin') && serviceInterlocked()) return;
    state[action] = !state[action];
    button.classList.toggle('active', state[action]);
    if (action === 'casing') {
      setHousingMode(state.casing);
      turbineAudio.casingTransition(state.casing);
    }
    if (action === 'flow') {
      setOperatingCycle(state.flow);
      turbineAudio.operatingTransition(state.flow);
    }
    if (action === 'spin') {
      if (!state.spin) setOperatingCycle(false);
      turbineAudio.spinTransition(state.spin);
    }
    if (action === 'labels') {
      document.querySelector('#labels')?.classList.toggle('visible', state.labels);
      document.querySelector('#labels')?.setAttribute('aria-hidden', String(!state.labels));
      turbineAudio.uiTap();
    }
    updateMotionPanel();
  });
});

speedControl?.addEventListener('input', () => {
  state.speedPercent = Number(speedControl.value);
  state.spin = state.speedPercent > 0 && !serviceInterlocked();
  if (state.speedPercent === 0) setOperatingCycle(false);
  document.querySelector<HTMLButtonElement>('[data-action="spin"]')?.classList.toggle('active', state.spin);
  turbineAudio.speedSet(state.speedPercent);
  updateMotionPanel();
});
kinematicButton?.addEventListener('click', () => {
  if (state.explodeStage === 0) return;
  state.kinematicDemo = !state.kinematicDemo;
  if (state.kinematicDemo && state.speedPercent === 0) {
    state.speedPercent = 12;
    if (speedControl) speedControl.value = '12';
  }
  turbineAudio.uiTap(.82);
  updateMotionPanel();
});
document.querySelector<HTMLButtonElement>('[data-action="reset-camera"]')?.addEventListener('click', () => {
  turbineAudio.uiTap();
  setReviewView(activeReviewView as keyof typeof reviewMap);
});
loadControl?.addEventListener('input', () => {
  state.loadPercent = Number(loadControl.value);
  if (loadValue) loadValue.textContent = `${state.loadPercent}%`;
  turbineAudio.speedSet(state.loadPercent);
});
updateMotionPanel();

const truthLibrary = document.querySelector<HTMLElement>('.truth-library');
const truthButton = document.querySelector<HTMLButtonElement>('[data-action="truth"]');
const truthClose = document.querySelector<HTMLButtonElement>('.truth-close');
const consoleButton = document.querySelector<HTMLButtonElement>('[data-action="console"]');
const setConsoleHidden = (hidden: boolean) => {
  document.querySelector('#app')?.classList.toggle('console-hidden', hidden);
  consoleStack.inert = hidden || document.querySelector('#app')?.classList.contains('clean-view') === true;
  updateCameraFraming();
  if (!consoleButton) return;
  consoleButton.classList.toggle('active', !hidden);
  consoleButton.textContent = hidden ? '展开参数' : '收起参数';
};
consoleButton?.addEventListener('click', () => {
  const hidden = !document.querySelector('#app')?.classList.contains('console-hidden');
  setConsoleHidden(hidden);
  turbineAudio.uiTap(.9);
});
document.querySelector<HTMLButtonElement>('[data-action="open-console"]')?.addEventListener('click', () => {
  setConsoleHidden(false);
  turbineAudio.uiTap(.94);
});
const setTruthOpen = (open: boolean) => {
  state.truth = open;
  truthLibrary?.classList.toggle('open', open);
  truthLibrary?.setAttribute('aria-hidden', String(!open));
  controls.enabled = !open;
  if (open) document.querySelector('.loading')?.remove();
};
truthButton?.addEventListener('click', () => setTruthOpen(true));
truthClose?.addEventListener('click', () => setTruthOpen(false));
truthLibrary?.addEventListener('click', (event) => {
  if (event.target === truthLibrary) setTruthOpen(false);
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setTruthOpen(false);
});

// Public release links to primary sources without redistributing reference images.
if (new URLSearchParams(window.location.search).get('truth') === '1') setTruthOpen(true);

const requestedService = new URLSearchParams(window.location.search).get('service');
const requestedSpeed = Number(pageParams.get('speed'));
if (Number.isFinite(requestedSpeed) && pageParams.has('speed')) {
  state.speedPercent = THREE.MathUtils.clamp(requestedSpeed, 0, 100);
  state.spin = state.speedPercent > 0;
  if (speedControl) speedControl.value = String(state.speedPercent);
}
const requestedLoad = Number(pageParams.get('load'));
if (Number.isFinite(requestedLoad) && pageParams.has('load')) {
  state.loadPercent = THREE.MathUtils.clamp(requestedLoad, 30, 100);
  if (loadControl) loadControl.value = String(state.loadPercent);
  if (loadValue) loadValue.textContent = `${state.loadPercent}%`;
}
if (pageParams.get('demo') === '1') state.kinematicDemo = true;
if (requestedService === 'hotpath') setServiceStage(1);
if (requestedService === 'major') setServiceStage(2);
if (pageParams.get('operation') === '1') setOperatingCycle(true);
if (pageParams.get('casing') === '1' || pageParams.get('housing') === 'enclosed') {
  state.casing = true;
  model.casing.visible = true;
  model.combustorModules.forEach((module) => { module.visible = true; });
  document.querySelector<HTMLButtonElement>('[data-action="casing"]')?.classList.add('active');
}
syncHousingUI();
updateMotionPanel();

const cameraGoal = camera.position.clone();
const targetGoal = controls.target.clone();
let cameraTransitionActive = false;
controls.addEventListener('start', () => {
  cameraTransitionActive = false;
});
const reviewMap = {
  reference: { camera: new THREE.Vector3(-10.45, 6.95, 17), target: new THREE.Vector3(.45, -.12, 0) },
  hero: { camera: new THREE.Vector3(-10.6, 7.9, 21.5), target: new THREE.Vector3(.45, -.1, 0) },
  axial: { camera: new THREE.Vector3(-22.5, 5.5, -3.4), target: new THREE.Vector3(-4, -.3, 0) },
  opposite: { camera: new THREE.Vector3(10.2, 5.65, 13.9), target: new THREE.Vector3(.65, -.05, 0) },
  hotpath: { camera: new THREE.Vector3(1.05, 3.75, 9.15), target: new THREE.Vector3(2.9, .02, 0) },
} satisfies Record<string, { camera: THREE.Vector3; target: THREE.Vector3 }>;

function setReviewView(name: keyof typeof reviewMap) {
  const view = reviewMap[name];
  activeReviewView = name;
  const aspect = surfaceWidth() / surfaceHeight();
  const narrowDistanceScale = aspect < 1.25 ? 1.1 : 1;
  cameraGoal.copy(view.camera)
    .sub(view.target)
    .multiplyScalar(narrowDistanceScale)
    .add(view.target);
  targetGoal.copy(view.target);
  if (state.explodeStage > 0 && name !== 'hotpath' && name !== 'axial') {
    cameraGoal.sub(targetGoal).multiplyScalar(state.casing ? 1.65 : 1.23).add(targetGoal);
    const serviceElevation = state.casing ? 1.1 : -.9;
    cameraGoal.y += serviceElevation;
    targetGoal.y += serviceElevation;
  }
  cameraTransitionActive = true;
  controls.autoRotate = false;
  syncCombustorVisibility();
  document.querySelectorAll<HTMLButtonElement>('[data-review]').forEach((button) => {
    button.classList.toggle('active', button.dataset.review === name);
  });
}
canvas.addEventListener('dblclick', () => setReviewView(activeReviewView as keyof typeof reviewMap));

document.querySelectorAll<HTMLButtonElement>('[data-review]').forEach((button) => {
  button.addEventListener('click', () => {
    const name = button.dataset.review as keyof typeof reviewMap;
    if (reviewMap[name]) {
      turbineAudio.uiTap(.92);
      setReviewView(name);
    }
  });
});

const compareReference = document.querySelector<HTMLElement>('.compare-reference');
const compareButton = document.querySelector<HTMLButtonElement>('[data-action="compare"]');
const compareHandle = document.querySelector<HTMLButtonElement>('[data-action="compare-handle"]');
const compareReferenceLabel = document.querySelector<HTMLElement>('.compare-side-reference');
const compareLiveLabel = document.querySelector<HTMLElement>('.compare-side-live');
let comparePercent = THREE.MathUtils.clamp(Number(pageParams.get('split') ?? 50), 0, 100);

const setComparePercent = (value: number) => {
  comparePercent = THREE.MathUtils.clamp(value, 0, 100);
  compareReference?.style.setProperty('--compare-split', `${comparePercent}%`);
  compareHandle?.setAttribute('aria-valuenow', String(Math.round(comparePercent)));
  if (compareReferenceLabel) compareReferenceLabel.style.opacity = comparePercent < 8 ? '0' : '1';
  if (compareLiveLabel) compareLiveLabel.style.opacity = comparePercent > 92 ? '0' : '1';
};

const setComparePercentFromPointer = (clientX: number) => {
  const rect = canvas.getBoundingClientRect();
  setComparePercent(((clientX - rect.left) / rect.width) * 100);
};

let compareDragging = false;
compareHandle?.addEventListener('pointerdown', (event) => {
  compareDragging = true;
  compareHandle.setPointerCapture(event.pointerId);
  setComparePercentFromPointer(event.clientX);
  event.preventDefault();
  event.stopPropagation();
});
compareHandle?.addEventListener('pointermove', (event) => {
  if (!compareDragging) return;
  setComparePercentFromPointer(event.clientX);
  event.preventDefault();
  event.stopPropagation();
});
const stopCompareDrag = (event: PointerEvent) => {
  if (!compareDragging) return;
  compareDragging = false;
  if (compareHandle?.hasPointerCapture(event.pointerId)) compareHandle.releasePointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
};
compareHandle?.addEventListener('pointerup', stopCompareDrag);
compareHandle?.addEventListener('pointercancel', stopCompareDrag);
compareHandle?.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 10 : 2;
  if (event.key === 'ArrowLeft') setComparePercent(comparePercent - step);
  else if (event.key === 'ArrowRight') setComparePercent(comparePercent + step);
  else if (event.key === 'Home') setComparePercent(0);
  else if (event.key === 'End') setComparePercent(100);
  else return;
  event.preventDefault();
  event.stopPropagation();
});
setComparePercent(comparePercent);

const setCompareOpen = (open: boolean) => {
  // Reference image comparison belongs to the private research workspace.
  if (open) { setTruthOpen(true); return; }
  compareSplitActive = open;
  compareReference?.classList.toggle('open', open);
  compareReference?.setAttribute('aria-hidden', String(!open));
  compareButton?.classList.toggle('active', open);
  document.querySelector('#app')?.classList.toggle('compare-mode', open);
  if (compareButton) compareButton.textContent = open ? '退出对比' : '图片对比';
  if (open) {
    setReviewView('hero');
    setCleanView(true);
  } else {
    setCleanView(false);
    setReviewView('reference');
  }
  syncSurfaceLayout();
};
compareButton?.addEventListener('click', () => setCompareOpen(!compareReference?.classList.contains('open')));

const cleanButton = document.querySelector<HTMLButtonElement>('[data-action="clean"]');
let cleanViewActive = false;
const setCleanView = (enabled: boolean) => {
  cleanViewActive = enabled;
  document.querySelectorAll<HTMLButtonElement>('[data-experience]').forEach(button => {
    button.setAttribute('aria-pressed', String((button.dataset.experience === 'showcase') === enabled));
  });
  document.querySelector('#app')?.classList.toggle('clean-view', enabled);
  consoleStack.inert = enabled || document.querySelector('#app')?.classList.contains('console-hidden') === true;
  for (const selector of ['.topbar', '.controls', '.legend', '.service-status']) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.inert = enabled;
  }
  updateCameraFraming();
  cleanButton?.classList.toggle('active', enabled);
  const fogBackground = new THREE.Color(enabled ? 0xffffff : 0x071018);
  scene.background = null;
  scene.environment = enabled ? cleanCardEnvironment : (hdrEnvironmentTexture ?? cleanCardEnvironment);
  scene.environmentRotation.set(.02, enabled || !hdrEnvironmentTexture ? -.28 : environmentRotationY, 0);
  scene.environmentIntensity = enabled ? 1.06 : .9;
  sceneFog.color.copy(fogBackground);
  sceneFog.density = enabled ? 0 : .0105;
  renderer.toneMappingExposure = enabled ? 1.06 : 1.08;
  hemi.color.setHex(enabled ? 0xf3f1eb : 0xc4d5dc);
  hemi.groundColor.setHex(enabled ? 0x666b6b : 0x48545a);
  hemi.intensity = enabled ? .2 : .34;
  key.color.setHex(enabled ? 0xfffbf3 : 0xeaf7ff);
  key.intensity = enabled ? .88 : .72;
  rim.color.setHex(enabled ? 0xd9dfe0 : 0x91cbe2);
  rim.intensity = enabled ? .42 : .54;
  inletFill.intensity = enabled ? .2 : .18;
  bladeRake.color.setHex(enabled ? 0xe3e5e2 : 0xc3dce7);
  bladeRake.intensity = enabled ? .18 : .16;
  studioStrip.color.setHex(enabled ? 0xfffdf8 : 0xe7f2f7);
  studioStrip.intensity = enabled ? 1.62 : 3.4;
  sideStrip.color.setHex(enabled ? 0xcfd5d5 : 0x9bcfe2);
  sideStrip.intensity = enabled ? .72 : 1.7;
  underFill.intensity = enabled ? .05 : .07;
  warm.intensity = enabled ? .26 : .34;
  if (pageParams.get('ao') !== '0') {
    ssao.kernelRadius = enabled ? 8 : 6;
    ssao.maxDistance = enabled ? .09 : .075;
  }
  floor.visible = false;
  grid.visible = false;
};
cleanButton?.addEventListener('click', () => {
  turbineAudio.uiTap(.88);
  setCleanView(!document.querySelector('#app')?.classList.contains('clean-view'));
});

// Presentation changes never rebuild the model, audio graph or energy accumulator.
const setExperience = (showcase: boolean) => {
  if (compareSplitActive) setCompareOpen(false);
  setCleanView(showcase);
  document.querySelector('#app')?.classList.toggle('render-only', showcase);
  if (!showcase) setConsoleHidden(false);
  const url = new URL(window.location.href);
  for (const key of ['clean', 'render', 'compare', 'split']) url.searchParams.delete(key);
  url.searchParams.set('experience', showcase ? 'showcase' : 'console');
  history.replaceState(null, '', url);
  turbineAudio.uiTap(.9);
};
document.querySelectorAll<HTMLButtonElement>('[data-experience]').forEach(button => {
  button.addEventListener('click', () => setExperience(button.dataset.experience === 'showcase'));
});

const requestedView = new URLSearchParams(window.location.search).get('view') as keyof typeof reviewMap | null;
if (pageParams.get('study') === 'motion') setMotionStudy(true);
if (requestedView && reviewMap[requestedView]) setReviewView(requestedView);
if (new URLSearchParams(window.location.search).get('clean') === '1') setCleanView(true);
if (new URLSearchParams(window.location.search).get('compare') === '1') setCompareOpen(true);
if (new URLSearchParams(window.location.search).get('render') === '1') {
  setCleanView(true);
  document.querySelector('#app')?.classList.add('render-only');
}
if (pageParams.get('experience') === 'showcase') {
  setCleanView(true);
  document.querySelector('#app')?.classList.add('render-only');
} else if (pageParams.get('experience') === 'console') {
  if (compareSplitActive) setCompareOpen(false);
  setCleanView(false);
  document.querySelector('#app')?.classList.remove('render-only');
}
if (state.explodeStage > 0) setConsoleHidden(true);
const focusMap: Record<string, { camera: THREE.Vector3; target: THREE.Vector3 }> = {
  compressor: { camera: new THREE.Vector3(-3.2, 5.3, 10.5), target: new THREE.Vector3(-2.3, .1, 0) },
  combustion: { camera: new THREE.Vector3(1.1, 5.7, 9.5), target: new THREE.Vector3(1.6, .1, 0) },
  turbine: { camera: new THREE.Vector3(3.8, 5.1, 9.7), target: new THREE.Vector3(4.0, .1, 0) },
  exhaust: { camera: new THREE.Vector3(8.3, 5.2, 11.5), target: new THREE.Vector3(6.8, .1, 0) },
};

document.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((button) => {
  button.addEventListener('click', () => {
    const focus = focusMap[button.dataset.focus ?? ''];
    if (!focus) return;
    cameraGoal.copy(focus.camera);
    targetGoal.copy(focus.target);
    cameraTransitionActive = true;
    controls.autoRotate = false;
  });
});

const labelHost = document.querySelector<HTMLDivElement>('#labels');
const labelEntries = [
  ['进气支撑', model.anchors.inlet],
  ['14 级压气机', model.anchors.compressor],
  ['DLN 2.6e 燃烧室', model.anchors.combustion],
  ['4 级涡轮', model.anchors.turbine],
  ['排气扩压段', model.anchors.exhaust],
] as const;
const labelNodes = labelEntries.map(([name]) => {
  const node = document.createElement('div');
  node.className = 'label';
  node.textContent = name;
  labelHost?.appendChild(node);
  return node;
});

const serviceLabelHost = document.createElement('div');
serviceLabelHost.className = 'service-labels';
document.querySelector('#app')?.append(serviceLabelHost);
const serviceLabelEntries = [
  { text: '01 / 核心轴系', parent: model.root, point: new THREE.Vector3(-2, 2.5, 0) },
  { text: '02 / 下半机壳', parent: model.lowerCasing, point: new THREE.Vector3(-3, -.7, 3) },
  { text: '03 / 燃烧室组件', parent: model.combustorModules[5], point: new THREE.Vector3(1.85, 3.9, 0) },
  { text: '04 / 排气段', parent: model.exhaust, point: new THREE.Vector3(8.3, 3.55, 0) },
].map(entry => {
  const node = document.createElement('div');
  node.className = 'service-label';
  node.textContent = entry.text;
  serviceLabelHost.append(node);
  return { ...entry, node };
});
const world = new THREE.Vector3();
function updateLabels() {
  serviceLabelHost.hidden = state.explodeStage !== 2 || serviceBlend < .9;
  if (!serviceLabelHost.hidden) for (const entry of serviceLabelEntries) {
    world.copy(entry.point);
    entry.parent.localToWorld(world);
    world.project(camera);
    entry.node.style.transform = `translate(${(world.x * .5 + .5) * surfaceWidth()}px, ${(-world.y * .5 + .5) * surfaceHeight()}px)`;
    entry.node.style.opacity = world.z < 1 ? '1' : '0';
  }
  labelEntries.forEach(([, anchor], i) => {
    world.copy(anchor);
    if (i === 0) world.add(model.lowerCasing.position);
    if (i === 4) world.add(model.exhaust.position).sub(basePositions.exhaust);
    model.root.localToWorld(world);
    world.project(camera);
    const x = (world.x * .5 + .5) * surfaceWidth();
    const y = (-world.y * .5 + .5) * surfaceHeight();
    labelNodes[i].style.transform = `translate(${x}px, ${y}px)`;
    labelNodes[i].style.opacity = world.z < 1 ? '1' : '0';
  });
}

const clock = new THREE.Clock();
let elapsed = 0;
let flowElapsed = 0;
let currentRotorPercent = 0;
let lastSpeedState = '';
let generatedMWh = 0;
let operatingSeconds = 0;
let requestedExhibitRun = false;
let exhibitRunDemo = false;
let holdExhibitAssembly = false;
let equivalentKWh = 0;
const operatingEffects = createOperatingEffects(model.combustorModules);
model.root.add(operatingEffects.group);
let lastMeterUpdate = -Infinity;
const compressorCasingTravel = new THREE.Vector3(0, 4.05, 0);
const combustionCasingTravel = new THREE.Vector3(0, 4.42, 0);
const turbineCasingHotTravel = new THREE.Vector3(0, 3.35, 0);
const turbineCasingMajorTravel = new THREE.Vector3(0, 1.02, 0);
const casingParkTravel = new THREE.Vector3(0, 0, -3.5);
const exhaustTravel = new THREE.Vector3(3.2, 0, 0);
const formatEnergy = (mwh: number) => {
  const kwh = mwh * 1000;
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: kwh < 100 ? 1 : 0,
    maximumFractionDigits: kwh < 100 ? 1 : 0,
  }).format(kwh)} kWh`;
};
document.querySelector<HTMLButtonElement>('#reset-energy')?.addEventListener('click', () => {
  generatedMWh = 0;
  operatingSeconds = 0;
  equivalentKWh = 0;
  if (generationKWh) generationKWh.textContent = formatEnergy(0);
  turbineAudio.uiTap(.74);
});
const smoothWindow = (value: number, start: number, end: number) => {
  const t = THREE.MathUtils.clamp((value - start) / (end - start), 0, 1);
  return t * t * (3 - 2 * t);
};
type CameraPose = { position:THREE.Vector3; target:THREE.Vector3; minDistance:number };
let detailReturnPose:CameraPose|null=null;
let selectedBladeMarker:THREE.Mesh|null=null;
const bladeMarkerMaterial=new THREE.MeshStandardMaterial({color:0xf7d798,emissive:0xb78735,emissiveIntensity:.45,metalness:.5,roughness:.3,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
const bladeLocator=document.createElement('div');bladeLocator.className='blade-locator';bladeLocator.hidden=true;document.body.append(bladeLocator);
function clearBladeLocator(){if(selectedBladeMarker){scene.remove(selectedBladeMarker);selectedBladeMarker=null;}bladeLocator.hidden=true;}
let detailShot:{from:CameraPose; to:CameraPose; time:number; duration:number; done:()=>void}|null=null;
const currentCameraPose=():CameraPose=>({position:camera.position.clone(),target:controls.target.clone(),minDistance:controls.minDistance});
function cameraShot(to:CameraPose,duration:number,done:()=>void) {
  detailShot={from:currentCameraPose(),to,time:0,duration,done};
  cameraTransitionActive=false;controls.enabled=false;controls.autoRotate=false;
  controls.minDistance=3;
  document.body.classList.add('blade-approach');
  document.querySelector<HTMLElement>('.exhibition')!.inert=true;
}
function endCameraShot() {
  detailShot=null;document.body.classList.remove('blade-approach');
  document.querySelector<HTMLElement>('.exhibition')!.inert=false;
  controls.enabled=true;
}
const componentInspector = installComponentInspector(model, active => {
  controls.enabled = !active;
  turbineAudio.suspend(active || document.hidden);
  if(!active&&detailReturnPose) {
    const pose=detailReturnPose;detailReturnPose=null;
    clearBladeLocator();
    cameraShot(pose,.75,()=>{controls.minDistance=pose.minDistance;endCameraShot();});
  }
});
const exhibitSources: Record<string,THREE.Object3D> = {
  'compressor-1': model.root.getObjectByName('compressor-rotor-01')!,
  combustor: model.combustorModules[5],
  'turbine-1': model.root.getObjectByName('turbine-rotor-1')!,
  exhaust: model.exhaust,
};
const exhibitCenters=new Map<string,THREE.Vector3>();
const exhibitRay = new THREE.Raycaster();
const exhibitPointer = new THREE.Vector2();
let exhibitHighlight: {mesh:THREE.Mesh;material:THREE.Material|THREE.Material[]}[]=[];
const exhibitHighlightMaterials=new Map<THREE.Material,THREE.Material>();
function highlightExhibit(id:string|null) {
  for(const record of exhibitHighlight)record.mesh.material=record.material;exhibitHighlight=[];
  if(!id)return;
  exhibitSources[id].traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    const original=object.material;
    const temporary=(Array.isArray(original)?original:[original]).map(material=>{
      if(!exhibitHighlightMaterials.has(material)){
        const copy=material.clone();if(copy instanceof THREE.MeshStandardMaterial){copy.emissive.setHex(0x779aaa);copy.emissiveIntensity=.28;}
        exhibitHighlightMaterials.set(material,copy);
      }
      return exhibitHighlightMaterials.get(material)!;
    });
    object.material=Array.isArray(original)?temporary:temporary[0];exhibitHighlight.push({mesh:object,material:original});
  });
}
function approachCooledBlade() {
  if(detailShot||componentInspector.active)return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){componentInspector.open(true);return;}
  detailReturnPose=currentCameraPose();
  const source=exhibitSources['turbine-1'] as THREE.InstancedMesh;source.updateWorldMatrix(true,true);
  const center=new THREE.Box3().setFromObject(source).getCenter(new THREE.Vector3());
  const rootRotation=model.root.getWorldQuaternion(new THREE.Quaternion());
  const facing=new THREE.Vector3(0,.72,1).normalize().applyQuaternion(rootRotation);
  source.geometry.computeBoundingBox();
  const localCenter=source.geometry.boundingBox!.getCenter(new THREE.Vector3());
  const matrix=new THREE.Matrix4(),selectedMatrix=new THREE.Matrix4();let best=-Infinity;
  // Select an actual visible-side instance from the first hot rotor row.
  for(let i=0;i<source.count;i++){
    source.getMatrixAt(i,matrix);matrix.premultiply(source.matrixWorld);
    const point=localCenter.clone().applyMatrix4(matrix),score=point.clone().sub(center).normalize().dot(facing);
    if(score>best){best=score;selectedMatrix.copy(matrix);}
  }
  selectedBladeMarker=new THREE.Mesh(source.geometry,bladeMarkerMaterial);
  selectedBladeMarker.matrixAutoUpdate=false;selectedBladeMarker.matrix.copy(selectedMatrix);scene.add(selectedBladeMarker);
  const bladeCenter=localCenter.clone().applyMatrix4(selectedMatrix);
  bladeLocator.textContent='首级涡轮动叶 · 定位检视';bladeLocator.hidden=false;
  const side=center.clone().add(new THREE.Vector3(1.6,3.6,12).applyQuaternion(rootRotation));
  cameraShot({position:side,target:center,minDistance:3},1.35,()=>{
    cameraShot({position:bladeCenter.clone().add(new THREE.Vector3(1.2,1.0,5.8).applyQuaternion(rootRotation)),target:bladeCenter,minDistance:3},1.0,()=>{
      // Hold the highlighted single blade long enough to establish its identity.
      cameraShot(currentCameraPose(),.75,()=>{
        endCameraShot();bladeLocator.hidden=true;componentInspector.open(true);
        const dialog=document.querySelector<HTMLElement>('.parts-lab')!;
        dialog.animate([{opacity:0},{opacity:1}],{duration:240,easing:'ease-out'});
      });
    });
  });
}
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&detailShot){
    const pose=detailReturnPose;detailReturnPose=null;endCameraShot();highlightExhibit(null);clearBladeLocator();
    if(pose){camera.position.copy(pose.position);controls.target.copy(pose.target);controls.minDistance=pose.minDistance;}
  }
});
const exhibition = installExhibition({
  volume: () => audioVolumePercent,
  setVolume: setAudioVolume,
  highlight:highlightExhibit,
  prepareSound(){void turbineAudio.enable().catch(()=>{});},
  transitionSound(view){void turbineAudio.enable().then(()=>{
    if(view===2)turbineAudio.serviceTransition(2);
    else if(state.explodeStage===0)turbineAudio.serviceTransition(0);
    else turbineAudio.casingTransition(view===1);
  }).catch(()=>{});},
  frameAssembly(side){
    targetGoal.set(.8,.8,0);
    cameraGoal.set(side?5:-6,9,30);
    cameraTransitionActive=true;controls.autoRotate=false;
  },
  pick(x,y) {
    exhibitPointer.set(x / surfaceWidth() * 2 - 1, 1 - y / surfaceHeight() * 2);
    exhibitRay.setFromCamera(exhibitPointer,camera);
    let nearest=Infinity, result:string|null=null;
    for(const id of ['combustor','turbine-1']) {
      const hit=exhibitRay.intersectObject(exhibitSources[id],true)[0];
      if(hit && hit.distance<nearest){nearest=hit.distance;result=id;}
    }
    return result;
  },
  phase(step) {
    requestedExhibitRun = false;
    exhibitRunDemo = false;
    holdExhibitAssembly = false;
    if(motionStudyActive)setMotionStudy(false);
    setExperience(false); setConsoleHidden(true); setOperatingCycle(false);
    state.casing = step === 0 || step === 2;
    setServiceStage(step === 2 ? 2 : 0);
    state.speedPercent = 12; state.spin = false; state.kinematicDemo = false;
    if (speedControl) speedControl.value='12';
    document.querySelector('[data-action="spin"]')?.classList.toggle('active',state.spin);
    syncHousingUI(); syncCombustorVisibility(); updateMotionPanel();
    setReviewView(step === 3 ? 'hotpath' : 'hero');
    if(step===0||step===1)cameraGoal.sub(targetGoal).multiplyScalar(1.12).add(targetGoal);
    if(filmPresentation)cameraGoal.sub(targetGoal).multiplyScalar(step===2 ? .91 : .86).add(targetGoal);
    if(step===3)cameraGoal.sub(targetGoal).multiplyScalar(1.22).add(targetGoal);
    const url=new URL(location.href);url.searchParams.set('experience','exhibition');url.searchParams.delete('inspect');url.searchParams.set('chapter',String(step));url.searchParams.set('housing',state.casing?'enclosed':'cutaway');url.searchParams.set('speed',state.spin?String(state.speedPercent):'0');history.replaceState(null,'',url);
    updateCameraFraming();
  },
  console() {requestedExhibitRun=false;if(exhibitRunDemo){exhibitRunDemo=false;setOperatingCycle(false);}controls.autoRotate=false;setExperience(false); updateCameraFraming(); },
  inspect(id) { componentInspector.openPart(id); },
  blade:approachCooledBlade,
  motion(enabled) {
    requestedExhibitRun = false;
    exhibitRunDemo = false;
    if(state.explodeStage>0)holdExhibitAssembly=true;
    if (state.explodeStage === 0 && serviceInterlocked()) return;
    setOperatingCycle(false);
    state.kinematicDemo = enabled && state.explodeStage > 0;
    state.spin = enabled && state.explodeStage === 0;
    state.speedPercent = 12;
    if (speedControl) speedControl.value = '12';
    document.querySelector('[data-action="spin"]')?.classList.toggle('active', state.spin);
    turbineAudio.spinTransition(enabled);
    updateMotionPanel();
    const url=new URL(location.href);url.searchParams.set('speed',enabled?'12':'0');
    if(state.kinematicDemo)url.searchParams.set('demo','1');else url.searchParams.delete('demo');
    history.replaceState(null,'',url);
  },
  async sound() {
    await turbineAudio.toggle();
    const enabled=turbineAudio.status().enabled;
    const button=document.querySelector<HTMLButtonElement>('[data-action="sound"]')!;
    button.classList.toggle('active',enabled);button.setAttribute('aria-pressed',String(enabled));
    button.innerHTML=`<span>06</span> ${enabled?'声音已开启':'开启声音'}`;
  },
  run(enabled) {
    requestedExhibitRun = enabled && state.explodeStage===0;
    exhibitRunDemo = enabled && state.explodeStage>0;
    if(exhibitRunDemo)holdExhibitAssembly=true;
    if(enabled) {
      state.speedPercent=42;if(speedControl)speedControl.value='42';
      if(exhibitRunDemo) {
        setOperatingCycle(false);state.spin=false;state.kinematicDemo=true;
        model.flow.visible=true;model.operationGlow.visible=true;
      }
      // Unlock audio inside the initiating user gesture, not after reassembly.
      void turbineAudio.enable().then(()=>{
        if(exhibitRunDemo){turbineAudio.spinTransition(true);turbineAudio.operatingTransition(true);}
      }).catch(()=>{});
    } else {
      setOperatingCycle(false);state.spin=false;state.kinematicDemo=false;
      turbineAudio.operatingTransition(false);
    }
    const url=new URL(location.href);url.searchParams.set('speed',enabled?'42':'0');
    if(exhibitRunDemo)url.searchParams.set('demo','1');else url.searchParams.delete('demo');
    history.replaceState(null,'',url);
  },
  energy() {return {powerMW:exhibitRunDemo||state.flow&&!serviceInterlocked()&&state.spin?RATED_POWER_MW*state.loadPercent/100:0,kWh:equivalentKWh,seconds:operatingSeconds};},
  status() {return {moving:state.spin||state.kinematicDemo,interlocked:state.explodeStage===0&&serviceInterlocked(),preview:turbineAudio.status().preview,soundEnabled:turbineAudio.status().enabled,running:state.flow||exhibitRunDemo,starting:requestedExhibitRun};},
  project(id) {
    const source=exhibitSources[id]; source.updateWorldMatrix(true,true);
    if(!exhibitCenters.has(id)){const center=new THREE.Box3().setFromObject(source).getCenter(new THREE.Vector3());source.worldToLocal(center);exhibitCenters.set(id,center);}
    const point=source.localToWorld(exhibitCenters.get(id)!.clone());
    point.project(camera);
    return {x:(point.x+1)*.5*surfaceWidth(),y:(1-point.y)*.5*surfaceHeight(),visible:serviceBlend>.94&&point.z>-1&&point.z<1};
  },
});
installLanguage();
if(pageParams.get('experience')==='exhibition'||(!pageParams.has('experience')&&!pageParams.has('inspect')&&!pageParams.has('compare')&&!pageParams.has('render')&&!captureSize))exhibition.enter(Number(pageParams.get('chapter')??1));
if (pageParams.get('inspect') === 'blade') componentInspector.open(true);
function animate() {
  const delta = Math.min(clock.getDelta(), .05);
  exhibition.update(delta,componentInspector.active);
  if (componentInspector.active) {
    componentInspector.render(delta);
    requestAnimationFrame(animate);
    return;
  }
  elapsed += delta;
  if(requestedExhibitRun&&!serviceInterlocked()) {
    requestedExhibitRun=false;
    state.speedPercent=42;
    if(speedControl)speedControl.value='42';
    setOperatingCycle(true);
    turbineAudio.operatingTransition(true);
  }
  const targetRotorPercent = (state.spin && !serviceInterlocked()) || (state.explodeStage > 0 && state.kinematicDemo)
    ? state.speedPercent
    : 0;
  const rampRate = serviceInterlocked() && !state.kinematicDemo ? 4 : targetRotorPercent > currentRotorPercent ? (exhibition.active ? 3.2 : 1.08) : .54;
  currentRotorPercent = THREE.MathUtils.damp(currentRotorPercent, targetRotorPercent, rampRate, delta);
  if (currentRotorPercent < .025 && targetRotorPercent === 0) currentRotorPercent = 0;
  const rotorSpeed = speedToRadians(currentRotorPercent);
  if (rotorSpeed > 0 && !detailReturnPose) rotateRotor(model.rotor, delta, rotorSpeed);
  const gridOnline = state.flow && !serviceInterlocked() && state.spin;
  const cycleVisible = (gridOnline || exhibitRunDemo) && !detailReturnPose;
  model.flow.visible=cycleVisible;model.operationGlow.visible=cycleVisible;
  turbineAudio.update(currentRotorPercent, cycleVisible, state.loadPercent);
  const electricalPowerMW = gridOnline ? RATED_POWER_MW * state.loadPercent / 100 : 0;
  if (gridOnline) generatedMWh += energyKWh(electricalPowerMW,delta)/1000;
  if (cycleVisible) {equivalentKWh+=energyKWh(RATED_POWER_MW*state.loadPercent/100,delta);operatingSeconds+=delta;}
  if (elapsed - lastMeterUpdate >= .08) {
    updateMotionPanel();
    const assemblyTitle = document.querySelector('[data-service-copy="0"] b');
    if (assemblyTitle) assemblyTitle.textContent = serviceBlend > .003 ? '组件归位中 / 运行锁定'
      : state.casing ? '完整封装 / 结构示意' : '剖面展示 / 结构示意';
    const audio = turbineAudio.status();
    const audioMeter = document.querySelector<HTMLMeterElement>('#audio-meter');
    if (audioMeter) audioMeter.value = audio.rms;
    const audioStatus = document.querySelector('#audio-status');
    if (audioStatus && audio.state !== 'uninitialized') audioStatus.textContent = !audio.enabled ? '声音已关闭'
      : audio.state !== 'running' ? '音频被暂停，请点试听恢复'
      : audio.hidden ? '页面后台，已静音'
      : `${audio.preview ? '声场试听' : gridOnline ? '运行声场' : '停机 / 转动示意'} · ${audio.rms > .00001 ? (20 * Math.log10(audio.rms)).toFixed(0) : '低于 -100'} dBFS`;
    document.querySelector<HTMLButtonElement>('[data-action="flow"]')!.disabled = serviceInterlocked();
    document.querySelector<HTMLButtonElement>('[data-action="spin"]')!.disabled = serviceInterlocked();
    if (kinematicButton) kinematicButton.disabled = state.explodeStage === 0;
    lastMeterUpdate = elapsed;
    generationPanel?.classList.toggle('online', gridOnline);
    generationChip?.classList.toggle('online', gridOnline);
    if (generationStatus) generationStatus.textContent = gridOnline
      ? state.loadPercent >= 99 ? '发电演示中' : '部分负载'
      : serviceInterlocked() ? '检视联锁' : '未运行';
    if (generationMW) generationMW.textContent = electricalPowerMW.toFixed(1);
    if (generationKWh) generationKWh.textContent = formatEnergy(generatedMWh);
    if (fuelInput) fuelInput.textContent = `${Math.round(electricalPowerMW / .44).toLocaleString('en-US')} MWth`;
    if (generationChipStatus) generationChipStatus.textContent = gridOnline ? '发电演示中' : '发电量';
    if (generationChipMW) generationChipMW.textContent = electricalPowerMW.toFixed(1);
    if (generationChipKWh) generationChipKWh.textContent = `${formatEnergy(generatedMWh)} 已送出`;
    if (generationChipRate) generationChipRate.textContent = gridOnline
      ? `${(electricalPowerMW / 3.6).toFixed(1)} kWh / 秒`
      : serviceInterlocked() ? '装配归位后可启动' : '点击运行循环启动';
  }
  if (rotorSpeed > .001) flowElapsed += delta * Math.max(.08, rotorSpeed / .72);
  updateFlow(model.flow, flowElapsed);
  operatingEffects.update(elapsed,cycleVisible,delta);
  const blurLevel = smoothWindow(currentRotorPercent, 42, 100);
  model.rotorMotion.visible = currentRotorPercent > .6 && !detailReturnPose;
  model.rotorMotionMaterials[0].opacity = blurLevel * .09;
  model.rotorMotionMaterials[1].opacity = blurLevel * .115;
  model.rotorMotionMaterials[2].opacity = .34 + (1 - blurLevel) * .42;
  if (speedLiveBar) speedLiveBar.style.transform = `scaleX(${currentRotorPercent / 100})`;
  const speedStatus = state.explodeStage > 0 && !state.kinematicDemo && currentRotorPercent < .6
    ? '检视联锁'
    : targetRotorPercent > currentRotorPercent + 1.2
      ? '加速中'
      : targetRotorPercent < currentRotorPercent - 1.2
        ? '减速中'
        : targetRotorPercent > 0
          ? '转速稳定'
          : '已停止';
  if (speedState && speedStatus !== lastSpeedState) {
    speedState.textContent = speedStatus;
    lastSpeedState = speedStatus;
  }
  const operatingPulse = .5 + Math.sin(elapsed * 5.2) * .5;
  model.operationLights[0].intensity = 1.05 + operatingPulse * .45;
  model.operationLights[1].intensity = .58 + operatingPulse * .28;
  warm.intensity = cycleVisible
    ? (cleanViewActive ? 1.35 : 2.35) + operatingPulse * .35
    : (cleanViewActive ? .58 : 1.1);

  if(state.explodeStage===0)holdExhibitAssembly=false;
  serviceBlend = THREE.MathUtils.damp(serviceBlend, serviceTarget(state.explodeStage, currentRotorPercent, state.kinematicDemo||holdExhibitAssembly), 3.5, delta);
  const { turbineCasingLift, majorCasingLift, casingPark, combustorRemoval, majorSpread, lowerCasingDrop } = servicePose(serviceBlend);

  model.casing.position.copy(basePositions.casing);
  model.casingSections.turbine.position.copy(basePositions.turbineCasing)
    .addScaledVector(turbineCasingHotTravel, turbineCasingLift)
    .addScaledVector(turbineCasingMajorTravel, majorSpread)
    .addScaledVector(casingParkTravel, casingPark);
  model.casingSections.combustion.position.copy(basePositions.combustionCasing)
    .addScaledVector(combustionCasingTravel, majorCasingLift)
    .addScaledVector(casingParkTravel, casingPark);
  model.casingSections.compressor.position.copy(basePositions.compressorCasing)
    .addScaledVector(compressorCasingTravel, majorCasingLift)
    .addScaledVector(casingParkTravel, casingPark);
  model.casingSections.turbine.rotation.copy(baseRotations.turbineCasing);
  model.casingSections.combustion.rotation.copy(baseRotations.combustionCasing);
  model.casingSections.compressor.rotation.copy(baseRotations.compressorCasing);
  model.combustion.position.copy(basePositions.combustion);
  model.stator.position.copy(basePositions.stator);
  model.lowerCasing.position.copy(basePositions.lowerCasing);
  model.lowerCasing.position.y -= 3.4 * lowerCasingDrop;
  model.exhaust.position.copy(basePositions.exhaust).addScaledVector(exhaustTravel, majorSpread);
  // Fixed stator rings are not split for lifting. Keep the rotor on its bearings.
  model.rotor.position.copy(basePositions.rotor);
  model.combustorModules.forEach((module) => {
    // Withdraw as a rigid assembly after casing clearance, without arbitrary axial scatter.
    module.position.copy(module.userData.serviceDirection as THREE.Vector3).multiplyScalar(1.05 * combustorRemoval);
  });
  assemblyGuides.forEach(({ module, socket, line }) => {
    line.visible = module.visible && combustorRemoval > .03;
    if (!line.visible) return;
    const positions = line.geometry.getAttribute('position');
    positions.setXYZ(1, socket.x + module.position.x, socket.y + module.position.y, socket.z + module.position.z);
    positions.needsUpdate = true;
    line.computeLineDistances();
    line.geometry.computeBoundingSphere();
  });

  if(detailShot){
    const shot=detailShot;shot.time=Math.min(shot.duration,shot.time+delta);
    const u=shot.time/shot.duration,ease=u*u*u*(u*(u*6-15)+10);
    controls.target.lerpVectors(shot.from.target,shot.to.target,ease);
    const from=new THREE.Spherical().setFromVector3(shot.from.position.clone().sub(shot.from.target));
    const to=new THREE.Spherical().setFromVector3(shot.to.position.clone().sub(shot.to.target));
    const turn=THREE.MathUtils.euclideanModulo(to.theta-from.theta+Math.PI,Math.PI*2)-Math.PI;
    camera.position.setFromSpherical(new THREE.Spherical(THREE.MathUtils.lerp(from.radius,to.radius,ease),THREE.MathUtils.lerp(from.phi,to.phi,ease),from.theta+turn*ease)).add(controls.target);
    if(u===1){camera.position.copy(shot.to.position);controls.target.copy(shot.to.target);shot.done();}
  } else if (cameraTransitionActive) {
    const cameraBlend = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 1 - Math.exp(-(exhibition.active ? 2.2 : 4.8) * delta);
    camera.position.lerp(cameraGoal, cameraBlend);
    controls.target.lerp(targetGoal, cameraBlend);
    if (camera.position.distanceToSquared(cameraGoal) < .0004 && controls.target.distanceToSquared(targetGoal) < .0002) {
      camera.position.copy(cameraGoal);
      controls.target.copy(targetGoal);
      cameraTransitionActive = false;
    }
  }
  if(exhibition.active){controls.autoRotate=exhibition.playing&&!cameraTransitionActive&&!detailShot&&!componentInspector.active;controls.autoRotateSpeed=filmPresentation ? .46 : .24;}
  controls.update();
  updateLabels();
  composer.render();
  requestAnimationFrame(animate);
}

document.addEventListener('visibilitychange', () => turbineAudio.suspend(document.hidden || componentInspector.active));

window.addEventListener('resize', () => {
  if (captureSize) return;
  syncSurfaceLayout();
});

console.info('9HA procedural model metrics', model.metrics, model.root.userData.sculptRuntime);
requestAnimationFrame(() => document.querySelector('.loading')?.classList.add('hide'));
animate();
