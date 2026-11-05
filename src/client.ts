import type { ButtonHTMLAttributes, ChangeEvent, FormEvent, ReactElement, Dispatch, SetStateAction } from 'react'
import type { ClientContext, ClientServices, Dispose, LocaleService, SessionProps } from './contracts.js'
import type { Snapshot, BrowserOperation, TodoOperation, MutationResponse, TaskView, TaskSource, TaskFields, TaskChange, TaskPatch, ItemView, Owner } from './types.js'
import { isOwner, parseStateResponse, parseMutationResponse } from './validation.js'

type GlyphName = 'edit' | 'refresh' | 'close' | 'plus' | 'open'
interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'name'> { name: GlyphName; label: string }
interface Hub {
  get(sessionId: string): Snapshot | null
  subscribe(listener: () => void): Dispose
  retain(sessionId: string): void
  release(sessionId: string): void
  post(payload: BrowserOperation): Promise<MutationResponse>
  refresh(sessionId: string): Promise<void>
  dispose(): void
}
interface EditorProps {
  initial: TaskChange
  busy: boolean
  onSave(patch: TaskPatch): Promise<boolean>
  onCancel(): void
  onDelete?(): Promise<void>
}
interface EditValues { title: string; due: string; note: string; owner: Owner; ownerName: string }

/**
 * DSH personal todo plugin — browser half.
 *
 * Three seats: a right-sidebar tab with the list, a header button that opens
 * it, and one batch card above the composer that exists only while a batch is
 * live. All of them read and write through the Host routes.
 */
