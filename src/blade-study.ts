import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type BladeView = 'surface' | 'cooling' | 'layers';

// Generic explanatory geometry, not proprietary 9HA blade construction.
export function bladePoint(u: number, t: number, face = 1, inset = 0) {
  const chord = 1.65 * (1 - .18 * t);
  const x = (u - .46) * chord;
  const camber = .21 * Math.sin(Math.PI * u);
  const thickness = .19 * Math.pow(Math.sin(Math.PI * u), .62) + .025;
  const z = camber + face * Math.max(.012, thickness - inset);
  const twist = .12 - .39 * t;
  return new THREE.Vector3(x * Math.cos(twist) + z * Math.sin(twist) + .22 * t * t,
    .52 + t * 3.65, -x * Math.sin(twist) + z * Math.cos(twist));
}

function perforatedFace(face: number, material: THREE.Material, cutWindow = false, innerMaterial?: THREE.Material) {
  const outline = new THREE.Shape();
  outline.moveTo(0, 0); outline.lineTo(1, 0); outline.lineTo(1, 1); outline.lineTo(0, 1); outline.closePath();
  if (cutWindow) {
    const window = new THREE.Path();
    window.moveTo(.145, .08); window.lineTo(.18, .045); window.lineTo(.88, .045); window.lineTo(.915, .08);
    window.lineTo(.915, .93); window.lineTo(.88, .965); window.lineTo(.18, .965); window.lineTo(.145, .93); window.closePath();
    outline.holes.push(window);
  }
  for (const u of [.055, .12, .76, .93]) {
    for (let i = 0; i < 22; i++) {
      if (cutWindow && u > .145 && u < .915) continue;
      const hole = new THREE.Path();
      hole.absellipse(u, .065 + i * .041, .012, .0065, 0, Math.PI * 2, true);
      outline.holes.push(hole);
    }
  }
  // Extrusion creates real aperture walls; then both sheets are lofted into the airfoil.
  const flat = new THREE.ExtrudeGeometry(outline, { depth: .018, bevelEnabled: false, curveSegments: 5, steps: 1 });
  // Earcut alone bridges broad curved regions with long flat triangles. Refine in
  // parameter space before lofting, otherwise interior walls puncture the skin.
  const coords: number[] = [], normals: number[] = [];
  const flatPosition = flat.getAttribute('position'), flatNormal = flat.getAttribute('normal');
  function subdivide(vertices: THREE.Vector3[], ns: THREE.Vector3[], depth = 0) {
    const lengths = vertices.map((v, i) => v.distanceToSquared(vertices[(i + 1) % 3]));
    const longest = lengths.indexOf(Math.max(...lengths));
    if (lengths[longest] > .075 ** 2 && depth < 10) {
      const a = longest, b = (longest + 1) % 3, c = (longest + 2) % 3;
      const mid = vertices[a].clone().add(vertices[b]).multiplyScalar(.5);
      const nm = ns[a].clone().add(ns[b]).normalize();
      subdivide([vertices[a], mid, vertices[c]], [ns[a], nm, ns[c]], depth + 1);
      subdivide([mid, vertices[b], vertices[c]], [nm, ns[b], ns[c]], depth + 1);
    } else vertices.forEach((v, i) => { coords.push(v.x, v.y, v.z); normals.push(ns[i].x, ns[i].y, ns[i].z); });
  }
  for (let i = 0; i < flatPosition.count; i += 3) {
    subdivide([0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(flatPosition, i + j)), [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(flatNormal, i + j)));
  }
  flat.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  const uv: number[] = []; for (let i = 0; i < coords.length; i += 3) uv.push(coords[i], coords[i + 1]);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const jacobian = new THREE.Matrix3();
  for (let i = 0; i < position.count; i++) {
    const u = position.getX(i), t = position.getY(i), depth = position.getZ(i);
    const p = bladePoint(u, t, face, depth);
    const eps = .0001;
    const du = bladePoint(Math.min(1, u + eps), t, face, depth).sub(bladePoint(Math.max(0, u - eps), t, face, depth)).multiplyScalar(1 / (Math.min(1, u + eps) - Math.max(0, u - eps)));
    const dt = bladePoint(u, t + eps, face, depth).sub(bladePoint(u, t - eps, face, depth)).multiplyScalar(1 / (eps * 2));
    const dd = bladePoint(u, t, face, depth + eps).sub(bladePoint(u, t, face, depth - eps)).multiplyScalar(1 / (eps * 2));
    jacobian.set(du.x, dt.x, dd.x, du.y, dt.y, dd.y, du.z, dt.z, dd.z).invert().transpose();
    const n = new THREE.Vector3(normal.getX(i), normal.getY(i), normal.getZ(i)).applyMatrix3(jacobian).normalize();
    position.setXYZ(i, p.x, p.y, p.z);
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  // The pressure-side loft reverses depth, so its Jacobian has negative
  // determinant. Reverse winding as well as transforming normals; otherwise
  // DoubleSide lighting flips the correctly transformed normals back inward.
  if (face === 1 || innerMaterial) {
    const outerIndices: number[] = [], innerIndices: number[] = [];
    for (let i = 0; i < position.count; i += 3) {
      const outer = [0, 1, 2].every(j => Math.abs(coords[(i + j) * 3 + 2]) < .00001);
      const indices = innerMaterial && !outer ? innerIndices : outerIndices;
      indices.push(i, i + (face === 1 ? 2 : 1), i + (face === 1 ? 1 : 2));
    }
    geometry.setIndex([...outerIndices, ...innerIndices]);
    if (innerMaterial) {
      geometry.addGroup(0, outerIndices.length, 0);
      geometry.addGroup(outerIndices.length, innerIndices.length, 1);
    }
  }
  geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry, innerMaterial ? [material, innerMaterial] : material);
}

