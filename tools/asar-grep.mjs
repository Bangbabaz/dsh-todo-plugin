/**
 * Extract one file out of an Electron asar archive and grep it.
 * Usage: node tools/asar-grep.mjs <asar> <pathPrefix> <regex> [maxHits]
 */
import { openSync, readSync, closeSync, statSync } from 'node:fs'

const [archive, prefix, pattern, maxHitsRaw] = process.argv.slice(2)
if (archive === undefined || prefix === undefined || pattern === undefined) {
  console.error('usage: node tools/asar-grep.mjs <asar> <pathPrefix> <regex> [maxHits]')
  process.exit(2)
}
const maxHits = Number(maxHitsRaw ?? '40')

const fd = openSync(archive, 'r')
try {
  const size = statSync(archive).size
  // asar: [0..7] pickle header for the size field, [8..8+payload) pickle holding the JSON string.
  const head = Buffer.alloc(8)
  readSync(fd, head, 0, 8, 0)
  const payloadSize = head.readUInt32LE(4)
  const payload = Buffer.alloc(payloadSize)
  readSync(fd, payload, 0, payloadSize, 8)
  const jsonLength = payload.readUInt32LE(4)
  const header = JSON.parse(payload.subarray(8, 8 + jsonLength).toString('utf8'))
  const dataStart = 8 + payloadSize

  const links = []
  const walk = (node, path) => {
    if (node === null || typeof node !== 'object') return
    if (node.files !== undefined) {
      for (const [name, child] of Object.entries(node.files)) walk(child, path === '' ? name : `${path}/${name}`)
      return
    }
    if (typeof node.offset === 'string' || typeof node.offset === 'number' || node.unpacked === true) {
      links.push({ path, node })
    }
  }
  walk(header, '')

  const matches = links.filter((entry) => entry.path.startsWith(prefix))
  console.log(`matched ${matches.length} file(s) under ${prefix}`)
  for (const entry of matches) {
    console.log(`  ${entry.path}  size=${entry.node.size ?? '?'} unpacked=${String(entry.node.unpacked ?? false)}`)
  }

  const re = new RegExp(pattern, 'giu')
  let hits = 0
  for (const entry of matches) {
    if (entry.node.unpacked === true) continue
    const bytes = entry.node.size ?? 0
    if (bytes === 0 || bytes > 40 * 1024 * 1024) continue
    const body = Buffer.alloc(bytes)
    readSync(fd, body, 0, bytes, dataStart + Number(entry.node.offset))
    const text = body.toString('utf8')
    for (const match of text.matchAll(re)) {
      hits += 1
      const from = Math.max(0, (match.index ?? 0) - 220)
      const to = Math.min(text.length, (match.index ?? 0) + 260)
      console.log(`\n--- ${entry.path} @${match.index} ---`)
      console.log(text.slice(from, to).replace(/\s+/gu, ' '))
      if (hits >= maxHits) {
        console.log('\n(hit cap reached)')
        process.exit(0)
      }
    }
  }
  console.log(`\ntotal hits: ${hits}`)
} finally {
  closeSync(fd)
}
