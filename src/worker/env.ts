import type { MailProviderKind } from '../shared/types';

type Bindings = Omit<Env, 'APP_NAME' | 'APP_BASE_URL' | 'EMAIL_WORKER_NAME' | 'DEFAULT_MAIL_PROVIDER' | 'UNDO_SEND_SECONDS'>;

/** Runtime environment: generated bindings plus secrets and loosely-typed vars. */
export interface AppEnv extends Bindings {
  APP_NAME: string;
  APP_BASE_URL: string;
  EMAIL_WORKER_NAME: string;
  DEFAULT_MAIL_PROVIDER: MailProviderKind | string;
  UNDO_SEND_SECONDS: string;

  AUTH_SECRET?: string;
  ENCRYPTION_KEY?: string;

  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;

  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;

  POSTMARK_SERVER_TOKEN?: string;
  POSTMARK_ACCOUNT_TOKEN?: string;
  POSTMARK_WEBHOOK_SECRET?: string;

  SENDGRID_API_KEY?: string;
  SENDGRID_WEBHOOK_PUBLIC_KEY?: string;

  MAILGUN_API_KEY?: string;
  MAILGUN_WEBHOOK_SIGNING_KEY?: string;
  MAILGUN_REGION?: string;

  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;

  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export function baseUrl(env: AppEnv): string {
  return (env.APP_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

export function isSecureDeployment(env: AppEnv): boolean {
  return baseUrl(env).startsWith('https://');
}

export function undoSendSeconds(env: AppEnv): number {
  const n = Number.parseInt(env.UNDO_SEND_SECONDS ?? '10', 10);
  if (!Number.isFinite(n) || n < 0) return 10;
  return Math.min(n, 60);
}

export function authSecret(env: AppEnv): string {
  if (env.AUTH_SECRET && env.AUTH_SECRET.length >= 16) return env.AUTH_SECRET;
  // Local development only. Production must set AUTH_SECRET.
  return 'mailcove-dev-secret-change-me-before-deploying';
}
