import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persianWords } from '../public/persian-number.js';

test('amounts are spelled out in Persian for invoice totals', () => {
 assert.equal(persianWords(0),'صفر');
 assert.equal(persianWords(7),'هفت');
 assert.equal(persianWords(15),'پانزده');
 assert.equal(persianWords(20),'بیست');
 assert.equal(persianWords(105),'صد و پنج');
 assert.equal(persianWords(999),'نهصد و نود و نه');
 assert.equal(persianWords(1000),'یک هزار');
 assert.equal(persianWords(1900000),'یک میلیون و نهصد هزار');
 assert.equal(persianWords(2000000000),'دو میلیارد');
 assert.equal(persianWords(1200000000000),'یک هزار میلیارد و دویست میلیارد');
 assert.equal(persianWords(-2500),'منفی دو هزار و پانصد');
});

test('amount spelling ignores fractions and invalid values', () => {
 assert.equal(persianWords(1500.75),'یک هزار و پانصد');
 assert.equal(persianWords(NaN),'');
 assert.equal(persianWords(Infinity),'');
 assert.equal(persianWords(1e18),'');
});
