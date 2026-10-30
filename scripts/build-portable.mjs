import { cp, copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build on 64-bit Windows with Node.js 24+');
if (process.argv.slice(2).some(arg => arg !== '--release')) throw new Error('Unknown build option');
const release = process.argv.includes('--release');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const name = `Vandar-Portable-${release ? 'Release-' : ''}${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
const output = join(dist, name);
const sourceData = join(root, 'data');
const existing = release ? [] : await readdir(sourceData).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
if (existing.includes('accounting.sqlite') && !existing.includes('encryption.key')) throw new Error('Source database has no encryption.key');
await mkdir(dist, { recursive: true });
await mkdir(output, { recursive: false });
for (const item of ['server.js', 'package.json', 'LICENSE']) await copyFile(join(root, item), join(output, item));
for (const item of ['public', 'node_modules']) await cp(join(root, item), join(output, item), { recursive: true });
await mkdir(join(output, 'scripts'));
await copyFile(join(root, 'scripts', 'recover-admin.js'), join(output, 'scripts', 'recover-admin.js'));
await copyFile(join(root, 'portable', 'راهنما.txt'), join(output, 'راهنما.txt'));
await copyFile(join(root, 'portable', 'Vandar.ico'), join(output, 'Vandar.ico'));
for (const item of ['Install-Service.ps1', 'Uninstall-Service.ps1']) await copyFile(join(root, 'portable', item), join(output, item));
await copyFile(join(root, 'portable', `NODE-LICENSE-${process.version}.txt`), join(output, 'NODE-LICENSE.txt'));
await copyFile(process.execPath, join(output, 'node.exe'));
const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const compiled = spawnSync(compiler, ['/nologo', '/target:winexe', '/codepage:65001', `/out:${join(output, 'Vandar.exe')}`, `/win32icon:${join(root, 'portable', 'Vandar.ico')}`, '/reference:System.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll', join(root, 'portable', 'Tray.cs')], { stdio: 'inherit' });
if (compiled.status !== 0) throw new Error('Tray application compilation failed');
const service = spawnSync(compiler, ['/nologo', '/target:exe', '/codepage:65001', `/out:${join(output, 'VandarService.exe')}`, `/win32icon:${join(root, 'portable', 'Vandar.ico')}`, '/reference:System.dll', '/reference:System.ServiceProcess.dll', join(root, 'portable', 'Service.cs')], { stdio: 'inherit' });
if (service.status !== 0) throw new Error('Windows service compilation failed');
const targetData = join(output, 'data');
await mkdir(targetData);
if (existing.includes('accounting.sqlite')) {
  await copyFile(join(sourceData, 'encryption.key'), join(targetData, 'encryption.key'));
  const db = new DatabaseSync(join(sourceData, 'accounting.sqlite'), { readOnly: true });
  try { await backup(db, join(targetData, 'accounting.sqlite')); } finally { db.close(); }
} else if (existing.includes('encryption.key')) {
  await copyFile(join(sourceData, 'encryption.key'), join(targetData, 'encryption.key'));
}
const zip = `${output}.zip`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -LiteralPath '${output.replaceAll("'", "''")}' -DestinationPath '${zip.replaceAll("'", "''")}' -CompressionLevel Optimal`], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('ZIP creation failed; the portable folder is still available');
console.log(`Portable folder: ${output}`);
console.log(`ZIP: ${zip}`);
console.log(`ZIP size: ${Math.round((await stat(zip)).size / 1048576)} MB`);
