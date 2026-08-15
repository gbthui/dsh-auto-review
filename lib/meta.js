/** Plugin identity, shared by every module without importing the entry point. */
export const name = 'auto-review';
export const NS = 'dsh-auto-review';
/** The command registry must exist before apply: the loader mounts rows concurrently. */
export const inject = ['commands'];
