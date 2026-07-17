import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, Phone, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthShell, { AuthError, AuthField, AuthSubmit } from '../components/auth/AuthShell';
import PasswordChecklist from '../components/auth/PasswordChecklist';
import {
  getPasswordRuleChecks,
  passwordPolicyMessage,
  passwordPolicyOk,
} from '../utils/passwordRules';

export default function SignUpPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const checks = useMemo(() => getPasswordRuleChecks(form.password), [form.password]);
  const match = form.password === form.confirmPassword;
  const canSubmit =
    Boolean(form.email) &&
    Boolean(form.full_name) &&
    passwordPolicyOk(form.password) &&
    match &&
    Boolean(form.confirmPassword);

  return (
    <AuthShell
      variant="badge"
      imageSrc="/soul-brand/coast-hero-1.jpg"
      title="Create your account"
      imageAlt="Soul Hospitality living space"
    >
      <div className="mb-8">
        <p className="soul-eyebrow text-soul-muted">Join Soul</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-soul-blue sm:text-4xl">
          Create account
        </h1>
        <p className="mt-2 text-sm text-soul-muted">
          Book coastal stays and manage your trips in one place.
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          if (form.password !== form.confirmPassword) {
            setError('Passwords do not match');
            return;
          }
          if (!passwordPolicyOk(form.password)) {
            setError(passwordPolicyMessage());
            return;
          }
          setLoading(true);
          try {
            await signUp({
              email: form.email,
              password: form.password,
              full_name: form.full_name,
              phone: form.phone,
            });
            navigate('/account', { replace: true });
          } catch (err) {
            setError(err.response?.data?.error || err.message || 'Sign up failed');
          } finally {
            setLoading(false);
          }
        }}
      >
        <AuthField
          label="Full name"
          icon={User}
          name="full_name"
          value={form.full_name}
          onChange={setField('full_name')}
          placeholder="Your full name"
          autoComplete="name"
        />
        <AuthField
          label="Email"
          icon={Mail}
          name="email"
          type="email"
          value={form.email}
          onChange={setField('email')}
          placeholder="your@email.com"
          autoComplete="email"
        />
        <AuthField
          label="Phone"
          icon={Phone}
          name="phone"
          type="tel"
          value={form.phone}
          onChange={setField('phone')}
          placeholder="01xxxxxxxxx"
          autoComplete="tel"
          required={false}
        />
        <AuthField
          label="Password"
          icon={Lock}
          name="password"
          type={showPassword ? 'text' : 'password'}
          value={form.password}
          onChange={setField('password')}
          placeholder="Create a password"
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
          value={form.confirmPassword}
          onChange={setField('confirmPassword')}
          placeholder="Repeat your password"
          autoComplete="new-password"
        />

        <PasswordChecklist checks={checks} />
        <div
          className={`flex items-center gap-2 text-xs ${
            match && form.confirmPassword ? 'text-emerald-700' : 'text-soul-muted'
          }`}
        >
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
              match && form.confirmPassword
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-soul-line bg-white'
            }`}
          >
            {match && form.confirmPassword ? '✓' : '×'}
          </span>
          Passwords match
        </div>

        <AuthError message={error} />
        <AuthSubmit loading={loading} loadingLabel="Creating account…" disabled={!canSubmit}>
          Sign up
        </AuthSubmit>
      </form>

      <p className="mt-8 text-center text-sm text-soul-muted">
        Already have an account?{' '}
        <Link to="/sign-in" className="font-semibold text-soul-blue transition-colors hover:text-soul-blue-dark">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
