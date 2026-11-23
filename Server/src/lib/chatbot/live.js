/**
 * The chatbot on real Instagram and Messenger conversations (WhatsApp joins once it is activated).
 *
 * - Answers a customer message within seconds, day and night, when the bot is on for that channel.
 * - A burst of messages is answered once (it waits a few seconds and reads them together).
 * - When a person replies (in the Live Inbox, Meta Business Suite or the Instagram app), the bot stays
 *   quiet in that conversation only: 1 hour on Instagram, 10 minutes on Messenger (changeable in settings).
 *   The bot's own messages are never mistaken for a person's (they carry our app id / our message id).
 * - Blocked guests get nothing from the bot. After a hand-off the chat belongs to the team.
 */
const { query } = require('../../config/db');
const { q } = require('../inbox/db');
const { getSettings, loadSettings } = require('../inbox/settings');
const { broadcast } = require('../inbox/realtime');
const { parseJson } = require('../inbox/db');
const assistant = require('./assistant');
const { isBlocked, guestProfile, profileLine } = require('./guests');
const { loadMedia } = require('./media');

const LIVE_KINDS = ['instagram', 'messenger'];
const DEBOUNCE_MS = Number(process.env.CHATBOT_DEBOUNCE_MS || 4000);
// After a hand-off, the bot comes back once nobody from the team has written for this long.
const HANDOFF_QUIET_HOURS = 24;

function botOn(kind) {
  const s = getSettings();
  return LIVE_KINDS.includes(kind) && Boolean(s[`chatbot_${kind}`]);
}

function pauseMinutes(kind) {
  const s = getSettings();
  const v = Number(s[`chatbot_pause_${kind}_min`]);
  return Number.isFinite(v) && v >= 0 ? v : kind === 'instagram' ? 60 : 10;
}

async function sessionFor(conversationId) {
  const { rows } = await query('SELECT * FROM chatbot_sessions WHERE live_conversation_id = $1', [conversationId]);
  return rows[0] || null;
}

async function ensureSession(conv) {
  const existing = await sessionFor(conv.id);
  if (existing) return existing;
  const customer = await q.get('SELECT name, phone FROM inbox_customers WHERE id = ?', conv.customer_id);
  // The bot starts after our last reply, and never picks up customer messages older than 30 minutes.
  const { rows: last } = await query(
    `SELECT COALESCE(MAX(id), 0)::int AS id FROM inbox_messages
     WHERE conversation_id = $1 AND (direction = 'out' OR created_at < $2)`,
    [conv.id, Date.now() - 30 * 60000]
  );
  try {
    const created = await assistant.createSession({
      customerName: customer?.name || 'Customer',
      channelKind: conv.channel_kind,
      mode: 'live',
      liveConversationId: conv.id,
      phone: customer?.phone || null,
    });
    // Only the customer's messages since our last reply are new to the bot.
    if (last[0]?.id) {
      await query('UPDATE chatbot_sessions SET last_seen_message_id = $2 WHERE id = $1', [created.id, last[0].id]);
      created.last_seen_message_id = last[0].id;
    }
    return created;
  } catch (err) {
    if (err.code === '23505') return sessionFor(conv.id); // created by a parallel message
    throw err;
  }
}

/** Why the bot would not answer this conversation right now (null = it answers). */
async function quietReason(conv, session) {
  if (!botOn(conv.channel_kind)) return 'off';
  const customer = await q.get('SELECT phone, is_simulated FROM inbox_customers WHERE id = ?', conv.customer_id);
  if (Number(customer?.is_simulated) === 1) return 'simulated';
  if (await isBlocked({ customerId: conv.customer_id, phone: customer?.phone })) return 'blocked';
  if (session?.paused_until && new Date(session.paused_until).getTime() > Date.now()) return 'paused';
  if (session?.status === 'handed_off') {
    // The team owns it until a day passes without anyone from the team writing.
    const lastHuman = await q.get(
      "SELECT MAX(created_at) AS at FROM inbox_messages WHERE conversation_id = ? AND direction = 'out' AND sender_type IN ('agent', 'external')",
      conv.id
    );
    const since = Math.max(Number(lastHuman?.at) || 0, session.handed_off_at ? new Date(session.handed_off_at).getTime() : 0);
    if (Date.now() - since < HANDOFF_QUIET_HOURS * 3600000) return 'handed_off';
    await query("UPDATE chatbot_sessions SET status = 'bot', handoff_reason = NULL, updated_at = now() WHERE id = $1", [session.id]);
    session.status = 'bot';
  }
  return null;
}

