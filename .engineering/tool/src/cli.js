import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { rootPath, json, writeNew, load } from './fs.js';
import { install, migrationPlan, upgrade, bootstrap } from './package.js';
import { check } from './check.js';
import { gate } from './gate.js';
import * as journeys from './journeys.js';
import * as github from './github.js';
import { VERSION } from './model.js';
const help = `ai-engineering ${VERSION} (Node.js >=22; no runtime dependencies)
Usage: ai-engineering <command> [options]
Commands: init | adopt | check | upgrade | bootstrap | journey | gate | github
All commands: --dir PATH (default: current directory), --help
init/adopt: --name TEXT --purpose TEXT --criticality P0..P3
            --data-authority LOCATION --production-authority LOCATION
            --operator NAME (optional adoption authorization label)
Missing init/adopt fields are prompted on a terminal; non-interactive calls require flags.
Use 'none: <reason>' for authorities that do not apply. Never pass credentials.
upgrade: --dry-run (default preview only), --yes (apply explicitly)
         Without either flag, a terminal prompts after the migration preview.
bootstrap: --output RELATIVE_PATH (optional; refuses overwrite), otherwise stdout
check: --json (machine-readable result); failures exit 1, usage/errors exit 2
journey new --title TEXT --dimension funcional|integracao|operacao|seguranca
            [--criticality critica|normal] [--frequency cada_mudanca|diaria|semanal] [--test PATH]
journey seal J-NNNN          record the approved fingerprint (approval = owner-reviewed change)
journey homologate J-NNNN --by NAME [--date YYYY-MM-DD]
journey retire J-NNNN --reason TEXT
journey list [--json]
gate --mode integration|release [--base-dir PATH] [--results FILE]... [--periodic FILE[=RUN_URL]]...
     [--baseline FILE] [--layer NAME=STATUS]... [--now ISO] [--out FILE] [--json-out FILE] [--json]
     integration: 0 may integrate, 1 blocked; release: 0 releasable, 3 ready for rehearsal, 1 not releasable
github setup --owner @USER [--branch main] [--e2e playwright|custom]
github verify [--repo OWNER/NAME] [--branch NAME] [--rules-json FILE] [--json]
`;
const spec = {
  init: ['name','purpose','criticality','data-authority','production-authority','operator'],
  adopt: ['name','purpose','criticality','data-authority','production-authority','operator'],
  check: ['json'], upgrade: ['dry-run','yes'], bootstrap: ['output'],
  'journey new': ['title','dimension','criticality','frequency','test'], 'journey seal': [], 'journey homologate': ['by','date'],
  'journey retire': ['reason'], 'journey list': ['json'],
  gate: ['mode','base-dir','results','periodic','baseline','layer','now','out','json-out','json'],
  'github setup': ['owner','branch','e2e'], 'github verify': ['repo','branch','rules-json','json']
};
const booleans = ['json','dry-run','yes'], repeatable = ['results','periodic','layer'];
const positional = { 'journey seal': 1, 'journey homologate': 1, 'journey retire': 1 };
// Report files are outputs, never protocol authorities.
function output(root, file, content) {
  const target = path.resolve(file);
  const rel = path.relative(root, target).split(path.sep).join('/');
  if (rel.startsWith('.engineering/') && !rel.startsWith('.engineering/evidence/')) throw new Error(`refusing to write report over protocol file: ${file}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
export async function main(args) {
  let rl;
  try {
    if (args.length === 0 || args.includes('--help')) { console.log(help); return; }
    if (args.length === 1 && args[0] === '--version') { console.log(VERSION); return; }
    let command = args.shift();
    if (['journey','github'].includes(command)) command = `${command} ${args.shift() || ''}`.trim();
    const allowed = spec[command];
    if (!allowed) throw new Error(`unknown command: ${command}`);
    const options = {}, values = [];
    while (args.length) {
      const arg = args.shift(); const key = arg.replace(/^--/, '');
      if (!arg.startsWith('--')) { values.push(arg); continue; }
      if (!['dir', ...allowed].includes(key) || (Object.hasOwn(options, key) && !repeatable.includes(key))) throw new Error(`unknown or duplicate option: ${arg}`);
      if (booleans.includes(key)) options[key] = true;
      else {
        const val = args.shift(); if (!val || val.startsWith('--')) throw new Error(`value required: ${arg}`);
        if (repeatable.includes(key)) (options[key] ||= []).push(val); else options[key] = val;
      }
    }
    if (values.length !== (positional[command] || 0)) throw new Error(`unexpected arguments: ${values.join(' ') || '(journey id required)'}`);
    const root = rootPath(options.dir || '.');
    if (['init','adopt'].includes(command)) {
      for (const key of ['name','purpose','criticality','data-authority','production-authority']) if (!options[key] && process.stdin.isTTY) {
        rl ||= createInterface({ input: process.stdin, output: process.stdout });
        options[key] = await rl.question(`${key}: `);
      }
      console.log(json(install(root, command === 'init' ? 'greenfield' : 'brownfield', options)));
      console.log('Protocol installed. Run ai-engineering bootstrap --dir ' + JSON.stringify(root));
    } else if (command === 'check') {
      const result = check(root);
      console.log(options.json ? json(result) : [...result.warnings.map(w => `WARN ${w}`), ...result.errors.map(e => `FAIL ${e}`), `RESULT ${result.ok ? 'PASS' : 'FAIL'}`].join('\n'));
      if (!result.ok) process.exitCode = 1;
    } else if (command === 'bootstrap') {
      const instruction = bootstrap(root);
      if (options.output) { writeNew(root, options.output, instruction); console.log(`Created ${options.output}`); }
      else process.stdout.write(instruction);
    } else if (command === 'upgrade') {
      if (options['dry-run'] && options.yes) throw new Error('--dry-run and --yes are mutually exclusive');
      const plan = migrationPlan(root); console.log(json(plan));
      let confirmed = !!options.yes;
      if (!options['dry-run'] && !confirmed && process.stdin.isTTY) {
        rl ||= createInterface({ input: process.stdin, output: process.stdout });
        confirmed = (await rl.question('Apply this migration with backups? Type yes: ')) === 'yes';
      }
      if (confirmed) console.log(json(upgrade(root, plan)));
      else console.log('Preview only; no files changed. Apply with --yes or terminal confirmation.');
    } else if (command.startsWith('journey ')) {
      const windows = () => load(root, '.engineering/contract.json').periodic_windows_hours || {};
      const result = { 'journey new': () => journeys.create(root, options, windows()), 'journey seal': () => journeys.seal(root, values[0]),
        'journey homologate': () => journeys.homologate(root, values[0], options), 'journey retire': () => journeys.retire(root, values[0], options),
        'journey list': () => journeys.list(root) }[command]();
      if (command === 'journey list' && !options.json) {
        console.log(result.journeys.length ? result.journeys.map(j => `${j.id}  ${j.status.padEnd(10)} ${j.dimensao.padEnd(10)} ${j.criticidade.padEnd(7)} ${j.fingerprint_current ? '' : '[texto mudou após aprovação] '}${j.titulo}`).join('\n') : 'No journeys yet.');
        for (const e of result.errors) console.log(`FAIL ${e}`);
        if (result.errors.length) process.exitCode = 1;
      } else console.log(json(result));
    } else if (command === 'gate') {
      const layers = {};
      for (const item of options.layer || []) {
        const [name, status] = item.split('=');
        if (!/^[a-z][a-z0-9_-]*$/.test(name || '') || !/^[a-z_]+$/.test(status || '')) throw new Error(`invalid --layer ${item}; use NAME=success|failure|not_configured|skipped|cancelled`);
        layers[name] = status;
      }
      const periodic = (options.periodic || []).map(item => {
        const m = item.match(/^(.*?)=(https:\/\/\S*)?$/);
        return m ? { file: m[1], url: m[2] || null } : { file: item, url: null };
      });
      const now = options.now ? new Date(options.now) : new Date();
      if (Number.isNaN(now.getTime())) throw new Error('--now must be an ISO timestamp');
      const { result, markdown, code } = gate(root, { mode: options.mode, base: options['base-dir'] ? rootPath(options['base-dir']) : null,
        results: options.results || [], periodic, baseline: options.baseline || null, layers, now });
      if (options.out) output(root, options.out, markdown);
      if (options['json-out']) output(root, options['json-out'], json(result));
      process.stdout.write(options.json ? json(result) : markdown);
      process.exitCode = code;
    } else if (command === 'github setup') {
      console.log(json(github.setup(root, { owner: options.owner, branch: options.branch, e2e: options.e2e })));
    } else if (command === 'github verify') {
      const result = github.verify(root, { repo: options.repo, branch: options.branch, rulesJson: options['rules-json'] });
      console.log(options.json ? json(result) : [
        `Proteções do projeto ${result.criticality} (branch ${result.branch}${result.repo ? `, ${result.repo}` : ''}):`,
        ...result.items.map(i => `${i.ok ? 'OK  ' : 'FALTA'} ${i.item}`), '', 'Confira manualmente (a API não comprova):', ...result.not_verifiable.map(n => `- ${n}`),
        '', `RESULT ${result.ok ? 'PASS' : 'FAIL'}`].join('\n'));
      if (!result.ok) process.exitCode = 1;
    }
  } catch (e) { console.error(`ERROR: ${e.message}`); process.exitCode = 2; }
  finally { rl?.close(); }
}
