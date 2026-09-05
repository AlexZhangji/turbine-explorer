import { t, onLanguage } from './i18n';
import './exhibition.css';
import { energyKWh, householdDays, RATED_POWER_MW } from './energy';
import { getRenderQuality, setRenderQuality, type RenderQuality } from './render-quality';

type ExhibitAPI = {
  volume: () => number;
  setVolume: (percent:number) => void;
  phase: (view:number) => void;
  console: () => void;
  inspect: (id:string) => void;
  highlight: (id:string|null) => void;
  pick: (x:number,y:number) => string|null;
  frameAssembly: (side:boolean) => void;
  prepareSound: () => void;
  transitionSound: (view:number) => void;
  blade: () => void;
  motion: (enabled:boolean) => void;
  sound: () => Promise<void>;
  run: (enabled:boolean) => void;
  energy: () => {powerMW:number;kWh:number;seconds:number};
  status: () => { moving:boolean; interlocked:boolean; preview:boolean; soundEnabled:boolean; running:boolean; starting:boolean };
  project: (id:string) => {x:number;y:number;visible:boolean};
};
// Keep numeric links, but make assembly the first view, not a tour chapter.
const views = [
  { id:2, label:'爆炸图', title:'部件与装配', description:'打开机壳，分开组件。点击标记，单独取出一个部件，再旋转、放大观察。', note:'展开距离用于展示装配关系，不代表实际检修步骤。' },
  { id:1, label:'剖面', title:'内部结构', description:'从压气机到涡轮，沿主轴看清内部结构。开启转动示意，观察动叶与静叶的区别。', note:'转动示意经过减速，不模拟真实运行或发电。' },
  { id:0, label:'完整外观', title:'燃气轮机', description:'旋转观察机壳与外部接口。切换到爆炸图，查看这些部件如何装配。', note:'拖动旋转，滚轮缩放。声音需要手动开启。' },
];
export function installExhibition(api: ExhibitAPI) {
  const app = document.querySelector<HTMLElement>('#app')!;
  const layer = document.createElement('section'); layer.className='exhibition'; layer.hidden=true;
  layer.innerHTML=`<header class="exhibit-header"><div><span class="exhibit-eyebrow">燃气轮机 / 交互模型</span><b>GE 9HA.02</b></div><button data-exhibit-console>运行控制台 ↗</button></header><div class="exhibit-copy"><div class="exhibit-counter"></div><h1></h1><p></p><button class="exhibit-primary">查看冷却叶片 ↗</button><span class="exhibit-blade-note">第一级涡轮动叶 · 冷却原理示意</span></div><div class="exhibit-hotspots"></div><footer class="exhibit-footer"><nav aria-label="模型视图">${views.map(view=>`<button data-chapter="${view.id}"><b>${view.label}</b><i></i></button>`).join('')}</nav><div class="exhibit-transport"><div class="exhibit-controls"><button data-exhibit-orbit></button><button data-exhibit-motion></button><button data-exhibit-sound></button></div><span class="exhibit-note"></span><span class="exhibit-audio-note" role="status"></span></div></footer>`;
  app.append(layer);
  layer.querySelector('.exhibit-eyebrow')!.textContent='9HA.02';
  layer.querySelector('.exhibit-header b')!.textContent='GE Vernova';
  const run=document.createElement('button');run.className='exhibit-run';run.type='button';
  layer.querySelector('.exhibit-primary')!.before(run);
  const dock = layer.querySelector('.exhibit-footer')!;
  const settings = document.createElement('details'); settings.className='exhibit-settings';
  settings.innerHTML='<summary aria-label="展示设置" title="展示设置">⋯</summary><div class="exhibit-settings-panel"><label class="quality-label"><span>渲染画质</span><select data-quality><option value="balanced">流畅</option><option value="high">精细 · 2×</option><option value="ultra">演示 · 最高 3×</option></select></label><p class="quality-note">提高渲染清晰度，不改变几何细节。高画质更耗显存，最长边上限 4096 像素。</p></div>';
  settings.querySelector('.exhibit-settings-panel')!.prepend(layer.querySelector('.exhibit-transport')!);
  const credit = document.createElement('p');
  credit.className = 'quality-note';
  credit.textContent = '独立原理展示，非 GE 官方产品。';
  settings.querySelector('.exhibit-settings-panel')!.append(credit);
  dock.append(run,layer.querySelector('.exhibit-primary')!,settings);
  const volumeLabel=document.createElement('label');volumeLabel.className='exhibit-volume';
  volumeLabel.innerHTML='<span>声音音量</span><output data-volume-value>25%</output><input data-exhibit-volume type="range" min="0" max="100" step="1" value="25" aria-label="声音音量">';
  settings.querySelector('.exhibit-transport')!.after(volumeLabel);
  const volume=volumeLabel.querySelector<HTMLInputElement>('input')!;
  function refreshVolume(){volume.value=String(api.volume());volumeLabel.querySelector('output')!.textContent=`${api.volume()}%`;}
  volume.oninput=()=>{api.setVolume(Number(volume.value));refreshVolume();};
  settings.addEventListener('toggle',()=>{if(settings.open)refreshVolume();});
  const quality=settings.querySelector<HTMLSelectElement>('[data-quality]')!;
  quality.value=getRenderQuality();quality.onchange=()=>setRenderQuality(quality.value as RenderQuality);
  const sequenceButton=document.createElement('button');sequenceButton.className='sequence-control';sequenceButton.type='button';sequenceButton.dataset.sequence='';
  sequenceButton.innerHTML='<span>播放演示</span><small>剖面 → 展开 → 环绕 → 气流 → 冷却叶片</small>';
  settings.querySelector('.exhibit-settings-panel')!.prepend(sequenceButton);
  let sequenceTime=-1,sequencePhase=0;
  function stopSequence(){sequenceTime=-1;sequenceButton.querySelector('span')!.textContent=t('播放演示');sequenceButton.setAttribute('aria-pressed','false');}
  sequenceButton.onclick=()=>{
    if(sequenceTime>=0){stopSequence();return;}
    go(1);orbiting=false;sequencePhase=0;sequenceTime=0;api.prepareSound();settings.open=false;
    sequenceButton.querySelector('span')!.textContent=t('停止演示');sequenceButton.setAttribute('aria-pressed','true');refreshControls();
  };
  layer.addEventListener('click',event=>{if(!(event.target as Element).closest('[data-sequence]'))stopSequence();},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')stopSequence();});
  document.addEventListener('pointerdown',event=>{if(!settings.contains(event.target as Node))settings.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')settings.open=false;});
  const powerPanel=document.createElement('aside');powerPanel.className='exhibit-energy';
  powerPanel.innerHTML=`<details class="energy-detail"><summary><span class="energy-windows" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="energy-result"><span>相当于</span> <b data-energy-days>0</b> <span>户家庭的一天</span></span><span class="energy-expand">↗</span></summary><div class="energy-assumptions"><div class="energy-heading"><span>等效电量换算</span><span data-energy-state role="status"></span></div><p><b data-energy-kwh>0</b> <span>度电</span> · <span data-energy-power>0</span> MW · <span data-energy-seconds>0</span> <span>秒演示运行</span></p><p><span>额定运行 1 秒</span> ≈ <b data-energy-second></b> <span>天家庭用电</span></p><label><span>家庭每日用电</span> <output data-home-value>10</output> <span>度</span><input data-home-demand type="range" min="5" max="40" value="10" step="1" aria-label="家庭每日用电量"></label><p>四口之家示例，非统计平均值；不计输配电损耗。只做能量等值比较，不表示持续供电能力。</p><a href="https://www.gevernova.com/gas-power/products/gas-turbines/9ha" target="_blank" rel="noopener">GE 额定净功率 571 MW · ISO 条件 ↗</a></div></details><small class="energy-assumption"><span>按每户每日</span> <span data-home-inline>10</span> <span>度电等效换算 · 点击查看假设</span></small>`;
  layer.append(powerPanel);
  const energyClock=document.createElement('span');energyClock.className='energy-clock';
  energyClock.innerHTML='<b data-energy-clock>0.0</b> <span>秒运行</span><i> → </i>';
  powerPanel.querySelector('.energy-result')!.prepend(energyClock);
  const chain=document.createElement('div');chain.className='exhibit-energy-chain';chain.setAttribute('aria-label','能量转换示意');
  chain.innerHTML='<span>空气</span><i>→</i><span>燃烧</span><i>→</i><span>转轴</span><i>→</i><span>发电机</span><i>→</i><span>家庭用电</span>';
  layer.querySelector('.exhibit-footer')!.before(chain);
  const demand=powerPanel.querySelector<HTMLInputElement>('[data-home-demand]')!;
  let dailyDemand=10,energyTick=0;
  function refreshEnergy(){
    const value=api.energy(),format=(n:number,digits=1)=>n.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
    powerPanel.querySelector('[data-energy-kwh]')!.textContent=format(value.kWh);
    powerPanel.querySelector('[data-energy-days]')!.textContent=format(householdDays(value.kWh,dailyDemand));
    powerPanel.querySelector('[data-energy-power]')!.textContent=format(value.powerMW,0);
    powerPanel.querySelector('[data-energy-seconds]')!.textContent=format(value.seconds,1);
    powerPanel.querySelector('[data-energy-clock]')!.textContent=format(value.seconds,1);
    layer.classList.toggle('has-energy',value.kWh>0);
    powerPanel.querySelector('[data-energy-second]')!.textContent=format(householdDays(energyKWh(RATED_POWER_MW,1),dailyDemand));
    powerPanel.querySelector('[data-home-inline]')!.textContent=String(dailyDemand);
    powerPanel.querySelector('[data-home-value]')!.textContent=String(dailyDemand);
  }
  demand.oninput=()=>{dailyDemand=Number(demand.value);refreshEnergy();};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let active=false, step=2, orbiting=!reduced.matches, hovering=false, inspectorOpen=false, busy=false, soundError=false, lastStatus='';
  let hoveredPart:string|null=null, hideTimer=0, lastPick=0;
  function reveal(id:string|null) {
    clearTimeout(hideTimer);hideTimer=0;
    if(hoveredPart!==id)api.highlight(id);
    hoveredPart=id;hovering=Boolean(id);
  }
  const deferHide=()=>{if(!hideTimer)hideTimer=window.setTimeout(()=>reveal(null),220);};
  const title=layer.querySelector('h1')!, description=layer.querySelector('.exhibit-copy p')!;
  const orbit=layer.querySelector<HTMLButtonElement>('[data-exhibit-orbit]')!, motion=layer.querySelector<HTMLButtonElement>('[data-exhibit-motion]')!, sound=layer.querySelector<HTMLButtonElement>('[data-exhibit-sound]')!;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('exhibit-leaders');svg.setAttribute('aria-hidden','true');layer.querySelector('.exhibit-hotspots')!.append(svg);
  const hotspots = [ ['combustor','燃烧室 / 放大 ↗'], ['turbine-1','第一级涡轮动叶 / 放大 ↗'] ].map(([id,label]) => {
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');svg.append(line);
    const button=document.createElement('button');button.className='exhibit-hotspot';button.textContent=label;
    button.onclick=()=>{hovering=false;api.highlight(null);api.inspect(id);};
    button.onpointerenter=button.onfocus=()=>reveal(id);
    button.onpointerleave=button.onblur=deferHide;
    layer.querySelector('.exhibit-hotspots')!.append(button);return {id,button,line};
  });
  function refreshControls() {
    const state=api.status();
    run.textContent=t(state.starting?'取消启动':state.running?'停止运行演示':'启动运行 · 气流与燃烧');
    run.setAttribute('aria-pressed',String(state.running||state.starting));
    layer.classList.toggle('is-operating',state.running);
    powerPanel.querySelector('[data-energy-state]')!.textContent=t(state.starting?'组件归位中':state.running?'运行演示中':'已停止');
    orbit.textContent=t(orbiting?'暂停自动旋转':'自动旋转');orbit.setAttribute('aria-pressed',String(orbiting));
    motion.textContent=t(state.moving?'暂停转动示意':'转动示意');motion.setAttribute('aria-pressed',String(state.moving));motion.disabled=state.interlocked;
    sound.textContent=t(busy?'正在启动声音':state.soundEnabled?'关闭声音':'开启声音');sound.setAttribute('aria-pressed',String(state.soundEnabled));sound.disabled=busy;
    layer.querySelector('.exhibit-audio-note')!.textContent=t(soundError?'音频未启动，请点试听重试':state.running?'爆炸与剖面运行均为示意；气流非 CFD。':state.preview?'正在试听 · 合成音效，非现场录音。':'启动运行可开启气流、燃烧和发电换算。');
  }
  function refresh() {
    const view=views.find(view=>view.id===step)!;
    title.textContent=t(view.title);description.textContent=t(view.description);
    layer.querySelector('.exhibit-counter')!.textContent=t('可拆解 · 可单独检视');
    layer.querySelector('.exhibit-note')!.textContent=t(view.note);
    layer.querySelectorAll<HTMLButtonElement>('[data-chapter]').forEach(button=>{button.setAttribute('aria-current',Number(button.dataset.chapter)===step?'page':'false');});
    layer.dataset.chapter=String(step);refreshControls();refreshEnergy();
  }
  function go(next:number, audible=true) {
    if(audible&&next!==step)api.transitionSound(next);
    reveal(null);step=views.some(view=>view.id===next)?next:2;api.phase(step);refresh();
    if(!reduced.matches)layer.querySelector('.exhibit-copy')!.animate([{opacity:0},{opacity:1}],{duration:350,easing:'ease-out'});
  }
  function enter(initial=1) {active=true;layer.hidden=false;app.classList.add('exhibition-mode');go(initial,false);}
  function leave() {api.highlight(null);hovering=false;active=false;layer.hidden=true;app.classList.remove('exhibition-mode');api.console();}
  layer.querySelector<HTMLButtonElement>('.exhibit-primary')!.onclick=()=>{hovering=false;api.highlight(null);api.blade();};
  orbit.onclick=()=>{orbiting=!orbiting;refreshControls();};
  motion.onclick=()=>{api.motion(!api.status().moving);refreshControls();};
  run.onclick=()=>{
    const state=api.status();
    if(state.running||state.starting)api.run(false);
    else {if(step!==2)go(1);api.run(true);}
    refreshControls();
  };
  sound.onclick=async()=>{busy=true;soundError=false;refreshControls();try{await api.sound();}catch{soundError=true;}finally{busy=false;refreshControls();}};
  reduced.addEventListener('change',()=>{if(reduced.matches)orbiting=false;refreshControls();});
  layer.querySelector('[data-exhibit-console]')!.addEventListener('click',leave);
  layer.querySelectorAll<HTMLButtonElement>('[data-chapter]').forEach(button=>button.onclick=()=>go(Number(button.dataset.chapter)));
  const launcher=document.createElement('button');launcher.textContent='模型展示';launcher.onclick=()=>enter();document.querySelector('.experience-switch')?.append(launcher);
  const sceneCanvas=document.querySelector<HTMLCanvasElement>('#scene')!;
  sceneCanvas.addEventListener('pointerdown',()=>{stopSequence();if(active){reveal(null);orbiting=false;refreshControls();}});
  sceneCanvas.addEventListener('wheel',stopSequence,{passive:true});
  sceneCanvas.addEventListener('pointermove',event=>{
    if(!active||step!==2||inspectorOpen||event.buttons){reveal(null);return;}
    if(performance.now()-lastPick<90)return;lastPick=performance.now();
    const id=api.pick(event.clientX,event.clientY);
    if(id)reveal(id);else deferHide();
  });
  sceneCanvas.addEventListener('pointerleave',deferHide);
  onLanguage(refresh);refresh();
  return {enter,get active(){return active;},get playing(){return orbiting&&!hovering&&!inspectorOpen;},update(_delta:number,inspector:boolean) {
    inspectorOpen=inspector;if(!active)return;if(inspector)reveal(null);
    if(sequenceTime>=0&&!document.hidden){
      sequenceTime+=_delta;
      if(sequencePhase===0&&sequenceTime>=3){go(2);sequencePhase=1;}
      if(sequencePhase===1&&sequenceTime>=7){api.frameAssembly(false);sequencePhase=2;}
      if(sequencePhase===2&&sequenceTime>=10){api.frameAssembly(true);sequencePhase=3;}
      if(sequencePhase===3&&sequenceTime>=14){api.run(true);sequencePhase=4;}
      if(sequencePhase===4&&sequenceTime>=20){stopSequence();reveal(null);api.blade();}
    }
    const status=JSON.stringify(api.status());if(status!==lastStatus){lastStatus=status;refreshControls();}
    energyTick+=_delta;if(energyTick>.15){energyTick=0;refreshEnergy();}
    const offsets:Record<string,[number,number]>={'compressor-1':[-40,-65],combustor:[-30,65],'turbine-1':[15,-80],exhaust:[40,38]};
    for(const item of hotspots){const p=api.project(item.id),offset=offsets[item.id],available=step===2&&p.visible&&!inspector,visible=available&&hoveredPart===item.id;item.button.hidden=!available;item.button.classList.toggle('is-revealed',visible);item.button.style.left=`${p.x+offset[0]}px`;item.button.style.top=`${p.y+offset[1]}px`;item.line.style.display=visible?'':'none';item.line.setAttribute('x1',String(p.x));item.line.setAttribute('y1',String(p.y));item.line.setAttribute('x2',String(p.x+offset[0]));item.line.setAttribute('y2',String(p.y+offset[1]));}
  }};
}
