import { useEffect, useRef, useState } from 'react';

const VIDEO_ID = 'WFua9wsYbb0';
const POSTER = `https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`;
const FADE_LEAD = 1.2;

let youtubeApi;

function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve();
  if (!youtubeApi) {
    youtubeApi = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === 'function') previous();
        resolve();
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    });
  }
  return youtubeApi;
}

function playerVars(autoplay) {
  return {
    autoplay,
    mute: 1,
    controls: 0,
    modestbranding: 1,
    rel: 0,
    fs: 0,
    disablekb: 1,
    iv_load_policy: 3,
    playsinline: 1,
    cc_load_policy: 0,
    origin: window.location.origin,
  };
}

export default function HeroWaves() {
  const slotA = useRef(null);
  const slotB = useRef(null);
  const players = useRef([null, null]);
  const active = useRef(0);
  const fading = useRef(false);
  const alive = useRef(true);
  const [reduce, setReduce] = useState(false);
  const [front, setFront] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduce(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (reduce) return undefined;
    alive.current = true;
    let timer = 0;
    let cancelled = false;

    function handoff(from) {
      if (fading.current || !alive.current) return;
      const to = from === 0 ? 1 : 0;
      const next = players.current[to];
      const prev = players.current[from];
      if (!next || !prev) return;
      fading.current = true;
      try {
        next.mute();
        next.seekTo(0, true);
        next.playVideo();
      } catch {
        fading.current = false;
        return;
      }
      window.setTimeout(() => {
        if (!alive.current) return;
        active.current = to;
        setFront(to);
        window.setTimeout(() => {
          try {
            prev.pauseVideo();
            prev.seekTo(0, true);
          } catch {
            /* player may already be gone */
          }
          fading.current = false;
        }, 1000);
      }, 280);
    }

    loadYouTube().then(() => {
      if (cancelled) return;
      const slots = [slotA.current, slotB.current];
      slots.forEach((slot, index) => {
        if (!slot) return;
        players.current[index] = new window.YT.Player(slot, {
          videoId: VIDEO_ID,
          host: 'https://www.youtube-nocookie.com',
          playerVars: playerVars(index === 0 ? 1 : 0),
          events: {
            onReady: (event) => {
              event.target.mute();
              if (index === 0) event.target.playVideo();
              else {
                event.target.seekTo(0, true);
                event.target.pauseVideo();
              }
            },
            onStateChange: (event) => {
              if (event.data === window.YT.PlayerState.PLAYING && index === active.current) {
                setPlaying(true);
              }
              if (event.data === window.YT.PlayerState.ENDED && index === active.current) {
                handoff(index);
              }
            },
          },
        });
      });

      timer = window.setInterval(() => {
        const player = players.current[active.current];
        if (!player?.getDuration || !player.getCurrentTime) return;
        const duration = player.getDuration();
        const time = player.getCurrentTime();
        if (duration > 2 && duration - time <= FADE_LEAD) handoff(active.current);
      }, 200);
    });

    return () => {
      cancelled = true;
      alive.current = false;
      window.clearInterval(timer);
      players.current.forEach((player) => {
        try {
          player?.destroy();
        } catch {
          /* ignore */
        }
      });
      players.current = [null, null];
    };
  }, [reduce]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0b4f73]" aria-hidden="true">
      <img
        src={POSTER}
        alt=""
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${playing && !reduce ? 'opacity-0' : 'opacity-100'}`}
      />
      {reduce ? null : (
        <>
          <div className={`hero-yt-layer ${front === 0 ? 'is-front' : ''}`}>
            <div ref={slotA} />
          </div>
          <div className={`hero-yt-layer ${front === 1 ? 'is-front' : ''}`}>
            <div ref={slotB} />
          </div>
        </>
      )}
    </div>
  );
}
