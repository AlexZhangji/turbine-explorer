import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { profileShell, addHorizontalSplitDeck, caseRadiusAt, type CaseStation } from './sectioned-case.ts';
import { createInletSupportWebs } from './inlet-support.ts';

export type TurbineModel = {
  root: THREE.Group;
  rotor: THREE.Group;
  stator: THREE.Group;
  lowerCasing: THREE.Group;
  combustion: THREE.Group;
  combustorModules: THREE.Group[];
  casing: THREE.Group;
  casingSections: {
    compressor: THREE.Group;
    combustion: THREE.Group;
    turbine: THREE.Group;
  };
  exhaust: THREE.Group;
  flow: THREE.Points;
  operationGlow: THREE.Group;
  operationLights: THREE.PointLight[];
  rotorMotion: THREE.Group;
  rotorMotionMaterials: THREE.MeshBasicMaterial[];
  anchors: Record<string, THREE.Vector3>;
  metrics: { triangles: number; meshes: number; instances: number };
};

type RuntimeAxialStation = {
  id: string;
  x0: number;
  x1: number;
  family: 'inlet' | 'compressor' | 'diffuser' | 'combustion' | 'turbine' | 'exhaust';
  rowType: 'strut' | 'rotor-stator' | 'shell' | 'burner' | 'stator-rotor';
  count?: number;
  confidence: 'high' | 'medium';
};

const X_AXIS = new THREE.Vector3(1, 0, 0);

function physical(
  color: number,
  roughness: number,
  metalness = 1,
  clearcoat = 0,
  anisotropy = .08,
  anisotropyRotation = Math.PI / 2,
) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness,
    clearcoat,
    clearcoatRoughness: Math.min(.35, roughness),
    anisotropy,
    anisotropyRotation,
    envMapIntensity: 1.08,
  });
}

function createBrushedRoughnessMap(options: {
  size: number;
  repeat: THREE.Vector2Tuple;
  seed: number;
  base: number;
  variation: number;
}) {
  const { size, repeat, seed, base, variation } = options;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const longGrain = Math.sin((y + seed * 31) * 1.72 + Math.sin((x + seed * 17) * .19) * .75);
      const fineGrain = Math.sin((y + seed * 13) * 7.13 + x * .37) * .35;
      const drift = Math.sin((x + seed * 43) * .037 + y * .011) * .22;
      const value = Math.round(THREE.MathUtils.clamp(base + (longGrain + fineGrain + drift) * variation, 0, 255));
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createBrushedNormalMap() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const nx = Math.sin(y * 1.41 + Math.sin(x * .23)) * 7 + Math.sin(y * 5.7) * 3;
      const ny = Math.sin(x * .53 + y * .17) * 2.5;
      data[index] = Math.round(128 + nx);
      data[index + 1] = Math.round(128 + ny);
      data[index + 2] = 253;
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 12);
  texture.needsUpdate = true;
  return texture;
}

function createCircularAnisotropyMap(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const dx = (x + .5) / size - .5;
      const dy = (y + .5) / size - .5;
      const length = Math.max(.0001, Math.hypot(dx, dy));
      const tangentX = -dy / length;
      const tangentY = dx / length;
      const edgeFade = THREE.MathUtils.smoothstep(length, .08, .46);
      data[index] = Math.round((tangentX * .5 + .5) * 255);
      data[index + 1] = Math.round((tangentY * .5 + .5) * 255);
      data[index + 2] = Math.round(THREE.MathUtils.lerp(150, 232, edgeFade));
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function cylinderX(
  length: number,
  radiusA: number,
  radiusB: number,
  material: THREE.Material,
  radialSegments = 64,
  openEnded = false,
  thetaStart = 0,
  thetaLength = Math.PI * 2,
) {
  const geometry = new THREE.CylinderGeometry(
    radiusB,
    radiusA,
    length,
    radialSegments,
    1,
    openEnded,
    thetaStart,
    thetaLength,
  );
  geometry.rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function beveledDiscX(
  length: number,
  radius: number,
  bevel: number,
  material: THREE.Material,
  radialSegments = 64,
) {
  const half = length / 2;
  const edge = Math.min(bevel, half * .72, radius * .2);
  const points = [
    new THREE.Vector2(.015, -half),
    new THREE.Vector2(radius - edge, -half),
    new THREE.Vector2(radius, -half + edge),
    new THREE.Vector2(radius, half - edge),
    new THREE.Vector2(radius - edge, half),
    new THREE.Vector2(.015, half),
  ];
  const geometry = new THREE.LatheGeometry(points, radialSegments);
  geometry.rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function torusX(radius: number, tube: number, material: THREE.Material, arc = Math.PI * 2) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 72, arc), material);
  mesh.rotateY(Math.PI / 2);
  mesh.castShadow = true;
  return mesh;
}

