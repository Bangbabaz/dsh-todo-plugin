// Browser checks use the real React components, store and HTTP handlers.
// Install devDependencies and a Playwright Chromium browser before running.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { createStore } from '../dist/store.js'
import { apply } from '../dist/index.js'

const require = createRequire(import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const clientEntry = new URL(manifest.exports['./client'], new URL('../', import.meta.url))
const { build } = require('esbuild')
const { chromium } = require('playwright')
const output = process.env.TODO_UI_OUTPUT_DIR ?? mkdtempSync(join(tmpdir(), 'todo-ui-shots-'))
mkdirSync(output, { recursive: true })
// Opt into the source checkout's real CSS Modules and theme, so the host's
// geometry is the reference rather than a hand-drawn approximation.
const dshSource = process.env.DSH_SOURCE_DIR
const sourcePath = (path) => JSON.stringify(join(dshSource, path).replaceAll('\\', '/'))
const hostEntry = dshSource ? `
import hostLayout from ${sourcePath('packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css')};
import hostChat from ${sourcePath('packages/client/ui-chat/src/client/chat/ChatView.module.css')};
import hostInput from ${sourcePath('packages/client/ui-conversation/src/client/skeleton/InputBar.module.css')};
import hostTodo from ${sourcePath('packages/client/ui-conversation/src/client/skeleton/TodoPanel.module.css')};
import hostButton from ${sourcePath('packages/client/ui-primitives/src/Button.module.css')};
import ${sourcePath('packages/client/ui-theme/src/styles/base.css')};
import ${sourcePath('packages/client/ui-theme/src/styles/design-platform.css')};
import ${sourcePath('packages/client/ui-theme/src/styles/gradient-shadow-text.css')};
import ${sourcePath('packages/client/ui-theme/src/styles/scrollbar.css')};
import ${sourcePath('packages/client/ui-theme/src/styles/corner-shape.css')};
import ${sourcePath('packages/client/ui-theme/src/styles/focus.css')};
document.body.dataset.realHost = '';
document.documentElement.dataset.platform = 'win32';
document.querySelector('.conversation').classList.add(hostLayout.body);
document.querySelector('.messages').classList.add(hostChat.scroll);
document.querySelector('.message').classList.add(hostChat.column);
document.querySelector('.composer').classList.add(hostLayout.composerStack);
document.querySelector('.input-area').classList.add(hostInput.root);
document.querySelector('.input').classList.add(hostInput.card);
document.querySelector('#native-reference').classList.add(hostTodo.root);
document.querySelector('#native-button').classList.add(hostButton.button, hostButton.sm, hostButton.primary);
new ResizeObserver(([entry]) => document.querySelector('.conversation').style.setProperty('--dsh-conversation-column-width', entry.contentRect.width+'px')).observe(document.querySelector('.conversation'));
` : ''
const entry = hostEntry + `
import React from 'react';
import { createRoot } from 'react-dom/client';
const seats = new Map();
window.__openedSessions = [];
window.__ModuleLoader__ = { load({factory}) {
  const plugin = factory((name) => { if (name === 'react') return React; throw new Error(name); });
  const slots = { inject(_seat, factory) { return factory(); }, register(options, component) { seats.set(options.name, component); return () => {}; } };
  plugin.apply({ slots, get(name) {
    if (name === 'locale') return { getLocale: () => ({active: 'zh'}), subscribe: () => () => {} };
    if (name === 'sidebarRightTabs') return { register: () => () => {} };
    if (name === 'uiWorkspace') return { openSession: (id) => { window.__openedSessions.push(id); } };
  }, effect() {} });
} };
const script = document.createElement('script'); script.src = '/client.js';
script.onload = () => {
  const h = React.createElement;
  const Card = seats.get('conversation.input.dock');
  const Panel = seats.get('sidebar.right.pane.tab');
  createRoot(document.getElementById('card')).render(h(Card, {sessionId:'a'}));
  createRoot(document.getElementById('panel')).render(h(Panel, {sessionId:'a'}));
};
document.head.appendChild(script);
`
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js' },
  bundle: true, write: false, outdir: 'fixture', loader: { '.module.css': 'local-css', '.png': 'dataurl' }, format: 'iife', nodePaths: (process.env.NODE_PATH ?? '').split(delimiter).filter(Boolean) })
