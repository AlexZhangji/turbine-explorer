import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTurbineModel, rotateRotor } from '../src/turbine.ts';
import { caseRadiusAt } from '../src/sectioned-case.ts';

const model = createTurbineModel();
model.root.updateMatrixWorld(true);
const ancestorsInclude = (object, parent) => {
  for (let node = object; node; node = node.parent) if (node === parent) return true;
  return false;
};
const fixed = [];
const moving = [];
const stages = [];
const turbineRows = [];
let lugs = 0;
model.root.traverse(object => {
  const row = object.userData.bladeRow;
  if (row) {
    assert.equal(ancestorsInclude(object, model.rotor), row.role === 'rotating', `${object.name}: wrong motion parent`);
    (row.role === 'rotating' ? moving : fixed).push([object, object.matrixWorld.clone()]);
    if (object.name.startsWith('turbine-rotor-')) stages.push(row);
    if (object.name.startsWith('turbine-')) {
      object.geometry.computeBoundingBox();
      turbineRows.push({ min: row.x + object.geometry.boundingBox.min.x, max: row.x + object.geometry.boundingBox.max.x });
    }
  }
  if (object.name === 'surface-attached-lifting-lug') {
    lugs++;
    const position = object.geometry.getAttribute('position');
    let footOffset = Infinity;
    for (let i = 0; i < position.count; i++) {
      const x = object.position.x + position.getX(i), z = object.position.z + position.getZ(i);
      const r = caseRadiusAt(object.userData.attachment.stations, x);
      const offset = position.getY(i) - Math.sqrt(r * r - z * z);
      footOffset = Math.min(footOffset, offset);
    }
    assert(footOffset < -.02 && footOffset > -.08, 'Lifting lug foot must embed in its actual casing');
  }
});
assert.equal(stages.length, 4);
// The featured cooled-blade entry must resolve to the first hot turbine row,
// downstream of the nozzle row, never the inlet compressor row.
const featuredRow = model.root.getObjectByName('turbine-rotor-1');
const firstNozzle = model.root.getObjectByName('turbine-stator-1');
const inletCompressor = model.root.getObjectByName('compressor-rotor-01');
assert(featuredRow && firstNozzle && inletCompressor);
assert(ancestorsInclude(featuredRow, model.rotor));
assert(!ancestorsInclude(firstNozzle, model.rotor));
assert(featuredRow.userData.bladeRow.x > firstNozzle.userData.bladeRow.x);
assert(firstNozzle.userData.bladeRow.x > inletCompressor.userData.bladeRow.x);
assert.equal(featuredRow.userData.bladeRow.x, Math.min(...stages.map(row => row.x)));
stages.sort((a, b) => a.x - b.x);
for (let i = 1; i < stages.length; i++) assert(stages[i].tip > stages[i - 1].tip, 'Turbine annulus must expand downstream');
assert.equal(lugs, 4);
turbineRows.sort((a, b) => a.min - b.min);
for (let i = 1; i < turbineRows.length; i++) assert(turbineRows[i].min > turbineRows[i - 1].max, 'Turbine rotor and stator airfoils must not interpenetrate');
assert.equal(moving.length, 18, '14 compressor and 4 turbine rotor rows');
assert(fixed.length >= 17, 'Compressor and turbine stationary rows present');

