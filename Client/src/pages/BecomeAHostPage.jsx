import { useMemo, useState } from 'react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import api from '../api/http';
import { useProjectCatalog } from '../hooks/useProjectCatalog';
import { AREAS } from '../data/compounds';
import { UNIT_TYPES } from '../admin/utils/formatters';

const FURNISHING_OPTIONS = [
  'Fully Furnished',
  'Semi Furnished',
  'Unfurnished',
  'Negotiable',
];

const CONTACT_TIMES = [
  'Morning (9am–12pm)',
  'Afternoon (12pm–5pm)',
  'Evening (5pm–9pm)',
  'Anytime',
];

const COUNTRY_CODES = [
  { code: '+20', label: 'Egypt (+20)' },
  { code: '+966', label: 'Saudi Arabia (+966)' },
  { code: '+971', label: 'UAE (+971)' },
  { code: '+974', label: 'Qatar (+974)' },
  { code: '+965', label: 'Kuwait (+965)' },
  { code: '+973', label: 'Bahrain (+973)' },
  { code: '+968', label: 'Oman (+968)' },
  { code: '+962', label: 'Jordan (+962)' },
  { code: '+961', label: 'Lebanon (+961)' },
  { code: '+212', label: 'Morocco (+212)' },
  { code: '+1', label: 'USA / Canada (+1)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+33', label: 'France (+33)' },
  { code: '+49', label: 'Germany (+49)' },
];

const EMPTY = {
  fullName: '',
  email: '',
  countryCode: '+20',
  phone: '',
  destination: '',
  furnishingStatus: '',
  propertyType: '',
  preferredContactTime: '',
};

const fieldClass =
  'w-full rounded-xl border border-soul-line bg-white px-4 py-3 text-sm text-soul-blue outline-none transition focus:border-soul-blue';

export default function BecomeAHostPage() {
  const { destinations } = useProjectCatalog();
  const destinationOptions = destinations?.length ? destinations : AREAS;

  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  const setField = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setStatus(null);
  };

  const canSubmit = useMemo(
    () =>
      Boolean(
        form.fullName.trim() &&
          form.email.trim() &&
          form.phone.trim() &&
          form.destination &&
          form.furnishingStatus &&
          form.propertyType &&
          form.preferredContactTime
      ),
    [form]
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setStatus(null);
    try {
      await api.post('/host-requests', {
        full_name: form.fullName.trim(),
        email: form.email.trim(),
        country_code: form.countryCode,
        phone: form.phone.trim(),
        destination: form.destination,
        furnishing_status: form.furnishingStatus,
        property_type: form.propertyType,
        preferred_contact_time: form.preferredContactTime,
      });
      setForm({ ...EMPTY, countryCode: form.countryCode });
      setStatus({
        type: 'success',
        message: 'Thank you — our team will contact you soon to discuss listing your property.',
      });
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.response?.data?.error || err.message || 'Could not submit your request.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Header />
      <main>
        <section className="relative overflow-hidden bg-soul-blue-dark text-white">
          <div className="absolute inset-0">
            <img
              src="/soul-brand/coast-hero-2.jpg"
              alt=""
              className="h-full w-full object-cover opacity-45"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-soul-blue-dark/95 via-soul-blue-dark/80 to-soul-blue-dark/55" />
          </div>
          <div className="relative mx-auto max-w-soul px-5 sm:px-8 py-16 md:py-20">
            <p className="soul-eyebrow text-white/55">Become a Host</p>
            <h1 className="mt-3 max-w-2xl font-display text-4xl font-medium leading-tight sm:text-5xl">
              List your coastal home with Soul
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">
              Share a few details and our team will get in touch to help you publish your unit —
              guest care, pricing, and stays handled with Soul.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-soul px-5 sm:px-8 py-12 md:py-16">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
            <div className="space-y-5">
              <h2 className="font-display text-2xl text-soul-blue sm:text-3xl">
                Request a callback
              </h2>
              <p className="text-sm leading-7 text-soul-muted sm:text-base">
                Tell us about yourself and your property. We typically respond within one business
                day to discuss next steps.
              </p>
              <ul className="space-y-3 text-sm text-soul-blue/90">
                <li className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-soul-blue" />
                  Professional guest communication and stay operations
                </li>
                <li className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-soul-blue" />
                  Pricing guidance tailored to your destination
                </li>
                <li className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-soul-blue" />
                  A calm, premium listing experience for your home
                </li>
              </ul>
            </div>

            <form
              onSubmit={handleSubmit}
              className="rounded-3xl border border-soul-line bg-white p-6 shadow-[0_24px_60px_-40px_rgba(40,63,94,0.45)] sm:p-8"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-soul-muted sm:col-span-2">
                  Full name
                  <input
                    type="text"
                    autoComplete="name"
                    value={form.fullName}
                    onChange={setField('fullName')}
                    className={fieldClass}
                    required
                  />
                </label>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-soul-muted sm:col-span-2">
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={setField('email')}
                    className={fieldClass}
                    required
                  />
                </label>

                <div className="sm:col-span-2">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-soul-muted">
                    Phone number
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <label className="sr-only" htmlFor="host-country-code">
                      Country code
                    </label>
                    <select
                      id="host-country-code"
                      value={form.countryCode}
                      onChange={setField('countryCode')}
                      className={`${fieldClass} sm:max-w-[11.5rem]`}
                      required
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="Phone number"
                      value={form.phone}
                      onChange={setField('phone')}
                      className={fieldClass}
                      required
                    />
                  </div>
                </div>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-soul-muted">
                  Destination
                  <select
                    value={form.destination}
                    onChange={setField('destination')}
                    className={fieldClass}
                    required
                  >
                    <option value="">Select destination</option>
                    {destinationOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                    {!destinationOptions.includes('Other') && (
                      <option value="Other">Other</option>
                    )}
                  </select>
                </label>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-soul-muted">
                  Property type
                  <select
                    value={form.propertyType}
                    onChange={setField('propertyType')}
                    className={fieldClass}
                    required
                  >
                    <option value="">Select type</option>
                    {UNIT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-soul-muted">
                  Furnishing status
                  <select
                    value={form.furnishingStatus}
                    onChange={setField('furnishingStatus')}
                    className={fieldClass}
                    required
                  >
                    <option value="">Select status</option>
                    {FURNISHING_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-soul-muted">
                  Preferred contact time
                  <select
                    value={form.preferredContactTime}
                    onChange={setField('preferredContactTime')}
                    className={fieldClass}
                    required
                  >
                    <option value="">Select time</option>
                    {CONTACT_TIMES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {status && (
                <p
                  className={`mt-5 rounded-xl px-4 py-3 text-sm ${
                    status.type === 'success'
                      ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border border-rose-200 bg-rose-50 text-rose-800'
                  }`}
                  role="status"
                >
                  {status.message}
                </p>
              )}

              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-soul-blue px-6 py-3.5 text-sm font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-soul-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Sending…' : 'Request contact'}
              </button>
            </form>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