const bundleJs = bundle.outputFiles.find((file) => file.path.endsWith('.js')).text
const bundleCss = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''
const css = `
:root{font-family:'Segoe UI','Microsoft YaHei',sans-serif;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#f1f3f6;--dsw-alias-label-primary:#242831;--dsw-alias-label-secondary:#69707c;--dsw-alias-border-l1:#dfe2e7;--dsw-alias-button-primary-fill:#475ccc;--dsw-alias-button-primary-hover:#394db8;--dsw-alias-label-primary-foreground:#fff;--dsw-alias-interactive-bg-hover:#eef1f6}
:root.dark{color-scheme:dark;--dsw-alias-bg-base:#202228;--dsw-alias-bg-layer-1:#272a31;--dsw-alias-bg-layer-2:#2e323b;--dsw-alias-label-primary:#e5e7ef;--dsw-alias-label-secondary:#9da3b2;--dsw-alias-border-l1:#3b404c;--dsw-alias-button-primary-fill:#d9def7;--dsw-alias-button-primary-hover:#bbc5f2;--dsw-alias-label-primary-foreground:#202228;--dsw-alias-interactive-bg-hover:#30353e}
*{box-sizing:border-box}body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:100vh}.conversation{padding:30px;display:flex;flex-direction:column;gap:24px;min-width:0}h1{font-size:17px;margin:0}.message{font-size:14px;line-height:1.9;max-width:640px}.composer{margin-top:auto;display:flex;flex-direction:column;gap:10px}.input{border:1px solid var(--dsw-alias-border-l1);padding:18px;border-radius:10px;font-size:13px;color:var(--dsw-alias-label-secondary)}#panel{border-left:1px solid var(--dsw-alias-border-l1);height:100vh;overflow:auto;display:flex;flex-direction:column}body[data-mode=card] .layout{display:block}body[data-mode=card] #panel,body[data-mode=card] .message,body[data-mode=card] h1,body[data-mode=card] .input{display:none}body[data-mode=card] .conversation{padding:8px}body[data-mode=panel] .layout{display:block}body[data-mode=panel] .conversation{display:none}
#native-reference,#native-button{display:none}body[data-real-host]{font-family:var(--dsw-font-family)}body[data-real-host] .conversation{padding:0;gap:0}body[data-real-host] h1{padding:16px 32px;font-size:14px;font-weight:500}body[data-real-host] .message{font:var(--dsw-font-markdown-base)}body[data-real-host] .input{padding:14px;min-height:96px}body[data-real-host][data-mode=card] .messages{display:none}
`

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'todo-ui-'))
  const store = createStore({ dir })
  const target = store.addTask({ title: '回复客户并确认报价', due: '2026-11-20', note: '保留原有报价说明',
    source: { sessionId: 'origin-session', quote: '来源会话中的报价记录' } }).task
  store.addTask({ title: '整理周会纪要', due: '2026-11-08' })
  store.propose('a', { title: '本次会议的待办建议', items: [
    { op: 'update', taskId: target.id, title: '回复客户并发送最终报价', owner: 'self', quote: '我会给客户发最终报价。' },
    { op: 'add', title: '补充首页的移动端设计稿', due: '2026-11-13', note: '包含空状态和加载状态', owner: 'self', quote: '我周五前补一下移动端稿。' },
    { op: 'add', title: '确认首页接口字段', owner: 'other', ownerName: '小王', quote: '小王负责确认接口字段。' },
  ] })
  const routes = new Map()
  const tools = new Map()
  const disposers = []
  const oldDir = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = dir
  try {
    await apply({ get(name) {
      if (name === 'tools') return { register: (definition) => { tools.set(definition.name, definition); return () => {} } }
      if (name === 'webServer') return { register: (route) => { routes.set(route.path, route.handler); return () => {} } }
      if (name === 'connection') return { requestRejection: () => null }
    }, effect(fn) { disposers.push(fn()) } })
  } finally { if (oldDir === undefined) delete process.env.DSH_PROFILE_DIR; else process.env.DSH_PROFILE_DIR = oldDir }
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://local').pathname
    if (routes.has(path)) return routes.get(path)(req, res)
    res.setHeader('content-type', path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8')
    if (path === '/entry.js') return res.end(bundleJs)
    if (path === '/host.css') return res.end(bundleCss)
    if (path === '/client.js') return res.end(readFileSync(clientEntry))
    res.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>Todo UI review</title><style>${css}</style><link rel="stylesheet" href="/host.css"><body><div class="layout"><main class="conversation"><h1>产品方案讨论</h1><div class="messages"><div class="message">帮我整理今天会议里的待办。<br>请保留任务依据，我想先确认需要修改的内容。</div></div><div class="composer"><div id="card"></div><section id="native-reference" aria-hidden="true"></section><button id="native-button" aria-hidden="true">DSH</button><div class="input-area"><div class="input">继续对话，或确认上方的待办建议…</div></div></div></main><aside id="panel"></aside></div><script>const params=new URLSearchParams(location.search);document.body.dataset.mode=params.get('mode')||'';if(params.has('dark')){document.documentElement.classList.add('dark');document.body.setAttribute('data-ds-dark-theme','')}</script><script src="/entry.js"></script></body></html>`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, target, tools,
    async close() { disposers.forEach((fn) => fn?.()); await new Promise((resolve) => server.close(resolve)); rmSync(dir, { recursive: true, force: true }) } }
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.TODO_CHROMIUM_PATH })
const errors = []
async function pageFor(f) {
  const page = await browser.newPage({ viewport: { width: 1220, height: 860 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(f.url)
  await page.getByRole('button', { name: '确认所选 (2)', exact: true }).waitFor()
  return page
}
async function failOnce(page, op) {
  await page.route('**/todo/op', async (route) => {
    if (route.request().postDataJSON().op !== op) return route.continue()
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: '模拟保存失败' }) })
    await page.unroute('**/todo/op')
  })
}

async function checkHostLayout(page) {
  if (!dshSource) return
  for (const [width, preference] of [[1220, null], [1700, null], [760, null], [1440, '540px'], [1440, '980px']]) {
    await page.setViewportSize({ width, height: 860 })
    await page.locator('.conversation').evaluate((el, value) => {
      if (value) el.style.setProperty('--dsh-chat-user-width', value)
      else el.style.removeProperty('--dsh-chat-user-width')
    }, preference)
    await page.waitForTimeout(80)
    const actual = await page.evaluate(() => {
      const reference = document.getElementById('native-reference')
      const button = document.getElementById('native-button')
      reference.style.display = 'block'
      button.style.display = 'inline-flex'
      const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, width: r.width } }
      const style = (selector) => { const s = getComputedStyle(document.querySelector(selector)); return { height: s.height, lineHeight: s.lineHeight, radius: s.borderRadius, color: s.color, background: s.backgroundColor } }
      const result = { card: box('.dshto-card'), native: box('#native-reference'), message: box('.message'), input: box('.input'),
        button: style('.dshto-card-foot .primary'), nativeButton: style('#native-button'),
        cardStyle: style('.dshto-card'), nativeStyle: style('#native-reference') }
      reference.style.display = ''
      button.style.display = ''
      return result
    })
    for (const reference of [actual.native, actual.message]) {
      assert.ok(Math.abs(actual.card.x - reference.x) < 1 && Math.abs(actual.card.width - reference.width) < 1,
        `card alignment at viewport ${width}, preference ${preference}: ${JSON.stringify(actual)}`)
    }
    assert.ok(Math.abs(actual.card.x - actual.input.x - 16) < 1, 'native 16px input-to-dock inset')
    assert.deepEqual(actual.button, actual.nativeButton, 'compact primary button matches DSH primitive')
    assert.equal(actual.cardStyle.radius, actual.nativeStyle.radius)
    assert.equal(actual.cardStyle.background, actual.nativeStyle.background)
  }
  await page.setViewportSize({ width: 1220, height: 860 })
  await page.locator('.conversation').evaluate((el) => el.style.removeProperty('--dsh-chat-user-width'))
  console.log('PASS real DSH source: message/native-card alignment, input inset, width preferences and button/surface styles')
}

try {
  const f = await fixture()
  try {
    const page = await pageFor(f)
    await checkHostLayout(page)
    assert.equal(await page.getByText('所有会话共用一份清单', { exact: true }).count(), 0)
    const addInput = page.getByRole('textbox', { name: '添加一条待办…' })
    await addInput.focus()
    const focus = await addInput.evaluate((input) => {
      const style = getComputedStyle(input)
      const wrapper = getComputedStyle(input.closest('form'))
      return { outline: style.outlineStyle, border: style.borderTopWidth, shadow: style.boxShadow,
        wrapperBorder: wrapper.borderTopStyle, wrapperColor: wrapper.borderTopColor }
    })
    assert.equal(focus.outline, 'none', 'the add wrapper owns the only focus border')
    assert.equal(focus.border, '0px')
    assert.equal(focus.shadow, 'none')
    assert.equal(focus.wrapperBorder, 'solid')
    await page.screenshot({ path: join(output, 'todo-add-focus.png'), fullPage: true })
    const sourceTask = page.locator('#panel .dshto-row').filter({ has: page.getByRole('button', { name: '回复客户并确认报价', exact: true }) })
    await sourceTask.getByRole('button', { name: '来源会话', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.__openedSessions), ['origin-session'])
    assert.equal((await page.locator('#panel').innerText()).includes('origin-session'), false)
    console.log('PASS single add focus border, removed subtitle and source-session navigation')
    await page.screenshot({ path: join(output, 'todo-light.png'), fullPage: true })
    await page.locator('html').evaluate((el) => el.classList.add('dark'))
    await page.locator('body').evaluate((el) => el.setAttribute('data-ds-dark-theme', ''))
    await page.screenshot({ path: join(output, 'todo-dark.png'), fullPage: true })
    await page.locator('html').evaluate((el) => el.classList.remove('dark'))
    await page.locator('body').evaluate((el) => el.removeAttribute('data-ds-dark-theme'))
    await page.locator('.dshto-card-row').first().getByRole('button', { name: '编辑', exact: true }).click()
    const editor = page.locator('.dshto-card .dshto-editor')
    assert.equal(await editor.getByLabel('截止', { exact: true }).inputValue(), '2026-11-20')
    await editor.getByLabel('任务标题').fill('仅编辑候选标题')
    await failOnce(page, 'revise')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor()
    assert.equal(await editor.getByLabel('任务标题').inputValue(), '仅编辑候选标题')
    await page.screenshot({ path: join(output, 'todo-editor.png'), fullPage: true })
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await editor.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '确认所选 (2)', exact: true }).click()
    await page.locator('#panel').getByRole('button', { name: '仅编辑候选标题', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: /撤销/ }).count(), 0)
    assert.equal(f.tools.has('todo_undo'), false)
    assert.equal(await page.locator('.dshto-card-row').count(), 1)
    assert.equal(await page.locator('#panel').getByRole('button', { name: '仅编辑候选标题', exact: true }).count(), 1)
    assert.ok((await page.locator('#panel').innerText()).includes('2026-11-20'))
    const addedTask = page.locator('#panel .dshto-row').filter({ has: page.getByRole('button', { name: '补充首页的移动端设计稿', exact: true }) })
    await addedTask.getByRole('button', { name: '来源会话', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.__openedSessions), ['origin-session', 'a'])
    const beforeUndo = await page.request.get(`${f.url}/todo/state?session=a`)
    const beforeTasks = (await beforeUndo.json()).state.open
    const oldRequest = await page.request.post(`${f.url}/todo/op`, { data: { op: 'undo', session: 'a' } })
    assert.equal(oldRequest.status(), 400)
    const afterUndo = await page.request.get(`${f.url}/todo/state?session=a`)
    assert.deepEqual((await afterUndo.json()).state.open, beforeTasks)
    await failOnce(page, 'add')
    const add = page.getByRole('textbox', { name: '添加一条待办…' })
    await add.fill('失败后保留输入')
    await add.press('Enter')
    await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor()
    assert.equal(await add.inputValue(), '失败后保留输入')
    await add.press('Enter')
    await page.locator('#panel').getByRole('button', { name: '失败后保留输入', exact: true }).waitFor()
    await page.route('**/todo/op', async (route) => {
      if (route.request().postDataJSON().op !== 'add') return route.continue()
      await route.fetch()
      await route.abort('failed')
      await page.unroute('**/todo/op')
    })
    await add.fill('响应丢失后重试')
    await add.press('Enter')
    await page.getByRole('alert').waitFor()
    assert.equal(await add.inputValue(), '响应丢失后重试')
    await add.press('Enter')
    await page.locator('#panel').getByRole('button', { name: '响应丢失后重试', exact: true }).waitFor()
    assert.equal(await page.locator('#panel').getByRole('button', { name: '响应丢失后重试', exact: true }).count(), 1)
    await page.locator('#panel').getByRole('button', { name: '仅编辑候选标题', exact: true }).click()
    const taskEditor = page.locator('#panel .dshto-editor')
    await taskEditor.getByLabel('说明', { exact: true }).fill('失败后保留编辑说明')
    await failOnce(page, 'update')
    await taskEditor.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor()
    assert.equal(await taskEditor.getByLabel('说明', { exact: true }).inputValue(), '失败后保留编辑说明')
    await taskEditor.getByRole('button', { name: '保存', exact: true }).click()
    await taskEditor.waitFor({ state: 'detached' })
    console.log('PASS candidate/date edit, failed saves, source, manual add/edit and removed undo API/UI')
    await page.close()
  } finally { await f.close() }

  const f2 = await fixture()
  try {
    const page = await pageFor(f2)
    await f2.tools.get('todo_direct').execute({ ops: [{ op: 'update', taskId: f2.target.id, title: '其他会话的新标题' }] }, { agent: { id: 'b' } })
    await page.getByRole('button', { name: '确认所选 (2)', exact: true }).click()
    const refresh = page.getByRole('button', { name: '读取最新内容，重新确认', exact: true })
    await refresh.waitFor()
    await refresh.click()
    await refresh.waitFor({ state: 'detached' })
    const first = page.locator('.dshto-card-row').first()
    assert.equal(await first.getByRole('checkbox').isChecked(), false)
    assert.ok((await first.innerText()).includes('其他会话的新标题'))
    await first.getByRole('checkbox').click()
    await page.getByRole('button', { name: '确认所选 (1)', exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: '确认所选 (1)', exact: true }).click()
    await page.locator('#panel').getByRole('button', { name: '回复客户并发送最终报价', exact: true }).waitFor()
    console.log('PASS conflict stays visible, refresh is unselected, explicit reconfirmation succeeds')
    await page.close()
    const narrow = await browser.newPage({ viewport: { width: 360, height: 760 } })
    narrow.on('pageerror', (error) => errors.push(error.message))
    await narrow.goto(`${f2.url}/?mode=card`)
    await narrow.locator('.dshto-card').waitFor()
    await narrow.screenshot({ path: join(output, 'todo-narrow-card.png'), fullPage: true })
    assert.ok(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await narrow.goto(`${f2.url}/?mode=panel&dark`)
    await narrow.locator('.dshto-add').waitFor()
    await narrow.screenshot({ path: join(output, 'todo-narrow-panel.png'), fullPage: true })
    assert.ok(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await narrow.close()
    console.log('PASS light/dark and narrow layouts without page overflow')
    await f2.tools.get('todo_direct').execute({ ops: [
      { op: 'update', taskId: f2.target.id, title: '直接执行的第一项' },
      { op: 'update', taskId: f2.target.id, title: '直接执行的第二项' },
    ] }, { agent: { id: 'a' } })
    const direct = await browser.newPage()
    await direct.goto(f2.url)
    await direct.getByText('这几项未能执行，请检查后重试', { exact: true }).waitFor()
    assert.equal(await direct.locator('.dshto-card').count(), 0)
    await direct.getByRole('button', { name: '读取最新内容，重新确认', exact: true }).click()
    await direct.getByRole('button', { name: '确认这项修改', exact: true }).click()
    await direct.locator('#panel').getByRole('button', { name: '直接执行的第二项', exact: true }).waitFor()
    await direct.close()
    console.log('PASS direct failures stay in the sidebar without a composer card')
  } finally { await f2.close() }
  assert.deepEqual(errors, [], 'browser runtime errors')
  console.log(`Screenshots: ${resolve(output)}`)
} finally { await browser.close() }
