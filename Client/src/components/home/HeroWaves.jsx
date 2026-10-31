import { useEffect, useRef, useState } from 'react';

const DEFAULT_VIDEO_ID = 'WFua9wsYbb0';
const BUTTON_HIDE_MS = 3200;

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

function playerVars() {
  return {
    autoplay: 1,
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

/** YouTube video id from a watch / share / shorts / embed link, or null for any other URL. */
export function youtubeId(url) {
  const s = String(url || '').trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : null;
}

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduce(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return reduce;
}

function YouTubeBackground({ videoId, reduce }) {
  const slot = useRef(null);
  const playerRef = useRef(null);
  const alive = useRef(true);
  const restarting = useRef(false);
  const revealed = useRef(false);
  const [clearPoster, setClearPoster] = useState(false);
  const poster = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  useEffect(() => {
    if (reduce) return undefined;
    alive.current = true;
    restarting.current = false;
    revealed.current = false;
    setClearPoster(false);
    let poll = 0;
    let revealTimer = 0;
    let cancelled = false;

    function revealWhenButtonGone() {
      window.clearTimeout(revealTimer);
      revealTimer = window.setTimeout(() => {
        if (!alive.current) return;
        restarting.current = false;
        revealed.current = true;
        setClearPoster(true);
      }, BUTTON_HIDE_MS);
    }

    function restart() {
      const player = playerRef.current;
      if (!player || restarting.current || !alive.current) return;
      restarting.current = true;
      setClearPoster(false);
      try {
        player.seekTo(0, true);
        player.playVideo();
      } catch {
        restarting.current = false;
      }
    }

    loadYouTube().then(() => {
      if (cancelled || !slot.current) return;
      playerRef.current = new window.YT.Player(slot.current, {
        videoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: playerVars(),
        events: {
          onReady: (event) => {
            event.target.mute();
            event.target.playVideo();
          },
          onStateChange: (event) => {
            const playing = event.data === window.YT.PlayerState.PLAYING;
            if (playing && (restarting.current || !revealed.current)) revealWhenButtonGone();
            if (event.data === window.YT.PlayerState.ENDED) restart();
          },
        },
      });

      poll = window.setInterval(() => {
        const player = playerRef.current;
        if (!player?.getDuration || !player.getCurrentTime || restarting.current) return;
        const duration = player.getDuration();
        const time = player.getCurrentTime();
        if (duration > 6 && duration - time <= 0.45) restart();
      }, 200);
    });

    return () => {
      cancelled = true;
      alive.current = false;
      window.clearInterval(poll);
      window.clearTimeout(revealTimer);
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [reduce, videoId]);

  return (
    <>
      {reduce ? null : (
        <div className="hero-yt-layer">
          {/* Keyed so a new video gets a fresh node; YT.Player replaces the slot with its iframe. */}
          <div key={videoId}>
            <div ref={slot} />
          </div>
        </div>
      )}
      <img src={poster} alt="" className={`hero-yt-poster ${clearPoster && !reduce ? 'is-clear' : ''}`} />
    </>
  );
}

/** Cloudinary serves a frame of any uploaded video as a jpg — used as the poster. */
function cloudinaryPoster(url) {
  return /res\.cloudinary\.com\/.+\/video\/upload\//.test(url) ? url.replace(/\.[a-z0-9]+(\?.*)?$/i, '.jpg') : undefined;
}

function FileVideoBackground({ src, reduce }) {
  const poster = cloudinaryPoster(src);
  if (reduce) return poster ? <img src={poster} alt="" className="hero-yt-poster" /> : null;
  return <video className="hero-video" src={src} poster={poster} autoPlay muted loop playsInline preload="auto" />;
}

export default function HeroWaves({ videoUrl = '' }) {
  const reduce = useReducedMotion();
  const url = String(videoUrl || '').trim();
  const ytId = url ? youtubeId(url) : DEFAULT_VIDEO_ID;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0b4f73]" aria-hidden="true">
      {ytId ? <YouTubeBackground videoId={ytId} reduce={reduce} /> : <FileVideoBackground src={url} reduce={reduce} />}
    </div>
  );
}
