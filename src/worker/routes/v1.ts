import type { AppContext } from '../auth/context';
import { requireUser } from '../auth/context';
import { contactRoutes } from './contacts';
import { labelRoutes } from './labels';
import { mailboxRoutes } from './mailboxes';
import { draftRoutes, messageRoutes, uploadRoutes } from './messages';
import { router } from './router';
import { threadRoutes } from './threads';

/**
 * Stable public surface for scripts and agents, authenticated with
 * `Authorization: Bearer mc_live_…`. The handlers are the same ones the web
 * client uses; API-key scopes are enforced inside them.
 */
export const v1Routes = router();

function catalog(c: AppContext) {
  return c.json({
    name: 'Mailcove API',
    version: 1,
    auth: 'Authorization: Bearer <api key from Settings → API keys>',
    endpoints: {
      'GET /api/v1/mailboxes': 'Mailboxes you can access',
      'GET /api/v1/threads?view=inbox&q=': 'List conversations (Gmail-style search operators supported in q)',
      'GET /api/v1/threads/:id': 'Conversation with all messages',
      'POST /api/v1/threads/actions': 'Bulk actions: archive, trash, read, star, snooze, add_label, ...',
      'GET /api/v1/messages/:id': 'Single message',
      'GET /api/v1/messages/:id/raw': 'Original .eml',
      'GET /api/v1/messages/:id/attachments/:attachmentId': 'Attachment download',
      'POST /api/v1/messages/send': 'Send a message { mailboxId, to[], subject, html|text, uploadIds[] }',
      'POST /api/v1/uploads': 'Stage an attachment (multipart "file") for use in send',
      'GET /api/v1/drafts | POST | DELETE /:id': 'Drafts',
      'GET /api/v1/labels | POST | PATCH /:id | DELETE /:id': 'Labels',
      'GET /api/v1/contacts?q=': 'Contact autocomplete',
    },
  });
}

v1Routes.get('/', catalog);
v1Routes.get('', catalog);

v1Routes.use('*', requireUser);
v1Routes.route('/mailboxes', mailboxRoutes);
v1Routes.route('/threads', threadRoutes);
v1Routes.route('/messages', messageRoutes);
v1Routes.route('/drafts', draftRoutes);
v1Routes.route('/uploads', uploadRoutes);
v1Routes.route('/labels', labelRoutes);
v1Routes.route('/contacts', contactRoutes);
