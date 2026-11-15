// Scenario checks + screenshots on the lab page with GPU Chrome (dev server on 5316).
// Usage: node scripts/capture.mjs [keys] [enter] [unison] [routine] [vr] [vrm=<path on disk>]
// The lab's people are rigged wooden mannequins that the real pose bridge finds and poses.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.MS_BASE ?? 'http://127.0.0.1:5316/'
const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'output', 'capture')
const exe = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
mkdirSync(OUT, { recursive: true })
const args = process.argv.slice(2), vrm = args.find(a => a.startsWith('vrm='))?.slice(4)
const wanted = args.filter(a => !a.includes('='))
const want = name => !wanted.length || wanted.includes(name)
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
const results = {}, errors = []
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail }; console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) }
const BEAT = 0.55, KEYS = ['rest', 'front', 'up', 'side', 'swingDown', 'swingOut', 'bendL', 'bendR', 'fold', 'arch']
const VIEWS = { front: [[0, 1.3, 4.6], [0, 1.0, 0]], side: [[4.6, 1.3, 0.3], [0, 1.0, 0.3]], wide: [[3.4, 2.3, 5.2], [0, 1.0, 0]] }

async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /motion-stage/.test(m.text()))) errors.push(m.text()) })
  await page.goto(BASE + '?lab&clean' + (vrm ? '&vrm=' + encodeURIComponent(vrm) : ''))
  await page.waitForFunction(() => window.__ms?.report?.(), null, { timeout: 30000 })
  await page.waitForFunction(() => { let n = 0; window.__ms.scene.traverse(o => { if (/^dev-vrm-/.test(o.name)) n++ }); return n >= 3 }, null, { timeout: 30000 })
  await page.waitForTimeout(500)
  await page.evaluate(() => window.__ms.freeze(0))
  return page
}
/** Advance the item's clock by `s` seconds, one rendered frame per 1/60 s. */
const step = (page, s) => page.evaluate(async s => {
  const n = Math.max(1, Math.round(s * 60))
  for (let i = 0; i < n; i++) { window.__ms.advance(1 / 60); await new Promise(r => requestAnimationFrame(r)) }
  await new Promise(r => requestAnimationFrame(r))
}, s)
const view = (page, name) => page.evaluate(([p, t]) => window.__ms.view(p, t), VIEWS[name])
const shot = async (page, name) => { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await page.screenshot({ path: join(OUT, name + '.png') }) }
const me = (page, id = 'local-dev') => page.evaluate(id => window.__ms.report().bridge?.find(e => e.userId === id) ?? null, id)
/**
 * A person's pose as the renderer draws it: bone positions read inside a render (the bridge poses on
 * scene.onBeforeRender and puts the host pose back afterwards, so reading between frames shows the host pose).
 */
const drawn = (page, id) => page.evaluate(id => new Promise(resolve => {
  const { scene } = window.__ms, prev = scene.onAfterRender
  scene.onAfterRender = function (...a) {
    scene.onAfterRender = prev
    const out = {}
    scene.traverse(o => { if (o.name === 'dev-vrm-' + id) o.traverse(b => { if (b.isBone) { const p = b.getWorldPosition(new b.position.constructor()); out[b.name] = [p.x, p.y, p.z] } }) })
    // this hook sits outside the bridge's (it was installed later), so the pose is still on
    prev.apply(this, a); resolve(out)
  }
}), id)
const pick = (bones, re) => { const k = Object.keys(bones).find(n => re.test(n)); return k ? bones[k] : null }
const HAND_L = /(left_?hand|hand[._]?l|L_Hand)$/i, HAND_R = /(right_?hand|hand[._]?r|R_Hand)$/i, HEAD = /head$/i, HIPS = /hips$/i

