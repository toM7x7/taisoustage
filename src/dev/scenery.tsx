import {useEffect,useMemo} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {BackSide,Color,ShaderMaterial,SphereGeometry,Vector3} from 'three'

/** Dusk sky dome + dim lights + dark floor, so the glow reads. Development only. */
export function Scenery({floor=true,studio=false}:{floor?:boolean;studio?:boolean}){
 const {geometry,material}=useMemo(()=>({
  geometry:new SphereGeometry(180,32,16),
  material:new ShaderMaterial({
   side:BackSide,depthWrite:false,
   uniforms:studio?{uTop:{value:new Color('#1c4f86')},uHorizon:{value:new Color('#3f8fd0')},uGlow:{value:new Color('#8fd0ff')}}:{uTop:{value:new Color('#070b18')},uHorizon:{value:new Color('#26365a')},uGlow:{value:new Color('#3d5f8f')}},
   vertexShader:'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:'uniform vec3 uTop;uniform vec3 uHorizon;uniform vec3 uGlow;varying vec3 vP;void main(){float h=clamp(vP.y,0.,1.);vec3 c=mix(uHorizon,uTop,pow(h,.55));c+=uGlow*exp(-h*h*60.)*.35;gl_FragColor=vec4(c,1.);\n#include <colorspace_fragment>\n}',
  }),
 }),[studio])
 useEffect(()=>()=>{geometry.dispose();material.dispose()},[geometry,material])
 return <>
  <color attach="background" args={['#0b1222']}/>
  <mesh geometry={geometry} material={material} renderOrder={-10}/>
  <hemisphereLight args={['#b9cdf0','#2a3348',2.0]}/>
  <directionalLight position={[4,7,3]} intensity={2.2} color="#fff0dc" castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} shadow-bias={-0.0004}/>
  {floor&&<>
   <mesh rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[60,60]}/><meshStandardMaterial color={studio?'#2f6faa':'#3b4658'} roughness={.85}/></mesh>
   {!studio&&<gridHelper args={[60,60,'#3b4a63','#323d50']} position={[0,.002,0]}/>}
  </>}
 </>
}

/**
 * Fixed camera (?cam=x,y,z,tx,ty,tz, or __kiOrb.view): takes over the render each frame so a
 * player controller cannot move it (priority 1 = this callback renders).
 */
export function CameraPin({pin}:{pin:{position:Vector3;target:Vector3;active:boolean}}){
 const camera=useThree(s=>s.camera)
 useFrame(({gl,scene})=>{
  if(pin.active){camera.position.copy(pin.position);camera.lookAt(pin.target);camera.updateMatrixWorld()}
  gl.render(scene,camera)
 },1)
 return null
}

export function parseCam(value:string|null){
 const n=(value??'').split(',').map(Number)
 if(n.length!==6||n.some(x=>!Number.isFinite(x)))return null
 return {position:new Vector3(n[0],n[1],n[2]),target:new Vector3(n[3],n[4],n[5])}
}
