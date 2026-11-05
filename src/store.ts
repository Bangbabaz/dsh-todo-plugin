/**
 * Host data layer for the personal todo list.
 *
 * One JSON document under the DSH profile, mutated only by this process.
 * Every public method is the single implementation shared by the Agent tools
 * and by the browser HTTP routes.
 */
import type { Task, TaskInput, TaskChange, TaskView, Item, ItemView, Batch, BatchView, PersistedState, CandidateInput, Owner, Operation, TodoStore, ApplyResult, LocalClock } from './types.js'
import { decodeState, isRecord } from './validation.js'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCHEMA_VERSION = 1

const MAX_TITLE = 300
const MAX_NOTE = 4000
const MAX_QUOTE = 4000

function isInsideNodeModules(path: string) {
  return path.split(/[\\/]/u).includes('node_modules')
}

/**
 * The profile owns this plugin's data. Prefer the directory the launcher
 * exported; otherwise walk above the `node_modules` boundary to the directory
 * that carries a `cordis.patch.yml`, which is the profile root.
 */
export function resolveProfileDir() {
  const exported = process.env.DSH_PROFILE_DIR
  if (typeof exported === 'string' && exported.length > 0
    && existsSync(exported) && !isInsideNodeModules(exported)) {
    return exported
  }
  // Start at the package root so dist/ cannot mistake our own patch for a profile.
  let dir = dirname(dirname(fileURLToPath(import.meta.url)))
  for (let guard = 0; guard < 12; guard += 1) {
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
    if (!isInsideNodeModules(dir) && existsSync(join(dir, 'cordis.patch.yml'))) return dir
  }
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const profile = process.env.DSH_PROFILE ?? 'desktop'
  return join(home, 'profiles', profile)
}

function emptyState(): PersistedState {
  return { version: SCHEMA_VERSION, rev: 0, tasks: {}, batches: {}, items: {}, idem: {} }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function isoDay(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const day = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/u.test(day) ? day : null
}

function ownerOf(value: unknown): Owner {
  return value === 'other' || value === 'unknown' ? value : 'self'
}

function itemKey(batchId: string, itemId: string) {
  return `${batchId}|${itemId}`
}

export function localClock(now = Date.now()): LocalClock {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  const today = `${part('year')}-${part('month')}-${part('day')}`
  return { today, time: `${today} ${part('hour')}:${part('minute')}`, timeZone }
}

function byDueThenRecent(a: Task, b: Task) {
  if (a.due !== null && b.due !== null && a.due !== b.due) return a.due < b.due ? -1 : 1
  if (a.due !== null && b.due === null) return -1
  if (a.due === null && b.due !== null) return 1
  return b.createdAt - a.createdAt
}

function openList(state: PersistedState) {
  return Object.values(state.tasks).filter((t) => t.status === 'open').sort(byDueThenRecent)
}

function doneList(state: PersistedState) {
  return Object.values(state.tasks).filter((t) => t.status === 'done')
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
}

function batchItems(state: PersistedState, batchId: string) {
  return Object.values(state.items).filter((i) => i.batchId === batchId).sort((a, b) => a.order - b.order)
}

function batchCounts(items: Item[]) {
  const counts: Record<Operation, number> = { add: 0, update: 0, complete: 0, reopen: 0, delete: 0 }
  for (const item of items) if (item.op in counts) counts[item.op] += 1
  return counts
}

function latestBatch(state: PersistedState, sessionId: string | null) {
  let best: Batch | null = null
  for (const batch of Object.values(state.batches)) {
    if (sessionId !== null && batch.sessionId !== sessionId) continue
    if (best === null || batch.createdAt >= best.createdAt) best = batch
  }
  return best
}

function taskView(task: Task): TaskView {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    due: task.due,
    note: task.note,
    owner: task.owner,
    ownerName: task.ownerName,
    source: task.source,
    version: task.version,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  }
}

