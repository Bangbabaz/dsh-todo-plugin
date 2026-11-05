/**
 * Narrow structural ports for the DSH services consumed by this plugin.
 * These are not replacement declarations for Cordis Context. DSH's private
 * host/client packages are not installed in a third-party profile; the ports
 * keep their actual service boundaries typed without importing host code into
 * the browser. Sources: tools/src, host-webserver, ui-slots, ui-workspace,
 * ui-sidebar-right and modules in the DSH checkout.
 */
import type { ComponentType } from 'react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ToolContracts } from './types.js'

export type Dispose = () => void
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  properties?: Record<string, JsonSchema>
  required?: readonly string[]
  additionalProperties?: boolean
  oneOf?: readonly JsonSchema[]
  enum?: readonly (string | number | boolean | null)[]
  items?: JsonSchema
  description?: string
}
export interface TextContent { type: 'text'; text: string }
export interface ToolOutput<Args, Result> {
  schema: JsonSchema
  render(args: Args, value: Result): TextContent[]
}
export interface ToolExecutionInput { agent?: { id: string } }
export interface ToolDefinition<Name extends keyof ToolContracts> {
  name: Name
  description: string
  parameters: JsonSchema
  output: ToolOutput<ToolContracts[Name]['args'], ToolContracts[Name]['result']>
  execute(args: ToolContracts[Name]['args'], exec: ToolExecutionInput): Promise<ToolContracts[Name]['result']>
}
export interface ToolRegistry {
  register<Name extends keyof ToolContracts>(definition: ToolDefinition<Name>): Dispose
}
export interface Connection { requestRejection(req: IncomingMessage): number | null | undefined }
export interface WebServer {
  register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): void }): Dispose
}
export interface HostServices { tools: ToolRegistry; webServer: WebServer; connection: Connection }
export interface HostContext {
  get<Key extends keyof HostServices>(key: Key): HostServices[Key] | undefined
  inject?(services: readonly (keyof HostServices)[], callback: () => void): unknown
  effect?(effect: () => Dispose): unknown
}

export interface SessionProps { sessionId: string }
export interface LocaleService {
  getLocale(): { active: string }
  subscribe?(listener: () => void): Dispose
}
export interface ClientSlots {
  inject(name: string, factory: () => unknown): unknown
  register<Props extends object>(options: { name: string; id?: string; key?: string; order?: number; label?: () => string }, component: ComponentType<Props>): unknown
}
export interface SidebarRight {
  isExpanded(): boolean
  toggleExpanded(): void
  openTab(kind: string): void
}
export interface SidebarRightTabs {
  register(tab: { id: string; kind: string; title: () => string; guide: { id: string; order: number; title: () => string; description: () => string; icon: ComponentType }[] }): unknown
}
export interface ClientServices {
  slots: ClientSlots
  locale: LocaleService
  sidebarRight: SidebarRight
  sidebarRightTabs: SidebarRightTabs
  uiWorkspace: { openSession(sessionId: string): void }
}
export type ClientContext = Partial<ClientServices> & {
  get?<Key extends keyof ClientServices>(key: Key): ClientServices[Key] | undefined
  inject?(services: readonly (keyof ClientServices)[], callback: () => void): unknown
  effect?(effect: () => Dispose): unknown
  on?(event: 'dispose', listener: Dispose): unknown
}
export interface ClientPlugin { inject: string[]; apply(ctx: ClientContext): void }
export interface ModuleLoader {
  load(definition: { id: string; factory(require: (name: 'react') => typeof import('react')): ClientPlugin }): void
}
declare global {
  interface Window { __ModuleLoader__: ModuleLoader }
}
