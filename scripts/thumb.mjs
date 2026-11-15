// Thumbnail (512x512, public/thumbnail.png): three stand-in people on the stage in the swing-out pose. Dev server on 5316.
import { chromium } from 'playwright'
import { join } from 'node:path'
const exe = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 })
await page.goto((process.env.MS_BASE ?? 'http://127.0.0.1:5316/') + '?lab&clean')
await page.waitForFunction(() => { let n = 0; window.__ms?.scene.traverse(o => { if (/^dev-vrm-/.test(o.name)) n++ }); return n >= 3 }, null, { timeout: 30000 })
await page.evaluate(async () => {
  const ms = window.__ms
  ms.place(0.95, 0.35); ms.place(-0.95, 0.35, 'remote-a'); ms.place(0, -0.45, 'remote-b')
  ms.view([2.3, 1.75, 4.3], [0, 1.12, -0.1]); ms.freeze(0)
  for (let i = 0; i < 90; i++) { ms.advance(1 / 60); await new Promise(r => requestAnimationFrame(r)) }
  ms.holdKey('swingOut')
  for (let i = 0; i < 6; i++) await new Promise(r => requestAnimationFrame(r))
})
await page.screenshot({ path: join(import.meta.dirname, '..', 'public', 'thumbnail.png') })
await browser.close()
console.log('public/thumbnail.png')
