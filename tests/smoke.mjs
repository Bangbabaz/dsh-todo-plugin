/**
 * Store smoke test — exercises the batch lifecycle without the harness.
 * Run: node tests/smoke.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../dist/store.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-todo-'))
let failures = 0

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const store = createStore({ dir })
const session = 'session-a'

console.log('propose + apply')
{
  const { batch } = store.propose(session, {
    title: '会议整理',
    items: [
      { op: 'add', owner: 'self', title: '补充移动端稿', due: '2026-11-07', quote: '我要周五前补一下移动端稿' },
      { op: 'add', owner: 'other', ownerName: '小王', title: '确认接口' },
      { op: 'add', owner: 'unknown', title: '待定事项' },
    ],
  })
  check('three items', batch.items.length === 3)
  check('self item preselected', batch.items[0].selected === true)
  check('other item not preselected', batch.items[1].selected === false)
  check('unknown item not preselected', batch.items[2].selected === false)
  check('counts add=3', batch.counts.add === 3)

  const first = batch.items[0].itemId
  const again = store.propose(session, {
    items: [{ itemId: first, op: 'add', owner: 'self', title: '补充移动端设计稿', due: '2026-11-07' }],
  })
  check('same batch id', again.batch.id === batch.id)
  check('still three items', again.batch.items.length === 3)
  check('item rewritten in place', again.batch.items[0].title === '补充移动端设计稿')

  const applied = store.apply(session, again.batch.id, null)
  check('one applied', applied.applied.length === 1 && applied.failed.length === 0)
  check('task created', applied.applied[0].taskId !== null)
  check('partly confirmed batch stays open', applied.batch.state === 'draft')
  check('undecided items kept', applied.batch.items.filter((item) => item.state === 'pending').length === 2)

  const snap = store.snapshot(session)
  check('open count 1', snap.counts.open === 1)
  check('card still visible', snap.batch !== null)

  const rest = applied.batch.items
    .filter((item) => item.state === 'pending')
    .map((item) => item.itemId)
  const closed = store.apply(session, again.batch.id, rest)
  check('closing the batch applies the rest', closed.applied.length === 2)
  check('batch applied once nothing is pending', closed.batch.state === 'applied')
  check('list now has three', store.snapshot(session).counts.open === 3)

  check('completed batch no longer shows a card', store.snapshot(session).batch === null)

}

console.log('idempotency')
{
  const { batch } = store.propose(session, { items: [{ op: 'add', owner: 'self', title: '重复点击' }] })
  const first = store.apply(session, batch.id, null)
  check('first apply created one task', first.applied.length === 1)
  let rejected = false
  try { store.apply(session, batch.id, null) } catch { rejected = true }
  check('second apply on the same batch writes nothing', rejected)
  check('no duplicate task',
    Object.values(store.snapshot(session).open).filter((t) => t.title === '重复点击').length === 1)
}
{
  const id = 'req-1'
  store.addTask({ title: '手动添加' }, id)
  const again = store.addTask({ title: '手动添加' }, id)
  check('manual add deduplicated', again.deduplicated === true)
  check('still one task named 手动添加', Object.values(store.snapshot(session).open).filter((t) => t.title === '手动添加').length === 1)
}

console.log('conflict detection')
{
  const before = store.snapshot(session)
  const target = before.open.find((task) => task.title === '手动添加')
  const { batch } = store.propose(session, {
    items: [{ op: 'update', owner: 'self', taskId: target.id, title: '改名 A' }],
  })
  // Another session edits the same task after the batch captured its version.
  store.updateTask(target.id, { title: '改名 B' })
  const result = store.apply(session, batch.id, null)
  check('conflict reported', result.failed.length === 1 && result.applied.length === 0)
  check('target untouched', store.snapshot(session).open.find((t) => t.id === target.id).title === '改名 B')
}

console.log('partial failure and retry')
{
  const current = store.snapshot(session)
  const target = current.open[0]
  const { batch } = store.propose(session, {
    mode: 'new',
    items: [
      { op: 'add', owner: 'self', title: '应当成功' },
      { op: 'complete', owner: 'self', taskId: target.id },
    ],
  })
  store.updateTask(target.id, { title: '被改过' })
  const first = store.apply(session, batch.id, null)
  check('one applied one failed', first.applied.length === 1 && first.failed.length === 1)
  check('applied item recorded', first.batch.items.some((item) => item.state === 'applied'))
  const retry = store.apply(session, batch.id, null)
  check('retry does not re-run the item that already succeeded', retry.applied.length === 0)
  check('retry re-reports the still-conflicting item', retry.failed.length === 1)
  check('no duplicate of the successful add',
    store.snapshot(session).open.filter((t) => t.title === '应当成功').length === 1)
}

console.log('cross-session isolation')
{
  const other = 'session-b'
  const { batch } = store.propose(other, { items: [{ op: 'add', owner: 'self', title: 'B 会话的候选' }] })
  check('other session has its own batch', store.snapshot(other).batch.id === batch.id)
  const cardA = store.snapshot(session).batch
  check('session A does not see B batch', cardA === null || cardA.id !== batch.id)
  check('formal list is shared', store.snapshot(other).counts.open === store.snapshot(session).counts.open)
}

console.log('discard')
{
  const { batch } = store.propose(session, { items: [{ op: 'add', owner: 'self', title: '不要这条' }] })
  const dropped = store.discard(session, batch.id, null)
  check('batch discarded', dropped.batch.state === 'discarded')
  check('card hidden from snapshot', store.snapshot(session).batch === null || store.snapshot(session).batch.state !== 'discarded')
}

rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