function itemView(item: Item): ItemView {
  return {
    itemId: item.itemId,
    op: item.op,
    selected: item.selected,
    state: item.state,
    error: item.error,
    targetTaskId: item.targetTaskId,
    title: item.after?.title ?? item.before?.title ?? '',
    before: item.before,
    after: item.after,
    quote: item.quote,
    dupOf: item.dupOf,
    resultTaskId: item.resultTaskId,
  }
}

function batchView(state: PersistedState, batch: Batch): BatchView
function batchView(state: PersistedState, batch: Batch | null): BatchView | null
function batchView(state: PersistedState, batch: Batch | null): BatchView | null {
  if (batch === null) return null
  const items = batchItems(state, batch.id)
  return {
    id: batch.id,
    kind: batch.kind ?? 'propose',
    title: batch.title,
    state: batch.state,
    createdAt: batch.createdAt,
    appliedAt: batch.appliedAt,
    counts: batchCounts(items),
    items: items.map(itemView),
  }
}

/**
 * The card is the single confirmation surface: it lists every mixed operation
 * once, and it disappears the moment the batch executes. No second report.
 */
function cardVisible(batch: Batch) {
  if (batch.dismissedAt !== null) return false
  return batch.state === 'draft'
}

export function createStore({ dir }: { dir: string }): TodoStore {
  const file = join(dir, 'todo-data', 'state.json')
  let state = load()
  let transactionDepth = 0
  let dirty = false

  function load(): PersistedState {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (!isRecord(parsed)) return emptyState()
      if (parsed.version !== SCHEMA_VERSION) {
        const backup = `${file}.v${String(parsed.version ?? 'unknown')}.${String(Date.now())}`
        writeFileSync(backup, JSON.stringify(parsed), 'utf8')
        return emptyState()
      }
      const loaded = decodeState(parsed, SCHEMA_VERSION)
      // Older versions closed batches even when execution failed.
      for (const batch of Object.values(loaded.batches)) {
        if (batch.state === 'applied' && batchItems(loaded, batch.id).some((item) => item.state === 'failed')) {
          batch.state = 'draft'
          batch.dismissedAt = null
        }
      }
      for (const task of Object.values(loaded.tasks)) {
        if (task.source !== null || !task.candidateId) continue
        const item = Object.values(loaded.items).find((candidate) => candidate.resultTaskId === task.id)
        const batch = item === undefined ? undefined : loaded.batches[item.batchId]
        if (batch !== undefined && item !== undefined) task.source = { sessionId: batch.sessionId, quote: item.quote }
      }
      return loaded
    } catch {
      return emptyState()
    }
  }

  function save() {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(state), 'utf8')
    renameSync(tmp, file)
  }

  function commit() {
    dirty = true
  }


  function snapshotTask(task: Task): Task {
    return structuredClone(task)
  }

  function describeAfter(input: TaskChange): TaskChange {
    const after: TaskChange = {}
    if (typeof input.title === 'string') after.title = text(input.title, MAX_TITLE)
    if (input.due !== undefined) after.due = isoDay(input.due)
    if (input.note !== undefined) after.note = text(input.note, MAX_NOTE)
    if ('owner' in input && input.owner !== undefined) after.owner = ownerOf(input.owner)
    if (input.ownerName !== undefined) after.ownerName = text(input.ownerName, 120)
    return after
  }

  function createTask(input: TaskInput | (TaskChange & Pick<TaskInput, 'source' | 'candidateId'>), now: number): Task {
    const title = text(input.title, MAX_TITLE)
    if (title === null) throw new Error('待办需要一个标题')
    const task: Task = {
      id: randomUUID(),
      title,
      status: 'open',
      due: isoDay(input.due),
      note: text(input.note, MAX_NOTE),
      owner: ownerOf(input.owner),
      ownerName: text(input.ownerName, 120),
      source: input.source ?? null,
      candidateId: input.candidateId ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    }
    state.tasks[task.id] = task
    return task
  }

  function requireStoredTask(id: string | undefined) {
    const id2 = typeof id === 'string' ? id : null
    const task = id2 === null ? undefined : state.tasks[id2]
    if (task === undefined) throw new Error('找不到该待办')
    return task
  }

  function patchTask(task: Task, after: TaskChange, now: number) {
    if (typeof after.title === 'string' && after.title !== null) task.title = after.title
    if (after.due !== undefined) task.due = after.due
    if (after.note !== undefined) task.note = after.note
    if (after.owner !== undefined) task.owner = after.owner
    if (after.ownerName !== undefined) task.ownerName = after.ownerName
    task.version += 1
    task.updatedAt = now
  }

  function newItem(batchId: string, order: number, input: CandidateInput): Item {
    const op = input.op ?? 'add'
    if (!['add', 'update', 'complete', 'reopen', 'delete'].includes(op)) {
      throw new Error(`不支持的操作类型：${String(op)}`)
    }
    const item: Item = {
      itemId: typeof input.itemId === 'string' && input.itemId.length > 0 ? input.itemId : randomUUID(),
      batchId,
      order,
      op,
      targetTaskId: null,
      before: null,
      after: null,
      quote: typeof input.quote === 'string' ? text(input.quote, MAX_QUOTE) : null,
      dupOf: typeof input.dupOf === 'string' ? input.dupOf : null,
      selected: true,
      state: 'pending',
      error: null,
      expectedVersion: null,
      resultTaskId: null,
      resultVersion: null,
      appliedAt: null,
    }
    if (op === 'add') {
      item.after = describeAfter(input)
      if (item.after.title === undefined || item.after.title === null) throw new Error('新增项需要一个标题')
      if (item.after.owner === undefined) item.after.owner = 'unknown'
      item.selected = !(item.after.owner === 'other' || item.after.owner === 'unknown')
    } else {
      const target = requireStoredTask(input.taskId)
      item.targetTaskId = target.id
      item.before = snapshotTask(target)
      item.expectedVersion = target.version
      item.after = op === 'complete' ? { status: 'done' }
        : op === 'reopen' ? { status: 'open' }
          : op === 'delete' ? null
            : describeAfter(input)
    }
    return item
  }

  function reviveItem(item: Item, input: CandidateInput) {
    if (item.state !== 'pending' && item.state !== 'failed') throw new Error('该项已处理，不能再修改')
    const next = newItem(item.batchId, item.order, { ...input, itemId: item.itemId })
    Object.assign(item, next)
    return item
  }

  const api: TodoStore = {
    get rev() { return state.rev },

    /** Everything the browser needs in one payload. */
    snapshot(sessionId) {
      const now = Date.now()
      const open = openList(state)
      const done = doneList(state)
      const batch = latestBatch(state, sessionId)
      let card: BatchView | null = null
      if (batch !== null) {
        // Only unresolved proposals occupy the confirmation card.
        if (cardVisible(batch)) card = batchView(state, batch)
      }
      const clock = localClock(now)
      return {
        rev: state.rev,
        today: clock.today,
        time: clock.time,
        timeZone: clock.timeZone,
        counts: { open: open.length, done: done.length },
        open: open.map(taskView),
        done: done.map(taskView),
        batch: card,
      }
    },

    /** Model-facing read: the formal list, optionally filtered, plus this session's draft. */
    read(sessionId, { scope = 'open', query = null } = {}) {
      const needle = typeof query === 'string' && query.length > 0 ? query.toLowerCase() : null
      const pool = scope === 'done' ? doneList(state) : scope === 'all' ? [...openList(state), ...doneList(state)] : openList(state)
      const rows = needle === null ? pool : pool.filter((task) => task.title.toLowerCase().includes(needle)
        || (task.note ?? '').toLowerCase().includes(needle))
      const clock = localClock()
      const batch = latestBatch(state, sessionId)
      return {
        today: clock.today,
        time: clock.time,
        timeZone: clock.timeZone,
        counts: { open: openList(state).length, done: doneList(state).length },
        tasks: rows.map(taskView),
        batch: batch === null ? null : batchView(state, batch),
      }
    },

    addTask(input, requestId = null) {
      if (typeof requestId === 'string' && requestId.length > 0) {
        const known = state.idem[requestId]
        const existing = known === undefined ? undefined : state.tasks[known.taskId]
        if (existing !== undefined) {
          return { task: taskView(existing), deduplicated: true }
        }
      }
      const now = Date.now()
      const task = createTask(input, now)
      if (typeof requestId === 'string' && requestId.length > 0) {
        state.idem[requestId] = { taskId: task.id, at: now }
      }
      commit()
      return { task: taskView(task), deduplicated: false }
    },

    updateTask(id, patch) {
      const task = requireStoredTask(id)
      patchTask(task, describeAfter(patch), Date.now())
      commit()
      return { task: taskView(task) }
    },

    setTaskStatus(id, status) {
      const task = requireStoredTask(id)
      const now = Date.now()
      const next = status === 'done' ? 'done' : 'open'
      if (task.status !== next) {
        task.status = next
        task.completedAt = next === 'done' ? now : null
        task.version += 1
        task.updatedAt = now
        commit()
      }
      return { task: taskView(task) }
    },

    deleteTask(id) {
      const task = requireStoredTask(id)
      delete state.tasks[task.id]
      commit()
      return { deleted: task.id }
    },

    // ── batches ──────────────────────────────────────────────────────────────

    propose(sessionId, { title = null, items = [], mode = 'update', kind = 'propose' } = {}) {
      if (!Array.isArray(items) || items.length === 0) throw new Error('一次整理至少要有一项')
      const now = Date.now()
      if (mode === 'new') {
        const prior = latestBatch(state, sessionId)
        if (prior !== null && prior.state === 'draft') {
          prior.state = 'discarded'
          prior.dismissedAt = now
          prior.version += 1
        }
      }
      let batch = latestBatch(state, sessionId)
      if (batch === null || batch.state !== 'draft') batch = null
      if (batch === null) {
        batch = {
          id: randomUUID(),
          sessionId,
          kind,
          title: text(title, MAX_TITLE) ?? '本次待办整理',
          state: 'draft',
          version: 1,
          createdAt: now,
          updatedAt: now,
          appliedAt: null,
          dismissedAt: null,
        }
        state.batches[batch.id] = batch
      } else if (text(title, MAX_TITLE) !== null) {
        batch.title = text(title, MAX_TITLE) ?? batch.title
      }

      const existing = batchItems(state, batch.id)
      let order = existing.length === 0 ? 0 : Math.max(...existing.map((i) => i.order)) + 1

      for (const input of items) {
        const itemId = typeof input.itemId === 'string' && input.itemId.length > 0 ? input.itemId : null
        const prior = itemId === null ? undefined : state.items[itemKey(batch.id, itemId)]
        if (prior !== undefined) {
          reviveItem(prior, input)
          continue
        }
        const item = newItem(batch.id, order, input)
        order += 1
        state.items[itemKey(batch.id, item.itemId)] = item
      }

      batch.version += 1
      batch.updatedAt = now
      commit()
      return { batch: batchView(state, batch) }
    },

    /** Browser-side edits: selection toggles and per-item field rewrites. */
    revise(sessionId, batchId, changes) {
      const batch = this.requireBatch(batchId, sessionId)
      if (batch.state !== 'draft') throw new Error('该批次已执行，不能再修改')
      const now = Date.now()
      for (const change of changes ?? []) {
        const item = state.items[itemKey(batch.id, change.itemId)]
        if (item === undefined || !['pending', 'failed'].includes(item.state)) continue
        if (change.refresh === true) {
          if (item.targetTaskId !== null) {
            const target = requireStoredTask(item.targetTaskId)
            item.before = snapshotTask(target)
            item.expectedVersion = target.version
          }
          item.state = 'pending'
          item.error = null
          // Refreshing a conflict is a new proposal; it still needs confirmation.
          item.selected = false
        }
        if (typeof change.selected === 'boolean') item.selected = change.selected
        if (change.after !== undefined && change.after !== null) {
          item.after = { ...item.after, ...describeAfter(change.after) }
        }
      }
      batch.version += 1
      batch.updatedAt = now
      commit()
      return { batch: batchView(state, batch) }
    },

    requireBatch(batchId, sessionId) {
      const batch = typeof batchId === 'string' ? state.batches[batchId] : undefined
      if (batch === undefined) throw new Error('找不到该批次')
      if (typeof sessionId === 'string' && sessionId.length > 0 && batch.sessionId !== sessionId) {
        throw new Error('该批次属于其他会话')
      }
      return batch
    },

    resolveBatch(sessionId, batchId) {
      if (typeof batchId === 'string' && batchId.length > 0) return this.requireBatch(batchId, sessionId)
      const batch = latestBatch(state, sessionId)
      if (batch === null) throw new Error('当前会话没有待办批次')
      return batch
    },

    executeItem(item, now) {
      if (item.op === 'add') {
        const batch = this.requireBatch(item.batchId, null)
        const task = createTask({ ...item.after, candidateId: item.itemId,
          source: { sessionId: batch.sessionId, quote: item.quote } }, now)
        item.resultVersion = task.version
        return task.id
      }
      const task = item.targetTaskId === null ? undefined : state.tasks[item.targetTaskId]
      if (task === undefined) throw new Error('目标待办已不存在')
      if (item.expectedVersion !== null && task.version !== item.expectedVersion) {
        throw new Error('目标待办已被其他会话修改，请刷新后再确认')
      }
      if (item.op === 'delete') {
        delete state.tasks[task.id]
        item.resultVersion = null
        return task.id
      }
      if (item.op === 'complete' || item.op === 'reopen') {
        const next = item.op === 'complete' ? 'done' : 'open'
        if (task.status === next) throw new Error('目标待办已是该状态')
        task.status = next
        task.completedAt = next === 'done' ? now : null
        task.version += 1
        task.updatedAt = now
        item.resultVersion = task.version
        return task.id
      }
      patchTask(task, item.after ?? {}, now)
      item.resultVersion = task.version
      return task.id
    },

    apply(sessionId, batchId = null, itemIds = null) {
      const batch = this.resolveBatch(sessionId, batchId)
      if (batch.state !== 'draft' && batch.state !== 'applied') {
        throw new Error('该批次已结束，不能再次执行')
      }
      const now = Date.now()
      const all = batchItems(state, batch.id)
      const wanted = Array.isArray(itemIds) && itemIds.length > 0
        ? all.filter((item) => itemIds.includes(item.itemId))
        : all.filter((item) => item.selected && (item.state === 'pending' || item.state === 'failed'))
      if (wanted.length === 0) throw new Error('没有选中任何一项')

      const applied: ApplyResult['applied'] = []
      const failed: ApplyResult['failed'] = []
      for (const item of wanted) {
        if (item.state === 'applied') {
          applied.push({ itemId: item.itemId, taskId: item.resultTaskId, deduplicated: true })
          continue
        }
        if (item.state !== 'pending' && item.state !== 'failed') continue
        try {
          const taskId = this.executeItem(item, now)
          item.state = 'applied'
          item.error = null
          item.resultTaskId = taskId
          item.appliedAt = now
          applied.push({ itemId: item.itemId, taskId })
        } catch (error) {
          item.state = 'failed'
          item.error = error instanceof Error ? error.message : String(error)
          failed.push({ itemId: item.itemId, error: item.error })
        }
      }

      // The card only leaves its confirm stage when nothing is left to decide;
      // a partly confirmed batch keeps the remaining candidates actionable.
      batch.appliedAt = applied.length > 0 ? now : batch.appliedAt
      if (!batchItems(state, batch.id).some((i) => i.state === 'pending' || i.state === 'failed')) {
        batch.state = 'applied'
      }
      batch.version += 1
      batch.updatedAt = now

      commit()
      return { batch: batchView(state, batch), applied, failed }
    },

    discard(sessionId, batchId = null, itemIds = null) {
      const batch = this.resolveBatch(sessionId, batchId)
      if (batch.state !== 'draft') throw new Error('该批次已结束')
      const now = Date.now()
      const all = batchItems(state, batch.id)
      const targets = Array.isArray(itemIds) && itemIds.length > 0
        ? all.filter((item) => itemIds.includes(item.itemId))
        : all
      for (const item of targets) {
        if (item.state === 'pending' || item.state === 'failed') {
          item.state = 'ignored'
          item.selected = false
        }
      }
      if (!batchItems(state, batch.id).some((i) => i.state === 'pending' || i.state === 'failed')) {
        batch.state = 'discarded'
        batch.dismissedAt = now
      }
      batch.version += 1
      batch.updatedAt = now
      commit()
      return { batch: batchView(state, batch) }
    },

    dismiss(sessionId, batchId) {
      const batch = this.requireBatch(batchId, sessionId)
      batch.dismissedAt = Date.now()
      batch.version += 1
      commit()
      return { dismissed: batch.id }
    },

    /** A user-ordered direct change: build a batch and apply it at once. */
    direct(sessionId, ops) {
      if (!Array.isArray(ops) || ops.length === 0) throw new Error('没有要执行的改动')
      const items = ops.map((op) => ({ ...op, owner: op.owner ?? 'self' }))
      const { batch } = this.propose(sessionId, { title: 'AI 直接执行', items, mode: 'new', kind: 'direct' })
      for (const view of batch.items) {
        const stored = state.items[itemKey(batch.id, view.itemId)]
        if (stored !== undefined && stored.state === 'pending') stored.selected = true
      }
      try {
        return this.apply(sessionId, batch.id, null)
      } catch (error) {
        // A rejected batch must not linger as an empty draft the user has to close.
        try { this.discard(sessionId, batch.id, null) } catch { /* already gone */ }
        throw error
      }
    },
  }

  // All nested mutations (including direct -> propose -> apply) share one
  // transaction. Validation and write failures publish neither data nor rev.
  function wrapMutation<Key extends MutationName>(name: Key) {
    // Preserve the key's parameter/result relationship when wrapping a method union.
    const mutate = api[name] as (...args: Parameters<TodoStore[Key]>) => ReturnType<TodoStore[Key]>
    const wrapped = function (this: TodoStore, ...args: Parameters<TodoStore[Key]>): ReturnType<TodoStore[Key]> {
      return transact(() => mutate.apply(this, args))
    }
    Object.defineProperty(api, name, { value: wrapped, writable: true, enumerable: true, configurable: true })
  }

  type MutationName = 'addTask' | 'updateTask' | 'setTaskStatus' | 'deleteTask' | 'propose' | 'revise' | 'apply' | 'discard' | 'dismiss' | 'direct'
  function transact<Result>(mutate: () => Result): Result {
    if (transactionDepth > 0) return mutate()
    const previous = state
    state = structuredClone(previous)
    transactionDepth += 1
    dirty = false
    try {
      const result = mutate()
      if (dirty) {
        state.rev = previous.rev + 1
        save()
      }
      return result
    } catch (error) {
      state = previous
      throw error
    } finally {
      transactionDepth -= 1
      dirty = false
    }
  }
  for (const name of ['addTask', 'updateTask', 'setTaskStatus', 'deleteTask', 'propose',
    'revise', 'apply', 'discard', 'dismiss', 'direct'] as const) wrapMutation(name)
  return api
}
