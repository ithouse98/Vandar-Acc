import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jpegPagesToPdf, createInvoicePdf } from '../public/invoice-pdf.js';

test('direct PDF writer creates a multipage downloadable PDF', async () => {
 const image = Uint8Array.of(0xff,0xd8,0xff,0xd9);
 const blob = jpegPagesToPdf([image,image]);
 const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
 assert.equal(blob.type,'application/pdf');
 assert.match(pdf,/^%PDF-1\.4/);
 assert.match(pdf,/\/Count 2/);
 assert.match(pdf,/\/Subtype \/Image/g);
 assert.match(pdf,/startxref\n\d+\n%%EOF$/);
 const landscape = Buffer.from(await jpegPagesToPdf([image],1754,1240,true).arrayBuffer()).toString('latin1');
 assert.match(landscape,/\/MediaBox \[0 0 842 595\]/);
});

test('PDF pages center the document title and draw a full item grid', async () => {
 const previousDocument = globalThis.document, previousImage = globalThis.Image;
 const calls = [];
 const context = {
  direction:'rtl',textAlign:'right',
  fillRect(){},beginPath(){},moveTo(x,y){ calls.push(['move',x,y]); },lineTo(){},stroke(){},
  setLineDash(pattern){ this.dash=pattern.length>0; },
  strokeRect(x,y,w,h){ calls.push(['rect',x,y,w,h,this.dash]); },drawImage(){},
  measureText(value){ return {width:String(value).length*10}; },
  fillText(value,x,y){ calls.push(['text',value,x,y,this.textAlign]); }
 };
 globalThis.document = {fonts:{ready:Promise.resolve()},createElement:() => ({width:0,height:0,getContext:()=>context,toBlob:callback=>callback(new Blob([Uint8Array.of(0xff,0xd8,0xff,0xd9)]))})};
 globalThis.Image = class { width=100; height=100; set src(value){ this.onload(); } };
 const invoice = {id:1,number:'IPS-1',date:'2026-10-31',due_date:'2026-11-10',kind:'proforma',template:'modern',customer_snapshot:{name:'مشتری'},items:[{description:'خدمت',quantity:1,price:1000}],subtotal:1000,discount:0,tax:0,total:1000,notes:'',paid:0};
 try {
  const pdf = await createInvoicePdf(invoice,{business:'فروشنده',owner:'',address:'',phone:'',seal_scale:100});
  assert.equal(pdf.type,'application/pdf');
  assert.ok(calls.some(c => c[0]==='text' && c[1]==='پیش‌فاکتور' && c[2]===620 && c[3]===67 && c[4]==='center'));
  assert.ok(calls.some(c => c[0]==='text' && String(c[1]).startsWith('تاریخ:') && c[2]===70 && c[4]==='left'));
  assert.ok(calls.filter(c => c[0]==='rect' && c[3]===1100).length>=2);
  assert.ok(calls.filter(c => c[0]==='rect' && c[3]===620).length>=4);
  assert.ok(calls.filter(c => c[0]==='rect' && c[3]===540).length>=2);
  assert.equal(calls.filter(c => c[0]==='rect' && [540,520].includes(c[3])).length,4);
  assert.ok(calls.filter(c => c[0]==='rect' && [540,520].includes(c[3])).every(c => c[5]));
  assert.ok(calls.some(c => c[0]==='text' && c[1]==='فروشنده' && c[2]===1140));
  assert.ok(calls.some(c => c[0]==='move' && c[1]===590));
  calls.length=0;
  await createInvoicePdf({...invoice,template:'landscape'},{business:'فروشنده',owner:'',address:'',phone:'',seal_scale:100});
  assert.ok(calls.filter(c => c[0]==='rect' && [113,115].includes(c[4])).every(c => c[5]));
 } finally { globalThis.document=previousDocument; globalThis.Image=previousImage; }
});
