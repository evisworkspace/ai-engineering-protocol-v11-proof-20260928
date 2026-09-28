import fs from 'node:fs';
import { createStore } from '../../src/store.js';

fs.mkdirSync('evidencias', { recursive: true });
const store = createStore(); store.buy(); const backup = store.backup(); store.reset(); store.restore(backup);
const pass = JSON.stringify(store.snapshot()) === JSON.stringify({ stock: 2, sales: 1 });
const at = new Date().toISOString();
fs.writeFileSync('evidencias/J-0004.log', `${at} restaurado: ${JSON.stringify(store.snapshot())}\n`);
process.stdout.write(JSON.stringify({ generated_at: at, journeys: { 'J-0004': { result: pass ? 'pass' : 'fail', at, reason: pass ? '' : 'backup não restaurou', evidence: 'evidencias/J-0004.log' } } }));
if (!pass) process.exitCode = 1;
