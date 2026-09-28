import fs from 'node:fs';
import path from 'node:path';
import { load, safe, files, hash } from './fs.js';
import { VERSION } from './model.js';
import { check } from './check.js';
import * as J from './journeys.js';
// Two separate questions (continuous delivery practice): may this change be
// integrated without regressing the contract, and may this version be released?
const SKEW_MS = 5 * 60 * 1000;
const DIM = { funcional: 'Funcional', integracao: 'Integração', operacao: 'Operação', seguranca: 'Segurança/dados' };
const LEVEL = { P0: 0, P1: 1, P2: 2, P3: 3 };
const LAYER = { success: 'sucesso', failure: 'falhou', not_configured: 'não configurada', not_run: 'não executada', skipped: 'pulada', cancelled: 'cancelada' };
const text = x => typeof x === 'string' && !!x.trim();
// Timestamps must carry a timezone; ambiguous local times are not proof.
const time = v => { if (!text(v) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const clean = s => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').map(l => l.trim()).find(Boolean)?.slice(0, 200) || '';
function fileEvidence(dir, value) {
  if (!text(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null; // self-reported URLs are not proof
  const inside = p => { const r = path.relative(dir, p); return r && !r.startsWith('..') && !path.isAbsolute(r); };
  // Playwright records the runner's absolute path; after artifact download the file lives under test-results/.
  const marker = value.replace(/\\/g, '/').indexOf('test-results/');
  const candidates = [path.resolve(dir, value), ...(marker >= 0 ? [path.resolve(dir, value.replace(/\\/g, '/').slice(marker))] : [])];
  const hit = candidates.find(p => inside(p) && fs.existsSync(p) && fs.statSync(p).isFile());
  if (hit) return path.relative(dir, hit).split(path.sep).join('/');
  return path.isAbsolute(value) && fs.existsSync(value) && fs.statSync(value).isFile() ? value : null;
}
function playwright(data, dir, add) {
  const walk = (suite, trail) => {
    for (const spec of suite.specs || []) {
      const tags = (spec.tags || []).map(t => '@' + String(t).replace(/^@/, '')).join(' ');
      const ids = new Set((`${trail} ${spec.title || ''} ${tags}`.match(/@J-\d{4}\b/g) || []).map(t => t.slice(1)));
      for (const test of spec.tests || []) {
        const runs = test.results || [], last = runs[runs.length - 1] || {};
        const status = test.status || { passed: 'expected', skipped: 'skipped' }[last.status] || 'unexpected';
        const errs = last.errors?.length ? last.errors : last.error ? [last.error] : [];
        const attachment = ['video','trace','screenshot'].map(n => (last.attachments || []).find(a => a.name === n && a.path)).find(Boolean);
        for (const id of ids) add(id, { outcome: status === 'skipped' ? 'skipped' : ['expected','flaky'].includes(status) ? 'pass' : 'fail',
          flaky: status === 'flaky', reason: status === 'unexpected' ? clean(errs[0]?.message) || `status ${last.status || status}` : '',
          evidence: fileEvidence(dir, attachment?.path), at: time(last.startTime) });
      }
    }
    for (const child of suite.suites || []) walk(child, `${trail} ${child.title || ''}`);
  };
  for (const suite of data.suites) walk(suite, suite.title || '');
  return time(data.stats?.startTime);
}
// One results file is one execution: every test of a journey must pass in it.
export function readRun(file, { runUrl = null, source = 'current' } = {}) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = path.dirname(path.resolve(file));
  const found = new Map();
  const add = (id, r) => { const list = found.get(id) || []; list.push(r); found.set(id, list); };
  let at;
  if (Array.isArray(data?.suites)) at = playwright(data, dir, add);
  else if (data && typeof data.journeys === 'object' && data.journeys) {
    at = time(data.generated_at);
    for (const [id, r] of Object.entries(data.journeys)) add(id, { outcome: ['pass','fail'].includes(r?.result) ? r.result : 'fail',
      flaky: false, reason: r?.result === 'fail' ? clean(r.reason) || 'falhou' : ['pass','fail'].includes(r?.result) ? '' : `resultado inválido: ${String(r?.result).slice(0, 40)}`,
      evidence: fileEvidence(dir, r?.evidence), at: time(r?.at) || at });
  } else throw new Error('unrecognized results format (expected Playwright JSON or {"journeys": {...}})');
  const records = new Map();
  for (const [id, list] of found) {
    const ran = list.filter(r => r.outcome !== 'skipped');
    if (!ran.length) continue;
    const failed = ran.find(r => r.outcome === 'fail');
    const stamps = ran.map(r => r.at).filter(Boolean);
    records.set(id, { result: failed ? 'fail' : 'pass', reason: failed?.reason || '', flaky: !failed && ran.some(r => r.flaky),
      evidence: failed?.evidence || ran.map(r => r.evidence).find(Boolean) || null, at: stamps.length === ran.length ? new Date(Math.min(...stamps)) : at || null,
      run_url: runUrl, source, provenance: runUrl ? 'ci' : 'local', file: path.basename(file) });
  }
  return records;
}
function merge(target, records) {
  for (const [id, r] of records) {
    const prev = target.get(id);
    const newer = !prev || (r.at?.getTime() ?? -Infinity) > (prev.at?.getTime() ?? -Infinity);
    const tie = prev && (r.at?.getTime() ?? -Infinity) === (prev.at?.getTime() ?? -Infinity);
    if (newer || (tie && r.result === 'fail')) target.set(id, r);
  }
}
function digest(root, rel) { try { return hash(fs.readFileSync(safe(root, rel))); } catch { return null; } }
function listing(root, rel) { try { return files(root, rel); } catch { return []; } }
function json(root, rel) { try { return load(root, rel); } catch { return null; } }
// Changes to the measuring stick are surfaced in plain language for owner review.
export function reguaChanges(baseRoot, headRoot, head) {
  const out = [];
  const base = J.load(baseRoot).journeys;
  for (const id of [...new Set([...base.keys(), ...head.keys()])].sort()) {
    const b = base.get(id), h = head.get(id), name = `${id} "${(h || b).meta.titulo}"`;
    if (!b) { out.push(`Nova jornada ${name} (${h.meta.status})`); continue; }
    if (!h) { out.push(`Jornada ${name} foi apagada`); continue; }
    if (b.meta.status !== h.meta.status) out.push(`Jornada ${name}: situação ${b.meta.status} → ${h.meta.status}${h.meta.status === 'retirada' ? ` (motivo: ${h.meta.motivo_retirada || 'não informado'})` : ''}`);
    if (b.hash !== h.hash) out.push(`Jornada ${name}: texto ou dados do contrato alterados`);
    if ((J.ACTIVE.has(b.meta.status) || J.ACTIVE.has(h.meta.status)) && text(h.meta.teste) && digest(baseRoot, b.meta.teste) !== digest(headRoot, h.meta.teste)) out.push(`Teste da jornada ${id} alterado (${h.meta.teste})`);
  }
  // Helpers, fixtures and operation scripts can weaken every journey without touching a spec.
  const reported = new Set([...head.values(), ...base.values()].map(j => j.meta.teste));
  for (const dir of ['tests/journeys', 'scripts/operacao']) {
    const all = new Set([...listing(baseRoot, dir), ...listing(headRoot, dir)]);
    for (const rel of [...all].sort()) if (!reported.has(rel) && digest(baseRoot, rel) !== digest(headRoot, rel)) out.push(`Arquivo de apoio das jornadas alterado: ${rel}`);
  }
  const scripts = r => Object.fromEntries(Object.entries(json(r, 'package.json')?.scripts || {}).filter(([k]) => /^test/.test(k)));
  const [bs, hs] = [scripts(baseRoot), scripts(headRoot)];
  const changedScripts = [...new Set([...Object.keys(bs), ...Object.keys(hs)])].filter(k => bs[k] !== hs[k]).sort();
  if (changedScripts.length) out.push(`Comandos de teste alterados em package.json: ${changedScripts.join(', ')}`);
  const [bc, hc] = [json(baseRoot, '.engineering/contract.json'), json(headRoot, '.engineering/contract.json')];
  if (bc?.status !== hc?.status) out.push(`Contrato operacional: ${bc?.status || 'inexistente'} → ${hc?.status || 'inexistente'}`);
  else if (JSON.stringify(bc) !== JSON.stringify(hc)) out.push('Exigências do contrato operacional alteradas (.engineering/contract.json)');
  const [bp, hp] = [json(baseRoot, '.engineering/project.json'), json(headRoot, '.engineering/project.json')];
  const [bl, hl] = [bp?.project?.criticality, hp?.project?.criticality];
  if (bl !== hl) out.push(`Criticidade do projeto ${bl || '?'} → ${hl || '?'}${(LEVEL[hl] ?? 9) < (LEVEL[bl] ?? 0) ? ' — REDUZ as exigências' : ''}`);
  if (JSON.stringify(bp?.authorities) !== JSON.stringify(hp?.authorities)) out.push('Mapa de autoridades alterado (.engineering/project.json)');
  const tool = new Set([...listing(baseRoot, '.engineering/tool'), ...listing(headRoot, '.engineering/tool')]);
  const toolChanged = [...tool].filter(rel => digest(baseRoot, rel) !== digest(headRoot, rel));
  if (toolChanged.length) out.push(`Régua instalada (.engineering/tool) alterada: ${toolChanged.length} arquivo(s)`);
  const guarded = new Set(['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS', ...['ts','js','mjs','cjs'].map(e => `playwright.config.${e}`),
    ...listing(baseRoot, '.github/workflows'), ...listing(headRoot, '.github/workflows')]);
  for (const rel of [...guarded].sort()) if (digest(baseRoot, rel) !== digest(headRoot, rel)) out.push(`Arquivo de verificação alterado: ${rel}`);
  return out;
}
export function gate(root, { mode, base = null, results = [], periodic = [], baseline = null, layers = {}, now = new Date(), env = process.env }) {
  if (!['integration','release'].includes(mode)) throw new Error('--mode must be integration or release');
  const blockers = [], warnings = [];
  const structural = check(root);
  if (!structural.ok) blockers.push(`Verificação estrutural falhou (${structural.errors.length}): ${structural.errors.slice(0, 8).join('; ')}${structural.errors.length > 8 ? '; …' : ''}`);
  const project = json(root, '.engineering/project.json') || {};
  const contract = json(root, '.engineering/contract.json') || {};
  const crit = project.project?.criticality || '?';
  const catalog = J.load(root).journeys;
  const windows = contract.periodic_windows_hours || {};
  const runUrl = env.GITHUB_ACTIONS === 'true' && /^\d+$/.test(env.GITHUB_RUN_ID || '') && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '')
    ? `${/^https:\/\/[^\s/]+$/.test(env.GITHUB_SERVER_URL || '') ? env.GITHUB_SERVER_URL : 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  const current = new Map(), scheduled = new Map();
  for (const file of results) {
    try { merge(current, readRun(file, { runUrl, source: 'current' })); }
    catch (e) { blockers.push(`Resultado ${path.basename(file)} ausente ou inválido: ${e.message}`); }
  }
  for (const { file, url } of periodic) {
    try { merge(scheduled, readRun(file, { runUrl: url || null, source: 'periodic' })); }
    catch (e) { warnings.push(`Resultado periódico ${path.basename(file)} ausente ou inválido: ${e.message}`); }
  }
  const regua = base && path.resolve(base) !== path.resolve(root) ? reguaChanges(base, root, catalog) : [];
  if (base && fs.existsSync(path.join(root, '.engineering/tool')) && !fs.existsSync(path.join(base, '.engineering/tool'))) warnings.push('O branch principal ainda não tem a régua instalada: este resultado usa a régua deste próprio pedido de mudança.');
  let prior = null;
  if (baseline) {
    try { prior = JSON.parse(fs.readFileSync(baseline, 'utf8')); if (typeof prior?.journeys !== 'object' || !prior.journeys) throw new Error('journeys missing'); }
    catch (e) { prior = null; warnings.push(`Linha de base ilegível (${e.message}); protegendo apenas jornadas homologadas.`); }
  }
  const active = [...catalog.values()].filter(j => J.ACTIVE.has(j.meta.status)).sort((a, b) => a.meta.id.localeCompare(b.meta.id));
  const rows = [];
  for (const j of active) {
    const { id } = j.meta, periodicJourney = (windows[j.meta.frequencia] ?? 0) > 0;
    // Periodic proofs come from scheduled runs; per-change proofs only from this run.
    const rec = periodicJourney ? [current.get(id), scheduled.get(id)].filter(Boolean).sort((a, b) => (b.at?.getTime() ?? -1) - (a.at?.getTime() ?? -1))[0] : current.get(id);
    const window = windows[j.meta.frequencia] ?? 0;
    let state, why;
    if (j.meta.aprovada_hash !== j.hash) [state, why] = ['integrity', 'o contrato da jornada mudou depois da aprovação'];
    else if (!rec) [state, why] = ['missing', periodicJourney ? 'nenhuma execução periódica encontrada' : 'não foi executada nesta verificação'];
    else if (rec.result !== 'pass') [state, why] = ['fail', rec.reason || 'falhou'];
    else if (!rec.at || rec.at.getTime() > now.getTime() + SKEW_MS) [state, why] = ['invalid', 'prova inválida: data ausente ou no futuro'];
    else if (!rec.evidence && !rec.run_url) [state, why] = ['invalid', 'prova inválida: sem vídeo/arquivo de evidência nem execução de CI'];
    else if (window && now.getTime() - rec.at.getTime() > window * 3600e3) [state, why] = ['expired', `última prova vencida (validade ${window}h)`];
    else if (mode === 'release' && LEVEL[crit] >= 2 && rec.provenance !== 'ci') [state, why] = ['invalid', `prova local não vale para liberação em ${crit}; precisa vir do CI`];
    else [state, why] = [j.meta.status === 'homologada' ? 'ok' : 'rehearsal', j.meta.status === 'homologada' ? '' : 'verde — aguarda seu ensaio'];
    if (rec?.flaky && rec.result === 'pass') warnings.push(`${id}: passou só depois de nova tentativa (instável)`);
    rows.push({ j, rec, state, why, periodic: periodicJourney });
  }
  const required = contract.internal_layers_required?.[crit] || [];
  for (const layer of required) {
    const s = layers[layer] || 'not_run';
    if (s === 'success') continue;
    if (s === 'not_configured' && mode === 'integration' && prior?.layers?.[layer] !== 'success') warnings.push(`Camada interna '${layer}' ainda não configurada (bloqueará a liberação)`);
    else blockers.push(`Camada interna '${layer}': ${s === 'not_configured' && prior?.layers?.[layer] === 'success' ? 'deixou de ser executada (passava no branch principal)' : LAYER[s] || s}`);
  }
  if (mode === 'release' && LEVEL[crit] >= 2 && layers.operation && layers.operation !== 'success')
    blockers.push(`Última execução periódica de operação: ${LAYER[layers.operation] || layers.operation}`);
  let verdict, code, pending = [], protectedIds = [];
  if (mode === 'integration') {
    protectedIds = prior ? Object.entries(prior.journeys).filter(([, r]) => r?.result === 'pass').map(([id]) => id)
      : active.filter(j => j.meta.status === 'homologada').map(j => j.meta.id);
    if (!prior) warnings.push('Sem linha de base do branch principal: a catraca protege apenas jornadas homologadas.');
    for (const id of protectedIds) {
      const row = rows.find(r => r.j.meta.id === id);
      if (!row) { if (!base) warnings.push(`${id} passava no branch principal e não está mais ativa`); continue; }
      if (row.periodic || row.state === 'integrity') continue;
      if (row.rec?.result !== 'pass') blockers.push(`Regressão: ${id} ${row.j.meta.titulo} passava no branch principal e agora ${row.state === 'missing' ? 'não foi executada' : `falhou (${row.why})`}`);
    }
    pending = rows.filter(r => !r.periodic && !protectedIds.includes(r.j.meta.id) && r.rec?.result !== 'pass').map(r => r.j.meta.id);
    [verdict, code] = blockers.length ? ['NÃO PODE INTEGRAR', 1] : ['PODE INTEGRAR', 0];
  } else {
    if (contract.status !== 'active') blockers.unshift('Contrato em adoção: as jornadas ainda não foram ativadas pelo dono; o sistema não pode ser comprovado');
    for (const d of J.coverage(catalog, contract, crit)) blockers.push(`Contrato ${crit}: nenhuma jornada aprovada de ${DIM[d] || d}`);
    for (const r of rows) if (!['ok','rehearsal'].includes(r.state)) blockers.push(`${r.j.meta.id} ${r.j.meta.titulo}: ${r.why}`);
    pending = rows.filter(r => r.state === 'rehearsal').map(r => r.j.meta.id);
    if (!active.length && crit !== 'P0') blockers.push('Nenhuma jornada aprovada: não há o que comprovar');
    if (blockers.length) [verdict, code] = ['NÃO LIBERÁVEL', 1];
    else if (!active.length) [verdict, code] = ['SEM CONTRATO (P0)', 0];
    else if (pending.length) [verdict, code] = ['PRONTO PARA ENSAIO', 3];
    else [verdict, code] = ['LIBERÁVEL', 0];
  }
  const proven = rows.filter(r => r.state === 'ok').length;
  const percent = active.length ? Math.round(100 * proven / active.length) : 0;
  const result = {
    schema_version: 1, tool: `ai-engineering@${VERSION}`, mode, verdict, exit_code: code, generated_at: now.toISOString(),
    provenance: runUrl ? 'ci' : 'local', run_url: runUrl, project: { name: project.project?.name || '?', criticality: crit },
    contract_status: contract.status || null, protected_journeys: protectedIds, blockers, warnings: [...new Set(warnings)], regua_changes: regua, layers, pending, percent_operational: percent,
    journeys: Object.fromEntries(rows.map(r => [r.j.meta.id, { titulo: r.j.meta.titulo, status: r.j.meta.status, dimensao: r.j.meta.dimensao,
      criticidade: r.j.meta.criticidade, frequencia: r.j.meta.frequencia, result: r.rec?.result || 'missing', state: r.state, why: r.why,
      at: r.rec?.at?.toISOString() || null, evidence: r.rec?.evidence || r.rec?.run_url || null, provenance: r.rec?.provenance || null }]))
  };
  return { result, markdown: render(result, rows, mode), code };
}
function render(res, rows, mode) {
  const stamp = res.generated_at.slice(0, 16).replace('T', ' ');
  const origin = res.run_url ? `[execução no CI](${res.run_url})` : 'verificação local (não é prova independente)';
  const icon = { ok: '✅', rehearsal: '⏳', fail: '❌', missing: '❌', invalid: '❌', expired: '❌', integrity: '❌' };
  const lines = [`# ${res.project.name}: ${res.verdict}`, '',
    mode === 'integration' ? `Pode este pedido de mudança entrar no branch principal sem quebrar o que já funcionava? · projeto ${res.project.criticality} · contrato ${{ active: 'ativo', adoption: 'em adoção' }[res.contract_status] || 'ausente'} · ${stamp} UTC · ${origin}`
      : `**${rows.filter(r => r.state === 'ok').length} de ${rows.length} jornadas homologadas com prova válida (${res.percent_operational}% operacional)** · projeto ${res.project.criticality} · ${stamp} UTC · ${origin}`,
    '', '> Isto é evidência, não aceite. Só você aprova jornadas, homologa e decide publicar.', ''];
  if (res.regua_changes.length) lines.push('## ⚠ Mudanças na régua — exigem a sua revisão antes de aprovar', '', ...res.regua_changes.map(c => `- ⚠ ${c}`), '');
  if (res.blockers.length) lines.push(mode === 'integration' ? '## O que impede a integração' : '## O que impede a liberação', '', ...res.blockers.map(b => `- ❌ ${b}`), '');
  if (mode === 'release' && res.verdict === 'PRONTO PARA ENSAIO') lines.push('## Falta o seu ensaio', '', 'Tudo está verde. Abra o ambiente de ensaio e confira cada jornada:', '', ...res.pending.map(id => `- ${id} ${res.journeys[id].titulo}`), '');
  if (mode === 'integration' && res.pending.length) lines.push('## Ainda não entregues (não bloqueiam a integração, bloqueiam a liberação)', '', ...res.pending.map(id => `- ⏳ ${id} ${res.journeys[id].titulo}: ${res.journeys[id].why || 'pendente'}`), '');
  if (res.warnings.length) lines.push('## Avisos', '', ...res.warnings.map(w => `- ${w}`), '');
  lines.push('## Jornadas', '');
  if (!rows.length) lines.push('Nenhuma jornada aprovada ainda.');
  else {
    lines.push('| | Jornada | Nome | Dimensão | Criticidade | Situação |', '|---|---|---|---|---|---|');
    for (const r of rows) {
      const guarded = res.protected_journeys.includes(r.j.meta.id);
      const shown = mode !== 'integration' ? [icon[r.state], r.why || 'comprovada e homologada']
        : r.periodic ? ['⏸', 'periódica — avaliada na liberação'] : r.state === 'integrity' ? ['❌', r.why]
        : r.rec?.result === 'pass' ? ['✅', 'passou'] : guarded ? ['❌', `regressão: ${r.why}`] : ['⏳', `ainda não entregue: ${r.why}`];
      const ev = [r.rec?.evidence ? `evidência \`${r.rec.evidence}\`` : '', r.rec?.run_url ? `[execução](${r.rec.run_url})` : ''].filter(Boolean).join(' · ');
      lines.push(`| ${shown[0]} | ${r.j.meta.id} | ${r.j.meta.titulo.replace(/\|/g, '/')} | ${DIM[r.j.meta.dimensao] || r.j.meta.dimensao} | ${r.j.meta.criticidade === 'critica' ? 'crítica' : 'normal'} | ${String(shown[1]).replace(/\|/g, '/')}${ev ? ` · ${ev}` : ''} |`);
    }
  }
  return lines.join('\n') + '\n';
}
