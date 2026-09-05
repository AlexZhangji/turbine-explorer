import * as THREE from 'three';
import { caseRadiusAt, type CaseStation } from './sectioned-case.ts';

/** Public-reference approximation: broad fixed webs, not a second row of blades. */
export function createInletSupportWebs(stations: CaseStation[], material: THREE.Material) {
  const group = new THREE.Group();
  group.name = 'integrated-inlet-support-webs';
  for (const [index, angle] of [Math.PI * 7 / 6, Math.PI * 1.5, Math.PI * 11 / 6].entries()) {
    const positions: number[] = [], indices: number[] = [], uvs: number[] = [];
    const spanSteps = 20, ringSteps = 32;
    for (let j = 0; j <= spanSteps; j++) {
      const span = j / spanSteps;
      const chord = THREE.MathUtils.lerp(1.8, 2.3, span);
      const halfThickness = .065 + .11 * Math.pow(1 - span, 4) + .12 * Math.pow(span, 6);
      for (let k = 0; k < ringSteps; k++) {
        const phase = k / ringSteps * Math.PI * 2;
        const x = -7.08 + Math.cos(phase) * chord / 2;
        const wall = THREE.MathUtils.lerp(.24, .49, THREE.MathUtils.clamp((-x - 8.05) / .15, 0, 1));
        const outerContact = caseRadiusAt(stations, x) - wall + .065;
        const r = THREE.MathUtils.lerp(.87, outerContact, span);
        const offset = Math.sin(phase) * halfThickness;
        positions.push(x, Math.sin(angle) * r + Math.cos(angle) * offset,
          Math.cos(angle) * r - Math.sin(angle) * offset);
        uvs.push(k / ringSteps, span);
      }
    }
    for (let j = 0; j < spanSteps; j++) {
      for (let k = 0; k < ringSteps; k++) {
        const a = j * ringSteps + k, b = j * ringSteps + (k + 1) % ringSteps;
        indices.push(a, b, a + ringSteps, b, b + ringSteps, a + ringSteps);
      }
    }
    for (const end of [0, spanSteps]) {
      const center = positions.length / 3;
      const offset = end * ringSteps;
      const sum = new THREE.Vector3();
      for (let k = 0; k < ringSteps; k++) sum.add(new THREE.Vector3().fromArray(positions, (offset + k) * 3));
      positions.push(...sum.divideScalar(ringSteps).toArray()); uvs.push(.5, end / spanSteps);
      for (let k = 0; k < ringSteps; k++) {
        const a = offset + k, b = offset + (k + 1) % ringSteps;
        indices.push(...(end === 0 ? [center, b, a] : [center, a, b]));
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `inlet-bearing-web-${index + 1}`;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.attachment = {
      parentId: 'sectioned-front-bearing-housing', parentSocket: 'lower-carrier-to-inlet-casting',
      localStart: [-7.08, Math.sin(angle) * .87, Math.cos(angle) * .87],
      localEnd: [-7.08, Math.sin(angle) * 2.22, Math.cos(angle) * 2.22],
      contactType: 'embedded', embedDepth: .065, gapTolerance: .01,
      evidenceRefs: ['ge-9ha-cutaway-hero-1920x1120.png', 'video/2Jm5RVHLlcQ/frames/031.00s-inlet-frame.png'],
      approximation: 'Authored continuous support surfaces, not OEM load-path dimensions.',
    };
    group.add(mesh);
  }
  return group;
}
