export type FactQuery = {
    tool: 'inspect_path' | 'inspect_directory' | 'inspect_file_metadata';
    path: string;
} | {
    tool: 'inspect_text_file';
    path: string;
} | {
    tool: 'inspect_git_remote';
    remote: string;
} | {
    tool: 'inspect_git_status';
};
export interface FactObservation {
    tool: string;
    params: Record<string, unknown>;
    result: Record<string, unknown>;
}
export declare const FACT_TOOLS: Set<string>;
/** Paths whose CONTENT may never be inspected. The list can never be exhaustive, so content inspection stays OFF by default. */
export declare const CONTENT_DENY_PATH_PATTERNS: RegExp[];
/**
 * Content-inspection deny decision for a real path. Platform-proof: the
 * path is normalized to `/` separators before the regexes run (realpath
 * returns native separators, so on Windows `C:\...\.env` must match), and
 * a component-wise check backs the regexes up — the deny list is a hard
 * security boundary and never depends on separator syntax.
 */
export declare function isSensitiveContentPath(realPath: string): boolean;
/** Strip credentials from a git remote URL and reduce it to structured fields. */
export declare function sanitizeGitUrl(raw: string): {
    scheme: string;
    host: string;
    owner: string;
    repo: string;
} | {
    sanitized: string;
};
/**
 * Execute a bounded batch of read-only fact queries. Fixed semantic tools
 * only: metadata about paths/directories/files (workspace-scoped — outside
 * paths are denied without metadata) and three hardened git reads. No
 * shell, no network, no escalation, no approval asks; the only subprocess
 * is git with fsmonitor and hooks disabled. File content requires opt-in.
 */
export interface FactExecutionOptions {
    contentEnabled: boolean;
    contentMaxBytes: number;
}
export declare function executeFacts(queries: readonly FactQuery[], workspaceRoot: string, options?: FactExecutionOptions): Promise<FactObservation[]>;
