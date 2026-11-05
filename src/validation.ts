/** JSON is untrusted at disk and HTTP boundaries; narrow it before use. */
import type { Batch, BatchView, BrowserOperation, Item, ItemView, PersistedState,
  Snapshot, Task, TaskBefore, TaskChange, TaskSource, TaskView, TodoOperation,
  StateResponse, MutationResponse, ErrorResponse, ReviseChange, ApplyResult } from './types.js'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const string = (value: unknown): value is string => typeof value === 'string'
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const boolean = (value: unknown): value is boolean => typeof value === 'boolean'
const nullableString = (value: unknown): value is string | null => value === null || string(value)
const nullableNumber = (value: unknown): value is number | null => value === null || number(value)
export const isOwner = (value: unknown) => value === 'self' || value === 'other' || value === 'unknown'
const status = (value: unknown) => value === 'open' || value === 'done'
const operation = (value: unknown) => ['add', 'update', 'complete', 'reopen', 'delete'].some((op) => op === value)
const itemState = (value: unknown) => ['pending', 'applied', 'failed', 'ignored', 'undone'].some((state) => state === value)
const batchState = (value: unknown) => ['draft', 'applied', 'discarded', 'undone'].some((state) => state === value)
const optional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value)
const array = <T>(value: unknown, check: (value: unknown) => value is T): value is T[] => Array.isArray(value) && value.every(check)

