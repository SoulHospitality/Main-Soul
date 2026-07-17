import { Link } from 'react-router-dom';

export default function HostCta() {
  return (
    <section className="mx-auto max-w-soul px-5 sm:px-8 py-16 md:py-20">
      <div className="grid md:grid-cols-2 rounded-3xl overflow-hidden border border-soul-line min-h-[320px]">
        <div className="relative min-h-[220px] md:min-h-0">
          <img
            src="/soul-v2/interlude.jpg"
            alt="Coastal villa"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.src = '/soul-brand/coast-hero-2.jpg';
            }}
          />
        </div>
        <div className="bg-soul-blue-dark text-white p-8 md:p-12 flex flex-col justify-center">
          <p className="soul-eyebrow text-white/55 mb-3">For owners</p>
          <h2 className="font-display text-3xl md:text-[2.4rem] leading-tight">
            Earn hassle-free rental income.
          </h2>
          <p className="mt-4 text-white/75 leading-relaxed max-w-md">
            Let us manage your coastal villa — guest care, pricing, and stays handled with Soul.
          </p>
          <Link
            to="/owners"
            className="mt-8 inline-flex self-start btn-pill bg-white text-soul-blue px-6 py-3 font-semibold hover:bg-soul-ivory transition"
          >
            List your property
          </Link>
        </div>
      </div>
    </section>
  );
}