if (want('keys')) {
  const page = await open()
  await page.evaluate(() => { window.__ms.place(0, 0.1); })
  await step(page, 1.2)
  const m = await me(page)
  check('keys: the person on the stage is posed', m?.inside && m.weight > 0.99 && m.rig && !m.error, m)
  const names = await page.evaluate(() => window.__ms.boneNames('local-dev'))
  writeFileSync(join(OUT, 'bones.json'), JSON.stringify(names))
  const table = {}
  for (const key of KEYS) {
    await page.evaluate(k => window.__ms.holdKey(k), key)
    await step(page, 0.1)
    for (const v of ['front', 'side']) { await view(page, v); await shot(page, `key-${key}-${v}`) }
    const b = await drawn(page, 'local-dev')
    const l = pick(b, HAND_L), r = pick(b, HAND_R), h = pick(b, HEAD), hips = pick(b, HIPS)
    table[key] = { handL: l?.map(x => +x.toFixed(2)), handR: r?.map(x => +x.toFixed(2)), head: h?.map(x => +x.toFixed(2)), hips: hips?.map(x => +x.toFixed(2)) }
    const e = (await me(page))?.error
    if (e) check(`keys: ${key} solves`, false, e)
  }
  console.log(JSON.stringify(table, null, 1))
  writeFileSync(join(OUT, 'keys.json'), JSON.stringify(table, null, 1))
  const t = table
  check('keys: up has both hands above the head', t.up.handL[1] > t.up.head[1] && t.up.handR[1] > t.up.head[1], t.up)
  check('keys: side has the hands far apart at shoulder height', Math.abs(t.side.handL[0] - t.side.handR[0]) > 1.1, t.side)
  check('keys: fold brings the head down by more than 30 cm', t.fold.head[1] < t.rest.head[1] - 0.3 && t.fold.head[2] > t.rest.head[2] + 0.25, [t.fold.head, t.rest.head])
  check('keys: swingDown lowers the hips', t.swingDown.hips[1] < t.rest.hips[1] - 0.06, [t.swingDown.hips, t.rest.hips])
  await page.close()
}

if (want('enter')) {
  const page = await open()
  await view(page, 'wide')
  await step(page, 0.3)
  const before = await drawn(page, 'local-dev')
  check('enter: nobody on the stage, nobody posed', (await page.evaluate(() => window.__ms.report())).bridge.length === 0)
  await shot(page, 'enter-0-outside')
  // walk in from the front; the routine is frozen in the "up" hold (beat 3 of 32)
  await page.evaluate(b => { window.__ms.freeze(3 * b); window.__ms.walk(0.2, 0.4) }, BEAT)
  let enteredAfter = null
  for (let i = 0; i < 40 && enteredAfter == null; i++) { await step(page, 0.05); if ((await me(page))?.inside) enteredAfter = i * 0.05 }
  check('enter: walking onto the stage is noticed', enteredAfter != null, { enteredAfter })
  await step(page, 0.2); await shot(page, 'enter-1-taking-over')
  await step(page, 1.0)
  const m = await me(page)
  check('enter: fully posed and turned to the front within about 1 s', m?.weight > 0.99 && m.turn > 0.99, m)
  // stepping moved the clock on: go back to the held 'up' (beat 3 of 32)
  await page.evaluate(b => window.__ms.freeze(3 * b), BEAT); await step(page, 1 / 60)
  const inPose = await drawn(page, 'local-dev')
  check('enter: the hands are up (the routine, not the idle pose)', pick(inPose, HAND_L)[1] > pick(before, HAND_L)[1] + 0.5, [pick(inPose, HAND_L), pick(before, HAND_L)])
  await shot(page, 'enter-2-posed')
  // walk out again
  await page.evaluate(() => window.__ms.walk(0.2, 3.2))
  let leftAt = null, zero = null
  for (let i = 0; i < 80 && zero == null; i++) {
    await step(page, 1 / 30)
    const e = await me(page)
    if (leftAt == null && e && !e.inside) leftAt = i
    if (leftAt != null && (!e || e.weight === 0)) zero = (i - leftAt) / 30
    if (leftAt != null && i === leftAt + 2) await shot(page, 'enter-3-letting-go')
  }
  check('enter: leaving lets go within 0.3 s', zero != null && zero <= 0.3, { zero })
  await step(page, 1.5)
  const after = await drawn(page, 'local-dev')
  const l0 = pick(before, HAND_L), l1 = pick(after, HAND_L), z = (await page.evaluate(() => window.__ms.lab.local.position))
  // the stand-in idles, so compare relative to where the person stands
  check('enter: after leaving, the host pose is back', Math.abs((l1[1]) - (l0[1])) < 0.05, { before: l0, after: l1, z })
  check('enter: the entry is dropped', (await page.evaluate(() => window.__ms.report())).bridge.length === 0)
  await shot(page, 'enter-4-outside-again')
  await page.close()
}

