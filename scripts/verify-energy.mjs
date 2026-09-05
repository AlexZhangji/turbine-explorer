import assert from 'node:assert/strict';
import {energyKWh,householdDays,RATED_POWER_MW} from '../src/energy.ts';
import {createTurbineModel} from '../src/turbine.ts';
import {createOperatingEffects} from '../src/operating-effects.ts';
assert.equal(RATED_POWER_MW,571);
assert.equal(energyKWh(571,3600),571000);
assert(Math.abs(energyKWh(571,1)-158.61111111111111)<1e-10);
assert(Math.abs(householdDays(energyKWh(571,1),10)-15.86111111111111)<1e-10);
assert.equal(householdDays(100,20),5);
assert.equal(householdDays(100,0),0);
assert.equal(energyKWh(0,30),0);
assert(Math.abs(Array.from({length:60},()=>energyKWh(571,1/60)).reduce((a,b)=>a+b,0)-energyKWh(571,1))<1e-10);
const model=createTurbineModel(),effects=createOperatingEffects(model.combustorModules);
assert.equal(effects.group.visible,false);
effects.update(1,true,.05);
assert.equal(effects.group.visible,true);
for(const module of model.combustorModules){
  const can=module.getObjectByName('combustor-can-and-end-cover');
  const flame=module.getObjectByName('combustor-heat-illustration');
  assert.equal(flame.parent,can,'Heat overlay moves with its combustor, not the rotor or world');
}
for(let i=0;i<80;i++)effects.update(2+i*.05,false,.05);
assert.equal(effects.group.visible,false,'Effects extinguish after stop');
console.log('PASS: MW/kWh/seconds conversion, household assumption, frame integration, attached heat effects and shutdown.');
