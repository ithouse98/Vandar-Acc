import { formatPersianDate } from './persian-date.js';
import { persianWords } from './persian-number.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const fa = value => new Intl.NumberFormat('fa-IR').format(value || 0);
const info = (title, rows) => `<section class="landscape-party"><h3>${title}</h3><div>${rows.map(([label,value]) => `<p><b>${label}:</b> ${esc(value || '—')}</p>`).join('')}</div></section>`;

export function landscapeInvoice(invoice, seller) {
 const customer = invoice.customer_snapshot;
 return `<article class="invoice-preview landscape">
 <header class="landscape-head"><div><p>شماره سریال: <b dir="ltr">${esc(invoice.number)}</b></p><p>تاریخ: ${formatPersianDate(invoice.date)}</p></div><h2>صورتحساب فروش خدمات</h2><span>${esc(({invoice:'فاکتور فروش',proforma:'پیش‌فاکتور',quote:'پیشنهاد قیمت'})[invoice.kind])}</span></header>
 ${info('مشخصات فروشنده', [['نام شخص / کسب‌وکار',seller.business],['نام مسئول',seller.owner],['نشانی',seller.address],['شماره تماس',seller.phone]])}
 ${info('مشخصات خریدار', [['نام شخص / شرکت',customer.name],['شرکت',customer.company],['شناسه ملی / اقتصادی',customer.national_id],['نشانی',customer.address],['موبایل',customer.phone]])}
 <section class="landscape-lines"><h3>مشخصات خدمات مورد معامله</h3><table><thead><tr><th>ردیف</th><th>شرح خدمات</th><th>تعداد</th><th>واحد</th><th>قیمت واحد (تومان)</th><th>مبلغ (تومان)</th></tr></thead><tbody>${invoice.items.map((item,index) => `<tr><td>${fa(index+1)}</td><td>${esc(item.description)}</td><td>${fa(item.quantity)}</td><td>خدمت</td><td>${fa(item.price)}</td><td>${fa(item.quantity*item.price)}</td></tr>`).join('')}</tbody></table></section>
 <div class="landscape-summary"><span>جمع اقلام: <b>${fa(invoice.subtotal)}</b></span><span>تخفیف: <b>${fa(invoice.discount)}</b></span><span>مالیات: <b>${fa(invoice.tax)}</b></span><span>جمع کل: <b>${fa(invoice.total)} تومان</b></span></div>
 <p class="landscape-words">مبلغ به حروف: ${esc(persianWords(invoice.total))} تومان</p>
 <p class="landscape-notes">توضیحات و شرایط فروش: ${esc(invoice.notes || '—')}</p>
 <div class="landscape-signatures"><div><b>مهر و امضای فروشنده</b>${seller.seal_id ? `<img class="seal-image" src="/api/logo/${esc(seller.seal_id)}" alt="مهر و امضای فروشنده">` : ''}</div><div><b>مهر و امضای خریدار</b></div></div>
 <small>مبالغ به تومان است. این سند صورتحساب الکترونیکی سامانه مؤدیان نیست.</small></article>`;
}
