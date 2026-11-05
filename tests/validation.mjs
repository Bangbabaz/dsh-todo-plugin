import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createStore, resolveProfileDir } from '../dist/store.js'
import { decodeState, parseOperation, parseStateResponse, parseMutationResponse } from '../dist/validation.js'

test('HTTP boundary rejects malformed fields before they can mutate storage', () => {
  for (const input of [null, [], { op: 'undo' }, { op: 'update', taskId: 4 },
    { op: 'update', taskId: 'a', title: null }, { op: 'add', title: 'x', due: 4 },
    { op: 'toggle', taskId: 'a', status: 'deleted' },
    { op: 'apply', itemIds: [1] }, { op: 'revise', batchId: 'a', changes: [{ itemId: 'b', after: { owner: 'invalid' } }] }]) {
    assert.throws(() => parseOperation(input))
  }
  assert.deepEqual(parseOperation({ op: 'update', taskId: 'a', due: null, session: 's' }),
    { op: 'update', taskId: 'a', due: null, session: 's' })
  assert.deepEqual(parseOperation({ op: 'add', title: 'Task' }), { op: 'add', title: 'Task', session: '' })
})

test('browser decoders accept real snapshots and reject malformed response bodies', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'todo-types-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = createStore({ dir })
  const target = store.addTask({ title: 'Existing task' }).task
  const { batch } = store.propose('s', { items: [
    { op: 'update', taskId: target.id, title: 'Updated task' },
    { op: 'add', title: 'New task', owner: 'self' },
  ] })
  const state = store.snapshot('s')
  assert.deepEqual(parseStateResponse({ ok: true, state }).state, state)
  assert.equal(parseStateResponse({ ok: true, unchanged: true, rev: 2 }).unchanged, true)
  const result = store.apply('s', batch.id)
  assert.deepEqual(parseMutationResponse({ ok: true, state: store.snapshot('s'), result }).result, result)
  for (const value of [null, {}, { ok: true, state: { ...state, open: [{ id: 'broken' }] } },
    { ok: true, state: { ...state, batch: { ...state.batch, items: [{ itemId: 'broken' }] } } }]) {
    assert.throws(() => parseStateResponse(value))
  }
  assert.throws(() => parseMutationResponse({ ok: true, state, result: { failed: [] } }))
  assert.throws(() => parseStateResponse({ ok: false, error: 'Offline' }), /Offline/)
})

test('storage decoder accepts legacy state while filtering invalid records', () => {
  assert.deepEqual(decodeState({ tasks: { broken: null }, batches: [], items: 'invalid', idem: { broken: {} } }, 1),
    { version: 1, rev: 0, tasks: {}, batches: {}, items: {}, idem: {} })
})

test('compiled location does not treat the plugin package as the profile', () => {
  const exported = process.env.DSH_PROFILE_DIR
  delete process.env.DSH_PROFILE_DIR
  try {
    assert.notEqual(resolve(resolveProfileDir()), resolve('.'))
  } finally {
    if (exported !== undefined) process.env.DSH_PROFILE_DIR = exported
  }
})
