/** Saved replies can include {{agent_name}} and {{customer_name}}. */
function fillPlaceholders(text, { agentName, customerName } = {}) {
  if (typeof text !== 'string' || !text.includes('{{')) return text;
  return text
    .replace(/\{\{\s*agent_name\s*\}\}/gi, () => agentName || '')
    .replace(/\{\{\s*customer_name\s*\}\}/gi, () => customerName || '');
}

module.exports = { fillPlaceholders };
