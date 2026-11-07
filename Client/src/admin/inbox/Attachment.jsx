import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, Link2Off, MapPin, X } from 'lucide-react';
import { inboxApi } from './api';

/** WhatsApp media needs our auth header, so it is fetched as a blob and shown from an object URL. */
function useMediaUrl(message, index, attachment) {
  const direct = attachment?.url || null;
  const [url, setUrl] = useState(direct);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!attachment || direct || !attachment.mediaId) return undefined;
    let objectUrl = null;
    let cancelled = false;
    inboxApi.blob(`/media/wa/${message.id}/${index}`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [direct, attachment?.mediaId, message?.id, index]);
  return { url, failed };
}

/** What to draw: photos (incl. stickers, GIFs, shared posts), videos (incl. reels), audio, files, stories. */
function kindOf(attachment) {
  const t = String(attachment?.type || '').toLowerCase();
  const mime = String(attachment?.mime || '').toLowerCase();
  if (['image', 'sticker', 'animated_image', 'share', 'ig_post'].includes(t) || mime.startsWith('image/')) return 'image';
  if (['video', 'ig_reel', 'reel'].includes(t) || mime.startsWith('video/')) return 'video';
  if (t === 'audio' || mime.startsWith('audio/')) return 'audio';
  if (t === 'story' || t === 'story_mention') return 'story';
  if (t === 'location') return 'location';
  if (t === 'link' || t === 'fallback' || t === 'template') return 'link';
  return 'file';
}

/** Full-screen viewer inside the inbox, so media never opens on another site. */
function Lightbox({ url, kind, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <button type="button" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Close" onClick={onClose}>
        <X className="h-5 w-5" />
      </button>
      <div onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full">
        {kind === 'video' ? (
          <video src={url} controls autoPlay className="max-h-[85vh] max-w-[90vw] rounded-lg" />
        ) : (
          <img src={url} alt="" referrerPolicy="no-referrer" className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain" />
        )}
      </div>
    </div>,
    document.body
  );
}

function Fallback({ children }) {
  return <div className="inline-flex items-center gap-1.5 rounded-lg bg-black/5 px-2.5 py-1.5 text-xs">{children}</div>;
}

export default function Attachment({ message, index = 0, attachment }) {
  const { url, failed } = useMediaUrl(message, index, attachment);
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  if (!attachment) return null;
  const kind = kindOf(attachment);

  if (kind === 'link') {
    return (
      <Fallback>
        <Link2Off className="h-3.5 w-3.5" /> A link was shared. Hidden for security.
      </Fallback>
    );
  }
  if (kind === 'location') {
    return (
      <Fallback>
        <MapPin className="h-3.5 w-3.5" />
        Location{attachment.title ? `: ${attachment.title}` : ''}
        {attachment.lat != null && attachment.lng != null ? ` (${Number(attachment.lat).toFixed(5)}, ${Number(attachment.lng).toFixed(5)})` : ''}
      </Fallback>
    );
  }
  if (failed) return <Fallback>Media expired or unavailable</Fallback>;
  if (!url) return <div className="h-24 w-40 animate-pulse rounded-lg bg-black/5" />;

  // Stories can be a photo or a video; try the photo first.
  const showKind = kind === 'story' ? (broken ? 'video' : 'image') : broken && kind === 'image' ? 'file' : kind;

  if (showKind === 'image') {
    return (
      <>
        <button type="button" className="block" onClick={() => setOpen(true)} title="View">
          <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="max-h-72 max-w-full rounded-lg object-cover" />
        </button>
        {kind === 'story' ? <p className="mt-0.5 text-[10px] opacity-70">Mentioned you in their story</p> : null}
        {open ? <Lightbox url={url} kind="image" onClose={() => setOpen(false)} /> : null}
      </>
    );
  }
  if (showKind === 'video') {
    return (
      <>
        <video src={url} controls preload="metadata" className="max-h-72 max-w-full rounded-lg" />
        {kind === 'story' ? <p className="mt-0.5 text-[10px] opacity-70">Mentioned you in their story</p> : null}
      </>
    );
  }
  if (showKind === 'audio') return <audio src={url} controls preload="none" className="max-w-full" />;
  return (
    <a href={url} download={attachment.filename || true} className="inline-flex items-center gap-1.5 rounded-lg bg-black/5 px-2.5 py-1.5 text-xs font-medium">
      <FileText className="h-3.5 w-3.5" /> {attachment.filename || 'File'}
      <Download className="h-3.5 w-3.5 opacity-60" />
    </a>
  );
}
