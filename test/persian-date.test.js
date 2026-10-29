import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePersianDate, formatPersianDate, persianMonth } from '../public/persian-date.js';

test('Persian input accepts Persian, Arabic and Latin digits and round trips Nowruz', () => {
 assert.equal(parsePersianDate('۱۴۰۵/۰۸/۰۷'),'2026-10-29');
 assert.equal(parsePersianDate('١٤٠٥/٠٨/٠٧'),'2026-10-29');
 assert.equal(parsePersianDate('1403/1/1'),'2024-03-20');
 assert.equal(parsePersianDate('1404/1/1'),'2025-03-21');
 assert.equal(formatPersianDate('2026-10-29'),'۱۴۰۵/۰۸/۰۷');
});
test('Persian calendar validates Esfand leap years and month boundaries', () => {
 assert.equal(parsePersianDate('1403/12/30'),'2025-03-20');
 assert.equal(parsePersianDate('1404/12/30'),null);
 for (const invalid of ['1405/7/31','1405/13/1','1405/0/1','1405/1/0','2026-10-29','hello','1405/2/32']) assert.equal(parsePersianDate(invalid),null);
 assert.equal(persianMonth(1403,12).days.length,30);
 assert.equal(persianMonth(1404,12).days.length,29);
 assert.equal(persianMonth(1405,1).days.length,31);
 assert.equal(persianMonth(1405,8).days.length,30);
 assert.equal(persianMonth(1405,8).offset,6);
});
test('Persian dates round trip across every day of a leap year', () => {
 const first = Date.parse('2024-03-20T12:00:00Z');
 for (let i=0;i<366;i++) { const iso = new Date(first+i*86400000).toISOString().slice(0,10); assert.equal(parsePersianDate(formatPersianDate(iso)),iso); }
});
