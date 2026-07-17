const PARTNERS = [
  {
    label: 'Tatweer Misr',
    src: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1784205791/Tatweer-Misr-removebg-preview_xjltqj.png',
  },
  {
    label: 'Sabbour Consulting',
    src: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1784205791/Sabbour-removebg-preview_dwdeem.png',
  },
  {
    label: 'Palm Hills',
    src: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1784205791/Palm-Hills-removebg-preview_xnnjvq.png',
  },
  {
    label: 'Mountain View',
    src: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1784205735/images__2_-removebg-preview_w5bwps.png',
  },
  {
    label: 'Emaar',
    src: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1783598502/Emaar-Properties_rbhrww.png',
  },
];

export default function PartnersSection({
  eyebrow = 'Our partners',
  title = (
    <>
      Trusted along the <em className="italic font-normal">coast.</em>
    </>
  ),
  className = '',
}) {
  return (
    <section className={`py-16 md:py-20 ${className}`.trim()}>
      <div className="mx-auto max-w-soul px-5 sm:px-8">
        <p className="soul-eyebrow mb-2 text-soul-muted">{eyebrow}</p>
        <h2 className="font-display text-3xl text-soul-blue md:text-4xl">{title}</h2>

        <div className="mt-10 grid grid-cols-2 items-center justify-items-center gap-8 border-t border-soul-line pt-10 sm:grid-cols-3 md:grid-cols-5 md:gap-10">
          {PARTNERS.map((partner) => (
            <div
              key={partner.label}
              className="flex h-20 w-full max-w-[160px] items-center justify-center md:h-24"
            >
              <img
                src={partner.src}
                alt={partner.label}
                className="max-h-full max-w-full object-contain"
                loading="lazy"
                decoding="async"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
