import { ASSIGN_REASONS, CONVERSATION_TYPES, STATUS_LABELS, fmtDateTime, humanize } from './utils';

const LABELS = {
  conversation_created: 'Conversation started',
  reopened: 'Customer wrote again — reopened',
  ad_referral: 'Came from an ad',
  lead_created: 'Lead created',
  lead_updated: 'Lead updated',
  customer_updated: 'Customer updated',
  note_added: 'Internal note',
  sla_warning: 'SLA warning',
  sla_breach: 'SLA breached',
  sla_escalation_supervisor: 'Escalated to supervisor',
  sla_escalation_manager: 'Escalated to manager',
  replied_outside_system: 'Replied from the Meta app (outside the inbox)',
  matched_pms_guest: 'Matched a PMS guest by phone',
  customer_matched_by_phone: 'Matched an existing customer by phone',
  ai_classified: 'AI classified the chat',
  night_reply: 'After-hours auto reply',
  snooze_ended: 'Snooze ended',
  follow_up_done: 'Follow-up done',
  follow_up_cancelled: 'Follow-up cancelled',
  follow_up_overdue: 'Follow-up overdue',
  lead_owner_changed: 'Lead owner changed',
};

export function eventText(e, { userName, stageByKey }) {
  const d = e.data || {};
  switch (e.type) {
    case 'assigned':
      return `Assigned to ${d.to ? userName(d.to) : 'nobody'} (${ASSIGN_REASONS[d.reason] || humanize(d.reason)})`;
    case 'stage_changed':
      return `Stage: ${stageByKey(d.from)?.name_en || d.from || '—'} → ${stageByKey(d.to)?.name_en || d.to}${d.reservation_id ? ` · reservation #${d.reservation_id}` : ''}`;
    case 'status_changed':
      return `Status: ${STATUS_LABELS[d.from] || d.from || '—'} → ${STATUS_LABELS[d.to] || d.to}${d.closed_without_reply ? ' (closed without reply)' : ''}`;
    case 'classified':
      return `Marked as ${[d.type && CONVERSATION_TYPES[d.type], d.priority && `${d.priority} priority`].filter(Boolean).join(', ')}`;
    case 'follow_up_created':
      return `Follow-up set for ${fmtDateTime(d.due_at)}${d.note ? ` — ${d.note}` : ''}`;
    case 'lead_updated':
    case 'customer_updated':
      return `${LABELS[e.type]}: ${Object.keys(d).map(humanize).join(', ')}`;
    case 'sla_breach':
    case 'sla_warning':
      return `${LABELS[e.type]}${d.assignee ? ` (${userName(d.assignee)})` : ''}`;
    default:
      return LABELS[e.type] || humanize(e.type);
  }
}

/** Events worth a line inside the message thread (the full log lives in the Timeline tab). */
export const SHOWN_IN_CHAT = new Set([
  'assigned', 'stage_changed', 'status_changed', 'sla_breach', 'sla_escalation_supervisor', 'sla_escalation_manager',
  'lead_created', 'follow_up_created', 'reopened', 'replied_outside_system', 'ad_referral', 'matched_pms_guest',
]);
