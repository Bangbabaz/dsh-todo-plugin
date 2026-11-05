/** These mistakes must remain compile errors at the public API boundary. */
import type { BrowserOperation, CandidateInput, TodoStore } from '../src/types.js'
import type { ToolRegistry } from '../src/contracts.js'

export function checkContracts(store: TodoStore, tools: ToolRegistry): void {
  store.addTask({ title: 'Typed task', due: null, owner: 'self' })
  store.updateTask('task', { note: null })
  // @ts-expect-error Only open and done are valid statuses.
  store.setTaskStatus('task', 'deleted')
  // @ts-expect-error A partial update cannot replace a title with null.
  store.updateTask('task', { title: null })
  const candidate: CandidateInput = { op: 'update', taskId: 'task', title: 'Updated' }
  store.propose('session', { items: [candidate] })
  // @ts-expect-error A non-add candidate must identify its target.
  const missingTarget: CandidateInput = { op: 'delete' }
  // @ts-expect-error An add candidate must have a title.
  const missingTitle: CandidateInput = { op: 'add' }
  // @ts-expect-error Selection changes use boolean values.
  const badSelection: BrowserOperation = { op: 'revise', session: 's', batchId: 'b', changes: [{ itemId: 'i', selected: 'yes' }] }
  tools.register({
    name: 'todo_list', description: '', parameters: {},
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: value.tasks[0]?.title ?? '' }] },
    async execute(args, exec) {
      // @ts-expect-error This argument belongs to another tool.
      args.itemIds
      return store.read(exec.agent?.id ?? null, args)
    },
  })
  void [missingTarget, missingTitle, badSelection]
}
