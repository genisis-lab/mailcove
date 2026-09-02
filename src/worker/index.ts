import { createApp } from './app';
import type { AppEnv } from './env';
import { handleScheduled } from './jobs/cron';
import { handleQueueBatch } from './jobs/queue';
import { handleInboundEmail } from './mail/inbound/handler';
import { MailHub } from './realtime/hub';

const app = createApp();

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  email: (message, env, ctx) => handleInboundEmail(message, env, ctx),
  queue: (batch, env) => handleQueueBatch(batch, env),
  scheduled: (controller, env) => handleScheduled(controller, env),
} satisfies ExportedHandler<AppEnv>;

export { MailHub };
