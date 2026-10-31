import { formatPersianDate } from './persian-date.js';
import { persianWords } from './persian-number.js';

const format = value => new Intl.NumberFormat('fa-IR').format(value);
const encoder = new TextEncoder();
const bytes = value => encoder.encode(value);

export function jpegPagesToPdf(images, width = 1240, height = 1754, landscape = false) {
  const chunks = [];
  const offsets = [0];
  let size = 0;
  const append = value => { const chunk = typeof value === 'string' ? bytes(value) : value; chunks.push(chunk); size += chunk.length; };
  const object = (id, parts) => { offsets[id] = size; append(`${id} 0 obj\n`); for (const part of parts) append(part); append('\nendobj\n'); };
  append('%PDF-1.4\n');
  const kids = images.map((_, index) => `${3 + index * 3} 0 R`).join(' ');
  object(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  object(2, [`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`]);
  images.forEach((image, index) => {
    const page = 3 + index * 3;
    const content = bytes(`q ${landscape ? 842 : 595} 0 0 ${landscape ? 595 : 842} 0 0 cm /Im${index} Do Q\n`);
    object(page, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${landscape ? 842 : 595} ${landscape ? 595 : 842}] /Resources << /XObject << /Im${index} ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`]);
    object(page + 1, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
    object(page + 2, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`, image, '\nendstream']);
  });
  const start = size;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let id = 1; id < offsets.length; id++) append(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`);
  return new Blob(chunks, { type:'application/pdf' });
}

const loadImage = src => new Promise(resolve => {
  if (!src) return resolve(null);
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = src;
});

export async function createInvoicePdf(invoice, seller) {
  if (invoice.template === 'landscape') return createLandscapePdf(invoice, seller);
  await document.fonts.ready;
  const customer = invoice.customer_snapshot;
  const [logo, seal, qr] = await Promise.all([
    loadImage(seller.logo_id ? `/api/logo/${seller.logo_id}` : '/vandar-icon.png'),
    loadImage(seller.seal_id && `/api/logo/${seller.seal_id}`),
    loadImage(`/api/invoices/${invoice.id}/qr`)
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = 1240; canvas.height = 1754;
  const ctx = canvas.getContext('2d', { alpha:false });
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  const images = [];
  const ink = { classic:'#6b5735', official:'#1b3f6b', corporate:'#243143', modern:'#173b32', minimal:'#333333', friendly:'#a25126', playful:'#713fa0' }[invoice.template] || '#173b32';
  const line = '#d5e2d8';
  let y;
  const font = (size = 24, bold = false) => { ctx.font = `${bold ? 700 : 400} ${size}px Vazirmatn, Tahoma, sans-serif`; ctx.fillStyle = ink; };
  const text = (value, x, top, size = 24, bold = false) => { font(size, bold); ctx.fillText(String(value ?? ''), x, top); };
  const rule = top => { ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(70, top); ctx.lineTo(1170, top); ctx.stroke(); };
  const wrap = (value, x, top, maxWidth, size = 22, gap = 34) => {
    font(size);
    for (const paragraph of String(value ?? '').split('\n')) {
      let row = '';
      for (const word of paragraph.split(/\s+/)) {
        const next = row ? row + ' ' + word : word;
        if (row && ctx.measureText(next).width > maxWidth) { ctx.fillText(row, x, top); top += gap; row = word; } else row = next;
      }
      ctx.fillText(row, x, top); top += gap;
    }
    return top;
  };
  const image = (source, x, top, maxWidth, maxHeight) => {
    if (!source) return;
    const scale = Math.min(maxWidth / source.width, maxHeight / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    ctx.drawImage(source, x - width, top, width, height);
  };
  const fresh = () => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1240, 1754);
    ctx.fillStyle = ink; ctx.fillRect(0, 0, 1240, 15);
    ctx.textAlign = 'center';
    text(({ invoice:'فاکتور فروش', proforma:'پیش‌فاکتور', quote:'پیشنهاد قیمت' })[invoice.kind], 620, 67, 30, true);
    ctx.textAlign = 'left';
    text(`شماره: ${invoice.number}`, 70, 91, 20);
    text(`تاریخ: ${formatPersianDate(invoice.date)}`, 70, 125, 20);
    ctx.textAlign = 'right';
    rule(1660);
    text(`${invoice.number} · ${formatPersianDate(invoice.date)}`, 1170, 1700, 17);
    y = 220;
  };
  const finish = async () => {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('ساخت تصویر PDF ناموفق بود.');
    images.push(new Uint8Array(await blob.arrayBuffer()));
  };
  fresh();
  image(logo, 1170, 95, 100, 90);
  const businessX = logo ? 1055 : 1170;
  font(24,true);
  let businessLine = '', businessY = 109;
  for (const word of String(seller.business || '').split(/\s+/)) {
    const next = businessLine ? businessLine + ' ' + word : word;
    if (businessLine && ctx.measureText(next).width > (logo ? 390 : 500)) { text(businessLine,businessX,businessY,24,true); businessY += 32; businessLine = word; }
    else businessLine = next;
  }
  text(businessLine,businessX,businessY,24,true);
  text(seller.owner || '', businessX, Math.min(194,businessY+36), 19);
  rule(220);
  const partyTop = 242;
  y = partyTop + 39;
  text('فروشنده', 1140, y, 23, true);
  text('خریدار', 580, y, 23, true);
  y = Math.max(wrap([seller.business,seller.phone,seller.address].filter(Boolean).join(' · '), 1140, y+36, 470, 21, 31), wrap([customer.name,customer.company,customer.phone,customer.address].filter(Boolean).join(' · '), 580, y+36, 340, 21, 31),partyTop+150);
  const partyBottom = y + 20;
  ctx.strokeStyle = '#60766a'; ctx.lineWidth = 2;
  ctx.setLineDash([10,7]);
  ctx.strokeRect(630,partyTop,540,partyBottom-partyTop);
  ctx.strokeRect(70,partyTop,540,partyBottom-partyTop);
  ctx.setLineDash([]);
  image(qr, 205, partyTop+45, 105, 105);
  y = partyBottom + 37;
  text(`تاریخ صدور: ${formatPersianDate(invoice.date)}     سررسید: ${formatPersianDate(invoice.due_date)}`, 1170, y, 22);
  y += 69;
  const header = () => {
    ctx.fillStyle = '#edf5ef'; ctx.fillRect(70, y - 30, 1100, 54);
    ctx.strokeStyle = '#60766a'; ctx.lineWidth = 2; ctx.strokeRect(70, y - 30, 1100, 54);
    for (const edge of [320,450,590]) { ctx.beginPath(); ctx.moveTo(edge,y-30); ctx.lineTo(edge,y+24); ctx.stroke(); }
    text('شرح خدمت', 1145, y + 7, 22, true);
    text('تعداد', 570, y + 7, 19, true);
    text('قیمت واحد', 435, y + 7, 19, true);
    text('مبلغ (تومان)', 300, y + 7, 19, true);
    y += 54;
  };
  header();
  for (const item of invoice.items) {
    font(22);
    const lines = [];
    let row = '';
    for (const word of item.description.split(/\s+/)) {
      const next = row ? row + ' ' + word : word;
      if (row && ctx.measureText(next).width > 610) { lines.push(row); row = word; } else row = next;
    }
    lines.push(row);
    const height = Math.max(58, lines.length * 34 + 16);
    if (y + height > 1500) { await finish(); fresh(); header(); }
    ctx.strokeStyle = '#60766a'; ctx.lineWidth = 2; ctx.strokeRect(70,y-30,1100,height);
    for (const edge of [320,450,590]) { ctx.beginPath(); ctx.moveTo(edge,y-30); ctx.lineTo(edge,y-30+height); ctx.stroke(); }
    lines.forEach((part, index) => text(part, 1145, y + index * 34, 22));
    text(format(item.quantity), 570, y, 21);
    text(format(item.price), 435, y, 21);
    text(format(item.quantity * item.price), 300, y, 21);
    y += height;
  }
  if (y > 1110) { await finish(); fresh(); }
  y += 20;
  const summary = [
    ['جمع اقلام', invoice.subtotal], ['تخفیف', invoice.discount], ['مالیات', invoice.tax],
    ['مبلغ کل', invoice.total],
    ...(invoice.kind === 'invoice' ? [['دریافت‌شده', invoice.paid], ['مانده', invoice.total - invoice.paid]] : [])
  ];
  for (const [label, amount] of summary) {
    ctx.strokeStyle = '#60766a'; ctx.lineWidth = 2;
    ctx.strokeRect(70,y-30,620,42);
    ctx.beginPath(); ctx.moveTo(380,y-30); ctx.lineTo(380,y+12); ctx.stroke();
    text(label, 665, y, 23, label === 'مبلغ کل');
    text(`${format(amount)} تومان`, 355, y, 24, label === 'مبلغ کل');
    y += 42;
  }
  const paragraph = async (value, size = 21) => {
    font(size);
    for (const part of String(value).split('\n')) {
      let row = '';
      for (const word of part.split(/\s+/)) {
        const next = row ? row + ' ' + word : word;
        if (row && ctx.measureText(next).width > 1080) {
          if (y > 1530) { await finish(); fresh(); }
          text(row, 1170, y, size); y += 36; row = word;
        } else row = next;
      }
      if (y > 1530) { await finish(); fresh(); }
      text(row, 1170, y, size); y += 36;
    }
    y += 10;
  };
  y += 15;
  await paragraph(`مبلغ به حروف: ${persianWords(invoice.total)} تومان`, 22);
  if (invoice.notes) await paragraph(invoice.notes);
  if (seller.iban) await paragraph(`اطلاعات پرداخت: ${seller.iban}`);
  const sealScale = Math.min(2,Math.max(.4,Number(seller.seal_scale || 100)/100));
  const signatureHeight = Math.max(170,75+130*sealScale);
  if (y + signatureHeight > 1600) { await finish(); fresh(); }
  ctx.strokeStyle = '#60766a'; ctx.lineWidth = 2;
  ctx.setLineDash([10,7]);
  ctx.strokeRect(650,y-8,520,signatureHeight);
  ctx.strokeRect(70,y-8,520,signatureHeight);
  ctx.setLineDash([]);
  text('مهر و امضای فروشنده', 1140, y + 27, 22, true);
  image(seal, 1140, y + 47, Math.min(270*sealScale,460), 130*sealScale);
  text('امضای خریدار', 560, y + 27, 22, true);
  await finish();
  return jpegPagesToPdf(images);
}

export async function downloadInvoicePdf(invoice, seller) {
  const pdf = await createInvoicePdf(invoice,seller);
  const url = URL.createObjectURL(pdf);
  const link = document.createElement('a');
  const filename = `Vandar-${invoice.customer_snapshot.name}-${formatPersianDate(invoice.date).replaceAll('/', '-')}-${invoice.number}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function createLandscapePdf(invoice, seller) {
  await document.fonts.ready;
  const customer = invoice.customer_snapshot;
  const seal = await loadImage(seller.seal_id && `/api/logo/${seller.seal_id}`);
  const canvas = document.createElement('canvas');
  canvas.width = 1754; canvas.height = 1240;
  const ctx = canvas.getContext('2d', { alpha:false });
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.fillStyle = '#111';
  const pages = [];
  let y = 0;
  const font = (size = 23, bold = false) => { ctx.font = `${bold ? 700 : 400} ${size}px Vazirmatn, Tahoma, sans-serif`; ctx.fillStyle = '#111'; };
  const text = (value, x, top, size = 23, bold = false) => { font(size,bold); ctx.fillText(String(value ?? ''),x,top); };
  const rect = (x, top, width, height) => { ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.strokeRect(x,top,width,height); };
  const dashedRect = (x, top, width, height) => { ctx.setLineDash([10,7]); rect(x,top,width,height); ctx.setLineDash([]); };
  const line = (x1, top, x2) => { ctx.beginPath();ctx.moveTo(x1,top);ctx.lineTo(x2,top);ctx.stroke(); };
  const start = (first = false) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,1754,1240);
    ctx.strokeStyle = '#222';
    if (first) {
      ctx.textAlign = 'center';
      text(({ invoice:'فاکتور فروش', proforma:'پیش‌فاکتور', quote:'پیشنهاد قیمت' })[invoice.kind],877,93,42,true);
      ctx.textAlign = 'left';
      text(`شماره سریال: ${invoice.number}`,70,70,24);
      text(`تاریخ: ${formatPersianDate(invoice.date)}`,70,108,24);
      ctx.textAlign = 'right';
      const party = (title, lines, top) => {
        dashedRect(70,top,1614,113);
        text(title,1000,top+30,25,true);
        line(70,top+40,1684);
        text(lines[0],1640,top+71,22);
        text(lines[1],1640,top+100,20);
      };
      party('مشخصات فروشنده',[`نام: ${seller.business}    مسئول: ${seller.owner || '—'}    تلفن: ${seller.phone || '—'}`,`نشانی: ${seller.address || '—'}`],145);
      party('مشخصات خریدار',[`نام: ${customer.name}    شرکت: ${customer.company || '—'}    موبایل: ${customer.phone || '—'}`,`شناسه: ${customer.national_id || '—'}    نشانی: ${customer.address || '—'}`],266);
      y = 425;
    } else { text(`ادامهٔ ${invoice.number}`,1680,78,29,true); y = 125; }
    text('مشخصات خدمات مورد معامله',1020,y-12,25,true);
    rect(70,y,1614,63);
    const edges = [1684,1584,834,674,514,314,70];
    for (const edge of edges.slice(1,-1)) { ctx.beginPath();ctx.moveTo(edge,y);ctx.lineTo(edge,y+63);ctx.stroke(); }
    ['ردیف','شرح خدمات','تعداد','واحد','قیمت واحد','مبلغ (تومان)'].forEach((label,index) => text(label,edges[index]-12,y+40,22,true));
    y += 63;
  };
  const finish = async () => {
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',0.93));
    if (!blob) throw new Error('ساخت تصویر PDF ناموفق بود.');
    pages.push(new Uint8Array(await blob.arrayBuffer()));
  };
  start(true);
  for (const [index,item] of invoice.items.entries()) {
    font(21);
    const description = [];
    let row = '';
    for (const word of item.description.split(/\s+/)) {
      const next = row ? row+' '+word : word;
      if (row && ctx.measureText(next).width > 720) { description.push(row); row = word; } else row = next;
    }
    description.push(row);
    const height = Math.max(50,description.length*31+15);
    if (y + height > 1050) { await finish(); start(); }
    rect(70,y,1614,height);
    for (const edge of [1584,834,674,514,314]) { ctx.beginPath();ctx.moveTo(edge,y);ctx.lineTo(edge,y+height);ctx.stroke(); }
    text(format(index+1),1672,y+35,21);
    description.forEach((part,n) => text(part,1572,y+35+n*31,21));
    text(format(item.quantity),822,y+35,21);
    text('خدمت',662,y+35,21);
    text(format(item.price),502,y+35,21);
    text(format(item.quantity*item.price),302,y+35,21);
    y += height;
  }
  if (y > 835) { await finish(); start(); }
  const totals = [['جمع اقلام',invoice.subtotal],['تخفیف',invoice.discount],['مالیات',invoice.tax],['جمع کل',invoice.total]];
  rect(70,y,1614,55);
  totals.forEach(([label,value],index) => { const x=1672-index*390; text(`${label}: ${format(value)}`,x,y+37,23,true); });
  y += 55;
  const note = `مبلغ به حروف: ${persianWords(invoice.total)} تومان    توضیحات: ${invoice.notes || '—'}`;
  font(20);
  let part = '';
  for (const word of note.split(/\s+/)) {
    const next = part ? part+' '+word : word;
    if (part && ctx.measureText(next).width > 1560) { if (y > 1060) { await finish(); start(); } text(part,1665,y+30,20); y += 34; part=word; } else part=next;
  }
  if (y > 1060) { await finish(); start(); }
  text(part,1665,y+30,20);
  y += 48;
  const sealScale = Math.min(2,Math.max(.4,Number(seller.seal_scale || 100)/100));
  const signatureHeight = Math.max(115,55+73*sealScale);
  if (y + signatureHeight > 1160) { await finish(); start(); }
  dashedRect(70,y,807,signatureHeight); dashedRect(877,y,807,signatureHeight);
  text('مهر و امضای فروشنده',1640,y+32,23,true);
  if (seal) { const scale=Math.min(220*sealScale/seal.width,73*sealScale/seal.height); ctx.drawImage(seal,1640-seal.width*scale,y+42,seal.width*scale,seal.height*scale); }
  text('مهر و امضای خریدار',850,y+32,23,true);
  await finish();
  return jpegPagesToPdf(pages,1754,1240,true);
}
