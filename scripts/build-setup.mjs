import { spawnSync } from 'node:child_process';
import { readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build Setup on 64-bit Windows');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const setup = join(dist, `Vandar-Setup-v${version}-win-x64.exe`);
const portable = join(dist, `Vandar-Portable-v${version}-win-x64.zip`);
for (const path of [setup, portable]) {
  if (await stat(path).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) throw new Error(`Output already exists: ${path}`);
}
const build = spawnSync(process.execPath, [join(root, 'scripts', 'build-portable.mjs'), '--release'], { cwd:root, encoding:'utf8', stdio:['ignore','pipe','inherit'] });
if (build.status !== 0) throw new Error('Clean portable build failed');
const folder = build.stdout.match(/^Portable folder: (.+)$/m)?.[1]?.trim();
const zip = build.stdout.match(/^ZIP: (.+)$/m)?.[1]?.trim();
if (!folder || !zip || dirname(folder) !== dist || basename(folder).startsWith('Vandar-Portable-Release-') === false || zip !== folder + '.zip') throw new Error('Unexpected portable build output');
if ((await readdir(join(folder, 'data'))).length !== 0) throw new Error('Setup payload contains private data');
const check = spawnSync(process.execPath, [join(root, 'scripts', 'check-portable.mjs'), folder, '--release'], { cwd:root, stdio:'inherit' });
if (check.status !== 0) throw new Error('Portable package smoke test failed');
const compiler = join(process.env.WINDIR || 'C:\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const compiled = spawnSync(compiler, [
  '/nologo', '/target:winexe', '/codepage:65001', `/out:${setup}`,
  `/win32icon:${join(root, 'portable', 'Vandar.ico')}`,
  `/win32manifest:${join(root, 'portable', 'Setup.manifest')}`,
  '/reference:System.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
  '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
  `/resource:${zip},Vandar.Payload`,
  `/resource:${join(root, 'public', 'vandar-icon.png')},Vandar.Brand`,
  join(root, 'portable', 'Setup.cs')
], { cwd:root, stdio:'inherit' });
if (compiled.status !== 0) throw new Error('Setup compilation failed');
if ((await stat(setup)).size <= (await stat(zip)).size) throw new Error('Setup payload was not embedded');
if (!(await readFile(setup)).includes(Buffer.from('requireAdministrator'))) throw new Error('Setup elevation manifest is missing');
const verify = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'check-setup.ps1'), setup], { cwd:root, stdio:'inherit' });
if (verify.status !== 0) throw new Error('Setup payload check failed');
await rename(zip, portable);
if (dirname(folder) !== dist || (await readdir(join(folder, 'data'))).length !== 0) throw new Error('Unsafe build cleanup');
await rm(folder, { recursive:true, maxRetries:5, retryDelay:200 });
console.log(`Setup: ${setup}`);
console.log(`Portable ZIP: ${portable}`);
