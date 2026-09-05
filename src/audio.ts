type AudioNodes = {
  input: GainNode;
  master: GainNode;
  analyser: AnalyserNode;
  rotorSub: OscillatorNode;
  rotorSubGain: GainNode;
  rotorLow: OscillatorNode;
  rotorLowGain: GainNode;
  rotorWhine: OscillatorNode;
  rotorWhineGain: GainNode;
  bladePass: OscillatorNode;
  bladePassGain: GainNode;
  bladeFlutter: OscillatorNode;
  airSource: AudioBufferSourceNode;
  airFilter: BiquadFilterNode;
  airGain: GainNode;
  combustionSource: AudioBufferSourceNode;
  combustionFilter: BiquadFilterNode;
  combustionGain: GainNode;
  exhaustSource: AudioBufferSourceNode;
  exhaustFilter: BiquadFilterNode;
  exhaustGain: GainNode;
};

export class TurbineAudio {
  private context: AudioContext | null = null;
  private nodes: AudioNodes | null = null;
  private enabled = false;
  private hidden = false;
  private volume = .25;
  private mutedByUser = false;
  private enabling: Promise<void> | null = null;
  private samples = new Float32Array(256);
  private lastServoTick = 0;
  private lastContinuousUpdate = -Infinity;
  private previewUntil = 0;

  async toggle() {
    if (!this.context) this.initialize();
    if (!this.context || !this.nodes) throw new Error('此浏览器不支持音频');
    if (this.context.state === 'suspended') await this.context.resume();
    this.enabled = !this.enabled;
    this.mutedByUser = !this.enabled;
    const now = this.context.currentTime;
    this.nodes.master.gain.cancelScheduledValues(now);
    this.nodes.master.gain.setTargetAtTime(this.enabled && !this.hidden ? this.volume : 0, now, this.enabled ? .11 : .035);
    if (this.enabled) this.confirmationSequence();
    return this.enabled;
  }

  setVolume(percent: number) {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    this.suspend(this.hidden);
  }

  async preview() {
    if (!this.enabled) await this.toggle();
    else if (this.context?.state === 'suspended') await this.context.resume();
    if (this.context) this.previewUntil = this.context.currentTime + 5;
  }

  async enable() {
    if(this.mutedByUser)return;
    if(this.enabling)return this.enabling;
    this.enabling=(async()=>{
      if(!this.context)this.initialize();
      if(!this.context||!this.nodes)throw new Error('此浏览器不支持音频');
      if(this.context.state==='suspended')await this.context.resume();
      if(this.mutedByUser)return;
      this.enabled=true;
      this.nodes.master.gain.setTargetAtTime(this.hidden?0:this.volume,this.context.currentTime,.035);
    })();
    try{await this.enabling;}finally{this.enabling=null;}
  }

