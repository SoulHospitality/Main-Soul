import { BadgeCheck, HeartHandshake, MessageCircle } from 'lucide-react';

const PILLARS = [
  {
    icon: BadgeCheck,
    title: 'Verified Luxury',
    body: 'Handpicked homes inspected for comfort, cleanliness, and that unmistakable coastal calm.',
  },
  {
    icon: MessageCircle,
    title: 'Seamless Booking',
    body: 'Clear nightly pricing and instant WhatsApp assistance from inquiry to check-in.',
  },
  {
    icon: HeartHandshake,
    title: 'Dedicated Hospitality',
    body: 'On-ground support throughout your stay — so you can simply arrive and exhale.',
  },
];

export default function TrustSection() {
  return (
    <section className="bg-soul-ivory">
      <div className="mx-auto max-w-soul px-5 sm:px-8 py-16 md:py-20">
        <div className="mb-10 max-w-xl">
          <p className="soul-eyebrow text-soul-muted mb-2">The Soul standard</p>
          <h2 className="font-display text-3xl md:text-4xl text-soul-blue">
            Booked like a hotel, <em className="italic font-normal">felt like home.</em>
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-8 md:gap-10">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <div className="h-11 w-11 rounded-full border border-soul-line grid place-items-center text-soul-blue mb-4">
                <Icon size={20} strokeWidth={1.6} />
              </div>
              <h3 className="font-semibold text-soul-blue text-lg">{title}</h3>
              <p className="mt-2 text-soul-muted text-sm leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
