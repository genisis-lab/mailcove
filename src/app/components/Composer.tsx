import { useQueryClient } from '@tanstack/react-query';
import type { Address } from '@shared/types';
import { ChevronDown, Clock, FileText, Maximize2, Minimize2, Minus, Paperclip, PenLine, Send, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useApp, type ComposeIntent } from '../lib/app-state';
import { useDeleteDraft, useSaveDraft, useSendMessage, useTemplates, useUndoSend, useUploadAttachment } from '../lib/queries';
import type { AttachmentMeta, Message, ThreadItem } from '../lib/types';
import { cn, formatBytes, formatFullDate } from '../lib/utils';
import { schedulePresets } from './ActionMenus';
import { Editor, type EditorHandle } from './Editor';
import { AttachmentCard } from './MessageItem';
import { RecipientInput } from './RecipientInput';
import { Button, Dialog, IconButton, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Select, Tooltip } from './ui';

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function quoteHtml(message: Message): string {
  const who = message.fromName ? `${escapeHtml(message.fromName)} &lt;${escapeHtml(message.fromAddr)}&gt;` : escapeHtml(message.fromAddr);
  const body = message.htmlBody ?? `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(message.textBody ?? '')}</pre>`;
  return `<p></p><div class="mc_quote"><div style="color:#666;font-size:12px">On ${escapeHtml(formatFullDate(message.receivedAt))}, ${who} wrote:</div><blockquote style="margin:0 0 0 0.8ex;border-left:2px solid #ccc;padding-left:1ex">${body}</blockquote></div>`;
}

function forwardHtml(message: Message): string {
  const line = (k: string, v: string) => `<div><b>${k}:</b> ${v}</div>`;
  const body = message.htmlBody ?? `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(message.textBody ?? '')}</pre>`;
  return `<p></p><div class="mc_forward"><div style="color:#666;font-size:12px">---------- Forwarded message ---------</div>${line('From', escapeHtml(message.fromName ? `${message.fromName} <${message.fromAddr}>` : message.fromAddr))}${line('Date', escapeHtml(formatFullDate(message.receivedAt)))}${line('Subject', escapeHtml(message.subject))}${line('To', escapeHtml(message.to.map((t) => t.email).join(', ')))}<br>${body}</div>`;
}

export type ComposeSeed = {
  mailboxId: string;
  fromAddress?: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  attachments: AttachmentMeta[];
  replyToMessageId: string | null;
  forwardOfMessageId: string | null;
  includeOriginalAttachments: boolean;
  sendMode: 'reply' | 'reply_all' | 'forward' | 'new';
  draftId: string | null;
};