function annulusX(
  innerRadius: number,
  outerRadius: number,
  material: THREE.Material,
  thetaStart = 0,
  thetaLength = Math.PI * 2,
) {
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 80, 1, thetaStart, thetaLength);
  geometry.rotateY(-Math.PI / 2);
  const faceMaterial = material.clone();
  faceMaterial.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geometry, faceMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function annularFrameX(
  innerRadius: number,
  outerRadius: number,
  depth: number,
  thetaStart: number,
  thetaLength: number,
  material: THREE.Material,
) {
  const thetaEnd = thetaStart + thetaLength;
  const shape = new THREE.Shape();
  shape.moveTo(Math.cos(thetaStart) * outerRadius, Math.sin(thetaStart) * outerRadius);
  shape.absarc(0, 0, outerRadius, thetaStart, thetaEnd, false);
  shape.lineTo(Math.cos(thetaEnd) * innerRadius, Math.sin(thetaEnd) * innerRadius);
  shape.absarc(0, 0, innerRadius, thetaEnd, thetaStart, true);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 72,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: .045,
    bevelThickness: .045,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function shellSectorX(
  length: number,
  radiusLeft: number,
  radiusRight: number,
  thickness: number,
  thetaStart: number,
  thetaLength: number,
  material: THREE.Material,
  segments = 56,
  innerMaterial: THREE.Material = material,
  cutMaterial: THREE.Material = material,
) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringCount = segments + 1;
  const addVertex = (x: number, radius: number, theta: number) => {
    positions.push(x, Math.sin(theta) * radius, Math.cos(theta) * radius);
  };

  for (let side = 0; side < 2; side++) {
    const x = side === 0 ? -length / 2 : length / 2;
    const outer = side === 0 ? radiusLeft : radiusRight;
    for (let layer = 0; layer < 2; layer++) {
      const radius = outer - layer * thickness;
      for (let i = 0; i <= segments; i++) {
        addVertex(x, radius, thetaStart + thetaLength * (i / segments));
        uvs.push(side, i / segments);
      }
    }
  }

  const row = (side: number, layer: number) => (side * 2 + layer) * ringCount;
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, b, d, a, d, c);

  const outerStart = indices.length;
  for (let i = 0; i < segments; i++) {
    quad(row(0, 0) + i, row(1, 0) + i, row(0, 0) + i + 1, row(1, 0) + i + 1);
  }
  const outerCount = indices.length - outerStart;
  const innerStart = indices.length;
  for (let i = 0; i < segments; i++) {
    quad(row(1, 1) + i, row(0, 1) + i, row(1, 1) + i + 1, row(0, 1) + i + 1);
  }
  const innerCount = indices.length - innerStart;
  const cutStart = indices.length;
  for (let i = 0; i < segments; i++) {
    quad(row(0, 1) + i, row(0, 0) + i, row(0, 1) + i + 1, row(0, 0) + i + 1);
    quad(row(1, 0) + i, row(1, 1) + i, row(1, 0) + i + 1, row(1, 1) + i + 1);
  }

  [0, segments].forEach((edge, edgeIndex) => {
    const a = row(0, 0) + edge;
    const b = row(1, 0) + edge;
    const c = row(0, 1) + edge;
    const d = row(1, 1) + edge;
    if (edgeIndex === 0) quad(c, d, a, b);
    else quad(a, b, c, d);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.addGroup(outerStart, outerCount, 0);
  geometry.addGroup(innerStart, innerCount, 1);
  geometry.addGroup(cutStart, indices.length - cutStart, 2);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, [material, innerMaterial, cutMaterial]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addShellCutLips(
  shell: THREE.Mesh,
  length: number,
  radiusLeft: number,
  radiusRight: number,
  thetaStart: number,
  thetaLength: number,
  material: THREE.Material,
  lipRadius = .028,
) {
  const makeLip = (theta: number) => {
    const curve = new THREE.LineCurve3(
      new THREE.Vector3(-length / 2, Math.sin(theta) * radiusLeft, Math.cos(theta) * radiusLeft),
      new THREE.Vector3(length / 2, Math.sin(theta) * radiusRight, Math.cos(theta) * radiusRight),
    );
    return new THREE.TubeGeometry(curve, 12, lipRadius, 8, false);
  };
  const merged = mergeGeometries([
    makeLip(thetaStart),
    makeLip(thetaStart + thetaLength),
  ], false);
  if (!merged) return;
  const lips = new THREE.Mesh(merged, material);
  lips.name = `${shell.name || 'shell'}-rounded-cut-lips`;
  lips.castShadow = true;
  lips.receiveShadow = true;
  shell.add(lips);
}

type BladeSpec = {
  span: number;
  chord: number;
  thickness: number;
  twist: number;
  sweep: number;
  lean: number;
  taper: number;
};

type CompressorStageProfile = {
  x: number;
  hub: number;
  tip: number;
  rotorCount: number;
  rotorChord: number;
  rotorTwist: number;
  rotorSweep: number;
  statorCount: number;
  statorChord: number;
};

function createCompressorStageProfile(index: number, stageCount: number): CompressorStageProfile {
  const t = index / (stageCount - 1);
  const frontStageBlend = Math.exp(-t * 8.5);

  // Keep the axial rhythm almost linear. The previous ease curve packed the
  // rear rows into a dark fence while the oversized front chords overlapped.
  const x = THREE.MathUtils.lerp(-5.02, .56, Math.pow(t, .96));
  const hub = THREE.MathUtils.lerp(.74, 1.16, Math.pow(t, .92));
  const tip = THREE.MathUtils.lerp(2.4, 1.5, Math.pow(t, .84));
  const rotorChord = THREE.MathUtils.lerp(.49, .16, Math.pow(t, .74)) + frontStageBlend * .2;

  return {
    x,
    hub,
    tip,
    rotorCount: index === 0 ? 22 : index === 1 ? 28 : Math.round(31 + t * 25),
    rotorChord,
    rotorTwist: THREE.MathUtils.lerp(.67, .2, Math.pow(t, .76)),
    rotorSweep: THREE.MathUtils.lerp(.16, .035, t),
    statorCount: index < 2 ? 30 + index * 4 : Math.round(36 + t * 22),
    statorChord: THREE.MathUtils.lerp(.22, .105, t),
  };
}

function createBladeGeometry(spec: BladeSpec) {
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const sectionCount = 12;
  const chordSamples = 16;
  const outlineCount = chordSamples * 2;

  for (let i = 0; i < sectionCount; i++) {
    const t = i / (sectionCount - 1);
    const radial = spec.span * t;
    const aerodynamicT = Math.max(0, (t - .055) / .945);
    const rootFlare = Math.exp(-t * 28);
    const chord = spec.chord * (1 - spec.taper * aerodynamicT) * (1 + .06 * rootFlare);
    const thick = spec.thickness * (1 - .46 * aerodynamicT) * (1 + .3 * rootFlare);
    const a = spec.twist * (.22 + .78 * Math.pow(t, .86));
    const centerX = spec.sweep * aerodynamicT * aerodynamicT + spec.chord * .025 * Math.sin(t * Math.PI);
    const centerZ = spec.lean * Math.sin(aerodynamicT * Math.PI * .82) + spec.chord * .018 * Math.sin(t * Math.PI);

    const pushPoint = (u: number, side: number) => {
      const axial = (u - .5) * chord;
      // A closed NACA-like foil gives the leading edge a real radius and keeps
      // the trailing edge crisp. Asymmetric camber makes the blade read as an
      // aerodynamic casting instead of a repeated decorative fin.
      const foil = .2969 * Math.sqrt(Math.max(u, 0))
        - .126 * u
        - .3516 * u * u
        + .2843 * u * u * u
        - .1036 * u * u * u * u;
      const halfThickness = thick * THREE.MathUtils.clamp(foil / .1001, 0, 1.05) * .5;
      const camberPeak = .42;
      const camberProfile = u < camberPeak
        ? (2 * camberPeak * u - u * u) / (camberPeak * camberPeak)
        : ((1 - 2 * camberPeak) + 2 * camberPeak * u - u * u) / ((1 - camberPeak) * (1 - camberPeak));
      const camber = thick * .38 * camberProfile * (1 - .16 * t);
      const tangential = camber + side * halfThickness;
      const x = centerX + axial * Math.cos(a) - tangential * Math.sin(a);
      const z = centerZ + axial * Math.sin(a) + tangential * Math.cos(a);
      vertices.push(x, radial, z);
      uvs.push(u, t);
    };

    for (let j = 0; j <= chordSamples; j++) pushPoint(j / chordSamples, 1);
    for (let j = chordSamples - 1; j >= 1; j--) pushPoint(j / chordSamples, -1);
  }

  for (let i = 0; i < sectionCount - 1; i++) {
    const row = i * outlineCount;
    const next = (i + 1) * outlineCount;
    for (let j = 0; j < outlineCount; j++) {
      const k = (j + 1) % outlineCount;
      indices.push(row + j, next + k, next + j, row + j, row + k, next + k);
    }
  }

  const rootCenter = vertices.length / 3;
  vertices.push(0, 0, 0);
  uvs.push(.5, 0);
  const tipCenter = rootCenter + 1;
  vertices.push(spec.sweep, spec.span, spec.lean * Math.sin(Math.PI * .8));
  uvs.push(.5, 1);
  const tipRow = (sectionCount - 1) * outlineCount;
  for (let j = 0; j < outlineCount; j++) {
    const k = (j + 1) % outlineCount;
    indices.push(rootCenter, k, j);
    indices.push(tipCenter, tipRow + j, tipRow + k);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createTransitionDuctGeometry() {
  const positions: number[] = [];
  const indices: number[] = [];
  const samples = 18;
  const sections = [
    { x: 1.85, radial: 2.67, radialRadius: .33, tangentRadius: .29, corner: 2.05 },
    { x: 2.07, radial: 2.35, radialRadius: .3, tangentRadius: .3, corner: 2.2 },
    { x: 2.37, radial: 1.94, radialRadius: .26, tangentRadius: .31, corner: 2.55 },
    { x: 2.78, radial: 1.68, radialRadius: .24, tangentRadius: .315, corner: 2.85 },
  ];

  for (const wallInset of [0, .045]) for (const section of sections) {
    for (let i = 0; i < samples; i++) {
      const angle = (i / samples) * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const radialShape = Math.sign(cosine) * Math.pow(Math.abs(cosine), 2 / section.corner);
      const tangentShape = Math.sign(sine) * Math.pow(Math.abs(sine), 2 / section.corner);
      positions.push(
        section.x,
        section.radial + radialShape * (section.radialRadius - wallInset),
        tangentShape * (section.tangentRadius - wallInset),
      );
    }
  }

  const layerSize = sections.length * samples;
  for (let layer = 0; layer < 2; layer++) for (let section = 0; section < sections.length - 1; section++) {
    const row = layer * layerSize + section * samples;
    const next = row + samples;
    for (let i = 0; i < samples; i++) {
      const j = (i + 1) % samples;
      if (layer === 0) indices.push(row + i, next + j, next + i, row + i, row + j, next + j);
      else indices.push(row + i, next + i, next + j, row + i, next + j, row + j);
    }
  }

  // Open gas passages with wall thickness, not solid black end plugs.
  for (const end of [0, sections.length - 1]) for (let i = 0; i < samples; i++) {
    const j = (i + 1) % samples;
    const a = end * samples + i, b = end * samples + j;
    const c = a + layerSize, d = b + layerSize;
    if (end === 0) indices.push(a, c, d, a, d, b);
    else indices.push(a, b, d, a, d, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addBladeRow(options: {
  parent: THREE.Group;
  x: number;
  hub: number;
  tip: number;
  count: number;
  chord: number;
  twist: number;
  sweep: number;
  lean: number;
  taper?: number;
  material: THREE.Material;
  name: string;
  phase?: number;
}) {
  const geometry = createBladeGeometry({
    span: options.tip - options.hub,
    chord: options.chord,
    thickness: Math.max(.03, options.chord * .12),
    twist: options.twist,
    sweep: options.sweep,
    lean: options.lean,
    taper: options.taper ?? .27,
  });
  const blades = new THREE.InstancedMesh(geometry, options.material, options.count);
  blades.name = options.name;
  blades.userData.bladeRow = { x: options.x, hub: options.hub, tip: options.tip, count: options.count, role: options.name.includes('rotor') ? 'rotating' : 'stationary' };
  const dummy = new THREE.Object3D();
  for (let i = 0; i < options.count; i++) {
    dummy.position.set(options.x, 0, 0);
    dummy.rotation.set((options.phase ?? 0) + (i / options.count) * Math.PI * 2, 0, 0);
    dummy.updateMatrix();
    const radial = new THREE.Matrix4().makeTranslation(0, options.hub, 0);
    dummy.matrix.multiply(radial);
    blades.setMatrixAt(i, dummy.matrix);
  }
  blades.instanceMatrix.needsUpdate = true;
  blades.castShadow = true;
  blades.receiveShadow = true;
  options.parent.add(blades);
  return blades;
}

function addRadialStruts(
  parent: THREE.Group,
  x: number,
  hub: number,
  tip: number,
  count: number,
  material: THREE.Material,
  angles?: number[],
) {
  const shape = new THREE.Shape();
  shape.moveTo(-.16, hub);
  shape.lineTo(.16, hub);
  shape.lineTo(.105, tip - .14);
  shape.quadraticCurveTo(.08, tip, 0, tip + .025);
  shape.quadraticCurveTo(-.08, tip, -.105, tip - .14);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: .22,
    bevelEnabled: true,
    bevelSize: .025,
    bevelThickness: .025,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geometry.translate(0, 0, -.11);
  const strutAngles = angles ?? Array.from({ length: count }, (_, i) => (i / count) * Math.PI * 2);
  const struts = new THREE.InstancedMesh(geometry, material, strutAngles.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < strutAngles.length; i++) {
    dummy.position.x = x;
    dummy.rotation.x = strutAngles[i];
    dummy.updateMatrix();
    struts.setMatrixAt(i, dummy.matrix);
  }
  struts.castShadow = true;
  parent.add(struts);
}

function addTransitionDuctRing(
  parent: THREE.Group,
  x: number,
  radius: number,
  count: number,
  material: THREE.Material,
) {
  const geometry = createTransitionDuctGeometry();
  geometry.translate(0, radius, 0);
  const ducts = new THREE.InstancedMesh(geometry, material, count);
  ducts.name = 'combustion-transition-ducts';
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    dummy.position.set(x, 0, 0);
    dummy.rotation.set((i / count) * Math.PI * 2 + .08, 0, 0);
    dummy.updateMatrix();
    ducts.setMatrixAt(i, dummy.matrix);
  }
  ducts.instanceMatrix.needsUpdate = true;
  ducts.castShadow = true;
  ducts.receiveShadow = true;
  parent.add(ducts);
}

function addBoltRing(parent: THREE.Group, x: number, radius: number, count: number, size: number, material: THREE.Material) {
  const geometry = new THREE.CylinderGeometry(size, size, size * .7, 12);
  geometry.rotateZ(Math.PI / 2);
  const bolts = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    dummy.position.set(x, Math.cos(a) * radius, Math.sin(a) * radius);
    dummy.rotation.set(a, 0, 0);
    dummy.updateMatrix();
    bolts.setMatrixAt(i, dummy.matrix);
  }
  bolts.castShadow = true;
  parent.add(bolts);
}

function addLiftingLug(parent: THREE.Group, x: number, z: number, material: THREE.Material, stations: CaseStation[]) {
  const shape = new THREE.Shape();
  shape.moveTo(-.24, 0);
  shape.lineTo(.24, 0);
  shape.lineTo(.24, .18);
  shape.quadraticCurveTo(.2, .42, 0, .46);
  shape.quadraticCurveTo(-.2, .42, -.24, .18);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absellipse(0, .29, .082, .082, 0, Math.PI * 2, false, 0);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: .18,
    bevelEnabled: true,
    bevelSize: .025,
    bevelThickness: .025,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -.09);
  const position = geometry.getAttribute('position');
  // Conform the foot to its casting rather than leaving it at a fixed height.
  for (let i = 0; i < position.count; i++) {
    const r = caseRadiusAt(stations, x + position.getX(i));
    const circumZ = z + position.getZ(i);
    position.setY(i, position.getY(i) + Math.sqrt(Math.max(0, r * r - circumZ * circumZ)) - .035);
  }
  geometry.computeVertexNormals();
  const lug = new THREE.Mesh(geometry, material);
  lug.position.set(x, 0, z);
  lug.name = 'surface-attached-lifting-lug';
  lug.userData.attachment = { parentSocket: 'upper-casting-surface', contactType: 'embedded', embedDepth: .035, stations };
  lug.castShadow = true;
  lug.receiveShadow = true;
  parent.add(lug);
}

function addInspectionPortZ(
  parent: THREE.Group,
  x: number,
  y: number,
  z: number,
  radius: number,
  materials: Record<string, THREE.Material>,
) {
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.16, radius * 1.28, .18, 36), materials.casing);
  boss.rotation.x = Math.PI / 2;
  boss.position.set(x, y, z);
  boss.castShadow = true;
  parent.add(boss);
  const cover = beveledDiscX(.07, radius, radius * .1, materials.machinedFace, 48);
  cover.rotation.y = Math.PI / 2;
  cover.position.set(x, y, z - .12);
  cover.castShadow = true;
  parent.add(cover);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.2, .038, 10, 48), materials.machinedFace);
  rim.position.set(x, y, z - .14);
  rim.castShadow = true;
  parent.add(rim);

  const boltCount = 8;
  const boltGeometry = new THREE.CylinderGeometry(radius * .055, radius * .055, .045, 10);
  boltGeometry.rotateX(Math.PI / 2);
  const bolts = new THREE.InstancedMesh(boltGeometry, materials.dark, boltCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < boltCount; i++) {
    const a = (i / boltCount) * Math.PI * 2;
    dummy.position.set(x + Math.cos(a) * radius * .76, y + Math.sin(a) * radius * .76, z - .168);
    dummy.updateMatrix();
    bolts.setMatrixAt(i, dummy.matrix);
  }
  bolts.instanceMatrix.needsUpdate = true;
  bolts.castShadow = true;
  parent.add(bolts);
}

