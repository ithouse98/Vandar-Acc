const ones = ['','یک','دو','سه','چهار','پنج','شش','هفت','هشت','نه'];
const teens = ['ده','یازده','دوازده','سیزده','چهارده','پانزده','شانزده','هفده','هجده','نوزده'];
const tens = ['','','بیست','سی','چهل','پنجاه','شصت','هفتاد','هشتاد','نود'];
const hundreds = ['','صد','دویست','سیصد','چهارصد','پانصد','ششصد','هفتصد','هشتصد','نهصد'];
const scales = ['','هزار','میلیون','میلیارد','هزار میلیارد','میلیون میلیارد'];
function group(value) {
 const parts = [];
 if (value >= 100) { parts.push(hundreds[Math.floor(value/100)]); value %= 100; }
 if (value >= 20) { parts.push(tens[Math.floor(value/10)]); value %= 10; }
 else if (value >= 10) { parts.push(teens[value-10]); value = 0; }
 if (value > 0) parts.push(ones[value]);
 return parts.join(' و ');
}
export function persianWords(value) {
 if (!Number.isFinite(value)) return '';
 const sign = value < 0 ? 'منفی ' : '';
 let rest = Math.floor(Math.abs(value));
 if (rest === 0) return 'صفر';
 const groups = [];
 while (rest > 0) { groups.push(rest % 1000); rest = Math.floor(rest/1000); }
 if (groups.length > scales.length) return '';
 return sign + groups.map((n,i) => n ? `${group(n)} ${scales[i]}`.trim() : '').filter(Boolean).reverse().join(' و ');
}
