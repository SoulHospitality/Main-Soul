const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { escapeHtml } = require('./escapeHtml');
const { inquiryEmailHtml, hostRequestEmailHtml } = require('./leadEmailHtml');

const HOSTILE = '<b>x</b><a href="https://example.com">y</a><img src=x onerror=alert(1)>';
const ESCAPED = '&lt;b&gt;x&lt;/b&gt;&lt;a href=&quot;https://example.com&quot;&gt;y&lt;/a&gt;&lt;img src=x onerror=alert(1)&gt;';
// No tag from the input may survive; only the template's own tags.
const tagsIn = (html) => (html.match(/<\/?([a-z]+)/gi) || []).map((t) => t.replace(/[</]/g, '').toLowerCase());

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
    assert.equal(escapeHtml(HOSTILE), ESCAPED);
  });
  it('null and undefined become empty; numbers, including 0, are kept', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(0), '0');
    assert.equal(escapeHtml(42), '42');
  });
  it('plain text, Arabic and already-escaped text', () => {
    assert.equal(escapeHtml('Ahmed Ali'), 'Ahmed Ali');
    assert.equal(escapeHtml('أحمد'), 'أحمد');
    assert.equal(escapeHtml('&amp;'), '&amp;amp;');
  });
});

describe('lead email templates', () => {
  it('inquiry email shows guest input as text', () => {
    const html = inquiryEmailHtml({ guestName: HOSTILE, guestPhone: '"><script>x</script>', unitTitle: 'Unit <i>1</i>', checkin: '2026-12-01', checkout: '2026-12-03', guests: 2, message: HOSTILE });
    assert.ok(html.includes(ESCAPED));
    assert.deepEqual([...new Set(tagsIn(html))].sort(), ['em', 'p', 'strong']);
    assert.ok(html.includes('2026-12-01 → 2026-12-03, 2 guests'));
  });
  it('inquiry email without a message', () => {
    const html = inquiryEmailHtml({ guestName: 'A', guestPhone: '1', unitTitle: 'U', checkin: 'a', checkout: 'b', guests: 1 });
    assert.ok(html.endsWith('<p></p>'));
  });
  it('host request email shows every field as text', () => {
    const fields = { fullName: HOSTILE, email: 'a@b.co', phone: '+20 1<u>', destination: HOSTILE, project: HOSTILE, propertyType: 'Villa', furnishing: 'Unfurnished', preferredContact: 'Anytime', leadId: 7 };
    const html = hostRequestEmailHtml(fields);
    assert.equal(html.split(ESCAPED).length - 1, 3);
    assert.deepEqual([...new Set(tagsIn(html))].sort(), ['li', 'p', 'strong', 'ul']);
    assert.ok(html.includes('<li>Lead #7</li>'));
  });
});

describe('POST /api/inquiries sends an escaped staff email', () => {
  const sent = [];
  let server;
  let base;
  const saved = process.env.INQUIRY_TO_EMAIL;
  const stub = (rel, exports) => {
    const file = require.resolve(path.join(__dirname, rel));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  before(async () => {
    process.env.INQUIRY_TO_EMAIL = 'staff@example.test';
    stub('../config/db', {
      query: async (sql, params) => {
        if (/FROM units/.test(sql)) return { rows: [{ slug: params[0], wp_post_id: 1, title: 'Sea View <b>2BR</b>', area: 'North Coast' }] };
        if (/INSERT INTO inquiries/.test(sql)) return { rows: [{ id: 1 }] };
        throw new Error('unexpected query');
      },
    });
    stub('../services/pricing', { quoteStay: async () => ({ available: false }) });
    stub('../services/email', { sendEmail: async (m) => { sent.push(m); } });
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/inquiries', require('../routes/inquiries'));
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    server?.close();
    if (saved === undefined) delete process.env.INQUIRY_TO_EMAIL; else process.env.INQUIRY_TO_EMAIL = saved;
  });

  it('the guest message arrives as literal text', async () => {
    const res = await fetch(`${base}/api/inquiries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ listing_slug: 'sea-view', checkin: '2026-12-01', checkout: '2026-12-03', guests: 2, guest_name: HOSTILE, guest_email: 'g@example.test', guest_phone: '+201000000000', message: HOSTILE }),
    });
    assert.equal(res.status, 201);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].html.includes(ESCAPED));
    assert.ok(sent[0].html.includes('Sea View &lt;b&gt;2BR&lt;/b&gt;'));
    assert.deepEqual([...new Set(tagsIn(sent[0].html))].sort(), ['em', 'p', 'strong']);
    assert.ok(sent[0].text.includes(HOSTILE), 'the plain-text body is unchanged');
  });
});
