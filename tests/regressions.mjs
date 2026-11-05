import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../dist/store.js'

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'todo-regression-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, store: createStore({ dir }) }
}

test('write failure rolls back data, revision and idempotency before retry', (t) => {
  const { dir, store } = setup(t)
  const blocked = join(dir, 'todo-data', 'state.json')
  mkdirSync(blocked, { recursive: true })
  assert.throws(() => store.addTask({ title: 'Not saved' }, 'request'))
  assert.equal(store.rev, 0)
  assert.equal(store.snapshot('a').counts.open, 0)
  rmSync(blocked, { recursive: true })
  const retry = store.addTask({ title: 'Not saved' }, 'request')
  assert.equal(retry.deduplicated, false)
  assert.equal(createStore({ dir }).snapshot('a').counts.open, 1)
})

test('invalid proposal leaves memory and disk unchanged, including prior draft', (t) => {
  const { dir, store } = setup(t)
  const first = store.propose('a', { items: [{ op: 'add', title: 'Keep me', owner: 'self' }] })
  const previous = store.snapshot('a')
  const bytes = readFileSync(join(dir, 'todo-data', 'state.json'), 'utf8')
  assert.throws(() => store.propose('a', { mode: 'new', items: [
    { op: 'add', title: 'Ghost', owner: 'self' },
    { op: 'update', taskId: 'missing', title: 'Invalid' },
  ] }))
  assert.deepEqual(store.snapshot('a'), previous)
  assert.equal(store.snapshot('a').batch.id, first.batch.id)
  assert.equal(readFileSync(join(dir, 'todo-data', 'state.json'), 'utf8'), bytes)
})

test('conflict stays visible; refresh requires selection and reconfirmation', (t) => {
  const { store } = setup(t)
  const { task } = store.addTask({ title: 'Before' })
  const { batch } = store.propose('a', { items: [{ op: 'update', taskId: task.id, title: 'Proposal' }] })
  store.updateTask(task.id, { title: 'Concurrent edit' })
  assert.equal(store.apply('a', batch.id).failed.length, 1)
  assert.equal(store.snapshot('a').batch.state, 'draft')
  const itemId = batch.items[0].itemId
  const refreshed = store.revise('a', batch.id, [{ itemId, refresh: true }])
  assert.equal(refreshed.batch.items[0].selected, false)
  assert.equal(refreshed.batch.items[0].before.title, 'Concurrent edit')
  assert.throws(() => store.apply('a', batch.id))
  store.revise('a', batch.id, [{ itemId, selected: true }])
  assert.equal(store.apply('a', batch.id).applied.length, 1)
  assert.equal(store.read('a').tasks[0].title, 'Proposal')
})

test('discarding remaining suggestions preserves already applied tasks across restart', (t) => {
  const { dir, store } = setup(t)
  const { batch } = store.propose('a', { items: [
    { op: 'add', title: 'First', owner: 'self' }, { op: 'add', title: 'Second', owner: 'self' },
  ] })
  store.apply('a', batch.id, [batch.items[0].itemId])
  store.discard('a', batch.id)
  const snapshot = createStore({ dir }).snapshot('a')
  assert.equal(snapshot.batch, null)
  assert.deepEqual(snapshot.open.map((task) => task.title), ['First'])
})

test('source survives confirmation and restart, and deletion persists', (t) => {
  const { dir, store } = setup(t)
  const { batch } = store.propose('a', { items: [{ op: 'add', title: 'Evidence', quote: 'Source sentence', owner: 'self' }] })
  const id = store.apply('a', batch.id).applied[0].taskId
  const task = createStore({ dir }).read('a').tasks[0]
  assert.deepEqual(task.source, { sessionId: 'a', quote: 'Source sentence' })
  store.direct('a', [{ op: 'delete', taskId: id }])
  assert.equal(createStore({ dir }).snapshot('a').counts.open, 0)
})

test('title-only revisions and HTTP-style undefined fields preserve date and note', (t) => {
  const { store } = setup(t)
  const { task } = store.addTask({ title: 'Old', due: '2026-11-20', note: 'Retain note' })
  const { batch } = store.propose('a', { items: [{ op: 'update', taskId: task.id, title: 'New' }] })
  store.revise('a', batch.id, [{ itemId: batch.items[0].itemId, after: { title: 'Revised' } }])
  store.apply('a', batch.id)
  store.updateTask(task.id, { title: 'HTTP edit', due: undefined, note: undefined })
  assert.equal(store.read('a').tasks[0].due, '2026-11-20')
  assert.equal(store.read('a').tasks[0].note, 'Retain note')
})

test('direct is a single transaction and write failure restores the old draft', (t) => {
  const { dir, store } = setup(t)
  store.propose('a', { items: [{ op: 'add', title: 'Draft', owner: 'self' }] })
  const before = store.snapshot('a')
  const tmp = join(dir, 'todo-data', 'state.json.tmp')
  mkdirSync(tmp)
  assert.throws(() => store.direct('a', [{ op: 'add', title: 'Uncommitted' }]))
  assert.deepEqual(store.snapshot('a'), before)
  rmSync(tmp, { recursive: true })
  store.direct('a', [{ op: 'add', title: 'Committed' }])
  assert.equal(store.rev, before.rev + 1)
  assert.equal(createStore({ dir }).snapshot('a').counts.open, 1)
})

test('existing failed batches and task sources recover when loading old state', (t) => {
  const { dir, store } = setup(t)
  const first = store.direct('a', [{ op: 'add', title: 'Legacy' }])
  const file = join(dir, 'todo-data', 'state.json')
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  const item = Object.values(saved.items)[0]
  saved.tasks[first.applied[0].taskId].source = null
  item.quote = 'Legacy evidence'
  item.state = 'failed'
  saved.batches[first.batch.id].state = 'applied'
  writeFileSync(file, JSON.stringify(saved))
  const reopened = createStore({ dir })
  assert.equal(reopened.snapshot('a').batch.state, 'draft')
  assert.equal(reopened.read('a').tasks[0].source.quote, 'Legacy evidence')
})
