/// <reference types="vite/client" />
// Development page (not part of the item build: the item entry is src/item-entry.ts).
//   /?lab   lab harness: stand-in people (a rigged wooden mannequin, dev-assets/mannequin.glb, not shipped) that
//           can be walked on and off the stage, so the real pose bridge finds and poses them. scripts/capture.mjs uses it.
//           ?vrm=<path on disk> / ?vrm2=<path> put a local VRM in my place / in Aさん's.
//   /       official DevEnvironment with the stage in front of the spawn: walk onto it.
//   ?cam=x,y,z,tx,ty,tz   fixed camera
import { StrictMode, Suspense, useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, Physics, RigidBody } from '@react-three/rapier'
import { DevEnvironment, Item as SDKItem, ItemProvider, XRiftProvider, type PlayerMovement, type UsersContextValue } from '@xrift/world-components'
import { Vector3 } from 'three'
import { Item, itemClock } from './Item'
import { DevVrmAvatar } from './dev/vrm-avatar'
import mannequinUrl from '../dev-assets/mannequin.glb?url'
import { CameraPin, Scenery, parseCam } from './dev/scenery'
import './style.css'

const params = new URLSearchParams(location.search)
const LAB = params.has('lab'), CAM = parseCam(params.get('cam'))
const VRM = params.get('vrm') ?? mannequinUrl, VRM2 = params.get('vrm2') ?? mannequinUrl
const PLACEMENT = 'motion-stage-one', SDK_ITEM_ID = '00000000-0000-4000-8000-0000000000f6'
const STAGE_POS: [number, number, number] = [0, 0, 0], STAGE_YAW = 0

interface LabUser { id: string; displayName: string; position: { x: number; y: number; z: number }; yaw: number; eye: number; vr?: boolean; goal?: { x: number; z: number } }
const lab = {
  local: { id: 'local-dev', displayName: 'わたし', position: { x: 0.2, y: 0, z: 3.2 }, yaw: 0, eye: 1.5 } as LabUser,
  remotes: [
    { id: 'remote-a', displayName: 'Aさん', position: { x: -2.9, y: 0, z: 0.8 }, yaw: -1.4, eye: 1.5 },
    { id: 'remote-b', displayName: 'Bさん', position: { x: 2.9, y: 0, z: 1.2 }, yaw: 1.2, eye: 1.5 },
  ] as LabUser[],
}
const everyone = () => [lab.local, ...lab.remotes]
const who = (id?: string) => everyone().find(u => u.id === id) ?? lab.local
const toMovement = (u: LabUser): PlayerMovement => ({ position: { ...u.position }, direction: { x: 0, z: 0 }, horizontalSpeed: 0, verticalSpeed: 0, rotation: { yaw: u.yaw, pitch: 0 }, isGrounded: true, isJumping: false, isInVR: !!u.vr } as PlayerMovement)

/** People walk toward their goal at walking pace and face where they walk. */
function Walkers() {
  useFrame((_, dt) => {
    for (const u of everyone()) {
      if (!u.goal) continue
      const dx = u.goal.x - u.position.x, dz = u.goal.z - u.position.z, d = Math.hypot(dx, dz), step = 1.6 * Math.min(dt, 0.05)
      if (d <= step) { u.position.x = u.goal.x; u.position.z = u.goal.z; u.goal = undefined; continue }
      u.position.x += dx / d * step; u.position.z += dz / d * step
      // XRift yaw 0 looks at -Z
      u.yaw = Math.atan2(-dx, -dz)
    }
  })
  return null
}

type Pin = { position: Vector3; target: Vector3; active: boolean }
function Readback({ pin }: { pin: Pin }) {
  const { scene, camera, gl } = useThree()
  useEffect(() => {
    const find = () => { let f: any = null; scene.traverse(o => { if (!f && o.userData.motionStageDev) f = o.userData.motionStageDev }); return f }
    ;(window as any).__ms = {
      find, report: () => find()?.report() ?? null, holdKey: (name: string | null) => find()?.holdKey(name),
      freeze: (t?: number) => itemClock.freeze(t), advance: (dt: number) => itemClock.advance(dt), run: () => itemClock.run(),
      lab,
      /** put a person somewhere at once */
      place(x: number, z: number, id?: string, yaw?: number) { const u = who(id); u.position = { x, y: 0, z }; u.goal = undefined; if (yaw != null) u.yaw = yaw },
      /** let a person walk there */
      walk(x: number, z: number, id?: string) { who(id).goal = { x, z } },
      vr(on: boolean, id?: string) { who(id).vr = on },
      view(position: number[], target: number[]) { pin.position.fromArray(position); pin.target.fromArray(target); pin.active = true },
      /** world positions of a person's bones (captures measure the pose from these) */
      bones(id: string, names: string[]) {
        let rootObj: any = null; scene.traverse(o => { if (o.name === 'dev-vrm-' + id) rootObj = o })
        if (!rootObj) return null
        const out: Record<string, number[]> = {}
        rootObj.traverse((o: any) => { if (o.isBone) for (const n of names) if (!out[n] && new RegExp(n + '$', 'i').test(o.name)) out[n] = o.getWorldPosition(new Vector3()).toArray() })
        return out
      },
      boneNames(id: string) { const names: string[] = []; scene.traverse(o => { if (o.name === 'dev-vrm-' + id) o.traverse((b: any) => { if (b.isBone) names.push(b.name) }) }); return names },
      scene, camera, gl,
    }
    return () => { delete (window as any).__ms }
  }, [scene, camera, gl, pin])
  return null
}

