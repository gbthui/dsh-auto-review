import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

// ---------- read-only fact finding ----------

export type FactQuery =
  | { tool: 'inspect_path' | 'inspect_directory' | 'inspect_file_metadata'; path: string }
  | { tool: 'inspect_text_file'; path: string }
  | { tool: 'inspect_git_remote'; remote: string }
  | { tool: 'inspect_git_status' }

export interface FactObservation {
  tool: string
  params: Record<string, unknown>
  result: Record<string, unknown>
}

export const FACT_TOOLS = new Set(['inspect_path', 'inspect_directory', 'inspect_file_metadata', 'inspect_text_file', 'inspect_git_remote', 'inspect_git_status'])

/** Paths whose CONTENT may never be inspected. The list can never be exhaustive, so content inspection stays OFF by default. */
export const CONTENT_DENY_PATH_PATTERNS = [
  /(^|\/)\.env(\..*)?$/i,
  /(^|\/)\.(ssh|aws|azure|config|kube|gnupg|docker|npm)\//i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.git-credentials$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)(id_rsa|id_ed25519|id_dsa|id_ecdsa)(\..*)?$/i,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)(credentials?|secrets?)\.(json|toml|yaml|yml|ini|env)$/i,
]

/**
 * Content-inspection deny decision for a real path. Platform-proof: the
 * path is normalized to `/` separators before the regexes run (realpath
 * returns native separators, so on Windows `C:\...\.env` must match), and
 * a component-wise check backs the regexes up — the deny list is a hard
 * security boundary and never depends on separator syntax.
 */
export function isSensitiveContentPath(realPath: string): boolean {
  const normalized = String(realPath).replace(/\\/g, '/')
  if (CONTENT_DENY_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) return true
  const parts = normalized.split('/')
  const base = parts[parts.length - 1] ?? ''
  if (parts.some((part) => /^\.env(\..*)?$/i.test(part))) return true
  if (parts.some((part) => /^\.(ssh|aws|azure|config|kube|gnupg|docker|npm)$/i.test(part))) return true
  if (parts.some((part) => /^\.(npmrc|pypirc)$/i.test(part))) return true
  if (/^\.(git-credentials|netrc)$/i.test(base)) return true
  if (/^(id_rsa|id_ed25519|id_dsa|id_ecdsa)(\..*)?$/i.test(base)) return true
  if (/\.(pem|key|p12|pfx)$/i.test(base)) return true
  if (/^(credentials?|secrets?)\.(json|toml|yaml|yml|ini|env)$/i.test(base)) return true
  return false
}

const execFileAsync = promisify(execFile)

/**
 * Run git with every repository-configured execution channel disabled:
 * `core.fsmonitor=false` (no FSMonitor hook programs) and a clean, empty
 * `core.hooksPath` (no hook scripts). The fact finder is a pure metadata
 * oracle — `git status` in a repo whose config points fsmonitor/hooks at
 * arbitrary programs must never launch them.
 */
const execGit = (args: string[], cwd: string, hooksDir: string, timeoutMs = 5000): Promise<string> =>
  execFileAsync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + hooksDir, ...args], { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true })
    .then((result) => String(result.stdout))

/** Strip credentials from a git remote URL and reduce it to structured fields. */
export function sanitizeGitUrl(raw: string): { scheme: string; host: string; owner: string; repo: string } | { sanitized: string } {
  const match = /^(?:(?<scheme>[a-z0-9+.-]+):\/\/)?(?:(?<user>[^@/]+)@)?(?<host>[^/:]+)(?::\d+)?[\/:](?<rest>.+)$/i.exec(raw.trim())
  if (!match?.groups) {
    return { sanitized: raw.replace(/\/\/[^@/]+@/, '//<redacted>@') }
  }
  const g = match.groups as { scheme?: string; host: string; rest: string }
  const parts = String(g.rest ?? '').replace(/\.git$/, '').split('/')
  return {
    scheme: String(g.scheme ?? 'scp'),
    host: g.host,
    owner: parts.length >= 2 ? parts[parts.length - 2] ?? '' : '',
    repo: parts[parts.length - 1] ?? '',
  }
}

/**
 * Resolve a fact-query path against the workspace with realpath containment.
 * The real location must be inside the workspace — the fact finder is a
 * workspace-scoped oracle, so anything outside (or unresolvable through a
 * symlinked parent) is denied WITHOUT any metadata. When the leaf itself does
 * not exist, the nearest existing ancestor decides containment, so
 * "doesn't exist" stays observable for in-workspace paths while a symlinked
 * directory inside the workspace cannot become a probe into the rest of the
 * filesystem.
 */
async function containedRealPath(workspaceRoot: string, queryPath: string): Promise<{ inside: boolean; real: string }> {
  const resolved = path.resolve(workspaceRoot, queryPath)
  try {
    const real = await realpath(resolved)
    return { inside: real === workspaceRoot || real.startsWith(workspaceRoot + path.sep), real }
  } catch {
    try {
      const parent = await realpath(path.dirname(resolved))
      return { inside: parent === workspaceRoot || parent.startsWith(workspaceRoot + path.sep), real: resolved }
    } catch {
      return { inside: false, real: resolved }
    }
  }
}

/**
 * Execute a bounded batch of read-only fact queries. Fixed semantic tools
 * only: metadata about paths/directories/files (workspace-scoped — outside
 * paths are denied without metadata) and three hardened git reads. No
 * shell, no network, no escalation, no approval asks; the only subprocess
 * is git with fsmonitor and hooks disabled. File content requires opt-in.
 */
