import { useEffect, useState } from 'react';
import {
  Briefcase, Plus, Trash2, CheckCircle2, Clock, Eye, FileUser, XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';

const STATUS_OPTIONS = ['Pending', 'Reviewed', 'Shortlisted', 'Rejected'];

const statusStyles = {
  Pending: 'border-amber-200 bg-amber-50 text-amber-700',
  Reviewed: 'border-sky-200 bg-sky-50 text-sky-700',
  Shortlisted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Rejected: 'border-rose-200 bg-rose-50 text-rose-700',
};

const statusIcons = {
  Pending: Clock,
  Reviewed: Eye,
  Shortlisted: CheckCircle2,
  Rejected: XCircle,
};

const emptyJob = { title: '', description: '', department: '', location: '' };

export default function Recruitment() {
  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [jobForm, setJobForm] = useState(emptyJob);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingApps, setLoadingApps] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleteJobId, setDeleteJobId] = useState(null);
  const [deleteAppId, setDeleteAppId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadJobs = async () => {
    setLoadingJobs(true);
    try {
      const { data } = await api.get('/recruitment/jobs');
      setJobs(data.items || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load jobs');
    } finally {
      setLoadingJobs(false);
    }
  };

  const loadApplications = async () => {
    setLoadingApps(true);
    try {
      const { data } = await api.get('/recruitment/applications');
      setApplications(data.items || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load applications');
    } finally {
      setLoadingApps(false);
    }
  };

  useEffect(() => {
    loadJobs();
    loadApplications();
  }, []);

  const handlePostJob = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/recruitment/jobs', jobForm);
      setJobForm(emptyJob);
      toast.success('Job posted successfully');
      await loadJobs();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to post job');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDeleteJob = async () => {
    if (!deleteJobId) return;
    setDeleting(true);
    try {
      await api.delete(`/recruitment/jobs/${deleteJobId}`);
      toast.success('Job deleted');
      setDeleteJobId(null);
      await loadJobs();
      await loadApplications();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete job');
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeleteApp = async () => {
    if (!deleteAppId) return;
    setDeleting(true);
    try {
      await api.delete(`/recruitment/applications/${deleteAppId}`);
      toast.success('Application deleted');
      setApplications((list) => list.filter((a) => a.id !== deleteAppId));
      setDeleteAppId(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete application');
    } finally {
      setDeleting(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    const prev = applications;
    setApplications((list) => list.map((a) => (a.id === id ? { ...a, status } : a)));
    try {
      const { data } = await api.patch(`/recruitment/applications/${id}/status`, { status });
      setApplications((list) =>
        list.map((a) => (a.id === id ? { ...a, ...data, status: data.status || status } : a))
      );
    } catch (err) {
      setApplications(prev);
      toast.error(err.response?.data?.error || 'Failed to update status');
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Recruitment</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">HR recruitment workspace</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
          Publish vacancies, review the live candidate queue, and manage CVs from one administrative surface.
        </p>
      </div>

      {/* Post job */}
      <form
        onSubmit={handlePostJob}
        className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-6 md:grid-cols-2"
      >
        <div className="md:col-span-2 flex items-center gap-2 text-slate-800">
          <Briefcase className="h-5 w-5" strokeWidth={1.5} />
          <h2 className="text-lg font-bold">Post a new job</h2>
        </div>

        <label className="grid gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
          Job Title
          <input
            type="text"
            className="input"
            value={jobForm.title}
            onChange={(e) => setJobForm((f) => ({ ...f, title: e.target.value }))}
            required
          />
        </label>

        <label className="grid gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
          Department
          <input
            type="text"
            className="input"
            value={jobForm.department}
            onChange={(e) => setJobForm((f) => ({ ...f, department: e.target.value }))}
            placeholder="Optional"
          />
        </label>

        <label className="grid gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
          Location
          <input
            type="text"
            className="input"
            value={jobForm.location}
            onChange={(e) => setJobForm((f) => ({ ...f, location: e.target.value }))}
            placeholder="Optional"
          />
        </label>

        <label className="grid gap-2 text-xs uppercase tracking-[0.16em] text-slate-500 md:col-span-2">
          Job Description
          <textarea
            className="input"
            rows={4}
            value={jobForm.description}
            onChange={(e) => setJobForm((f) => ({ ...f, description: e.target.value }))}
            required
          />
        </label>

        <div className="md:col-span-2 flex justify-end">
          <button type="submit" disabled={submitting} className="btn-primary inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            {submitting ? 'Posting...' : 'Post Job'}
          </button>
        </div>
      </form>

      {/* Open positions */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">Open Positions</h2>
        </div>
        {loadingJobs ? (
          <div className="p-8 flex justify-center"><LoadingSpinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-[0.16em] text-slate-400">
                  <th className="px-6 py-3">Title</th>
                  <th className="px-6 py-3">Description</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-6 py-4 font-semibold text-slate-800">
                      {job.title}
                      {(job.department || job.location) && (
                        <div className="mt-0.5 text-xs font-normal text-slate-400">
                          {[job.department, job.location].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-500 max-w-md truncate">{job.description}</td>
                    <td className="px-6 py-4">
                      <span className={`badge ${job.is_open ? 'badge-green' : 'badge-gray'}`}>
                        {job.is_open ? 'Open' : 'Closed'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setDeleteJobId(job.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {!jobs.length ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-400">
                      No open positions yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Applications queue */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">HR Panel</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-900">Candidate applications queue</h2>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-bold text-slate-900">Candidates</h3>
        </div>
        {loadingApps ? (
          <div className="p-8 flex justify-center"><LoadingSpinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-[0.16em] text-slate-400">
                  <th className="px-6 py-3">Full Name</th>
                  <th className="px-6 py-3">Job</th>
                  <th className="px-6 py-3">Email</th>
                  <th className="px-6 py-3">Phone</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">CV</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => {
                  const status = app.status || 'Pending';
                  const StatusIcon = statusIcons[status] || FileUser;
                  return (
                    <tr key={app.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-6 py-4 font-semibold text-slate-800">
                        {app.fullName || app.full_name}
                      </td>
                      <td className="px-6 py-4 text-slate-500">{app.job_title || 'General'}</td>
                      <td className="px-6 py-4 text-slate-500">{app.email}</td>
                      <td className="px-6 py-4 text-slate-500">{app.phone || '—'}</td>
                      <td className="px-6 py-4">
                        <div
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 ${
                            statusStyles[status] || statusStyles.Pending
                          }`}
                        >
                          <StatusIcon className="h-4 w-4" strokeWidth={1.5} />
                          <select
                            value={status}
                            onChange={(e) => handleStatusChange(app.id, e.target.value)}
                            className="bg-transparent text-xs font-semibold uppercase tracking-[0.16em] outline-none"
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {app.cvUrl || app.resume_url ? (
                          <a
                            href={app.cvUrl || app.resume_url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 hover:bg-slate-50"
                          >
                            View CV
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">No CV</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => setDeleteAppId(app.id)}
                          className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-red-500 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!applications.length ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-sm text-slate-400">
                      No applications yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteJobId}
        onClose={() => setDeleteJobId(null)}
        onConfirm={confirmDeleteJob}
        loading={deleting}
        danger
        title="Delete this job?"
        message="This will also remove applications linked to this position."
      />
      <ConfirmDialog
        open={!!deleteAppId}
        onClose={() => setDeleteAppId(null)}
        onConfirm={confirmDeleteApp}
        loading={deleting}
        danger
        title="Delete this application?"
        message="This cannot be undone."
      />
    </div>
  );
}
