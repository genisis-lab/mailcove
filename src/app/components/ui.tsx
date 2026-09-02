import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn, colorFor, initialsOf, readableTextColor } from '../lib/utils';

// --- Buttons -------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = 'secondary', size = 'md', loading, children, disabled, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn('btn', `btn-${variant}`, size === 'sm' && 'h-7 px-2.5 text-xs', size === 'md' && 'h-9', size === 'lg' && 'h-11 px-5 text-base', className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
});

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ className, label, size = 'md', children, ...props }, ref) {
  return (
    <Tooltip content={label}>
      <button ref={ref} aria-label={label} className={cn('icon-btn', size === 'sm' && 'h-7 w-7', className)} {...props}>
        {children}
      </button>
    </Tooltip>
  );
});

// --- Inputs --------------------------------------------------------------------

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn('input', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn('input min-h-24', className)} {...props} />;
});

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('input appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ checked, onCheckedChange, className, label, indeterminate }: { checked: boolean; onCheckedChange: (v: boolean) => void; className?: string; label?: string; indeterminate?: boolean }) {
  return (
    <CheckboxPrimitive.Root
      checked={indeterminate ? 'indeterminate' : checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      aria-label={label}
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent',
        'border-border-strong bg-surface',
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <CheckboxPrimitive.Indicator className="text-accent-foreground">
        {indeterminate ? <span className="block h-0.5 w-2 rounded bg-current" /> : <Check className="h-3 w-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch({ checked, onCheckedChange, disabled, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-5 w-9 shrink-0 rounded-full bg-border-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}

// --- Overlays ------------------------------------------------------------------

export function Tooltip({ content, children, side = 'bottom' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <TooltipPrimitive.Root delayDuration={400}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="z-[70] rounded-md bg-text px-2 py-1 text-xs text-bg shadow fade-in">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: { open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] fade-in" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[61] max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border bg-surface p-5 shadow-[var(--shadow-lg)] fade-in',
            size === 'sm' && 'max-w-sm',
            size === 'md' && 'max-w-md',
            size === 'lg' && 'max-w-2xl',
            size === 'xl' && 'max-w-4xl',
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="icon-btn -mr-2 -mt-1" aria-label="Close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          {children}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;
export const MenuSub = DropdownPrimitive.Sub;

export function MenuContent({ children, align = 'start', className, sideOffset = 6 }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string; sideOffset?: number }) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content align={align} sideOffset={sideOffset} className={cn('menu fade-in max-h-[70vh] overflow-auto', className)} onCloseAutoFocus={(e) => e.preventDefault()}>
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function MenuSubContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.SubContent sideOffset={4} className={cn('menu fade-in max-h-[60vh] overflow-auto', className)}>
        {children}
      </DropdownPrimitive.SubContent>
    </DropdownPrimitive.Portal>
  );
}

export function MenuSubTrigger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <DropdownPrimitive.SubTrigger className={cn('menu-item justify-between', className)}>
      {children}
      <ChevronRight className="h-3.5 w-3.5 text-faint" />
    </DropdownPrimitive.SubTrigger>
  );
}

export function MenuItem({ children, onSelect, className, danger, disabled, shortcut }: { children: ReactNode; onSelect?: () => void; className?: string; danger?: boolean; disabled?: boolean; shortcut?: string }) {
  return (
    <DropdownPrimitive.Item className={cn('menu-item', danger && 'text-danger', className)} onSelect={onSelect} disabled={disabled}>
      <span className="flex flex-1 items-center gap-2.5">{children}</span>
      {shortcut && <span className="kbd ml-4">{shortcut}</span>}
    </DropdownPrimitive.Item>
  );
}

export function MenuCheckboxItem({ children, checked, onCheckedChange }: { children: ReactNode; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <DropdownPrimitive.CheckboxItem className="menu-item" checked={checked} onCheckedChange={onCheckedChange} onSelect={(e) => e.preventDefault()}>
      <span className={cn('flex h-4 w-4 items-center justify-center rounded border border-border-strong', checked && 'border-accent bg-accent text-accent-foreground')}>
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
}

export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownPrimitive.Label className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{children}</DropdownPrimitive.Label>;
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({ children, className, align = 'start', sideOffset = 6, onOpenAutoFocus }: { children: ReactNode; className?: string; align?: 'start' | 'end' | 'center'; sideOffset?: number; onOpenAutoFocus?: (e: Event) => void }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={sideOffset} onOpenAutoFocus={onOpenAutoFocus} className={cn('menu fade-in w-72 p-3', className)}>
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export const Tabs = TabsPrimitive.Root;
export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <TabsPrimitive.List className={cn('flex gap-1 border-b', className)}>{children}</TabsPrimitive.List>;
}
export function TabsTrigger({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn('-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted transition-colors hover:text-text data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-text', className)}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}
export const TabsContent = TabsPrimitive.Content;

// --- Display -------------------------------------------------------------------

export function Avatar({ name, email, src, size = 32, className }: { name?: string | null; email: string; src?: string | null; size?: number; className?: string }) {
  const seed = email || name || '?';
  const label = name || email;
  if (src) return <img src={src} alt={label} width={size} height={size} className={cn('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />;
  const bg = colorFor(seed);
  return (
    <span
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold', className)}
      style={{ width: size, height: size, background: bg, color: readableTextColor(bg), fontSize: Math.max(10, Math.round(size * 0.4)) }}
      title={label}
    >
      {initialsOf(label)}
    </span>
  );
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  if (color) {
    return (
      <span className={cn('label-pill', className)} style={{ background: color, color: readableTextColor(color) }}>
        {children}
      </span>
    );
  }
  return <span className={cn('label-pill bg-surface-3 text-muted', className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-muted', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-60 flex-col items-center justify-center gap-2 p-8 text-center fade-in">
      {icon && <div className="mb-1 text-faint [&>svg]:h-10 [&>svg]:w-10">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function SectionCard({ title, description, children, actions, className }: { title?: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cn('card p-5', className)}>
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', danger, onConfirm, loading }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; loading?: boolean }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
