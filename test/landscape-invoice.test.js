import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landscapeInvoice } from '../public/landscape-invoice.js';

test('landscape invoice shows saved parties and transparent seller seal safely', () => {
 const html = landscapeInvoice({
  number:'IPS-00012', date:'2026-10-30', kind:'invoice',
  customer_snapshot:{name:'مشتری <آزمایشی>',company:'شرکت',national_id:'',address:'تهران',phone:'09120000000'},
  items:[{description:'خدمت طراحی',quantity:2,price:1000000}],
  subtotal:2000000,discount:0,tax:0,total:2000000,notes:'توضیح'
 }, {business:'فروشنده',owner:'مدیر',phone:'',address:'تهران',seal_id:'a'.repeat(64)});
 assert.match(html,/صورتحساب فروش خدمات/);
 assert.match(html,/class="invoice-preview landscape"/);
 assert.match(html,/مهر و امضای فروشنده/);
 assert.match(html,/\/api\/logo\/a{64}/);
 assert.ok(html.includes('مشتری &lt;آزمایشی&gt;'));
 assert.ok(!html.includes('مشتری <آزمایشی>'));
});
