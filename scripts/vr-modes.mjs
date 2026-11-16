// Tries the VR modes on the lab page (dev server on 5316): a person in VR stands on the stage, and the pose is read
// inside a render for each mode. The lab cannot track hands: the stand-in's idle arms play the "real hands".
// Usage: node scripts/vr-modes.mjs   (images in output/vr/)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
const BASE = process.env.MS_BASE ?? 'http://127.0.0.1:5316/', OUT = join(import.meta.dirname, '..', 'output', 'vr')
mkdirSync(OUT, { recursive: true })
const exe = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
const BEAT = 0.55, KEYS = { up: 3, swingDown: 12, fold: 26 }
const rows = []
for (const mode of ['skip', 'body', 'full']) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []; page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${BASE}?lab&clean&vrpose=${mode}`)
  await page.waitForFunction(() => { let n = 0; window.__ms?.scene.traverse(o => { if (/^dev-vrm-/.test(o.name)) n++ }); return n >= 3 }, null, { timeout: 30000 })
  await page.evaluate(() => { const ms = window.__ms; ms.vr(true); ms.place(0, 0.1, undefined, Math.PI); ms.view([0, 1.3, 4.0], [0, 0.95, 0]); ms.freeze(0) })
  for (const [key, beat] of Object.entries(KEYS)) {
    const r = await page.evaluate(async t => {
      const ms = window.__ms; ms.freeze(t)
      for (let i = 0; i < 70; i++) { ms.advance(i < 69 ? 1 / 60 : 0); await new Promise(r => requestAnimationFrame(r)) }
      ms.freeze(t); await new Promise(r => requestAnimationFrame(r))
      return await new Promise(resolve => {
        const { scene } = ms, prev = scene.onAfterRender
        scene.onAfterRender = function (...a) {
          scene.onAfterRender = prev
          const out = {}
          scene.traverse(o => { if (o.name === 'dev-vrm-local-dev') o.traverse(b => { if (b.isBone && /(hips|head|lefthand|leftfoot)$/i.test(b.name)) { const p = b.getWorldPosition(new b.position.constructor()); out[b.name.replace(/.*(hips|head|lefthand|leftfoot)$/i, '$1').toLowerCase()] = +p.y.toFixed(2) } }) })
          prev.apply(this, a); resolve({ y: out, entry: ms.report().bridge.find(e => e.userId === 'local-dev') })
        }
      })
    }, (beat + 0.5) * BEAT)
    // hold the key itself for the image
    await page.evaluate(k => window.__ms.holdKey(k), key)
    for (let i = 0; i < 3; i++) await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
    await page.screenshot({ path: join(OUT, `${mode}-${key}.png`) })
    await page.evaluate(() => window.__ms.holdKey(null))
    rows.push({ mode, key, ...r.y, weight: r.entry?.weight ?? 0, error: r.entry?.error ?? null })
  }
  if (errors.length) console.log(mode, 'page errors', errors)
  await page.close()
}
await browser.close()
console.table(rows)
