import { useEffect, useRef } from 'react';

const VIDEO = '/soul-brand/hero-alamein.mp4?v=alamein';
const POSTER = '/soul-brand/hero-alamein.jpg?v=alamein';

export default function HeroWaves() {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      video.pause();
      video.removeAttribute('autoplay');
      return undefined;
    }
    const play = () => video.play().catch(() => {});
    if (video.readyState >= 2) play();
    else video.addEventListener('canplay', play, { once: true });
    return () => video.removeEventListener('canplay', play);
  }, []);

  return (
    <div className="absolute inset-0 bg-[#0b4f73]" aria-hidden="true">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster={POSTER}
      >
        <source src={VIDEO} type="video/mp4" />
      </video>
    </div>
  );
}