// Front support regression: closed, positive-winding webs must connect to the
// continuous carrier, stay below the cut plane, and remain outside the shaft.
const frontCarrier = model.root.getObjectByName('continuous-lower-bearing-carrier');
const upperCarrier = model.root.getObjectByName('removable-upper-bearing-carrier');
const inletWebs = model.root.getObjectByName('integrated-inlet-support-webs');
assert(frontCarrier && upperCarrier && inletWebs);
assert.equal(inletWebs.children.length, 3);
assert(ancestorsInclude(upperCarrier, model.casing));
assert(!model.root.getObjectByName('front-bearing-axial-load-brace'));
assert(!model.root.getObjectByName('front-bearing-split-bed'));
for (const web of inletWebs.children) {
  assert(ancestorsInclude(web, model.stator));
  const p = web.geometry.getAttribute('position');
  const ids = web.geometry.index.array;
  let volume = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < ids.length; i += 3) {
    a.fromBufferAttribute(p, ids[i]); b.fromBufferAttribute(p, ids[i + 1]); c.fromBufferAttribute(p, ids[i + 2]);
    volume += a.dot(b.cross(c)) / 6;
  }
  assert(volume > .05, `${web.name}: outward-wound closed solid`);
  const edges = new Map();
  for (let i = 0; i < ids.length; i += 3) for (let k = 0; k < 3; k++) {
    const x = ids[i + k], y = ids[i + (k + 1) % 3];
    const key = x < y ? `${x}:${y}` : `${y}:${x}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  assert([...edges.values()].every(count => count === 2), 'No open support edges');
  for (let i = 0; i < p.count; i++) {
    assert(p.getY(i) < 0, 'Support does not cross the cut plane');
    assert(Math.hypot(p.getY(i), p.getZ(i)) > .7, 'Support clears the rotor journal');
  }
  for (let i = 0; i < 32; i++) {
    const r = Math.hypot(p.getY(i), p.getZ(i));
    assert(r > .72 && r < .98, 'Support root embedded within lower carrier wall');
    assert(Math.abs(p.getX(i) - frontCarrier.position.x) < 1.06, 'Support root inside carrier axial span');
  }
  fixed.push([web, web.matrixWorld.clone()]);
}

const covers = model.combustorModules.map(module => module.getObjectByName('combustor-can-and-end-cover'));
const lowerModules = model.combustorModules.filter(module => module.userData.cutawayVisible);
assert.equal(lowerModules.length, model.combustorModules.length / 2, 'Cutaway retains the complete lower semicircle');
for (const side of [-1, 1]) {
  assert.equal(lowerModules.filter(module => Math.sign(module.userData.serviceDirection.z) === side).length, lowerModules.length / 2,
    'Both lower casing flanks retain the same number of combustor covers');
}
for (const module of model.combustorModules) {
  assert.equal(module.userData.cutawayVisible, module.userData.serviceDirection.y <= 0, 'Visibility follows the actual horizontal casing cut');
}
for (let i = 0; i < covers.length; i++) {
  assert(covers[i].position.equals(covers[0].position), 'End covers must not have view-specific axial offsets');
  assert(Math.abs(model.combustorModules[i].rotation.x - (i * Math.PI / 8 + Math.PI / 16)) < 1e-9);
  const duct = model.combustorModules[i].getObjectByName('connected-combustor-transition');
  assert(duct, 'Each burner needs its own attached transition');
  assert.deepEqual(duct.userData.attachment.localStart, covers[i].position.toArray());
  fixed.push([moduleAt(i), moduleAt(i).matrixWorld.clone()]);
}
function moduleAt(i) { return model.combustorModules[i]; }
for (const group of [model.stator, model.casing, model.combustion, model.exhaust]) fixed.push([group, group.matrixWorld.clone()]);
rotateRotor(model.rotor, .5, 1.4);
model.root.updateMatrixWorld(true);
for (const [object, matrix] of fixed) assert(object.matrixWorld.equals(matrix), `${object.name}: stationary part rotated`);
for (const [object, matrix] of moving) assert(!object.matrixWorld.equals(matrix), `${object.name}: rotor row failed to rotate`);
console.log('PASS: expanding turbine stages, attached lugs, consistent combustor ring, connected transitions, rotating vs stationary hierarchy.');

assert(model.lowerCasing.children.length > 10, 'Lower casing must be a real removable assembly');
assert(ancestorsInclude(model.lowerCasing, model.stator));
const beforeExpansion = [];
model.root.traverse(object => { if (object instanceof THREE.Mesh) beforeExpansion.push([object, object.matrixWorld.clone()]); });
model.lowerCasing.position.y = -3.4;
model.root.updateMatrixWorld(true);
const expectedDrop = new THREE.Vector3(0, -3.4, 0).applyMatrix4(model.stator.matrixWorld)
  .sub(new THREE.Vector3().setFromMatrixPosition(model.stator.matrixWorld));
for (const [object, matrix] of beforeExpansion) {
  if (ancestorsInclude(object, model.lowerCasing)) {
    const travel = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(matrix));
    assert(travel.distanceTo(expectedDrop) < 1e-8, 'Complete lower assembly travels together in the tilted machine frame');
  } else assert(object.matrixWorld.equals(matrix), 'Lower casing separation must not drag core rows or bearings');
}
model.lowerCasing.position.y = 0;
model.root.updateMatrixWorld(true);
for (const [object, matrix] of beforeExpansion) assert(object.matrixWorld.equals(matrix), 'Reassembly restores original geometry transforms');
console.log('PASS: lower-casing group separation, stationary core, exact reassembly.');
