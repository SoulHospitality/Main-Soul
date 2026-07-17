import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Lock } from 'lucide-react';
import api from '../api/http';
import AuthShell, { AuthError, AuthField, AuthSubmit } from '../components/auth/AuthShell';
import PasswordChecklist from '../components/auth/PasswordChecklist';
import {
  getPasswordRuleChecks,
  passwordPolicyMessage,
  passwordPolicyOk,
} from '../utils/passwordRules';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const checks = useMemo(() => getPasswordRuleChecks(password), [password]);
  const match = password === confirmPassword;
  const canSubmit =
    Boolean(token) && passwordPolicyOk(password) && match && Boolean(confirmPassword);

  return (
    <AuthShell
      imageSrc="/soul-brand/coast-hero-1.jpg"
      eyebrow="Account recovery"
      title="Choose a new password"
      imageAlt="Soul Hospitality living space"
    >
      <div className="mb-8">
        <p className="soul-eyebrow text-soul-muted">Guests</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-soul-blue sm:text-4xl">
          Reset password
        </h1>
        <p className="mt-2 text-sm text-soul-muted">
          Create a strong password to regain access to your Soul account.
        </p>
      </div>

      {!token ? (
        <div className="space-y-4">
          <AuthError message="This reset link is missing or invalid. Request a new one." />
          <Link
            to="/forgot-password"
            className="inline-flex font-semibold text-soul-blue hover:text-soul-blue-dark"
          >
            Request a new reset link
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            if (!canSubmit) {
              setError(
                !match ? 'Passwords do not match' : passwordPolicyMessage()
              );
              return;
            }
            setLoading(true);
            try {
              const { data } = await api.post('/auth/reset-password', {
                token,
                password,
              });
              if (data?.accessToken) {
                localStorage.setItem('soul_guest_token', data.accessToken);
                localStorage.setItem('soul_guest_user', JSON.stringify(data.user));
                window.location.assign('/account');
                return;
              }
              navigate('/sign-in', { replace: true });
            } catch (err) {
              setError(err.response?.data?.error || err.message || 'Unable to reset password');
            } finally {
              setLoading(false);
            }
          }}
        >
          <AuthField
            label="New password"
            icon={Lock}
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a new password"
            autoComplete="new-password"
            rightSlot={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-soul-muted transition-colors hover:text-soul-blue"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />
          <AuthField
            label="Confirm password"
            icon={Lock}
            name="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat your password"
            autoComplete="new-password"
          />
          <PasswordChecklist checks={checks} />
          <div
            className={`flex items-center gap-2 text-xs ${
              match && confirmPassword ? 'text-emerald-700' : 'text-soul-muted'
            }`}
          >
            <span>{match && confirmPassword ? '✓' : '×'}</span>
            Passwords match
          </div>
          <AuthError message={error} />
          <AuthSubmit loading={loading} loadingLabel="Saving…" disabled={!canSubmit}>
            Save new password
          </AuthSubmit>
        </form>
      )}
    </AuthShell>
  );
}