/**
 * Called after a customer message lands in the inbox. Returns true when the bot will answer
 * (the inbox then skips routing it to an agent).
 */
async function willAnswer(conversationId) {
  await loadSettings();
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
  if (!conv || !LIVE_KINDS.includes(conv.channel_kind)) return false;
  const session = await sessionFor(conv.id);
  return (await quietReason(conv, session)) === null;
}

const timers = new Map();

/** Schedules the answer a few seconds later, so a burst of messages gets one reply. */
function onCustomerMessage(conversationId) {
  clearTimeout(timers.get(conversationId));
  const t = setTimeout(() => {
    timers.delete(conversationId);
    answer(conversationId).catch((err) => console.error('[chatbot live] answer failed:', err.message));
  }, DEBOUNCE_MS);
  t.unref?.();
  timers.set(conversationId, t);
}

function answer(conversationId) {
  return assistant.serial(`live-${conversationId}`, async () => {
    await loadSettings();
    const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
    if (!conv || !LIVE_KINDS.includes(conv.channel_kind)) return;
    let session = await ensureSession(conv);
    if (await quietReason(conv, session)) return;

    const fresh = await q.all(
      `SELECT id, body, attachments_json FROM inbox_messages
       WHERE conversation_id = ? AND direction = 'in' AND id > ? ORDER BY id`,
      conv.id, session.last_seen_message_id || 0
    );
    if (!fresh.length) return;
    const lastId = fresh[fresh.length - 1].id;
    await query('UPDATE chatbot_sessions SET last_seen_message_id = $2 WHERE id = $1', [session.id, lastId]);
    const text = fresh.map((m) => m.body).filter(Boolean).join('\n').slice(0, 4000);
    const attachments = fresh.flatMap((m) => parseJson(m.attachments_json, []) || []);

    session = await assistant.loadSession(session.id);
    const customer = await q.get('SELECT name, phone FROM inbox_customers WHERE id = ?', conv.customer_id);
    if (customer?.phone) {
      session.phone = customer.phone;
      const profile = await guestProfile(customer.phone).catch(() => null);
      if (profile?.visits) session.guestContext = profileLine(profile);
    }

    let turn;
    try {
      const media = attachments.length ? await loadMedia(attachments) : [];
      let said = text;
      if (!said && !media.length) {
        // A voice note we couldn't open: ask them to write it. Stickers and shares get no reply.
        if (!attachments.some((a) => a.type === 'audio')) return;
        said = '(The customer sent a voice note that could not be opened. Ask them kindly to write their message.)';
      }
      turn = await assistant.botTurn(session, said, { media });
    } catch (err) {
      if (err.code === 'NO_AI_KEY') return console.error('[chatbot live]', err.message);
      console.error('[chatbot live] reply failed', assistant.aiErrorText(err));
      turn = { reply: assistant.inLanguage(assistant.BUSY_REPLY, text), handoff: { reason: 'The assistant was unavailable', summary: `Error: ${assistant.aiErrorText(err)}` } };
    }
    if (session.blocked) return;

    // A person may have answered while the AI was thinking: then the bot stays quiet.
    const after = await sessionFor(conv.id);
    if (after?.paused_until && new Date(after.paused_until).getTime() > Date.now()) return;

    const { sendToCustomer } = require('../inbox/outbound');
    const parts = assistant.splitReply(turn.reply, Boolean(turn.cards?.length));
    for (const part of parts) {
      try {
        await sendToCustomer(conv.id, { text: part.slice(0, 4000), senderType: 'ai' });
      } catch (err) {
        console.error('[chatbot live] send failed:', err.message);
        break;
      }
    }

    if (turn.handoff) {
      const handedTo = await assistant.handOff(await assistant.loadSession(session.id), { ...turn.handoff, lastCustomerText: text });
      if (turn.handoff.urgentCallId && handedTo) {
        await query('UPDATE urgent_calls SET inbox_conversation_id = $2 WHERE id = $1', [turn.handoff.urgentCallId, handedTo]).catch(() => {});
      }
    } else {
      // The bot answered: the chat isn't waiting on the team (no reply clock, no routing).
      await q.run(
        `UPDATE inbox_conversations SET awaiting_since = NULL, sla_start_at = NULL, sla_due_at = NULL, sla_warned = 0, sla_breached = 0,
           escalation_level = 0, status = CASE WHEN status = 'needs_reply' THEN 'waiting_customer' ELSE status END
         WHERE id = ?`,
        conv.id
      );
      broadcast('conversation', { id: conv.id });
    }
  });
}

