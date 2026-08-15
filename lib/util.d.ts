export declare function sha256(text: string): string;
export declare function expandHome(p: string): string;
export interface LoggerLike {
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
/**
 * The structural context surface the plugin actually touches: logging,
 * service lookup, and the event bus. The full cordis Context satisfies this;
 * tests can pass minimal mocks without casts.
 */
export interface PluginContext {
    logger(name: string): LoggerLike;
    get?(name: string): unknown;
    on(event: string, listener: unknown, prepend?: boolean): unknown;
}
