export type RenderQuality = 'balanced' | 'high' | 'ultra';
const requested = new URLSearchParams(location.search).get('quality');
const valid = (value: string | null): value is RenderQuality => ['balanced', 'high', 'ultra'].includes(value ?? '');
let saved: string | null = null;
try { saved = localStorage.getItem('turbine-quality'); } catch { /* Storage is optional. */ }
let quality: RenderQuality = valid(requested) ? requested : valid(saved) ? saved : matchMedia('(max-width: 700px)').matches ? 'balanced' : 'high';
const listeners = new Set<() => void>();
export const getRenderQuality = () => quality;
// High presets supersample even on a 1x display. Bound the longest GPU surface.
export function renderPixelRatio(width: number, height: number) {
  const ratio = quality === 'ultra' ? 3 : quality === 'high' ? 2 : Math.min(devicePixelRatio, 1.35);
  return Math.min(ratio, 4096 / Math.max(1, width, height));
}
export function setRenderQuality(next: RenderQuality) {
  quality = next;
  try { localStorage.setItem('turbine-quality', next); } catch { /* Keep the URL setting. */ }
  const url = new URL(location.href); url.searchParams.set('quality', next); history.replaceState(null, '', url);
  listeners.forEach(listener => listener());
}
export const onRenderQuality = (listener: () => void) => { listeners.add(listener); };
