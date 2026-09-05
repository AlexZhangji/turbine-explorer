import * as THREE from 'three';

export type CaseStation = { x: number; r: number; wall: number; lip?: number };
type CaseMaterials = { outer: THREE.Material; inner: THREE.Material; cut: THREE.Material };

export function caseRadiusAt(stations: CaseStation[], x: number) {
  let i = 0;
  while (i < stations.length - 2 && stations[i + 1].x < x) i++;
  const a = stations[i], b = stations[i + 1];
  return THREE.MathUtils.lerp(a.r, b.r, THREE.MathUtils.clamp((x - a.x) / (b.x - a.x), 0, 1));
}

// All casing sections share one angular convention: y = r sin(theta),
// z = r cos(theta). The retained lower half is PI..2PI, cut exactly at y=0.
export function profileShell(
  stations: CaseStation[],
  materials: CaseMaterials,
  start = Math.PI,
  arc = Math.PI,
  name = 'lower-case',
) {
  const p: number[] = [];
  const n: number[] = [];
  const uv: number[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  const segments = 128;
  const at = (s: CaseStation, t: number, inner: boolean) => {
    const r = s.r - (inner ? s.wall : 0);
    return new THREE.Vector3(s.x, Math.sin(t) * r, Math.cos(t) * r);
  };
  const quad = (v: THREE.Vector3[], normals: THREE.Vector3[], reverse = false) => {
    const order = reverse ? [0, 3, 1, 0, 2, 3] : [0, 1, 3, 0, 3, 2];
    order.forEach(i => { p.push(...v[i].toArray()); n.push(...normals[i].toArray()); uv.push(v[i].x * .12, Math.atan2(v[i].y, v[i].z) / (2 * Math.PI)); });
  };
  for (const inner of [false, true]) {
    const first = p.length / 3;
    for (let s = 0; s < stations.length - 1; s++) {
      const a = stations[s], b = stations[s + 1];
      const slope = ((b.r - (inner ? b.wall : 0)) - (a.r - (inner ? a.wall : 0))) / (b.x - a.x);
      for (let i = 0; i < segments; i++) {
        const t0 = start + arc * i / segments, t1 = start + arc * (i + 1) / segments;
        const normal = (t: number) => new THREE.Vector3(-slope, Math.sin(t), Math.cos(t)).normalize().multiplyScalar(inner ? -1 : 1);
        quad([at(a, t0, inner), at(b, t0, inner), at(a, t1, inner), at(b, t1, inner)],
          [normal(t0), normal(t0), normal(t1), normal(t1)], inner);
      }
    }
    groups.push({ start: first, count: p.length / 3 - first, materialIndex: inner ? 1 : 0 });
  }
  const cutStart = p.length / 3;
  for (const end of [0, stations.length - 1]) {
    const station = stations[end];
    const normal = new THREE.Vector3(end === 0 ? -1 : 1, 0, 0);
    for (let i = 0; i < segments; i++) {
      const t0 = start + arc * i / segments, t1 = start + arc * (i + 1) / segments;
      quad([at(station, t0, false), at(station, t0, true), at(station, t1, false), at(station, t1, true)],
        [normal, normal, normal, normal], end === 0);
    }
  }
  if (arc < Math.PI * 2 - .001) {
    for (const [edge, t] of [start, start + arc].entries()) {
      const normal = new THREE.Vector3(0, Math.cos(t), -Math.sin(t)).multiplyScalar(edge === 0 ? -1 : 1);
      for (let i = 0; i < stations.length - 1; i++) {
        const a = stations[i], b = stations[i + 1];
        quad([at(a, t, false), at(b, t, false), at(a, t, true), at(b, t, true)],
          [normal, normal, normal, normal], edge === 0);
      }
    }
  }
  groups.push({ start: cutStart, count: p.length / 3 - cutStart, materialIndex: 2 });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  groups.forEach(g => geometry.addGroup(g.start, g.count, g.materialIndex));
  const mesh = new THREE.Mesh(geometry, [materials.outer, materials.inner, materials.cut]);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function addHorizontalSplitDeck(parent: THREE.Group, stations: CaseStation[], cut: THREE.Material, side: -1 | 1, upper = false, boltPitch = .24) {
  const shape = new THREE.Shape();
  const boreCenters: THREE.Vector2[] = [];
  const inner = (s: CaseStation) => s.r - s.wall - .1;
  const outer = (s: CaseStation) => s.r + (s.lip ?? .3) + .12;
  shape.moveTo(stations[0].x, side * outer(stations[0]));
  stations.slice(1).forEach(s => shape.lineTo(s.x, side * outer(s)));
  [...stations].reverse().forEach(s => shape.lineTo(s.x, side * inner(s)));
  shape.closePath();
  // Section-specific pitch with symmetric margins, not a manufacturer drilling schedule.
  const minX = stations[0].x + .16, maxX = stations[stations.length - 1].x - .16;
  const intervals = Math.max(1, Math.round((maxX - minX) / boltPitch));
  for (let j = 0; j <= intervals; j++) {
    const x = THREE.MathUtils.lerp(minX, maxX, j / intervals);
    let i = 0;
    while (i < stations.length - 2 && stations[i + 1].x < x) i++;
    const a = stations[i], b = stations[i + 1], t = (x - a.x) / (b.x - a.x);
    const center = THREE.MathUtils.lerp((outer(a) + inner(a)) / 2, (outer(b) + inner(b)) / 2, t);
    const hole = new THREE.Path();
    hole.absarc(x, side * center, .044, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    boreCenters.push(new THREE.Vector2(x, side * center));
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .18, steps: 1, bevelEnabled: true, bevelSize: .008, bevelThickness: .004, bevelSegments: 2, curveSegments: 10 });
  geometry.rotateX(Math.PI / 2);
  const deck = new THREE.Mesh(geometry, cut);
  deck.position.y = upper ? .184 : 0;
  deck.name = side > 0 ? 'near-horizontal-drilled-split-face' : 'far-horizontal-drilled-split-face';
  deck.castShadow = true;
  deck.receiveShadow = true;
  parent.add(deck);
  // Blind drilled sockets have dark bottoms; through-holes against the white
  // background disappear even though their geometry is open.
  const boreGeometry = new THREE.CircleGeometry(.044, 14);
  boreGeometry.rotateX(-Math.PI / 2);
  const bores = new THREE.InstancedMesh(boreGeometry, new THREE.MeshStandardMaterial({ color: 0x101315, roughness: .82 }), boreCenters.length);
  const dummy = new THREE.Object3D();
  boreCenters.forEach((center, i) => {
    dummy.position.set(center.x, -.13, center.y);
    dummy.updateMatrix();
    bores.setMatrixAt(i, dummy.matrix);
  });
  bores.name = 'drilled-bore-bottoms';
  parent.add(bores);
  if (upper) {
    bores.position.y = .18;
    const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(.062, .062, .065, 6), cut, boreCenters.length);
    boreCenters.forEach((center, i) => {
      dummy.position.set(center.x, .23, center.y);
      dummy.updateMatrix();
      bolts.setMatrixAt(i, dummy.matrix);
    });
    bolts.castShadow = true;
    bolts.name = 'upper-casing-joint-bolts';
    parent.add(bolts);
    const washers = new THREE.InstancedMesh(new THREE.CylinderGeometry(.084, .084, .018, 16), cut, boreCenters.length);
    boreCenters.forEach((center, i) => {
      dummy.position.set(center.x, .197, center.y);
      dummy.updateMatrix();
      washers.setMatrixAt(i, dummy.matrix);
    });
    washers.name = 'casing-joint-washers';
    parent.add(washers);
  }
}