function LabApp() {
  const pin = useMemo<Pin>(() => ({ position: CAM?.position ?? new Vector3(3.4, 2.3, 5.2), target: CAM?.target ?? new Vector3(0, 1.0, 0), active: true }), [])
  const users = useMemo<UsersContextValue>(() => ({
    localUser: { id: lab.local.id, displayName: lab.local.displayName, avatarUrl: null, isGuest: false },
    remoteUsers: lab.remotes.map(r => ({ id: r.id, displayName: r.displayName, avatarUrl: null, isGuest: false })),
    getLocalMovement: () => toMovement(lab.local),
    getMovement: id => { const r = lab.remotes.find(r => r.id === id); return r ? toMovement(r) : undefined },
    getLocalAvatarHeight: () => ({ height: lab.local.eye + 0.13, eyeHeight: lab.local.eye }),
    getAvatarHeight: id => { const r = lab.remotes.find(r => r.id === id); return r ? { height: r.eye + 0.13, eyeHeight: r.eye } : undefined },
  }), [])
  const ms = () => (window as any).__ms
  return <main className="stage">
    <XRiftProvider baseUrl="/" usersImplementation={users}>
      <Canvas camera={{ position: [3.4, 2.3, 5.2], fov: 55, near: 0.05, far: 400 }} dpr={[1, 2]} gl={{ antialias: true }} shadows>
        <Scenery />
        <Walkers />
        <DevVrmAvatar person={lab.local} path={VRM} remote={false} />
        <DevVrmAvatar person={lab.remotes[0]} path={VRM2} remote />
        <DevVrmAvatar person={lab.remotes[1]} path={mannequinUrl} remote />
        <Suspense fallback={null}><Physics>
          <ItemProvider id={PLACEMENT} placedBy={null}><Item position={STAGE_POS} rotation={[0, STAGE_YAW, 0]} /></ItemProvider>
          <RigidBody type="fixed" colliders={false}><CuboidCollider args={[30, 0.1, 30]} position={[0, -0.1, 0]} /></RigidBody>
        </Physics></Suspense>
        <CameraPin pin={pin} />
        <Readback pin={pin} />
      </Canvas>
    </XRiftProvider>
    {!CAM && !params.has('clean') && <aside className="panel" onPointerDown={e => e.stopPropagation()}>
      <strong>体操ステージ・検証ラボ</strong>
      <p>円いステージに入った人は、勝手に体操を始めます。出るとすぐ元に戻ります。</p>
      <div className="row"><button onClick={() => ms().walk(0.2, 0.3)}>わたし：入る</button><button onClick={() => ms().walk(0.2, 3.2)}>わたし：出る</button></div>
      <div className="row"><button onClick={() => ms().walk(-0.9, -0.1, 'remote-a')}>Aさん：入る</button><button onClick={() => ms().walk(-2.9, 0.8, 'remote-a')}>Aさん：出る</button></div>
      <div className="row"><button onClick={() => ms().walk(1.0, 0.0, 'remote-b')}>Bさん：入る</button><button onClick={() => ms().walk(2.9, 1.2, 'remote-b')}>Bさん：出る</button></div>
      <div className="row"><button onClick={() => ms().view([3.4, 2.3, 5.2], [0, 1.0, 0])}>斜めから</button><button onClick={() => ms().view([0, 1.5, 6.2], [0, 1.0, 0])}>正面から</button><button onClick={() => ms().view([6, 1.4, 0], [0, 1.0, 0])}>横から</button></div>
    </aside>}
  </main>
}

function SdkApp() {
  const pin = useMemo<Pin>(() => ({ position: CAM?.position ?? new Vector3(), target: CAM?.target ?? new Vector3(), active: !!CAM }), [])
  return <main className="stage">
    <XRiftProvider baseUrl="/">
      <DevEnvironment items={{ [SDK_ITEM_ID]: Item }} spawnPosition={[0, 0, 4]} camera={{ fov: 60 }} shadows={false}>
        <Scenery floor={false} />
        <RigidBody type="fixed" colliders={false}>
          <mesh position={[0, -0.1, 0]}><boxGeometry args={[60, 0.2, 60]} /><meshStandardMaterial color="#2a3240" roughness={0.85} /></mesh>
          <CuboidCollider args={[30, 0.1, 30]} position={[0, -0.1, 0]} />
        </RigidBody>
        <gridHelper args={[60, 60, '#3b4a63', '#323d50']} position={[0, 0.002, 0]} />
        <SDKItem placementId={PLACEMENT} itemId={SDK_ITEM_ID} position={[0, 0, 0]} rotation={[0, 0, 0]} />
        {CAM && <CameraPin pin={pin} />}
      </DevEnvironment>
    </XRiftProvider>
    {!CAM && <div className="hint">公式の開発環境（アバターの体は出ません）。ポーズの確認は <a href="?lab">?lab</a> で</div>}
  </main>
}

// StrictMode on purpose: every disposable resource of the item is created in an effect.
createRoot(document.getElementById('root')!).render(<StrictMode>{LAB ? <LabApp /> : <SdkApp />}</StrictMode>)
