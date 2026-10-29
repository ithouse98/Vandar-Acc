import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';

const dir = mkdtempSync(join(tmpdir(), 'vandar-test-'));
const port = 32000 + Math.floor(Math.random() * 10000);
const origin = `http://localhost:${port}`;
let child, cookie = '', csrf = '', customerId, invoiceId, recovery, logoId;
let password = ' a-long-test-password ';
async function request(path, method = 'GET', body, options = {}) {
 const response = await fetch(origin + '/api' + path, { method, headers:{ Origin:origin, Cookie:cookie, 'Content-Type':'application/json', 'X-CSRF-Token':csrf, ...options.headers }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
 if (options.session !== false) { const value = response.headers.get('set-cookie'); if (value) cookie = value.split(';')[0]; }
 const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.arrayBuffer();
 if (result.csrf && options.session !== false) csrf = result.csrf;
 return { status:response.status, result, response };
}
const customer = { name:'مشتری آزمایشی',company:'استودیو آزمایش',email:'test@example.com',phone:'09120000000',national_id:'',address:'آدرس آزمایشی',notes:'' };
const invoice = () => ({customer_id:customerId,kind:'invoice',status:'issued',date:'2026-10-01',due_date:'2026-10-20',items:[{description:'طراحی نرم‌افزار',quantity:2,price:1000000}],discount:100000,tax_rate:10,notes:'',template:'modern'});
const payment = amount => ({ kind:'income',invoice_id:invoiceId,amount,date:'2026-10-29',category:'پروژه',method:'transfer',reference:'test',notes:'' });
function code(secret, step) { const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5,'0')).join(''); const bytes = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b,2))); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step)); const digest = createHmac('sha1',bytes).update(counter).digest(); return String((digest.readUInt32BE(digest[19]&15)&0x7fffffff)%1000000).padStart(6,'0'); }
before(async () => {
 child = spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:origin,DATA_DIR:dir,SETUP_TOKEN:'test-setup-secret',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject) => { const timer = setTimeout(() => reject(new Error('Server did not start')),10000); child.stdout.on('data',b => { if (String(b).includes('IPS Factor:')) { clearTimeout(timer); resolve(); } }); child.once('exit',c => reject(new Error('Server exited '+c))); });
});
after(async () => { if (child && child.exitCode === null) { child.kill(); await new Promise(r => child.once('exit',r)); } rmSync(dir,{recursive:true,force:true}); });

