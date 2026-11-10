import { useEffect, useRef, useState } from 'react';

/** Fades and lifts its content in once it scrolls into view. `zoom` also eases a child image from 105% to 100%. */
export default function Reveal({ as: Tag = 'div', delay = 0, zoom = false, className = '', style, children, ...rest }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`pf-reveal ${zoom ? 'pf-zoom' : ''} ${inView ? 'is-in' : ''} ${className}`.trim()}
      style={{ ...style, '--pf-delay': `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
