const nodemailer = require('nodemailer');

async function sendEmail({ to, subject, html, text }) {
  if (process.env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.INQUIRY_FROM_EMAIL || 'Soul Hospitality <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend failed: ${body}`);
    }
    return res.json();
  }

  if (!process.env.SMTP_HOST) {
    console.log('[email:dev]', { to, subject, text: text || html });
    return { id: 'dev-log' };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  return transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.INQUIRY_FROM_EMAIL,
    to,
    subject,
    html,
    text,
  });
}

module.exports = { sendEmail };
