import { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { inboxApi } from './api';

/** WhatsApp media needs our auth header, so it is fetched as a blob and shown from an object URL. */
function useMediaUrl(message, index, attachment) {
  const direct = attachment.url || null;
  const [url, setUrl] = useState(direct);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (direct || !attachment.mediaId) return undefined;
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
  }, [direct, attachment.mediaId, message.id, index]);
  return { url, failed };
}

export default function Attachment({ message, index, attachment }) {
  const { url, failed } = useMediaUrl(message, index, attachment);
  const type = attachment.type;
  if (failed) return <div className="text-xs italic opacity-70">Media expired or unavailable</div>;
  if (!url) return <div className="h-24 w-40 animate-pulse rounded-lg bg-black/5" />;
  if (type === 'image' || type === 'sticker') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" className="max-h-64 max-w-full rounded-lg object-cover" />
      </a>
    );
  }
  if (type === 'video') return <video src={url} controls preload="metadata" className="max-h-64 max-w-full rounded-lg" />;
  if (type === 'audio') return <audio src={url} controls preload="none" className="max-w-full" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" download={attachment.filename || undefined} className="inline-flex items-center gap-1 underline">
      <Paperclip className="h-3.5 w-3.5" /> {attachment.filename || 'Attachment'}
    </a>
  );
}
