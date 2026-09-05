import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { TurbineModel } from './turbine';
import { createBladeStudy, type BladeView } from './blade-study';
import './inspector.css';
import { languageControl } from './i18n';
import { renderPixelRatio, onRenderQuality, getRenderQuality, setRenderQuality, type RenderQuality } from './render-quality';

type Part = { id: string; name: string; family: string; note: string; source: THREE.Object3D; instance?: number };

export function installComponentInspector(model: TurbineModel, onActive: (active: boolean) => void) {
  const parts: Part[] = [];
  const add = (id: string, name: string, family: string, note: string, source?: THREE.Object3D) => {
    if (source) parts.push({ id, name, family, note, source });
  };
  add('turbine-1', '第一级涡轮动叶环', '热端 / 随轴旋转', '位于燃烧室出口之后、首级静叶下游。这是涡轮动叶，不是入口压气机叶片。冷却细节另用通用原理模型展示。', model.root.getObjectByName('turbine-rotor-1'));
  const firstRow = model.root.getObjectByName('turbine-rotor-1');
  if (firstRow instanceof THREE.InstancedMesh) parts.push({ id: 'single-blade', name: '第一级涡轮单动叶', family: '单叶片 / 从叶环抽出', note: '这枚叶片直接取自整机叶环，可抽出并放回原位置。整机叶型较简化；下面的精细叶片入口另展示冷却与材料原理。', source: firstRow, instance: 0 });
  add('compressor-1', '首级压气机动叶环', '冷端 / 随轴旋转', '观察整圈叶片的翼型、安装角和重复关系。本模型的压气机叶片没有套用高温叶片内部冷却示意。', model.root.getObjectByName('compressor-rotor-01'));
  add('combustor', '燃烧室组件', '燃烧 / 静止组件', '端盖、筒体和过渡段作为一个组件抽出。这里只表达装配关系，不表示真实检修操作顺序。', model.combustorModules[5]);
  add('lower-case', '下半机壳', '机壳 / 静止组件', '剖分法兰、内腔和支撑随同一个组件移动。归位后保留原整机状态。', model.lowerCasing);
  add('upper-case', '压气机上半机壳', '机壳 / 静止组件', '完整模型中的上半机壳也能单独选取，即使它在当前剖面画面中隐藏。', model.casingSections.compressor);
  add('exhaust', '排气扩压段', '排气 / 静止组件', '外筒、中心锥与支撑共同构成可独立检视的排气组件。', model.exhaust);
  model.root.traverse(object => {
    if (object.name.match(/^turbine-rotor-[234]$/)) add(object.name, `第${object.name.at(-1)}级涡轮动叶环`, '热端 / 随轴旋转', '独立叶片环，保持当前整机模型的几何与装配坐标。', object);
  });

  const opener = document.createElement('button'); opener.type = 'button'; opener.className = 'parts-launch';
  opener.textContent = '部件工坊 ↗'; opener.setAttribute('aria-haspopup', 'dialog');
  document.querySelector('.housing-switch')?.append(opener);
  const dialog = document.createElement('dialog'); dialog.className = 'parts-lab'; dialog.setAttribute('aria-label', '部件工坊');
  dialog.innerHTML = `
    <header class="lab-header"><div><span class="lab-kicker">从整机到一枚叶片</span><h1>部件工坊<span>可选择 · 可抽出 · 可检视</span></h1></div><div class="lab-header-actions"><button class="lab-library-toggle" aria-pressed="false" type="button">组件目录</button><button class="lab-close" type="button">返回整机 ↗</button></div></header>
    <aside class="lab-library"><div class="lab-section-title">组件目录 <span>${parts.length} 个入口</span></div><div class="lab-part-list">${parts.map((p, i) => `<button type="button" data-part="${p.id}"><small>${String(i + 1).padStart(2, '0')} / ${p.family}</small><strong>${p.name}</strong><span>选择组件 ↗</span></button>`).join('')}</div><p class="lab-library-note">组件来自当前整机模型。高温单叶片另用精细原理模型，不冒充制造图纸。</p></aside>
    <section class="lab-viewport"><canvas aria-label="部件三维检视区，可拖动旋转与滚轮缩放"></canvas><div class="lab-breadcrumb">整机装配 <span>›</span> <b></b></div><div class="lab-stage-caption"><span class="lab-state">装配定位</span><p>拖动旋转 · 滚轮放大 · 右键平移</p></div><div class="lab-camera"><button data-camera="front">正视</button><button data-camera="oblique">斜视</button><button data-camera="back">背面</button><button data-camera="reset">重置</button></div></section>
    <aside class="lab-details"><span class="lab-kicker">当前选中</span><h2></h2><p class="lab-description"></p>
      <div class="lab-assembly-tools"><label for="part-extraction">独立抽出 <output>0%</output></label><input id="part-extraction" aria-label="部件抽出程度" type="range" min="0" max="100" value="0"><div class="lab-button-row"><button data-command="extract">抽出组件</button><button data-command="restore">装配归位</button></div><button class="lab-primary" data-command="focus">单独放大检视 ↗</button></div>
      <button class="lab-back" data-command="assembly" hidden>← 回到装配关系</button>
      <button class="lab-feature" data-command="blade"><small>重点部件 / 原理研究</small><strong>打开高温涡轮叶片 ↗</strong><span>镍基合金 · 气膜冷却 · 热障涂层</span></button>
      <section class="lab-blade-tools" hidden><div class="lab-view-tabs"><button data-blade-view="cooling">冷却剖面</button><button data-blade-view="surface">完整外观</button><button data-blade-view="layers">涂层分解</button></div><button class="lab-flow-toggle" type="button" aria-pressed="true">冷却气流 · 开启</button><div class="lab-science"></div></section>
      <details class="lab-sources"><summary>参考图与技术依据</summary><a href="https://www.rrutc.msm.cam.ac.uk/images/eng_atoms_images/turbine-blade-with-cooling-holes" target="_blank" rel="noopener">剑桥 / Rolls-Royce：带冷却孔的实物照片 ↗</a><a href="https://hkxb.buaa.edu.cn/CN/10.7527/S1000-6893.2022.27920" target="_blank" rel="noopener">航空学报：内部冷却结构剖图 ↗</a><a href="https://www.nasa.gov/special-projects-laboratory-turbine-cooling/" target="_blank" rel="noopener">NASA：内部冷却与气膜冷却 ↗</a><a href="https://smg.msm.cam.ac.uk/outreach/articles/nickel-superalloy-turbine-blade" target="_blank" rel="noopener">剑桥：镍基高温合金与单晶 ↗</a><a href="https://www.nasa.gov/special-projects-laboratory-materials-research/" target="_blank" rel="noopener">NASA：热障涂层 ↗</a><a href="https://www.gevernova.com/gas-power/products/gas-turbines/9ha" target="_blank" rel="noopener">GE Vernova：9HA 空气冷却机型 ↗</a></details>
    </aside><footer class="lab-footer"><span>独立组件 · 可逆装配 · 金色表示选中</span><span>示意模型 / 非制造级 CAD / 非检修指导</span></footer>`;
  document.body.append(dialog);
  // Feature only the components with a meaningful close-up story.
  const secondary=document.createElement('details');secondary.className='lab-secondary';
  secondary.innerHTML='<summary>其他装配件</summary>';
  dialog.querySelectorAll<HTMLButtonElement>('[data-part]').forEach(button=>{
    if(!['turbine-1','single-blade','combustor'].includes(button.dataset.part!))secondary.append(button);
  });
  dialog.querySelector('.lab-part-list')!.append(secondary);
  dialog.querySelector('.lab-header-actions')!.prepend(languageControl());
  const qualityControl = document.createElement('details'); qualityControl.className = 'lab-quality';
  qualityControl.innerHTML = '<summary>画质</summary><label><span>渲染画质</span><select aria-label="渲染画质"><option value="balanced">流畅</option><option value="high">精细 · 2×</option><option value="ultra">演示 · 最高 3×</option></select></label><output></output><small>提高渲染清晰度，不改变几何细节。高画质更耗显存，最长边上限 4096 像素。</small>';
  dialog.querySelector('.lab-header-actions')!.prepend(qualityControl);
  const qualitySelect = qualityControl.querySelector('select')!;
  qualitySelect.value = getRenderQuality(); qualitySelect.onchange = () => setRenderQuality(qualitySelect.value as RenderQuality);
  const el = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const viewPort = el('.lab-viewport');
  const bladeTitle = document.createElement('div'); bladeTitle.className = 'lab-blade-title';
  bladeTitle.innerHTML = '<h1>冷却叶片</h1><span>原理示意 · 非原厂配方</span>'; viewPort.append(bladeTitle);
  const bladeSummary = document.createElement('aside'); bladeSummary.className = 'lab-blade-summary';
  bladeSummary.setAttribute('aria-label', '材料与原理'); viewPort.append(bladeSummary);
  const bladeDock = document.createElement('div'); bladeDock.className = 'lab-blade-dock';
  bladeDock.append(el('.lab-view-tabs'), el('.lab-flow-toggle'));
  const infoToggle = document.createElement('button'); infoToggle.type = 'button'; infoToggle.className = 'lab-info-toggle';
  infoToggle.textContent = '材料与原理'; infoToggle.setAttribute('aria-expanded', 'false');
  el('.lab-details').id = 'blade-information'; infoToggle.setAttribute('aria-controls', 'blade-information');
  bladeDock.append(infoToggle); dialog.append(bladeDock);
  function setBladeInfo(open: boolean) {
    dialog.classList.toggle('blade-info-open', open); infoToggle.setAttribute('aria-expanded', String(open));
  }
  infoToggle.addEventListener('click', () => setBladeInfo(!dialog.classList.contains('blade-info-open')));
  const pullHandle = document.createElement('button'); pullHandle.className = 'lab-pull'; pullHandle.type = 'button';
  pullHandle.textContent = '↗ 拖动抽出'; pullHandle.setAttribute('aria-label', '拖动抽出选中部件，也可用上下方向键'); viewPort.append(pullHandle);
  let renderer: THREE.WebGLRenderer | undefined;
  let composer: EffectComposer, ao: SSAOPass;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0c1820);
  const camera = new THREE.PerspectiveCamera(34, 1, .02, 180);
  let orbit: OrbitControls;
  let context: THREE.Group | undefined, selected: THREE.Object3D | undefined;
  let current = parts[0], mode: 'assembly' | 'focus' | 'blade' = 'assembly';
  let currentBladeView: BladeView = 'layers';
  const labels = Array.from({ length: 3 }, () => { const label = document.createElement('span'); label.className = 'lab-model-label'; label.hidden = true; viewPort.append(label); return label; });
  let extraction = 0, targetExtraction = 0, elapsed = 0;
  const selectedLocalCenter=new THREE.Vector3(),selectedScreenCenter=new THREE.Vector3();
  const initial = new THREE.Vector3(); const travel = new THREE.Vector3(0, 4.4, 3.2);
  let blade: ReturnType<typeof createBladeStudy>;
  let ownedMaterials: THREE.Material[] = [];
  let flowEnabled = true;
  let pinnedLayer: number | null = null;
  function showLayer(index: number | null) {
    blade?.highlightLayer(index);
    dialog.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach(button => {
      button.classList.toggle('is-highlighted', Number(button.dataset.layer) === index);
      button.setAttribute('aria-pressed', String(Number(button.dataset.layer) === pinnedLayer));
    });
  }
  const layerRay = new THREE.Raycaster(), layerPointer = new THREE.Vector2();
  const inspectionCanvas = el<HTMLCanvasElement>('canvas');
  inspectionCanvas.addEventListener('pointermove', event => {
    if (mode !== 'blade' || currentBladeView !== 'layers' || event.buttons) return;
    const rect = inspectionCanvas.getBoundingClientRect();
    layerPointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    layerRay.setFromCamera(layerPointer, camera);
    const hit = layerRay.intersectObjects(blade.layerMeshes, false)[0];
    showLayer(hit ? hit.object.userData.layerIndex as number : pinnedLayer);
    inspectionCanvas.style.cursor = hit ? 'pointer' : '';
  });
  inspectionCanvas.addEventListener('pointerleave', () => { if (mode === 'blade') showLayer(pinnedLayer); inspectionCanvas.style.cursor = ''; });

  function initialize() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas: el<HTMLCanvasElement>('canvas'), antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(renderPixelRatio(viewPort.clientWidth, viewPort.clientHeight)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    RectAreaLightUniformsLib.init();
    const studio = new THREE.Scene(); studio.background = new THREE.Color(0x242728);
    function card(color: THREE.Color, position: THREE.Vector3Tuple, width: number, height: number) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); mesh.position.set(...position); mesh.lookAt(0, 2, 0); studio.add(mesh);
    }
    card(new THREE.Color(3.3,3.3,3.3), [-4,5,4], 3, 8);
    card(new THREE.Color(.43,.43,.43), [4,3,4], 2, 7);
    card(new THREE.Color(1.85,1.85,1.85), [3,5,-4], 4, 6);
    card(new THREE.Color(.49,.49,.49), [1,2,6], 1.4, 7);
    card(new THREE.Color(1.4,1.4,1.4), [0,-2,5], 5, 3);
    const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(studio, .025).texture;
    scene.environmentIntensity = .85;
    studio.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); pmrem.dispose();
    const backdrop = new Uint8Array(256 * 256 * 4);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const v = Math.max(0,1-Math.hypot((x-132)/160,(y-116)/155)); const i = (y*256+x)*4; backdrop[i]=9+v*17; backdrop[i+1]=17+v*23; backdrop[i+2]=24+v*28; backdrop[i+3]=255; }
    const background = new THREE.DataTexture(backdrop,256,256); background.colorSpace=THREE.SRGBColorSpace; background.magFilter=THREE.LinearFilter; background.needsUpdate=true; scene.background=background;
    const key = new THREE.DirectionalLight(0xf2f2ed, 1.65); key.position.set(-3, 6, 4); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left=-5; key.shadow.camera.right=5; key.shadow.camera.top=6; key.shadow.camera.bottom=-3; key.shadow.bias=-.0002; key.shadow.normalBias=.012; key.shadow.radius=3;
    const softbox = new THREE.RectAreaLight(0xf0f0ee, 2.8, 3, 6); softbox.position.set(-4, 3, 4); softbox.lookAt(0,2,0);
    const rim = new THREE.RectAreaLight(0xf0f0ee, 4, 3, 5); rim.position.set(3,4,-2); rim.lookAt(0,2,0);
    const rootFill = new THREE.RectAreaLight(0xeeeeee, 2, 4, 3); rootFill.position.set(1,-1.3,4); rootFill.lookAt(0,.1,0);
    scene.add(key, softbox, rim, rootFill, new THREE.HemisphereLight(0x9ab0c1, 0x161a20, .35));
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target); composer.addPass(new RenderPass(scene, camera));
    ao = new SSAOPass(scene, camera, 1, 1); ao.kernelRadius = .18; ao.minDistance = .00003; ao.maxDistance = .003; composer.addPass(ao); composer.addPass(new OutputPass());
    orbit = new OrbitControls(camera, el<HTMLCanvasElement>('canvas')); orbit.enableDamping = true; orbit.dampingFactor = .09;
    orbit.minDistance = 2; orbit.maxDistance = 60; orbit.target.set(0, 1, 0); orbit.update();
  }
  function releaseSelection() {
    for (const object of [selected, context]) object?.traverse(child => { if (child instanceof THREE.InstancedMesh) child.dispose(); });
    if (selected) scene.remove(selected); if (context) scene.remove(context); if(blade)scene.remove(blade.root);
    ownedMaterials.forEach(mat => mat.dispose()); ownedMaterials = []; selected = undefined; context = undefined;
  }
  function cloneVisible(source: THREE.Object3D, ghost = false) {
    const clone = source.clone(true);
    const ghostMaterial = ghost ? new THREE.MeshStandardMaterial({ color: 0x233944, metalness: .12, roughness: .88 }) : null;
    if (ghostMaterial) ownedMaterials.push(ghostMaterial);
    clone.traverse(object => {
      if (object.name.includes('glow') || object.name.includes('illustration') || object.name.includes('speed-cues') || object instanceof THREE.Points || object instanceof THREE.Light || object instanceof THREE.Line) object.visible = false;
      if (object instanceof THREE.Mesh && ghostMaterial) {
        object.material = ghostMaterial; object.castShadow = false;
      }
    });
    return clone;
  }
  function frame(object: THREE.Object3D, side = 'oblique') {
    if (mode === 'blade' && side === 'reset') { bladeView(currentBladeView); return; }
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    object.traverseVisible(child => {
      if (!(child instanceof THREE.Mesh)) return;
      if (child instanceof THREE.InstancedMesh) {
        if (!child.boundingBox) child.computeBoundingBox();
        if (child.boundingBox) box.union(child.boundingBox.clone().applyMatrix4(child.matrixWorld));
      } else {
        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
        if (child.geometry.boundingBox) box.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld));
      }
    });
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center; const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05 / Math.min(1, camera.aspect);
    orbit.target.copy(center);
    const axial = mode === 'focus' && (current.id.includes('turbine') || current.id.includes('compressor'));
    const direction = axial
      ? side === 'front' ? new THREE.Vector3(1,.03,0) : side === 'back' ? new THREE.Vector3(-1,.1,.3) : new THREE.Vector3(1,.26,.48)
      : side === 'front' ? new THREE.Vector3(0, .03, 1) : side === 'back' ? new THREE.Vector3(-.45, .1, -1) : new THREE.Vector3(.48, .22, 1);
    camera.position.copy(center).addScaledVector(direction.normalize(), dist); orbit.update();
  }
  let lastWidth=0,lastHeight=0,lastRatio=0;
  function resize() {
    if (!renderer || !dialog.open) return;
    const { width, height } = viewPort.getBoundingClientRect();
    const ratio = renderPixelRatio(width,height);
    if(width===lastWidth&&height===lastHeight&&ratio===lastRatio)return;
    lastWidth=width;lastHeight=height;lastRatio=ratio;
    renderer.setPixelRatio(ratio); composer.setPixelRatio(renderer.getPixelRatio());
    const previousFit = Math.max(1, .92 / camera.aspect);
    renderer.setSize(width, height, false); composer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
    qualityControl.querySelector('output')!.textContent = `${renderer.domElement.width} × ${renderer.domElement.height} px`;
    if (mode === 'blade' && orbit) camera.position.sub(orbit.target).multiplyScalar(Math.max(1, .92 / camera.aspect) / previousFit).add(orbit.target);
  }
  function updateCopy() {
    setBladeInfo(false);
    dialog.classList.toggle('blade-hero', mode === 'blade');
    ao.enabled = mode === 'blade';
    el('.lab-footer span').textContent = mode === 'blade' ? '曲面翼型 · 冷却剖面 · 材料分层' : '独立组件 · 可逆装配 · 金色表示选中';
    el('h2').textContent = mode === 'blade' ? '冷却叶片' : current.name;
    el('.lab-description').textContent = mode === 'blade' ? '原理示意 · 非原厂配方' : current.note;
    el('.lab-breadcrumb b').textContent = mode === 'blade' ? '热端 › 单叶片原理模型' : current.name;
    el('.lab-state').textContent = mode === 'blade' ? '独立叶片 / 原理检视' : mode === 'focus' ? '独立组件 / 自由检视' : '装配定位 / 可抽出';
    el('.lab-assembly-tools').hidden = mode !== 'assembly'; el('.lab-back').hidden = mode === 'assembly';
    el('[data-command="focus"]').hidden=!['turbine-1','single-blade','combustor'].includes(current.id);
    el('.lab-blade-tools').hidden = mode !== 'blade'; el('.lab-feature').hidden = mode === 'blade';
    pullHandle.hidden = mode !== 'assembly';
    labels.forEach(label => { label.hidden = mode !== 'blade'; });
    dialog.querySelectorAll<HTMLButtonElement>('[data-part]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.part === current.id)));
  }
  function select(part: Part, nextMode: 'assembly' | 'focus' = 'assembly') {
    releaseSelection(); current = part; mode = nextMode; extraction = targetExtraction = 0;
    updateCopy(); resize();
    el<HTMLInputElement>('#part-extraction').value = '0'; el('output').textContent = '0%';
    model.root.updateWorldMatrix(true, true);
      selected = part.instance !== undefined && part.source instanceof THREE.InstancedMesh
        ? new THREE.Mesh(part.source.geometry, part.source.material) : cloneVisible(part.source);
      selected.visible = true;
    if (mode === 'assembly') {
      selected.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const mat = new THREE.MeshStandardMaterial({ color: 0xd7b66f, emissive: 0x70551a, emissiveIntensity: .15, metalness: .65, roughness: .4 });
        object.material = mat; object.renderOrder = 10; ownedMaterials.push(mat);
      });
      context = cloneVisible(model.root, true) as THREE.Group; context.visible = true;
      const matching = context.getObjectByName(part.source.name);
      if (matching instanceof THREE.InstancedMesh && part.instance !== undefined) { matching.setMatrixAt(part.instance, new THREE.Matrix4().makeScale(0, 0, 0)); matching.instanceMatrix.needsUpdate = true; }
      else if (matching) matching.visible = false;
      scene.add(context);
      const world = part.source.matrixWorld.clone();
      if (part.source instanceof THREE.InstancedMesh && part.instance !== undefined) { const instance = new THREE.Matrix4(); part.source.getMatrixAt(part.instance, instance); world.multiply(instance); }
      world.decompose(selected.position, selected.quaternion, selected.scale);
      const rootRotation = model.root.getWorldQuaternion(new THREE.Quaternion());
      if (part.id === 'combustor') travel.copy(part.source.userData.serviceDirection as THREE.Vector3).normalize().applyQuaternion(rootRotation).multiplyScalar(5);
      else if (part.id === 'exhaust') travel.set(5.5, 0, 0).applyQuaternion(rootRotation);
      else if (part.id === 'lower-case') travel.set(0, -4, 0).applyQuaternion(rootRotation);
      else if (part.instance !== undefined && part.source instanceof THREE.InstancedMesh) {
        const instance = new THREE.Matrix4(); part.source.getMatrixAt(part.instance, instance);
        travel.setFromMatrixPosition(instance); travel.x = 0; travel.transformDirection(part.source.matrixWorld).multiplyScalar(4.5);
      } else travel.set(0, 4.4, 1.2).applyQuaternion(rootRotation);
      initial.copy(selected.position); scene.add(selected);
      frame(context);
    } else {
      selected.position.set(0, 0, 0); selected.quaternion.identity(); selected.scale.setScalar(1); scene.add(selected); frame(selected);
    }
    if(selected){
      selected.updateWorldMatrix(true,true);
      new THREE.Box3().setFromObject(selected).getCenter(selectedLocalCenter);
      selected.worldToLocal(selectedLocalCenter);
    }
    updateCopy();
  }
  function bladeView(view: BladeView) {
    currentBladeView = view;
    blade.setView(view);
    el('.lab-flow-toggle').hidden = view === 'surface';
    dialog.querySelectorAll<HTMLButtonElement>('[data-blade-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.bladeView === view)));
    const science = {
      surface: '<h3>不是一片普通金属</h3><p>镍基高温合金承担载荷。单晶铸造控制晶体生长，避免普通多晶材料的晶界问题；不是在表面镀一层“单晶”。</p><ol><li>曲面翼型：引导燃气并受力</li><li>气膜孔：冷却空气的出口</li><li>平台与榫形叶根：连接轮盘</li></ol><small>未查到 9HA 对应叶片的公开合金牌号，不编造配方。</small>',
      cooling: '<h3>一枚叶片里的冷却系统</h3><p>剖窗让内部通道直接可见。沿青色粒子看空气的行进方向，再看它从表面小孔排出。</p><ol><li>内部通道：冷却空气穿行换热</li><li>隔壁、斜肋与针肋：内部换热结构</li><li>表面小孔：气膜冷却出口</li></ol><small>剖窗仅用于讲解，不是可拆盖板。气流是原理示意，非 CFD；孔位与流道不代表 GE 制造数据。</small>',
      layers: '<h3>隔热、抗氧化、内部冷却</h3><p>青色气流带走热量；旁边的曲面样片展开一套典型热障涂层体系。</p><ol class="material-stack"><li><b>YSZ · 陶瓷热障层</b><span>氧化钇稳定氧化锆：ZrO₂ + 7–8 wt% Y₂O₃。低导热，减缓燃气向金属传热。</span></li><li><b>Al₂O₃ · 热生长氧化层</b><span>TGO 是粘结层在高温下形成的保护性氧化铝层，不是另一块贴上去的涂片。</span></li><li><b>MCrAlY · 金属粘结层</b><span>M 表示 Ni、Co 或 NiCo；其余是 Cr、Al、Y。连接陶瓷与基体，并提供抗氧化保护。外观以中性灰示意，非实物色彩测量。</span></li><li><b>Ni 基高温合金 · 承力基体</b><span>承担离心与气动力载荷。合金牌号和晶体结构须按具体叶片确认，不能仅凭外观判定。</span></li></ol><small>代表性材料体系，非已确认的 9HA.02 配方。实际各层贴合；样片厚度、间距及氧化层均放大。冷却流道和气流为原理示意。</small><a class="material-source" href="https://netl.doe.gov/sites/default/files/gas-turbine-handbook/4-4-2.pdf" target="_blank" rel="noopener">DOE / NETL：材料名称与分层依据 ↗</a>',
    };
    const glance = {
      surface: '<p class="lab-one-line">陶瓷隔热，合金承力。</p>',
      cooling: '<p class="lab-one-line">空气穿过内部通道，从气膜孔排出。</p>',
      layers: '<div class="lab-layer-list"><button data-layer="3" aria-pressed="false"><b>YSZ</b><span>隔热</span><small>陶瓷热障层</small></button><button data-layer="2" aria-pressed="false"><b>Al₂O₃</b><span>氧化保护</span><small>热生长氧化层</small></button><button data-layer="1" aria-pressed="false"><b>MCrAlY</b><span>粘结与抗氧化</span><small>金属粘结层</small></button><button data-layer="0" aria-pressed="false"><b>Ni</b><span>承力基体</span><small>镍基高温合金</small></button></div>',
    };
    el('.lab-science').innerHTML = `${glance[view]}<details class="lab-technical"><summary>材料与原理</summary>${science[view]}</details>`;
    bladeSummary.innerHTML = `<span class="lab-summary-heading">${view === 'layers' ? '材料分层' : view === 'cooling' ? '内部冷却' : '表面与基体'}</span>${glance[view]}${view === 'layers' ? '<p class="lab-cooling-note"><i></i><span>内部空气冷却</span></p><small>典型体系 · 分层厚度已放大</small>' : ''}`;
    pinnedLayer = null; showLayer(null);
    dialog.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach(button => {
      const index = Number(button.dataset.layer);
      button.addEventListener('pointerenter', () => showLayer(index));
      button.addEventListener('pointerleave', () => showLayer(pinnedLayer));
      button.addEventListener('focus', () => showLayer(index));
      button.addEventListener('blur', () => showLayer(pinnedLayer));
      button.addEventListener('click', () => { pinnedLayer = pinnedLayer === index ? null : index; showLayer(pinnedLayer); });
    });
    resize();
    camera.position.set(view === 'layers' ? 1.8 : 3.1, 3.05, view === 'layers' ? 10.3 : 9.0); orbit.target.set(view === 'layers' ? .9 : .25, 1.8, .1);
    camera.position.sub(orbit.target).multiplyScalar(Math.max(1, .92 / camera.aspect)).add(orbit.target); orbit.update();
  }
  function openBlade() {
    blade ??= createBladeStudy();
    dialog.classList.remove('library-expanded'); el('.lab-library-toggle').setAttribute('aria-pressed', 'false');
    flowEnabled = true; blade.setFlow(true); el('.lab-flow-toggle').textContent = '冷却气流 · 开启'; el('.lab-flow-toggle').setAttribute('aria-pressed', 'true');
    releaseSelection(); current = parts.find(part => part.id === 'single-blade') ?? parts[0]; mode = 'blade'; blade.root.position.set(0, 0, 0); scene.add(blade.root); updateCopy(); bladeView('layers');
  }
  function open(directBlade = false, part = parts[0]) {
    initialize(); dialog.showModal(); onActive(true); resize();
    if(directBlade)openBlade();else select(part,['turbine-1','single-blade','combustor'].includes(part.id)?'focus':'assembly');
    el<HTMLButtonElement>('.lab-close').focus();
  }
  function close() { dialog.close(); releaseSelection(); onActive(false); opener.focus(); }
  opener.addEventListener('click', () => open()); el('.lab-close').addEventListener('click', close);
  el('.lab-library-toggle').addEventListener('click', () => { const expanded = dialog.classList.toggle('library-expanded'); el('.lab-library-toggle').setAttribute('aria-pressed', String(expanded)); resize(); });
  el('.lab-flow-toggle').addEventListener('click', () => { flowEnabled = !flowEnabled; blade.setFlow(flowEnabled); el('.lab-flow-toggle').textContent = `冷却气流 · ${flowEnabled ? '开启' : '关闭'}`; el('.lab-flow-toggle').setAttribute('aria-pressed', String(flowEnabled)); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (dialog.classList.contains('blade-info-open')) { setBladeInfo(false); infoToggle.focus(); } else close(); });
  dialog.querySelectorAll<HTMLButtonElement>('[data-part]').forEach(button => button.addEventListener('click', () => {
    const part=parts.find(p=>p.id===button.dataset.part)!;
    if(part===current&&mode!=='blade')return;
    select(part,['turbine-1','single-blade','combustor'].includes(part.id)?'focus':'assembly');
  }));
  el<HTMLInputElement>('#part-extraction').addEventListener('input', event => { targetExtraction = Number((event.target as HTMLInputElement).value) / 100; el('output').textContent = `${Math.round(targetExtraction * 100)}%`; });
  function setExtraction(value: number) {
    targetExtraction = THREE.MathUtils.clamp(value, 0, 1); el<HTMLInputElement>('#part-extraction').value = String(targetExtraction * 100); el('output').textContent = `${Math.round(targetExtraction * 100)}%`;
  }
  let drag: { x: number; y: number; start: number } | undefined;
  pullHandle.addEventListener('pointerdown', event => { drag = { x: event.clientX, y: event.clientY, start: targetExtraction }; pullHandle.setPointerCapture(event.pointerId); orbit.enabled = false; });
  pullHandle.addEventListener('pointermove', event => { if (drag) setExtraction(drag.start + (drag.y - event.clientY + (event.clientX - drag.x) * .35) / 150); });
  const endDrag = () => { drag = undefined; orbit.enabled = true; };
  pullHandle.addEventListener('pointerup', endDrag); pullHandle.addEventListener('pointercancel', endDrag);
  pullHandle.addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); setExtraction(targetExtraction + (event.key === 'ArrowUp' ? .1 : -.1)); } });
  // Picking is based on the visible cloned model, not screen-coordinate regions.
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let pointerStart = new THREE.Vector2();
  el('canvas').addEventListener('pointerdown', event => { pointerStart.set(event.clientX, event.clientY); setBladeInfo(false); });
  el('canvas').addEventListener('pointerup', event => {
    if (mode !== 'assembly' || !context || pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return;
    const rect = el('canvas').getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
    for (const hit of raycaster.intersectObject(context, true)) {
      let object: THREE.Object3D | null = hit.object; let visible = true;
      for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) if (!parent.visible) visible = false;
      if (!visible) continue;
      while (object) {
        const single = parts.find(p => p.id === 'single-blade' && p.source.name === object!.name);
        if (single && hit.instanceId !== undefined) { single.instance = hit.instanceId; select(single); return; }
        const part = parts.find(p => p.source.name === object!.name); if (part) { select(part); return; } object = object.parent;
      }
    }
  });
  dialog.querySelectorAll<HTMLButtonElement>('[data-command]').forEach(button => button.addEventListener('click', () => {
    const command = button.dataset.command;
    if (command === 'focus') select(current, 'focus');
    else if (command === 'assembly') select(current);
    else if (command === 'blade') openBlade();
    else { targetExtraction = command === 'extract' ? 1 : 0; el<HTMLInputElement>('#part-extraction').value = String(targetExtraction * 100); el('output').textContent = `${targetExtraction * 100}%`; }
  }));
  dialog.querySelectorAll<HTMLButtonElement>('[data-blade-view]').forEach(button => button.addEventListener('click', () => bladeView(button.dataset.bladeView as BladeView)));
  dialog.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(button => button.addEventListener('click', () => frame(mode === 'blade' ? blade.root : mode === 'assembly' ? context! : selected!, button.dataset.camera)));
  onRenderQuality(() => { qualitySelect.value = getRenderQuality(); resize(); });
  const observer = new ResizeObserver(resize); observer.observe(viewPort);
  return { get active() { return dialog.open; }, open, openPart(id: string) { const part=parts.find(p=>p.id===id);if(part)open(false,part); }, render(delta: number) {
    if (!dialog.open || !renderer) return;
    elapsed += delta;
    if (mode === 'assembly' && selected) {
      extraction = THREE.MathUtils.damp(extraction, targetExtraction, 6, delta); selected.position.copy(initial).addScaledVector(travel, extraction);
      selected.updateWorldMatrix(true,false);
      const center = selected.localToWorld(selectedScreenCenter.copy(selectedLocalCenter)).project(camera);
      pullHandle.style.left = `${THREE.MathUtils.clamp((center.x + 1) * .5 * viewPort.clientWidth, 70, viewPort.clientWidth - 100)}px`;
      pullHandle.style.top = `${THREE.MathUtils.clamp((1 - center.y) * .5 * viewPort.clientHeight - 46, 64, viewPort.clientHeight - 112)}px`;
    }
    if (mode === 'blade') {
      blade.update(delta, elapsed);
      const entries: [string, THREE.Vector3][] = currentBladeView === 'layers'
        ? [['Ni / 承力基体', new THREE.Vector3(1.1, 1.4, .3)], ['MCrAlY + Al₂O₃', new THREE.Vector3(1.65, 3.05, .65)], ['YSZ / 陶瓷热障层', new THREE.Vector3(2.42, 2.3, .99)]]
        : currentBladeView === 'cooling'
          ? [['01 / 冷却通道', new THREE.Vector3(-1.15, 3.0, .35)], ['02 / 气膜出口', new THREE.Vector3(1.10, 3.7, .42)], ['03 / 榫形叶根', new THREE.Vector3(1.05, -.27, .05)]]
          : [['叶尖', new THREE.Vector3(.2, 4.18, .05)], ['气膜冷却孔', new THREE.Vector3(.5, 2.4, .25)], ['榫形叶根', new THREE.Vector3(.1, -.62, .05)]];
      entries.forEach(([text, point], i) => {
        blade.root.localToWorld(point).project(camera); labels[i].textContent = text;
        labels[i].hidden = point.z < -1 || point.z > 1;
        labels[i].style.left = `${THREE.MathUtils.clamp((point.x + 1) * .5 * viewPort.clientWidth, 60, viewPort.clientWidth - 80)}px`;
        labels[i].style.top = `${THREE.MathUtils.clamp((1 - point.y) * .5 * viewPort.clientHeight, 60, viewPort.clientHeight - 110)}px`;
      });
    }
    orbit.update(); composer.render();
  } };
}
