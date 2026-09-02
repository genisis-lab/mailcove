import { useMutation, useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Forward,
  ImageIcon,
  MoreVertical,
  Paperclip,
  Printer,
  Reply,
  ReplyAll,
  ShieldCheck,
  Star,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { del, patch, post } from '../lib/api';
import { useApp } from '../lib/app-state';
import { keys, useUndoSend } from '../lib/queries';
import type { Message, ThreadItem } from '../lib/types';
import { cn, downloadUrl, formatBytes, formatFullDate, formatListDate } from '../lib/utils';
import { EmailBody } from './EmailBody';
import { Avatar, Button, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from './ui';

type Props = {
  message: Message;
  thread: ThreadItem;
  expanded: boolean;
  onToggle: () => void;
  onReply: (mode: 'reply' | 'reply_all' | 'forward') => void;
  isLast: boolean;
};

function statusLabel(message: Message): { label: string; tone: 'muted' | 'success' | 'warning' | 'danger'; icon: typeof Clock } | null {
  if (message.direction !== 'outbound') return null;
  switch (message.status) {
    case 'queued':
    case 'sending':
      return { label: 'Sending…', tone: 'muted', icon: Clock };
    case 'scheduled':
      return { label: `Scheduled for ${message.scheduledAt ? formatFullDate(message.scheduledAt) : 'later'}`, tone: 'warning', icon: Clock };
    case 'sent':
      return { label: 'Sent', tone: 'muted', icon: CheckCircle2 };
    case 'delivered':
      return { label: 'Delivered', tone: 'success', icon: CheckCircle2 };
    case 'delayed':
      return { label: 'Delivery delayed', tone: 'warning', icon: Clock };
    case 'bounced':
      return { label: `Bounced${message.statusDetail ? ` · ${message.statusDetail}` : ''}`, tone: 'danger', icon: AlertTriangle };
    case 'complained':
      return { label: 'Marked as spam by recipient', tone: 'danger', icon: AlertTriangle };
    case 'failed':
      return { label: `Failed${message.statusDetail ? ` · ${message.statusDetail}` : ''}`, tone: 'danger', icon: AlertTriangle };
    case 'draft':
      return { label: 'Draft', tone: 'warning', icon: FileText };
    default:
      return null;
  }
}

export function MessageItem({ message, thread, expanded, onToggle, onReply, isLast }: Props) {
  const { me, prefs, openCompose } = useApp();
  const qc = useQueryClient();
  const [showImages, setShowImages] = useState(prefs.showImages === 'always');
  const [blockedImages, setBlockedImages] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const undo = useUndoSend();

  const fromName = message.fromName || message.fromAddr;
  const isMine = (me?.mailboxes ?? []).some((m) => m.address === message.fromAddr);
  const status = statusLabel(message);
  const onBlocked = useCallback((n: number) => setBlockedImages(n), []);

  const mutate = useMutation({
    mutationFn: (body: { isRead?: boolean; isStarred?: boolean; trashed?: boolean }) => patch(`/api/messages/${message.id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.thread(thread.id) }),
  });
  const remove = useMutation({
    mutationFn: () => del(`/api/messages/${message.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.thread(thread.id) });
      void qc.invalidateQueries({ queryKey: ['threads'] });
      toast.success('Message moved to trash');
    },
  });
  const block = useMutation({
    mutationFn: () => post('/api/blocked', { pattern: message.fromAddr }),
    onSuccess: () => toast.success(`Blocked ${message.fromAddr}. Future mail goes to Spam.`),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not block sender'),
  });
  const alwaysShow = useMutation({
    mutationFn: () => post('/api/contacts', { email: message.fromAddr, name: message.fromName, alwaysShowImages: true }),
    onSuccess: () => {
      setShowImages(true);
      toast.success(`Images from ${message.fromAddr} will always show`);
    },
  });
  const unsubscribe = useMutation({
    mutationFn: () => post<{ method: string; ok: boolean; url?: string }>(`/api/messages/${message.id}/unsubscribe`),
    onSuccess: (data) => {
      if (data.method === 'link' && data.url) window.open(data.url, '_blank', 'noopener');
      else if (data.ok) toast.success('Unsubscribe request sent');
      else toast.error('The sender did not accept the unsubscribe request');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not unsubscribe'),
  });

  const attachments = message.attachments.filter((a) => a.disposition !== 'inline' || !message.htmlBody?.includes(`cid:${a.contentId ?? ''}`));

  if (message.isDraft) {
    return (
      <div className="border-b bg-warning/5 px-4 py-3 last:border-b-0">
        <button
          className="flex w-full items-center gap-3 text-left"
          onClick={() =>
            openCompose({
              id: `draft-${message.id}`,
              mode: 'draft',
              draftId: message.id,
              mailboxId: message.mailboxId,
              to: message.to,
              cc: message.cc,
              subject: message.subject,
              html: message.htmlBody ?? undefined,
              replyToMessageId: message.replyToMessageId,
              forwardOfMessageId: message.forwardOfMessageId,
              threadId: thread.id,
            })
          }
        >
          <FileText className="h-4 w-4 text-warning" />
          <span className="text-sm">
            <span className="font-medium text-danger">Draft</span> <span className="text-muted">— {message.snippet || 'Empty draft'}</span>
          </span>
          <span className="ml-auto text-xs text-muted">{formatListDate(message.updatedAt)}</span>
        </button>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button className="flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-[var(--hover)] last:border-b-0" onClick={onToggle}>
        <Avatar name={message.fromName} email={message.fromAddr} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-sm', !message.isRead && 'font-semibold')}>{isMine ? 'me' : fromName}</span>
            {status && status.tone !== 'muted' && <span className={cn('text-xs', `text-${status.tone}`)}>{status.label}</span>}
          </div>
          <div className="truncate text-xs text-muted">{message.snippet}</div>
        </div>
        {message.hasAttachments && <Paperclip className="h-4 w-4 text-faint" />}
        <span className="text-xs text-muted">{formatListDate(message.receivedAt)}</span>
      </button>
    );
  }

  return (
    <article className={cn('border-b last:border-b-0', !message.isRead && 'bg-surface')}>
      <header className="flex items-start gap-3 px-4 pt-3">
        <Avatar name={message.fromName} email={message.fromAddr} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <button className="truncate text-sm font-semibold hover:underline" onClick={onToggle}>
              {isMine ? 'me' : fromName}
            </button>
            {!isMine && <span className="truncate text-xs text-muted">&lt;{message.fromAddr}&gt;</span>}
            {message.authResults?.dmarc === 'pass' && (
              <Tooltip content="Sender authenticated (DMARC pass)">
                <ShieldCheck className="h-3.5 w-3.5 text-success" />
              </Tooltip>
            )}
            {message.authResults && (message.authResults.dmarc === 'fail' || (message.authResults.spf === 'fail' && message.authResults.dkim !== 'pass')) && (
              <Tooltip content="This message failed sender authentication — be careful with links and attachments.">
                <AlertTriangle className="h-3.5 w-3.5 text-warning" />
              </Tooltip>
            )}
          </div>
          <button className="mt-0.5 flex items-center gap-1 text-xs text-muted hover:text-text" onClick={() => setShowDetails((v) => !v)}>
            to {message.to.map((t) => (me?.mailboxes.some((m) => m.address === t.email) ? 'me' : t.name || t.email)).join(', ') || '—'}
            {message.cc.length > 0 && `, cc ${message.cc.length}`}
            <ChevronDown className={cn('h-3 w-3 transition-transform', showDetails && 'rotate-180')} />
          </button>
          {showDetails && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-surface-2 p-3 text-xs">
              <dt className="text-faint">from</dt>
              <dd>
                {message.fromName ? `${message.fromName} ` : ''}&lt;{message.fromAddr}&gt;
              </dd>
              <dt className="text-faint">to</dt>
              <dd>{message.to.map((t) => (t.name ? `${t.name} <${t.email}>` : t.email)).join(', ')}</dd>
              {message.cc.length > 0 && (
                <>
                  <dt className="text-faint">cc</dt>
                  <dd>{message.cc.map((t) => (t.name ? `${t.name} <${t.email}>` : t.email)).join(', ')}</dd>
                </>
              )}
              {message.replyTo && message.replyTo.length > 0 && (
                <>
                  <dt className="text-faint">reply-to</dt>
                  <dd>{message.replyTo.map((t) => t.email).join(', ')}</dd>
                </>
              )}
              <dt className="text-faint">date</dt>
              <dd>{formatFullDate(message.receivedAt)}</dd>
              {message.messageId && (
                <>
                  <dt className="text-faint">message-id</dt>
                  <dd className="break-all font-mono">{message.messageId}</dd>
                </>
              )}
              {message.authResults && (
                <>
                  <dt className="text-faint">auth</dt>
                  <dd>
                    SPF {message.authResults.spf ?? '—'} · DKIM {message.authResults.dkim ?? '—'} · DMARC {message.authResults.dmarc ?? '—'}
                  </dd>
                </>
              )}
              {message.listId && (
                <>
                  <dt className="text-faint">list</dt>
                  <dd className="break-all">{message.listId}</dd>
                </>
              )}
            </dl>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip content={formatFullDate(message.receivedAt)}>
            <span className="mr-1 hidden text-xs text-muted sm:inline">{formatListDate(message.receivedAt)}</span>
          </Tooltip>
          <IconButton label={message.isStarred ? 'Unstar' : 'Star'} size="sm" onClick={() => mutate.mutate({ isStarred: !message.isStarred })}>
            <Star className={cn('h-4 w-4', message.isStarred && 'text-warning')} fill={message.isStarred ? 'currentColor' : 'none'} />
          </IconButton>
          <IconButton label="Reply (r)" size="sm" onClick={() => onReply('reply')}>
            <Reply className="h-4 w-4" />
          </IconButton>
          <Menu>
            <MenuTrigger asChild>
              <button className="icon-btn h-7 w-7" aria-label="More options">
                <MoreVertical className="h-4 w-4" />
              </button>
            </MenuTrigger>
            <MenuContent align="end" className="w-60">
              <MenuItem onSelect={() => onReply('reply')} shortcut="r">
                <Reply className="h-4 w-4 text-muted" /> Reply
              </MenuItem>
              <MenuItem onSelect={() => onReply('reply_all')} shortcut="a">
                <ReplyAll className="h-4 w-4 text-muted" /> Reply all
              </MenuItem>
              <MenuItem onSelect={() => onReply('forward')} shortcut="f">
                <Forward className="h-4 w-4 text-muted" /> Forward
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => mutate.mutate({ isRead: !message.isRead })}>{message.isRead ? 'Mark as unread' : 'Mark as read'}</MenuItem>
              <MenuItem onSelect={() => window.open(`/api/messages/${message.id}/raw?inline=1`, '_blank', 'noopener')}>
                <ExternalLink className="h-4 w-4 text-muted" /> Show original
              </MenuItem>
              <MenuItem onSelect={() => downloadUrl(`/api/messages/${message.id}/raw`)}>
                <Download className="h-4 w-4 text-muted" /> Download .eml
              </MenuItem>
              <MenuItem onSelect={() => printMessage(message)}>
                <Printer className="h-4 w-4 text-muted" /> Print
              </MenuItem>
              {message.listUnsubscribe && (
                <MenuItem onSelect={() => unsubscribe.mutate()}>
                  <Ban className="h-4 w-4 text-muted" /> Unsubscribe
                </MenuItem>
              )}
              {!isMine && (
                <MenuItem onSelect={() => block.mutate()}>
                  <Ban className="h-4 w-4 text-muted" /> Block “{fromName}”
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem danger onSelect={() => remove.mutate()}>
                <Trash2 className="h-4 w-4" /> Delete this message
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </header>

      {status && (
        <div className={cn('mx-4 mt-3 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs', status.tone === 'danger' && 'bg-danger/10 text-danger', status.tone === 'warning' && 'bg-warning/10 text-warning', status.tone === 'success' && 'bg-success/10 text-success', status.tone === 'muted' && 'bg-surface-2 text-muted')}>
          <status.icon className="h-3.5 w-3.5" />
          <span className="flex-1">{status.label}</span>
          {(message.status === 'queued' || message.status === 'scheduled') && (
            <Button size="sm" variant="ghost" onClick={() => undo.mutate(message.id, { onSuccess: () => toast.success('Sending cancelled — saved as draft') })}>
              <Undo2 className="h-3.5 w-3.5" /> {message.status === 'scheduled' ? 'Cancel send' : 'Undo'}
            </Button>
          )}
        </div>
      )}

      {message.listUnsubscribe && message.direction === 'inbound' && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-muted">
          <span>This looks like a mailing list.</span>
          <button className="font-medium text-accent hover:underline" onClick={() => unsubscribe.mutate()} disabled={unsubscribe.isPending}>
            Unsubscribe
          </button>
        </div>
      )}

      {blockedImages > 0 && !showImages && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-muted">
          <ImageIcon className="h-3.5 w-3.5" />
          <span>Images are hidden to protect your privacy.</span>
          <button className="font-medium text-accent hover:underline" onClick={() => setShowImages(true)}>
            Show images
          </button>
          <button className="font-medium text-accent hover:underline" onClick={() => alwaysShow.mutate()}>
            Always show from {message.fromAddr}
          </button>
        </div>
      )}

      <div className="px-4 py-3">
        <EmailBody messageId={message.id} html={message.htmlBody} text={message.textBody} allowRemoteImages={showImages} onBlockedImages={onBlocked} />
      </div>

      {attachments.length > 0 && (
        <div className="px-4 pb-4">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted">
            <Paperclip className="h-3.5 w-3.5" />
            {attachments.length} attachment{attachments.length === 1 ? '' : 's'} · {formatBytes(attachments.reduce((n, a) => n + a.sizeBytes, 0))}
            <button className="ml-auto text-accent hover:underline" onClick={() => attachments.forEach((a) => downloadUrl(`${a.url}?download=1`, a.filename))}>
              Download all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {attachments.map((a) => (
              <AttachmentCard key={a.id} attachment={a} />
            ))}
          </div>
        </div>
      )}

      {isLast && (
        <div className="flex gap-2 px-4 pb-4">
          <Button variant="secondary" onClick={() => onReply('reply')}>
            <Reply className="h-4 w-4" /> Reply
          </Button>
          {message.to.length + message.cc.length > 1 && (
            <Button variant="secondary" onClick={() => onReply('reply_all')}>
              <ReplyAll className="h-4 w-4" /> Reply all
            </Button>
          )}
          <Button variant="secondary" onClick={() => onReply('forward')}>
            <Forward className="h-4 w-4" /> Forward
          </Button>
        </div>
      )}
    </article>
  );
}

export function AttachmentCard({ attachment, onRemove }: { attachment: { id: string; filename: string; contentType: string; sizeBytes: number; url?: string }; onRemove?: () => void }) {
  const isImage = attachment.contentType.startsWith('image/');
  const isPdf = attachment.contentType === 'application/pdf';
  const url = attachment.url ?? '';
  const [preview, setPreview] = useState(false);
  return (
    <>
      <div className="group/att relative flex w-56 items-center gap-3 overflow-hidden rounded-xl border bg-surface p-2 text-left transition-shadow hover:shadow">
        <button className="flex min-w-0 flex-1 items-center gap-3" onClick={() => (isImage || isPdf ? setPreview(true) : downloadUrl(`${url}?download=1`, attachment.filename))} disabled={!url}>
          {isImage && url ? (
            <img src={`${url}?inline=1`} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" loading="lazy" />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-muted">
              <FileText className="h-5 w-5" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{attachment.filename}</span>
            <span className="block text-xs text-muted">{formatBytes(attachment.sizeBytes)}</span>
          </span>
        </button>
        {onRemove ? (
          <IconButton label="Remove" size="sm" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        ) : (
          url && (
            <IconButton label="Download" size="sm" onClick={() => downloadUrl(`${url}?download=1`, attachment.filename)}>
              <Download className="h-3.5 w-3.5" />
            </IconButton>
          )
        )}
      </div>
      {preview && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black/85 fade-in" onClick={() => setPreview(false)}>
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="truncate text-sm">{attachment.filename}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); downloadUrl(`${url}?download=1`, attachment.filename); }}>
                <Download className="h-4 w-4" /> Download
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPreview(false)}>
                Close
              </Button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            {isImage ? <img src={`${url}?inline=1`} alt={attachment.filename} className="max-h-full max-w-full rounded-lg object-contain" /> : <iframe title={attachment.filename} src={`${url}?inline=1`} className="h-full w-full max-w-5xl rounded-lg bg-white" sandbox="" />}
          </div>
        </div>
      )}
    </>
  );
}

function printMessage(message: Message) {
  const w = window.open('', '_blank', 'noopener,width=800,height=900');
  if (!w) return;
  const body = message.htmlBody ? DOMPurify.sanitize(message.htmlBody, { FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'] }) : `<pre style="white-space:pre-wrap">${escapeHtml(message.textBody ?? '')}</pre>`;
  w.document.write(`<!doctype html><html><head><title>${escapeHtml(message.subject || '(no subject)')}</title><style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}h1{font-size:18px}dl{font-size:12px;color:#555;display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin-bottom:24px}img{max-width:100%}</style></head><body><h1>${escapeHtml(message.subject || '(no subject)')}</h1><dl><dt>From</dt><dd>${escapeHtml(message.fromName ? `${message.fromName} <${message.fromAddr}>` : message.fromAddr)}</dd><dt>To</dt><dd>${escapeHtml(message.to.map((t) => t.email).join(', '))}</dd><dt>Date</dt><dd>${escapeHtml(formatFullDate(message.receivedAt))}</dd></dl>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

