import { Color } from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Code, Eraser, Italic, Link2, List, ListOrdered, Quote, Redo2, Strikethrough, Underline as UnderlineIcon, Undo2 } from 'lucide-react';
import { useEffect, useImperativeHandle, useRef, useState, forwardRef, type ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Button, Input, Popover, PopoverContent, PopoverTrigger, Tooltip } from './ui';

export type EditorHandle = {
  editor: TiptapEditor | null;
  insertHtml: (html: string) => void;
  setContent: (html: string) => void;
  getHtml: () => string;
  getText: () => string;
  focus: () => void;
};

type Props = {
  initialHtml?: string;
  placeholder?: string;
  onChange?: (html: string) => void;
  onImageUpload?: (file: File) => Promise<string | null>;
  className?: string;
  minHeight?: number;
  toolbarExtra?: ReactNode;
  autoFocus?: boolean;
};

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ initialHtml, placeholder, onChange, onImageUpload, className, minHeight = 180, toolbarExtra, autoFocus }, ref) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, underline: false }),
      Underline,
      TextStyle,
      Color,
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write your message…' }),
    ],
    content: initialHtml ?? '',
    autofocus: autoFocus ? 'start' : false,
    editorProps: {
      attributes: { class: 'prose-mail tiptap px-1 py-2 text-sm', style: `min-height:${minHeight}px` },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (files.length && onImageUpload) {
          event.preventDefault();
          for (const f of files) void insertImage(f);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (files.length && onImageUpload) {
          event.preventDefault();
          for (const f of files) void insertImage(f);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
  });

  async function insertImage(file: File) {
    if (!onImageUpload || !editor) return;
    const url = await onImageUpload(file);
    if (url) editor.chain().focus().setImage({ src: url, alt: file.name }).run();
  }

  useImperativeHandle(
    ref,
    () => ({
      editor,
      insertHtml: (html) => editor?.chain().focus().insertContent(html).run(),
      setContent: (html) => editor?.commands.setContent(html, { emitUpdate: true }),
      getHtml: () => editor?.getHTML() ?? '',
      getText: () => editor?.getText() ?? '',
      focus: () => editor?.commands.focus('end'),
    }),
    [editor],
  );

  useEffect(() => () => editor?.destroy(), [editor]);

  if (!editor) return null;

  const btn = (label: string, active: boolean, onClick: () => void, icon: ReactNode) => (
    <Tooltip content={label}>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cn('icon-btn h-7 w-7 rounded-md', active && 'bg-accent/15 text-accent')} aria-label={label} aria-pressed={active}>
        {icon}
      </button>
    </Tooltip>
  );

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
      <div className="flex flex-wrap items-center gap-0.5 border-t pt-1.5">
        {btn('Undo', false, () => editor.chain().focus().undo().run(), <Undo2 className="h-4 w-4" />)}
        {btn('Redo', false, () => editor.chain().focus().redo().run(), <Redo2 className="h-4 w-4" />)}
        <span className="mx-1 h-4 w-px bg-border" />
        {btn('Bold', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold className="h-4 w-4" />)}
        {btn('Italic', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic className="h-4 w-4" />)}
        {btn('Underline', editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), <UnderlineIcon className="h-4 w-4" />)}
        {btn('Strikethrough', editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), <Strikethrough className="h-4 w-4" />)}
        <span className="mx-1 h-4 w-px bg-border" />
        {btn('Bulleted list', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), <List className="h-4 w-4" />)}
        {btn('Numbered list', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered className="h-4 w-4" />)}
        {btn('Quote', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), <Quote className="h-4 w-4" />)}
        {btn('Code', editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run(), <Code className="h-4 w-4" />)}
        <Popover
          open={linkOpen}
          onOpenChange={(o) => {
            setLinkOpen(o);
            if (o) setLinkUrl(editor.getAttributes('link').href ?? '');
          }}
        >
          <PopoverTrigger asChild>
            <button type="button" onMouseDown={(e) => e.preventDefault()} className={cn('icon-btn h-7 w-7 rounded-md', editor.isActive('link') && 'bg-accent/15 text-accent')} aria-label="Insert link">
              <Link2 className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!linkUrl) editor.chain().focus().extendMarkRange('link').unsetLink().run();
                else editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run();
                setLinkOpen(false);
              }}
            >
              <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" autoFocus className="h-8 text-xs" />
              <Button type="submit" size="sm" variant="primary">
                Apply
              </Button>
            </form>
          </PopoverContent>
        </Popover>
        {onImageUpload && (
          <>
            {btn('Insert image', false, () => fileInput.current?.click(), <ImageGlyph />)}
            <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files && Array.from(e.target.files).forEach((f) => void insertImage(f))} />
          </>
        )}
        {btn('Clear formatting', false, () => editor.chain().focus().clearNodes().unsetAllMarks().run(), <Eraser className="h-4 w-4" />)}
        {toolbarExtra}
      </div>
    </div>
  );
});

function ImageGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </svg>
  );
}
