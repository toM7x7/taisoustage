import { Vector3, type Object3D, type Scene, type Skeleton } from 'three'
import { captureBones, prepareRig, restoreBones, type PreparedRig } from './pose-lib/vendor/render-pose.mjs'
import { selectActorRig, type ActorRigSelection } from './pose-lib/adapters/xrift.mjs'
import { authoringRig } from './pose-lib/authoring/rig.mjs'
import { applyAuthoredPose } from './pose-lib/authoring/solve.mjs'
import { sampleKeyPose, sampleRoutine } from './motion/taiso.ts'

// Everyone standing in the area is posed, whether they want to or not. For each such person whose avatar
// skeleton can be read, the routine is solved at render time (scene.onBeforeRender) on top of the host's pose
// and the host's pose is put back after the outermost render, like the pose lab's attachPoseDriver. Nothing is
// written that the host keeps: the moment a person leaves, the host's own animation shows again.
//
// Every client does this on its own for every person it sees (position + a shared clock), so no message is sent.
//
// Call contract (src/Item.tsx): update() every frame for every person with inside = are they in the area;
// dispose() on unmount.

export interface StageActor { userId: string; isLocal: boolean; isInVR: boolean; feet: Vector3 }
export interface StageBridge {
  /** heading: the way the posed body faces (rad, 0 = +Z). seconds: the routine's clock (shared by everyone). */
  update(actor: StageActor, inside: boolean, heading: number, seconds: number): void
  /** 0..1: how much of this person's pose is ours right now */
  weight(userId: string): number
  status(userId: string): 'posed' | 'vr' | 'searching' | 'unreadable' | 'outside'
  /** dev: hold one key still instead of running the routine (null: run) */
  holdKey(name: string | null): void
  debug(): unknown
  dispose(): void
}

/** how long the routine takes to take a body over, and to let it go ("at once", without a one-frame snap) */
export const TAKE_S = 0.45, LET_GO_S = 0.2
/** a body that came in facing another way is turned to the front over this long */
const TURN_S = 0.8
const RESCAN_S = 0.5
const realNow = () => performance.now() / 1000
const within = (o: Object3D, a: Object3D) => { for (let n: Object3D | null = o; n; n = n.parent) if (n === a) return true; return false }
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const hipL = new Vector3(), hipR = new Vector3()

type Found = { rig: PreparedRig; related: Skeleton[] }
/**
 * The avatar skeleton of this user (lab selectActorRig): a remote player inside its `remote-player-<id>` scope (host
 * convention, not an SDK promise), the local user outside every remote scope; hips near the feet. Bone names first,
 * then role inference from naming dialects and the skeleton's shape. A skeleton that cannot be read safely is left alone.
 */
function findRig(scene: Scene, actor: StageActor): { found: Found | null; selection: ActorRigSelection } {
  const selection = selectActorRig({ scene, userId: actor.userId, isLocal: actor.isLocal, feet: actor.feet })
  if (selection.status !== 'ready' || !selection.rig) return { found: null, selection }
  try { return { found: { rig: prepareRig(selection.rig), related: selection.relatedSkeletons }, selection } }
  catch (error) { return { found: null, selection: { ...selection, status: 'unsupported', rig: null, diagnosis: { reason: String(error) } } } }
}
function report(actor: StageActor, selection: ActorRigSelection) {
  const who = actor.isLocal ? 'your avatar' : `avatar of ${actor.userId}`
  if (selection.status === 'ready') {
    const how = selection.roles?.method === 'names' ? 'bone names' : `${selection.roles?.method}${selection.roles?.dialect ? ` (${selection.roles.dialect})` : ''}`
    console.info(`[motion-stage] ${who}: posed by the stage (skeleton read by ${how})`)
  } else if (selection.status === 'unsupported') console.warn(`[motion-stage] ${who}: not posed, the skeleton could not be read safely: ${selection.diagnosis?.reason}`, selection.diagnosis)
  else console.debug(`[motion-stage] ${who}: not posed yet (${selection.status})`, selection.diagnosis ?? '')
}

interface Entry {
  actor: StageActor
  inside: boolean
  found: Found | null
  selection: ActorRigSelection | null
  scannedAt: number
  note: string
  /** 0..1 linear; shown through smooth() */
  level: number
  /** 0..1: how far the body has turned from the way it came in to the front */
  turn: number
  /** the way the body faced when it came in (null until read from its hips) */
  cameFacing: number | null
  heading: number
  seconds: number
  at: number
  state: object
  snapshot: ReturnType<typeof captureBones> | null
  error: string | null
}

// One render transaction per scene for all bridges (nested renders such as mirrors keep one pose).
type Mgr = { entries: Set<{ apply(): void; restore(): void }>; dispose(): void }
const managers = new WeakMap<Scene, Mgr>()
function managerFor(scene: Scene): Mgr {
  let m = managers.get(scene)
  if (m) return m
  const entries = new Set<{ apply(): void; restore(): void }>(), before = scene.onBeforeRender, after = scene.onAfterRender
  let depth = 0
  const restore = () => [...entries].reverse().forEach(e => e.restore())
  const onBefore: typeof scene.onBeforeRender = function (this: Scene, ...args) { if (!depth) restore(); depth++; try { before.call(this, ...args); if (depth === 1) for (const e of entries) e.apply() } catch (error) { depth--; if (!depth) restore(); throw error } }
  const onAfter: typeof scene.onAfterRender = function (this: Scene, ...args) { try { after.call(this, ...args) } finally { depth = Math.max(0, depth - 1); if (!depth) restore() } }
  scene.onBeforeRender = onBefore; scene.onAfterRender = onAfter
  m = { entries, dispose() { restore(); if (scene.onBeforeRender === onBefore) scene.onBeforeRender = before; if (scene.onAfterRender === onAfter) scene.onAfterRender = after; managers.delete(scene) } }
  managers.set(scene, m); return m
}

