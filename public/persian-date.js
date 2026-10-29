const formatter = new Intl.DateTimeFormat('en-US-u-ca-persian', { year:'numeric', month:'numeric', day:'numeric', timeZone:'UTC' });
const dayMs = 86400000;
export const normalizeDigits = value => String(value).replace(/[۰-۹٠-٩]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
export function persianParts(iso) {
 const values = Object.fromEntries(formatter.formatToParts(new Date(iso + 'T12:00:00Z')).filter(p => ['year','month','day'].includes(p.type)).map(p => [p.type,Number(p.value)]));
 return { year:values.year, month:values.month, day:values.day };
}
export function formatPersianDate(iso) {
 if (!iso) return '';
 const p = persianParts(iso);
 return `${p.year}/${String(p.month).padStart(2,'0')}/${String(p.day).padStart(2,'0')}`.replace(/\d/g, n => '۰۱۲۳۴۵۶۷۸۹'[n]);
}
export function parsePersianDate(value) {
 const match = normalizeDigits(value).trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
 if (!match) return null;
 const [year,month,day] = match.slice(1).map(Number);
 if (year < 1200 || year > 1600 || month < 1 || month > 12 || day < 1 || day > 31) return null;
 const target = year*372+month*31+day;
 let low = Math.floor(Date.UTC(year+621,0,1)/dayMs), high = Math.floor(Date.UTC(year+622,11,31)/dayMs);
 while (low <= high) {
  const middle = Math.floor((low+high)/2);
  const iso = new Date(middle*dayMs).toISOString().slice(0,10);
  const p = persianParts(iso), ordinal = p.year*372+p.month*31+p.day;
  if (ordinal === target) return iso;
  if (ordinal < target) low = middle+1; else high = middle-1;
 }
 return null;
}
export function persianMonth(year, month) {
 const first = parsePersianDate(`${year}/${month}/1`);
 if (!first) throw new Error('تاریخ خارج از بازه پشتیبانی است.');
 const length = month <= 6 ? 31 : month < 12 ? 30 : parsePersianDate(`${year}/12/30`) ? 30 : 29;
 const start = new Date(first + 'T12:00:00Z');
 return { offset:(start.getUTCDay()+1)%7, days:Array.from({ length }, (_,i) => new Date(start.getTime()+i*dayMs).toISOString().slice(0,10)) };
}
