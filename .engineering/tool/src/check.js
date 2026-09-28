import fs from 'node:fs';
import { load, safe, files, read, hash } from './fs.js';
import { VERSION, UPGRADABLE, MODIFIERS, DIMENSIONS } from './model.js';
import * as journeys from './journeys.js';
const terminal = new Set(['accepted', 'superseded']);
const statuses = ['proposed','authorized','in_progress','blocked','ready_for_review','accepted','superseded'];
const executing = new Set(['authorized','in_progress','blocked','ready_for_review','accepted']);
const text = x => typeof x === 'string' && !!x.trim();
const list = x => Array.isArray(x) && x.length > 0 && x.every(text);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const date = x => text(x) && /^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(x) && !Number.isNaN(Date.parse(x));
export function check(root, { allowOlder = false } = {}) {
  const errors = [], warnings = [];
  const fail = msg => errors.push(msg);
  const require = (condition, msg) => { if (!condition) fail(msg); };
  const get = rel => {
    try {
      const value = load(root, rel);
      require(obj(value), `${rel}: expected object`);
      require(value?.schema_version === 1, `${rel}: unsupported schema_version`);
      if (/__[A-Z][A-Z0-9_]*__|\{\{[^}]+\}\}/.test(JSON.stringify(value))) fail(`${rel}: unresolved placeholder`);
      return obj(value) ? value : {};
    } catch (e) { fail(`${rel}: ${e.message}`); return {}; }
  };
  const exists = (ref, prefix) => {
    try {
      if (!text(ref) || !ref.startsWith(prefix)) throw new Error(`reference must start with ${prefix}`);
      require(fs.statSync(safe(root, ref)).isFile(), `reference is not a file: ${ref}`);
    } catch (e) { fail(`invalid reference ${ref}: ${e.message}`); }
  };
  const protocol = get('.engineering/protocol.json');
  require(protocol.name === 'ai-engineering', 'invalid protocol name');
  require(allowOlder ? UPGRADABLE.test(protocol.version) : protocol.version === VERSION, 'unsupported installed protocol version; run upgrade');
  // Overlays installed before 1.1.0 are validated with their own rules until upgraded.
  const legacy = protocol.version !== VERSION;
  require(['greenfield','brownfield'].includes(protocol.mode), 'invalid installation mode');
  require(date(protocol.installed_at) && text(protocol.source), 'missing protocol provenance');
  require(protocol.compatibility?.schema_version === 1, 'unsupported protocol compatibility');
  const project = get('.engineering/project.json');
  const profile = project.project || {};
  require(['P0','P1','P2','P3'].includes(profile.criticality), 'invalid project criticality');
  require(text(profile.name) && text(profile.purpose), 'project name/purpose required');
  for (const key of ['code','data','secrets','decisions','state','production']) {
    const a = project.authorities?.[key];
    require(obj(a) && text(a.kind) && text(a.location) && a.kind !== 'unspecified', `missing authority: ${key}`);
  }
  // These two functions have a single authoritative protocol location in schema 1.
  require(project.authorities?.state?.location === '.engineering/state.json', 'state authority conflicts with schema location');
  require(project.authorities?.decisions?.location === '.engineering/decisions/', 'decisions authority conflicts with schema location');
  const state = get('.engineering/state.json');
  require(['bootstrap','ready','in_progress','blocked','ready_for_review','accepted'].includes(state.status), 'invalid state.status');
  require(text(state.next_action), 'state.next_action required');
  require(Array.isArray(state.blocked_by) && state.blocked_by.every(text), 'state.blocked_by must be a text array');
  require(list(state.prohibited), 'state.prohibited required');
  if (state.status === 'blocked') require(state.blocked_by?.length > 0, 'blocked state requires reason');
  require(state.active_work === null || text(state.active_work), 'state.active_work must be null or path');
  let workFiles = [];
  try {
    workFiles = files(root, '.engineering/work').filter(p => p.endsWith('.json'));
    for (const directory of ['.engineering/decisions','.engineering/evidence','.engineering/templates']) files(root, directory);
    read(root, 'ENGINEERING.md');
  } catch (e) { fail(e.message); }
  // Journey layer (1.1.0): the owner-approved operational contract.
  const contract = legacy ? {} : get('.engineering/contract.json');
  const loaded = legacy ? { journeys: new Map(), errors: [] } : journeys.load(root);
  const catalog = loaded.journeys;
  const adoption = contract.status === 'adoption';
  if (!legacy) {
    require(['adoption','active'].includes(contract.status), '.engineering/contract.json: status must be adoption or active');
    for (const p of ['P0','P1','P2','P3']) {
      const dims = contract.dimensions_required?.[p], layers = contract.internal_layers_required?.[p];
      require(Array.isArray(dims) && dims.every(d => DIMENSIONS.includes(d)), `.engineering/contract.json: invalid dimensions_required.${p}`);
      require(Array.isArray(layers) && layers.every(l => /^[a-z][a-z0-9_-]*$/.test(l)), `.engineering/contract.json: invalid internal_layers_required.${p}`);
    }
    const windows = contract.periodic_windows_hours;
    require(obj(windows) && windows.cada_mudanca === 0 && Object.values(windows).every(h => Number.isInteger(h) && h >= 0), '.engineering/contract.json: periodic_windows_hours requires cada_mudanca 0 and non-negative integer hours');
    errors.push(...loaded.errors);
    journeys.validate(root, catalog, contract, { errors, warnings });
    for (const d of journeys.coverage(catalog, contract, profile.criticality)) warnings.push(`contract ${profile.criticality}: no approved journey in dimension '${d}'; the system cannot be released yet`);
    if (adoption) warnings.push('contract in adoption: journeys are being characterized; the system cannot be released until the owner activates the contract');
    if (obj(protocol.ci)) for (const [rel, digest] of Object.entries(protocol.managed_files || {})) {
      if (!rel.startsWith('.engineering/tool/')) continue;
      try { require(hash(fs.readFileSync(safe(root, rel))) === digest, `vendored gate tool differs from its recorded version: ${rel}`); }
      catch (e) { fail(`vendored gate tool missing or unreadable: ${rel}`); }
    }
  }
  if (state.active_work) {
    exists(state.active_work, '.engineering/work/');
    require(workFiles.includes(state.active_work), 'active_work must reference a work JSON file');
  }
  const ids = new Set();
  const records = new Map();
  for (const rel of workFiles) {
    const wp = get(rel); records.set(rel, wp);
    const needs = (c, msg) => require(c, `${rel}: ${msg}`);
    needs(text(wp.id) && /^WP-[A-Za-z0-9-]+$/.test(wp.id) && rel === `.engineering/work/${wp.id}.json`, 'id must match work filename');
    needs(!ids.has(wp.id), 'duplicate work id'); ids.add(wp.id);
    needs(statuses.includes(wp.status), 'invalid work status');
    needs(wp.project_criticality === profile.criticality, 'work/project criticality mismatch');
    needs(['C0','C1','C2','C3','C4'].includes(wp.change_impact), 'invalid change impact');
    needs(['explicit_owner','review_required'].includes(wp.acceptance_mode), 'unsupported acceptance_mode');
    needs(text(wp.objective), 'objective required');
    for (const key of ['scope','acceptance','evidence_required']) needs(list(wp[key]), `${key} required`);
    needs(Array.isArray(wp.non_goals) && wp.non_goals.every(text), 'non_goals must be text array');
    needs(Array.isArray(wp.modifiers) && wp.modifiers.every(m => MODIFIERS.includes(m)), 'invalid modifiers');
    const mods = Array.isArray(wp.modifiers) ? wp.modifiers : [];
    if (mods.includes('DATA_MIGRATION')) needs(obj(wp.data_migration) && ['plan','validation','rollback'].every(k => text(wp.data_migration[k])), 'DATA_MIGRATION requires plan, validation and rollback');
    if (['C3','C4'].includes(wp.change_impact) || (profile.criticality === 'P3' && wp.change_impact !== 'C0') || mods.some(m => ['IRREVERSIBLE','DATA_MIGRATION'].includes(m))) {
      needs(obj(wp.recovery) && ['strategy','verification'].every(k => text(wp.recovery[k])), 'higher-risk work requires recovery strategy and verification');
    }
    needs(['none','localized','structural'].includes(wp.architecture_impact), 'invalid architecture_impact');
    needs(Array.isArray(wp.decision_refs) && wp.decision_refs.every(text), 'decision_refs must be array');
    if (Array.isArray(wp.decision_refs)) for (const ref of wp.decision_refs) exists(ref, '.engineering/decisions/');
    if (wp.architecture_impact === 'structural') needs(wp.decision_refs?.length > 0, 'structural architecture requires ADR');
    if (['authorized','in_progress','ready_for_review','accepted'].includes(wp.status)) {
      needs(obj(wp.authorization_record) && text(wp.authorization_record.actor) && date(wp.authorization_record.date) && text(wp.authorization_record.scope), 'authorization_record required');
    }
    needs(Array.isArray(wp.evidence), 'evidence must be array');
    if (['ready_for_review','accepted'].includes(wp.status)) needs(wp.evidence?.length > 0, `${wp.status} requires evidence`);
    if (Array.isArray(wp.evidence)) for (const entry of wp.evidence) {
      needs(obj(entry) && text(entry.summary), 'evidence summary required');
      if (!legacy && obj(entry) && Object.hasOwn(entry, 'url')) needs(typeof entry.url === 'string' && /^https:\/\/[^\s/]+\/\S*$/.test(entry.url) && !Object.hasOwn(entry, 'path'), 'evidence url must be https and replaces path');
      else exists(entry?.path, '.engineering/evidence/');
    }
    if (!legacy) {
      // Journey linkage: behavior changes name the contract they deliver or affect.
      const affected = wp.journeys_affected ?? [];
      const rationale = wp.no_behavior_change ?? null;
      needs(Array.isArray(affected) && affected.every(id => /^J-\d{4}$/.test(id)), 'journeys_affected must be an array of J-NNNN ids');
      needs(rationale === null || text(rationale), 'no_behavior_change must be null or a non-empty rationale');
      const linkedIds = Array.isArray(affected) ? affected : [];
      for (const id of linkedIds) needs(catalog.has(id), `journey ${id} not found in .engineering/journeys/`);
      if (wp.change_impact !== 'C0') needs(rationale === null, 'no_behavior_change is only allowed for C0; it never waives journeys');
      // Terminal packages created before 1.1.0 lack the field and are not reinterpreted.
      const linked = executing.has(wp.status) && profile.criticality !== 'P0' && !(terminal.has(wp.status) && !Object.hasOwn(wp, 'journeys_affected'));
      const report = (c, msg) => { if (!c) (adoption ? warnings.push(`${rel}: ${msg}`) : fail(`${rel}: ${msg}`)); };
      if (linked && wp.change_impact !== 'C0') report(linkedIds.length > 0, 'C1+ work requires journeys_affected');
      if (linked && wp.change_impact === 'C0') report(linkedIds.length > 0 || text(rationale), 'C0 work without journeys requires a no_behavior_change rationale');
      if (linked && ['ready_for_review','accepted'].includes(wp.status) && linkedIds.length) {
        for (const id of linkedIds) report(['aprovada','homologada','retirada'].includes(catalog.get(id)?.meta.status), `journey ${id} must be approved before its work reaches ${wp.status}`);
        report(Array.isArray(wp.evidence) && wp.evidence.some(e => e?.kind === 'gate'), `${wp.status} with journeys requires a gate evidence entry (kind: "gate")`);
      }
    }
    const record = wp.acceptance_record;
    if (wp.status === 'accepted') {
      needs(obj(record) && text(record.actor) && date(record.date) && text(record.rationale), 'accepted requires acceptance_record with actor, date and rationale');
      needs(record?.mode === wp.acceptance_mode, 'acceptance_record mode mismatch');
      if (wp.acceptance_mode === 'review_required') needs(text(record?.reviewer), 'review_required requires reviewer');
    } else needs(record === null, 'acceptance_record only allowed for accepted work');
    if (state.active_work === rel) {
      needs(!terminal.has(wp.status), 'terminal work must not remain active');
      const expected = { proposed: 'bootstrap', authorized: 'ready', in_progress: 'in_progress', blocked: 'blocked', ready_for_review: 'ready_for_review' }[wp.status];
      if (expected) needs(state.status === expected, 'state/work lifecycle mismatch');
    } else needs(terminal.has(wp.status) || wp.status === 'proposed', 'non-terminal executing work must be active');
    if (wp.id === 'WP-ADOPT-001') {
      needs(mods.includes('BROWNFIELD') && wp.change_impact === 'C0' && wp.architecture_impact === 'none', 'adoption must remain BROWNFIELD inventory/characterization only');
      needs(wp.adoption_phase === 'inventory_only', 'adoption_phase must be inventory_only');
    }
  }
  if (!state.active_work) require(!['in_progress','blocked','ready_for_review'].includes(state.status), 'state requires active_work');
  if (state.status === 'accepted') require([...records.values()].some(w => w.status === 'accepted'), 'accepted state requires accepted work');
  if (protocol.mode === 'brownfield') {
    const adoptionWork = records.get('.engineering/work/WP-ADOPT-001.json');
    require(!!adoptionWork, 'brownfield requires WP-ADOPT-001');
    if (adoptionWork?.status !== 'accepted') for (const wp of records.values()) {
      if (wp.id !== 'WP-ADOPT-001') require(['proposed','superseded'].includes(wp.status), 'accept AS-IS baseline before subsequent work');
    }
    if (!legacy && contract.status === 'active') require(adoptionWork?.status === 'accepted', 'brownfield contract can become active only after WP-ADOPT-001 (AS-IS baseline) is accepted');
  }
  return { ok: errors.length === 0, errors, warnings };
}