function addSplitFlange(
  parent: THREE.Group,
  x: number,
  length: number,
  z: number,
  clampCount: number,
  materials: Record<string, THREE.Material>,
  y = 0,
) {
  const flangeShape = new THREE.Shape();
  flangeShape.moveTo(-length / 2, -.19);
  flangeShape.lineTo(length / 2, -.19);
  flangeShape.lineTo(length / 2, .12);
  flangeShape.lineTo(length * .3, .18);
  flangeShape.lineTo(-length * .28, .16);
  flangeShape.lineTo(-length / 2, .1);
  flangeShape.closePath();
  const holeCount = Math.max(4, Math.round(length / .46));
  for (let i = 0; i < holeCount; i++) {
    const hole = new THREE.Path();
    const holeX = THREE.MathUtils.lerp(-length * .44, length * .44, holeCount === 1 ? .5 : i / (holeCount - 1));
    hole.absellipse(holeX, 0, .052, .052, 0, Math.PI * 2, false, 0);
    flangeShape.holes.push(hole);
  }
  const flangeGeometry = new THREE.ExtrudeGeometry(flangeShape, {
    depth: .56,
    curveSegments: 8,
    bevelEnabled: true,
    bevelSize: .012,
    bevelThickness: .012,
    bevelSegments: 1,
  });
  flangeGeometry.translate(0, 0, -.28);
  const beam = new THREE.Mesh(flangeGeometry, materials.cut);
  beam.position.set(x, y, z);
  beam.castShadow = true;
  beam.receiveShadow = true;
  parent.add(beam);
  if (clampCount <= 0) return;
  const clampGeo = new THREE.BoxGeometry(.42, .4, .48);
  const clamps = new THREE.InstancedMesh(clampGeo, materials.cast ?? materials.casing, clampCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < clampCount; i++) {
    dummy.position.set(
      x + THREE.MathUtils.lerp(-length * .42, length * .42, clampCount === 1 ? .5 : i / (clampCount - 1)),
      y,
      z + .04,
    );
    dummy.updateMatrix();
    clamps.setMatrixAt(i, dummy.matrix);
  }
  clamps.instanceMatrix.needsUpdate = true;
  clamps.castShadow = true;
  parent.add(clamps);
}

