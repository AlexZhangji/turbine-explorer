import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBladeStudy, bladePoint } from '../src/blade-study.ts';
import { createTurbineModel } from '../src/turbine.ts';

const blade = createBladeStudy();
let triangles = 0, meshes = 0;
blade.root.traverse(object => {
  if (!object.isMesh) return;
  meshes++;
  const g = object.geometry;
  triangles += (g.index?.count ?? g.attributes.position.count) / 3;
  for (const attr of ['position', 'normal']) for (const n of g.attributes[attr].array) assert(Number.isFinite(n), `${object.name}: invalid ${attr}`);
});
assert(triangles < 180000, 'Standalone blade geometry budget');
assert(meshes < 50, 'Repeated interior geometry must be batched');
const front = blade.root.getObjectByName('pressure-side-teaching-section');
const section = blade.root.getObjectByName('integral-cooling-cutaway');
const interior = blade.root.getObjectByName('internal-cooling');
assert(front && section && interior && interior.children.length > 0);
for (const skin of [front.children[0], section.children[0], blade.root.getObjectByName('suction-side-wall')]) {
  const g = skin.geometry, p = g.attributes.position, n = g.attributes.normal;
  let consistentArea = 0, checkedArea = 0;
  for (let i = 0; i < g.index.count; i += 3) {
    const ids = [0, 1, 2].map(j => g.index.getX(i + j));
    const [a, b, c] = ids.map(j => new THREE.Vector3().fromBufferAttribute(p, j));
    const cross = b.sub(a).cross(c.sub(a));
    if (cross.lengthSq() < 1e-14) continue;
    const average = ids.reduce((sum, j) => sum.add(new THREE.Vector3().fromBufferAttribute(n, j)), new THREE.Vector3());
    checkedArea += cross.length(); if (cross.dot(average) > 0) consistentArea += cross.length();
  }
  // Area weighting prevents near-collinear earcut slivers from dominating this
  // normal-orientation regression. The inverted pressure sheet fails wholesale.
  assert(consistentArea / checkedArea > .998, `Loft surface winding must agree with transformed normals: ${skin.name || skin.parent.name}`);
  assert.equal(g.groups.length, 2, 'External ceramic and internal alloy use distinct material groups');
}
assert.equal(blade.root.userData.view, 'layers', 'Coatings and cooling are presented together by default');
const coupon=blade.root.getObjectByName('magnified-coating-coupon');
assert(coupon.visible && coupon.children.length === 4, 'Default coating study includes the grown oxide layer');
const topcoat=coupon.getObjectByName('YSZ-ceramic-topcoat').material;
const substrate=coupon.getObjectByName('nickel-superalloy-substrate').material;
const topcoatMesh=coupon.getObjectByName('YSZ-ceramic-topcoat');
const layerRest=topcoatMesh.position.clone();
blade.highlightLayer(3); blade.update(1,0);
assert.equal(blade.root.userData.highlightedLayer,3);
assert(topcoatMesh.position.distanceTo(layerRest)>.1,'Selected coupon moves clear of stack');
assert(topcoatMesh.children[0].visible,'Selected layer has a visible annotation outline');
blade.highlightLayer(null); blade.update(1,0);
assert(topcoatMesh.position.distanceTo(layerRest)<.0001,'Hover restores exact layout without accumulating travel');
assert.equal(topcoat.emissiveIntensity,0,'Selection color clears on pointer exit');
assert(!topcoatMesh.children[0].visible);
assert.equal(topcoat.metalness, 0, 'Ceramic must not reflect like a metal');
assert(topcoat.roughness > substrate.roughness, 'Ceramic scatters highlights more than machined alloy');
assert(topcoat.bumpMap && topcoat.roughnessMap && topcoat.bumpMap !== topcoat.roughnessMap, 'Independent ceramic height and roughness channels');
assert(blade.root.getObjectByName('cooling-air-explanatory-overlay').visible, 'Default coating study has cooling flow');
assert(section.visible && !front.visible, 'Initial view exposes the interior');
blade.setView('cooling'); for (let i = 0; i < 150; i++) blade.update(1 / 60, i / 60);
assert(!front.visible && section.visible && front.position.length() === 0, 'Integral cutaway, no detached cover');
assert(blade.root.getObjectByName('cooling-air-explanatory-overlay').visible);
const airflow = blade.root.getObjectByName('cooling-air-explanatory-overlay');
const particles = airflow.children.find(object => object.isPoints);
assert(particles && particles.geometry.attributes.position.count > 0, 'Flow has animated direction markers');
const beforeParticles = Array.from(particles.geometry.attributes.position.array);
blade.update(1 / 60, 4);
assert.notDeepEqual(Array.from(particles.geometry.attributes.position.array), beforeParticles, 'Flow markers advance in time');
airflow.traverse(object => assert(!object.castShadow, 'Explanatory airflow cannot cast physical shadows'));
blade.setView('surface'); for (let i = 0; i < 200; i++) blade.update(1 / 60, i / 60);
assert(front.position.length() < .0001, 'Closed surface restores original attachment');
assert(front.visible && !section.visible, 'Complete skin replaces cutaway');
assert(!blade.root.getObjectByName('cooling-air-explanatory-overlay').visible);
blade.setView('layers'); assert(blade.root.getObjectByName('magnified-coating-coupon').visible);
assert(section.visible && !front.visible, 'Coating study retains the cooling cutaway');
blade.setFlow(false); assert(!airflow.visible, 'Flow can be disabled without closing cutaway');
assert(section.visible);
blade.setFlow(true); assert(airflow.visible);
for (const t of [0, .3, .7, 1]) assert(bladePoint(.4, t, 1).distanceTo(bladePoint(.4, t, -1)) > .2, 'Real airfoil thickness');

const model = createTurbineModel(); model.root.updateMatrixWorld(true);
const source = model.root.getObjectByName('turbine-rotor-1');
const before = Array.from(source.instanceMatrix.array);
const clone = source.clone(); clone.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0));
assert.deepEqual(Array.from(source.instanceMatrix.array), before, 'Inspecting a single instance must not remove it from the main model');
const matrix = new THREE.Matrix4(); source.getMatrixAt(0, matrix);
const extracted = new THREE.Mesh(source.geometry, source.material);
source.matrixWorld.clone().multiply(matrix).decompose(extracted.position, extracted.quaternion, extracted.scale);
extracted.updateMatrixWorld(true);
const corner = new THREE.Vector3(.1, .2, .05);
assert(corner.clone().applyMatrix4(extracted.matrixWorld).distanceTo(corner.clone().applyMatrix4(matrix).applyMatrix4(source.matrixWorld)) < 1e-8, 'Instance origin preserves assembly world transform');
console.log(`PASS: blade volume, finite geometry, default integral cutaway, animated airflow, coating modes, instance isolation. ${triangles} triangles / ${meshes} meshes.`);