/** now: the item's clock. poseVR: also pose people in VR (their tracked hands are then overridden while they stand in the area). */
export function createStageBridge(scene: Scene, now: () => number = realNow, options: { poseVR?: boolean } = {}): StageBridge {
  const users = new Map<string, Entry>(), mgr = managerFor(scene)
  let held: string | null = null
  const skip = (e: Entry) => e.actor.isInVR && !options.poseVR
  /** The way the host has the body facing, read from the hip joints (only valid while we are not posing it). */
  const hostFacing = (e: Entry) => {
    const b = e.found?.rig.bones
    if (!b?.leftUpperLeg || !b.rightUpperLeg) return null
    const d = b.leftUpperLeg.getWorldPosition(hipL).sub(b.rightUpperLeg.getWorldPosition(hipR))
    return d.x * d.x + d.z * d.z < 1e-8 ? null : Math.atan2(-d.z, d.x)
  }
  const solver = {
    apply() {
      for (const e of users.values()) {
        if (!e.found || skip(e)) continue
        const weight = smooth(e.level)
        if (weight <= 0) { if (e.inside || e.cameFacing == null) e.cameFacing = hostFacing(e); continue }
        if (e.cameFacing == null) e.cameFacing = hostFacing(e) ?? e.heading
        const info = authoringRig(e.found.rig)
        const frame = held ? sampleKeyPose(info, held) : sampleRoutine(info, e.seconds)
        frame.weight = weight
        e.snapshot = captureBones(e.found.rig.skeleton)
        try {
          const heading = e.cameFacing + wrap(e.heading - e.cameFacing) * smooth(e.turn)
          applyAuthoredPose(e.found.rig, frame, { heading, origin: e.actor.feet, groundY: e.actor.feet.y, state: e.state })
          for (const s of e.found.related) s.update()
          e.error = null
        } catch (error) { e.error = String(error); restoreBones(e.snapshot); e.snapshot = null; for (const s of e.found.related) s.update() }
      }
    },
    restore() { for (const e of users.values()) if (e.snapshot) { restoreBones(e.snapshot); e.snapshot = null; if (e.found) for (const s of e.found.related) s.update() } },
  }
  mgr.entries.add(solver)
  return {
    update(actor, inside, heading, seconds) {
      const t = now()
      let e = users.get(actor.userId)
      if (!e) {
        if (!inside) return
        e = { actor: { ...actor, feet: actor.feet.clone() }, inside: false, found: null, selection: null, scannedAt: -Infinity, note: '', level: 0, turn: 0, cameFacing: null, heading, seconds, at: t, state: {}, snapshot: null, error: null }
        users.set(actor.userId, e)
      }
      const dt = Math.max(0, Math.min(0.1, t - e.at)); e.at = t
      e.actor.isLocal = actor.isLocal; e.actor.isInVR = actor.isInVR; e.actor.feet.copy(actor.feet); e.heading = heading; e.seconds = seconds
      if (inside && !e.inside && e.level <= 0) { e.turn = 0; e.cameFacing = null; e.state = {} } // a fresh entry
      e.inside = inside
      e.level = Math.max(0, Math.min(1, e.level + (inside ? dt / TAKE_S : -dt / LET_GO_S)))
      if (inside && e.level > 0) e.turn = Math.min(1, e.turn + dt / TURN_S)
      if (!inside && e.level <= 0) { users.delete(actor.userId); return }
      const lost = e.found && !within(e.found.rig.bones.hips, scene)
      if ((!e.found || lost) && t - e.scannedAt > RESCAN_S && !skip(e)) {
        e.scannedAt = t
        const { found, selection } = findRig(scene, actor)
        e.found = found; e.selection = selection; e.state = {}
        const note = selection.status + ':' + (selection.roles?.method ?? selection.diagnosis?.reason ?? '')
        if (note !== e.note) { e.note = note; report(actor, selection) }
      }
    },
    weight(userId) { const e = users.get(userId); return e && e.found && !skip(e) ? smooth(e.level) : 0 },
    status(userId) {
      const e = users.get(userId)
      if (!e) return 'outside'
      if (skip(e)) return 'vr'
      if (e.found) return 'posed'
      return e.selection?.status === 'unsupported' ? 'unreadable' : 'searching'
    },
    holdKey(name) { held = name },
    debug: () => [...users.values()].map(e => ({ userId: e.actor.userId, inside: e.inside, level: e.level, weight: e.found && !skip(e) ? smooth(e.level) : 0, vr: e.actor.isInVR, turn: e.turn, cameFacing: e.cameFacing, heading: e.heading, rig: e.found ? e.found.rig.mesh.name || e.found.rig.bones.hips.name : null, status: e.selection?.status ?? null, read: e.selection?.roles?.method ?? null, reason: e.selection?.diagnosis?.reason ?? null, error: e.error })),
    dispose() { mgr.entries.delete(solver); solver.restore(); users.clear(); if (!mgr.entries.size) mgr.dispose() },
  }
}
