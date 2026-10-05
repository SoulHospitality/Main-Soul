import { useMemo, useState } from 'react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import api from '../api/http';
import { useProjectCatalog } from '../hooks/useProjectCatalog';
import { AREAS } from '../data/compounds';
import { UNIT_TYPES } from '../admin/utils/formatters';
import { useLocale } from '../context/LocaleContext';
import { ArrowDot, PageHero, Reveal } from '../components/ui/Editorial';

const FURNISHING_OPTIONS = [
  { value: 'Fully Furnished', key: 'fullyFurnished' },
  { value: 'Semi Furnished', key: 'semiFurnished' },
  { value: 'Unfurnished', key: 'unfurnished' },
  { value: 'Negotiable', key: 'negotiable' },
];

const CONTACT_TIMES = [
  { value: 'Morning (9am–12pm)', key: 'morning' },
  { value: 'Afternoon (12pm–5pm)', key: 'afternoon' },
  { value: 'Evening (5pm–9pm)', key: 'evening' },
  { value: 'Anytime', key: 'anytime' },
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
  project: '',
  furnishingStatus: '',
  propertyType: '',
  preferredContactTime: '',
};

const fieldClass =
  'w-full rounded-2xl border border-soul-line bg-soul-paper px-4 py-3.5 font-sans text-[15px] normal-case tracking-normal text-soul-blue outline-none transition focus:border-soul-blue focus:bg-white disabled:opacity-60';

export default function BecomeAHostPage() {
  const { t } = useLocale();
  const { destinations, projectsByDestination } = useProjectCatalog();
  const destinationOptions = destinations?.length ? destinations : AREAS;

  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  const projectOptions = useMemo(() => {
    if (!form.destination || form.destination === 'Other') return [];
    return projectsByDestination?.[form.destination] || [];
  }, [form.destination, projectsByDestination]);

  const setField = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => {
      if (key === 'destination') {
        return { ...f, destination: value, project: '' };
      }
      return { ...f, [key]: value };
    });
    setStatus(null);
  };

  const canSubmit = useMemo(
    () =>
      Boolean(
        form.fullName.trim() &&
          form.email.trim() &&
          form.phone.trim() &&
          form.destination &&
          form.project &&
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
        project: form.project,
        furnishing_status: form.furnishingStatus,
        property_type: form.propertyType,
        preferred_contact_time: form.preferredContactTime,
      });
      setForm({ ...EMPTY, countryCode: form.countryCode });
      setStatus({
        type: 'success',
        message: t('owners.success'),
      });
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.response?.data?.error || err.message || t('owners.error'),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-soul-paper">
      <Header overHero />
      <main>
        <PageHero
          image="/soul-brand/coast-hero-2.jpg"
          eyebrow={t('owners.eyebrow')}
          lead={t('owners.title')}
          body={t('owners.subtitle')}
        >
          <a href="#host-form" className="g-btn g-btn-light">
            {t('owners.formTitle')}
            <ArrowDot />
          </a>
        </PageHero>

        <section id="host-form" className="g-shell scroll-mt-28 py-20 md:py-28">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <div className="flex items-center gap-3 text-soul-muted">
                <span className="g-index">(01)</span>
                <span className="h-px w-8 bg-soul-blue/25" />
                <span className="g-index">{t('owners.eyebrow')}</span>
              </div>
              <h2 className="g-display mt-6 text-[clamp(40px,4.6vw,68px)] text-soul-blue">
                {t('owners.formTitle')}
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-[1.8] text-soul-muted">
                {t('owners.formBody')}
              </p>
              <ol className="mt-10 border-t border-soul-line">
                {['owners.bullet0', 'owners.bullet1', 'owners.bullet2'].map((key, i) => (
                  <Reveal
                    as="li"
                    key={key}
                    delay={i * 90}
                    className="grid grid-cols-[3rem_1fr] items-baseline gap-4 border-b border-soul-line py-5"
                  >
                    <span className="g-display text-3xl italic text-soul-blue/40">{String(i + 1).padStart(2, '0')}</span>
                    <span className="text-[15px] leading-relaxed text-soul-blue">{t(key)}</span>
                  </Reveal>
                ))}
              </ol>
            </div>

            <form
              onSubmit={handleSubmit}
              className="rounded-[32px] border border-soul-line bg-white p-6 shadow-[0_40px_90px_-60px_rgba(22,35,58,0.55)] sm:p-10"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 g-index text-soul-muted sm:col-span-2">
                  {t('owners.fullName')}
                  <input
                    type="text"
                    autoComplete="name"
                    value={form.fullName}
                    onChange={setField('fullName')}
                    className={fieldClass}
                    required
                  />
                </label>

                <label className="grid gap-2 g-index text-soul-muted sm:col-span-2">
                  {t('owners.email')}
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
                  <p className="mb-2 g-index text-soul-muted">
                    {t('owners.phone')}
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <label className="sr-only" htmlFor="host-country-code">
                      {t('owners.countryCode')}
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
                      placeholder={t('owners.phonePh')}
                      value={form.phone}
                      onChange={setField('phone')}
                      className={fieldClass}
                      required
                    />
                  </div>
                </div>

                <label className="grid gap-2 g-index text-soul-muted">
                  {t('owners.destination')}
                  <select
                    value={form.destination}
                    onChange={setField('destination')}
                    className={fieldClass}
                    required
                  >
                    <option value="">{t('owners.selectDestination')}</option>
                    {destinationOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                    {!destinationOptions.includes('Other') && (
                      <option value="Other">{t('owners.other')}</option>
                    )}
                  </select>
                </label>

                <label className="grid gap-2 g-index text-soul-muted">
                  {t('owners.project')}
                  <select
                    value={form.project}
                    onChange={setField('project')}
                    className={fieldClass}
                    required
                    disabled={!form.destination}
                  >
                    <option value="">
                      {form.destination ? t('owners.selectProject') : t('owners.pickDestinationFirst')}
                    </option>
                    {projectOptions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                    <option value="Other">{t('owners.other')}</option>
                  </select>
                </label>

                <label className="grid gap-2 g-index text-soul-muted">
                  {t('owners.propertyType')}
                  <select
                    value={form.propertyType}
                    onChange={setField('propertyType')}
                    className={fieldClass}
                    required
                  >
                    <option value="">{t('owners.selectType')}</option>
                    {UNIT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 g-index text-soul-muted">
                  {t('owners.furnishing')}
                  <select
                    value={form.furnishingStatus}
                    onChange={setField('furnishingStatus')}
                    className={fieldClass}
                    required
                  >
                    <option value="">{t('owners.selectStatus')}</option>
                    {FURNISHING_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(`owners.${o.key}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 g-index text-soul-muted sm:col-span-2">
                  {t('owners.contactTime')}
                  <select
                    value={form.preferredContactTime}
                    onChange={setField('preferredContactTime')}
                    className={fieldClass}
                    required
                  >
                    <option value="">{t('owners.selectTime')}</option>
                    {CONTACT_TIMES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {t(`owners.${c.key}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {status && (
                <p
                  className={`mt-6 rounded-2xl px-4 py-3 text-sm ${
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
                className="g-btn g-btn-primary mt-8 w-full !justify-between !py-4 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? t('owners.sending') : t('owners.submit')}
                <ArrowDot />
              </button>
            </form>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
