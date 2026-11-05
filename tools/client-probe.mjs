/**
 * Pre-flight the browser half without a browser: run the module factory and
 * apply() against stubs, then print every seat it registered.
 * Usage: node tools/client-probe.mjs
 */
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

const packageRoot = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'))
const code = readFileSync(new URL(manifest.exports['./client'], packageRoot), 'utf8')
const calls = []
let plugin = null

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (initial) => ({ current: initial }),
}

const requireShim = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected module request: ${name}`)
}

const window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      calls.push(`materialize:${id}`)
      plugin = factory(requireShim)
    },
  },
}

const document = {
  documentElement: { getAttribute: () => 'pointer' },
  querySelectorAll: () => [],
}

const slots = {
  inject(slot, factory) {
    const dispose = factory()
    calls.push(`inject:${slot}`)
    return typeof dispose === 'function' ? dispose : () => {}
  },
  register(options, component) {
    calls.push(`seat:${options.name}#${options.id ?? options.key}${component === undefined ? ' (no component)' : ''}`)
    return () => {}
  },
}

const ctx = {
  slots,
  get(name) {
    if (name === 'locale') return { getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} }
    if (name === 'sidebarRightTabs') {
      return { register: (definition) => { calls.push(`tabtype:${definition.id}/${definition.kind}`); return () => {} } }
    }
    if (name === 'sidebarRight') return { isExpanded: () => false, toggleExpanded: () => {}, openTab: () => {} }
    return undefined
  },
  effect(fn) { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
}

const sandbox = { window, document, navigator: { language: 'zh-CN' }, console, fetch: () => Promise.reject(new Error('offline')) }
createContext(sandbox)

try {
  runInContext(code, sandbox)
  if (plugin === null) throw new Error('the module never registered a factory')
  console.log(`exports: ${Object.keys(plugin).join(',')}`)
  plugin.apply(ctx)
  console.log(calls.join('\n'))
  const seats = calls.filter((line) => line.startsWith('seat:')).length
  console.log(`\nseats registered: ${seats}`)
  if (seats < 3) { console.error('expected at least 3 seats'); process.exitCode = 1 }
} catch (error) {
  console.error('PROBE FAILED:', error && error.stack ? error.stack.split('\n').slice(0, 8).join('\n') : String(error))
  process.exitCode = 1
}
