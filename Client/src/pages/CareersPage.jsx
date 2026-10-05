import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import api from '../api/http';
import { useLocale } from '../context/LocaleContext';
import BrandLoader from '../components/ui/BrandLoader';
import { ArrowDot, PageHero, Reveal } from '../components/ui/Editorial';

const emptyForm = { fullName: '', email: '', phone: '' };

const labelCls = 'grid gap-2 g-index text-soul-muted';
const inputCls =
  'rounded-2xl border border-soul-line bg-soul-paper px-4 py-3.5 font-sans text-[15px] normal-case tracking-normal text-soul-blue outline-none transition focus:border-soul-blue focus:bg-white';

function ApplicationModal({ job, onClose }) {
  const { t } = useLocale();
  const [form, setForm] = useState(emptyForm);
  const [cvFile, setCvFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  if (!job) return null;

  const updateField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!cvFile) {
      setStatus({ type: 'error', message: t('careers.needCv') });
      return;
    }
    setSubmitting(true);
    setStatus(null);
    try {
      const fd = new FormData();
      fd.append('job_id', job.id);
      fd.append('full_name', form.fullName.trim());
      fd.append('email', form.email.trim());
      fd.append('phone', form.phone.trim());
      fd.append('cv', cvFile);
      await api.post('/recruitment/apply', fd);
      setStatus({ type: 'success', message: t('careers.success') });
      setForm(emptyForm);
      setCvFile(null);
      setTimeout(onClose, 1600);
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.response?.data?.error || err.message || t('careers.submitFail'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-soul-ink/60 p-4 backdrop-blur-sm">
      <div className="soul-fade-up max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[32px] bg-white p-7 shadow-2xl sm:p-9">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="g-index text-soul-muted">{t('careers.applyFor')}</p>
            <h2 className="g-display mt-2 text-[34px] text-soul-blue">{job.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('careers.cancel')}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-soul-line text-soul-blue transition hover:bg-soul-blue hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <label className={labelCls}>
            {t('careers.fullName')}
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => updateField('fullName', e.target.value)}
              className={inputCls}
              required
            />
          </label>
          <label className={labelCls}>
            {t('careers.email')}
            <input
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              className={inputCls}
              required
            />
          </label>
          <label className={labelCls}>
            {t('careers.phone')}
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              className={inputCls}
              required
            />
          </label>
          <label className={labelCls}>
            {t('careers.cv')}
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(e) => setCvFile(e.target.files?.[0] || null)}
              className={`${inputCls} file:me-3 file:rounded-full file:border-0 file:bg-soul-blue file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-white`}
              required
            />
          </label>

          {status ? (
            <div
              className={`rounded-2xl border p-3 text-sm ${
                status.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {status.message}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3 pt-3">
            <button type="button" onClick={onClose} className="g-btn g-btn-ghost">
              {t('careers.cancel')}
            </button>
            <button type="submit" disabled={submitting} className="g-btn g-btn-primary disabled:opacity-70">
              {submitting ? t('careers.submitting') : t('careers.submit')}
              <ArrowDot />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CareersPage() {
  const { t } = useLocale();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedJob, setSelectedJob] = useState(null);

  useEffect(() => {
    let mounted = true;
    api
      .get('/recruitment/jobs')
      .then((r) => {
        if (mounted) setJobs(r.data.items || []);
      })
      .catch((err) => {
        if (mounted) setError(err.response?.data?.error || err.message || t('careers.failed'));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="bg-soul-paper">
      <Header />
      <main>
        <PageHero index="✦" eyebrow={t('careers.eyebrow')} lead={t('careers.title')} body={t('careers.subtitle')} compact />

        <section className="g-shell pb-24">
          {loading ? (
            <div className="flex justify-center py-12">
              <BrandLoader size="md" label={t('careers.loading')} />
            </div>
          ) : null}

          {error ? (
            <div className="rounded-[24px] border border-soul-line bg-white p-6 text-center text-sm text-soul-muted">
              {error}
            </div>
          ) : null}

          {!loading && !error && !jobs.length ? (
            <div className="rounded-[24px] border border-soul-line bg-white p-10 text-center">
              <p className="g-display text-3xl italic text-soul-blue/70">{t('careers.empty')}</p>
            </div>
          ) : null}

          {jobs.length ? (
            <ul className="border-t border-soul-line">
              {jobs.map((job, i) => (
                <Reveal
                  as="li"
                  key={job.id}
                  delay={Math.min(i, 6) * 70}
                  className="grid gap-6 border-b border-soul-line py-10 md:grid-cols-[3rem_minmax(0,1fr)_auto] md:gap-10"
                >
                  <span className="g-index pt-3 text-soul-accent">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <h2 className="g-display text-[clamp(32px,3.4vw,52px)] text-soul-blue">{job.title}</h2>
                    {(job.department || job.location) && (
                      <p className="g-index mt-2 text-soul-muted">
                        {[job.department, job.location].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <p className="mt-5 max-w-3xl whitespace-pre-line text-[15px] leading-[1.8] text-soul-muted">
                      {job.description}
                    </p>
                    {job.requirements ? (
                      <p className="mt-4 max-w-3xl whitespace-pre-line text-[15px] leading-[1.8] text-soul-muted/90">
                        <span className="font-medium text-soul-blue">{t('careers.requirements')} </span>
                        {job.requirements}
                      </p>
                    ) : null}
                  </div>
                  <div className="md:pt-2">
                    <button type="button" onClick={() => setSelectedJob(job)} className="g-btn g-btn-primary">
                      {t('careers.applyNow')}
                      <ArrowDot />
                    </button>
                  </div>
                </Reveal>
              ))}
            </ul>
          ) : null}
        </section>

        <ApplicationModal job={selectedJob} onClose={() => setSelectedJob(null)} />
      </main>
      <Footer />
    </div>
  );
}