/**
 * A person replied (Live Inbox, Meta Business Suite or the app): the bot pauses in this conversation only.
 */
async function onHumanReply(conversationId) {
  await loadSettings();
  const conv = await q.get('SELECT id, channel_kind, customer_id FROM inbox_conversations WHERE id = ?', conversationId);
  if (!conv || !LIVE_KINDS.includes(conv.channel_kind)) return;
  clearTimeout(timers.get(conversationId));
  timers.delete(conversationId);
  const minutes = pauseMinutes(conv.channel_kind);
  const session = await ensureSession(conv);
  // Everything the customer sent so far has been seen by the person who answered.
  const { rows } = await query("SELECT COALESCE(MAX(id), 0)::int AS id FROM inbox_messages WHERE conversation_id = $1 AND direction = 'in'", [conv.id]);
  await query(
    `UPDATE chatbot_sessions SET paused_until = now() + ($2 || ' minutes')::interval, last_seen_message_id = GREATEST(last_seen_message_id, $3), updated_at = now() WHERE id = $1`,
    [session.id, String(minutes), rows[0]?.id || 0]
  );
  broadcast('conversation', { id: conv.id });
}

/** Bot state for the Live Inbox header. */
async function botState(conversationId) {
  await loadSettings();
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
  if (!conv) return null;
  const session = await sessionFor(conv.id);
  const customer = await q.get('SELECT phone FROM inbox_customers WHERE id = ?', conv.customer_id);
  const blocked = await isBlocked({ customerId: conv.customer_id, phone: customer?.phone });
  const supported = LIVE_KINDS.includes(conv.channel_kind);
  let state = 'off';
  if (blocked) state = 'blocked';
  else if (!supported || !botOn(conv.channel_kind)) state = 'off';
  else if (session?.paused_until && new Date(session.paused_until).getTime() > Date.now()) state = 'paused';
  else if (session?.status === 'handed_off') state = 'handed_off';
  else state = 'active';
  return {
    supported,
    channel_on: supported && botOn(conv.channel_kind),
    state,
    blocked,
    paused_until: session?.paused_until || null,
    handoff_reason: session?.status === 'handed_off' ? session.handoff_reason : null,
  };
}

/** "Let the bot answer": clears a pause or a hand-off in this conversation. */
async function resume(conversationId) {
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
  if (!conv) return null;
  const session = await ensureSession(conv);
  const { rows } = await query("SELECT COALESCE(MAX(id), 0)::int AS id FROM inbox_messages WHERE conversation_id = $1 AND direction = 'in'", [conv.id]);
  await query(
    `UPDATE chatbot_sessions SET paused_until = NULL, status = 'bot', handoff_reason = NULL, handed_off_at = NULL,
       last_seen_message_id = GREATEST(last_seen_message_id, $2), updated_at = now() WHERE id = $1`,
    [session.id, rows[0]?.id || 0]
  );
  broadcast('conversation', { id: conv.id });
  return botState(conversationId);
}

/** "Stop the bot here": pauses it in this conversation for a week. */
async function pauseFor(conversationId, minutes) {
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
  if (!conv) return null;
  const session = await ensureSession(conv);
  await query(`UPDATE chatbot_sessions SET paused_until = now() + ($2 || ' minutes')::interval, updated_at = now() WHERE id = $1`, [session.id, String(minutes)]);
  broadcast('conversation', { id: conv.id });
  return botState(conversationId);
}

module.exports = { willAnswer, onCustomerMessage, onHumanReply, botState, resume, pauseFor, LIVE_KINDS, _test: { answer, quietReason, pauseMinutes } };
