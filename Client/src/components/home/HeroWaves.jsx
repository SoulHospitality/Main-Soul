import { useEffect, useState } from 'react';

const VIDEO_ID = 'WFua9wsYbb0';
const POSTER = `https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`;

function embedSrc() {
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    loop: '1',
    playlist: VIDEO_ID,
    controls: '0',
    modestbranding: '1',
    playsinline: '1',
    rel: '0',
    iv_load_policy: '3',
    disablekb: '1',
  });
  return `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?${params}`;
}

export default function HeroWaves() {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduce(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0b4f73]" aria-hidden="true">
      <img src={POSTER} alt="" className="absolute inset-0 h-full w-full object-cover" />
      {reduce ? null : (
        <iframe
          className="pointer-events-none absolute left-1/2 top-1/2 h-[56.25vw] min-h-full w-[177.78vh] min-w-full -translate-x-1/2 -translate-y-1/2"
          src={embedSrc()}
          title="Al Alamein, North Coast, Egypt"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          tabIndex={-1}
        />
      )}
    </div>
  );
}
