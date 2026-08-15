import { createHash } from 'node:crypto'
import os from 'node:os'

export function sha256(text: string): string {
  return createHash('sha256').update(String(text)).digest('hex')
}

export function expandHome(p: string): string {
  return String(p).replace(/^~(?=$|\/)/, os.homedir())
}

export interface LoggerLike {
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/**
 * The structural context surface the plugin actually touches: logging,
 * service lookup, and the event bus. The full cordis Context satisfies this;
 * tests can pass minimal mocks without casts.
 */
export interface PluginContext {
  logger(name: string): LoggerLike
  get?(name: string): unknown
  on(event: string, listener: unknown, prepend?: boolean): unknown
}
