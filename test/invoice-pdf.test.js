import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jpegPagesToPdf } from '../public/invoice-pdf.js';

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
