const { Resend } = require('resend');
const nodemailer = require('nodemailer');

function getResendClient() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey || apiKey.includes('xxxxxxxxx')) return null;
  return new Resend(apiKey);
}

function defaultFrom() {
  return (
    process.env.MAIL_FROM ||
    process.env.INQUIRY_FROM_EMAIL ||
    'Soul Hospitality <onboarding@resend.dev>'
  );
}


async function sendEmail({ to, subject, html, text, attachments }) {
  const resend = getResendClient();
  const files = (attachments || []).map((file) => ({
    filename: file.filename,
    content: Buffer.isBuffer(file.content) ? file.content.toString('base64') : file.content,
  }));

  if (resend) {
    const { data, error } = await resend.emails.send({
      from: defaultFrom(),
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      attachments: files.length ? files : undefined,
    });
    if (error) {
      throw new Error(`Resend failed: ${error.message || JSON.stringify(error)}`);
    }
    return data;
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
    from: defaultFrom(),
    to,
    subject,
    html,
    text,
    attachments: (attachments || []).map((file) => ({
      filename: file.filename,
      content: file.content,
    })),
  });
}

module.exports = { sendEmail, getResendClient, defaultFrom };
