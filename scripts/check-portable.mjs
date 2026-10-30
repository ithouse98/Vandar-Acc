import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const folder = resolve(process.argv[2]);
assert.ok((await stat(join(folder, 'Vandar.exe'))).size > 0);
assert.ok((await stat(join(folder, 'Vandar.ico'))).size > 0);
assert.ok((await stat(join(folder, 'public', 'vandar-icon.svg'))).size > 0);
assert.ok((await stat(join(folder, 'VandarService.exe'))).size > 0);
assert.ok((await stat(join(folder, 'Install-Service.ps1'))).size > 0);
assert.ok((await stat(join(folder, 'scripts', 'recover-admin.js'))).size > 0);
if (process.argv.includes('--release')) {
  assert.deepEqual(await readdir(join(folder, 'data')), []);
} else {
  const key = await readFile(join(folder, 'data', 'encryption.key'));
  assert.equal(key.length, 32);
  const db = new DatabaseSync(join(folder, 'data', 'accounting.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); } finally { db.close(); }
}
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const url = `http://localhost:${port}`;
const data = await mkdtemp(join(tmpdir(), 'vandar-portable-check-'));
const child = spawn(join(folder, 'node.exe'), [join(folder, 'server.js')], {
  cwd: folder,
  env: { ...process.env, DATA_DIR: data, HOST: '127.0.0.1', PORT: String(port), PUBLIC_ORIGIN: url, NODE_ENV: 'portable', NODE_OPTIONS: '', PORTABLE_CONTROL: '1' },
  stdio: ['pipe', 'pipe', 'pipe']
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Portable server did not start')), 10000);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; if (output.includes(`IPS Factor: ${url}`)) { clearTimeout(timer); resolve(); } });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Portable server exited: ${code}`)));
  });
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url + '/fonts/Vazirmatn%5Bwght%5D.woff2')).status, 200);
  assert.equal((await fetch(url + '/api/services')).status, 401);
  assert.equal((await (await fetch(url + '/api/session')).json()).setup, true);
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.stdin.write('stop\n');
  assert.equal(await stopped, 0);
  console.log('Portable package checks passed');
} finally {
  if (child.exitCode === null) child.kill();
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  assert.equal(dirname(data), resolve(tmpdir()));
  await rm(data, { recursive: true, force: true });
}
