// Runs the node test files and ends with one clear line: RESULT: PASS or RESULT: FAIL (exit code 0 or 1).
// Usage (from app\): node test/run_tests.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { testPgBase, sweepSchemas } from './pgtest.mjs';

if (process.env.NODE_TEST_CONTEXT) process.exit(0); // picked up by a bare `node --test`: the runner does not nest
const HERE = path.dirname(fileURLToPath(import.meta.url));
console.log('test PostgreSQL: ' + testPgBase());
sweepSchemas(); // the schemas earlier runs left behind
const files = ['rules.test.mjs', 'server.test.mjs', 'fx.test.mjs', 'todo.test.mjs', 'pg.test.mjs'].map((f) => path.join(HERE, f));
const out = path.join(HERE, '_tmp', 'node_tests.out');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=120000', ...files], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const text = (r.stdout || '') + (r.stderr || '');
fs.writeFileSync(out, text);
process.stdout.write(text);
const pass = /ℹ pass (\d+)/.exec(text), fail = /ℹ fail (\d+)/.exec(text);
const ok = r.status === 0 && pass && Number(pass[1]) > 0 && fail && Number(fail[1]) === 0;
console.log(`RESULT: ${ok ? 'PASS' : 'FAIL'} (exit ${r.status}, pass ${pass ? pass[1] : '?'}, fail ${fail ? fail[1] : '?'})`);
process.exit(ok ? 0 : 1);