window.__ModuleLoader__.load({
  id: '@bangbabaz/dsh-todo-plugin',
  factory(require) {
    const warn = (what: string, detail?: unknown) => {
      try { console.warn(`[dsh-todo] ${what}`, detail) } catch { /* no console */ }
    }
    // HMR swaps the module but leaves earlier <style> tags in place; a stale copy
    // would keep winning on equal specificity, so drop ours before re-rendering.
    try {
      for (const stale of document.querySelectorAll('style[data-dsh-todo]')) stale.remove()
    } catch { /* no document */ }
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    const TAB_ID = 'dsh-todo/panel'
    const TAB_KIND = 'todo'

    // ── copy ───────────────────────────────────────────────────────────────
    const ZH = {
      'panel.title': '我的待办',
      'panel.guide': '会话里的待办清单，和聊天同时可见',
      'panel.empty': '还没有待办。直接在对话里说「帮我整理成待办」，或在这里添加一条。',
      'panel.addPlaceholder': '添加一条待办…',
      'panel.add': '添加',
      'panel.done': '已完成',
      'panel.open': '未完成',
      'panel.taskTitle': '任务标题',
      'panel.owner': '归属',
      'panel.saving': '保存中…',
      'panel.refresh': '刷新清单',
      'panel.sourceSession': '来源会话',
      'panel.openSourceSession': '打开来源会话',
      'panel.sourceUnavailable': '来源会话暂时无法打开',
      'panel.completeTask': '完成：{title}',
      'panel.reopenTask': '恢复为未完成：{title}',
      'panel.pendingShort': '{n} 项待确认',
      'panel.viewBatch': '查看建议',
      'panel.directFailure': '这几项未能执行，请检查后重试',
      'panel.confirmOne': '确认这项修改',
      'panel.pendingBatch': '本次整理还有 {n} 项待确认，在输入框上方的卡片里处理。',
      'panel.loading': '加载中…',
      'panel.failed': '加载失败：{error}',
      'panel.retry': '重试',
      'panel.due': '截止',
      'panel.note': '说明',
      'panel.save': '保存',
      'panel.cancel': '取消',
      'panel.delete': '删除',
      'panel.edit': '编辑',
      'owner.self': '我',
      'owner.other': '他人',
      'owner.unknown': '归属待定',
      'owner.name': '负责人',
      'card.title': '本次待办整理',
      'card.pickAll': '全选',
      'card.confirm': '确认所选',
      'card.dismiss': '取消',
      'card.close': '关闭',
      'card.result': '执行结果',
      'card.quote': '依据',
      'card.applied': '已执行',
      'card.failed': '失败',
      'card.ignored': '已忽略',
      'card.undone': '已撤销',
      'card.pending': '待确认',
      'card.conflict': '冲突',
      'card.clearAll': '取消全选',
      'card.ignoreItem': '忽略这条建议',
      'card.ignoreRest': '忽略剩余',
      'card.refreshConflict': '读取最新内容，重新确认',
      'card.selectItem': '选择：{title}',
      'card.processed': '已处理 {n} 项',
      'op.add': '新增',
      'op.update': '修改',
      'op.complete': '完成',
      'op.reopen': '恢复',
      'op.delete': '删除',
    }
    type LocaleKey = keyof typeof ZH
    const EN: Record<LocaleKey, string> = {
      'panel.title': 'My todos',
      'panel.guide': 'Your todo list beside the conversation',
      'panel.empty': 'Nothing yet. Ask in the chat, or add one here.',
      'panel.addPlaceholder': 'Add a todo…',
      'panel.add': 'Add',
      'panel.done': 'Completed',
      'panel.open': 'Open',
      'panel.taskTitle': 'Task title',
      'panel.owner': 'Owner',
      'panel.saving': 'Saving…',
      'panel.refresh': 'Refresh list',
      'panel.sourceSession': 'Source conversation',
      'panel.openSourceSession': 'Open source conversation',
      'panel.sourceUnavailable': 'The source conversation could not be opened',
      'panel.completeTask': 'Complete: {title}',
      'panel.reopenTask': 'Reopen: {title}',
      'panel.pendingShort': '{n} item(s) to review',
      'panel.viewBatch': 'Review suggestions',
      'panel.directFailure': 'These changes need your review before retrying',
      'panel.confirmOne': 'Confirm this change',
      'panel.pendingBatch': '{n} item(s) from this batch still need a decision — use the card above the composer.',
      'panel.loading': 'Loading…',
      'panel.failed': 'Failed to load: {error}',
      'panel.retry': 'Retry',
      'panel.due': 'Due',
      'panel.note': 'Note',
      'panel.save': 'Save',
      'panel.cancel': 'Cancel',
      'panel.delete': 'Delete',
      'panel.edit': 'Edit',
      'owner.self': 'Mine',
      'owner.other': 'Someone else',
      'owner.unknown': 'Owner unclear',
      'owner.name': 'Owner name',
      'card.title': 'Todo batch',
      'card.pickAll': 'Select all',
      'card.confirm': 'Confirm selected',
      'card.dismiss': 'Cancel',
      'card.close': 'Close',
      'card.result': 'Result',
      'card.quote': 'Source',
      'card.applied': 'Done',
      'card.failed': 'Failed',
      'card.ignored': 'Ignored',
      'card.undone': 'Undone',
      'card.pending': 'Pending',
      'card.conflict': 'Conflict',
      'card.clearAll': 'Clear selection',
      'card.ignoreItem': 'Ignore this suggestion',
      'card.ignoreRest': 'Ignore remaining',
      'card.refreshConflict': 'Load current task and review again',
      'card.selectItem': 'Select: {title}',
      'card.processed': '{n} processed item(s)',
      'op.add': 'Add',
      'op.update': 'Update',
      'op.complete': 'Complete',
      'op.reopen': 'Reopen',
      'op.delete': 'Delete',
    }

    let activeLocale = 'zh'

    function translate(key: LocaleKey, vars?: Record<string, unknown>) {
      const dict = activeLocale === 'en' ? EN : ZH
      let out = dict[key] ?? ZH[key] ?? key
      if (vars !== undefined) {
        for (const [name, value] of Object.entries(vars)) out = out.replace(`{${name}}`, String(value))
      }
      return out
    }

    // ── data hub ───────────────────────────────────────────────────────────

    function createHub(): Hub {
      const cache = new Map<string, Snapshot>()
      const listeners = new Set<() => void>()
      const retained = new Map<string, number>()
      let timer: ReturnType<typeof setInterval> | null = null

      const notify = () => { for (const listener of [...listeners]) listener() }

      async function fetchOne(sessionId: string, force: boolean) {
        const current = cache.get(sessionId)
        const rev = force === true || current === undefined ? 'nan' : String(current.rev)
        const response = await fetch(`/todo/state?session=${encodeURIComponent(sessionId)}&rev=${rev}`, {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = parseStateResponse(await response.json())
        if ('unchanged' in body) return
        if (body.state !== undefined && (cache.get(sessionId)?.rev ?? -1) <= body.state.rev) {
          cache.set(sessionId, body.state)
          notify()
        }
      }

      function ensurePolling() {
        if (timer !== null || retained.size === 0) return
        timer = setInterval(() => {
          for (const sessionId of retained.keys()) {
            fetchOne(sessionId, false).catch(() => { /* transient */ })
          }
        }, 1500)
      }

      function stopPolling() {
        if (timer === null) return
        clearInterval(timer)
        timer = null
      }

      return {
        get(sessionId) { return cache.get(sessionId) ?? null },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        retain(sessionId) {
          retained.set(sessionId, (retained.get(sessionId) ?? 0) + 1)
          ensurePolling()
          fetchOne(sessionId, true).catch(() => { /* surfaced by the component */ })
        },
        release(sessionId) {
          const count = (retained.get(sessionId) ?? 1) - 1
          if (count <= 0) retained.delete(sessionId)
          else retained.set(sessionId, count)
          if (retained.size === 0) stopPolling()
        },
        async post(payload) {
          const response = await fetch('/todo/op', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload),
          })
          const body = parseMutationResponse(await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` })))
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          if (body.state !== undefined && typeof payload.session === 'string') {
            if ((cache.get(payload.session)?.rev ?? -1) <= body.state.rev) {
              cache.set(payload.session, body.state)
              notify()
            }
          }
          return body
        },
        async refresh(sessionId) {
          await fetchOne(sessionId, true)
        },
        dispose() {
          retained.clear()
          listeners.clear()
          stopPolling()
        },
      }
    }

    // ── hooks ──────────────────────────────────────────────────────────────
    function useSnapshot(hub: Hub | null, sessionId: string): readonly [Snapshot | null, string | null, Dispatch<SetStateAction<string | null>>] {
      const [value, setValue] = useState(() => ({ sessionId,
        snapshot: hub === null || typeof sessionId !== 'string' ? null : hub.get(sessionId) }))
      const [error, setError] = useState<string | null>(null)
      useEffect(() => {
        if (hub === null || typeof sessionId !== 'string' || sessionId.length === 0) return undefined
        const sync = () => {
          setValue({ sessionId, snapshot: hub.get(sessionId) })
          if (hub.get(sessionId) !== null) setError(null)
        }
        sync()
        const off = hub.subscribe(sync)
        hub.retain(sessionId)
        const timer = setTimeout(() => {
          if (hub.get(sessionId) === null) setError('timeout')
        }, 8000)
        return () => {
          clearTimeout(timer)
          off()
          hub.release(sessionId)
        }
      }, [hub, sessionId])
      return [value.sessionId === sessionId ? value.snapshot : hub?.get(sessionId) ?? null, error, setError]
    }

    function readActiveLocale(locale: LocaleService | undefined) {
      try {
        const snapshot = locale?.getLocale?.()
        return typeof snapshot?.active === 'string' ? snapshot.active : undefined
      } catch { return undefined }
    }

    /** Prefer the host locale; fall back to the browser language, then Chinese. */
    function detectLocale(preferred: string | undefined) {
      if (typeof preferred === 'string' && preferred.length > 0) {
        return preferred.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      }
      try {
        const tag = (navigator.languages && navigator.languages[0]) || navigator.language || ''
        if (typeof tag === 'string' && tag.length > 0) {
          return tag.toLowerCase().startsWith('zh') ? 'zh' : 'en'
        }
      } catch { /* no navigator */ }
      return 'zh'
    }

    function useLanguage() {
      // The locale service may not exist when apply() runs, so resolve it here too.
      const locale = localeService ?? pick(pluginContext, 'locale')
      if (locale !== undefined) localeService = locale
      const [lang, setLang] = useState(activeLocale)
      useEffect(() => {
        if (locale === undefined || typeof locale.getLocale !== 'function') return undefined
        const read = () => {
          activeLocale = detectLocale(readActiveLocale(locale))
          setLang(activeLocale)
        }
        read()
        if (typeof locale.subscribe === 'function') return locale.subscribe(read)
        return undefined
      }, [locale])
      return lang
    }

    // ── shared controls and layout ─────────────────────────────────────────
    const CSS = `
.dshto-root,.dshto-card{--todo-line:var(--dsw-alias-border-l1,#dfe2e7);--todo-muted:var(--dsw-alias-label-secondary,#69707c);--todo-bg:var(--dsw-alias-bg-base,#fff);--todo-layer:var(--dsw-alias-bg-layer-1,#f7f8fa);box-sizing:border-box;color:var(--dsw-alias-label-primary,#242831);font-family:var(--dsw-font-family,inherit);font-size:13px;font-weight:400;line-height:20px;min-width:0}
.dshto-root *,.dshto-card *{box-sizing:border-box}
.dshto-panel{display:flex;flex-direction:column;gap:16px;padding:16px;min-height:0;overflow:auto;flex:1;container-type:inline-size}
.dshto-head,.dshto-toolbar,.dshto-inline,.dshto-add,.dshto-meta,.dshto-card-foot{display:flex;align-items:center;gap:8px;min-width:0}
.dshto-head-title{font-size:14px;font-weight:500;line-height:22px}
.dshto-count{font-size:12px;font-weight:400;color:var(--todo-muted)}
.dshto-subtitle,.dshto-hint{font-size:12px;color:var(--todo-muted);margin-top:3px;overflow-wrap:anywhere}
.dshto-spacer{flex:1}
.dshto-list{display:flex;flex-direction:column;gap:3px}
.dshto-row{display:flex;gap:10px;align-items:flex-start;padding:10px 8px;border-radius:var(--dsw-radius-sm,8px);min-width:0}
.dshto-row:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f3f6)}
.dshto-check{width:16px;height:16px;margin:3px 0 0;flex:none;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,var(--dsw-alias-button-primary-fill))}
.dshto-body{flex:1;min-width:0}
.dshto-title{overflow-wrap:anywhere;font-size:13px;font-weight:500;line-height:1.6}
button.dshto-title{display:block;border:0;padding:0;width:100%;font:inherit;text-align:left;background:none;color:inherit;cursor:pointer}
.dshto-title.is-done{text-decoration:line-through;color:var(--todo-muted)}
.dshto-meta{flex-wrap:wrap;gap:4px 8px;font-size:11px;color:var(--todo-muted);margin-top:4px}
.dshto-note{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:var(--todo-muted);margin-top:4px}
.dshto-chip{display:inline-flex;align-items:center;font-size:11px;border-radius:var(--dsw-radius-xs,4px);padding:1px 6px;line-height:18px;background:var(--todo-layer);color:var(--todo-muted);overflow-wrap:anywhere}
.dshto-chip.warn,.dshto-overdue{color:var(--dsw-alias-state-warn-primary,#9b6614)}
.dshto-chip.err,.dshto-error{color:var(--dsw-alias-state-error-primary,#bc3b45)}
.dshto-chip.ok{color:var(--dsw-alias-state-success-primary,#34735d)}
.dshto-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm,8px);font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);background:transparent;cursor:pointer;flex:none}
@media (hover:hover){.dshto-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}}
.dshto-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.dshto-btn.primary{background:var(--dsw-alias-button-primary-fill,#445bca);color:var(--dsw-alias-label-primary-foreground,#fff)}
.dshto-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#384fb5)}
.dshto-btn.secondary{border:.5px solid transparent;background:transparent;box-shadow:inset 0 0 0 var(--dsh-hairline-width,.5px) var(--dsw-alias-border-l3,var(--todo-line))}
.dshto-btn.danger{color:var(--dsw-alias-state-error-primary,#bc3b45)}
.dshto-btn.icon{width:28px;padding:0;color:var(--todo-muted)}
.dshto-btn:disabled{opacity:.4;cursor:not-allowed}
.dshto-actions{display:flex;align-items:center;gap:2px;flex:none}
@media (hover:hover) and (pointer:fine){
  .dshto-row-edit{opacity:0;pointer-events:none;transition:opacity .12s}
  .dshto-row:hover>.dshto-row-edit,.dshto-row:focus-within>.dshto-row-edit{opacity:1;pointer-events:auto}
}
.dshto-field{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:11px;font-weight:500;color:var(--todo-muted)}
.dshto-input,.dshto-textarea{width:100%;min-width:0;min-height:32px;border:.5px solid var(--dsw-alias-border-l4,var(--todo-line));border-radius:var(--dsw-radius-md,12px);padding:6px 8px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary,#242831);background:var(--dsw-alias-bg-layer-1)}
.dshto-textarea{resize:vertical;line-height:1.6}
.dshto-input:focus,.dshto-textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
.dshto-input::placeholder,.dshto-textarea::placeholder{color:var(--dsw-alias-label-dimmed)}
.dshto-add{padding:4px 4px 4px 8px;border:.5px solid var(--dsw-alias-border-l4,var(--todo-line));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1)}
/* The wrapper owns focus feedback, as in the host Input primitive. */
.dshto-add .dshto-input{border:0;outline:none;box-shadow:none;border-radius:0;background:transparent;padding:4px 0;flex:1;width:auto}
.dshto-add:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.dshto-editor{display:flex;flex-direction:column;gap:10px;padding:12px;border:.5px solid var(--todo-line);border-radius:var(--dsw-radius-md,12px);background:var(--todo-layer);width:100%;min-width:0}
.dshto-editor-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}
.dshto-editor-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}
.dshto-section{display:flex;align-items:center;gap:8px;width:100%;border:0;border-top:1px solid var(--todo-line);padding:12px 0 0;font:inherit;font-size:12px;color:var(--todo-muted);background:none;cursor:pointer;text-align:left}
.dshto-empty{padding:24px 12px;text-align:center;color:var(--todo-muted);font-size:12px;line-height:1.8;border:1px dashed var(--todo-line);border-radius:var(--dsw-radius-md,12px)}
.dshto-error{font-size:12px;line-height:1.6;overflow-wrap:anywhere}
.dshto-pending{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:var(--dsw-radius-sm,8px);background:var(--todo-layer);font-size:12px;color:var(--todo-muted)}
.dshto-pending{width:100%;border:1px solid var(--todo-line);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.dshto-source{margin-top:7px;font-size:12px;color:var(--todo-muted)}
.dshto-source-link{display:inline-flex;align-items:center;gap:4px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,var(--todo-muted));font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dshto-source-link:hover{color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-offset:3px}
.dshto-source summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:5px;user-select:none}
.dshto-source summary:before{content:'▸';font-size:10px}
.dshto-source[open] summary:before{content:'▾'}
.dshto-quote{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;border-left:2px solid var(--todo-line);padding-left:10px;margin:8px 0 2px}
/* Same geometry and elevated surface as ui-conversation TodoPanel.module.css.
   The input.dock seat is full-bleed: each contribution owns its centered width. */
.dshto-card{flex:none;width:calc(100% - 2 * var(--dsh-composer-side-clearance,16px) - 4 * var(--dsh-composer-dock-inset,8px));max-width:calc(var(--dsh-composer-card-max-width,952px) - 4 * var(--dsh-composer-dock-inset,8px));margin:0 auto;border:0;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-specific-menu,var(--todo-layer));backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel);overflow:hidden;container-type:inline-size;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dshto-card-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px}
.dshto-card-heading{flex:1;min-width:0;font-size:13px;line-height:24px;font-weight:500;overflow-wrap:anywhere}
.dshto-card-list{max-height:min(38vh,280px);overflow:auto;padding:0 8px;overscroll-behavior:contain}
.dshto-card-row{display:flex;gap:10px;align-items:flex-start;padding:8px 4px;min-width:0}
.dshto-card-row+.dshto-card-row{border-top:.5px solid var(--todo-line)}
.dshto-op{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary,var(--todo-muted))}
.dshto-item-heading>.dshto-op,.dshto-item-heading>.dshto-chip{margin-inline-start:6px;vertical-align:baseline;font-weight:400}
.dshto-diff{font-size:12px;color:var(--todo-muted);line-height:1.6;overflow-wrap:anywhere;margin-top:4px;white-space:pre-wrap}
.dshto-card-foot{padding:6px 8px;flex-wrap:wrap;gap:4px}
.dshto-card-status{padding:8px 14px 10px}
.dshto-history{padding:7px 6px;font-size:12px;color:var(--todo-muted)}
.dshto-history summary{cursor:pointer}
.dshto-history-row{padding:5px 0;overflow-wrap:anywhere}
.dshto-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;position:relative}
.dshto-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshto-badge{position:absolute;top:0;right:-1px;min-width:12px;height:12px;border-radius:999px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-size:9px;line-height:12px;text-align:center;padding:0 3px;font-weight:600}
@container (max-width:380px){.dshto-card-row{flex-wrap:wrap}.dshto-card-row>.dshto-body{flex-basis:calc(100% - 28px)}.dshto-card-row>.dshto-actions{margin-left:25px}.dshto-editor-grid{grid-template-columns:minmax(0,1fr)}.dshto-card-foot .dshto-spacer{display:none}.dshto-card-foot{justify-content:flex-end}}
`

    function Style() { return h('style', { 'data-dsh-todo': '' }, CSS) }

    function Glyph({ name }: { name: GlyphName }) {
      const paths = {
        edit: 'M15 4l5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z',
        refresh: 'M20 11a8 8 0 1 0-2 6M20 4v7h-7',
        close: 'M6 6l12 12M18 6L6 18',
        plus: 'M12 5v14M5 12h14',
        open: 'M14 4h6v6M20 4L10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
      }
      return h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] ?? paths.edit }))
    }

    function IconButton({ name, label, ...props }: IconButtonProps) {
      return h('button', { type: 'button', className: 'dshto-btn icon', title: label, 'aria-label': label, ...props }, h(Glyph, { name }))
    }

    function OwnerChip({ owner, ownerName }: Partial<Pick<TaskFields, 'owner' | 'ownerName'>>) {
      if (owner === 'self' || owner === undefined) return null
      return h('span', { className: `dshto-chip${owner === 'unknown' ? ' warn' : ''}` },
        ownerName ? `${translate(`owner.${owner}`)} · ${ownerName}` : translate(`owner.${owner}`))
    }

    function Source({ source, quote }: { source?: TaskSource | null; quote?: string | null }) {
      const [error, setError] = useState<string | null>(null)
      if (typeof source?.sessionId === 'string' && source.sessionId.length > 0) {
        const open = async () => {
          setError(null)
          try {
            const workspace = pick(pluginContext, 'uiWorkspace')
            if (typeof workspace?.openSession !== 'function') throw new Error('uiWorkspace unavailable')
            await workspace.openSession(source.sessionId)
          } catch {
            setError(translate('panel.sourceUnavailable'))
          }
        }
        return h('div', { className: 'dshto-source' },
          h('button', { type: 'button', className: 'dshto-source-link', title: translate('panel.openSourceSession'), onClick: open },
            translate('panel.sourceSession'), h(Glyph, { name: 'open' })),
          error ? h('div', { className: 'dshto-error', role: 'alert' }, error) : null)
      }
      const excerpt = quote ?? source?.quote
      if (!excerpt) return null
      return h('details', { className: 'dshto-source' },
        h('summary', null, translate('card.quote')),
        h('blockquote', { className: 'dshto-quote' }, excerpt))
    }

    function useMutation(sessionId: string) {
      const [busy, setBusy] = useState(false)
      const [failure, setFailure] = useState<string | null>(null)
      const inFlight = useRef(false)
      const run = async (payload: TodoOperation) => {
        if (inFlight.current) return false
        inFlight.current = true
        setBusy(true)
        setFailure(null)
        try {
          const body = await requireHub().post({ ...payload, session: sessionId })
          const problems = body.result?.failed ?? []
          if (problems.length > 0) setFailure(problems.map((item) => item.error).join('；'))
          return true
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
          return false
        } finally {
          inFlight.current = false
          setBusy(false)
        }
      }
      return { run, busy, failure }
    }

    const editValues = (value: TaskChange): EditValues => ({ title: value.title ?? '', due: value.due ?? '', note: value.note ?? '', owner: value.owner ?? 'self', ownerName: value.ownerName ?? '' })

    function Editor({ initial, busy, onSave, onCancel, onDelete }: EditorProps) {
      const [value, setValue] = useState(() => editValues(initial))
      const update = (field: keyof EditValues) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const next = event.target.value
        if (field === 'owner') {
          if (isOwner(next)) setValue((previous) => ({ ...previous, owner: next }))
        } else setValue((previous) => ({ ...previous, [field]: next }))
      }
      const submit = async (event?: FormEvent<HTMLFormElement>) => {
        event?.preventDefault()
        if (busy || value.title.trim().length === 0) return
        const before = editValues(initial)
        const patch: TaskPatch = {}
        const title = value.title.trim()
        if (title !== before.title) patch.title = title
        if (value.owner !== before.owner) patch.owner = value.owner
        for (const field of ['due', 'note', 'ownerName'] as const) {
          const next = value[field].trim()
          if (next !== before[field]) patch[field] = next || null
        }
        if (await onSave(patch)) onCancel()
      }
      const field = (key: LocaleKey, child: ReactElement<React.HTMLAttributes<HTMLElement>>) => h('label', { className: 'dshto-field' },
        h('span', null, translate(key)), React.cloneElement(child, { 'aria-label': translate(key) }))
      return h('form', { className: 'dshto-editor', onSubmit: submit, onKeyDown: (event: React.KeyboardEvent<HTMLFormElement>) => {
        if (event.key === 'Escape' && !busy) { event.stopPropagation(); onCancel() }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit() }
      } },
      field('panel.taskTitle', h('input', { className: 'dshto-input', value: value.title, onChange: update('title'), autoFocus: true, required: true, maxLength: 300, disabled: busy })),
      h('div', { className: 'dshto-editor-grid' },
        field('panel.due', h('input', { className: 'dshto-input', type: 'date', value: value.due, onChange: update('due'), disabled: busy })),
        field('panel.owner', h('select', { className: 'dshto-input', value: value.owner, onChange: update('owner'), disabled: busy },
          (['self', 'other', 'unknown'] as const).map((owner) => h('option', { key: owner, value: owner }, translate(`owner.${owner}`)))))),
      value.owner === 'other' ? field('owner.name', h('input', { className: 'dshto-input', value: value.ownerName, onChange: update('ownerName'), disabled: busy })) : null,
      field('panel.note', h('textarea', { className: 'dshto-textarea', rows: 3, value: value.note, onChange: update('note'), disabled: busy })),
      h('div', { className: 'dshto-editor-actions' },
        onDelete ? h('button', { type: 'button', className: 'dshto-btn danger', disabled: busy, onClick: onDelete }, translate('panel.delete')) : null,
        h('span', { className: 'dshto-spacer' }),
        h('button', { type: 'button', className: 'dshto-btn', disabled: busy, onClick: onCancel }, translate('panel.cancel')),
        h('button', { type: 'submit', className: 'dshto-btn primary', disabled: busy || !value.title.trim() }, translate(busy ? 'panel.saving' : 'panel.save'))))
    }

    // ── sidebar ────────────────────────────────────────────────────────────
    function TodoPanel({ sessionId }: SessionProps) {
      useLanguage()
      const [snapshot, error] = useSnapshot(hubInstance, sessionId)
      const [draft, setDraft] = useState('')
      const [editing, setEditing] = useState<TaskView | null>(null)
      const [showDone, setShowDone] = useState(false)
      const [refreshFailure, setRefreshFailure] = useState<string | null>(null)
      const request = useRef<{ title: string; requestId: string } | null>(null)
      const { run, busy, failure } = useMutation(sessionId)
      useEffect(() => { setEditing(null) }, [sessionId])
      const refresh = async () => {
        try { await requireHub().refresh(sessionId); setRefreshFailure(null) }
        catch (caught) { setRefreshFailure(caught instanceof Error ? caught.message : String(caught)) }
      }
      if (snapshot === null) return h('div', { className: 'dshto-root dshto-panel' }, h(Style),
        h('div', { className: 'dshto-empty' }, translate(error ? 'panel.failed' : 'panel.loading', { error }),
          error ? h('button', { className: 'dshto-btn', onClick: refresh }, translate('panel.retry')) : null))

      const submitAdd = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const title = draft.trim()
        if (!title || busy) return
        if (request.current?.title !== title) request.current = { title, requestId: `ui-${Date.now()}-${Math.random().toString(36).slice(2)}` }
        if (await run({ op: 'add', ...request.current })) { setDraft((current) => current.trim() === title ? '' : current); request.current = null }
      }
      const renderTask = (task: TaskView) => h('div', { key: task.id, className: 'dshto-row' },
        editing?.id === task.id
          ? h(Editor, { key: `${sessionId}:${task.id}`, initial: editing, busy,
            onSave: (patch) => run({ op: 'update', taskId: task.id, ...patch }),
            onCancel: () => setEditing(null),
            onDelete: async () => { if (await run({ op: 'delete', taskId: task.id })) setEditing(null) } })
          : [
            h('input', { key: 'check', type: 'checkbox', className: 'dshto-check', checked: task.status === 'done', disabled: busy, 'aria-label': translate(task.status === 'done' ? 'panel.reopenTask' : 'panel.completeTask', { title: task.title }),
              onChange: () => { void run({ op: 'toggle', taskId: task.id, status: task.status === 'done' ? 'open' : 'done' }) } }),
            h('div', { key: 'body', className: 'dshto-body' },
              h('button', { type: 'button', className: `dshto-title${task.status === 'done' ? ' is-done' : ''}`, disabled: busy, onClick: () => setEditing({ ...task }) }, task.title),
              h('div', { className: 'dshto-meta' },
                task.due ? h('span', { className: task.status === 'open' && task.due < snapshot.today ? 'dshto-overdue' : '' }, `${translate('panel.due')} ${task.due}`) : null,
                h(OwnerChip, task)),
              task.note ? h('div', { className: 'dshto-note' }, task.note) : null,
              h(Source, { source: task.source })),
            h(IconButton, { key: 'edit', name: 'edit', className: 'dshto-btn icon dshto-row-edit', label: translate('panel.edit'), disabled: busy, onClick: () => setEditing({ ...task }) }),
          ])
      const batch = snapshot.batch
      const pending = batch?.items.filter((item) => ['pending', 'failed'].includes(item.state)).length ?? 0
      return h('div', { className: 'dshto-root dshto-panel' }, h(Style),
        h('div', { className: 'dshto-head' },
          h('div', { className: 'dshto-body' }, h('div', { className: 'dshto-head-title' }, translate('panel.title'), ' ', h('span', { className: 'dshto-count' }, snapshot.counts.open))),
          h(IconButton, { name: 'refresh', label: translate('panel.refresh'), disabled: busy, onClick: refresh })),
        h('form', { className: 'dshto-add', onSubmit: submitAdd },
          h('input', { className: 'dshto-input', value: draft, maxLength: 300, 'aria-label': translate('panel.addPlaceholder'), placeholder: translate('panel.addPlaceholder'), onChange: (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value) }),
          h('button', { type: 'submit', className: 'dshto-btn primary', disabled: busy || !draft.trim() }, h(Glyph, { name: 'plus' }), translate('panel.add'))),
        failure || refreshFailure ? h('div', { className: 'dshto-error', role: 'alert' }, failure ?? refreshFailure) : null,
        pending > 0 && batch?.kind === 'direct' ? h('div', null,
          h('div', { className: 'dshto-error' }, translate('panel.directFailure')),
          batch.items.filter((item) => ['pending', 'failed'].includes(item.state)).map((item) =>
            h('div', { key: item.itemId, className: 'dshto-row' }, h('div', { className: 'dshto-body' },
              h('div', { className: 'dshto-title' }, item.title),
              itemDiff(item) ? h('div', { className: 'dshto-diff' }, itemDiff(item)) : null,
              item.error ? h('div', { className: 'dshto-error' }, item.error) : null,
              h('button', { className: 'dshto-btn secondary', disabled: busy, onClick: () => { void run(item.state === 'failed'
                ? { op: 'revise', batchId: batch.id, changes: [{ itemId: item.itemId, refresh: true }] }
                : { op: 'apply', batchId: batch.id, itemIds: [item.itemId] }) } }, translate(item.state === 'failed' ? 'card.refreshConflict' : 'panel.confirmOne')),
              h('button', { className: 'dshto-btn', disabled: busy, onClick: () => { void run({ op: 'discard', batchId: batch.id, itemIds: [item.itemId] }) } }, translate('card.ignoreItem')))))) : null,
        pending > 0 && batch && batch.kind !== 'direct' ? h('button', { className: 'dshto-pending', onClick: () => document.querySelector('[data-todo-batch]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) },
          h('span', null, translate('panel.pendingShort', { n: pending })), h('span', null, translate('panel.viewBatch'), ' ↑')) : null,
        h('div', { className: 'dshto-list' }, snapshot.open.length ? snapshot.open.map(renderTask) : h('div', { className: 'dshto-empty' }, translate('panel.empty'))),
        snapshot.done.length ? h('div', null,
          h('button', { className: 'dshto-section', 'aria-expanded': showDone, onClick: () => setShowDone(!showDone) }, showDone ? '▾' : '▸', `${translate('panel.done')} (${snapshot.done.length})`),
          showDone ? h('div', { className: 'dshto-list' }, snapshot.done.map(renderTask)) : null) : null)
    }

    // ── confirmation card ──────────────────────────────────────────────────
    function itemDiff(item: ItemView) {
      const parts = []
      const after = item.after ?? {}
      const before: TaskChange = item.before ?? {}
      if (item.op === 'update') {
        for (const field of ['title', 'due', 'note', 'owner', 'ownerName'] as const) {
          if (Object.hasOwn(after, field) && (after[field] ?? '') !== (before[field] ?? '')) {
            const label: LocaleKey = field === 'title' ? 'panel.taskTitle' : field === 'owner' ? 'panel.owner' : field === 'ownerName' ? 'owner.name' : `panel.${field}`
            const display = (value: string | null | undefined) => field === 'owner' && isOwner(value) ? translate(`owner.${value}`) : value || '—'
            parts.push(`${translate(label)}：${display(before[field])} → ${display(after[field])}`)
          }
        }
      } else if (item.op === 'add') {
        if (after.due) parts.push(`${translate('panel.due')} ${after.due}`)
        if (after.note) parts.push(after.note)
      }
      return parts.join('\n')
    }

    function BatchCard({ sessionId }: SessionProps) {
      useLanguage()
      const [snapshot] = useSnapshot(hubInstance, sessionId)
      const [editing, setEditing] = useState<{ batchId: string; itemId: string; initial: TaskChange } | null>(null)
      const { run, busy, failure } = useMutation(sessionId)
      const batch = snapshot?.batch
      useEffect(() => { setEditing(null) }, [sessionId, batch?.id])
      if (!batch || batch.kind === 'direct') return null
      const actionable = batch.items.filter((item) => ['pending', 'failed'].includes(item.state))
      const processed = batch.items.filter((item) => !['pending', 'failed'].includes(item.state))
      const selected = actionable.filter((item) => item.selected)
      const allSelected = actionable.length > 0 && selected.length === actionable.length
      const counts = (['add', 'update', 'complete', 'reopen', 'delete'] as const).filter((op) => actionable.some((item) => item.op === op))
        .map((op) => `${translate(`op.${op}`)} ${actionable.filter((item) => item.op === op).length}`).join(' · ')
      const renderRow = (item: ItemView) => {
        const initial = { ...item.before, ...item.after }
        const editable = item.op === 'add' || item.op === 'update'
        const rowEditing = editing?.batchId === batch.id && editing.itemId === item.itemId
        return h('div', { key: item.itemId, className: 'dshto-card-row' },
          h('input', { type: 'checkbox', className: 'dshto-check', checked: item.selected, disabled: busy || editing !== null, 'aria-label': translate('card.selectItem', { title: item.title }),
            onChange: () => { void run({ op: 'revise', batchId: batch.id, changes: [{ itemId: item.itemId, selected: !item.selected }] }) } }),
          h('div', { className: 'dshto-body' },
            rowEditing ? h(Editor, { key: `${batch.id}:${item.itemId}`, initial: editing.initial, busy,
              onSave: (after) => run({ op: 'revise', batchId: batch.id, changes: [{ itemId: item.itemId, after }] }),
              onCancel: () => setEditing(null) })
              : h('div', null,
                h('div', { className: 'dshto-title dshto-item-heading' },
                  `${batch.items.indexOf(item) + 1}. ${item.title}`,
                  h('span', { className: 'dshto-op' }, translate(`op.${item.op}`)),
                  h(OwnerChip, initial),
                  item.state === 'failed' ? h('span', { className: 'dshto-chip err' }, translate('card.failed')) : null),
                itemDiff(item) ? h('div', { className: 'dshto-diff' }, itemDiff(item)) : null),
            item.error ? h('div', { className: 'dshto-error' }, item.error) : null,
            h(Source, { quote: item.quote }),
            item.state === 'failed' ? h('button', { className: 'dshto-btn secondary', disabled: busy || editing !== null, onClick: () => { void run({ op: 'revise', batchId: batch.id, changes: [{ itemId: item.itemId, refresh: true }] }) } }, h(Glyph, { name: 'refresh' }), translate('card.refreshConflict')) : null),
          !rowEditing ? h('div', { className: 'dshto-actions' },
            editable ? h(IconButton, { name: 'edit', label: translate('panel.edit'), disabled: busy || editing !== null,
              onClick: () => setEditing({ batchId: batch.id, itemId: item.itemId, initial }) }) : null,
            h(IconButton, { name: 'close', label: translate('card.ignoreItem'), disabled: busy || editing !== null,
              onClick: () => { void run({ op: 'discard', batchId: batch.id, itemIds: [item.itemId] }) } })) : null)
      }
      return h('section', { className: 'dshto-card', 'data-todo-batch': batch.id, 'aria-label': translate('card.title') }, h(Style),
        h('div', { className: 'dshto-card-head' },
          h('div', { className: 'dshto-card-heading' }, batch.title, h('div', { className: 'dshto-subtitle' }, counts))),
        h('div', { className: 'dshto-card-list' }, actionable.map(renderRow),
          processed.length ? h('details', { className: 'dshto-history' },
            h('summary', null, translate('card.processed', { n: processed.length })),
            processed.map((item) => h('div', { key: item.itemId, className: 'dshto-history-row' },
              h('span', { className: `dshto-chip${item.state === 'applied' ? ' ok' : ''}` }, translate(`card.${item.state}`)), ' ', item.title))) : null),
        failure ? h('div', { className: 'dshto-card-status dshto-error', role: 'alert' }, failure) : null,
        h('div', { className: 'dshto-card-foot' },
          h('label', { className: 'dshto-inline dshto-count' },
            h('input', { type: 'checkbox', className: 'dshto-check', checked: allSelected, disabled: busy || editing !== null || !actionable.length,
              ref: (node: HTMLInputElement | null) => { if (node !== null) node.indeterminate = selected.length > 0 && !allSelected },
              onChange: () => { void run({ op: 'revise', batchId: batch.id, changes: actionable.map((item) => ({ itemId: item.itemId, selected: !allSelected })) }) } }), translate(allSelected ? 'card.clearAll' : 'card.pickAll')),
          h('span', { className: 'dshto-spacer' }),
          h('button', { className: 'dshto-btn', disabled: busy || editing !== null, onClick: () => { void run({ op: 'discard', batchId: batch.id }) } }, translate('card.ignoreRest')),
          h('button', { className: 'dshto-btn primary', disabled: busy || editing !== null || !selected.length, onClick: () => { void run({ op: 'apply', batchId: batch.id, itemIds: selected.map((item) => item.itemId) }) } }, translate(busy ? 'panel.saving' : 'card.confirm'), ` (${selected.length})`)))
    }

    // ── header toggle ──────────────────────────────────────────────────────
    /** The app icon's paper-and-check motif, simplified for native toolbars. */
    function TodoIcon(props: { size?: number }) {
      const size = props?.size ?? 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
      h('path', { d: 'M10.5 21h-4A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3H16a2.5 2.5 0 0 1 2.5 2.5V9' }),
      h('path', { d: 'M8 7.5h6.5M8 11.5h3.5' }),
      h('circle', { cx: 17.5, cy: 16.5, r: 4.5 }),
      h('path', { d: 'm15.3 16.5 1.5 1.6 3-3.3' }))
    }

    /** Resolves the navigation service at call time, so activation order cannot break the buttons. */
    function resolveRight() {
      return pick(pluginContext, 'sidebarRight')
    }

    /** Opens the todo column, expanding it first when the user had collapsed it. */
    function openTodo() {
      const right = resolveRight()
      if (right === undefined) {
        warn('sidebarRight unavailable; cannot open the todo tab')
        return
      }
      try {
        if (typeof right.isExpanded === 'function' && right.isExpanded() === false
          && typeof right.toggleExpanded === 'function') {
          right.toggleExpanded()
        }
        if (typeof right.openTab === 'function') right.openTab(TAB_KIND)
      } catch (error) {
        warn('openTab failed', error)
      }
    }

    function TodoToggle(props: SessionProps) {
      const { sessionId } = props
      useLanguage()
      const [snapshot] = useSnapshot(hubInstance, sessionId)
      const pending = snapshot?.batch?.items.filter((item) => ['pending', 'failed'].includes(item.state)).length ?? 0
      return h('button', {
        type: 'button',
        className: 'dshto-iconbtn',
        title: translate('panel.title'),
        'aria-label': translate('panel.title'),
        onClick: () => openTodo(),
      }, h(Style), h(TodoIcon, { size: 16 }), pending > 0 ? h('span', { className: 'dshto-badge' }, pending > 9 ? '9+' : String(pending)) : null)
    }

    // ── plugin ─────────────────────────────────────────────────────────────
    let hubInstance: Hub | null = null
    function requireHub(): Hub {
      if (hubInstance === null) throw new Error('Todo plugin is not active')
      return hubInstance
    }
    let localeService: LocaleService | undefined = undefined
    let pluginContext: ClientContext | null = null

    function pick<Key extends keyof ClientServices>(ctx: ClientContext | null, key: Key): ClientServices[Key] | undefined {
      try {
        const services: Partial<ClientServices> | null = ctx
        const direct = services?.[key]
        if (direct !== undefined && direct !== null) return direct
      } catch { /* a service getter may refuse before activation */ }
      try {
        if (ctx !== undefined && ctx !== null && typeof ctx.get === 'function') return ctx.get(key)
      } catch { /* not available in this composition */ }
      return undefined
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = pick(ctx, 'slots')
        if (slots === undefined || typeof slots.register !== 'function') {
          warn('slots service unavailable; todo seats not registered')
          return
        }

        pluginContext = ctx
        const hub = createHub()
        hubInstance = hub
        const locale = pick(ctx, 'locale')
        localeService = locale
        activeLocale = detectLocale(readActiveLocale(locale))

        const disposers: Dispose[] = []
        const inject = (slot: string, factory: () => unknown) => {
          try {
            const dispose = slots.inject(slot, factory)
            if (typeof dispose === 'function') disposers.push(() => { dispose() })
          } catch (error) {
            warn(`seat failed: ${slot}`, error)
          }
        }

        inject('conversation.session.header.utilities', () => slots.register({
          name: 'conversation.session.header.utilities',
          id: 'todo-toggle',
          order: 4,
          label: () => translate('panel.title'),
        }, TodoToggle))

        inject('conversation.input.dock', () => slots.register({
          name: 'conversation.input.dock',
          id: 'todo-batch',
          order: 4,
        }, BatchCard))

        const registerTab = () => {
          const tabs = pick(ctx, 'sidebarRightTabs')
          if (tabs === undefined || typeof tabs.register !== 'function') {
            warn('sidebarRightTabs unavailable; the todo tab is not offered')
            return
          }
          try {
            const dispose = tabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              title: () => translate('panel.title'),
              guide: [{
                id: 'todo',
                order: 40,
                title: () => translate('panel.title'),
                description: () => translate('panel.guide'),
                icon: function TodoGuideIcon() {
                  return h(TodoIcon, { size: 24 })
                },
              }],
            })
            if (typeof dispose === 'function') disposers.push(() => { dispose() })
          } catch (error) {
            warn('tab type registration failed', error)
          }

          inject('sidebar.right.pane.tab', () => slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
          }, TodoPanel))
        }

        // Register now when the service is already there; otherwise wait for it, so
        // activation order cannot silently drop the tab type.
        if (pick(ctx, 'sidebarRightTabs') !== undefined) {
          registerTab()
        } else if (typeof ctx.inject === 'function') {
          try {
            const dispose = ctx.inject(['sidebarRightTabs'], () => { registerTab() })
            if (typeof dispose === 'function') disposers.push(() => { dispose() })
          } catch {
            warn('sidebarRightTabs never arrived; the todo tab is not offered')
          }
        } else {
          warn('sidebarRightTabs unavailable; the todo tab is not offered')
        }

        const release = () => {
          hub.dispose()
          for (const dispose of disposers) {
            try { dispose() } catch { /* already gone */ }
          }
        }
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => release)
        } else if (typeof ctx.on === 'function') {
          ctx.on('dispose', release)
        }
      },
    }
  },
})