function addCombustors(parent: THREE.Group, materials: Record<string, THREE.Material>) {
  const count = 16;
  const mountGeo = new THREE.CylinderGeometry(.46, .54, .4, 40, 1, false);
  const bodyGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0, -.33), new THREE.Vector2(.42, -.33),
    new THREE.Vector2(.44, -.3), new THREE.Vector2(.43, -.24),
    new THREE.Vector2(.35, .27), new THREE.Vector2(.34, .33), new THREE.Vector2(0, .33),
  ], 48);
  const collarGeo = new THREE.TorusGeometry(.47, .055, 10, 40);
  collarGeo.rotateX(Math.PI / 2);
  const headGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0, -.08), new THREE.Vector2(.52, -.08),
    new THREE.Vector2(.55, -.05), new THREE.Vector2(.55, .05),
    new THREE.Vector2(.52, .08), new THREE.Vector2(0, .08),
  ], 48);
  const faceGeo = new THREE.CylinderGeometry(.43, .43, .045, 40);
  const faceRingGeo = new THREE.TorusGeometry(.36, .035, 10, 40);
  faceRingGeo.rotateX(Math.PI / 2);
  const nozzleGeo = new THREE.CylinderGeometry(.075, .11, .17, 16);
  const transitionGeo = createTransitionDuctGeometry();
  const boltGeo = new THREE.CylinderGeometry(.029, .029, .07, 10);
  const fuelTipGeo = new THREE.CylinderGeometry(.035, .052, .16, 12);
  const fuelFeedGeo = new THREE.CylinderGeometry(.038, .048, .3, 10);

  const modules: THREE.Group[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / 16;
    const module = new THREE.Group();
    module.name = `combustor-module-${String(i + 1).padStart(2, '0')}`;
    // Cutaway changes visibility only, never the actual assembly transforms.
    // Retain every module mounted on the lower casing (local y <= 0),
    // on both sides of the shaft. Do not curate a camera-facing subset.
    module.userData.cutawayVisible = Math.cos(a) <= 0;
    const displayAngle = a;
    module.rotation.x = displayAngle;
    module.userData.serviceDirection = new THREE.Vector3(0, Math.cos(displayAngle), Math.sin(displayAngle));
    module.userData.baseRotationX = displayAngle;
    module.userData.referenceFeature = 'combustor end cover and fuel nozzle cluster';
    module.visible = module.userData.cutawayVisible;

    const place = (target: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, radial: number) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, radial, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      target.add(mesh);
      return mesh;
    };

    // Each visible cover is carried by a radial mounting boss that overlaps the plenum shell.
    // The transition piece then turns the flow axially into the first turbine nozzle.
    const can = new THREE.Group();
    can.name = 'combustor-can-and-end-cover';
    can.position.set(1.85, 2.67, 0);
    can.rotation.z = .36;
    can.scale.setScalar(1.1);
    module.add(can);
    place(can, mountGeo, materials.cast, 0, 0);
    place(can, bodyGeo, materials.cast, 0, .44);
    place(can, collarGeo, materials.cut, 0, .77);
    place(can, headGeo, materials.machinedFace, 0, .85);
    place(can, faceGeo, materials.machinedFace, 0, .955);
    place(can, faceRingGeo, materials.rotorEdge, 0, .982);
    place(can, nozzleGeo, materials.rotorEdge, 0, 1.09);
    const transition = place(module, transitionGeo, materials.hotEdge, 0, 0);
    transition.name = 'connected-combustor-transition';
    transition.userData.attachment = { parentSocket: 'combustor-can-base', localStart: [1.85, 2.67, 0], localEnd: [2.78, 1.68, 0], exactness: 'explanatory' };
    place(module, fuelFeedGeo, materials.pipe, 1.6, 3.22);

    const bolts = new THREE.InstancedMesh(boltGeo, materials.dark, 12);
    const bolt = new THREE.Object3D();
    for (let j = 0; j < 12; j++) {
      const b = (j / 12) * Math.PI * 2;
      bolt.position.set(Math.cos(b) * .395, .995, Math.sin(b) * .395);
      bolt.updateMatrix();
      bolts.setMatrixAt(j, bolt.matrix);
    }
    bolts.instanceMatrix.needsUpdate = true;
    bolts.castShadow = true;
    can.add(bolts);

    const fuelTips = new THREE.InstancedMesh(fuelTipGeo, materials.pipe, 5);
    const fuelTip = new THREE.Object3D();
    for (let j = 0; j < 5; j++) {
      const b = (j / 5) * Math.PI * 2 + Math.PI / 10;
      fuelTip.position.set(Math.cos(b) * .18, 1.055, Math.sin(b) * .18);
      fuelTip.updateMatrix();
      fuelTips.setMatrixAt(j, fuelTip.matrix);
    }
    fuelTips.instanceMatrix.needsUpdate = true;
    fuelTips.castShadow = true;
    can.add(fuelTips);
    modules.push(module);
    parent.add(module);
  }

  return modules;
}

function writeFlowColor(target: Float32Array, index: number, x: number) {
  const color = new THREE.Color();
  if (x < .75) {
    const t = THREE.MathUtils.clamp((x + 6.1) / 6.85, 0, 1);
    color.setRGB(.16 + t * .1, .62 + t * .18, 1);
  } else if (x < 2.75) {
    const t = (x - .75) / 2;
    color.setRGB(THREE.MathUtils.lerp(.35, 1, t), THREE.MathUtils.lerp(.82, .42, t), THREE.MathUtils.lerp(1, .08, t));
  } else if (x < 5.35) {
    const t = (x - 2.75) / 2.6;
    color.setRGB(1, THREE.MathUtils.lerp(.34, .12, t), THREE.MathUtils.lerp(.045, .02, t));
  } else {
    const t = THREE.MathUtils.clamp((x - 5.35) / 2.75, 0, 1);
    color.setRGB(1, THREE.MathUtils.lerp(.24, .62, t), THREE.MathUtils.lerp(.06, .3, t));
  }
  target[index * 3] = color.r;
  target[index * 3 + 1] = color.g;
  target[index * 3 + 2] = color.b;
}

function createFlow(material: THREE.PointsMaterial) {
  const count = 760;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  let seed = 0x9a02f10;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < count; i++) {
    const x = -6.1 + random() * 13.5;
    const t = (x + 6.1) / 13.5;
    const radius = x < .9 ? 1.1 + (1 - t) * .8 : 1.15 + Math.max(0, t - .55) * 2.3;
    const a = i % 3 === 0 ? random() * Math.PI * 2 : random() * Math.PI;
    positions[i * 3] = x;
    positions[i * 3 + 1] = Math.cos(a) * radius * (.55 + random() * .42);
    positions[i * 3 + 2] = Math.sin(a) * radius * (.55 + random() * .42);
    writeFlowColor(colors, i, x);
    phase[i] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  const points = new THREE.Points(geometry, material);
  points.visible = false;
  points.userData.basePositions = positions.slice();
  return points;
}

