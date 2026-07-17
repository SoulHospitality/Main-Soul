import { useEffect, useState } from 'react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import api from '../api/http';

const emptyForm = { fullName: '', email: '', phone: '' };

function ApplicationModal({ job, onClose }) {
  const [form, setForm] = useState(emptyForm);
  const [cvFile, setCvFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  if (!job) return null;

  const updateField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!cvFile) {
      setStatus({ type: 'error', message: 'Please attach your CV / resume.' });
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
      setStatus({ type: 'success', message: 'Application submitted. Thank you — we will be in touch.' });
      setForm(emptyForm);
      setCvFile(null);
      setTimeout(onClose, 1600);
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.response?.data?.error || err.message || 'Could not submit application.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-soul-muted">Apply for</p>
            <h2 className="mt-1 font-display text-xl text-soul-blue">{job.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-soul-line px-3 py-1 text-sm text-soul-muted hover:bg-soul-blue-50"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="grid gap-2 text-xs uppercase tracking-[0.18em] text-soul-muted">
            Full Name
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => updateField('fullName', e.target.value)}
              className="rounded-xl border border-soul-line px-4 py-3 text-sm text-soul-blue outline-none focus:border-soul-blue"
              required
            />
          </label>
          <label className="grid gap-2 text-xs uppercase tracking-[0.18em] text-soul-muted">
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              className="rounded-xl border border-soul-line px-4 py-3 text-sm text-soul-blue outline-none focus:border-soul-blue"
              required
            />
          </label>
          <label className="grid gap-2 text-xs uppercase tracking-[0.18em] text-soul-muted">
            Phone
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              className="rounded-xl border border-soul-line px-4 py-3 text-sm text-soul-blue outline-none focus:border-soul-blue"
              required
            />
          </label>
          <label className="grid gap-2 text-xs uppercase tracking-[0.18em] text-soul-muted">
            CV / Resume
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(e) => setCvFile(e.target.files?.[0] || null)}
              className="rounded-xl border border-soul-line px-4 py-3 text-sm text-soul-blue outline-none"
              required
            />
          </label>

          {status ? (
            <div
              className={`rounded-xl border p-3 text-sm ${
                status.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {status.message}
            </div>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-soul-line px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-soul-blue"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-pill bg-soul-blue px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white disabled:opacity-70"
            >
              {submitting ? 'Submitting...' : 'Submit Application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CareersPage() {
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
        if (mounted) setError(err.response?.data?.error || err.message || 'Failed to load jobs');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-soul px-5 py-16">
        <section className="mx-auto max-w-4xl space-y-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-soul-muted">Work With Us</p>
          <h1 className="font-display text-4xl text-soul-blue">Current Openings</h1>
          <p className="text-sm leading-7 text-soul-muted">
            Join the Soul Hospitality team and help us deliver a calm, premium experience for every guest and owner.
          </p>
        </section>

        {loading ? (
          <div className="mx-auto mt-10 max-w-2xl border border-soul-line bg-soul-blue-50/40 p-4 text-center text-sm uppercase tracking-[0.18em] text-soul-muted">
            Loading open positions...
          </div>
        ) : null}

        {error ? (
          <div className="mx-auto mt-10 max-w-2xl border border-soul-line bg-soul-blue-50/40 p-4 text-center text-sm text-soul-muted">
            {error}
          </div>
        ) : null}

        {!loading && !error && !jobs.length ? (
          <div className="mx-auto mt-10 max-w-2xl border border-soul-line bg-soul-blue-50/40 p-4 text-center text-sm text-soul-muted">
            There are no open positions at the moment. Please check back soon.
          </div>
        ) : null}

        <div className="mx-auto mt-10 grid max-w-4xl gap-6">
          {jobs.map((job) => (
            <article
              key={job.id}
              className="border border-soul-line bg-white p-6 shadow-[0_18px_60px_rgba(40,63,94,0.06)] rounded-2xl"
            >
              <h2 className="font-display text-xl text-soul-blue">{job.title}</h2>
              {(job.department || job.location) && (
                <p className="mt-1 text-sm text-soul-muted">
                  {[job.department, job.location].filter(Boolean).join(' · ')}
                </p>
              )}
              <p className="mt-3 text-sm leading-7 text-soul-muted whitespace-pre-line">{job.description}</p>
              {job.requirements ? (
                <p className="mt-3 text-sm leading-7 text-soul-muted/90 whitespace-pre-line">
                  <span className="font-medium text-soul-blue">Requirements: </span>
                  {job.requirements}
                </p>
              ) : null}
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => setSelectedJob(job)}
                  className="btn-pill bg-soul-blue px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white"
                >
                  Apply Now
                </button>
              </div>
            </article>
          ))}
        </div>

        <ApplicationModal job={selectedJob} onClose={() => setSelectedJob(null)} />
      </main>
      <Footer />
    </div>
  );
}
