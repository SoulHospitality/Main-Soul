/**
 * One-off Resend smoke test.
 * Usage: node scripts/send-test-email.js
 *
 * Requires Server/.env:
 *   RESEND_API_KEY=re_your_real_key
 *   INQUIRY_FROM_EMAIL=Soul Hospitality <onboarding@resend.dev>
 *     (use onboarding@resend.dev until your domain is verified)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sendEmail } = require('../src/services/email');

(async () => {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey || apiKey.includes('xxxxxxxxx')) {
    console.error('Set RESEND_API_KEY in Server/.env to your real key (re_...).');
    process.exit(1);
  }

  const to = process.env.EMAIL_TEST_TO || 'soulhospitalityy@gmail.com';
  const result = await sendEmail({
    to,
    subject: 'Hello World — Soul Hospitality',
    html: '<p>Congrats on sending your <strong>first email</strong> from Main Soul!</p>',
    text: 'Congrats on sending your first email from Main Soul!',
  });

  console.log('Email sent:', result);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