test('private APIs reject unauthenticated access and assets carry security headers', async () => {
 assert.equal((await request('/customers')).status,401);
 const res = await fetch(origin);
 assert.equal(res.status,200); assert.match(res.headers.get('content-security-policy'),/script-src 'self'/); assert.equal(res.headers.get('x-frame-options'),'SAMEORIGIN');
 assert.equal((await fetch(origin+'/fonts/Vazirmatn%5Bwght%5D.woff2')).status,200);
 assert.equal((await fetch(origin+'/data/accounting.sqlite')).status,404);
});
test('setup validates token, password, and can run only once', async () => {
 assert.equal((await request('/setup','POST',{token:'wrong',email:'owner@example.com',name:'مدیر',password})).status,403);
 assert.equal((await request('/setup','POST',{token:'test-setup-secret',email:'owner@example.com',name:'مدیر',password})).status,200);
 const session = await request('/session'); assert.equal(session.result.authenticated,true);
 assert.equal((await request('/setup','POST',{})).status,409);
});
test('origin and CSRF guards reject writes', async () => {
 assert.equal((await request('/customers','POST',customer,{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await request('/customers','POST',customer,{headers:{'X-CSRF-Token':'wrong'}})).status,403);
 assert.equal((await request('/customers')).result.length,0);
});
test('customer CRUD and parameterized search do not execute SQL', async () => {
 const response = await request('/customers','POST',customer); assert.equal(response.status,200); customerId = response.result.id;
 assert.equal((await request('/customers/'+customerId,'PUT',{...customer,name:"مشتری '); DROP TABLE customers; --"})).status,200);
 assert.equal((await request('/customers')).result.length,1);
 assert.equal((await request('/customers/'+customerId,'PUT',customer)).status,200);
});
test('logo upload validates and normalizes images, protects access and keeps history', async () => {
 assert.equal((await request('/logo','POST',{image:'data:image/svg+xml;base64,PHN2Zy8+'})).status,400);
 assert.equal((await request('/logo','POST',{image:'data:image/png;base64,aGVsbG8='})).status,400);
 const bytes = await sharp({create:{width:20,height:20,channels:4,background:'#205c49'}}).png().toBuffer();
 const response = await request('/logo','POST',{image:'data:image/png;base64,'+bytes.toString('base64')});
 assert.equal(response.status,200); logoId = response.result.id;
 assert.match(logoId,/^[a-f0-9]{64}$/);
 const image = await request('/logo/'+logoId); assert.equal(image.status,200); assert.match(image.response.headers.get('content-type'),/image\/png/);
 assert.equal((await sharp(Buffer.from(image.result)).metadata()).width,20);
 assert.equal((await request('/logo/'+logoId,'GET',undefined,{headers:{Cookie:''}})).status,401);
 assert.equal((await request('/settings')).result.logo_id,logoId);
});
test('invoice arithmetic is calculated on server and validation is atomic', async () => {
 assert.equal((await request('/invoices','POST',{...invoice(),discount:999999999})).status,400);
 assert.equal((await request('/invoices','POST',{...invoice(),date:'2026-02-30'})).status,400);
 assert.equal((await request('/invoices','POST',{...invoice(),items:[{description:'x',quantity:0,price:5}]})).status,400);
 const response = await request('/invoices','POST',{...invoice(),total:1}); assert.equal(response.status,200); invoiceId = response.result.id;
 const i = (await request('/invoices')).result[0]; assert.equal(i.subtotal,2000000); assert.equal(i.tax,190000); assert.equal(i.total,2090000); assert.equal(i.number,'IPS-00001');
 assert.equal((await request('/customers/'+customerId,'DELETE')).status,400);
});
test('concurrent stale invoice edits fail without overwriting', async () => {
 assert.equal((await request('/invoices/'+invoiceId,'PUT',{...invoice(),version:1})).status,200);
 assert.equal((await request('/invoices/'+invoiceId,'PUT',{...invoice(),version:1})).status,409);
});
test('payments support partial settlement, reject overpayments and lock paid invoices', async () => {
 const response = await request('/transactions','POST',payment(1000000)); assert.equal(response.status,200);
 assert.equal((await request('/invoices')).result[0].paid,1000000);
 assert.equal((await request('/customers')).result[0].balance,1090000);
 assert.equal((await request('/transactions','POST',payment(1090001))).status,400);
 assert.equal((await request('/invoices/'+invoiceId,'PUT',{...invoice(),version:2})).status,400);
 assert.equal((await request('/invoices/'+invoiceId+'/void','POST',{})).status,400);
 assert.equal((await request('/transactions','POST',payment(1090000))).status,200);
 assert.equal((await request('/customers')).result[0].balance,0);
});
test('drafts and quotes cannot receive payments; expenses cannot link to invoices', async () => {
 const draft = await request('/invoices','POST',{...invoice(),status:'draft'});
 assert.equal((await request('/transactions','POST',{...payment(10),invoice_id:draft.result.id})).status,400);
 const quote = await request('/invoices','POST',{...invoice(),kind:'quote'});
 assert.equal((await request('/transactions','POST',{...payment(10),invoice_id:quote.result.id})).status,400);
 assert.equal((await request('/transactions','POST',{...payment(10),kind:'expense'})).status,400);
 assert.equal((await request('/transactions','POST',{...payment(10),kind:'expense',invoice_id:null,notes:'=SUM(1,1)'})).status,200);
 const csv = await request('/export'); const contents = new TextDecoder().decode(csv.result); assert.match(contents,/'=SUM\(1,1\)/); assert.match(contents,/۱۴۰۵\/۰۸\/۰۷/); assert.ok(!contents.includes('2026-10-29'));
});
test('invoice and customer exports render, and unknown sheets are rejected', async () => {
 const invoiceCsv = new TextDecoder().decode((await request('/export?type=invoices')).result);
 assert.match(invoiceCsv,/شماره/); assert.match(invoiceCsv,/IPS-0000/); assert.match(invoiceCsv,/۱۴۰۵\//);
 const customerCsv = new TextDecoder().decode((await request('/export?type=customers')).result);
 assert.match(customerCsv,/مانده حساب/); assert.match(customerCsv,/مشتری آزمایشی/);
 assert.equal((await request('/export?type=users')).status,400);
});
test('invoice QR renders a PNG and hides unknown documents', async () => {
 const qr = await request(`/invoices/${invoiceId}/qr`);
 assert.equal(qr.status,200); assert.equal(qr.response.headers.get('content-type'),'image/png');
 assert.deepEqual([...new Uint8Array(qr.result).slice(0,4)],[0x89,0x50,0x4e,0x47]);
 assert.equal((await request('/invoices/999999/qr')).status,404);
});
test('customer details are frozen on issued documents', async () => {
 await request('/customers/'+customerId,'PUT',{...customer,name:'نام جدید'});
 const i = (await request('/invoices')).result.find(i => i.id === invoiceId); assert.equal(i.customer_snapshot.name,customer.name);
 const settings = (await request('/settings')).result;
 await request('/settings','PUT',{...settings,business:'نام تجاری جدید'});
 const unchanged = (await request('/invoices')).result.find(i => i.id === invoiceId);
 assert.equal(unchanged.seller_snapshot.business,settings.business);
 assert.equal(unchanged.seller_snapshot.logo_id,logoId);
 assert.equal((await request('/logo','DELETE')).status,200);
 assert.equal((await request('/settings')).result.logo_id,'');
 assert.equal((await request('/logo/'+logoId)).status,200);
});
test('backup requires password and is a consistent SQLite database', async () => {
 const response = await request('/backup','POST',{password}); assert.equal(response.status,200);
 assert.equal(new TextDecoder().decode(response.result.slice(0,15)),'SQLite format 3');
 const path = join(dir,'restored.sqlite'); writeFileSync(path,Buffer.from(response.result));
 const restored = new DatabaseSync(path,{readOnly:true});
 assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.equal(restored.prepare('SELECT total FROM invoices WHERE id=?').get(invoiceId).total,2090000);
 restored.close();
});
test('password changes revoke other sessions and preserve whitespace correctly', async () => {
 const other = await request('/login','POST',{email:'owner@example.com',password},{session:false,headers:{Cookie:''}});
 const otherCookie = other.response.headers.get('set-cookie').split(';')[0];
 const next = ' another-long-test-password ';
 assert.equal((await request('/security/password','POST',{current:password,password:next})).status,200);
 password = next;
 assert.equal((await request('/customers','GET',undefined,{headers:{Cookie:otherCookie}})).status,401);
 assert.equal((await request('/session')).result.authenticated,true);
});
test('offline recovery refuses noninteractive password input without changing the account', () => {
 const db = new DatabaseSync(join(dir,'accounting.sqlite'),{readOnly:true});
 const before = db.prepare('SELECT password FROM users').get().password;
 const recovery = spawnSync(process.execPath,['scripts/recover-admin.js'],{env:{...process.env,DATA_DIR:dir},input:'not-an-interactive-password\n',encoding:'utf8'});
 assert.notEqual(recovery.status,0);
 assert.match(recovery.stderr,/interactive terminal/);
 assert.equal(db.prepare('SELECT password FROM users').get().password,before);
 db.close();
});
test('TOTP enrollment encrypts secret and logs out other sessions', async () => {
 const response = await request('/security/totp/start','POST',{password}); assert.equal(response.status,200);
 const secret = response.result.secret; assert.equal(secret.length,32); assert.match(response.result.qr,/^data:image\/png;base64,/);
 const enrolled = await request('/security/totp/enable','POST',{code:code(secret,Math.floor(Date.now()/30000))}); assert.equal(enrolled.status,200); recovery = enrolled.result.codes;
 const stored = new DatabaseSync(join(dir,'accounting.sqlite'),{readOnly:true}); const user = stored.prepare('SELECT * FROM users').get(); stored.close(); assert.ok(!user.totp.includes(secret)); assert.ok(!user.recovery.includes(recovery[0]));
 assert.equal((await request('/session')).result.user.twoFactor,true);
 await request('/logout','POST',{});
 const login = await request('/login','POST',{email:'owner@example.com',password}); assert.equal(login.result.pending,true);
 assert.equal((await request('/customers')).status,401);
 assert.equal((await request('/login/verify','POST',{code:code(secret,Math.floor(Date.now()/30000))})).status,401);
 assert.equal((await request('/login/verify','POST',{code:recovery[0]})).status,200);
});
test('recovery codes are one-use and login changes session identifiers', async () => {
 const oldCookie = cookie;
 await request('/logout','POST',{});
 assert.equal((await request('/login','POST',{email:'owner@example.com',password})).status,200);
 assert.notEqual(cookie,oldCookie);
 assert.equal((await request('/login/verify','POST',{code:recovery[0]})).status,401);
 assert.equal((await request('/login/verify','POST',{code:recovery[1]})).status,200);
});
test('failed login attempts are rate limited', async () => {
 let response;
 for (let i=0;i<12;i++) response = await request('/login','POST',{email:'owner@example.com',password:'wrong-password'});
 assert.equal(response.status,429);
});
