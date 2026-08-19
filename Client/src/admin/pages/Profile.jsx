import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, CheckCircle, Palmtree } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, ROLE_COLORS, PMS_LABELS } from '../utils/permissions';
import { getRoleTheme } from '../utils/roleTheme';
import { formatDate, formatDateTime } from '../utils/formatters';
import { getPasswordRuleChecks, passwordPolicyMessage } from '../utils/passwordRules';
import PasswordChecklist from '../../components/auth/PasswordChecklist';

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();
  const theme = getRoleTheme(user?.role);
  const [pwForm, setPwForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [showPw, setShowPw] = useState(false);

  const checks = useMemo(
    () => getPasswordRuleChecks(pwForm.new_password),
    [pwForm.new_password]
  );
  const match = pwForm.new_password === pwForm.confirm_password;
  const canSubmit =
    Boolean(pwForm.current_password) &&
    Object.values(checks).every(Boolean) &&
    match &&
    Boolean(pwForm.confirm_password);

  const canRequestLeave = user?.role && user.role !== 'owner';
  const [leaveForm, setLeaveForm] = useState({
    leave_type: 'casual',
    start_date: '',
    end_date: '',
    reason: '',
  });

  const { data: myLeave = [] } = useQuery({
    queryKey: ['hr-leave-requests', 'mine'],
    queryFn: () => api.get('/hr/leave-requests', { params: { mine: 1 } }).then((r) => r.data),
    enabled: canRequestLeave,
  });
  const { data: leaveSnap } = useQuery({
    queryKey: ['hr-my-leave'],
    queryFn: () => api.get('/hr/my-leave').then((r) => r.data),
    enabled: canRequestLeave,
  });

  const leaveMutation = useMutation({
    mutationFn: (payload) => api.post('/hr/leave-requests', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests'] });
      qc.invalidateQueries({ queryKey: ['hr-my-leave'] });
      toast.success('Holiday request sent to HR');
      setLeaveForm({ leave_type: 'casual', start_date: '', end_date: '', reason: '' });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not submit request'),
  });

  const submitLeave = () => {
    if (!leaveForm.start_date) {
      toast.error('Choose a date');
      return;
    }
    if (leaveForm.leave_type === 'early_leave') {
      leaveMutation.mutate({ ...leaveForm, end_date: leaveForm.start_date });
      return;
    }
    if (!leaveForm.end_date) {
      toast.error('Choose start and end dates');
      return;
    }
    if (leaveForm.end_date < leaveForm.start_date) {
      toast.error('End date must be on or after the start date');
      return;
    }
    leaveMutation.mutate(leaveForm);
  };

  const changePwMutation = useMutation({
    mutationFn: (d) =>
      api.patch('/auth/change-password', {
        currentPassword: d.current_password,
        newPassword: d.new_password,
      }),
    onSuccess: async () => {
      toast.success('Password changed successfully');
      setPwForm({ current_password: '', new_password: '', confirm_password: '' });
      if (refreshUser) await refreshUser();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error changing password'),
  });

  const handleChangePw = () => {
    if (!canSubmit) {
      if (!match) toast.error('New passwords do not match');
      else toast.error(passwordPolicyMessage());
      return;
    }
    changePwMutation.mutate(pwForm);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="page-header">
        <p className="soul-eyebrow mb-2" style={{ color: 'var(--pms-accent-text)' }}>
          {theme.eyebrow}
        </p>
        <h1 className="page-title">My Profile</h1>
        <p className="page-subtitle">Account settings · {PMS_LABELS[user?.role]}</p>
      </div>

      <div className="card">
        <div className="flex items-center gap-5">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-3xl font-bold"
            style={{
              background: 'var(--pms-avatar)',
              boxShadow: '0 12px 28px var(--pms-nav-glow)',
            }}
          >
            {user?.full_name?.charAt(0)?.toUpperCase()}
          </div>
          <div>
            <h2 className="font-display text-2xl text-soul-blue">{user?.full_name}</h2>
            <p className="text-soul-muted text-sm">
              {user?.staff_code ? `${user.staff_code} · ` : ''}
              {user?.email || (user?.username ? `@${user.username}` : '—')}
            </p>
            <span className={`badge mt-2 ${ROLE_COLORS[user?.role]}`}>
              {ROLE_LABELS[user?.role]}
            </span>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-soul-muted block">Email</span>
            <span className="text-soul-blue font-medium">{user?.email || '—'}</span>
          </div>
          <div>
            <span className="text-soul-muted block">Member Since</span>
            <span className="text-soul-blue font-medium">{formatDateTime(user?.created_at)}</span>
          </div>
          <div>
            <span className="text-soul-muted block">Account Status</span>
            <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
              <CheckCircle className="w-4 h-4" />
              Active
            </span>
          </div>
        </div>
      </div>

      {canRequestLeave && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Palmtree className="w-5 h-5 text-soul-muted" />
            <h3 className="font-semibold text-soul-blue">Time off</h3>
          </div>
          <p className="text-sm text-soul-muted mb-4">
            Casual: before the 11:00 shift. Annual: at least 7 days ahead. Early leave: max 2 per year.
          </p>
          {leaveSnap && (
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-soul-line px-2 py-2">
                <div className="text-[10px] uppercase text-soul-muted">Casual</div>
                <div className="font-semibold text-soul-blue">{leaveSnap.casual_available}</div>
              </div>
              <div className="rounded-xl border border-soul-line px-2 py-2">
                <div className="text-[10px] uppercase text-soul-muted">Annual</div>
                <div className="font-semibold text-soul-blue">{leaveSnap.annual_available}</div>
              </div>
              <div className="rounded-xl border border-soul-line px-2 py-2">
                <div className="text-[10px] uppercase text-soul-muted">Early leave</div>
                <div className="font-semibold text-soul-blue">
                  {leaveSnap.early_leave_remaining}/{leaveSnap.early_leave_max}
                </div>
              </div>
            </div>
          )}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Type</label>
                <select
                  className="input"
                  value={leaveForm.leave_type}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, leave_type: e.target.value }))}
                >
                  <option value="casual">Casual</option>
                  <option value="annual">Annual</option>
                  <option value="early_leave">Early leave</option>
                </select>
              </div>
              <div className="sm:col-span-2 grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{leaveForm.leave_type === 'early_leave' ? 'Day' : 'From'}</label>
                  <input
                    type="date"
                    className="input"
                    value={leaveForm.start_date}
                    onChange={(e) =>
                      setLeaveForm((f) => ({
                        ...f,
                        start_date: e.target.value,
                        end_date:
                          f.leave_type === 'early_leave' || !f.end_date || f.end_date < e.target.value
                            ? e.target.value
                            : f.end_date,
                      }))
                    }
                  />
                </div>
                {leaveForm.leave_type !== 'early_leave' && (
                <div>
                  <label className="label">To</label>
                  <input
                    type="date"
                    className="input"
                    value={leaveForm.end_date}
                    onChange={(e) => setLeaveForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="label">Note</label>
                <textarea
                  className="input min-h-[72px]"
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={leaveMutation.isPending}
              onClick={submitLeave}
            >
              {leaveMutation.isPending ? 'Sending…' : 'Send request'}
            </button>
          </div>
          {Array.isArray(myLeave) && myLeave.length > 0 && (
            <div className="mt-5 border-t border-soul-line pt-4 space-y-2">
              {myLeave.slice(0, 8).map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium text-soul-blue">
                      {formatDate(r.start_date)}
                      {r.start_date !== r.end_date ? ` → ${formatDate(r.end_date)}` : ''}
                    </div>
                    <div className="text-xs text-soul-muted capitalize">
                      {String(r.leave_type || '').replace('_', ' ')}
                      {r.reason ? ` · ${r.reason}` : ''}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      r.status === 'approved'
                        ? 'bg-emerald-50 text-emerald-700'
                        : r.status === 'rejected'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="w-5 h-5 text-soul-muted" />
          <h3 className="font-semibold text-soul-blue">Change Password</h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">Current Password</label>
            <input
              type={showPw ? 'text' : 'password'}
              className="input"
              value={pwForm.current_password}
              onChange={(e) => setPwForm((f) => ({ ...f, current_password: e.target.value }))}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="label">New Password</label>
            <input
              type={showPw ? 'text' : 'password'}
              className="input"
              value={pwForm.new_password}
              onChange={(e) => setPwForm((f) => ({ ...f, new_password: e.target.value }))}
              placeholder="Meet the policy below"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">Confirm New Password</label>
            <input
              type={showPw ? 'text' : 'password'}
              className="input"
              value={pwForm.confirm_password}
              onChange={(e) => setPwForm((f) => ({ ...f, confirm_password: e.target.value }))}
              autoComplete="new-password"
            />
          </div>

          <PasswordChecklist checks={checks} />
          <div
            className={`flex items-center gap-2 text-xs ${
              match && pwForm.confirm_password ? 'text-emerald-700' : 'text-soul-muted'
            }`}
          >
            <span>{match && pwForm.confirm_password ? '✓' : '×'}</span>
            Passwords match
          </div>

          <label className="flex items-center gap-2 text-sm text-soul-muted cursor-pointer">
            <input
              type="checkbox"
              checked={showPw}
              onChange={(e) => setShowPw(e.target.checked)}
              className="rounded"
            />
            Show passwords
          </label>
          <button
            type="button"
            onClick={handleChangePw}
            disabled={!canSubmit || changePwMutation.isPending}
            className="btn-primary"
          >
            {changePwMutation.isPending ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </div>
    </div>
  );
}
