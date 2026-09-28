import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { json, hash, safe, load, writeNew } from './fs.js';
import { VERSION } from './model.js';
import { check } from './check.js';
import * as J from './journeys.js';
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const kit = name => fs.readFileSync(path.join(packageRoot, 'templates', 'github', name), 'utf8');
const LEVEL = { P0: 0, P1: 1, P2: 2, P3: 3 };
const OWNER = /^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9._-]+)?$/;
const BRANCH = /^[A-Za-z0-9._\/-]+$/;
export const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
function walk(dir, prefix) {
  return fs.readdirSync(path.join(packageRoot, dir), { withFileTypes: true }).filter(e => !e.name.startsWith('.')).flatMap(e =>
    e.isDirectory() ? walk(`${dir}/${e.name}`, prefix) : [[`${prefix}/${dir}/${e.name}`, fs.readFileSync(path.join(packageRoot, dir, e.name), 'utf8')]]);
}
// The gate tool is vendored so CI can judge a change with the régua already on the main branch.
export function toolFiles() {
  return Object.fromEntries([
    ['.engineering/tool/bin/ai-engineering.js', fs.readFileSync(path.join(packageRoot, 'bin', 'ai-engineering.js'), 'utf8')],
    ...walk('src', '.engineering/tool'), ...walk('templates', '.engineering/tool'),
    ['.engineering/tool/package.json', json({ name: 'ai-engineering-vendored', version: VERSION, private: true, type: 'module' })],
    // Recorded hashes are of LF bytes; keep Windows autocrlf checkouts byte-identical.
    ['.engineering/tool/.gitattributes', '* text eol=lf\n'],
    ['.engineering/tool/README.md', `# Régua do projeto (ai-engineering ${VERSION})\n\nCópia usada pelo CI para julgar mudanças com a régua já aprovada no branch principal.\nNão edite: atualize com \`ai-engineering upgrade\`. Qualquer alteração exige revisão do dono.\n`]
  ]);
}
// Managed CI files: refreshed by upgrade when unmodified, preserved when locally adapted.
export function ciFiles(ci, criticality) {
  const fill = s => s.replaceAll('@VERSION@', VERSION).replaceAll('@BRANCH@', ci.branch).replaceAll('@OWNER@', ci.owner)
    .replaceAll('@ALL@', LEVEL[criticality] >= 2 ? `*                             ${ci.owner}` : '');
  const files = { ...toolFiles(), '.github/workflows/verificacao.yml': fill(kit('verificacao.yml')) };
  if (LEVEL[criticality] >= 2) Object.assign(files, { '.github/workflows/operacao.yml': fill(kit('operacao.yml')), '.github/workflows/pos-deploy.yml': fill(kit('pos-deploy.yml')) });
  if (ci.codeowners === 'managed') files['.github/CODEOWNERS'] = fill(kit('CODEOWNERS'));
  return files;
}
export function setup(root, { owner, branch = 'main', e2e = 'playwright' }) {
  if (!OWNER.test(owner || '')) throw new Error('--owner must be a GitHub @user or @org/team (never the agent identity)');
  if (!BRANCH.test(branch) || branch.includes('..')) throw new Error('invalid --branch');
  if (!['playwright','custom'].includes(e2e)) throw new Error('--e2e must be playwright or custom');
  const before = check(root);
  if (!before.ok) throw new Error(`repair project before GitHub setup:\n${before.errors.join('\n')}`);
  const protocolRaw = fs.readFileSync(safe(root, '.engineering/protocol.json'));
  const protocol = JSON.parse(protocolRaw);
  if (protocol.ci) throw new Error('GitHub kit already installed; use ai-engineering upgrade to refresh it');
  const criticality = load(root, '.engineering/project.json').project.criticality;
  const existingOwners = CODEOWNERS_PATHS.filter(rel => fs.existsSync(safe(root, rel)));
  const ci = { provider: 'github', owner, branch, e2e, codeowners: existingOwners.length ? 'existing' : 'managed', installed_at: new Date().toISOString() };
  const managed = ciFiles(ci, criticality);
  const seeds = { 'tests/journeys/README.md': kit('tests-journeys-README.md'), ...(e2e === 'playwright' ? { 'playwright.config.ts': kit('playwright.config.ts') } : {}) };
  const skipped = [];
  for (const rel of Object.keys(seeds)) if (fs.existsSync(safe(root, rel)) || (rel === 'playwright.config.ts' && ['js','mjs','cjs'].some(e => fs.existsSync(safe(root, `playwright.config.${e}`))))) { skipped.push(rel); delete seeds[rel]; }
  for (const rel of Object.keys(managed)) if (fs.existsSync(safe(root, rel))) throw new Error(`collision: ${rel}; no files changed`);
  const created = [];
  const next = { ...protocol, ci, managed_files: { ...protocol.managed_files, ...Object.fromEntries(Object.entries(managed).map(([p, c]) => [p, hash(c)])) } };
  const metadata = safe(root, '.engineering/protocol.json');
  try {
    for (const [rel, content] of Object.entries({ ...managed, ...seeds })) { writeNew(root, rel, content); created.push(rel); }
    const staged = `${metadata}.ai-engineering-setup`;
    fs.writeFileSync(staged, json(next), { flag: 'wx', mode: fs.statSync(metadata).mode & 0o777 });
    fs.renameSync(staged, metadata);
    const after = check(root); if (!after.ok) throw new Error(after.errors.join('\n'));
  } catch (error) {
    for (const rel of created.reverse()) try { fs.unlinkSync(safe(root, rel)); } catch {}
    fs.rmSync(`${metadata}.ai-engineering-setup`, { force: true });
    fs.writeFileSync(metadata, protocolRaw);
    throw error;
  }
  const lines = existingOwners.length ? codeownersLines(owner, criticality) : [];
  return { provider: 'github', owner, branch, files_created: created.length, seeds_skipped: skipped, codeowners: ci.codeowners,
    ...(lines.length ? { add_to_existing_codeowners: lines } : {}),
    next_steps: ['Adapt only the commands marked ADAPTAR in .github/workflows/.', `Create a ruleset for ${branch}: require pull requests, code-owner review and the status check "pode-integrar"; block force pushes and deletion; keep the bypass list empty.`,
      'Give the coding agent its own GitHub identity without admin, bypass or Workflows permission.', 'Run ai-engineering github verify after configuring the ruleset.'] };
}
function codeownersLines(owner, criticality) {
  const rules = kit('CODEOWNERS').split('\n').filter(l => l.startsWith('/'))
    .map(l => l.replaceAll('@OWNER@', owner));
  return LEVEL[criticality] >= 2 ? [...rules, `* ${owner}`] : rules;
}
// CODEOWNERS uses gitignore-style patterns; the last matching line wins.
export function owners(content, file) {
  let result = null;
  for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const [pattern, ...who] = line.split(/\s+/);
    if (patternRegex(pattern).test(file)) result = who;
  }
  return result || [];
}
function patternRegex(p) {
  let anchored = p.startsWith('/'); if (anchored) p = p.slice(1);
  const dir = p.endsWith('/'); if (dir) p = p.slice(0, -1);
  if (p.includes('/')) anchored = true;
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') { if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i++; } }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}${dir ? '/.*' : '(?:/.*)?'}$`);
}
function gh(args, cwd) {
  const r = spawnSync('gh', args, { cwd, encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') throw new Error('GitHub CLI (gh) not found; install it or pass --rules-json');
  if (r.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}
export function verify(root, { repo, branch, rulesJson } = {}) {
  const criticality = load(root, '.engineering/project.json').project.criticality;
  const protocol = load(root, '.engineering/protocol.json');
  branch ||= protocol.ci?.branch || 'main';
  let rules;
  if (rulesJson) rules = JSON.parse(fs.readFileSync(rulesJson, 'utf8'));
  else {
    repo ||= gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], root);
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !BRANCH.test(branch)) throw new Error('invalid --repo or --branch');
    rules = JSON.parse(gh(['api', `repos/${repo}/rules/branches/${encodeURIComponent(branch)}`], root) || '[]');
  }
  if (!Array.isArray(rules)) throw new Error('rules must be the JSON array returned by GET /repos/{owner}/{repo}/rules/branches/{branch}');
  const of = type => rules.filter(r => r?.type === type);
  const pr = of('pull_request').map(r => r.parameters || {});
  const checks = of('required_status_checks').flatMap(r => r.parameters?.required_status_checks || []).map(c => c.context);
  const strict = of('required_status_checks').some(r => r.parameters?.strict_required_status_checks_policy);
  const approvals = Math.max(0, ...pr.map(p => p.required_approving_review_count || 0));
  const minApprovals = { P0: 0, P1: 0, P2: 1, P3: 2 }[criticality];
  const level = LEVEL[criticality];
  const items = [];
  const need = (ok, item, from = 1) => { if (level >= from) items.push({ ok: !!ok, item }); };
  need(pr.length, 'Mudanças no branch principal só entram por pull request');
  need(checks.includes('pode-integrar'), 'O check "pode-integrar" é obrigatório para integrar');
  need(pr.some(p => p.require_code_owner_review), 'Revisão do dono (code owner) obrigatória nos arquivos da régua');
  need(of('non_fast_forward').length, 'Force push bloqueado');
  need(of('deletion').length, 'Exclusão do branch bloqueada');
  need(approvals >= minApprovals, `Pelo menos ${minApprovals} aprovação(ões) em todo pull request (atual: ${approvals})`, 2);
  need(pr.some(p => p.dismiss_stale_reviews_on_push), 'Aprovações antigas caem quando chegam commits novos', 2);
  need(pr.some(p => p.require_last_push_approval), 'O último push precisa ser aprovado por outra pessoa', 2);
  need(strict, 'Branch precisa estar atualizado com o principal antes de integrar', 2);
  // Local repository files the ruleset relies on.
  const codeowners = CODEOWNERS_PATHS.find(rel => fs.existsSync(safe(root, rel)));
  const content = codeowners ? fs.readFileSync(safe(root, codeowners), 'utf8') : '';
  const guarded = ['.engineering/contract.json', '.engineering/project.json', '.engineering/journeys/J-0001.md', '.engineering/work/WP-0001.json',
    '.engineering/tool/bin/ai-engineering.js', '.github/workflows/verificacao.yml', codeowners || '.github/CODEOWNERS',
    ...[...J.load(root).journeys.values()].filter(j => J.ACTIVE.has(j.meta.status) && j.meta.teste).map(j => j.meta.teste)];
  const unowned = guarded.filter(f => !owners(content, f).length);
  need(codeowners, 'Arquivo CODEOWNERS presente');
  need(codeowners && !unowned.length, `CODEOWNERS cobre a régua${unowned.length ? ` (faltam: ${unowned.join(', ')})` : ''}`);
  if (protocol.ci?.owner) need(codeowners && guarded.every(f => owners(content, f).includes(protocol.ci.owner)), `A régua pertence a ${protocol.ci.owner}`);
  if (level >= 2 && protocol.ci?.owner) {
    const last = content.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).at(-1) || '';
    const [pattern, reviewer, extra] = last.split(/\s+/);
    need(codeowners && pattern === '*' && reviewer === protocol.ci.owner && !extra,
      `Código e classificação C0 exigem regra global final de ${protocol.ci.owner}`);
  }
  need(fs.existsSync(safe(root, '.github/workflows/verificacao.yml')), 'Workflow de verificação instalado');
  let workflows = [];
  try { workflows = fs.readdirSync(safe(root, '.github/workflows')).filter(f => /\.ya?ml$/.test(f)); } catch {}
  const unpinned = workflows.flatMap(f => [...fs.readFileSync(safe(root, `.github/workflows/${f}`), 'utf8').matchAll(/uses:\s*([^\s#]+)@([^\s#]+)/g)]
    .filter(m => !/^[0-9a-f]{40}$/.test(m[2])).map(m => `${f}: ${m[1]}@${m[2]}`));
  need(!unpinned.length, `Actions fixadas por SHA completo${unpinned.length ? ` (${unpinned.length} por tag)` : ''}`, 3);
  const ok = items.every(i => i.ok);
  return { ok, criticality, branch, repo: repo || null, items,
    not_verifiable: ['Lista de bypass do ruleset vazia (ou só o dono): a API só mostra para quem tem permissão de escrita no ruleset.',
      'A IA usa identidade própria, sem admin, sem bypass e sem permissão "Workflows" no token.',
      'O plano do GitHub permite rulesets no repositório privado (Pro, Team ou Enterprise).',
      'O dono lê o relatório e as mudanças na régua antes de aprovar.'] };
}
