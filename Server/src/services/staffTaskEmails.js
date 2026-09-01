const { sendEmail } = require('./email');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDeadline(value) {
  const iso = String(value || '').slice(0, 10);
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function sendStaffTaskAssignedEmail({ to, assigneeName, managerName, title, description, deadline }) {
  const email = String(to || '').trim();
  if (!email) {
    console.warn('[email] No staff email on task — skip task email');
    return null;
  }

  const name = assigneeName || 'there';
  const subject = `New task: ${title}`;
  const deadlineLabel = formatDeadline(deadline);
  const body = String(description || '').trim() || 'No description provided.';

  const text = [
    `Hi ${name},`,
    '',
    `${managerName || 'Your manager'} assigned you a new task.`,
    '',
    `Title: ${title}`,
    `Deadline: ${deadlineLabel}`,
    '',
    body,
    '',
    'Open Tasks in the Soul PMS to review it.',
    'Soul Hospitality',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#283f5e">
      <h1 style="font-size:22px;margin:0 0 12px">New task</h1>
      <p style="margin:0 0 16px;color:#5c6b83">
        Hi ${escapeHtml(name)}, ${escapeHtml(managerName || 'your manager')} assigned you a new task.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr>
          <td style="padding:8px 0;color:#5c6b83;vertical-align:top;width:110px">Title</td>
          <td style="padding:8px 0;font-weight:700">${escapeHtml(title)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#5c6b83;vertical-align:top">Deadline</td>
          <td style="padding:8px 0;font-weight:600">${escapeHtml(deadlineLabel)}</td>
        </tr>
      </table>
      <p style="margin:16px 0 0;white-space:pre-wrap;line-height:1.5">${escapeHtml(body)}</p>
      <p style="margin:24px 0 0;color:#5c6b83;font-size:13px">Soul Hospitality — open Tasks in the PMS to review it.</p>
    </div>
  `;

  return sendEmail({ to: email, subject, html, text });
}

module.exports = { sendStaffTaskAssignedEmail };
