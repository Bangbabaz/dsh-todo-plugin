import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const staging = mkdtempSync(join(root, '.dsh-todo-build-'))
try {
  const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.json'), '--outDir', staging], { stdio: 'inherit', cwd: root })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`TypeScript failed (${result.status})`)

// DSH consumes a self-registering browser script, not an ESM entry. Type-only
// imports and the empty ESM export emitted by tsc must not leak into that script.
  await build({ absWorkingDir: root, entryPoints: ['src/client.ts'], outfile: join(staging, 'client.js'),
    bundle: true, platform: 'browser', format: 'iife', target: 'es2022', sourcemap: 'linked' })
  // Publish only after both compilers pass; HMR never sees tsc's ESM client.
  const dist = join(root, 'dist')
  mkdirSync(dist, { recursive: true })
  for (const name of readdirSync(staging)) {
    const target = join(dist, name)
    writeFileSync(`${target}.tmp`, readFileSync(join(staging, name)))
    renameSync(`${target}.tmp`, target)
  }
} finally {
  rmSync(staging, { recursive: true, force: true })
}
