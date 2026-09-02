import { useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Field, Input } from '../components/ui';
import { authClient } from '../lib/auth-client';
import { useConfig } from '../lib/queries';

export function AuthShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  const config = useConfig();
  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm fade-in">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {config.data?.logoUrl ? (
            <img src={config.data.logoUrl} alt="" className="h-12 w-12 rounded-2xl object-contain" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow">
              <Mail className="h-6 w-6" />
            </span>
          )}
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
        </div>
        <div className="card p-6 shadow-[var(--shadow)]">{children}</div>
        <p className="mt-6 text-center text-xs text-faint">{config.data?.appName ?? 'Mailcove'} · self-hosted mail</p>
      </div>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const qc = useQueryClient();
  const config = useConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await authClient.signIn.email({ email: email.trim().toLowerCase(), password, rememberMe: true });
    setLoading(false);
    if (result.error) {
      setError(result.error.message ?? 'Sign-in failed');
      return;
    }
    if ((result.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      navigate('/login/2fa');
      return;
    }
    await qc.invalidateQueries();
    navigate(location.state?.from && !location.state.from.startsWith('/login') ? location.state.from : '/mail/inbox', { replace: true });
  }

  return (
    <AuthShell title={`Sign in to ${config.data?.appName ?? 'Mailcove'}`} subtitle="Your domains. Your inbox. Your Cloudflare account.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="you@example.com" />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={loading}>
          Sign in
        </Button>
        {config.data?.allowSignups && (
          <p className="text-center text-sm text-muted">
            New here?{' '}
            <Link to="/setup/register" className="text-accent hover:underline">
              Create an account
            </Link>
          </p>
        )}
      </form>
    </AuthShell>
  );
}

export function TwoFactorPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [trust, setTrust] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice: trust })
      : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ''), trustDevice: trust });
    setLoading(false);
    if (result.error) {
      setError(result.error.message ?? 'Invalid code');
      return;
    }
    await qc.invalidateQueries();
    navigate('/mail/inbox', { replace: true });
  }

  return (
    <AuthShell title="Two-step verification" subtitle={useBackup ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.'}>
      <form onSubmit={submit} className="space-y-4">
        <Input
          inputMode={useBackup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={useBackup ? 'xxxxx-xxxxx' : '123 456'}
          className="text-center text-lg tracking-widest"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="accent-[var(--accent)]" />
          Trust this device for 30 days
        </label>
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={loading}>
          Verify
        </Button>
        <button type="button" className="w-full text-center text-sm text-accent hover:underline" onClick={() => setUseBackup((v) => !v)}>
          {useBackup ? 'Use authenticator code instead' : 'Use a backup code'}
        </button>
      </form>
    </AuthShell>
  );
}
