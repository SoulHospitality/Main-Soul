import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Lock, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, ROLE_COLORS, PMS_LABELS } from '../utils/permissions';
import { getRoleTheme } from '../utils/roleTheme';
import { formatDateTime } from '../utils/formatters';
import { getPasswordRuleChecks, passwordPolicyMessage } from '../utils/passwordRules';
import PasswordChecklist from '../../components/auth/PasswordChecklist';

export default function Profile() {
  const { user, refreshUser } = useAuth();
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