function source(value: unknown): value is TaskSource {
  return isRecord(value) && string(value.sessionId) && nullableString(value.quote)
    && optional(value.messageSeq, number) && optional(value.materialTitle, string)
}
function fields(value: Record<string, unknown>): boolean {
  return string(value.title) && nullableString(value.due) && nullableString(value.note)
    && isOwner(value.owner) && nullableString(value.ownerName)
}
function patch(value: unknown): value is TaskChange {
  return isRecord(value) && optional(value.title, nullableString) && optional(value.due, nullableString)
    && optional(value.note, nullableString) && optional(value.owner, isOwner)
    && optional(value.ownerName, nullableString) && optional(value.status, status)
}
function before(value: unknown): value is TaskBefore {
  return isRecord(value) && fields(value) && status(value.status)
    && optional(value.id, string) && optional(value.source, (v) => v === null || source(v))
    && optional(value.candidateId, nullableString) && optional(value.version, number)
    && optional(value.createdAt, number) && optional(value.updatedAt, number) && optional(value.completedAt, nullableNumber)
}
function taskView(value: unknown): value is TaskView {
  return isRecord(value) && fields(value) && string(value.id) && status(value.status)
    && (value.source === null || source(value.source)) && number(value.version)
    && number(value.createdAt) && number(value.updatedAt) && nullableNumber(value.completedAt)
}
function task(value: unknown): value is Task {
  return isRecord(value) && nullableString(value.candidateId) && taskView(value)
}
function itemView(value: unknown): value is ItemView {
  return isRecord(value) && string(value.itemId) && operation(value.op) && boolean(value.selected)
    && itemState(value.state) && nullableString(value.error) && nullableString(value.targetTaskId)
    && (value.before === null || before(value.before)) && (value.after === null || patch(value.after))
    && nullableString(value.quote) && nullableString(value.dupOf) && nullableString(value.resultTaskId) && string(value.title)
}
function item(value: unknown): value is Item {
  return isRecord(value) && itemView({ ...value, title: '' }) && string(value.batchId) && number(value.order)
    && nullableNumber(value.expectedVersion) && nullableNumber(value.resultVersion) && nullableNumber(value.appliedAt)
}
function batch(value: unknown): value is Batch {
  return isRecord(value) && string(value.id) && string(value.sessionId) && string(value.title)
    && optional(value.kind, (v) => v === 'propose' || v === 'direct') && batchState(value.state)
    && number(value.version) && number(value.createdAt) && number(value.updatedAt)
    && nullableNumber(value.appliedAt) && nullableNumber(value.dismissedAt)
}
function counts(value: unknown): boolean {
  return isRecord(value) && ['add', 'update', 'complete', 'reopen', 'delete'].every((key) => number(value[key]))
}
function batchView(value: unknown): value is BatchView {
  return isRecord(value) && string(value.id) && string(value.title) && batchState(value.state)
    && (value.kind === 'propose' || value.kind === 'direct') && number(value.createdAt)
    && nullableNumber(value.appliedAt) && counts(value.counts) && array(value.items, itemView)
}
function recordOf<T>(value: unknown, check: (value: unknown) => value is T): Record<string, T> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, T] => check(entry[1])))
}
export function decodeState(value: Record<string, unknown>, version: number): PersistedState {
  return { version, rev: number(value.rev) ? value.rev : 0,
    tasks: recordOf(value.tasks, task), batches: recordOf(value.batches, batch), items: recordOf(value.items, item),
    idem: recordOf(value.idem, (v): v is PersistedState['idem'][string] => isRecord(v) && string(v.taskId) && number(v.at)) }
}
function revise(value: unknown): value is ReviseChange {
  return isRecord(value) && string(value.itemId) && optional(value.selected, boolean)
    && optional(value.refresh, boolean) && optional(value.after, (v) => v === null || (patch(v) && optional(v.title, string)))
}
function todoOperation(value: unknown): value is TodoOperation {
  if (!isRecord(value)) return false
  switch (value.op) {
    case 'add': return optional(value.requestId, string) && string(value.title) && patch(value)
    case 'update': return string(value.taskId) && optional(value.title, string) && patch(value)
    case 'toggle': return string(value.taskId) && status(value.status)
    case 'delete': return string(value.taskId)
    case 'revise': return string(value.batchId) && array(value.changes, revise)
    case 'apply': case 'discard': return optional(value.batchId, nullableString)
      && optional(value.itemIds, (v) => v === null || array(v, string))
    case 'dismiss': return string(value.batchId)
    default: return false
  }
}
export function parseOperation(value: unknown): BrowserOperation {
  if (!isRecord(value)) throw new Error('expected an object')
  const session = string(value.session) ? value.session : ''
  if (!todoOperation(value)) throw new Error(`invalid operation ${String(value.op)}`)
  return { ...value, session }
}
function snapshot(value: unknown): value is Snapshot {
  return isRecord(value) && number(value.rev) && string(value.today) && string(value.time) && string(value.timeZone)
    && isRecord(value.counts) && number(value.counts.open) && number(value.counts.done)
    && array(value.open, taskView) && array(value.done, taskView) && (value.batch === null || batchView(value.batch))
}
function errorResponse(value: unknown): value is ErrorResponse {
  return isRecord(value) && value.ok === false && string(value.error)
}
function appliedResult(value: unknown): value is ApplyResult {
  return isRecord(value) && batchView(value.batch)
    && array(value.applied, (v): v is ApplyResult['applied'][number] => isRecord(v) && string(v.itemId)
      && nullableString(v.taskId) && optional(v.deduplicated, boolean))
    && array(value.failed, (v): v is ApplyResult['failed'][number] => isRecord(v) && string(v.itemId) && string(v.error))
}
export function parseStateResponse(value: unknown): StateResponse {
  if (errorResponse(value)) throw new Error(value.error)
  if (isRecord(value) && value.ok === true) {
    if (value.unchanged === true && number(value.rev)) return { ok: true, unchanged: true, rev: value.rev }
    if (snapshot(value.state)) return { ok: true, state: value.state }
  }
  throw new Error('invalid state response')
}
export function parseMutationResponse(value: unknown): MutationResponse {
  if (errorResponse(value)) throw new Error(value.error)
  if (isRecord(value) && value.ok === true && snapshot(value.state) && (value.result === null || appliedResult(value.result))) {
    return { ok: true, state: value.state, result: value.result }
  }
  throw new Error('invalid mutation response')
}
