import { adminClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : undefined,
  basePath: '/api/auth',
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.assign('/login/2fa');
      },
    }),
    adminClient(),
  ],
});

export type AuthClient = typeof authClient;
