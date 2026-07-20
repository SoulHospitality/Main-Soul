import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { defaultAdminPage, ADMIN_CHANGE_PASSWORD } from '../admin/utils/adminRoutes';
import AuthShell, { AuthError, AuthField, AuthSubmit } from '../components/auth/AuthShell';

export default function SignInPage() {
  const { signIn, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const staffOnly = params.get('staff') === '1';
  const nextPath = params.get('next') || '/account';
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!staffOnly && user) {
      navigate(nextPath.startsWith('/') ? nextPath : '/account', { replace: true });
      return;
    }
    try {
      const staff = JSON.parse(localStorage.getItem('pms_user') || 'null');
      if (staff && localStorage.getItem('pms_token')) {
        if (staff.is_first_login) {
          navigate(ADMIN_CHANGE_PASSWORD, { replace: true });
        } else {
          navigate(defaultAdminPage(staff.role), { replace: true });
        }
      }
    } catch {
      /* ignore */
    }
  }, [user, navigate, nextPath, staffOnly]);

  return (
    <AuthShell
      imageSrc="/soul-brand/coast-hero-2.jpg"
      eyebrow={staffOnly ? 'Staff access' : "Let's get started"}
      title={staffOnly ? 'Soul Hospitality PMS' : 'Find your next coastal getaway'}
      imageAlt="Soul Hospitality North Coast"
    >
      <div className="mb-8 text-center">
        <img
          src="/soul-brand/soul-logo.png"
          alt=""
          className="mx-auto mb-4 hidden h-20 w-auto md:block"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <h1 className="font-display text-3xl font-semibold text-soul-blue sm:text-4xl">
          {staffOnly ? 'Staff sign in' : 'Welcome back'}
        </h1>
        <p className="mt-2 text-sm text-soul-muted">
          {staffOnly
            ? 'Team members only — guest accounts cannot sign in here.'
            : 'Sign in, Explore More.'}
        </p>
      </div>

      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setLoading(true);
          try {
            const result = await signIn(identity, password, { staffOnly });
            if (result.kind === 'staff') {
              if (result.forcePasswordChange || result.user?.is_first_login) {
                navigate(ADMIN_CHANGE_PASSWORD, { replace: true });
              } else {
                navigate(defaultAdminPage(result.user.role), { replace: true });
              }
            } else if (!staffOnly) {
              navigate(nextPath.startsWith('/') ? nextPath : '/account', { replace: true });
            } else {
              setError('Staff credentials required.');
            }
          } catch (err) {
            setError(
              staffOnly
                ? err.response?.data?.error || err.message || 'Invalid staff username or password'
                : err.response?.data?.error || err.message || 'Sign in failed'
            );
          } finally {
            setLoading(false);
          }
        }}
      >
        <AuthField
          label={staffOnly ? 'Username' : 'Email or Username'}
          icon={User}
          name="identity"
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
          placeholder={staffOnly ? 'Staff username' : 'Enter Email or Username'}
          autoComplete="username"
        />

        <AuthField
          label="Password"
          icon={Lock}
          name="password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          autoComplete="current-password"
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

        <AuthError message={error} />
        <AuthSubmit loading={loading} loadingLabel="Signing in…">
          {staffOnly ? 'Sign in to PMS' : 'Sign in'}
        </AuthSubmit>
      </form>

      {!staffOnly && (
        <>
          <p className="mt-4 text-center text-sm">
            <Link to="/forgot-password" className="font-medium text-soul-muted hover:text-soul-blue">
              Forgot password?
            </Link>
          </p>

          <p className="mt-6 text-center text-sm text-soul-muted">
            Don&apos;t have an account?{' '}
            <Link
              to="/sign-up"
              className="font-semibold text-soul-blue transition-colors hover:text-soul-blue-dark"
            >
              Sign up now
            </Link>
          </p>
        </>
      )}

      {staffOnly && (
        <p className="mt-6 text-center text-sm text-soul-muted">
          <Link to="/" className="font-medium text-soul-muted hover:text-soul-blue">
            ← Back to home
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
