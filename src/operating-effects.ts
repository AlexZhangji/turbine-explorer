import * as THREE from 'three';

// Explanatory light trails, not CFD or a reconstruction of GE flame geometry.
export function createOperatingEffects(combustors:THREE.Group[]) {
  const group=new THREE.Group();group.name='operating-flow-illustration';group.visible=false;
  const uniforms={time:{value:0},strength:{value:0}};
  const materials:THREE.ShaderMaterial[]=[];
  function material(hot:boolean, flame=false) {
    const mat=new THREE.ShaderMaterial({
      uniforms:{...uniforms,hot:{value:hot?1:0},flame:{value:flame?1:0}},
      transparent:true,depthWrite:false,depthTest:!flame,blending:THREE.AdditiveBlending,
      side:THREE.DoubleSide,toneMapped:false,
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`uniform float time,strength,hot,flame;varying vec2 vUv;
        void main(){
          float s=mix(vUv.x,vUv.y,flame);
          float pulse=pow(max(0.0,sin(s*28.0-time*12.0)),5.0);
          float edge=smoothstep(0.0,.08,s)*(1.0-smoothstep(.85,1.0,s));
          vec3 cold=mix(vec3(.06,.45,.9),vec3(.25,.95,1.0),pulse);
          vec3 warm=mix(vec3(1.0,.13,.015),vec3(1.0,.76,.21),pulse);
          vec3 color=mix(cold,warm,hot);
          float alpha=edge*(.12+.74*pulse)*strength;
          if(flame>.5){
            float flicker=.6+.2*sin(vUv.x*12.566+sin(s*8.0-time*3.0))+.16*sin(time*5.0+s*6.0);
            color=mix(vec3(1.0,.27,.025),vec3(.08,.38,1.0),smoothstep(.58,.96,s));
            alpha=edge*flicker*strength*.62;
          }
          gl_FragColor=vec4(color,alpha*mix(.8,.58,flame));
        }`,
    });materials.push(mat);return mat;
  }
  const cold=material(false),hot=material(true);
  for(let lane=0;lane<9;lane++){
    const angle=-.35+lane*.36;
    for(const thermal of [false,true]){
      const points:THREE.Vector3[]=[];
      for(let j=0;j<=40;j++){
        const u=j/40,x=thermal?2.75+u*5.5:-7.4+u*8.2;
        const r=thermal?1.95+u*.3:2.13-.40*u;
        const a=angle+.08*Math.sin(u*5);
        points.push(new THREE.Vector3(x,Math.sin(a)*r,Math.cos(a)*r));
      }
      const geometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),90,.022,5,false);
      group.add(new THREE.Mesh(geometry,thermal?hot:cold));
    }
  }
  const flames:THREE.Group[]=[];
  const flameMat=material(true,true);
  for(const module of combustors){
    const can=module.getObjectByName('combustor-can-and-end-cover')!;
    const flame=new THREE.Group();flame.name='combustor-heat-illustration';flame.visible=false;
    // Overlay inside the can to reveal the combustion zone through its surface.
    const plume=new THREE.Mesh(new THREE.CylinderGeometry(.10,.32,1.05,20,12,true),flameMat);
    plume.position.y=.15;flame.add(plume);can.add(flame);flames.push(flame);
  }
  return {group,update(time:number,enabled:boolean,delta:number){
    uniforms.time.value=time;
    uniforms.strength.value=THREE.MathUtils.damp(uniforms.strength.value,enabled?1:0,enabled?2.4:5,delta);
    const visible=uniforms.strength.value>.005;group.visible=visible;
    flames.forEach(flame=>flame.visible=visible);
  }};
}