if (want('unison')) {
  const page = await open()
  await page.evaluate(() => { window.__ms.place(0.9, 0.2); window.__ms.place(-0.9, 0.0, 'remote-a', 2.2); window.__ms.place(0, -0.7, 'remote-b', -0.5) })
  await page.evaluate(b => window.__ms.freeze(13 * b), BEAT) // swingOut
  await step(page, 1.5)
  const r = await page.evaluate(() => window.__ms.report())
  check('unison: three people on the stage, all posed', r.bridge.length === 3 && r.bridge.every(e => e.weight > 0.99 && e.rig && !e.error), r.bridge.map(e => [e.userId, e.weight, e.status, e.error]))
  await page.evaluate(b => window.__ms.freeze(13 * b), BEAT); await step(page, 1 / 60)
  const poses = {}
  for (const id of ['local-dev', 'remote-a', 'remote-b']) { const b = await drawn(page, id), hips = pick(b, HIPS), l = pick(b, HAND_L); poses[id] = [l[0] - hips[0], l[1] - hips[1], l[2] - hips[2]].map(x => +x.toFixed(3)) }
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  check('unison: the same pose facing the same way (left hand relative to hips within 2 cm)', d(poses['local-dev'], poses['remote-a']) < 0.02 && d(poses['local-dev'], poses['remote-b']) < 0.02, poses)
  await view(page, 'front'); await shot(page, 'unison-front')
  await view(page, 'wide'); await shot(page, 'unison-wide')
  await page.close()
}

if (want('routine')) {
  const page = await open()
  await page.evaluate(() => { window.__ms.place(0, 0.1) })
  await step(page, 1.0)
  await view(page, 'front')
  // one frame per beat over the whole loop, and how far the hands move per 1/60 s (a jump shows as a spike)
  let worst = { speed: 0, beat: 0 }, prev = null
  await page.evaluate(() => window.__ms.freeze(0)); await step(page, 0.02)
  for (let beat = 0; beat < 32; beat++) {
    if (beat % 2 === 0) await shot(page, `routine-${String(beat).padStart(2, '0')}`)
    for (let f = 0; f < 33; f++) {
      await step(page, 1 / 60)
      const b = await drawn(page, 'local-dev'), l = pick(b, HAND_L), r = pick(b, HAND_R)
      if (prev) { const s = Math.max(Math.hypot(l[0] - prev.l[0], l[1] - prev.l[1], l[2] - prev.l[2]), Math.hypot(r[0] - prev.r[0], r[1] - prev.r[1], r[2] - prev.r[2])) * 60; if (s > worst.speed) worst = { speed: +s.toFixed(2), beat: +(beat + f / 33).toFixed(2) } }
      prev = { l, r }
    }
  }
  const e = await me(page)
  check('routine: the whole loop solves without an error', e && !e.error, e?.error)
  check('routine: no hand moves faster than 6 m/s (no one-frame jump)', worst.speed < 6, worst)
  await page.close()
}

if (want('vr')) {
  const page = await open()
  await page.evaluate(() => { window.__ms.vr(true); window.__ms.place(0, 0.1) })
  await step(page, 1.0)
  const e = await me(page)
  check('vr: a person in VR on the stage is left alone', e?.inside && e.weight === 0, e)
  await page.close()
}

await browser.close()
const failed = Object.entries(results).filter(([, r]) => !r.ok)
if (errors.length) console.log('page errors:', [...new Set(errors)].slice(0, 8))
console.log(`${Object.keys(results).length - failed.length}/${Object.keys(results).length} passed`)
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, errors: [...new Set(errors)] }, null, 1))
process.exit(failed.length || errors.length ? 1 : 0)
