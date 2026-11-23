/**
 * Photos and voice notes for the chatbot. Messenger / Instagram give a short-lived URL; the website
 * chat uploads to Cloudinary. The file is fetched once and handed to the AI inline.
 */
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15000;

const AUDIO_TYPES = { 'audio/mp4': 'audio/aac', 'audio/x-m4a': 'audio/aac', 'audio/m4a': 'audio/aac', 'audio/mpeg': 'audio/mp3', 'audio/x-wav': 'audio/wav' };

function kindOf(att) {
  const type = String(att?.type || '').toLowerCase();
  const mime = String(att?.mime || '').toLowerCase();
  if (type === 'image' || mime.startsWith('image/')) return 'image';
  if (type === 'audio' || mime.startsWith('audio/')) return 'audio';
  return null;
}

/** Downloads up to 3 photos / voice notes. Anything that fails is skipped (the bot asks them to write it). */
async function loadMedia(attachments = []) {
  const out = [];
  for (const att of (attachments || []).slice(0, 3)) {
    const kind = kindOf(att);
    if (!kind || !att.url || !/^https:\/\//i.test(att.url)) continue;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(att.url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const len = Number(res.headers.get('content-length') || 0);
      if (len > MAX_BYTES) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > MAX_BYTES) continue;
      let mime = String(res.headers.get('content-type') || att.mime || '').split(';')[0].trim().toLowerCase();
      if (kind === 'image' && !mime.startsWith('image/')) mime = 'image/jpeg';
      if (kind === 'audio') mime = AUDIO_TYPES[mime] || (mime.startsWith('audio/') ? mime : 'audio/aac');
      out.push({ kind, mime, data: buf.toString('base64') });
    } catch (err) {
      console.warn('[chatbot] media download failed:', err.message);
    }
  }
  return out;
}

/** What the transcript shows instead of the file. */
function mediaLabel(media) {
  const images = media.filter((m) => m.kind === 'image').length;
  const audio = media.filter((m) => m.kind === 'audio').length;
  return [images ? `[${images} photo${images > 1 ? 's' : ''}]` : '', audio ? '[voice note]' : ''].filter(Boolean).join(' ');
}

module.exports = { loadMedia, mediaLabel, kindOf };
