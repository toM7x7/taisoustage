import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'
import {xriftDev} from '@xrift/sdk/vite'

// Shared modules always come from the host. In item mode nothing is bundled for them
// (import:false), so a host version change can never fall back to an undelivered chunk.
const shared=['react','react-dom','react/jsx-runtime','three','@react-three/fiber','@react-three/drei','@react-three/rapier','@xrift/world-components']

export default defineConfig(({mode})=>({
 base:'./',
 plugins:[
  react(),
  xriftDev({configPath:'dev-world.xrift.json'}),
  federation({name:'xrift_motion_stage',filename:'remoteEntry.js',exposes:{'./Item':'./src/index.tsx'},shared:Object.fromEntries(shared.map(name=>[name,{requiredVersion:'*',...(mode==='item'?{import:false,generate:false}:{})}]))}),
 ],
 resolve:{dedupe:['react','react-dom','three','@react-three/fiber','@react-three/drei','@react-three/rapier','@xrift/world-components']},
 build:{target:'esnext',minify:false,assetsDir:'',...(mode==='item'?{rollupOptions:{input:'./src/item-entry.ts'}}:{})},
 define:{global:'globalThis'},
 // dev only: the lab page can read local stand-in avatars (?vrm=<path>) from the pose lab's private folder
 server:{fs:{allow:['.','../../lab/xrift-avatar-pose-control/vrm']}},
}))