export function createTurbineModel(): TurbineModel {
  const root = new THREE.Group();
  root.name = 'GE-9HA-cutaway';
  root.rotation.y = -.045;
  root.rotation.x = .22;

  const rotor = new THREE.Group();
  rotor.name = 'rotor';
  const stator = new THREE.Group();
  stator.name = 'stator';
  const combustion = new THREE.Group();
  combustion.name = 'combustion';
  const casing = new THREE.Group();
  casing.name = 'casing';
  const compressorCasing = new THREE.Group();
  compressorCasing.name = 'compressor-upper-casing';
  const combustionCasing = new THREE.Group();
  combustionCasing.name = 'combustion-upper-casing';
  const turbineCasing = new THREE.Group();
  turbineCasing.name = 'turbine-upper-casing';
  casing.add(compressorCasing, combustionCasing, turbineCasing);
  const exhaust = new THREE.Group();
  exhaust.name = 'exhaust';
  root.add(rotor, stator, combustion, casing, exhaust);

  const materials = {
    rotor: physical(0x626d72, .42, .92, 0, 0),
    rotorEdge: physical(0x737a7b, .34, .98, 0, .1),
    stator: physical(0x535e62, .44, .94, 0, 0),
    casing: physical(0xa6b0b3, .52, .90, 0, .06, 0),
    cast: physical(0x7d898e, .64, .88, 0, 0, 0),
    casingInner: physical(0x747b7c, .43, .82, 0, .03, 0),
    hotCasingInner: physical(0x5f686a, .46, .82, 0, .03, 0),
    // Section caps share collapsed axial UVs with the shell. Keep their finish
    // isotropic so the tangent basis cannot turn the cut face into speckled metal.
    cut: physical(0xc7ccca, .34, .68, .01, 0),
    machinedFace: physical(0xc9cdca, .28, .99, 0, 0),
    dark: physical(0x10171b, .55, .68, 0, 0),
    hot: physical(0x514b42, .48, .92, 0, 0),
    hotEdge: physical(0x918574, .38, .96, 0, 0),
    pipe: physical(0x637178, .4, .9, .02, .18),
    seal: physical(0x716956, .4, .86, 0, .05),
    exhaustInner: physical(0x7c898f, .3, .95, .02, .22),
  };
  const casingRoughness = createBrushedRoughnessMap({
    size: 512,
    repeat: [1.1, 11],
    seed: .73,
    base: 220,
    variation: 6,
  });
  const bladeRoughness = createBrushedRoughnessMap({
    size: 256,
    repeat: [3.5, 8],
    seed: 2.17,
    base: 226,
    variation: 9,
  });
  const machinedRoughness = createBrushedRoughnessMap({
    size: 256,
    repeat: [2.2, 24],
    seed: 4.31,
    base: 216,
    variation: 14,
  });
  const brushedNormal = createBrushedNormalMap();
  // This material spans planar caps, cylindrical shafts and axial lofts.
  // A circular tangent map is invalid on the latter two and crumples their reflections.
  [materials.casing, materials.cast, materials.casingInner, materials.hotCasingInner, materials.cut, materials.machinedFace].forEach((material) => {
    material.side = THREE.DoubleSide;
  });
  [materials.rotor, materials.rotorEdge, materials.stator, materials.hot, materials.hotEdge].forEach((material) => {
    material.roughnessMap = bladeRoughness;
  });
  [materials.casing, materials.cast, materials.casingInner, materials.hotCasingInner].forEach((material) => {
    material.roughnessMap = casingRoughness;
  });
  [materials.cut, materials.machinedFace, materials.pipe, materials.exhaustInner].forEach((material) => {
    material.roughnessMap = machinedRoughness;
  });
  [materials.pipe, materials.exhaustInner].forEach((material) => {
    material.normalMap = brushedNormal;
    const normalStrength = .035;
    material.normalScale.set(normalStrength, normalStrength);
  });
  materials.rotor.envMapIntensity = .96;
  materials.rotorEdge.envMapIntensity = 1.08;
  materials.stator.envMapIntensity = .92;
  materials.dark.envMapIntensity = .52;
  materials.hot.envMapIntensity = .72;
  materials.hotEdge.envMapIntensity = .83;
  materials.casing.envMapIntensity = 1.38;
  materials.cast.envMapIntensity = 1.02;
  materials.casingInner.envMapIntensity = .76;
  materials.hotCasingInner.envMapIntensity = .78;
  materials.cut.envMapIntensity = 1.22;
  materials.machinedFace.envMapIntensity = 1.12;
  materials.pipe.envMapIntensity = .82;
  materials.seal.envMapIntensity = .7;
  materials.exhaustInner.envMapIntensity = .92;

  const shaft = cylinderX(14.8, .34, .48, materials.rotorEdge, 48);
  shaft.position.x = .2;
  rotor.add(shaft);
  const compressorDrum = cylinderX(5.72, .7, 1.13, materials.rotor, 64);
  compressorDrum.position.x = -2.22;
  rotor.add(compressorDrum);
  const dischargeSpool = cylinderX(2.15, 1.12, .9, materials.rotorEdge, 64);
  dischargeSpool.position.x = 1.58;
  rotor.add(dischargeSpool);
  [-.05, .62, 1.35, 2.18].forEach((x, i) => {
    const collar = cylinderX(.11, 1.13 - i * .055, 1.13 - i * .055, i === 0 ? materials.cut : materials.rotorEdge, 56);
    collar.position.x = x;
    rotor.add(collar);
  });
  const turbineInletSpool = cylinderX(.68, .9, 1.08, materials.rotorEdge, 64);
  turbineInletSpool.position.x = 2.62;
  rotor.add(turbineInletSpool);
  const turbineDrum = cylinderX(2.08, 1.05, 1.34, materials.rotor, 72);
  turbineDrum.position.x = 3.78;
  rotor.add(turbineDrum);
  const aftTurbineSpool = cylinderX(.92, 1.34, .84, materials.rotorEdge, 64);
  aftTurbineSpool.position.x = 5.06;
  rotor.add(aftTurbineSpool);

  const compressorStages = 14;
  const compressorStageProfiles = Array.from(
    { length: compressorStages },
    (_, index) => createCompressorStageProfile(index, compressorStages),
  );
  for (let i = 0; i < compressorStages; i++) {
    const t = i / (compressorStages - 1);
    const profile = compressorStageProfiles[i];
    const rotorMaterial = (i === 0
      ? materials.cut
      : i === 1
        ? materials.rotorEdge
        : materials.rotor).clone();
    rotorMaterial.roughness = THREE.MathUtils.clamp(rotorMaterial.roughness + Math.sin(i * 1.73) * .02, .32, .52);
    rotorMaterial.anisotropy = 0;
    rotorMaterial.color.offsetHSL(0, 0, ((i % 3) - 1) * .01);
    rotorMaterial.color.lerp(new THREE.Color(0x0c1216), Math.max(0, t - .08) * .16);
    addBladeRow({
      parent: rotor,
      x: profile.x,
      hub: profile.hub,
      tip: profile.tip,
      count: profile.rotorCount,
      chord: profile.rotorChord,
      twist: profile.rotorTwist,
      sweep: profile.rotorSweep,
      lean: .055,
      taper: i === 0 ? .48 : THREE.MathUtils.lerp(.36, .24, t),
      material: rotorMaterial,
      name: `compressor-rotor-${String(i + 1).padStart(2, '0')}`,
      phase: i * .071,
    });
    const discMaterial = i === 0 ? materials.machinedFace : materials.rotor;
    const disc = beveledDiscX(i === 0 ? .18 : .1, profile.hub + (i === 0 ? .14 : .035), i === 0 ? .04 : .022, discMaterial, 48);
    disc.position.x = profile.x;
    rotor.add(disc);
    if (i === 0) {
      const firstStageGroove = torusX(profile.hub + .09, .026, materials.rotorEdge);
      firstStageGroove.position.x = profile.x - .105;
      rotor.add(firstStageGroove);
      addBoltRing(rotor, profile.x - .115, profile.hub - .02, 16, .026, materials.dark);
    }

    if (i < compressorStages - 1) {
      const nextProfile = compressorStageProfiles[i + 1];
      const statorMaterial = materials.stator.clone();
      statorMaterial.anisotropy = 0;
      statorMaterial.roughness = THREE.MathUtils.clamp(statorMaterial.roughness + Math.cos(i * 1.31) * .03, .22, .44);
      statorMaterial.color.offsetHSL(0, 0, ((i % 4) - 1.5) * .008);
      statorMaterial.color.lerp(new THREE.Color(0x2b353a), Math.max(0, t - .12) * .1);
      addBladeRow({
        parent: stator,
        x: profile.x + (nextProfile.x - profile.x) * .5,
        hub: profile.hub + .055,
        tip: profile.tip - .06,
        count: profile.statorCount,
        chord: profile.statorChord,
        twist: THREE.MathUtils.lerp(-.31, -.14, t),
        sweep: -.035,
        lean: -.03,
        taper: .3,
        material: statorMaterial,
        name: `compressor-stator-${String(i + 1).padStart(2, '0')}`,
        phase: .11 + i * .047,
      });
    }
  }

  const frontHub = cylinderX(.95, .62, .78, materials.rotorEdge, 48);
  frontHub.position.x = -5.62;
  rotor.add(frontHub);
  const frontJournal = cylinderX(3.2, .4, .61, materials.machinedFace, 64);
  frontJournal.name = 'front-bearing-journal';
  frontJournal.position.x = -6.65;
  rotor.add(frontJournal);
  [-5.88, -6.18, -7.86].forEach((x, index) => {
    const radii = [.635, .59, .49];
    const sealBand = cylinderX(.06, radii[index], radii[index], materials.seal, 48);
    sealBand.position.x = x;
    rotor.add(sealBand);
  });
  const diffuser = cylinderX(1.06, 1.62, 2.1, materials.casing, 64, true, .18 * Math.PI, 1.42 * Math.PI);
  diffuser.position.x = .92;
  combustionCasing.add(diffuser);
  const combustorModules = addCombustors(combustion, materials);
  const fuelManifold = torusX(3.08, .05, materials.pipe, Math.PI * .7);
  fuelManifold.position.x = 1.6;
  fuelManifold.rotation.x = Math.PI * 1.15;
  combustion.add(fuelManifold);
  const combustionLiner = shellSectorX(1.72, 1.48, 1.92, .13, Math.PI, Math.PI, materials.hotEdge, 64, materials.dark, materials.hot);
  combustionLiner.position.x = 1.72;
  combustion.add(combustionLiner);
  const linerFront = annulusX(1.35, 1.93, materials.hot, Math.PI, Math.PI);
  linerFront.position.x = .86;
  combustion.add(linerFront);
  const linerRear = annulusX(1.48, 1.94, materials.hot, Math.PI, Math.PI);
  linerRear.position.x = 2.58;
  combustion.add(linerRear);

  const turbineXs = [3.06, 3.7, 4.35, 5.02];
  const turbineHeatTints = [0x6a554b, 0x535258, 0x474f55, 0x526067].map((color) => new THREE.Color(color));
  turbineXs.forEach((x, i) => {
    const hub = 1.05 + i * .085;
    // Official side view: the turbine annulus expands toward the exhaust.
    const tip = 2.3 + i * .16;
    const nozzleMaterial = materials.hot.clone();
    nozzleMaterial.roughness = .34 + i * .016;
    nozzleMaterial.color.lerp(turbineHeatTints[i], .24 - i * .025);
    addBladeRow({
      parent: stator,
      x: x - .28,
      hub,
      tip,
      count: 34 + i * 4,
      chord: .16 + i * .006,
      twist: -.27,
      sweep: -.015,
      lean: .04,
      taper: .2,
      material: nozzleMaterial,
      name: `turbine-stator-${i + 1}`,
      phase: .06 + i * .09,
    });
    const turbineRotorMaterial = (i === 0 ? materials.hotEdge : materials.hot).clone();
    turbineRotorMaterial.roughness = .29 + i * .024;
    turbineRotorMaterial.color.lerp(turbineHeatTints[i], .3 - i * .035);
    addBladeRow({
      parent: rotor,
      x,
      hub,
      tip,
      count: 32 + i * 5,
      chord: .28 + i * .008,
      twist: .34,
      sweep: .025,
      lean: -.055,
      taper: .18,
      material: turbineRotorMaterial,
      name: `turbine-rotor-${i + 1}`,
      phase: .12 + i * .115,
    });
    const rotorShroud = cylinderX(.055, tip + .035, tip + .035, materials.hot, 72, true);
    rotorShroud.position.x = x;
    rotor.add(rotorShroud);
    const stageRim = torusX(tip + .075, .045, i === 0 ? materials.cut : materials.hotEdge);
    stageRim.name = `turbine-stage-rim-${i + 1}`;
    stageRim.position.x = x - .225;
    stator.add(stageRim);
    const disc = beveledDiscX(.25, hub + .34, .05, i === 0 ? materials.hotEdge : materials.rotor, 64);
    disc.position.x = x;
    rotor.add(disc);
    const discFace = beveledDiscX(.06, hub + .4, .02, materials.hotEdge, 64);
    discFace.position.x = x - .135;
    rotor.add(discFace);
    const discShoulder = beveledDiscX(.075, hub + .08, .02, i === 0 ? materials.cut : materials.hot, 56);
    discShoulder.position.x = x - .18;
    rotor.add(discShoulder);
    const faceGroove = torusX(hub + .18, .022, materials.hotEdge);
    faceGroove.position.x = x - .166;
    rotor.add(faceGroove);
    const innerFaceGroove = torusX(hub * .72, .012, materials.dark);
    innerFaceGroove.position.x = x - .168;
    rotor.add(innerFaceGroove);
    if (i < turbineXs.length - 1) {
      const nextX = turbineXs[i + 1];
      const sealRadius = hub + .09;
      const labyrinthSeal = cylinderX(.045, sealRadius, sealRadius, materials.seal, 56);
      labyrinthSeal.position.x = x + (nextX - x) * .52;
      rotor.add(labyrinthSeal);
    }
    addBoltRing(rotor, x - .17, hub + .12, 18 + i * 2, .03, materials.dark);
  });

  // One physical split plane throughout the machine. Every retained casting is
  // below y=0; its machined joint face and bolt holes point upward.
  const caseSections: { name: string; upper: THREE.Group; stations: CaseStation[] }[] = [
    { name: 'inlet', upper: compressorCasing, stations: [
      { x: -8.4, r: 2.96, wall: .49, lip: .16 },
      { x: -8.2, r: 2.96, wall: .49, lip: .16 },
      { x: -8.05, r: 2.72, wall: .23, lip: .3 },
      { x: -7.55, r: 2.48, wall: .24, lip: .33 },
      { x: -6.85, r: 2.38, wall: .24, lip: .37 },
      { x: -6.25, r: 2.47, wall: .23, lip: .32 },
      { x: -5.65, r: 2.68, wall: .23, lip: .26 },
      { x: -5.35, r: 2.76, wall: .29, lip: .24 },
    ] },
    { name: 'compressor', upper: compressorCasing, stations: [
      { x: -5.35, r: 2.76, wall: .29, lip: .24 },
      { x: -4.9, r: 2.66, wall: .23, lip: .26 },
      { x: -3.65, r: 2.44, wall: .22, lip: .28 },
      { x: -2.3, r: 2.24, wall: .22, lip: .26 },
      { x: -.9, r: 2.05, wall: .22, lip: .3 },
      { x: .72, r: 1.94, wall: .23, lip: .32 },
    ] },
    { name: 'combustion', upper: combustionCasing, stations: [
      { x: .72, r: 1.94, wall: .23, lip: .32 },
      { x: 1.02, r: 2.14, wall: .26, lip: .48 },
      { x: 1.48, r: 2.84, wall: .3, lip: .33 },
      { x: 2.8, r: 2.86, wall: .3, lip: .32 },
    ] },
    { name: 'turbine', upper: turbineCasing, stations: [
      { x: 2.8, r: 2.86, wall: .24, lip: .32 },
      { x: 3.45, r: 2.94, wall: .24, lip: .28 },
      { x: 4.65, r: 3.13, wall: .23, lip: .25 },
      { x: 5.5, r: 3.19, wall: .24, lip: .22 },
    ] },
  ];
  const caseMetals = { outer: materials.casing, inner: materials.casingInner, cut: materials.cut };
  const lowerCasing = new THREE.Group();
  lowerCasing.name = 'lower-casing-assembly';
  lowerCasing.userData.role = 'stationary-casing';
  stator.add(lowerCasing);
  for (const section of caseSections) {
    const pitch = section.name === 'inlet' ? .3 : section.name === 'combustion' ? .21 : .25;
    lowerCasing.add(profileShell(section.stations, caseMetals, Math.PI, Math.PI, section.name + '-retained-lower-casting'));
    section.upper.add(profileShell(section.stations, caseMetals, 0, Math.PI, section.name + '-removable-upper-casting'));
    addHorizontalSplitDeck(lowerCasing, section.stations, materials.cut, 1, false, pitch);
    addHorizontalSplitDeck(lowerCasing, section.stations, materials.cut, -1, false, pitch);
    addHorizontalSplitDeck(section.upper, section.stations, materials.cut, 1, true, pitch);
    addHorizontalSplitDeck(section.upper, section.stations, materials.cut, -1, true, pitch);
  }
  // Lower circumferential reinforcing bands meet the same horizontal split.
  [
    { x: -8.32, r: 3.05, wall: .57, width: .16 },
    { x: -5.31, r: 2.86, wall: .39, width: .18 },
    { x: -3.68, r: 2.52, wall: .29, width: .12 },
    { x: -.85, r: 2.13, wall: .3, width: .12 },
    { x: 2.82, r: 2.98, wall: .36, width: .18 },
    { x: 5.42, r: 3.29, wall: .34, width: .14 },
  ].forEach(({ x, r, wall, width }) => {
    lowerCasing.add(profileShell([{ x: x - width / 2, r, wall }, { x: x + width / 2, r, wall }], caseMetals, Math.PI, Math.PI, 'lower-casting-reinforcement'));
    const upper = x < .72 ? compressorCasing : x < 2.8 ? combustionCasing : turbineCasing;
    upper.add(profileShell([{ x: x - width / 2, r, wall }, { x: x + width / 2, r, wall }], caseMetals, 0, Math.PI, 'upper-casting-reinforcement'));
  });
  addLiftingLug(compressorCasing, -4.85, -.2, materials.cut, caseSections[1].stations);
  addLiftingLug(compressorCasing, -1.75, -.2, materials.cut, caseSections[1].stations);
  addLiftingLug(combustionCasing, 1.85, -.2, materials.cut, caseSections[2].stations);
  addLiftingLug(turbineCasing, 4.42, -.2, materials.cut, caseSections[3].stations);
  addInspectionPortZ(lowerCasing, -3.2, -.42, -2.48, .24, materials);
  addInspectionPortZ(lowerCasing, 1.85, -.55, -2.8, .29, materials);
  addInspectionPortZ(lowerCasing, 4.15, -.4, -3.04, .22, materials);

  // The reference exhaust has an axial open mouth and an intact round barrel.
  // There is no longitudinal slot sawn through its upper and lower walls.
  const exhaustCradle: CaseStation[] = [
    { x: 5.5, r: 3.19, wall: .24, lip: .22 },
    { x: 6.1, r: 3.18, wall: .23, lip: .2 },
    { x: 6.8, r: 3.18, wall: .19, lip: .18 },
  ];
  exhaust.add(profileShell(exhaustCradle, caseMetals, Math.PI, Math.PI, 'exhaust-lower-cradle'));
  turbineCasing.add(profileShell(exhaustCradle, caseMetals, 0, Math.PI, 'exhaust-removable-upper-transition'));
  addHorizontalSplitDeck(turbineCasing, exhaustCradle, materials.cut, 1, true);
  addHorizontalSplitDeck(turbineCasing, exhaustCradle, materials.cut, -1, true);
  addHorizontalSplitDeck(exhaust, exhaustCradle, materials.cut, 1);
  addHorizontalSplitDeck(exhaust, exhaustCradle, materials.cut, -1);
  const exhaustStations: CaseStation[] = [
    { x: 6.8, r: 3.18, wall: .16 },
    { x: 6.9, r: 3.19, wall: .14 },
    { x: 7.8, r: 3.24, wall: .14 },
    { x: 9.6, r: 3.36, wall: .14 },
    { x: 10.08, r: 3.34, wall: .17 },
  ];
  exhaust.add(profileShell(exhaustStations, { outer: materials.casing, inner: materials.machinedFace, cut: materials.cut }, 0, Math.PI * 2, 'complete-exhaust-barrel-with-axial-mouth'));
  [
    { x: 6.82, r: 3.24 }, { x: 7.72, r: 3.29 },
    { x: 8.65, r: 3.34 }, { x: 10.04, r: 3.4 },
  ].forEach(({ x, r }) => {
    exhaust.add(profileShell([{ x: x - .036, r, wall: .085 }, { x: x + .036, r, wall: .085 }],
      caseMetals, 0, Math.PI * 2, 'exhaust-full-circumference-rib'));
  });
  const exhaustDiffuser = profileShell([
    { x: 5.45, r: .92, wall: .12 },
    { x: 6.25, r: 1.0, wall: .12 },
    { x: 8.7, r: 1.24, wall: .12 },
    { x: 9.85, r: 1.36, wall: .12 },
  ], { outer: materials.machinedFace, inner: materials.dark, cut: materials.rotorEdge }, 0, Math.PI * 2, 'polished-exhaust-centerbody');
  exhaust.add(exhaustDiffuser);
  addBladeRow({
    parent: exhaust, x: 7.48, hub: 1.1, tip: 3.1, count: 4,
    chord: 1.75, twist: -.07, sweep: .18, lean: .02,
    material: materials.machinedFace, name: 'exhaust-structural-struts', phase: .35,
  });
  const port = new THREE.Group();
  port.name = 'exhaust-inspection-boss';
  port.position.set(9.35, -.18, 3.35);
  const portBoss = new THREE.Mesh(new THREE.CylinderGeometry(.26, .3, .23, 40), materials.casing);
  portBoss.rotation.x = Math.PI / 2;
  const portHole = new THREE.Mesh(new THREE.CircleGeometry(.2, 40), materials.dark);
  portHole.position.z = .122;
  const portRim = new THREE.Mesh(new THREE.TorusGeometry(.235, .035, 12, 40), materials.machinedFace);
  portRim.position.z = .126;
  port.add(portBoss, portHole, portRim);
  exhaust.add(port);

  const frontBearingSection = new THREE.Group();
  frontBearingSection.name = 'sectioned-front-bearing-housing';
  lowerCasing.add(frontBearingSection);

  const bearingCarrier = shellSectorX(
    2.12,
    .98,
    .98,
    .26,
    Math.PI,
    Math.PI,
    materials.casing,
    48,
    materials.dark,
    materials.cut,
  );
  bearingCarrier.name = 'continuous-lower-bearing-carrier';
  bearingCarrier.position.x = -7.13;
  frontBearingSection.add(bearingCarrier);
  // Broad, axially deep fixed walls join the carrier directly to the inlet casting.
  // No front/rear spoke stacks or freestanding diagonal load braces.
  frontBearingSection.add(createInletSupportWebs(caseSections[0].stations, materials.cast));
  const upperCarrier = shellSectorX(2.12, .98, .98, .26, 0, Math.PI,
    materials.casing, 64, materials.dark, materials.cut);
  upperCarrier.name = 'removable-upper-bearing-carrier';
  upperCarrier.position.x = -7.13;
  compressorCasing.add(upperCarrier);

  const bearingFace = beveledDiscX(.17, .72, .042, materials.machinedFace, 64);
  bearingFace.position.x = -7.99;
  stator.add(bearingFace);
  const bearingFaceGroove = torusX(.61, .024, materials.rotorEdge);
  bearingFaceGroove.position.x = -8.085;
  stator.add(bearingFaceGroove);
  const bearingCap = beveledDiscX(.09, .28, .025, materials.cut, 40);
  bearingCap.position.x = -8.08;
  stator.add(bearingCap);
  const bearingCenter = beveledDiscX(.045, .075, .012, materials.dark, 28);
  bearingCenter.position.x = -8.135;
  stator.add(bearingCenter);
  addBoltRing(stator, -8.09, .51, 12, .029, materials.dark);
  const bearingB = cylinderX(.62, .82, .82, materials.rotor, 48);
  bearingB.position.x = 5.45;
  stator.add(bearingB);
  addBoltRing(stator, -6.35, .6, 18, .035, materials.cut);
  addBoltRing(stator, 5.15, .72, 22, .04, materials.cut);

  const flowMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: .045,
    vertexColors: true,
    transparent: true,
    opacity: .32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  flowMaterial.toneMapped = false;
  const flow = createFlow(flowMaterial);
  root.add(flow);

  const operationGlow = new THREE.Group();
  operationGlow.name = 'operating-cycle-glow';
  operationGlow.visible = false;
  const combustionLight = new THREE.PointLight(0xff7a22, 1.25, 5.5, 2);
  combustionLight.position.set(1.9, .25, 1.7);
  const expansionLight = new THREE.PointLight(0xff351d, .72, 4.5, 2);
  expansionLight.position.set(3.85, .15, 1.55);
  operationGlow.add(combustionLight, expansionLight);
  root.add(operationGlow);
  const operationLights = [combustionLight, expansionLight];

  // Surface-hugging motion cues for high-speed operation. These stay on the
  // rotor and use a handful of simple rings instead of a temporal blur pass.
  const rotorMotion = new THREE.Group();
  rotorMotion.name = 'rotor-speed-cues';
  rotorMotion.visible = false;
  const compressorSweep = new THREE.MeshBasicMaterial({
    color: 0x6bc9e8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const turbineSweep = new THREE.MeshBasicMaterial({
    color: 0xd7a85d,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const phaseMark = new THREE.MeshBasicMaterial({
    color: 0xe5eee9,
    transparent: true,
    opacity: .78,
    depthWrite: false,
    toneMapped: false,
  });
  const rotorMotionMaterials = [compressorSweep, turbineSweep, phaseMark];
  const speedRings = [
    { x: -5.05, radius: 2.39, material: compressorSweep },
    { x: -3.17, radius: 2.15, material: compressorSweep },
    { x: -.72, radius: 1.82, material: compressorSweep },
    { x: 3.25, radius: 2.49, material: turbineSweep },
    { x: 4.84, radius: 2.08, material: turbineSweep },
  ];
  speedRings.forEach(({ x, radius, material }) => {
    const ring = torusX(radius, .018, material);
    ring.position.x = x;
    ring.castShadow = false;
    ring.renderOrder = 2;
    rotorMotion.add(ring);
  });
  [
    { x: -5.05, radius: .79, angle: .22 },
    { x: -1.55, radius: 1.02, angle: 2.28 },
    { x: 3.25, radius: 1.25, angle: 4.18 },
  ].forEach(({ x, radius, angle }) => {
    const mark = torusX(radius, .028, phaseMark, .32);
    mark.position.x = x;
    mark.rotation.x = angle;
    mark.castShadow = false;
    mark.renderOrder = 3;
    rotorMotion.add(mark);
  });
  rotor.add(rotorMotion);

  const anchors = {
    inlet: new THREE.Vector3(-5.6, 2.65, 0),
    compressor: new THREE.Vector3(-2.2, 2.15, 0),
    combustion: new THREE.Vector3(1.5, 2.85, 0),
    turbine: new THREE.Vector3(4.05, 2.5, 0),
    exhaust: new THREE.Vector3(7.87, 3.05, 0),
  };

  const axialStations: RuntimeAxialStation[] = [
    { id: 'inlet-frame', x0: -8.45, x1: -5.18, family: 'inlet', rowType: 'strut', confidence: 'high' },
    { id: 'compressor', x0: compressorStageProfiles[0].x, x1: compressorStageProfiles[compressorStageProfiles.length - 1].x, family: 'compressor', rowType: 'rotor-stator', count: compressorStages, confidence: 'high' },
    { id: 'diffuser', x0: .56, x1: 1.22, family: 'diffuser', rowType: 'shell', confidence: 'medium' },
    { id: 'combustion', x0: 1.22, x1: 2.75, family: 'combustion', rowType: 'burner', count: 16, confidence: 'medium' },
    { id: 'turbine', x0: turbineXs[0] - .2, x1: turbineXs[turbineXs.length - 1], family: 'turbine', rowType: 'stator-rotor', count: turbineXs.length, confidence: 'high' },
    { id: 'exhaust', x0: 5.5 + exhaust.position.x, x1: 10.08 + exhaust.position.x, family: 'exhaust', rowType: 'strut', confidence: 'high' },
  ];

  let triangles = 0;
  let meshes = 0;
  let instances = 0;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      meshes++;
      const geometry = object.geometry;
      const count = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
      const instanceCount = object instanceof THREE.InstancedMesh ? object.count : 1;
      triangles += count * instanceCount;
      instances += object instanceof THREE.InstancedMesh ? object.count : 0;
    }
  });

  root.userData.sculptRuntime = {
    fidelity: 'public-reference hero visualization',
    axis: '+X inlet to exhaust',
    groups: { rotor, stator, lowerCasing, combustion, casing, exhaust, operationGlow, rotorMotion, combustorModules, compressorCasing, combustionCasing, turbineCasing },
    stageCounts: { compressor: 14, turbine: 4, combustors: 16 },
    axialStations,
    exactness: {
      evidenced: ['14 compressor stages', '4 turbine stages', 'single-axis architecture', 'DLN 2.6e combustion system'],
      approximate: ['blade counts', 'airfoil sections', 'clearances', 'case thickness', 'hidden service routing'],
    },
  };

  return {
    root,
    rotor,
    stator,
    combustion,
    combustorModules,
    casing,
    lowerCasing,
    casingSections: { compressor: compressorCasing, combustion: combustionCasing, turbine: turbineCasing },
    exhaust,
    flow,
    operationGlow,
    operationLights,
    rotorMotion,
    rotorMotionMaterials,
    anchors,
    metrics: { triangles, meshes, instances },
  };
}

export function updateFlow(flow: THREE.Points, elapsed: number) {
  if (!flow.visible) return;
  const position = flow.geometry.attributes.position as THREE.BufferAttribute;
  const base = flow.userData.basePositions as Float32Array;
  const colors = flow.geometry.attributes.color as THREE.BufferAttribute;
  const colorArray = colors.array as Float32Array;
  for (let i = 0; i < position.count; i++) {
    const initialX = base[i * 3];
    const speed = initialX > 2.8 ? 1.35 : .78;
    let x = initialX + elapsed * speed;
    while (x > 8.1) x -= 14.2;
    position.setX(i, x);
    writeFlowColor(colorArray, i, x);
  }
  position.needsUpdate = true;
  colors.needsUpdate = true;
}

export function rotateRotor(rotor: THREE.Group, delta: number, speed = 1) {
  rotor.rotateOnAxis(X_AXIS, delta * speed);
}