function strip(u0: number, u1: number, t0: number, t1: number, material: THREE.Material) {
  const points: number[] = [], indices: number[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = THREE.MathUtils.lerp(t0, t1, i / 32);
    for (const u of [u0, u1]) for (const side of [-1, 1]) {
      const p = bladePoint(u, t, side, .032); points.push(p.x, p.y, p.z);
    }
    if (i < 32) {
      const k = i * 4;
      for (const [a, b] of [[0, 1], [1, 3], [3, 2], [2, 0]]) indices.push(k + a, k + b, k + b + 4, k + a, k + b + 4, k + a + 4);
    }
  }
  indices.push(0, 2, 3, 0, 3, 1, 128, 129, 131, 128, 131, 130);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); g.setIndex(indices); g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

function beam(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 8), material);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

export function createBladeStudy() {
  const root = new THREE.Group(); root.name = 'educational-hot-section-blade';
  // Deliberately separated exhibition finishes, not measured OEM PBR values.
  const nickel = new THREE.MeshStandardMaterial({ name: 'machined-nickel', color: 0x999b9c, metalness: .96, roughness: .38, side: THREE.DoubleSide });
  const interior = new THREE.MeshStandardMaterial({ name: 'satin-channel-alloy', color: 0x555a5b, metalness: .88, roughness: .44, side: THREE.DoubleSide });
  const ceramic = new THREE.MeshStandardMaterial({ name: 'matte-YSZ-ceramic', color: 0xaeb0aa, metalness: 0, roughness: .64, side: THREE.DoubleSide });
  // Fine ceramic relief, independent of albedo and roughness. No fake crystal facets.
  const grain = new Uint8Array(1024 * 1024 * 4); let seed = 9137;
  for (let i = 0; i < grain.length; i += 4) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const value = 105 + (seed >>> 25); grain[i] = grain[i + 1] = grain[i + 2] = value; grain[i + 3] = 255; }
  const bump = new THREE.DataTexture(grain, 1024, 1024, THREE.RGBAFormat); bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.repeat.set(1, 2.5); bump.magFilter = THREE.LinearFilter; bump.minFilter = THREE.LinearMipmapLinearFilter; bump.generateMipmaps = true; bump.needsUpdate = true;
  ceramic.bumpMap = bump; ceramic.bumpScale = .006;
  // Independent roughness field: mesoscale deposition variation plus fine grain.
  // Neither the ceramic albedo nor its height field is reused here.
  const ceramicRoughnessData = new Uint8Array(1024 * 1024 * 4); let finishSeed = 47219;
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    finishSeed = (Math.imul(finishSeed, 1664525) + 1013904223) >>> 0;
    const value = Math.round(225 + 9 * Math.sin(x * .043) * Math.sin(y * .057) + (finishSeed >>> 28) - 7);
    const i = (y * 1024 + x) * 4;
    ceramicRoughnessData[i] = ceramicRoughnessData[i + 1] = ceramicRoughnessData[i + 2] = value; ceramicRoughnessData[i + 3] = 255;
  }
  const ceramicRoughness = new THREE.DataTexture(ceramicRoughnessData, 1024, 1024);
  ceramicRoughness.wrapS = ceramicRoughness.wrapT = THREE.RepeatWrapping; ceramicRoughness.repeat.set(1, 2.5);
  ceramicRoughness.magFilter = THREE.LinearFilter; ceramicRoughness.minFilter = THREE.LinearMipmapLinearFilter;
  ceramicRoughness.generateMipmaps = true; ceramicRoughness.needsUpdate = true; ceramic.roughnessMap = ceramicRoughness;
  const brushed = new Uint8Array(1024 * 1024 * 4);
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const v = Math.round(180 + 17 * Math.sin(y * 2.7 + Math.sin(x * .011)) + 9 * Math.sin(y * 7.3 + x * .023));
    const i = (y * 1024 + x) * 4; brushed[i] = brushed[i + 1] = brushed[i + 2] = v; brushed[i + 3] = 255;
  }
  const rough = new THREE.DataTexture(brushed, 1024, 1024); rough.wrapS = rough.wrapT = THREE.RepeatWrapping; rough.magFilter = THREE.LinearFilter; rough.minFilter = THREE.LinearMipmapLinearFilter; rough.generateMipmaps = true; rough.needsUpdate = true;
  nickel.roughnessMap = rough;
  const bond = new THREE.MeshStandardMaterial({ name: 'satin-metallic-bond-coat', color: 0x91938e, metalness: .88, roughness: .36, side: THREE.DoubleSide });
  const oxide = new THREE.MeshStandardMaterial({ name: 'oxide-layer-illustration', color: 0x595e5c, metalness: 0, roughness: .82, side: THREE.DoubleSide });
  const airMaterial = new THREE.MeshBasicMaterial({ color: 0x7bbfca, transparent: true, opacity: .26, depthWrite: false });

  const baseShape = new THREE.Shape();
  baseShape.moveTo(-.37, -.58);
  for (let i = 0; i < 4; i++) {
    const y = -.58 + i * .18;
    baseShape.lineTo(-.40 - i * .08, y + .035); baseShape.lineTo(-.46 - i * .08, y + .12);
    baseShape.lineTo(-.33 - i * .08, y + .17);
  }
  baseShape.lineTo(-.45, .35); baseShape.lineTo(.45, .35);
  for (let i = 3; i >= 0; i--) {
    const y = -.58 + i * .18;
    baseShape.lineTo(.33 + i * .08, y + .17); baseShape.lineTo(.46 + i * .08, y + .12); baseShape.lineTo(.40 + i * .08, y + .035);
  }
  baseShape.lineTo(.37, -.58); baseShape.closePath();
  const rootMetal = nickel.clone(); rootMetal.name = 'machined-root-alloy'; rootMetal.color.setHex(0xa4a6a6); rootMetal.metalness = .96; rootMetal.roughness = .32;
  const attachment = new THREE.Mesh(new THREE.ExtrudeGeometry(baseShape, { depth: .82, bevelEnabled: true, bevelSize: .032, bevelThickness: .032, bevelSegments: 4 }), rootMetal);
  attachment.position.z = -.41; attachment.name = 'fir-tree-root'; root.add(attachment);
  const platformShape = new THREE.Shape();
  platformShape.moveTo(-1, -.43); platformShape.lineTo(.82, -.43); platformShape.lineTo(1.05, .12);
  platformShape.lineTo(.9, .58); platformShape.lineTo(-.86, .58); platformShape.lineTo(-1.05, .08); platformShape.closePath();
  const platform = new THREE.Mesh(new THREE.ExtrudeGeometry(platformShape, { depth: .13, bevelSize: .045, bevelThickness: .025, bevelSegments: 3 }), nickel);
  platform.rotation.x = Math.PI / 2; platform.position.y = .53; platform.name = 'platform'; root.add(platform);
  const front = new THREE.Group(); front.name = 'pressure-side-teaching-section'; root.add(front);
  front.add(perforatedFace(1, ceramic, false, interior));
  const sectionFrame = new THREE.Group(); sectionFrame.name = 'integral-cooling-cutaway'; root.add(sectionFrame);
  sectionFrame.add(perforatedFace(1, ceramic, true, interior));
  const rimPath = [[.145,.08],[.18,.045],[.88,.045],[.915,.08],[.915,.93],[.88,.965],[.18,.965],[.145,.93],[.145,.08]];
  const rimPoints: THREE.Vector3[] = [];
  for (let k = 0; k < rimPath.length - 1; k++) for (let j = 0; j < 24; j++) {
    const u = THREE.MathUtils.lerp(rimPath[k][0], rimPath[k + 1][0], j / 24), t = THREE.MathUtils.lerp(rimPath[k][1], rimPath[k + 1][1], j / 24);
    rimPoints.push(bladePoint(u, t, 1, .009));
  }
  sectionFrame.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPoints, true), 224, .014, 6, true), nickel));
  const back = perforatedFace(-1, ceramic, false, interior); back.name = 'suction-side-wall'; root.add(back);
  // Leading and trailing edges have full wall thickness, not open paper surfaces.
  root.add(strip(0, .018, 0, 1, nickel), strip(.982, 1, 0, 1, nickel));
  const tip = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    ...Array.from({ length: 25 }, (_, i) => bladePoint(i / 24, 1, 1)),
    ...Array.from({ length: 25 }, (_, i) => bladePoint(1 - i / 24, 1, -1)),
  ], true), 100, .024, 6, true), nickel); root.add(tip);
  const cooling = new THREE.Group(); cooling.name = 'internal-cooling'; root.add(cooling);
  cooling.add(strip(.27, .30, 0, .91, interior), strip(.57, .60, .105, 1, interior));
  // Oblique ribs on the inside of the suction wall; turn clearances alternate.
  for (const [start, end] of [[.035, .25], [.32, .55], [.62, .78]]) {
    for (let i = 0; i < 20; i++) {
      const t = .09 + i * .042;
      cooling.add(beam(bladePoint(start, t, -1, .055), bladePoint(end, t + .022, -1, .055), .017, interior));
    }
  }
  for (let i = 0; i < 24; i++) for (const u of [.83, .90]) {
    cooling.add(beam(bladePoint(u, .065 + i * .037, -1, .035), bladePoint(u, .065 + i * .037, 1, .035), .021, interior));
  }
  const coolingGeometries: THREE.BufferGeometry[] = [];
  cooling.children.forEach(child => {
    if (child instanceof THREE.Mesh) {
      child.updateMatrix(); let g = child.geometry.clone().applyMatrix4(child.matrix);
      if (g.index) { const indexed = g; g = g.toNonIndexed(); indexed.dispose(); }
      g.deleteAttribute('uv'); coolingGeometries.push(g); child.geometry.dispose();
    }
  });
  cooling.clear();
  const mergedCooling = mergeGeometries(coolingGeometries); if (mergedCooling) cooling.add(new THREE.Mesh(mergedCooling, interior));
  coolingGeometries.forEach(g => g.dispose());
  const airflow = new THREE.Group(); airflow.name = 'cooling-air-explanatory-overlay'; root.add(airflow);
  const curves = [new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.20, -.59, 0), bladePoint(.16, 0, 0), bladePoint(.16, .78, 0),
    bladePoint(.23, .95, 0), bladePoint(.43, .95, 0), bladePoint(.43, .65, 0),
    bladePoint(.43, .14, 0), bladePoint(.53, .055, 0), bladePoint(.69, .11, 0), bladePoint(.69, .91, 0),
  ], false, 'centripetal')];
  curves.forEach(curve => airflow.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, .019, 8, false), airMaterial)));
  const filmCurves: THREE.CatmullRomCurve3[] = [];
  for (let i = 0; i < 9; i++) {
    const t = .065 + (2 + i * 2) * .041;
    const start = bladePoint(.055, t, 1);
    const curve = new THREE.CatmullRomCurve3([start, start.clone().add(new THREE.Vector3(.08,.01,.12)), start.clone().add(new THREE.Vector3(.35,.045,.17)), start.clone().add(new THREE.Vector3(.66,.08,.20))]);
    filmCurves.push(curve);
    airflow.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, .006, 5, false), airMaterial));
  }
  const spriteData = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const i = (y * 32 + x) * 4; const a = Math.max(0, 1 - Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5)); spriteData[i] = spriteData[i + 1] = spriteData[i + 2] = 255; spriteData[i + 3] = Math.round(a * a * 255); }
  const sprite = new THREE.DataTexture(spriteData, 32, 32); sprite.needsUpdate = true;
  const particlePositions = new Float32Array((18 * 8 + filmCurves.length * 8) * 3);
  const particleColors = new Float32Array(particlePositions.length);
  for (let i = 0; i < particlePositions.length / 3; i++) { const brightness = .25 + .75 * (1 - i % 8 / 8); particleColors.set([brightness * .40, brightness, brightness], i * 3); }
  const particleGeometry = new THREE.BufferGeometry(); particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3)); particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));
  const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ size: .092, map: sprite, transparent: true, opacity: .9, vertexColors: true, depthWrite: false, blending: THREE.AdditiveBlending })); particles.frustumCulled = false; airflow.add(particles);
  const layers = new THREE.Group(); layers.name = 'magnified-coating-coupon'; root.add(layers);
  // Representative Ni-superalloy / MCrAlY / alumina / YSZ system, not a
  // verified 9HA.02 coating recipe. Separation and oxide thickness are exaggerated.
  const coatingNames = ['nickel-superalloy-substrate', 'MCrAlY-bond-coat', 'alumina-TGO', 'YSZ-ceramic-topcoat'];
  const layerAccents = [0x9bbfda, 0xaeb8e9, 0x89cabb, 0xe9c88e];
  const layerRest: THREE.Vector3[] = [];
  const layerEdges: THREE.LineSegments[] = [];
  for (const [i, mat] of [nickel, bond, oxide, ceramic].entries()) {
    const g = new THREE.BoxGeometry(.70, .96, i === 0 ? .07 : i === 2 ? .012 : .024, 20, 16, 1);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) p.setZ(k, p.getZ(k) + .22 * (1 - (p.getX(k) / .45) ** 2) + p.getY(k) * .10);
    g.computeVertexNormals();
    // Coupon materials are independent: selection must not tint the actual blade.
    const mesh = new THREE.Mesh(g, mat.clone()); mesh.name = coatingNames[i]; mesh.userData.layerIndex = i;
    mesh.position.set(1.12 + i * .46, 2.08 + i * .12, .22 + i * .23); layers.add(mesh);
    layerRest.push(mesh.position.clone());
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g, 32), new THREE.LineBasicMaterial({ color: layerAccents[i], transparent: true, opacity: .85, depthWrite: false }));
    edge.visible = false; mesh.add(edge); layerEdges.push(edge);
  }
  let highlightedLayer: number | null = null;
  function highlightLayer(index: number | null) {
    highlightedLayer = index !== null && index >= 0 && index < 4 ? index : null;
    root.userData.highlightedLayer = highlightedLayer;
    layers.children.forEach((object, i) => {
      const mat = (object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material;
      mat.emissive.setHex(layerAccents[i]); mat.emissiveIntensity = i === highlightedLayer ? .10 : 0;
      layerEdges[i].visible = i === highlightedLayer;
    });
  }
  let view: BladeView = 'layers', flowEnabled = true;
  const setView = (next: BladeView) => {
    highlightLayer(null);
    view = next; layers.visible = view === 'layers'; airflow.visible = flowEnabled && view !== 'surface';
    front.visible = view === 'surface'; sectionFrame.visible = view !== 'surface';
    root.userData.view = view;
  };
  setView('layers');
  root.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
  airflow.traverse(object => { object.castShadow = false; object.receiveShadow = false; });
  root.rotation.set(-.06, -.12, -.13);
  root.userData.sculptRuntime = { exactness: 'explanatory', parts: ['fir-tree-root', 'platform', 'pressure-side-teaching-section', 'suction-side-wall', 'internal-cooling', 'magnified-coating-coupon'] };
  return { root, setView, highlightLayer, layerMeshes: layers.children as THREE.Mesh[], setFlow(enabled: boolean) { flowEnabled = enabled; airflow.visible = flowEnabled && view !== 'surface'; }, update(_delta: number, elapsed: number) {
    layers.children.forEach((object, i) => {
      const amount = i === highlightedLayer ? .16 : 0;
      object.position.x = THREE.MathUtils.damp(object.position.x, layerRest[i].x + amount, 12, _delta);
      object.position.z = THREE.MathUtils.damp(object.position.z, layerRest[i].z + amount, 12, _delta);
    });
    if (!airflow.visible) return;
    for (let i = 0; i < 18 * 8; i++) { const point = curves[0].getPointAt((elapsed * .10 + Math.floor(i / 8) / 18 - i % 8 * .0018 + 1) % 1); particlePositions.set([point.x, point.y, point.z], i * 3); }
    filmCurves.forEach((curve, j) => { for (let k = 0; k < 8; k++) { const point = curve.getPointAt((elapsed * .48 + j * .113 - k * .012 + 1) % 1); particlePositions.set([point.x, point.y, point.z], (18 * 8 + j * 8 + k) * 3); } });
    particleGeometry.getAttribute('position').needsUpdate = true;
  } };
}
