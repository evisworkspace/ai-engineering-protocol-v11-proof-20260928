import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export function safe(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || path.posix.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split('/').some(p => !p || p === '.' || p === '..') || rel.includes('\0')) throw new Error(`unsafe project path: ${rel}`);
  const target = path.resolve(root, ...rel.split('/'));
  assertNoLinks(target);
  return target;
}
export function assertNoLinks(target) {
  // Resolve the operator's root once; thereafter reject links inside the project.
  let p = target;
  while (true) {
    try { if (fs.lstatSync(p).isSymbolicLink()) throw new Error(`symbolic link refused: ${p}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = path.dirname(p); if (parent === p) break; p = parent;
  }
}
export function rootPath(input) {
  const absolute = path.resolve(input);
  if (fs.existsSync(absolute)) return fs.realpathSync(absolute);
  const parent = rootPath(path.dirname(absolute));
  return path.join(parent, path.basename(absolute));
}
export function read(root, rel) { return fs.readFileSync(safe(root, rel), 'utf8'); }
export function load(root, rel) { return JSON.parse(read(root, rel)); }
export function writeNew(root, rel, value) {
  const file = safe(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { flag: 'wx', mode: 0o600 });
}
export function files(root, rel) {
  const dir = safe(root, rel);
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const child = `${rel}/${e.name}`;
    if (e.isSymbolicLink()) throw new Error(`symbolic link refused: ${child}`);
    return e.isDirectory() ? files(root, child) : [child];
  });
}
