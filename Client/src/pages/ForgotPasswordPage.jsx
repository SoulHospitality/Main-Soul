import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import api from '../api/http';
import { useLocale } from '../context/LocaleContext';
import AuthShell, { AuthError, AuthField, AuthSubmit } from '../components/auth/AuthShell';

export default function ForgotPasswordPage() {
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <AuthShell
      imageSrc="/soul-brand/coast-hero-3.jpg"
      eyebrow={t('auth.accountRecovery')}
      title={t('auth.resetPanelTitle')}
      imageAlt="Soul Hospitality coastal stay"
    >
      <div className="mb-8">
        <p className="soul-eyebrow text-soul-muted">{t('auth.guests')}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-soul-blue sm:text-4xl">
          {t('auth.forgotTitle')}
        </h1>
        <p className="mt-2 text-sm text-soul-muted">
          {t('auth.forgotSubtitle')}
        </p>
      </div>

      {sent ? (
        <div className="space-y-5">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {t('auth.forgotSent')}
          </div>
          <Link
            to="/sign-in"
            className="inline-flex font-semibold text-soul-blue transition-colors hover:text-soul-blue-dark"
          >
            {t('auth.backSignIn')}
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
              setError(err.response?.data?.error || err.message || t('auth.unableSend'));
            } finally {
              setLoading(false);
            }
          }}
        >
          <AuthField
            label={t('auth.email')}
            icon={Mail}
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.emailPh')}
            autoComplete="email"
          />
          <AuthError message={error} />
          <AuthSubmit loading={loading} loadingLabel={t('auth.sending')}>
            {t('auth.sendReset')}
          </AuthSubmit>
        </form>
      )}

      <p className="mt-8 text-center text-sm text-soul-muted">
        {t('auth.remembered')}{' '}
        <Link to="/sign-in" className="font-semibold text-soul-blue hover:text-soul-blue-dark">
          {t('auth.signIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