export interface FactExecutionOptions {
  contentEnabled: boolean
  contentMaxBytes: number
}

export async function executeFacts(queries: readonly FactQuery[], workspaceRoot: string, options?: FactExecutionOptions): Promise<FactObservation[]> {
  const observations: FactObservation[] = []
  // Containment is judged against the workspace's REAL location, so a
  // symlinked workspace root does not make every path look "outside".
  const root = await realpath(workspaceRoot).catch(() => workspaceRoot)
  // Lazily created empty hooksPath for every git fact: git never executes
  // repo-configured hooks or FSMonitor programs from this directory.
  let hooksDir: string | null = null
  const getHooksDir = async (): Promise<string> => {
    hooksDir ??= await mkdtemp(path.join(os.tmpdir(), 'dsh-auto-review-hooks-'))
    return hooksDir
  }
  try {
    for (const query of queries) {
      const params: Record<string, unknown> = { ...query }
      try {
        if (query.tool === 'inspect_text_file') {
          if (!options?.contentEnabled) {
            observations.push({ tool: query.tool, params, result: { error: 'file-content inspection is disabled (factFinding.content.enabled=false)' } })
            continue
          }
          const { inside, real } = await containedRealPath(root, query.path)
          if (!inside) {
            observations.push({ tool: query.tool, params, result: { resolvedPath: real, error: 'outside workspace: content inspection is workspace-only' } })
            continue
          }
          if (isSensitiveContentPath(real)) {
            observations.push({ tool: query.tool, params, result: { resolvedPath: real, error: 'sensitive path: content inspection denied' } })
            continue
          }
          const st = await stat(real)
          if (!st.isFile()) {
            observations.push({ tool: query.tool, params, result: { resolvedPath: real, error: 'not a regular file' } })
            continue
          }
          if (st.size > options.contentMaxBytes) {
            observations.push({ tool: query.tool, params, result: { resolvedPath: real, size: st.size, error: 'exceeds the content budget (' + options.contentMaxBytes + ' bytes)' } })
            continue
          }
          const head = await readFile(real).then((buf) => buf.subarray(0, 8000))
          if (head.includes(0)) {
            observations.push({ tool: query.tool, params, result: { resolvedPath: real, error: 'binary file: content inspection denied' } })
            continue
          }
          const text = (await readFile(real, 'utf8')).slice(0, options.contentMaxBytes)
          observations.push({ tool: query.tool, params, result: { resolvedPath: real, insideWorkspace: true, size: st.size, content: text } })
          continue
        }
        if (query.tool === 'inspect_path' || query.tool === 'inspect_directory' || query.tool === 'inspect_file_metadata') {
          // Same realpath containment as content inspection: outside paths
          // (../.., absolute paths, symlink escapes) are denied WITHOUT any
          // metadata — existence/type/mtime/size of foreign paths never
          // reaches the reviewer.
          const { inside, real } = await containedRealPath(root, query.path)
          if (!inside) {
            observations.push({ tool: query.tool, params, result: { resolvedPath: real, error: 'outside workspace: metadata inspection is workspace-only' } })
            continue
          }
          const st = await stat(real)
          const kind = st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other'
          if (query.tool === 'inspect_directory' && !st.isDirectory()) {
            observations.push({ tool: query.tool, params, result: { resolvedPath: real, error: 'not a directory' } })
            continue
          }
          const result: Record<string, unknown> = {
            resolvedPath: real,
            exists: true,
            kind,
            insideWorkspace: true,
            mtimeMs: Math.round(st.mtimeMs),
          }
          if (st.isDirectory()) {
            const entries = await readdir(real)
            result.entryCount = entries.length
            let dirs = 0
            for (const entry of entries.slice(0, 200)) {
              try {
                if ((await stat(path.join(real, entry))).isDirectory()) dirs++
              } catch {
                /* skip unreadable entries */
              }
            }
            result.subdirCount = dirs
          } else {
            result.size = st.size
          }
          observations.push({ tool: query.tool, params, result })
        } else if (query.tool === 'inspect_git_remote') {
          try {
            const raw = (await execGit(['remote', 'get-url', query.remote], workspaceRoot, await getHooksDir())).trim()
            const parsed = sanitizeGitUrl(raw)
            observations.push({ tool: query.tool, params, result: { remote: query.remote, ...parsed } })
          } catch (error) {
            observations.push({ tool: query.tool, params, result: { remote: query.remote, error: String((error as Error)?.message ?? error).slice(0, 120) } })
          }
        } else if (query.tool === 'inspect_git_status') {
          try {
            const branch = (await execGit(['branch', '--show-current'], workspaceRoot, await getHooksDir())).trim()
            const porcelain = await execGit(['status', '--porcelain'], workspaceRoot, await getHooksDir())
            const lines = porcelain.split('\n').filter(Boolean)
            observations.push({ tool: query.tool, params, result: { branch, changedEntries: lines.length, sample: lines.slice(0, 20) } })
          } catch (error) {
            observations.push({ tool: query.tool, params, result: { error: String((error as Error)?.message ?? error).slice(0, 120) } })
          }
        }
      } catch (error) {
        observations.push({ tool: query.tool, params, result: { exists: false, error: String((error as Error)?.message ?? error).slice(0, 120) } })
      }
    }
  } finally {
    if (hooksDir) await rm(hooksDir, { recursive: true, force: true }).catch(() => {})
  }
  return observations
}
