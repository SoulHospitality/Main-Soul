/** Must match INSPECTION_PLAYBACK_TRANSFORM on the server (pre-built at upload time). */
const INSPECTION_PLAYBACK_TRANSFORM = 'c_limit,h_1280,w_1280,q_auto,vc_h264';

function cloudinaryVariant(url, transform, ext) {
  const raw = String(url || '');
  if (!raw.includes('/video/upload/')) return raw;
  const transformed = raw.replace('/video/upload/', `/video/upload/${transform}/`);
  const [path, query = ''] = transformed.split('?');
  const lastSlash = path.lastIndexOf('/');
  const file = path.slice(lastSlash + 1);
  const base = file.includes('.') ? file.slice(0, file.lastIndexOf('.')) : file;
  return `${path.slice(0, lastSlash + 1)}${base}.${ext}${query ? `?${query}` : ''}`;
}

export function inspectionPlaybackUrl(url) {
  return cloudinaryVariant(url, INSPECTION_PLAYBACK_TRANSFORM, 'mp4');
}

function inspectionPosterUrl(url) {
  return cloudinaryVariant(url, 'so_1,c_limit,w_960,q_auto', 'jpg');
}

/** 720p MP4 first (small, plays everywhere); the original upload is the fallback while it is being prepared. */
export default function InspectionVideo({ url, className = '' }) {
  if (!url) return null;
  return (
    <video
      key={url}
      controls
      playsInline
      preload="none"
      poster={inspectionPosterUrl(url)}
      className={`w-full rounded-xl bg-black max-h-[60vh] ${className}`}
    >
      <source src={inspectionPlaybackUrl(url)} type="video/mp4" />
      <source src={url} />
    </video>
  );
}
