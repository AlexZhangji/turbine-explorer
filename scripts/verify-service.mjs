import assert from 'node:assert/strict';
import { serviceInterlock, serviceTarget, servicePose } from '../src/service-state.ts';

assert.equal(serviceInterlock(0, 0), false);
assert.equal(serviceInterlock(1, 0), true, 'Lock before geometry starts moving');
assert.equal(serviceInterlock(0, .8), true, 'Returning geometry remains interlocked');
assert.equal(serviceTarget(2, 12, false), 0, 'Wait for rotor coastdown before opening');
assert.equal(serviceTarget(2, 0, false), 1);
assert.equal(serviceTarget(0, 12, true), 0, 'Reassembly always returns home');
assert.equal(servicePose(.56).combustorRemoval, 0, 'Hot inspection leaves cans installed');
assert.equal(servicePose(.56).majorCasingLift, 0);
for (let step = 0; step <= 1000; step++) {
  const pose = servicePose(step / 1000);
  if (pose.casingPark > 0) assert.equal(pose.majorCasingLift, 1, 'Lift before lateral presentation offset');
  if (pose.combustorRemoval > 0) {
    assert.equal(pose.majorCasingLift, 1, 'Casing clearance precedes can withdrawal in both directions');
    assert.equal(pose.casingPark, 1, 'Park before can withdrawal');
  }
  for (const value of Object.values(pose)) assert(value >= 0 && value <= 1);
}
assert.deepEqual(servicePose(0), { turbineCasingLift: 0, majorCasingLift: 0, casingPark: 0, combustorRemoval: 0, majorSpread: 0, lowerCasingDrop: 0 });
assert.deepEqual(servicePose(1), { turbineCasingLift: 1, majorCasingLift: 1, casingPark: 1, combustorRemoval: 1, majorSpread: 1, lowerCasingDrop: 1 });
console.log('PASS: coastdown, return interlock, casing-first sequence, installed hot-inspection cans, reversible normalized travel.');
