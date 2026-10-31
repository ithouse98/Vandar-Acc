import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { formatPersianDate } from './public/persian-date.js';
import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const data = resolve(process.env.DATA_DIR || join(root, 'data'));
mkdirSync(data, { recursive: true, mode: 0o700 });
const keyPath = join(data, 'encryption.key');
if (!existsSync(keyPath) && existsSync(join(data, 'accounting.sqlite'))) throw new Error('Missing encryption.key; restore the original key before starting.');
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
const key = readFileSync(keyPath);
const db = new DatabaseSync(join(data, 'accounting.sqlite'));
try { chmodSync(join(data, 'accounting.sqlite'), 0o600); } catch {}
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY CHECK(id=1), email TEXT NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, totp TEXT, last_step INTEGER NOT NULL DEFAULT 0, recovery TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL, authenticated INTEGER NOT NULL, pending_totp TEXT);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), business TEXT NOT NULL DEFAULT 'استودیو من', owner TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', iban TEXT NOT NULL DEFAULT '', invoice_prefix TEXT NOT NULL DEFAULT 'IPS', template TEXT NOT NULL DEFAULT 'modern');
INSERT OR IGNORE INTO settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', national_id TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, price INTEGER NOT NULL CHECK(price>=0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, customer_id INTEGER NOT NULL REFERENCES customers(id), customer_snapshot TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('invoice','proforma','quote')), status TEXT NOT NULL CHECK(status IN ('draft','issued','void')), date TEXT NOT NULL, due_date TEXT NOT NULL, items TEXT NOT NULL, discount INTEGER NOT NULL, tax_rate INTEGER NOT NULL, subtotal INTEGER NOT NULL, tax INTEGER NOT NULL, total INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT '', template TEXT NOT NULL DEFAULT 'modern', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('income','expense')), invoice_id INTEGER REFERENCES invoices(id), amount INTEGER NOT NULL CHECK(amount>0), date TEXT NOT NULL, category TEXT NOT NULL, method TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, action TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);
if (!db.prepare('PRAGMA table_info(invoices)').all().some(c => c.name === 'seller_snapshot')) {
 db.exec("ALTER TABLE invoices ADD COLUMN seller_snapshot TEXT NOT NULL DEFAULT '{}'");
 db.prepare('UPDATE invoices SET seller_snapshot=?').run(JSON.stringify(db.prepare('SELECT * FROM settings').get()));
}
const app = express();
if (!db.prepare('PRAGMA table_info(settings)').all().some(c => c.name === 'logo_id')) db.exec("ALTER TABLE settings ADD COLUMN logo_id TEXT NOT NULL DEFAULT ''");
if (!db.prepare('PRAGMA table_info(settings)').all().some(c => c.name === 'seal_id')) db.exec("ALTER TABLE settings ADD COLUMN seal_id TEXT NOT NULL DEFAULT ''");
if (!db.prepare('PRAGMA table_info(settings)').all().some(c => c.name === 'seal_scale')) db.exec("ALTER TABLE settings ADD COLUMN seal_scale INTEGER NOT NULL DEFAULT 100");
if (!db.prepare('PRAGMA table_info(settings)').all().some(c => c.name === 'login_theme')) db.exec("ALTER TABLE settings ADD COLUMN login_theme TEXT NOT NULL DEFAULT 'bazaar'");
db.exec('CREATE TABLE IF NOT EXISTS logos (id TEXT PRIMARY KEY, image BLOB NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS integrations (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
const production = process.env.NODE_ENV === 'production';
const origin = process.env.PUBLIC_ORIGIN || 'http://localhost:3000';
if (production && !origin.startsWith('https://')) throw new Error('PUBLIC_ORIGIN must be an https URL in production');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], styleSrcAttr: ["'unsafe-inline'"], fontSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: production ? [] : null } }, strictTransportSecurity: production ? undefined : false }));
app.use('/api', rateLimit({ windowMs: 60000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/logo', express.json({ limit: '3mb' }));
app.use('/api/seal', express.json({ limit: '40mb' }));
app.use('/api/invoices/:id/bale', express.raw({ type:'application/pdf', limit:'20mb' }));
app.use(express.json({ limit: '256kb' }));
const query = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max = 300, required = false) => { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('اطلاعات متنی نامعتبر است.'); return value.trim(); };
const passwordText = value => { if (typeof value !== 'string' || value.length > 128 || !value) fail('گذرواژه معتبر نیست.'); return value; };
const integer = (value, min = 0, max = 1e12) => { if (!Number.isSafeInteger(value) || value < min || value > max) fail('مبلغ یا عدد واردشده معتبر نیست.'); return value; };
const invoiceTemplates = ['modern','classic','minimal','official','corporate','friendly','playful','landscape'];
const choice = (value, values) => { if (!values.includes(value)) fail('گزینه انتخاب‌شده معتبر نیست.'); return value; };
const date = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('تاریخ معتبر نیست.'); return value; };
const audit = (action, details = '') => run('INSERT INTO audit(action,details) VALUES(?,?)', action, details);
const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const passwordHash = password => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; };
const passwordOK = (password, stored) => { const [salt, value] = stored.split(':'); return equal(scryptSync(password, salt, 64).toString('hex'), value); };
const validatePassword = value => { text(value, 128, true); if (value.length < 8) fail('گذرواژه باید دست‌کم ۸ نویسه داشته باشد.'); return value; };
const phone = value => { const normalized = text(value, 20).replace(/[۰-۹٠-٩]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) >= 0 ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) : '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))); if (normalized && !/^09\d{9}$/.test(normalized)) fail('شماره موبایل باید با 09 شروع شود و ۱۱ رقم باشد.'); return normalized; };
const encrypt = value => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(value), cipher.final()]); return [iv, cipher.getAuthTag(), body].map(b => b.toString('hex')).join('.'); };
const decrypt = value => { const [iv, tag, body] = value.split('.').map(v => Buffer.from(v, 'hex')); const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAuthTag(tag); return Buffer.concat([cipher.update(body), cipher.final()]).toString(); };
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes) { let bits = ''; for (const b of bytes) bits += b.toString(2).padStart(8, '0'); return bits.match(/.{1,5}/g).map(b => alphabet[parseInt(b.padEnd(5, '0'), 2)]).join(''); }
function totp(secret, step) { const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join(''); const bytes = Buffer.from((bits.match(/.{8}/g) || []).map(b => parseInt(b, 2))); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step)); const digest = createHmac('sha1', bytes).update(counter).digest(); const offset = digest[19] & 15; return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0'); }
function validStep(secret, code, last = 0) { if (!/^\d{6}$/.test(String(code))) return 0; const now = Math.floor(Date.now() / 30000); return [now - 1, now, now + 1].find(step => step > last && equal(totp(secret, step), code)) || 0; }
function setSession(res, authenticated) { const raw = token(); const csrf = token(); run('DELETE FROM sessions WHERE expires < ?', Date.now()); run('INSERT INTO sessions(token,csrf,expires,authenticated) VALUES(?,?,?,?)', hash(raw), csrf, Date.now() + (authenticated ? 8 * 3600000 : 5 * 60000), authenticated ? 1 : 0); res.cookie('ips_session', raw, { httpOnly: true, secure: production, sameSite: 'strict', path: '/', maxAge: authenticated ? 8 * 3600000 : 5 * 60000 }); return csrf; }
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.get('Origin') !== origin) return res.status(403).json({ error: 'مبدأ درخواست معتبر نیست.' }); const raw = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('ips_session='))?.slice(12); req.session = raw && one('SELECT * FROM sessions WHERE token=? AND expires>?', hash(raw), Date.now()); next(); });
const auth = (req, res, next) => { if (!req.session?.authenticated) return res.status(401).json({ error: 'ابتدا وارد حساب شوید.' }); next(); };
const csrf = (req, res, next) => { if (!equal(req.get('X-CSRF-Token'), req.session?.csrf)) return res.status(403).json({ error: 'نشست معتبر نیست؛ صفحه را تازه کنید.' }); next(); };
const loginLimit = rateLimit({ windowMs: 15 * 60000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'تلاش‌های زیادی انجام شده؛ ۱۵ دقیقه دیگر امتحان کنید.' } });
let setupToken = process.env.SETUP_TOKEN || token();
if (!one('SELECT id FROM users')) console.log(`First-run setup token: ${setupToken}`);
app.get('/api/session', (req, res) => { const user = one('SELECT email,name,totp FROM users'); res.json({ setup: !user, authenticated: Boolean(req.session?.authenticated), pending: Boolean(req.session && !req.session.authenticated), csrf: req.session?.csrf || null, login_theme: one('SELECT login_theme FROM settings').login_theme, user: req.session?.authenticated ? { email: user.email, name: user.name, twoFactor: Boolean(user.totp) } : null }); });
app.post('/api/setup', loginLimit, (req, res) => { if (one('SELECT id FROM users')) fail('حساب قبلاً ساخته شده است.', 409); if (!equal(req.body.token, setupToken)) fail('کد راه‌اندازی معتبر نیست.', 403); const email = text(req.body.email, 200, true); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('ایمیل معتبر نیست.'); run('INSERT INTO users(id,email,name,password) VALUES(1,?,?,?)', email.toLowerCase(), text(req.body.name, 100, true), passwordHash(validatePassword(req.body.password))); setupToken = ''; const setupFile = join(data, 'setup-token.txt'); if (process.env.PORTABLE_CONTROL === '1' && existsSync(setupFile)) unlinkSync(setupFile); audit('ایجاد حساب مدیر'); res.json({ csrf: setSession(res, true) }); });
app.post('/api/login', loginLimit, (req, res) => { const email = text(req.body.email, 200); const password = passwordText(req.body.password); const user = one('SELECT * FROM users'); const stored = user?.password || '00000000000000000000000000000000:' + '0'.repeat(128); const ok = passwordOK(password, stored); if (!user || user.email !== email.toLowerCase() || !ok) fail('ایمیل یا گذرواژه نادرست است.', 401); if (req.session) run('DELETE FROM sessions WHERE token=?', req.session.token); audit('ورود با گذرواژه'); res.json({ pending: Boolean(user.totp), csrf: setSession(res, !user.totp) }); });
app.post('/api/login/verify', loginLimit, csrf, (req, res) => { if (!req.session || req.session.authenticated) fail('نشست ورود معتبر نیست.', 401); const user = one('SELECT * FROM users'); const code = text(req.body.code, 40, true); const step = validStep(decrypt(user.totp), code, user.last_step); const codes = JSON.parse(user.recovery); const index = codes.findIndex(c => equal(c, hash(code))); if (!step && index < 0) fail('کد ورود معتبر نیست.', 401); transaction(() => { if (step) run('UPDATE users SET last_step=?', step); else { codes.splice(index, 1); run('UPDATE users SET recovery=?', JSON.stringify(codes)); } run('DELETE FROM sessions WHERE token=?', req.session.token); audit('ورود دومرحله‌ای'); }); res.json({ csrf: setSession(res, true) }); });
app.use('/api', (req, res, next) => { if (['/session','/login','/login/verify','/setup'].includes(req.path)) return next(); auth(req, res, () => ['GET','HEAD'].includes(req.method) ? next() : csrf(req, res, next)); });
app.post('/api/logout', (req, res) => { run('DELETE FROM sessions WHERE token=?', req.session.token); res.clearCookie('ips_session', { path: '/', secure: production, sameSite: 'strict' }); res.json({ ok: true }); });
app.post('/api/window/close', async (req, res) => {
 if (process.env.PORTABLE_CONTROL !== '1') fail('خروج از پنجره فقط در نسخهٔ ویندوزی فعال است.',409);
 let result;
 try { result = await fetch('http://127.0.0.1:17433/close',{method:'POST',signal:AbortSignal.timeout(3000)}); }
 catch { fail('پنجره از میانبر وَندار باز نشده است؛ از Alt+F4 استفاده کنید.',409); }
 if (!result.ok) fail('بستن پنجره انجام نشد.',502);
 run('DELETE FROM sessions WHERE token=?',req.session.token);
 res.clearCookie('ips_session',{path:'/',secure:production,sameSite:'strict'});
 res.json({ok:true});
});
app.post('/api/security/totp/start', loginLimit, async (req, res) => { const user = one('SELECT * FROM users'); if (!passwordOK(passwordText(req.body.password), user.password)) fail('گذرواژه نادرست است.', 403); if (user.totp) fail('ورود دومرحله‌ای فعال است.'); const secret = base32(randomBytes(20)); run('UPDATE sessions SET pending_totp=? WHERE token=?', encrypt(secret), req.session.token); const uri = `otpauth://totp/${encodeURIComponent('IPS Factor:' + user.email)}?secret=${secret}&issuer=IPS%20Factor&algorithm=SHA1&digits=6&period=30`; res.json({ secret, qr: await QRCode.toDataURL(uri) }); });
app.post('/api/security/totp/enable', loginLimit, (req, res) => { if (one('SELECT totp FROM users').totp) fail('ورود دومرحله‌ای قبلاً فعال شده است.'); if (!req.session.pending_totp) fail('ابتدا راه‌اندازی دومرحله‌ای را آغاز کنید.'); const step = validStep(decrypt(req.session.pending_totp), text(req.body.code, 6, true)); if (!step) fail('کد معتبر نیست.'); const codes = Array.from({ length: 8 }, () => randomBytes(6).toString('hex')); transaction(() => { run('UPDATE users SET totp=?,last_step=?,recovery=?', req.session.pending_totp, step, JSON.stringify(codes.map(hash))); run('DELETE FROM sessions WHERE token<>?', req.session.token); run('UPDATE sessions SET pending_totp=NULL WHERE token=?', req.session.token); audit('فعال‌سازی ورود دومرحله‌ای'); }); res.json({ codes }); });
app.post('/api/security/password', loginLimit, (req, res) => { const user = one('SELECT * FROM users'); if (!passwordOK(passwordText(req.body.current), user.password)) fail('گذرواژه فعلی نادرست است.', 403); run('UPDATE users SET password=?', passwordHash(validatePassword(req.body.password))); run('DELETE FROM sessions WHERE token<>?', req.session.token); audit('تغییر گذرواژه'); res.json({ ok: true }); });
app.get('/api/settings', (req, res) => res.json({ ...one('SELECT * FROM settings'), bale_configured: Boolean(one("SELECT name FROM integrations WHERE name='bale'")), bale_chat_id: one("SELECT value FROM integrations WHERE name='bale_chat'")?.value || '' }));
async function saveImage(req, res, seal = false) {
 const value = text(req.body.image, seal ? 40*1024*1024 : 2800000, true);
 const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
 if (!match || (seal && match[1] === 'jpeg')) fail(seal ? 'برای مهر و امضا تصویر PNG یا WebP شفاف انتخاب کنید.' : 'لوگو باید تصویر PNG، JPEG یا WebP باشد.');
 const bytes = Buffer.from(match[2], 'base64');
 if (!seal && bytes.length > 2*1024*1024) fail('حداکثر اندازه لوگو ۲ مگابایت است.');
 let image;
 try {
  const source = sharp(bytes, { limitInputPixels:seal ? undefined : 10000000, animated:false, failOn:'warning' });
  const metadata = await source.metadata();
  if (!['png','jpeg','webp'].includes(metadata.format) || (metadata.pages || 1) > 1 || (seal && !metadata.hasAlpha)) fail('برای مهر و امضا تصویر ثابت با زمینه شفاف انتخاب کنید.');
  image = await source.rotate().resize({ width:seal ? 2048 : 1024,height:seal ? 2048 : 1024,fit:'inside',withoutEnlargement:true }).png().toBuffer();
 } catch { fail('فایل تصویر معتبر نیست؛ از یک تصویر ثابت استفاده کنید.'); }
 if (!seal && image.length > 4*1024*1024) fail('تصویر نهایی بزرگ است؛ یک لوگوی کوچک‌تر انتخاب کنید.');
 const id = createHash('sha256').update(image).digest('hex');
 transaction(() => { run('INSERT OR IGNORE INTO logos(id,image) VALUES(?,?)',id,image); run(`UPDATE settings SET ${seal ? 'seal_id' : 'logo_id'}=?`,id); audit(seal ? 'تغییر مهر و امضا' : 'تغییر لوگوی کسب‌وکار'); });
 res.json({ id });
}
const imageLimit = rateLimit({ windowMs:60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'تعداد بارگذاری‌ها زیاد است؛ یک دقیقه دیگر تلاش کنید.'} });
app.post('/api/logo', imageLimit, (req, res) => saveImage(req, res));
app.post('/api/seal', imageLimit, (req, res) => saveImage(req, res, true));
app.delete('/api/logo', (req, res) => { run("UPDATE settings SET logo_id=''"); audit('حذف لوگوی فعلی کسب‌وکار'); res.json({ ok:true }); });
app.delete('/api/seal', (req, res) => { run("UPDATE settings SET seal_id=''"); audit('حذف مهر و امضای فعلی'); res.json({ ok:true }); });
app.get('/api/logo/:id', (req, res) => { if (!/^[a-f0-9]{64}$/.test(req.params.id)) fail('لوگو پیدا نشد.',404); const logo = one('SELECT image FROM logos WHERE id=?',req.params.id); if (!logo) fail('لوگو پیدا نشد.',404); res.type('image/png').send(Buffer.from(logo.image)); });
app.get('/api/invoices/:id/qr', async (req, res) => { const i = one('SELECT number,date,total,customer_snapshot,seller_snapshot FROM invoices WHERE id=?', req.params.id); if (!i) fail('فاکتور پیدا نشد.', 404); const seller = JSON.parse(i.seller_snapshot || '{}'); const summary = [`${seller.business || ''} | ${i.number}`, JSON.parse(i.customer_snapshot).name, `${formatPersianDate(i.date)} | ${i.total}`, seller.iban ? `IBAN ${seller.iban}` : ''].filter(Boolean).join('\n'); res.type('image/png').set('Cache-Control','no-store').send(await QRCode.toBuffer(summary, { margin:1, width:320, errorCorrectionLevel:'M' })); });
app.put('/api/settings', (req, res) => { const b = req.body; const prefix = text(b.invoice_prefix, 15, true); if (!/^[A-Za-z0-9-]+$/.test(prefix)) fail('پیشوند فقط شامل حروف انگلیسی، عدد و خط تیره باشد.'); run('UPDATE settings SET business=?,owner=?,phone=?,address=?,iban=?,invoice_prefix=?,template=?,seal_scale=?,login_theme=?', text(b.business, 150, true), text(b.owner, 100), text(b.phone, 40), text(b.address, 500), text(b.iban, 50), prefix, choice(b.template, invoiceTemplates), integer(Number(b.seal_scale ?? 100),40,200), choice(b.login_theme || 'bazaar',['bazaar','invoice','ledger'])); audit('ویرایش تنظیمات'); res.json({ ok: true }); });
app.put('/api/integrations/bale', (req, res) => { const chatId = text(req.body.chat_id, 20, true); if (!/^-?\d{5,20}$/.test(chatId)) fail('شناسه گفت‌وگوی بله معتبر نیست.'); const botToken = text(req.body.token || '', 200); if (botToken && !/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) fail('توکن بازوی بله معتبر نیست.'); if (!botToken && !one("SELECT name FROM integrations WHERE name='bale'")) fail('ابتدا توکن بازوی بله را ثبت کنید.'); transaction(() => { if (botToken) run("INSERT INTO integrations(name,value) VALUES('bale',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",encrypt(botToken)); run("INSERT INTO integrations(name,value) VALUES('bale_chat',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",chatId); audit('تنظیم بازوی بله'); }); res.json({ ok:true }); });
app.delete('/api/integrations/bale', (req, res) => { run("DELETE FROM integrations WHERE name IN ('bale','bale_chat')"); audit('حذف اتصال بله'); res.json({ ok:true }); });
const customerList = () => query("SELECT c.*,COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.customer_id=c.id AND i.status='issued' AND i.kind='invoice'),0)-COALESCE((SELECT SUM(t.amount) FROM transactions t JOIN invoices i ON i.id=t.invoice_id WHERE i.customer_id=c.id),0) AS balance FROM customers c ORDER BY c.id DESC");
app.get('/api/customers', (req, res) => res.json(customerList()));
function customerValues(b) { const email = text(b.email, 200); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('ایمیل معتبر نیست.'); return [text(b.name, 150, true), text(b.company, 150), email, phone(b.phone), text(b.national_id, 40), text(b.address, 500), text(b.notes, 2000)]; }
app.post('/api/customers', (req, res) => { const r = run('INSERT INTO customers(name,company,email,phone,national_id,address,notes) VALUES(?,?,?,?,?,?,?)', ...customerValues(req.body)); audit('ثبت مشتری', String(r.lastInsertRowid)); res.json({ id: Number(r.lastInsertRowid) }); });
app.put('/api/customers/:id', (req, res) => { const r = run('UPDATE customers SET name=?,company=?,email=?,phone=?,national_id=?,address=?,notes=? WHERE id=?', ...customerValues(req.body), req.params.id); if (!r.changes) fail('مشتری پیدا نشد.', 404); audit('ویرایش مشتری', req.params.id); res.json({ ok: true }); });
app.delete('/api/customers/:id', (req, res) => { if (one('SELECT id FROM invoices WHERE customer_id=?', req.params.id)) fail('مشتری دارای فاکتور را نمی‌توان حذف کرد.'); run('DELETE FROM customers WHERE id=?', req.params.id); audit('حذف مشتری', req.params.id); res.json({ ok: true }); });
app.get('/api/services', (req, res) => res.json(query('SELECT id,name,price FROM services ORDER BY name COLLATE NOCASE')));
function serviceValues(b = {}, id = 0) { const name = text(b.name, 500, true); if (one('SELECT id FROM services WHERE name=? COLLATE NOCASE AND id<>?', name, id)) fail('این خدمت قبلاً ثبت شده است.', 409); return [name, integer(b.price, 0, 1e12)]; }
app.post('/api/services', (req, res) => { const r = run('INSERT INTO services(name,price) VALUES(?,?)', ...serviceValues(req.body)); audit('ثبت خدمت', String(r.lastInsertRowid)); res.json({ id: Number(r.lastInsertRowid) }); });
app.put('/api/services/:id', (req, res) => { const id = integer(Number(req.params.id), 1); const r = run('UPDATE services SET name=?,price=? WHERE id=?', ...serviceValues(req.body, id), id); if (!r.changes) fail('خدمت پیدا نشد.', 404); audit('ویرایش خدمت', String(id)); res.json({ ok: true }); });
app.delete('/api/services/:id', (req, res) => { const id = integer(Number(req.params.id), 1); const r = run('DELETE FROM services WHERE id=?', id); if (!r.changes) fail('خدمت پیدا نشد.', 404); audit('حذف خدمت', String(id)); res.json({ ok: true }); });
const invoices = () => query(`SELECT i.*,c.name AS customer_name,COALESCE((SELECT SUM(amount) FROM transactions WHERE invoice_id=i.id),0) AS paid FROM invoices i JOIN customers c ON c.id=i.customer_id ORDER BY i.id DESC`).map(i => ({ ...i, items: JSON.parse(i.items), customer_snapshot: JSON.parse(i.customer_snapshot), seller_snapshot: JSON.parse(i.seller_snapshot) }));
app.get('/api/invoices', (req, res) => res.json(invoices()));
app.post('/api/invoices/:id/bale', async (req, res) => {
 const invoice = one('SELECT number,kind,date,status FROM invoices WHERE id=?', integer(Number(req.params.id),1));
 if (!invoice) fail('سند پیدا نشد.',404);
 if (invoice.status !== 'issued') fail('ابتدا سند را صادر کنید.');
 const integration = one("SELECT value FROM integrations WHERE name='bale'");
 if (!integration) fail('ابتدا توکن بازوی بله را در تنظیمات ثبت کنید.');
 const chatId = one("SELECT value FROM integrations WHERE name='bale_chat'")?.value || '';
 if (!/^-?\d{5,20}$/.test(chatId)) fail('شناسه گفت‌وگوی بله معتبر نیست.');
 if (!Buffer.isBuffer(req.body) || req.body.length < 100 || req.body.length > 20*1024*1024 || req.body.subarray(0,5).toString() !== '%PDF-') fail('فایل PDF معتبر نیست.');
 const form = new FormData();
 form.set('chat_id',chatId);
 form.set('caption',`${{invoice:'فاکتور فروش',proforma:'پیش‌فاکتور',quote:'پیشنهاد قیمت'}[invoice.kind]} ${invoice.number} · ${formatPersianDate(invoice.date)}`);
 form.set('document',new Blob([req.body],{type:'application/pdf'}),`Vandar-${invoice.number}.pdf`);
 let response, result;
 try {
  response = await fetch(`https://tapi.bale.ai/bot${decrypt(integration.value)}/sendDocument`,{method:'POST',body:form,signal:AbortSignal.timeout(60000)});
  result = await response.json();
 } catch { fail('ارتباط با بله برقرار نشد. وضعیت اینترنت و بازو را بررسی کنید.',502); }
 if (!response.ok || !result.ok) fail('ارسال در بله انجام نشد. شناسه گفت‌وگو و دسترسی بازو را بررسی کنید.',502);
 audit('ارسال سند با بله',`${invoice.number} → ${chatId}`);
 res.json({ok:true});
});
function invoiceValues(b) { const customer = one('SELECT * FROM customers WHERE id=?', integer(b.customer_id, 1)); if (!customer) fail('مشتری پیدا نشد.'); if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100) fail('فاکتور باید بین ۱ تا ۱۰۰ ردیف داشته باشد.'); const items = b.items.map(i => ({ description: text(i.description, 500, true), quantity: integer(i.quantity, 1, 1000000), price: integer(i.price, 0, 1e12) })); const subtotal = integer(items.reduce((sum, i) => sum + i.quantity * i.price, 0), 0, 1e14); const discount = integer(b.discount, 0, subtotal); const taxRate = integer(b.tax_rate, 0, 100); const tax = Math.round((subtotal - discount) * taxRate / 100); const total = integer(subtotal - discount + tax, 1, 1e14); const start = date(b.date); const due = date(b.due_date); if (due < start) fail('سررسید نمی‌تواند پیش از تاریخ صدور باشد.'); return [customer.id, JSON.stringify(customer), choice(b.kind, ['invoice','proforma','quote']), choice(b.status, ['draft','issued']), start, due, JSON.stringify(items), discount, taxRate, subtotal, tax, total, text(b.notes, 4000), choice(b.template, invoiceTemplates)]; }
app.post('/api/invoices', (req, res) => { const values = invoiceValues(req.body); const id = transaction(() => { const prefix = one('SELECT invoice_prefix FROM settings').invoice_prefix; const seq = Number(one('SELECT COALESCE(MAX(id),0)+1 AS n FROM invoices').n); const r = run('INSERT INTO invoices(number,customer_id,customer_snapshot,kind,status,date,due_date,items,discount,tax_rate,subtotal,tax,total,notes,template,seller_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', `${prefix}-${String(seq).padStart(5, '0')}`, ...values, JSON.stringify(one('SELECT * FROM settings'))); audit('ثبت فاکتور', String(r.lastInsertRowid)); return Number(r.lastInsertRowid); }); res.json({ id }); });
app.put('/api/invoices/:id', (req, res) => { const values = invoiceValues(req.body); transaction(() => { const current = one('SELECT * FROM invoices WHERE id=?', req.params.id); if (!current) fail('فاکتور پیدا نشد.', 404); if (current.status === 'void' || one('SELECT id FROM transactions WHERE invoice_id=?', current.id)) fail('فاکتور باطل یا دارای دریافت قابل ویرایش نیست.'); if (current.version !== req.body.version) fail('فاکتور تغییر کرده؛ صفحه را تازه کنید.', 409); run('UPDATE invoices SET customer_id=?,customer_snapshot=?,kind=?,status=?,date=?,due_date=?,items=?,discount=?,tax_rate=?,subtotal=?,tax=?,total=?,notes=?,template=?,version=version+1 WHERE id=?', ...values, current.id); audit('ویرایش فاکتور', req.params.id); }); res.json({ ok: true }); });
app.post('/api/invoices/:id/void', (req, res) => { transaction(() => { const i = one('SELECT * FROM invoices WHERE id=?', req.params.id); if (!i) fail('فاکتور پیدا نشد.', 404); if (one('SELECT id FROM transactions WHERE invoice_id=?', i.id)) fail('ابتدا دریافت‌های مرتبط را اصلاح کنید.'); run("UPDATE invoices SET status='void',version=version+1 WHERE id=?", i.id); audit('ابطال فاکتور', req.params.id); }); res.json({ ok: true }); });
app.get('/api/transactions', (req, res) => res.json(query('SELECT t.*,i.number AS invoice_number,c.name AS customer_name FROM transactions t LEFT JOIN invoices i ON i.id=t.invoice_id LEFT JOIN customers c ON c.id=i.customer_id ORDER BY t.date DESC,t.id DESC')));
app.post('/api/transactions', (req, res) => { const b = req.body; const kind = choice(b.kind, ['income','expense']); const amount = integer(b.amount, 1, 1e14); const invoiceId = b.invoice_id ? integer(b.invoice_id, 1) : null; const values = [kind, invoiceId, amount, date(b.date), text(b.category, 100, true), choice(b.method, ['transfer','cash','card','other']), text(b.reference, 100), text(b.notes, 2000)]; const id = transaction(() => { if (invoiceId) { const i = one('SELECT *,COALESCE((SELECT SUM(amount) FROM transactions WHERE invoice_id=invoices.id),0) AS paid FROM invoices WHERE id=?', invoiceId); if (!i || kind !== 'income' || i.kind !== 'invoice' || i.status !== 'issued') fail('دریافت فقط برای فاکتور صادرشده ثبت می‌شود.'); if (amount > i.total - i.paid) fail('مبلغ از مانده فاکتور بیشتر است.'); } const r = run('INSERT INTO transactions(kind,invoice_id,amount,date,category,method,reference,notes) VALUES(?,?,?,?,?,?,?,?)', ...values); audit('ثبت تراکنش', String(r.lastInsertRowid)); return Number(r.lastInsertRowid); }); res.json({ id }); });
app.delete('/api/transactions/:id', (req, res) => { transaction(() => { const t = one('SELECT * FROM transactions WHERE id=?', req.params.id); if (!t) fail('تراکنش پیدا نشد.', 404); run('DELETE FROM transactions WHERE id=?', t.id); audit('حذف تراکنش برای اصلاح', JSON.stringify(t)); }); res.json({ ok: true }); });
app.get('/api/audit', (req, res) => res.json(query('SELECT * FROM audit ORDER BY id DESC LIMIT 200')));
const csvCell = value => '"' + String(/^[\s=+\-@]/.test(String(value)) ? "'" + value : value).replaceAll('"', '""') + '"';
const csvFile = (header, rows) => '﻿' + [header.join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\r\n');
const csvSheets = {
 transactions: () => [['نوع','تاریخ','مبلغ (تومان)','دسته','روش','پیگیری','یادداشت'], query('SELECT kind,date,amount,category,method,reference,notes FROM transactions ORDER BY date,id').map(t => [t.kind, formatPersianDate(t.date), t.amount, t.category, t.method, t.reference, t.notes])],
 invoices: () => [['شماره','نوع','وضعیت','مشتری','تاریخ صدور','سررسید','جمع اقلام','تخفیف','مالیات','مبلغ کل','دریافتی','مانده'], invoices().map(i => [i.number, i.kind, i.status, i.customer_snapshot.name, formatPersianDate(i.date), formatPersianDate(i.due_date), i.subtotal, i.discount, i.tax, i.total, i.paid, i.total - i.paid])],
 customers: () => [['نام','شرکت','ایمیل','تلفن','شناسه ملی','نشانی','مانده حساب (تومان)'], customerList().map(c => [c.name, c.company, c.email, c.phone, c.national_id, c.address, c.balance])]
};
app.get('/api/export', (req, res) => { const type = choice(req.query.type || 'transactions', Object.keys(csvSheets)); const [header, rows] = csvSheets[type](); res.set('Content-Disposition', `attachment; filename="${type}.csv"`).type('text/csv').send(csvFile(header, rows)); });
app.post('/api/backup', loginLimit, async (req, res) => { const user = one('SELECT * FROM users'); if (!passwordOK(passwordText(req.body.password), user.password)) fail('گذرواژه نادرست است.', 403); const path = join(data, `backup-${token()}.sqlite`); try { await backup(db, path); const bytes = readFileSync(path); audit('دریافت پشتیبان'); res.set('Content-Disposition', 'attachment; filename="ips-factor.sqlite"').type('application/octet-stream').send(bytes); } finally { if (existsSync(path)) unlinkSync(path); } });
app.use('/fonts', express.static(join(root, 'node_modules/vazirmatn/fonts/webfonts'), { immutable: true, maxAge: '365d' }));
app.use(express.static(join(root, 'public'), { etag: true }));
app.use('/api', (req, res) => res.status(404).json({ error: 'مسیر پیدا نشد.' }));
app.use((err, req, res, next) => { if (!err.status) console.error(err); res.status(err.status || 500).json({ error: err.status ? err.message : 'خطای داخلی؛ دوباره تلاش کنید.' }); });
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`IPS Factor: ${origin} (port ${port})`));
// بستن منظم پایگاه داده هنگام توقف کانتینر؛ وگرنه WAL با SIGKILL نیمه‌کاره می‌ماند.
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; server.close(() => { db.close(); process.exit(0); }); };
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
if (process.env.PORTABLE_CONTROL === '1') process.stdin.once('data', stop);
