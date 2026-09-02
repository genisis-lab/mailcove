import { Hono } from 'hono';
import type { AppVariables } from '../auth/context';
import type { AppEnv } from '../env';

export type AppBindings = { Bindings: AppEnv; Variables: AppVariables };

export function router(): Hono<AppBindings> {
  return new Hono<AppBindings>();
}
