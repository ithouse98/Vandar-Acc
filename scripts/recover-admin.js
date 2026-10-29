import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

// Recovery is intentionally available only to an operator with direct server access.
const path = join(resolve(process.env.DATA_DIR || 'data'), 'accounting.sqlite');
if (!existsSync(path)) throw new Error('Database not found. Set DATA_DIR to the existing data directory.');
if (!process.stdin.isTTY) throw new Error('Run in an interactive terminal so the password stays hidden.');
let hidden = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!hidden) process.stdout.write(chunk, encoding); callback(); } });
const prompt = createInterface({ input:process.stdin, output, terminal:true });
try {
 console.log('Administrator recovery. Password input is hidden.');
 process.stdout.write('New password (at least 12 characters): ');
 hidden = true;
 const password = await prompt.question('');
 hidden = false;
 process.stdout.write('\nRepeat password: ');
 hidden = true;
 const confirmation = await prompt.question('');
 hidden = false;
 console.log();
 if (password.length < 12 || password.length > 128 || !password.trim()) throw new Error('Password must have 12–128 characters.');
 if (password !== confirmation) throw new Error('Passwords do not match.');
 const db = new DatabaseSync(path);
 db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
 try {
  if (!db.prepare('SELECT id FROM users WHERE id=1').get()) throw new Error('No administrator exists. Use first-run setup.');
  const salt = randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET password=? WHERE id=1').run(`${salt}:${scryptSync(password,salt,64).toString('hex')}`);
  if (process.argv.includes('--disable-2fa')) db.prepare("UPDATE users SET totp=NULL,recovery='[]',last_step=0 WHERE id=1").run();
  db.exec('DELETE FROM sessions');
  db.prepare('INSERT INTO audit(action,details) VALUES(?,?)').run('بازیابی دسترسی مدیر از سرور',process.argv.includes('--disable-2fa') ? 'غیرفعال‌سازی دومرحله‌ای توسط مدیر سرور' : 'تغییر گذرواژه');
  db.exec('COMMIT');
  console.log('Administrator password reset. All sessions revoked.' + (process.argv.includes('--disable-2fa') ? ' Enable two-factor authentication again after login.' : ' Two-factor authentication remains enabled.'));
 } catch (error) { db.exec('ROLLBACK'); throw error; }
 finally { db.close(); }
} finally { hidden = false; prompt.close(); }
