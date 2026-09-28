import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { json, hash, safe, load, writeNew } from './fs.js';
import { VERSION, UPGRADABLE, work, contract } from './model.js';
import { check } from './check.js';
import { ciFiles } from './github.js';
const templateRoot = fileURLToPath(new URL('../templates/', import.meta.url));
export function managedFiles() {
  return {
    'ENGINEERING.md': fs.readFileSync(path.join(templateRoot, 'ENGINEERING.md'), 'utf8'),
    '.engineering/adapters/codex.md': fs.readFileSync(path.join(templateRoot, 'AGENTS.md'), 'utf8'),
    '.engineering/templates/ADR.md': fs.readFileSync(path.join(templateRoot, 'ADR.md'), 'utf8'),
    '.engineering/templates/work.json': json(work()),
    '.engineering/templates/journey.md': fs.readFileSync(path.join(templateRoot, 'journey.md'), 'utf8'),
    '.engineering/journeys/README.md': fs.readFileSync(path.join(templateRoot, 'journeys-README.md'), 'utf8')
  };
}
// Project-owned files: created when missing, never refreshed or overwritten.
function seedFiles(status) {
  return { '.engineering/contract.json': json(contract(status)) };
}
function desiredFiles(root, before) {
  const managed = managedFiles();
  if (Object.hasOwn(before.managed_files || {}, 'AGENTS.md')) managed['AGENTS.md'] = managed['.engineering/adapters/codex.md'];
  if (before.ci) Object.assign(managed, ciFiles(before.ci, load(root, '.engineering/project.json').project.criticality));
  return { managed, seeds: seedFiles('adoption') };
}
export function install(root, mode, opts) {
  for (const key of ['name','purpose','criticality','data-authority','production-authority']) {
    const value = opts[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`--${key} is required`);
    if (/__[A-Z][A-Z0-9_]*__|\{\{[^}]+\}\}/.test(value)) throw new Error(`unresolved placeholder in --${key}`);
    if (/-----BEGIN .*PRIVATE KEY|(?:password|token|secret|api[_-]?key)\s*[:=]|\b(?:sk-[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]+)|:\/\/[^\s/@]+:[^\s/@]+@/i.test(value)) throw new Error(`possible secret in --${key}; provide an authority location, never credentials`);
  }
  if (!['P0','P1','P2','P3'].includes(opts.criticality)) throw new Error('invalid project criticality');
  if (fs.existsSync(root) && !fs.statSync(root).isDirectory()) throw new Error('project root must be directory');
  if (mode === 'brownfield' && !fs.existsSync(root)) throw new Error('adopt requires an existing directory');
  if (mode === 'greenfield' && fs.existsSync(root) && fs.readdirSync(root).some(p => p !== '.git')) throw new Error('init requires an empty directory (or .git only); use adopt');
  // Reject an existing overlay, including a partial install or a symlink.
  for (const rel of ['.engineering','ENGINEERING.md']) {
    const p = safe(root, rel); if (fs.existsSync(p)) throw new Error(`collision: ${rel}; no files changed`);
  }
  const now = new Date().toISOString();
  const managed = managedFiles();
  let existingAdapter = false;
  try { fs.lstatSync(path.join(root, 'AGENTS.md')); existingAdapter = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!existingAdapter) managed['AGENTS.md'] = managed['.engineering/adapters/codex.md'];
  const project = {
    schema_version: 1,
    project: { name: opts.name, purpose: opts.purpose, criticality: opts.criticality, quality_priorities: [] },
    authorities: {
      code: { kind: fs.existsSync(path.join(root, '.git')) ? 'git' : 'files', location: 'this project' },
      data: { kind: 'declared', location: opts['data-authority'] },
      secrets: { kind: 'external', location: 'operator-managed secret store; never commit values' },
      decisions: { kind: 'files', location: '.engineering/decisions/' },
      state: { kind: 'file', location: '.engineering/state.json' },
      production: { kind: 'declared', location: opts['production-authority'] }
    }
  };
  const adoption = mode === 'brownfield';
  const state = { schema_version: 1, status: adoption ? 'ready' : 'bootstrap', current_checkpoint: null,
    active_work: adoption ? '.engineering/work/WP-ADOPT-001.json' : null,
    next_action: adoption ? 'Inventory existing authorities and characterize AS-IS behavior; submit the baseline for explicit owner review.' : 'Frame the first work package, confirm authorities, and record scope authorization before implementation.',
    blocked_by: [], prohibited: ['Do not implement outside authorized scope.', 'Do not infer acceptance from evidence.', 'Do not approve, homologate or retire journeys on the owner\'s behalf.',
      ...(adoption ? ['Do not refactor, migrate, deploy, reorganize application code or change business data before AS-IS baseline acceptance.'] : ['Do not implement behavior before its journey is approved by the owner.'])], last_verified_commit: null };
  const protocol = { schema_version: 1, name: 'ai-engineering', version: VERSION, mode, installed_at: now,
    source: `ai-engineering@${VERSION}`, compatibility: { schema_version: 1, minimum_cli: VERSION },
    git_detected: fs.existsSync(path.join(root, '.git')), existing_agent_instructions_preserved: existingAdapter,
    managed_files: Object.fromEntries(Object.entries(managed).map(([p, content]) => [p, hash(content)])) };
  const contents = { ...managed, ...seedFiles(adoption ? 'adoption' : 'active'), '.engineering/project.json': json(project), '.engineering/state.json': json(state), '.engineering/protocol.json': json(protocol),
    '.engineering/decisions/.gitkeep': '', '.engineering/evidence/.gitkeep': '', '.engineering/work/.gitkeep': '' };
  if (adoption) {
    const wp = { ...work(opts.criticality), id: 'WP-ADOPT-001', status: 'authorized', change_impact: 'C0', modifiers: ['BROWNFIELD'],
      objective: 'Inventory and characterize the AS-IS baseline for owner review.',
      scope: ['Read existing code, documentation and declared authorities.', 'Record architecture, integration and data boundaries without copying credentials.', 'Capture existing tests and gaps; run only understood, safe characterization checks.', 'Propose candidate journeys of observed critical behavior as drafts (rascunho) for owner review; never approve them.'],
      journeys_affected: [], no_behavior_change: 'Inventory and characterization only; application behavior is not changed.',
      non_goals: ['Refactoring', 'Migration', 'Deployment', 'Business data changes', 'Application code reorganization'],
      acceptance: ['Owner reviews and explicitly accepts the AS-IS baseline and authority map.'],
      evidence_required: ['Inventory and safe characterization evidence with limitations.'],
      authorization_record: { actor: opts.operator || 'local operator invoking adopt', date: now, scope: 'Inventory/characterization only, authorized by adopt invocation.' }, adoption_phase: 'inventory_only' };
    contents['.engineering/work/WP-ADOPT-001.json'] = json(wp);
  }
  // Validate the complete overlay before creating any project file.
  const stage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-engineering-stage-')));
  try {
    for (const [rel, content] of Object.entries(contents)) writeNew(stage, rel, content);
    const result = check(stage); if (!result.ok) throw new Error(result.errors.join('\n'));
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  const created = [];
  try {
    fs.mkdirSync(root, { recursive: true });
    for (const [rel, content] of Object.entries(contents)) { writeNew(root, rel, content); created.push(rel); }
  } catch (error) {
    for (const rel of created.reverse()) fs.unlinkSync(safe(root, rel));
    throw error;
  }
  return { mode, version: VERSION, files_created: created.length, git_detected: protocol.git_detected, existing_agent_instructions_preserved: existingAdapter };
}
export function migrationPlan(root) {
  const before = load(root, '.engineering/protocol.json');
  if (before.name !== 'ai-engineering' || before.schema_version !== 1 || before.compatibility?.schema_version !== 1) throw new Error('unsupported protocol/schema; manual migration required');
  if (!UPGRADABLE.test(before.version)) throw new Error('unsupported version or downgrade; manual migration required');
  const validation = check(root, { allowOlder: true });
  if (!validation.ok) throw new Error(`repair project before upgrading:\n${validation.errors.join('\n')}`);
  const { managed: desired, seeds } = desiredFiles(root, before);
  const actions = [];
  for (const [rel, content] of Object.entries(seeds)) if (!fs.existsSync(safe(root, rel))) actions.push({ path: rel, action: 'add', seed: true, after: hash(content) });
  for (const [rel, content] of Object.entries(desired)) {
    const file = safe(root, rel);
    if (!fs.existsSync(file)) actions.push({ path: rel, action: 'add', after: hash(content) });
    else {
      const current = hash(fs.readFileSync(file));
      actions.push({ path: rel, action: current === hash(content) ? 'unchanged' : current === before.managed_files?.[rel] ? 'replace' : 'preserve_local', before: current, after: hash(content) });
    }
  }
  return { from: before.version, to: VERSION, schema_version: 1, actions,
    preserved: ['.engineering/project.json', '.engineering/state.json', '.engineering/contract.json', '.engineering/journeys/J-*.md', '.engineering/work/', '.engineering/decisions/', '.engineering/evidence/', 'all application files'],
    note: 'Schema-1 overlay refresh only. Locally edited managed files are preserved; inspect their diff against the supplied incoming template. A newly added contract starts in adoption until the owner activates it.' };
}
export function upgrade(root, plan) {
  // Recompute immediately before mutation to detect intervening project changes.
  if (json(plan) !== json(migrationPlan(root))) throw new Error('project changed since migration preview; rerun upgrade');
  if (plan.from === VERSION && !plan.actions.some(a => ['add','replace'].includes(a.action))) return { changed: false, plan };
  const oldRaw = fs.readFileSync(safe(root, '.engineering/protocol.json'));
  const before = JSON.parse(oldRaw);
  const files = desiredFiles(root, before);
  const desired = { ...files.managed, ...files.seeds };
  const backup = `.engineering/upgrades/${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  writeNew(root, `${backup}/plan.json`, json(plan));
  writeNew(root, `${backup}/before/protocol.json`, oldRaw);
  for (const a of plan.actions) {
    if (a.before) writeNew(root, `${backup}/before/${a.path}`, fs.readFileSync(safe(root, a.path)));
    writeNew(root, `${backup}/incoming/${a.path}`, desired[a.path]);
  }
  const next = { ...before, version: VERSION, source: `ai-engineering@${VERSION}`, upgraded_at: new Date().toISOString(),
    compatibility: { ...before.compatibility, minimum_cli: VERSION }, managed_files: { ...before.managed_files } };
  const staged = [], applied = [], errors = [];
  try {
    for (const a of plan.actions) {
      if (a.action !== 'preserve_local' && !a.seed) next.managed_files[a.path] = a.after;
    }
    const changes = [...plan.actions.filter(a => ['add','replace'].includes(a.action)),
      { path: '.engineering/protocol.json', action: 'replace' }];
    // Prepare every write (including rollback bytes) before touching a destination.
    // Sibling staging keeps each commit/restore on the destination filesystem.
    for (const a of changes) {
      const target = safe(root, a.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const dir = fs.mkdtempSync(path.join(path.dirname(target), '.ai-engineering-upgrade-'));
      const entry = { ...a, target, dir, incoming: path.join(dir, path.basename(target)), original: path.join(dir, 'original') };
      staged.push(entry); // Cleanup owns even a partially written staging file.
      const mode = a.action === 'add' ? 0o600 : fs.statSync(target).mode & 0o777;
      if (a.action === 'replace') {
        const saved = a.path === '.engineering/protocol.json' ? 'protocol.json' : a.path;
        fs.writeFileSync(entry.original, fs.readFileSync(safe(root, `${backup}/before/${saved}`)), { flag: 'wx', mode });
      }
      fs.writeFileSync(entry.incoming, a.path === '.engineering/protocol.json' ? json(next) : desired[a.path], { flag: 'wx', mode });
    }
    for (const entry of staged) {
      // link publishes additions exclusively; rename atomically replaces existing files.
      // Neither operation exposes a partially written destination on supported filesystems.
      if (entry.action === 'add') fs.linkSync(entry.incoming, entry.target);
      else fs.renameSync(entry.incoming, entry.target);
      applied.push(entry);
    }
    const result = check(root); if (!result.ok) throw new Error(result.errors.join('\n'));
  } catch (error) {
    errors.push(error);
    for (const entry of applied.reverse()) {
      try {
        if (entry.action === 'add') fs.unlinkSync(safe(root, entry.path));
        else fs.renameSync(entry.original, safe(root, entry.path));
      } catch (recoveryError) {
        errors.push(new Error(`rollback failed for ${entry.path}: ${recoveryError.message}`, { cause: recoveryError }));
      }
    }
  }
  for (const entry of staged) {
    try { fs.rmSync(entry.dir, { recursive: true, force: true }); }
    catch (cleanupError) { errors.push(new Error(`staging cleanup failed for ${entry.dir}: ${cleanupError.message}`, { cause: cleanupError })); }
  }
  if (errors.length > 1) throw new AggregateError(errors, `upgrade errors; inspect backup ${backup}: ${errors.map(e => e.message).join('; ')}`);
  if (errors.length) throw errors[0];
  return { changed: true, backup, plan };
}
export function bootstrap(root) {
  const result = check(root);
  if (!result.ok) throw new Error(`resolve protocol conflicts before recovery:\n${result.errors.join('\n')}`);
  const state = load(root, '.engineering/state.json');
  const wp = state.active_work ? load(root, state.active_work) : null;
  const contractStatus = load(root, '.engineering/contract.json').status;
  return [
    'Resume this project using its engineering protocol.',
    'Read ENGINEERING.md, .engineering/protocol.json, .engineering/project.json, .engineering/contract.json and .engineering/state.json in that order.',
    `The operational contract is ${contractStatus}; journeys live in .engineering/journeys/ (list them with ai-engineering journey list).`,
    state.active_work ? `Read active_work: ${state.active_work}.` : 'There is no active work; frame and authorize the next work package before implementation.',
    ...(wp?.journeys_affected || []).map(id => `Read affected journey: .engineering/journeys/${id}.md.`),
    ...(wp?.decision_refs || []).map(ref => `Read referenced decision: ${ref}.`),
    'Use the current state and work package to recover the next action, scope, prohibitions and acceptance policy. Do not infer these from chat history.',
    'Read any existing AGENTS.md; the optional Codex adapter is .engineering/adapters/codex.md. Stop on material authority conflicts.',
    'Run ai-engineering check --dir . before and after non-trivial work. Never edit approved journeys, their tests, the contract or gate files to make a result pass.',
    'Evidence is not acceptance; only the owner approves journeys, homologates and accepts work. Stop at the declared review boundary.'
  ].join('\n') + '\n';
}
