/**
 * Guest care emails (English, then Arabic): the day before arrival, the rating request after
 * checkout, and the invitation back for guests who haven't returned.
 */
const { sendEmail } = require('./email');

const site = () => String(process.env.FRONTEND_URL || 'https://soulhospitality.co').replace(/\/$/, '');
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const day = (iso, locale) =>
  new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function layout({ en, ar, button }) {
  const btn = button
    ? `<p style="margin:24px 0"><a href="${esc(button.href)}" style="background:#163D68;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">${esc(button.label)}</a></p>`
    : '';
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#163D68;line-height:1.6">
    ${en}
    ${btn}
    <hr style="border:none;border-top:1px solid #DFE1E2;margin:24px 0">
    <div dir="rtl" style="text-align:right">${ar}</div>
    <p style="margin:28px 0 0;color:#52677E;font-size:12px">Soul Hospitality · info@soulhospitality.co · 01500009344</p>
  </div>`;
}

async function sendPrearrivalEmail(r) {
  const name = firstName(r.guest_name);
  const map = r.location_url ? `<p><a href="${esc(r.location_url)}">Open the location on Google Maps</a></p>` : '';
  const mapAr = r.location_url ? `<p><a href="${esc(r.location_url)}">الموقع على خرائط جوجل</a></p>` : '';
  const agent = r.agent_name ? `<p>Your host on arrival: <b>${esc(r.agent_name)}</b>${r.agent_phone ? ` · ${esc(r.agent_phone)}` : ''}</p>` : '';
  const agentAr = r.agent_name ? `<p>المسؤول عن استقبالك: <b>${esc(r.agent_name)}</b>${r.agent_phone ? ` · ${esc(r.agent_phone)}` : ''}</p>` : '';
  const html = layout({
    en: `<h1 style="font-size:21px;margin:0 0 12px">See you tomorrow${name ? `, ${esc(name)}` : ''}!</h1>
      <p>Your stay at <b>${esc(r.unit_title)}</b>${r.project ? ` (${esc(r.project)})` : ''} starts <b>${esc(day(r.check_in, 'en-GB'))}</b>. Check-in is from <b>3:00 PM</b>; checkout is by 11:00 AM on ${esc(day(r.check_out, 'en-GB'))}.</p>
      ${map}${agent}
      <p>Please make sure we have the IDs of every guest, so the compound entry permits are ready. Reply to this email or message us on WhatsApp if you need anything.</p>`,
    ar: `<h1 style="font-size:21px;margin:0 0 12px">نشوفك بكرة${name ? ` يا ${esc(name)}` : ''}!</h1>
      <p>إقامتك في <b>${esc(r.unit_title)}</b>${r.project ? ` (${esc(r.project)})` : ''} بتبدأ <b>${esc(day(r.check_in, 'ar-EG'))}</b>. الدخول من الساعة <b>3:00 مساءً</b> والمغادرة قبل 11:00 صباحًا يوم ${esc(day(r.check_out, 'ar-EG'))}.</p>
      ${mapAr}${agentAr}
      <p>من فضلك اتأكد إن هويات كل الضيوف وصلتنا عشان تصاريح دخول الكمبوند تكون جاهزة. لو محتاج أي حاجة رد على الإيميل ده أو كلمنا واتساب.</p>`,
  });
  return sendEmail({
    to: r.guest_email,
    subject: `Your stay starts tomorrow · ${r.unit_title}`,
    html,
    text: `Your stay at ${r.unit_title} starts ${r.check_in}. Check-in from 3:00 PM, checkout by 11:00 AM on ${r.check_out}.${r.location_url ? ` Location: ${r.location_url}` : ''}`,
  });
}

async function sendReviewRequestEmail(r, token) {
  const name = firstName(r.guest_name);
  const link = `${site()}/rate/${token}`;
  const html = layout({
    en: `<h1 style="font-size:21px;margin:0 0 12px">How was your stay${name ? `, ${esc(name)}` : ''}?</h1>
      <p>Thank you for staying at <b>${esc(r.unit_title)}</b>. Could you rate your stay out of 5? It takes ten seconds and helps us look after every guest better.</p>`,
    ar: `<h1 style="font-size:21px;margin:0 0 12px">إيه رأيك في إقامتك${name ? ` يا ${esc(name)}` : ''}؟</h1>
      <p>شكرًا لإقامتك في <b>${esc(r.unit_title)}</b>. ممكن تقيّم إقامتك من 5؟ مش هتاخد غير ثواني وبتساعدنا نخدم كل ضيوفنا أحسن.</p>
      <p><a href="${esc(link)}">قيّم إقامتك</a></p>`,
    button: { href: link, label: 'Rate your stay' },
  });
  return sendEmail({ to: r.guest_email, subject: `How was your stay at ${r.unit_title}?`, html, text: `Rate your stay: ${link}` });
}

async function sendReengageEmail(r, offer) {
  const name = firstName(r.guest_name);
  const offerEn = offer ? `<p>Use code <b>${esc(offer.code)}</b> for ${esc(offer.label)} at checkout.</p>` : '';
  const offerAr = offer ? `<p>استخدم الكود <b>${esc(offer.code)}</b> للحصول على ${esc(offer.label)} عند الدفع.</p>` : '';
  const html = layout({
    en: `<h1 style="font-size:21px;margin:0 0 12px">We'd love to host you again${name ? `, ${esc(name)}` : ''}</h1>
      <p>It's been a while since your stay at <b>${esc(r.unit_title)}</b>. Your next getaway is a few clicks away, and our team is happy to help you pick the right home.</p>${offerEn}`,
    ar: `<h1 style="font-size:21px;margin:0 0 12px">وحشتنا${name ? ` يا ${esc(name)}` : ''}</h1>
      <p>بقالنا فترة من آخر إقامة لك في <b>${esc(r.unit_title)}</b>. إجازتك الجاية على بعد ضغطات، وفريقنا جاهز يساعدك تختار المكان المناسب.</p>${offerAr}`,
    button: { href: `${site()}/search`, label: 'Find your next stay' },
  });
  return sendEmail({ to: r.guest_email, subject: 'Your next stay with Soul Hospitality', html, text: `Find your next stay: ${site()}/search` });
}

module.exports = { sendPrearrivalEmail, sendReviewRequestEmail, sendReengageEmail };