export function seedFromMessage(mode: 'reply' | 'reply_all' | 'forward', message: Message, myAddresses: string[], signature: string | null, appendSignature: boolean): ComposeSeed {
  const mine = new Set(myAddresses);
  const replyTarget = message.replyTo?.length ? message.replyTo : [{ email: message.fromAddr, name: message.fromName }];
  const isMine = mine.has(message.fromAddr);
  const to = mode === 'forward' ? [] : isMine ? message.to : replyTarget;
  const cc = mode === 'reply_all' ? [...message.to, ...message.cc].filter((a) => !mine.has(a.email) && !to.some((t) => t.email === a.email)) : [];
  const subject = mode === 'forward' ? (/^\s*fwd?:/i.test(message.subject) ? message.subject : `Fwd: ${message.subject}`) : /^\s*re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`;
  const sig = appendSignature && signature ? `<p></p><div class="mc_signature">${signature}</div>` : '';
  const html = `<p></p>${sig}${mode === 'forward' ? forwardHtml(message) : quoteHtml(message)}`;
  return {
    mailboxId: message.mailboxId,
    to,
    cc,
    bcc: [],
    subject,
    html,
    attachments: [],
    replyToMessageId: mode === 'forward' ? null : message.id,
    forwardOfMessageId: mode === 'forward' ? message.id : null,
    includeOriginalAttachments: mode === 'forward' && message.hasAttachments,
    sendMode: mode,
    draftId: null,
  };
}

type FormProps = {
  seed: ComposeSeed;
  inline?: boolean;
  onClose: () => void;
  onSent?: () => void;
  onDraftId?: (id: string) => void;
  header?: ReactNode;
  autoFocusBody?: boolean;
};

export function ComposeForm({ seed, inline, onClose, onSent, onDraftId, header, autoFocusBody }: FormProps) {
  const { me, prefs } = useApp();
  const qc = useQueryClient();
  const send = useSendMessage();
  const saveDraft = useSaveDraft();
  const deleteDraft = useDeleteDraft();
  const undo = useUndoSend();
  const uploadMutation = useUploadAttachment();
  const templates = useTemplates();
  const editorRef = useRef<EditorHandle>(null);

  const mailboxes = useMemo(() => (me?.mailboxes ?? []).filter((m) => m.permission !== 'read_only' && !m.disabled), [me]);
  const [mailboxId, setMailboxId] = useState(seed.mailboxId || mailboxes[0]?.id || '');
  const [fromAddress, setFromAddress] = useState<string>(seed.fromAddress ?? '');
  const [to, setTo] = useState<Address[]>(seed.to);
  const [cc, setCc] = useState<Address[]>(seed.cc);
  const [bcc, setBcc] = useState<Address[]>(seed.bcc);
  const [showCc, setShowCc] = useState(seed.cc.length > 0);
  const [showBcc, setShowBcc] = useState(seed.bcc.length > 0);
  const [subject, setSubject] = useState(seed.subject);
  const [html, setHtml] = useState(seed.html);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>(seed.attachments);
  const [includeOriginal, setIncludeOriginal] = useState(seed.includeOriginalAttachments);
  const [draftId, setDraftId] = useState<string | null>(seed.draftId);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [customSchedule, setCustomSchedule] = useState('');
  const [dirty, setDirty] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mailbox = mailboxes.find((m) => m.id === mailboxId) ?? mailboxes[0];
  const maxAttachmentBytes = me?.settings.maxAttachmentBytes ?? 20 * 1024 * 1024;

  const payload = useCallback(
    () => ({
      mailboxId,
      fromAddress: fromAddress || undefined,
      to,
      cc,
      bcc,
      subject,
      html,
      uploadIds: attachments.map((a) => a.id),
      replyToMessageId: seed.replyToMessageId,
      forwardOfMessageId: seed.forwardOfMessageId,
      includeOriginalAttachments: includeOriginal,
      sendMode: seed.sendMode,
      draftId,
    }),
    [mailboxId, fromAddress, to, cc, bcc, subject, html, attachments, seed.replyToMessageId, seed.forwardOfMessageId, includeOriginal, seed.sendMode, draftId],
  );

  // Autosave two seconds after the last change.
  useEffect(() => {
    if (!dirty || !mailboxId) return;
    const t = setTimeout(() => {
      saveDraft.mutate(payload(), {
        onSuccess: (data) => {
          if (!draftId) {
            setDraftId(data.draft.id);
            onDraftId?.(data.draft.id);
          }
          setSavedAt(new Date());
          setDirty(false);
        },
      });
    }, 2000);
    return () => clearTimeout(t);
  }, [dirty, payload, mailboxId]); // eslint-disable-line react-hooks/exhaustive-deps

  const touch = () => setDirty(true);

  async function uploadFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (file.size > maxAttachmentBytes) {
        toast.error(`${file.name} is larger than ${formatBytes(maxAttachmentBytes)}`);
        continue;
      }
      try {
        const result = await uploadMutation.mutateAsync({ file });
        setAttachments((list) => [...list, { id: result.id, filename: result.filename, contentType: result.contentType, sizeBytes: result.sizeBytes, url: result.url }]);
        touch();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not upload ${file.name}`);
      }
    }
  }

  async function uploadInlineImage(file: File): Promise<string | null> {
    try {
      const result = await uploadMutation.mutateAsync({ file, inline: true });
      setAttachments((list) => [...list, { id: result.id, filename: result.filename, contentType: result.contentType, sizeBytes: result.sizeBytes, url: result.url, disposition: 'inline', contentId: result.contentId }]);
      touch();
      return result.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Image upload failed');
      return null;
    }
  }

  function doSend(scheduledAt?: Date) {
    if (!mailboxId) return toast.error('Choose a mailbox to send from.');
    if (to.length + cc.length + bcc.length === 0) return toast.error('Add at least one recipient.');
    if (!subject.trim() && !window.confirm('Send this message without a subject?')) return;
    const body = payload();
    send.mutate(
      { ...body, scheduledAt: scheduledAt ? scheduledAt.toISOString() : null },
      {
        onSuccess: (data) => {
          onSent?.();
          onClose();
          if (scheduledAt) {
            toast.success(`Scheduled for ${formatFullDate(scheduledAt)}`);
            return;
          }
          const undoMs = data.undoUntil ? Math.max(0, new Date(data.undoUntil).getTime() - Date.now()) : 0;
          toast.success('Message sent', {
            duration: undoMs > 0 ? undoMs : 4000,
            action:
              undoMs > 0
                ? {
                    label: 'Undo',
                    onClick: () =>
                      undo.mutate(data.message.id, {
                        onSuccess: () => toast.success('Sending cancelled — saved in Drafts'),
                        onError: () => toast.error('Too late — the message is already on its way'),
                      }),
                  }
                : undefined,
          });
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not send'),
      },
    );
  }

  function discard() {
    if (draftId) deleteDraft.mutate(draftId);
    onClose();
    void qc.invalidateQueries({ queryKey: ['threads'] });
  }

  function insertTemplate(t: { subject: string | null; bodyHtml: string }) {
    if (t.subject && !subject) setSubject(t.subject);
    editorRef.current?.insertHtml(t.bodyHtml);
    touch();
  }

  const aliases = mailbox?.aliases ?? [];
  const fromOptions = mailbox ? [mailbox.address, ...aliases] : [];

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col', dragOver && 'ring-2 ring-inset ring-accent')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
      }}
    >
      {header}
      <div className="px-3">
        {mailboxes.length > 1 || fromOptions.length > 1 ? (
          <div className="flex min-h-9 items-center gap-2 border-b py-1.5 text-sm">
            <span className="w-10 shrink-0 text-muted">From</span>
            <Select
              className="h-7 w-auto max-w-full border-0 bg-transparent px-0 py-0 text-sm shadow-none"
              value={fromAddress || mailbox?.address || ''}
              onChange={(e) => {
                const addr = e.target.value;
                const owner = mailboxes.find((m) => m.address === addr || m.aliases?.includes(addr));
                if (owner) setMailboxId(owner.id);
                setFromAddress(owner && owner.address === addr ? '' : addr);
                touch();
              }}
            >
              {mailboxes.flatMap((m) => [m.address, ...(m.aliases ?? [])].map((addr) => (
                <option key={addr} value={addr}>
                  {m.displayName ? `${m.displayName} <${addr}>` : addr}
                </option>
              )))}
            </Select>
          </div>
        ) : null}
        <RecipientInput
          label="To"
          value={to}
          onChange={(v) => {
            setTo(v);
            touch();
          }}
          autoFocus={!autoFocusBody && to.length === 0}
          placeholder="Recipients"
          trailing={
            <div className="flex shrink-0 gap-1 pt-1 text-xs text-muted">
              {!showCc && (
                <button type="button" className="hover:text-text" onClick={() => setShowCc(true)}>
                  Cc
                </button>
              )}
              {!showBcc && (
                <button type="button" className="hover:text-text" onClick={() => setShowBcc(true)}>
                  Bcc
                </button>
              )}
            </div>
          }
        />
        {showCc && (
          <RecipientInput
            label="Cc"
            value={cc}
            onChange={(v) => {
              setCc(v);
              touch();
            }}
          />
        )}
        {showBcc && (
          <RecipientInput
            label="Bcc"
            value={bcc}
            onChange={(v) => {
              setBcc(v);
              touch();
            }}
          />
        )}
        <div className="flex items-center border-b py-1.5">
          <input
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              touch();
            }}
            placeholder="Subject"
            className="w-full bg-transparent py-0.5 text-sm outline-none placeholder:text-faint"
            aria-label="Subject"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 px-3 pt-1">
        <Editor
          ref={editorRef}
          initialHtml={seed.html}
          onChange={(v) => {
            setHtml(v);
            touch();
          }}
          onImageUpload={uploadInlineImage}
          minHeight={inline ? 140 : 220}
          className="h-full"
          autoFocus={autoFocusBody}
          toolbarExtra={
            <div className="ml-auto flex items-center gap-1">
              {savedAt && !dirty && <span className="text-[11px] text-faint">Saved</span>}
              {dirty && <span className="text-[11px] text-faint">Saving…</span>}
            </div>
          }
        />
      </div>

      {(attachments.filter((a) => a.disposition !== 'inline').length > 0 || includeOriginal) && (
        <div className="flex flex-wrap gap-2 px-3 pb-2">
          {includeOriginal && (
            <span className="chip h-7 gap-2 text-xs">
              <Paperclip className="h-3 w-3" /> Original attachments included
              <button type="button" aria-label="Remove original attachments" onClick={() => setIncludeOriginal(false)}>
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {attachments
            .filter((a) => a.disposition !== 'inline')
            .map((a) => (
              <AttachmentCard
                key={a.id}
                attachment={a}
                onRemove={() => {
                  setAttachments((list) => list.filter((x) => x.id !== a.id));
                  touch();
                }}
              />
            ))}
        </div>
      )}

      <div className="flex items-center gap-1 border-t px-3 py-2">
        <div className="flex items-center rounded-full bg-accent text-accent-foreground shadow-sm">
          <Button variant="primary" className="rounded-l-full rounded-r-none pl-4 pr-3" onClick={() => doSend()} loading={send.isPending}>
            <Send className="h-4 w-4" /> Send
          </Button>
          <Menu open={scheduleOpen} onOpenChange={setScheduleOpen}>
            <MenuTrigger asChild>
              <button className="flex h-9 items-center rounded-r-full border-l border-white/25 px-2 hover:brightness-95" aria-label="Schedule send">
                <ChevronDown className="h-4 w-4" />
              </button>
            </MenuTrigger>
            <MenuContent className="w-72">
              <MenuLabel>Schedule send</MenuLabel>
              {schedulePresets().map((p) => (
                <MenuItem key={p.label} onSelect={() => doSend(p.when)}>
                  <Clock className="h-4 w-4 text-muted" />
                  <span className="flex-1">{p.label}</span>
                  <span className="text-xs text-faint">{p.when.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                </MenuItem>
              ))}
              <MenuSeparator />
              <div className="px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
                <div className="flex gap-2">
                  <Input type="datetime-local" value={customSchedule} onChange={(e) => setCustomSchedule(e.target.value)} className="h-8 text-xs" min={new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16)} />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!customSchedule}
                    onClick={() => {
                      const d = new Date(customSchedule);
                      if (!Number.isNaN(d.getTime())) {
                        setScheduleOpen(false);
                        doSend(d);
                      }
                    }}
                  >
                    Schedule
                  </Button>
                </div>
              </div>
            </MenuContent>
          </Menu>
        </div>
        <Tooltip content="Attach files">
          <button className="icon-btn" onClick={() => fileInput.current?.click()} aria-label="Attach files">
            <Paperclip className="h-4 w-4" />
          </button>
        </Tooltip>
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => e.target.files && void uploadFiles(e.target.files)} />
        {mailbox?.signatureHtml && (
          <Tooltip content="Insert signature">
            <button
              className="icon-btn"
              aria-label="Insert signature"
              onClick={() => {
                editorRef.current?.insertHtml(`<div class="mc_signature">${mailbox.signatureHtml}</div>`);
                touch();
              }}
            >
              <PenLine className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
        <Menu>
          <MenuTrigger asChild>
            <button className="icon-btn" aria-label="Templates">
              <FileText className="h-4 w-4" />
            </button>
          </MenuTrigger>
          <MenuContent className="w-64">
            <MenuLabel>Templates</MenuLabel>
            {(templates.data?.items ?? []).map((t) => (
              <MenuItem key={t.id} onSelect={() => insertTemplate(t)}>
                {t.name}
              </MenuItem>
            ))}
            {(templates.data?.items.length ?? 0) === 0 && <div className="px-2.5 py-2 text-xs text-faint">Create templates in Settings → Templates.</div>}
          </MenuContent>
        </Menu>
        {uploadMutation.isPending && <span className="text-xs text-muted">Uploading…</span>}
        <div className="ml-auto flex items-center gap-1">
          {inline && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Tooltip content="Discard draft">
            <button className="icon-btn" onClick={discard} aria-label="Discard draft">
              <Trash2 className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
      </div>
      {prefs.keyboardShortcuts !== false && <span className="sr-only">Press Ctrl+Enter to send</span>}
    </div>
  );
}

// --- Floating composer windows ------------------------------------------------

export function ComposerHost() {
  const { composers } = useApp();
  if (composers.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex items-end justify-end gap-3 px-3 sm:px-6">
      {composers.map((c) => (
        <ComposerWindow key={c.id} intent={c} />
      ))}
    </div>
  );
}

function ComposerWindow({ intent }: { intent: ComposeIntent }) {
  const { me, prefs, closeCompose, updateCompose } = useApp();
  const [closing, setClosing] = useState(false);
  const mailboxes = me?.mailboxes ?? [];
  const seed = useMemo<ComposeSeed>(() => {
    const defaultMailbox = mailboxes.find((m) => m.id === (intent.mailboxId ?? prefs.defaultMailboxId)) ?? mailboxes.find((m) => m.permission !== 'read_only');
    const signature = defaultMailbox?.signatureHtml ?? null;
    const base: ComposeSeed = {
      mailboxId: defaultMailbox?.id ?? '',
      to: intent.to ?? [],
      cc: intent.cc ?? [],
      bcc: [],
      subject: intent.subject ?? '',
      html: intent.html ?? (signature ? `<p></p><p></p><div class="mc_signature">${signature}</div>` : ''),
      attachments: [],
      replyToMessageId: intent.replyToMessageId ?? null,
      forwardOfMessageId: intent.forwardOfMessageId ?? null,
      includeOriginalAttachments: false,
      sendMode: intent.mode === 'draft' ? (intent.replyToMessageId ? 'reply' : intent.forwardOfMessageId ? 'forward' : 'new') : intent.mode === 'new' ? 'new' : intent.mode,
      draftId: intent.draftId ?? null,
    };
    return base;
  }, [intent.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = intent.subject?.trim() || 'New message';
  const maximized = intent.maximized ?? false;

  if (intent.minimized) {
    return (
      <div className="pointer-events-auto flex h-10 w-72 items-center gap-2 rounded-t-xl border bg-surface px-3 shadow-[var(--shadow-lg)]">
        <button className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => updateCompose(intent.id, { minimized: false })}>
          {title}
        </button>
        <IconButton label="Expand" size="sm" onClick={() => updateCompose(intent.id, { minimized: false })}>
          <Maximize2 className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="Close" size="sm" onClick={() => setClosing(true)}>
          <X className="h-3.5 w-3.5" />
        </IconButton>
        <CloseConfirm open={closing} onOpenChange={setClosing} onDiscard={() => closeCompose(intent.id)} onKeep={() => closeCompose(intent.id)} />
      </div>
    );
  }

  const windowEl = (
    <div
      className={cn(
        'pointer-events-auto flex flex-col overflow-hidden border bg-surface shadow-[var(--shadow-lg)]',
        maximized ? 'fixed inset-4 z-[60] rounded-2xl sm:inset-10' : 'h-[min(78vh,640px)] w-[min(100vw-1.5rem,560px)] rounded-t-2xl',
      )}
    >
      <ComposeForm
        seed={seed}
        onClose={() => closeCompose(intent.id)}
        onDraftId={(id) => updateCompose(intent.id, { draftId: id })}
        header={
          <div className="flex h-10 shrink-0 items-center gap-1 bg-surface-3 px-3">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
            <IconButton label="Minimize" size="sm" onClick={() => updateCompose(intent.id, { minimized: true })}>
              <Minus className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label={maximized ? 'Restore' : 'Maximize'} size="sm" onClick={() => updateCompose(intent.id, { maximized: !maximized })}>
              {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </IconButton>
            <IconButton label="Close (saves draft)" size="sm" onClick={() => closeCompose(intent.id)}>
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        }
      />
    </div>
  );

  if (maximized) {
    return (
      <>
        <div className="pointer-events-auto fixed inset-0 z-[59] bg-black/40" onClick={() => updateCompose(intent.id, { maximized: false })} />
        {windowEl}
      </>
    );
  }
  return windowEl;
}

function CloseConfirm({ open, onOpenChange, onDiscard, onKeep }: { open: boolean; onOpenChange: (o: boolean) => void; onDiscard: () => void; onKeep: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Close this message?"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
          <Button variant="primary" onClick={onKeep}>
            Keep draft
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">Your draft has been saved. You can find it in Drafts.</p>
    </Dialog>
  );
}

// --- Inline reply inside a conversation -----------------------------------------

export function InlineComposer({ mode, message, thread, onClose, onSent }: { mode: 'reply' | 'reply_all' | 'forward'; message: Message; thread: ThreadItem; onClose: () => void; onSent: () => void }) {
  const { me, prefs, openCompose } = useApp();
  const myAddresses = (me?.mailboxes ?? []).map((m) => m.address);
  const mailbox = me?.mailboxes.find((m) => m.id === message.mailboxId);
  const seed = useMemo(() => seedFromMessage(mode, message, myAddresses, mailbox?.signatureHtml ?? null, prefs.signatureOnReply !== false), [mode, message.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draftId, setDraftId] = useState<string | null>(null);
  return (
    <div className="border-t bg-surface-2/40 p-3 fade-in">
      <div className="flex min-h-[380px] flex-col rounded-xl border bg-surface shadow-sm">
        <ComposeForm
          seed={seed}
          inline
          autoFocusBody
          onClose={onClose}
          onSent={onSent}
          onDraftId={setDraftId}
          header={
            <div className="flex h-9 items-center justify-between px-3 text-xs text-muted">
              <span>
                {mode === 'forward' ? 'Forwarding' : mode === 'reply_all' ? 'Replying to all' : 'Replying'} · {thread.subject || '(no subject)'}
              </span>
              <button
                className="hover:text-text"
                onClick={() => {
                  openCompose({
                    mode: 'draft',
                    mailboxId: seed.mailboxId,
                    to: seed.to,
                    cc: seed.cc,
                    subject: seed.subject,
                    html: seed.html,
                    replyToMessageId: seed.replyToMessageId,
                    forwardOfMessageId: seed.forwardOfMessageId,
                    draftId,
                    threadId: thread.id,
                  });
                  onClose();
                }}
              >
                Pop out ↗
              </button>
            </div>
          }
        />
      </div>
    </div>
  );
}

export function useComposeFromMessage() {
  const { me, prefs, openCompose } = useApp();
  return useCallback(
    (mode: 'reply' | 'reply_all' | 'forward', message: Message) => {
      const myAddresses = (me?.mailboxes ?? []).map((m) => m.address);
      const mailbox = me?.mailboxes.find((m) => m.id === message.mailboxId);
      const seed = seedFromMessage(mode, message, myAddresses, mailbox?.signatureHtml ?? null, prefs.signatureOnReply !== false);
      openCompose({ mode, mailboxId: seed.mailboxId, to: seed.to, cc: seed.cc, subject: seed.subject, html: seed.html, replyToMessageId: seed.replyToMessageId, forwardOfMessageId: seed.forwardOfMessageId, threadId: message.threadId });
    },
    [me, prefs.signatureOnReply, openCompose],
  );
}

