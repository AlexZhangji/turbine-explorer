import * as THREE from 'three';
import './backdrop.css';

export type Backdrop = 'blueprint' | 'paper' | 'white' | 'graphite';
const presets: Record<Backdrop, { center: string; edge: string; grid?: string; light: boolean }> = {
  blueprint: { center: '#203d51', edge: '#081624', grid: '#8bc6e1', light: false },
  paper: { center: '#ffffff', edge: '#ffffff', grid: '#0050d0', light: true },
  white: { center: '#ffffff', edge: '#e3e5e5', light: true },
  graphite: { center: '#353b40', edge: '#101418', light: false },
};
const valid = (value: string | null): value is Backdrop => !!value && Object.hasOwn(presets, value);
let saved: string | null = null;
try { saved = localStorage.getItem('turbine-backdrop'); } catch { /* Optional persistence. */ }
const requested = new URLSearchParams(location.search).get('background');
let current: Backdrop = valid(requested) ? requested : valid(saved) ? saved : 'blueprint';
const listeners = new Set<() => void>();
function applyTheme() {
  document.documentElement.dataset.backdrop = current;
  document.documentElement.dataset.backdropTone = presets[current].light ? 'light' : 'dark';
}
applyTheme();
export function setBackdrop(value: Backdrop) {
  current = value; applyTheme();
  try { localStorage.setItem('turbine-backdrop', value); } catch { /* Keep the live selection. */ }
  const url = new URL(location.href); url.searchParams.set('background', value);
  history.replaceState(null, '', url);
  listeners.forEach(listener => listener());
}

// An opaque scene background, not an overlay, reflection map or physical floor.
// The render depth and antialiasing resolve the model over this sheet in one frame.
export function createBackdrop(scene: THREE.Scene) {
  const surface = document.createElement('canvas');
  const context = surface.getContext('2d')!;
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  let width = 0, height = 0, painted: Backdrop | undefined;
  function resize(w: number, h: number) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (w === width && h === height && painted === current) { scene.background = texture; return; }
    width = w; height = h; painted = current;
    const scale = Math.min(2, 2048 / Math.max(w, h));
    surface.width = Math.round(w * scale); surface.height = Math.round(h * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    const preset = presets[current];
    // Keep white paper white after the scene's photographic tone mapping.
    // This changes only the background, never the metal lighting/environment.
    scene.backgroundIntensity = current === 'paper' ? 3.5 : preset.light ? 1.8 : 1;
    const gradient = context.createRadialGradient(w * .54, h * .43, 0, w * .54, h * .43, Math.max(w, h) * .72);
    gradient.addColorStop(0, preset.center); gradient.addColorStop(1, preset.edge);
    context.fillStyle = gradient; context.fillRect(0, 0, w, h);
    if (preset.grid) {
      context.strokeStyle = preset.grid;
      const step = w < 560 ? 30 : 40;
      for (let axis = 0; axis < 2; axis++) {
        for (let p = 0; p <= (axis ? h : w); p += step) {
          const major = p % (step * 5) === 0;
          context.globalAlpha = current === 'paper' ? (major ? .98 : .85) : (major ? .14 : .055);
          context.lineWidth = current === 'paper' && major ? 1.25 : 1;
          context.beginPath();
          context.moveTo(axis ? 0 : p + .5, axis ? p + .5 : 0);
          context.lineTo(axis ? w : p + .5, axis ? p + .5 : h);
          context.stroke();
        }
      }
      context.globalAlpha = 1;
    }
    texture.needsUpdate = true; scene.background = texture;
  }
  listeners.add(() => { if (width) resize(width, height); });
  return { resize, restore: () => { scene.background = texture; } };
}

export function appendBackdropControl(panel: HTMLElement) {
  const label = document.createElement('label');
  label.className = 'backdrop-control';
  label.innerHTML = '<span>背景</span><select aria-label="背景"><option value="blueprint">深蓝蓝图</option><option value="paper">白底蓝线</option><option value="white">白色摄影棚</option><option value="graphite">深灰摄影棚</option></select>';
  const select = label.querySelector('select')!;
  select.value = current;
  select.onchange = () => setBackdrop(select.value as Backdrop);
  panel.append(label);
  listeners.add(() => { select.value = current; });
}
