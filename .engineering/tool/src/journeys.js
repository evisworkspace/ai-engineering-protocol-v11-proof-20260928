import fs from 'node:fs';
import { safe, files, read, writeNew, hash } from './fs.js';
import { DIMENSIONS, JOURNEY_STATUS } from './model.js';
export const JOURNEY_DIR = '.engineering/journeys';
// Lifecycle fields change after approval; every other header field is contractual.
const LIFECYCLE = new Set(['status','aprovada_hash','homologada_por','homologada_em','motivo_retirada']);
const ORDER = ['id','titulo','dimensao','criticidade','frequencia','status','teste','aprovada_hash','homologada_por','homologada_em','motivo_retirada'];
const text = x => typeof x === 'string' && !!x.trim();
const day = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') && !Number.isNaN(Date.parse(x));
export const ACTIVE = new Set(['aprovada','homologada']);
// Heuristic only: an executable journey must assert something observable.
const ASSERTION = /\b(expect|assert[A-Za-z_]*|should|toBe|toEqual|raise|fail)\b/;
export function parse(raw) {
  const source = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = source.match(/^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/);
  if (!m) throw new Error("front matter delimited by '---' lines is required");
  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const kv = line.match(/^([a-z_][a-z0-9_]*):(.*)$/);
    if (!kv) throw new Error(`invalid header line: ${line.slice(0, 60)}`);
    if (Object.hasOwn(meta, kv[1])) throw new Error(`duplicate header field: ${kv[1]}`);
    meta[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, body: (m[2] || '').split('\n').map(l => l.trimEnd()).join('\n').trim() };
}
export function fingerprint(meta, body) {
  const contractual = Object.fromEntries(Object.keys(meta).filter(k => !LIFECYCLE.has(k)).sort().map(k => [k, meta[k]]));
  return hash(JSON.stringify({ metadata: contractual, body })).slice(0, 16);
}
export function serialize(meta, body) {
  const keys = [...ORDER.filter(k => Object.hasOwn(meta, k)), ...Object.keys(meta).filter(k => !ORDER.includes(k))];
  return `---\n${keys.map(k => meta[k] ? `${k}: ${meta[k]}` : `${k}:`).join('\n')}\n---\n${body}\n`;
}
export function load(root) {
  const journeys = new Map(), errors = [];
  let names = [];
  try { names = files(root, JOURNEY_DIR); } catch (e) { errors.push(`${JOURNEY_DIR}: ${e.message}`); }
  for (const rel of names.filter(p => /\/J-[^/]*\.md$/.test(p))) {
    try {
      const { meta, body } = parse(read(root, rel));
      const id = rel.slice(JOURNEY_DIR.length + 1, -3);
      if (!/^J-\d{4}$/.test(id) || meta.id !== id) { errors.push(`${rel}: id must be J-NNNN and match the filename`); continue; }
      journeys.set(id, { rel, meta, body, hash: fingerprint(meta, body) });
    } catch (e) { errors.push(`${rel}: ${e.message}`); }
  }
  return { journeys, errors };
}
export function validate(root, journeys, contract, { errors, warnings }) {
  const windows = contract?.periodic_windows_hours || {};
  for (const [id, j] of journeys) {
    const { meta } = j, needs = (c, msg) => { if (!c) errors.push(`${j.rel}: ${msg}`); };
    needs(text(meta.titulo), 'titulo required');
    needs(DIMENSIONS.includes(meta.dimensao), `dimensao must be one of ${DIMENSIONS.join(', ')}`);
    needs(['critica','normal'].includes(meta.criticidade), 'criticidade must be critica or normal');
    needs(Object.hasOwn(windows, meta.frequencia), `frequencia must be one of ${Object.keys(windows).join(', ')}`);
    needs(JOURNEY_STATUS.includes(meta.status), `status must be one of ${JOURNEY_STATUS.join(', ')}`);
    needs(text(j.body), 'journey text required');
    if (meta.status === 'retirada') needs(text(meta.motivo_retirada), 'retirada requires motivo_retirada');
    if (!ACTIVE.has(meta.status)) continue;
    needs(!/\{\{[^}]+\}\}|__[A-Z][A-Z0-9_]*__/.test(j.body + JSON.stringify(meta)), 'approved journey contains unresolved template placeholders');
    needs(meta.aprovada_hash === j.hash, `contract text or metadata changed after approval (fingerprint ${j.hash} != approved ${meta.aprovada_hash || 'empty'}); the owner must approve it again`);
    if (meta.status === 'homologada') needs(text(meta.homologada_por) && day(meta.homologada_em), 'homologada requires homologada_por and homologada_em (YYYY-MM-DD)');
    try {
      if (!text(meta.teste)) throw new Error('approved journey requires teste');
      const source = fs.readFileSync(safe(root, meta.teste), 'utf8');
      needs(source.includes(`@${id}`), `test ${meta.teste} must contain the marker @${id}`);
      needs(ASSERTION.test(source), `test ${meta.teste} has no recognizable assertion (expect/assert)`);
    } catch (e) { errors.push(`${j.rel}: ${e.code === 'ENOENT' ? `test file not found: ${meta.teste}` : e.message}`); }
  }
}
export function coverage(journeys, contract, criticality) {
  const active = new Set([...journeys.values()].filter(j => ACTIVE.has(j.meta.status)).map(j => j.meta.dimensao));
  return (contract?.dimensions_required?.[criticality] || []).filter(d => !active.has(d));
}
// Commands used by operators and agents; approval authority stays with the owner's review.
function fetch(root, id) {
  const { journeys, errors } = load(root);
  const j = journeys.get(id);
  if (!j) throw new Error(errors.find(e => e.includes(id)) || `journey not found: ${id}`);
  return j;
}
function save(root, j) { fs.writeFileSync(safe(root, j.rel), serialize(j.meta, j.body)); }
export function create(root, opts, windows) {
  const { journeys } = load(root);
  const next = Math.max(0, ...[...journeys.keys()].map(k => Number(k.slice(2)))) + 1;
  if (next > 9999) throw new Error('journey id space exhausted');
  const id = `J-${String(next).padStart(4, '0')}`;
  const meta = { id, titulo: opts.title, dimensao: opts.dimension, criticidade: opts.criticality || 'normal', frequencia: opts.frequency || 'cada_mudanca',
    status: 'rascunho', teste: opts.test || `tests/journeys/${id}.spec.ts`, aprovada_hash: '', homologada_por: '', homologada_em: '' };
  if (!text(meta.titulo) || /[\n\r]/.test(meta.titulo)) throw new Error('--title is required (single line)');
  if (!DIMENSIONS.includes(meta.dimensao)) throw new Error(`--dimension must be one of ${DIMENSIONS.join(', ')}`);
  if (!['critica','normal'].includes(meta.criticidade)) throw new Error('--criticality must be critica or normal');
  if (!Object.hasOwn(windows, meta.frequencia)) throw new Error(`--frequency must be one of ${Object.keys(windows).join(', ')}`);
  safe(root, meta.teste);
  const body = ['Quem: {{quem executa: cliente, atendente, sistema}}', '', 'Dado que {{situação inicial, com dados concretos}}',
    'Quando {{ação}}', 'Então {{resultado observável}}', 'E {{outro resultado observável}}', '', 'Nunca pode acontecer: {{o que o sistema deve impedir}}'].join('\n');
  const rel = `${JOURNEY_DIR}/${id}.md`;
  writeNew(root, rel, serialize(meta, body));
  return { id, path: rel, status: 'rascunho' };
}
export function seal(root, id) {
  const j = fetch(root, id);
  if (j.meta.status === 'retirada') throw new Error(`${id} is retirada; create a new journey instead`);
  if (/\{\{[^}]+\}\}/.test(j.body)) throw new Error(`${id} still contains {{placeholders}}; write the concrete journey first`);
  for (const k of ['titulo','dimensao','criticidade','frequencia','teste']) if (!text(j.meta[k])) throw new Error(`${id}: ${k} required before approval`);
  if (j.meta.status === 'homologada' && j.meta.aprovada_hash === j.hash) throw new Error(`${id} is already homologada and unchanged`);
  const changed = j.meta.aprovada_hash !== j.hash;
  Object.assign(j.meta, { status: 'aprovada', aprovada_hash: j.hash });
  if (changed) Object.assign(j.meta, { homologada_por: '', homologada_em: '' });
  save(root, j);
  return { id, status: 'aprovada', aprovada_hash: j.hash, note: 'Fingerprint recorded. Approval is authoritative only through the owner-reviewed change (protected pull request).' };
}
export function homologate(root, id, { by, date = new Date().toISOString().slice(0, 10) }) {
  const j = fetch(root, id);
  if (j.meta.status !== 'aprovada' || j.meta.aprovada_hash !== j.hash) throw new Error(`${id} must be aprovada with a current fingerprint before homologation`);
  if (!text(by) || /[\n\r]/.test(by)) throw new Error('--by is required');
  if (!day(date)) throw new Error('--date must be YYYY-MM-DD');
  Object.assign(j.meta, { status: 'homologada', homologada_por: by, homologada_em: date });
  save(root, j);
  return { id, status: 'homologada', homologada_por: by, homologada_em: date };
}
export function retire(root, id, { reason }) {
  const j = fetch(root, id);
  if (j.meta.status === 'retirada') throw new Error(`${id} is already retirada`);
  if (!text(reason) || /[\n\r]/.test(reason)) throw new Error('--reason is required');
  Object.assign(j.meta, { status: 'retirada', motivo_retirada: reason });
  save(root, j);
  return { id, status: 'retirada', motivo_retirada: reason };
}
export function list(root) {
  const { journeys, errors } = load(root);
  return { journeys: [...journeys.values()].map(j => ({ id: j.meta.id, titulo: j.meta.titulo, dimensao: j.meta.dimensao, criticidade: j.meta.criticidade,
    frequencia: j.meta.frequencia, status: j.meta.status, fingerprint_current: !ACTIVE.has(j.meta.status) || j.meta.aprovada_hash === j.hash, teste: j.meta.teste })), errors };
}
