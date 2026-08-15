import { createHash } from 'node:crypto';
import os from 'node:os';
export function sha256(text) {
    return createHash('sha256').update(String(text)).digest('hex');
}
export function expandHome(p) {
    return String(p).replace(/^~(?=$|\/)/, os.homedir());
}
