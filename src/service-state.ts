// Presentation sequencing only, not a manufacturer's maintenance procedure.
export function serviceInterlock(stage: number, blend: number) {
  return stage > 0 || blend > .003;
}

export function serviceTarget(stage: number, rotorPercent: number, kinematicDemo: boolean) {
  if (stage === 0 || (!kinematicDemo && rotorPercent > .6)) return 0;
  return stage === 1 ? .56 : 1;
}

const windowed = (value: number, start: number, end: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

export function servicePose(blend: number) {
  return {
    turbineCasingLift: windowed(blend, .02, .38),
    majorCasingLift: windowed(blend, .58, .76),
    casingPark: windowed(blend, .77, .89),
    combustorRemoval: windowed(blend, .9, 1),
    majorSpread: windowed(blend, .54, .94),
    lowerCasingDrop: windowed(blend, .58, .88),
  };
}
