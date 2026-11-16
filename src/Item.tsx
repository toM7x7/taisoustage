import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { usePlacementState, useUsers } from '@xrift/world-components'
import { AdditiveBlending, Color, ConeGeometry, DoubleSide, Group, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import { createStageBridge, type StageBridge, type VrPose } from './pose-bridge.ts'
import { BEAT_S, LOOP_S, segmentAt } from './motion/timeline.ts'

// A round stage. Whoever stands on it is made to do a warm-up routine; stepping off ends it at once.
// The stage decides only from where people stand (useUsers) and a shared clock, so every client poses
// everyone on its own and no message is sent.

export interface ItemProps { position?: [number, number, number]; rotation?: [number, number, number]; scale?: number }

/** the area: a disc of this radius around the item's origin (item units), from a little below the floor to above head height */
export const AREA_R = 1.7
const AREA_BELOW = 0.5, AREA_ABOVE = 2.6
/** once inside, a person has to be this much farther out to count as outside (no flicker on the edge) */
const EDGE_SLACK = 0.06
/**
 * People in VR: the whole body follows the routine, hands included (the head keeps the headset's rotation; the view
 * itself cannot be moved). pose-bridge.ts says what each mode does; the dev page can pick one with ?vrpose=skip|body|full.
 */
const VR_POSE_SHIPPED: VrPose = 'full'
const VR_POSE: VrPose = import.meta.env.DEV ? ((new URLSearchParams(location.search).get('vrpose') as VrPose | null) ?? VR_POSE_SHIPPED) : VR_POSE_SHIPPED

function createClock() {
  let frozen: number | null = null
  return {
    /** seconds for fades */
    now: () => frozen ?? performance.now() / 1000,
    /** the routine's clock: the wall clock, so every client is at the same beat without talking to the others */
    song: () => frozen ?? Date.now() / 1000,
    freeze(t = 0) { frozen = t }, advance(dt: number) { if (frozen != null) frozen += dt }, run() { frozen = null },
  }
}
/** dev: frozen and stepped by captures; production never touches it */
export const itemClock = createClock()

const COOL = new Color('#38d6ff'), WARM = new Color('#ff7a3c')
const LAMPS = [-1.02, -0.34, 0.34, 1.02].map((x, i) => ({ x, color: ['#ff5d8f', '#ffd166', '#5de0ff', '#b48cff'][i], from: new Vector3(x, 2.4, -0.94), to: new Vector3(x * 0.55, 0, 0.15) }))
const DOWN = new Vector3(0, -1, 0)

export function Item({ position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 }: ItemProps) {
  const users = useUsers()
  const preview = usePlacementState().mode === 'preview'
  const scene = useThree(s => s.scene)
  const root = useRef<Group>(null)
  const bridgeRef = useRef<StageBridge | null>(null)
  const insideNow = useRef(new Set<string>())
  const glow = useRef(0)

  const look = useMemo(() => {
    const cones = LAMPS.map(l => {
      const length = l.from.distanceTo(l.to), geometry = new ConeGeometry(0.62, length, 28, 1, true)
      geometry.translate(0, -length / 2, 0)
      const material = new MeshBasicMaterial({ color: l.color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })
      return { geometry, material, quaternion: new Quaternion().setFromUnitVectors(DOWN, l.to.clone().sub(l.from).normalize()) }
    })
    return {
      deck: new MeshStandardMaterial({ color: '#1d222c', roughness: 0.55, metalness: 0.1 }),
      inlay: new MeshStandardMaterial({ color: '#0d1016', emissive: COOL, emissiveIntensity: 0.25, roughness: 0.6 }),
      ring: new MeshStandardMaterial({ color: '#0d1016', emissive: COOL.clone(), emissiveIntensity: 0.8, roughness: 0.4 }),
      truss: new MeshStandardMaterial({ color: '#8d96a6', roughness: 0.35, metalness: 0.85 }),
      can: new MeshStandardMaterial({ color: '#15181f', roughness: 0.5, metalness: 0.4 }),
      box: new MeshStandardMaterial({ color: '#14161b', roughness: 0.8 }),
      lens: LAMPS.map(l => new MeshStandardMaterial({ color: '#111', emissive: l.color, emissiveIntensity: 0.4 })),
      cones,
    }
  }, [])
  useEffect(() => () => {
    for (const m of [look.deck, look.inlay, look.ring, look.truss, look.can, look.box, ...look.lens]) m.dispose()
    for (const c of look.cones) { c.geometry.dispose(); c.material.dispose() }
  }, [look])

  useEffect(() => {
    if (preview) return
    const bridge = createStageBridge(scene, itemClock.now, { vr: VR_POSE })
    bridgeRef.current = bridge
    return () => { bridge.dispose(); bridgeRef.current = null }
  }, [scene, preview])

  const tmp = useMemo(() => ({ feet: new Vector3(), local: new Vector3(), dir: new Vector3() }), [])
  useFrame((_, delta) => {
    const g = root.current, bridge = bridgeRef.current
    if (!g) return
    const seconds = itemClock.song()
    let count = 0
    if (bridge) {
      g.updateWorldMatrix(true, false)
      // the posed body faces the stage front (the item's +Z)
      g.getWorldDirection(tmp.dir)
      const heading = Math.atan2(tmp.dir.x, tmp.dir.z)
      const seen = insideNow.current
      const visit = (userId: string, isLocal: boolean, mv: { position: { x: number; y: number; z: number }; isInVR?: boolean } | null | undefined, inVR: boolean) => {
        if (!mv) { seen.delete(userId); return }
        tmp.feet.set(mv.position.x, mv.position.y, mv.position.z)
        g.worldToLocal(tmp.local.copy(tmp.feet))
        const reach = AREA_R + (seen.has(userId) ? EDGE_SLACK : 0)
        const inside = Math.hypot(tmp.local.x, tmp.local.z) < reach && tmp.local.y > -AREA_BELOW && tmp.local.y < AREA_ABOVE
        if (inside) { seen.add(userId); count++ } else seen.delete(userId)
        bridge.update({ userId, isLocal, isInVR: inVR, feet: tmp.feet }, inside, heading, seconds)
      }
      const localId = users.localUser?.id ?? 'local'
      const mine = users.getLocalMovement?.()
      visit(localId, true, mine, !!mine?.isInVR)
      for (const u of users.remoteUsers ?? []) { const mv = users.getMovement?.(u.id); visit(u.id, false, mv, !!mv?.isInVR) }
    }
    // the stage wakes up while someone is on it and pulses on the beat
    glow.current += ((count > 0 ? 1 : 0) - glow.current) * Math.min(1, delta * 5)
    const a = glow.current, beat = seconds / BEAT_S, pulse = Math.exp(-(beat - Math.floor(beat)) * 3.2)
    look.ring.emissive.copy(COOL).lerp(WARM, a)
    look.ring.emissiveIntensity = 0.8 + a * (0.9 + 1.6 * pulse)
    look.inlay.emissiveIntensity = 0.25 + a * 0.5 * pulse
    look.lens.forEach((m, i) => { m.emissiveIntensity = 0.4 + a * (1.6 + 2.2 * (Math.floor(beat) % 4 === i ? pulse : 0.15)) })
    look.cones.forEach((c, i) => { c.material.opacity = a * (0.05 + 0.09 * (Math.floor(beat) % 4 === i ? pulse : 0.2)) })
  })

  // dev: captures read what the stage is doing
  useEffect(() => {
    const g = root.current
    if (!g || !import.meta.env.DEV) return
    g.userData.motionStageDev = {
      report: () => ({ inside: [...insideNow.current], bridge: bridgeRef.current?.debug() ?? null, seconds: itemClock.song(), segment: segmentAt(itemClock.song()), loop: LOOP_S, glow: glow.current }),
      holdKey: (name: string | null) => bridgeRef.current?.holdKey(name),
    }
    return () => { delete g.userData.motionStageDev }
  }, [])

  return <group ref={root} position={position} rotation={rotation} scale={scale}>
    {/* deck: thin enough to walk onto, no collider */}
    <mesh position={[0, 0.02, 0]} material={look.deck} receiveShadow><cylinderGeometry args={[AREA_R, AREA_R + 0.04, 0.04, 72]} /></mesh>
    <mesh position={[0, 0.043, 0]} rotation={[-Math.PI / 2, 0, 0]} material={look.inlay}><ringGeometry args={[1.08, 1.11, 72]} /></mesh>
    <mesh position={[0, 0.043, 0]} rotation={[-Math.PI / 2, 0, 0]} material={look.inlay}><ringGeometry args={[0.48, 0.5, 48]} /></mesh>
    {/* front mark: the way everyone is turned */}
    <mesh position={[0, 0.043, 1.38]} rotation={[-Math.PI / 2, 0, 0]} material={look.inlay}><circleGeometry args={[0.1, 3, Math.PI / 2]} /></mesh>
    <mesh position={[0, 0.045, 0]} rotation={[Math.PI / 2, 0, 0]} material={look.ring}><torusGeometry args={[AREA_R, 0.022, 8, 96]} /></mesh>
    {/* truss behind the performers */}
    {[-1.36, 1.36].map(x => <mesh key={x} position={[x, 1.27, -0.98]} material={look.truss} castShadow><boxGeometry args={[0.07, 2.5, 0.07]} /></mesh>)}
    <mesh position={[0, 2.52, -0.98]} material={look.truss} castShadow><boxGeometry args={[2.86, 0.07, 0.07]} /></mesh>
    <mesh position={[0, 2.3, -0.98]} material={look.truss}><boxGeometry args={[2.72, 0.035, 0.035]} /></mesh>
    {[-1.02, -0.34, 0.34, 1.02].flatMap(x => [-0.17, 0.17].map(d => <mesh key={x + d} position={[x + d, 2.41, -0.98]} rotation={[0, 0, d > 0 ? 0.62 : -0.62]} material={look.truss}><boxGeometry args={[0.022, 0.27, 0.022]} /></mesh>))}
    {LAMPS.map((l, i) => <group key={i} position={l.from} quaternion={look.cones[i].quaternion}>
      <mesh position={[0, 0.06, 0]} material={look.can} castShadow><cylinderGeometry args={[0.07, 0.095, 0.2, 20]} /></mesh>
      <mesh position={[0, -0.045, 0]} rotation={[Math.PI / 2, 0, 0]} material={look.lens[i]}><circleGeometry args={[0.088, 20]} /></mesh>
      <mesh geometry={look.cones[i].geometry} material={look.cones[i].material} renderOrder={5} />
    </group>)}
    {/* speakers */}
    {[-1.08, 1.08].map(x => <group key={x} position={[x, 0, -1.2]} rotation={[0, x > 0 ? -0.35 : 0.35, 0]}>
      <mesh position={[0, 0.3, 0]} material={look.box} castShadow><boxGeometry args={[0.34, 0.52, 0.28]} /></mesh>
      <mesh position={[0, 0.22, 0.142]} material={look.can}><circleGeometry args={[0.11, 24]} /></mesh>
      <mesh position={[0, 0.43, 0.142]} material={look.can}><circleGeometry args={[0.05, 20]} /></mesh>
    </group>)}
  </group>
}
