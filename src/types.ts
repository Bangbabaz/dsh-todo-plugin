/** Shared persistence, service and browser contracts. No host-only imports. */
export type TaskStatus = 'open' | 'done'
export type Owner = 'self' | 'other' | 'unknown'
export type Operation = 'add' | 'update' | 'complete' | 'reopen' | 'delete'
/** `undone` is read-only compatibility with existing records. */
export type ItemState = 'pending' | 'applied' | 'failed' | 'ignored' | 'undone'
export type BatchState = 'draft' | 'applied' | 'discarded' | 'undone'
export type BatchKind = 'propose' | 'direct'
export type Scope = 'open' | 'done' | 'all'

export interface TaskSource {
  sessionId: string
  quote: string | null
  messageSeq?: number
  materialTitle?: string
}

export interface TaskFields {
  title: string
  /** ISO calendar date, YYYY-MM-DD, or no deadline. */
  due: string | null
  note: string | null
  owner: Owner
  ownerName: string | null
}
export type TaskPatch = Partial<TaskFields>
/** A normalized proposal may contain an empty title, rejected for additions. */
export type TaskChange = Omit<TaskPatch, 'title'> & { title?: string | null; status?: TaskStatus }
export interface Task extends TaskFields {
  id: string
  status: TaskStatus
  source: TaskSource | null
  candidateId: string | null
  version: number
  createdAt: number
  updatedAt: number
  completedAt: number | null
}
export type TaskView = Omit<Task, 'candidateId'>
export type TaskBefore = TaskFields & Pick<Task, 'status'> & Partial<Omit<Task, keyof TaskFields | 'status'>>
export type TaskInput = TaskPatch & { source?: TaskSource | null; candidateId?: string | null }

interface CandidateFields extends TaskPatch {
  itemId?: string
  quote?: string | null
  dupOf?: string | null
}
export type CandidateInput = CandidateFields & (
  | { op: 'add'; title: string; taskId?: never }
  | { op: Exclude<Operation, 'add'>; taskId: string }
)
export interface ProposalInput {
  title?: string | null
  items?: CandidateInput[]
  mode?: 'new' | 'update'
  kind?: BatchKind
}
export interface Item {
  itemId: string
  batchId: string
  order: number
  op: Operation
  targetTaskId: string | null
  before: TaskBefore | null
  after: TaskChange | null
  quote: string | null
  dupOf: string | null
  selected: boolean
  state: ItemState
  error: string | null
  expectedVersion: number | null
  resultTaskId: string | null
  resultVersion: number | null
  appliedAt: number | null
}
export interface Batch {
  id: string
  sessionId: string
  kind?: BatchKind
  title: string
  state: BatchState
  version: number
  createdAt: number
  updatedAt: number
  appliedAt: number | null
  dismissedAt: number | null
}
export type ItemView = Pick<Item, 'itemId' | 'op' | 'selected' | 'state' | 'error' | 'targetTaskId' | 'before' | 'after' | 'quote' | 'dupOf' | 'resultTaskId'> & { title: string }
export interface BatchView {
  id: string
  kind: BatchKind
  title: string
  state: BatchState
  createdAt: number
  appliedAt: number | null
  counts: Record<Operation, number>
  items: ItemView[]
}
export interface PersistedState {
  version: number
  rev: number
  tasks: Record<string, Task>
  batches: Record<string, Batch>
  items: Record<string, Item>
  idem: Record<string, { taskId: string; at: number }>
}
export interface LocalClock { today: string; time: string; timeZone: string }
export interface TaskCounts { open: number; done: number }
export interface Snapshot extends LocalClock {
  rev: number
  counts: TaskCounts
  open: TaskView[]
  done: TaskView[]
  batch: BatchView | null
}
export interface ReadResult extends LocalClock {
  counts: TaskCounts
  tasks: TaskView[]
  batch: BatchView | null
}
export interface ReviseChange {
  itemId: string
  selected?: boolean
  refresh?: boolean
  after?: TaskPatch | null
}
export interface BatchResult { batch: BatchView }
export interface ApplyResult extends BatchResult {
  applied: { itemId: string; taskId: string | null; deduplicated?: boolean }[]
  failed: { itemId: string; error: string }[]
}
export interface TodoStore {
  readonly rev: number
  snapshot(sessionId: string | null): Snapshot
  read(sessionId: string | null, options?: { scope?: Scope; query?: string | null }): ReadResult
  addTask(input: TaskInput, requestId?: string | null): { task: TaskView; deduplicated: boolean }
  updateTask(id: string, patch: TaskPatch): { task: TaskView }
  setTaskStatus(id: string, status: TaskStatus): { task: TaskView }
  deleteTask(id: string): { deleted: string }
  propose(sessionId: string, input?: ProposalInput): BatchResult
  revise(sessionId: string, batchId: string, changes: ReviseChange[]): BatchResult
  requireBatch(batchId: string, sessionId: string | null): Batch
  resolveBatch(sessionId: string, batchId?: string | null): Batch
  executeItem(item: Item, now: number): string
  apply(sessionId: string, batchId?: string | null, itemIds?: string[] | null): ApplyResult
  discard(sessionId: string, batchId?: string | null, itemIds?: string[] | null): BatchResult
  dismiss(sessionId: string, batchId: string): { dismissed: string }
  direct(sessionId: string, ops: CandidateInput[]): ApplyResult
}

export type TodoOperation =
  | ({ op: 'add'; title: string; requestId?: string } & TaskPatch)
  | ({ op: 'update'; taskId: string } & TaskPatch)
  | { op: 'toggle'; taskId: string; status: TaskStatus }
  | { op: 'delete'; taskId: string }
  | { op: 'revise'; batchId: string; changes: ReviseChange[] }
  | { op: 'apply' | 'discard'; batchId?: string | null; itemIds?: string[] | null }
  | { op: 'dismiss'; batchId: string }
export type BrowserOperation = TodoOperation & { session: string }
export interface MutationResponse { ok: true; state: Snapshot; result: ApplyResult | null }
export type StateResponse = { ok: true; state: Snapshot } | { ok: true; unchanged: true; rev: number }
export interface ErrorResponse { ok: false; error: string }

/** The direct tool's schema exposes no proposal metadata or owner selector. */
export type DirectInput = Pick<TaskPatch, 'title' | 'due' | 'note' | 'ownerName'> & { quote?: string | null } & (
  | { op: 'add'; title: string }
  | { op: Exclude<Operation, 'add'>; taskId: string }
)
export interface ToolContracts {
  todo_list: { args: { scope?: Scope; query?: string }; result: ReadResult }
  todo_propose: { args: { title?: string; mode?: 'new' | 'update'; items: (CandidateInput & { owner: Owner })[] }; result: BatchResult }
  todo_apply: { args: { batchId?: string; itemIds?: string[] }; result: ApplyResult }
  todo_discard: { args: { batchId?: string; itemIds?: string[] }; result: BatchResult }
  todo_direct: { args: { ops: DirectInput[] }; result: ApplyResult }
}