  async testSpeakers() {
    if (!this.enabled) await this.toggle();
    else if (this.context?.state === 'suspended') await this.context.resume();
    if (!this.context || !this.nodes) return;
    const now = this.context.currentTime + .1;
    [440, 660].forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      const gain = this.context!.createGain();
      const at = now + index * .38;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(.18, at + .025);
      gain.gain.setValueAtTime(.18, at + .22);
      gain.gain.linearRampToValueAtTime(0, at + .3);
      oscillator.connect(gain).connect(this.nodes!.input);
      oscillator.start(at);
      oscillator.stop(at + .32);
    });
  }

  stopPreview() {
    this.previewUntil = 0;
  }

  status() {
    let rms = 0;
    if (this.nodes) {
      this.nodes.analyser.getFloatTimeDomainData(this.samples);
      rms = Math.sqrt(this.samples.reduce((sum, sample) => sum + sample * sample, 0) / this.samples.length);
    }
    return { enabled: this.enabled, state: this.context?.state ?? 'uninitialized', hidden: this.hidden, rms,
      preview: Boolean(this.context && this.context.currentTime < this.previewUntil) };
  }

  update(speedPercent: number, operating: boolean, loadPercent = 100) {
    if (!this.context || !this.nodes) return;
    const now = this.context.currentTime;
    if (now - this.lastContinuousUpdate < .045) return;
    this.lastContinuousUpdate = now;
    if (now < this.previewUntil) { operating = true; loadPercent = 85; }
    // Display RPM is deliberately slowed. Operational sound follows load, not this visual scale.
    const speed = Math.max(0, Math.min(1, operating ? .65 + .35 * loadPercent / 100 : speedPercent / 100));
    const motion = speed * speed * (3 - 2 * speed);
    const load = Math.max(0, Math.min(1, loadPercent / 100));
    // Broad, slowly varying layers carry the sound. A loud single sine tone
    // reads as a small electric motor, regardless of the displayed machine.
    const breath = 1 + .035 * Math.sin(now * .71) + .025 * Math.sin(now * 1.13 + 2.1);
    const firing = operating ? .68 + load * .32 : 0;

    this.nodes.rotorSub.frequency.setTargetAtTime(29 + motion * 14, now, .6);
    this.nodes.rotorSubGain.gain.setTargetAtTime(motion * .024, now, .8);
    this.nodes.rotorLow.frequency.setTargetAtTime(48 + motion * 28, now, .6);
    this.nodes.rotorLowGain.gain.setTargetAtTime(motion * .0032, now, .7);
    this.nodes.rotorWhine.frequency.setTargetAtTime(240 + motion * 540, now, .8);
    this.nodes.rotorWhineGain.gain.setTargetAtTime(motion * .00065, now, .9);
    this.nodes.bladePass.frequency.setTargetAtTime(92 + motion * 690, now, .1);
    this.nodes.bladePassGain.gain.setTargetAtTime(motion * .00055, now, .7);
    this.nodes.bladeFlutter.frequency.setTargetAtTime(.38, now, .8);

    this.nodes.airSource.playbackRate.setTargetAtTime(.8 + motion * .2, now, .8);
    this.nodes.airFilter.frequency.setTargetAtTime(450 + motion * 900, now, .8);
    this.nodes.airGain.gain.setTargetAtTime(motion * .052 * breath, now, .6);
    this.nodes.combustionFilter.frequency.setTargetAtTime(240 + load * 180, now, 1.1);
    this.nodes.combustionGain.gain.setTargetAtTime(firing * .19 * breath, now, .9);
    this.nodes.exhaustSource.playbackRate.setTargetAtTime(.88 + motion * .12, now, .9);
    this.nodes.exhaustFilter.frequency.setTargetAtTime(600 + load * 550, now, .8);
    this.nodes.exhaustGain.gain.setTargetAtTime(firing * .11 / breath, now, 1.1);
  }

  uiTap(pitch = 1) {
    if (!this.enabled || !this.context || !this.nodes) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const pan = this.context.createStereoPanner();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(610 * pitch, now);
    oscillator.frequency.exponentialRampToValueAtTime(430 * pitch, now + .042);
    gain.gain.setValueAtTime(.008, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .052);
    pan.pan.value = -.08;
    oscillator.connect(gain).connect(pan).connect(this.nodes.input);
    oscillator.start(now);
    oscillator.stop(now + .06);
  }

  speedSet(percent: number) {
    if (!this.enabled || !this.context) return;
    const nowMs = performance.now();
    if (nowMs - this.lastServoTick < 58) return;
    this.lastServoTick = nowMs;
    this.uiTap(.7 + percent / 260);
  }

  spinTransition(starting: boolean) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    this.metalClunk(now, starting ? 1.06 : .78, -.22);
    if (starting) this.servoWhir(now + .07, .38, -.18);
    else this.pressureRelease(now + .04, .34, -.2, .034);
  }

  operatingTransition(enabled: boolean) {
    if (!this.enabled || !this.context || !this.nodes) return;
    const now = this.context.currentTime;
    if (!enabled) {
      this.metalClunk(now, .72, .18);
      this.pressureRelease(now + .03, .48, .32, .042);
      return;
    }
    this.pressureRelease(now, .62, -.28, .052);
    this.ignitionThump(now + .26);
    this.metalClunk(now + .48, .52, .16);
  }

  serviceTransition(stage: number) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    if (stage === 0) {
      this.servoWhir(now, .48, .12, true);
      this.metalClunk(now + .34, .92, -.08);
      this.metalClunk(now + .5, .66, .1);
      return;
    }
    this.metalClunk(now, .68, -.16);
    this.metalClunk(now + .1, .52, .12);
    this.pressureRelease(now + .12, stage === 2 ? .92 : .64, .18, .05);
    this.servoWhir(now + .28, stage === 2 ? 1.04 : .7, .08);
    this.metalClunk(now + (stage === 2 ? 1.16 : .82), .58, .2);
  }

  casingTransition(open: boolean) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    if (open) {
      this.metalClunk(now, .7, -.12);
      this.pressureRelease(now + .04, .5, .16, .044);
      this.servoWhir(now + .17, .58, .04);
    } else {
      this.servoWhir(now, .42, .04, true);
      this.metalClunk(now + .28, .94, -.06);
    }
  }

  suspend(suspended: boolean) {
    this.hidden = suspended;
    if (!this.context || !this.nodes) return;
    const now = this.context.currentTime;
    this.nodes.master.gain.setTargetAtTime(suspended || !this.enabled ? 0 : this.volume, now, .04);
  }

  private initialize() {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const input = context.createGain();
    input.gain.value = 1.8;
    const dry = context.createGain();
    const room = context.createConvolver();
    const roomGain = context.createGain();
    const limiter = context.createDynamicsCompressor();
    const master = context.createGain();
    master.gain.value = 0;
    dry.gain.value = .92;
    room.buffer = this.createRoomImpulse(context, 1.08);
    roomGain.gain.value = .028;
    limiter.threshold.value = -19;
    limiter.knee.value = 16;
    limiter.ratio.value = 3.5;
    limiter.attack.value = .003;
    limiter.release.value = .16;
    input.connect(dry).connect(limiter);
    input.connect(room).connect(roomGain).connect(limiter);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    limiter.connect(master).connect(analyser).connect(context.destination);

    const rotorPan = context.createStereoPanner();
    rotorPan.pan.value = -.12;
    rotorPan.connect(input);
    const rotorSub = context.createOscillator();
    const rotorSubFilter = context.createBiquadFilter();
    const rotorSubGain = context.createGain();
    rotorSub.type = 'sine';
    rotorSubFilter.type = 'lowpass';
    rotorSubFilter.frequency.value = 115;
    rotorSubGain.gain.value = .0022;
    rotorSub.connect(rotorSubFilter).connect(rotorSubGain).connect(rotorPan);

    const rotorLow = context.createOscillator();
    const rotorLowFilter = context.createBiquadFilter();
    const rotorLowGain = context.createGain();
    rotorLow.type = 'triangle';
    rotorLowFilter.type = 'lowpass';
    rotorLowFilter.frequency.value = 360;
    rotorLowFilter.Q.value = .65;
    rotorLowGain.gain.value = .002;
    rotorLow.connect(rotorLowFilter).connect(rotorLowGain).connect(rotorPan);

    const rotorWhine = context.createOscillator();
    const rotorWhineGain = context.createGain();
    rotorWhine.type = 'sine';
    rotorWhineGain.gain.value = 0;
    rotorWhine.connect(rotorWhineGain).connect(rotorPan);

    const bladePass = context.createOscillator();
    const bladePassFilter = context.createBiquadFilter();
    const bladePassGain = context.createGain();
    bladePass.type = 'triangle';
    bladePassFilter.type = 'bandpass';
    bladePassFilter.frequency.value = 920;
    bladePassFilter.Q.value = .45;
    bladePassGain.gain.value = 0;
    bladePass.connect(bladePassFilter).connect(bladePassGain).connect(rotorPan);
    const bladeFlutter = context.createOscillator();
    const flutterDepth = context.createGain();
    bladeFlutter.type = 'sine';
    bladeFlutter.frequency.value = 2.1;
    flutterDepth.gain.value = 0;
    bladeFlutter.connect(flutterDepth).connect(bladePassGain.gain);

    const noiseBuffer = this.createNoiseBuffer(context, 11.3);
    const airSource = context.createBufferSource();
    const airFilter = context.createBiquadFilter();
    const airGain = context.createGain();
    const airPan = context.createStereoPanner();
    airSource.buffer = noiseBuffer;
    airSource.loop = true;
    airFilter.type = 'bandpass';
    airFilter.Q.value = .35;
    airGain.gain.value = .003;
    airPan.pan.value = -.38;
    airSource.connect(airFilter).connect(airGain).connect(airPan).connect(input);

    const combustionSource = context.createBufferSource();
    const combustionFilter = context.createBiquadFilter();
    const combustionGain = context.createGain();
    const combustionPan = context.createStereoPanner();
    combustionSource.buffer = this.createNoiseBuffer(context, 13.7, 0x72a5);
    combustionSource.loop = true;
    combustionFilter.type = 'lowpass';
    combustionFilter.frequency.value = 220;
    combustionFilter.Q.value = .6;
    combustionGain.gain.value = 0;
    combustionPan.pan.value = .08;
    combustionSource.connect(combustionFilter).connect(combustionGain).connect(combustionPan).connect(input);

    const exhaustSource = context.createBufferSource();
    const exhaustFilter = context.createBiquadFilter();
    const exhaustGain = context.createGain();
    const exhaustPan = context.createStereoPanner();
    exhaustSource.buffer = this.createNoiseBuffer(context, 17.1, 0xc832);
    exhaustSource.loop = true;
    exhaustFilter.type = 'lowpass';
    exhaustFilter.frequency.value = 180;
    exhaustFilter.Q.value = .52;
    exhaustGain.gain.value = 0;
    exhaustPan.pan.value = .36;
    exhaustSource.connect(exhaustFilter).connect(exhaustGain).connect(exhaustPan).connect(input);

    rotorSub.start();
    rotorLow.start();
    rotorWhine.start();
    bladePass.start();
    bladeFlutter.start();
    airSource.start(0, .37);
    combustionSource.start(0, 1.13);
    exhaustSource.start(0, 1.78);
    this.context = context;
    this.nodes = {
      input,
      master,
      analyser,
      rotorSub,
      rotorSubGain,
      rotorLow,
      rotorLowGain,
      rotorWhine,
      rotorWhineGain,
      bladePass,
      bladePassGain,
      bladeFlutter,
      airSource,
      airFilter,
      airGain,
      combustionSource,
      combustionFilter,
      combustionGain,
      exhaustSource,
      exhaustFilter,
      exhaustGain,
    };
  }

  private createNoiseBuffer(context: AudioContext, duration: number, seed = 0x9a02) {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = seed / 0xffffffff * 2 - 1;
      previous = previous * .69 + white * .31;
      data[i] = previous;
    }
    return buffer;
  }

  private createRoomImpulse(context: AudioContext, duration: number) {
    const length = Math.ceil(context.sampleRate * duration);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    let seed = 0x57144;
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const noise = seed / 0xffffffff * 2 - 1;
        const time = i / context.sampleRate;
        const reflectionPeriod = Math.round(context.sampleRate * .037);
        const earlyReflection = i % reflectionPeriod < 2 ? .18 : 0;
        data[i] = noise * Math.exp(-time * 4.9) * .34 + earlyReflection * Math.exp(-time * 3.4);
      }
    }
    return impulse;
  }

  private confirmationSequence() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.uiTap(.88);
    this.uiTapAt(now + .075, 1.12, .009);
    this.metalClunk(now + .13, .42, -.05);
  }

  private uiTapAt(at: number, pitch: number, level: number) {
    if (!this.context || !this.nodes) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(590 * pitch, at);
    oscillator.frequency.exponentialRampToValueAtTime(460 * pitch, at + .045);
    gain.gain.setValueAtTime(level * .62, at);
    gain.gain.exponentialRampToValueAtTime(.0001, at + .058);
    oscillator.connect(gain).connect(this.nodes.input);
    oscillator.start(at);
    oscillator.stop(at + .065);
  }

  private metalClunk(at: number, pitch: number, panValue: number) {
    if (!this.context || !this.nodes) return;
    const pan = this.context.createStereoPanner();
    pan.pan.value = panValue;
    pan.connect(this.nodes.input);
    const body = this.context.createOscillator();
    const bodyFilter = this.context.createBiquadFilter();
    const bodyGain = this.context.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(142 * pitch, at);
    body.frequency.exponentialRampToValueAtTime(48 * pitch, at + .14);
    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.value = 760;
    bodyGain.gain.setValueAtTime(.042, at);
    bodyGain.gain.exponentialRampToValueAtTime(.0001, at + .18);
    body.connect(bodyFilter).connect(bodyGain).connect(pan);
    body.start(at);
    body.stop(at + .2);
    [720, 1080, 1560].forEach((frequency, index) => {
      const ring = this.context!.createOscillator();
      const gain = this.context!.createGain();
      ring.type = 'sine';
      ring.frequency.value = frequency * pitch;
      gain.gain.setValueAtTime(.004 / (index + 1), at + .006);
      gain.gain.exponentialRampToValueAtTime(.0001, at + .18 + index * .06);
      ring.connect(gain).connect(pan);
      ring.start(at + .006);
      ring.stop(at + .28 + index * .06);
    });
  }

  private ignitionThump(at: number) {
    if (!this.context || !this.nodes) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const pan = this.context.createStereoPanner();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(54, at);
    oscillator.frequency.exponentialRampToValueAtTime(25, at + .5);
    gain.gain.setValueAtTime(.038, at);
    gain.gain.exponentialRampToValueAtTime(.0001, at + .54);
    pan.pan.value = .06;
    oscillator.connect(gain).connect(pan).connect(this.nodes.input);
    oscillator.start(at);
    oscillator.stop(at + .56);
  }

  private pressureRelease(at: number, duration: number, panValue: number, level: number) {
    if (!this.context || !this.nodes) return;
    const source = this.context.createBufferSource();
    const highpass = this.context.createBiquadFilter();
    const bandpass = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const pan = this.context.createStereoPanner();
    source.buffer = this.nodes.airSource.buffer;
    source.playbackRate.value = 1.18;
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(180, at);
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(1500, at);
    bandpass.frequency.exponentialRampToValueAtTime(420, at + duration);
    bandpass.Q.value = .38;
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(level * .45, at + .04);
    gain.gain.setTargetAtTime(level * .24, at + .08, duration * .28);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    pan.pan.value = panValue;
    source.connect(highpass).connect(bandpass).connect(gain).connect(pan).connect(this.nodes.input);
    source.start(at);
    source.stop(at + duration + .03);
  }

  private servoWhir(at: number, duration: number, panValue: number, reverse = false) {
    if (!this.context || !this.nodes) return;
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const pan = this.context.createStereoPanner();
    const startFrequency = reverse ? 128 : 68;
    const endFrequency = reverse ? 62 : 142;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(startFrequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration * .72);
    oscillator.frequency.exponentialRampToValueAtTime(54, at + duration);
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    filter.Q.value = .55;
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(.018, at + .06);
    gain.gain.setTargetAtTime(.011, at + .1, .18);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    pan.pan.value = panValue;
    oscillator.connect(filter).connect(gain).connect(pan).connect(this.nodes.input);
    oscillator.start(at);
    oscillator.stop(at + duration + .03);
  }
}
