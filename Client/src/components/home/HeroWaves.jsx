import { useEffect, useRef } from 'react';

// Mixkit "Turquoise ocean background with foaming waves" (id 2091), free for commercial use.
const VIDEO = '/soul-brand/ocean-hero.mp4';
const POSTER = '/soul-brand/ocean-hero-poster.jpg';

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
    <div className="absolute inset-0" aria-hidden="true">
      <video
        ref={videoRef}
        className="h-full w-full object-cover brightness-110 contrast-105"
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
