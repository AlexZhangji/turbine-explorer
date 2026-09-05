import assert from 'node:assert/strict';
import * as THREE from 'three';
import { profileShell, addHorizontalSplitDeck } from '../src/sectioned-case.ts';

const material = new THREE.MeshStandardMaterial();
const materials = { outer: material, inner: material, cut: material };
const stations = [{ x: -2, r: 3, wall: .3 }, { x: 0, r: 2.5, wall: .25 }, { x: 2, r: 2.8, wall: .2 }];
const lower = profileShell(stations, materials);
const upper = profileShell(stations, materials, 0, Math.PI);
const barrel = profileShell(stations, materials, 0, Math.PI * 2);
for (const [name, mesh] of [['lower', lower], ['upper', upper], ['barrel', barrel]]) {
  const positions = mesh.geometry.getAttribute('position');
  const normals = mesh.geometry.getAttribute('normal');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i);
    b.fromBufferAttribute(positions, i + 1);
    c.fromBufferAttribute(positions, i + 2);
    n.fromBufferAttribute(normals, i);
    const face = b.sub(a).cross(c.sub(a)).normalize();
    assert(face.dot(n) > .99, `${name}: triangle ${i / 3} has reversed winding`);
  }
  for (let i = 0; i < positions.count; i++) {
    if (name === 'lower') assert(positions.getY(i) <= 1e-6, 'Lower casing crosses the split plane');
    if (name === 'upper') assert(positions.getY(i) >= -1e-6, 'Upper casing crosses the split plane');
    assert(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i)));
  }
}
for (const side of [-1, 1]) {
  const group = new THREE.Group();
  addHorizontalSplitDeck(group, stations, material, side, true);
  assert(group.getObjectByName('upper-casing-joint-bolts')?.count > 0);
  assert(group.getObjectByName('drilled-bore-bottoms')?.count > 0);
}
console.log('PASS: shell face orientation, complementary half-spaces, full barrel, drilled joints and enclosure bolts.');
