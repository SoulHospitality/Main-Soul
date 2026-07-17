import { Link } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import PartnersSection from '../components/home/PartnersSection';
import { brand } from '../theme/brand';

const storyParagraphs = [
  'Soul Hospitality was shaped around one idea: premium homes should feel both effortless and memorable. We curate short stays, longer living arrangements, and owner experiences with the same discipline, so every property is presented with clarity, calm, and consistency.',
  'Our team focuses on the details that make hospitality feel refined rather than transactional. From furnishing standards and guest touchpoints to property stewardship and responsive support, every layer is designed to keep the experience warm, clean, and reliable.',
];

const values = [
  {
    title: 'Quality',
    image: '/soul-brand/coast-1.jpg',
    body: 'We maintain a high finish across every unit, from material choices and styling to cleanliness, consistency, and the standard of the guest experience.',
  },
  {
    title: 'Teamwork',
    image: '/soul-brand/coast-2.jpg',
    body: 'Our operations, guest support, and property care teams work as one system so owners and guests feel a smooth, coordinated service at every step.',
  },
  {
    title: 'Respect',
    image: '/soul-v2/interlude.jpg',
    body: 'We respect every property as an asset, every guest as a priority, and every owner relationship as a long-term partnership built on trust.',
  },
  {
    title: 'Integrity',
    image: '/soul-brand/coast-3.jpg',
    body: 'Clear communication, transparent operations, and honest reporting guide how we manage bookings, care plans, and everyday hospitality decisions.',
  },
  {
    title: 'Responsibility',
    image: '/soul-brand/coast-4.jpg',
    body: 'We take ownership of the details that protect value over time, keeping the property experience organised, dependable, and carefully maintained.',
  },
  {
    title: 'Innovative',
    image: '/soul-brand/coast-hero-3.jpg',
    body: 'We refine service flows, presentation, and digital touchpoints so the brand feels modern without losing the calm and luxury expected from Soul.',
  },
];

export default function AboutPage() {
  return (
    <div className="bg-white">
      <Header overHero />

      {/* Hero — full-bleed, brand first */}
      <section className="relative isolate min-h-[72svh] overflow-hidden md:min-h-[78svh]">
        <img
          src="/soul-brand/coast-hero-2.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-soul-ink/45" />
        <div className="absolute inset-0 bg-gradient-to-r from-soul-ink/70 via-soul-ink/35 to-transparent" />

        <div className="relative mx-auto flex min-h-[72svh] max-w-soul flex-col justify-end px-5 pb-14 pt-32 sm:px-8 md:min-h-[78svh] md:pb-20">
          <p className="soul-eyebrow mb-4 text-white/70">{brand.name}</p>
          <h1
            className="font-display font-semibold leading-[0.95] text-white"
            style={{ fontSize: 'clamp(40px, 7vw, 80px)' }}
          >
            About <em className="italic font-normal">us</em>
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-white/85 md:text-lg">
            We offer unique places suited for your comfort — curated stays along Egypt&apos;s most
            beautiful coastlines.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/careers"
              className="btn-pill inline-flex items-center justify-center bg-white px-6 py-3 text-sm font-semibold text-soul-blue transition hover:-translate-y-0.5 hover:bg-soul-ivory"
            >
              Work with us
            </Link>
            <Link
              to="/contact"
              className="btn-pill inline-flex items-center justify-center border border-white/40 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white/20"
            >
              Contact
            </Link>
          </div>
        </div>
      </section>

      {/* Our Story */}
      <section className="mx-auto max-w-soul px-5 py-16 sm:px-8 md:py-20">
        <p className="soul-eyebrow text-soul-muted mb-2">Our story</p>
        <h2 className="font-display text-3xl text-soul-blue md:text-4xl">
          Premium homes, made to feel <em className="italic font-normal">effortless.</em>
        </h2>
        <div className="mt-8 grid gap-8 md:grid-cols-2 md:gap-12">
          {storyParagraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 24)} className="text-sm leading-relaxed text-soul-muted md:text-[15px] md:leading-7">
              {paragraph}
            </p>
          ))}
        </div>
      </section>

      {/* Our Values */}
      <section className="border-t border-soul-line bg-soul-ivory/60 py-16 md:py-20">
        <div className="mx-auto max-w-soul px-5 sm:px-8">
          <p className="soul-eyebrow text-soul-muted mb-2">Our values</p>
          <h2 className="font-display text-3xl text-soul-blue md:text-4xl">
            What guides every <em className="italic font-normal">stay.</em>
          </h2>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-7">
            {values.map((item) => (
              <article key={item.title} className="group">
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl">
                  <img
                    src={item.image}
                    alt={item.title}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                  />
                </div>
                <h3 className="mt-4 font-display text-xl text-soul-blue">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-soul-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <PartnersSection />

      <Footer />
    </div>
  );
}
