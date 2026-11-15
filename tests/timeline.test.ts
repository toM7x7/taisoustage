import test from 'node:test'
import assert from 'node:assert/strict'
import { BEAT_S, LOOP_BEATS, LOOP_S, START_KEY, STEPS, VISIT_ORDER, segmentAt } from '../src/motion/timeline.ts'

test('one loop is 32 beats and ends where it starts', () => {
  assert.equal(LOOP_BEATS, 32)
  assert.equal(STEPS.at(-1)!.to, START_KEY)
  assert.ok(Math.abs(LOOP_S - 32 * BEAT_S) < 1e-9)
})
test('the routine loops without a jump, also for wall-clock sized and negative times', () => {
  for (const base of [0, LOOP_S, LOOP_S * Math.round(1.7e9 / LOOP_S), -LOOP_S * 3]) {
    const a = segmentAt(base + LOOP_S - 1e-4), b = segmentAt(base + LOOP_S + 1e-4)
    assert.equal(a.to, START_KEY); assert.ok(a.u > 0.99)
    assert.equal(b.from, START_KEY); assert.ok(b.u < 0.01)
  }
})
test('every exercise starts on the rest key', () => {
  for (const beat of [0, 8, 16, 24]) assert.equal(segmentAt(beat * BEAT_S + 1e-6).from, START_KEY)
})
test('each segment runs from the previous key to its own', () => {
  let from = START_KEY, at = 0
  for (const s of STEPS) { const g = segmentAt((at + s.beats / 2) * BEAT_S); assert.equal(g.from, from); assert.equal(g.to, s.to); assert.ok(Math.abs(g.u - 0.5) < 1e-9); from = s.to; at += s.beats }
})
test('visit order lists each key once, rest first', () => {
  assert.equal(VISIT_ORDER[0], START_KEY)
  assert.equal(new Set(VISIT_ORDER).size, VISIT_ORDER.length)
})
