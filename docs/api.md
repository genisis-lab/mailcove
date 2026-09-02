# Mailcove public API

Base URL: `https://<your-host>/api/v1`

Authenticate with a key from **Settings → API keys**:

```
Authorization: Bearer mc_live_…
```

Keys are shown once. They are stored as SHA-256 hashes with a prefix index (`mc_live_` + first 8 secret chars). An administrator can disable the public API entirely under Admin → Settings.

## Scopes

| Scope | Access |
| --- | --- |
| `mail:read` | List/get threads, messages, attachments, raw `.eml` |
| `mail:send` | Send, undo, schedule |
| `mail:write` | Archive, trash, labels, drafts, filters |
| `contacts:read` | Contact autocomplete |
| `admin` | Admin routes (users, domains, …) — rarely needed on a personal key |

## Discovery

`GET /api/v1` returns the live endpoint map (no auth).

## Common routes

The v1 surface remounts the same handlers the SPA uses.

### Mailboxes

```
GET /api/v1/mailboxes
```

### Conversations

```
GET /api/v1/threads?view=inbox&q=from:bob has:attachment&cursor=
GET /api/v1/threads/:id
POST /api/v1/threads/actions
```

`q` accepts Gmail-style operators: `from`, `to`, `cc`, `subject`, `filename`, `label`, `has:attachment`, `is:unread|read|starred|snoozed`, `in:inbox|spam|trash|anywhere`, `category:`, `before`/`after`/`older_than`/`newer_than`, `larger`/`smaller`, `mailbox:`.

Bulk `actions` body:

```json
{ "ids": ["thread-id"], "action": "archive" }
```

Actions include `archive`, `trash`, `restore`, `spam`, `not_spam`, `read`, `unread`, `star`, `unstar`, `snooze`, `unsnooze`, `add_label`, `remove_label`, `move`.

### Messages

```
GET /api/v1/messages/:id
GET /api/v1/messages/:id/raw
GET /api/v1/messages/:id/attachments/:attachmentId
POST /api/v1/messages/send
POST /api/v1/messages/:id/undo
```

Send body (minimal):

```json
{
  "mailboxId": "…",
  "to": [{ "email": "ada@example.com", "name": "Ada" }],
  "subject": "Hello",
  "html": "<p>Hi</p>",
  "text": "Hi"
}
```

Optional: `cc`, `bcc`, `fromAddress` (alias), `uploadIds`, `scheduledAt`, `replyToMessageId`, `forwardOfMessageId`. The response includes `undoUntil` when the undo window is open.

### Uploads

```
POST /api/v1/uploads
```

`multipart/form-data` field `file`. Returns an id to pass as `uploadIds` on send.

### Labels, drafts, contacts

```
GET|POST /api/v1/labels
PATCH|DELETE /api/v1/labels/:id
GET|POST /api/v1/drafts
DELETE /api/v1/drafts/:id
GET /api/v1/contacts?q=ada
```

## Errors

JSON:

```json
{ "error": { "code": "not_found", "message": "…" } }
```

Common codes: `unauthorized`, `forbidden`, `bad_origin`, `too_late`, `api_disabled`, `not_found`.

## Outgoing webhooks

Settings → Webhooks. Mailcove POSTs signed JSON for `message.received`, `message.sent`, `message.delivered`, `message.bounced`, `message.complained`, `message.failed`. Failures retry; deliveries are listed in Admin.

## Follow-up

A CLI and MCP server are not shipped; this API is the intended surface for them.
