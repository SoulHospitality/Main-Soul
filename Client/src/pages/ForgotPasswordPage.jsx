import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import api from '../api/http';
import AuthShell, { AuthError, AuthField, AuthSubmit } from '../components/auth/AuthShell';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <AuthShell
      imageSrc="/soul-brand/coast-hero-3.jpg"
      eyebrow="Account recovery"
      title="Reset your password"
      imageAlt="Soul Hospitality coastal stay"
    >
      <div className="mb-8">
        <p className="soul-eyebrow text-soul-muted">Guests</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-soul-blue sm:text-4xl">
          Forgot password
        </h1>
        <p className="mt-2 text-sm text-soul-muted">
          Enter your account email and we&apos;ll send a reset link if it exists.
        </p>
      </div>

      {sent ? (
        <div className="space-y-5">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            If an account exists for that email, a reset link is on its way. Check your inbox
            (and spam folder).
          </div>
          <Link
            to="/sign-in"
            className="inline-flex font-semibold text-soul-blue transition-colors hover:text-soul-blue-dark"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            setLoading(true);
            try {
              await api.post('/auth/forgot-password', { email: email.trim() });
              setSent(true);
            } catch (err) {
              setError(err.response?.data?.error || err.message || 'Unable to send reset email');
            } finally {
              setLoading(false);
            }
          }}
        >
          <AuthField
            label="Email"
            icon={Mail}
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            autoComplete="email"
          />
          <AuthError message={error} />
          <AuthSubmit loading={loading} loadingLabel="Sending…">
            Send reset link
          </AuthSubmit>
        </form>
      )}

      <p className="mt-8 text-center text-sm text-soul-muted">
        Remembered it?{' '}
        <Link to="/sign-in" className="font-semibold text-soul-blue hover:text-soul-blue-dark">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
