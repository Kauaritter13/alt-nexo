/**
 * Componentes de UI no padrão shadcn/ui (Radix + Tailwind + cva), adaptados ao design system ALt..
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Dialog as D, DropdownMenu as DM, ContextMenu as CM, Tooltip as T, Switch as S, Popover as P, Slot } from 'radix-ui';
import { Check, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ───────── Button ─────────
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[13px] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4 cursor-default select-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent border border-border',
        ghost: 'hover:bg-accent text-muted-foreground hover:text-foreground',
        outline: 'border border-border bg-transparent hover:bg-accent',
        destructive: 'bg-destructive/90 text-white hover:bg-destructive',
        claude: 'bg-claude text-claude-foreground hover:bg-claude/90',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2.5 text-xs rounded-md',
        lg: 'h-10 px-5',
        icon: 'size-8',
        'icon-sm': 'size-7 rounded-md',
        'icon-xs': 'size-6 rounded-md [&_svg:not([class*=size-])]:size-3.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export const Button = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp: any = asChild ? Slot.Root : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';

// ───────── Inputs ─────────
export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-8 w-full min-w-0 rounded-lg border border-input bg-background/60 px-2.5 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-primary/15 disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full min-w-0 rounded-lg border border-input bg-background/60 px-2.5 py-2 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-primary/15 resize-none',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('text-[11px] font-medium uppercase tracking-wider text-muted-foreground', className)} {...props} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 w-full rounded-lg border border-input bg-background/60 px-2 text-[13px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15 [&>option]:bg-popover',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        'peer inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-transparent transition-colors outline-none data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className,
      )}
      {...props}
    >
      <S.Thumb className="pointer-events-none block size-3.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-0.5" />
    </S.Root>
  );
}

export function Badge({ className, tone = 'default', ...props }: React.ComponentProps<'span'> & { tone?: 'default' | 'success' | 'warning' | 'danger' | 'primary' | 'claude' }) {
  const tones = {
    default: 'bg-white/5 text-muted-foreground border-border',
    success: 'bg-success/10 text-success border-success/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    danger: 'bg-destructive/10 text-destructive border-destructive/20',
    primary: 'bg-primary/10 text-primary border-primary/20',
    claude: 'bg-claude/10 text-claude border-claude/20',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium', tones[tone], className)} {...props} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}

// ───────── Dialog ─────────
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description, ...props }: React.ComponentProps<typeof D.Content> & { title: string; description?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <D.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-auto rounded-2xl border border-border bg-popover p-5 shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <D.Title className="text-[15px] font-semibold">{title}</D.Title>
            {description ? <D.Description className="text-[12.5px] text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-4" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}

// ───────── Menus ─────────
const menuContent =
  'z-50 min-w-[200px] overflow-hidden rounded-xl border border-border bg-popover/95 p-1 text-popover-foreground shadow-2xl backdrop-blur-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95';
const menuItem =
  'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-muted-foreground';

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content sideOffset={sideOffset} className={cn(menuContent, className)} {...props} />
    </DM.Portal>
  );
}
export function DropdownMenuItem({ className, danger, ...props }: React.ComponentProps<typeof DM.Item> & { danger?: boolean }) {
  return <DM.Item className={cn(menuItem, danger && 'text-destructive [&_svg]:text-destructive', className)} {...props} />;
}
export function DropdownMenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-border" />;
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn('px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground', className)} {...props} />;
}
export const DropdownMenuSub = DM.Sub;
export function DropdownMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof DM.SubTrigger>) {
  return (
    <DM.SubTrigger className={cn(menuItem, 'data-[state=open]:bg-accent', className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" />
    </DM.SubTrigger>
  );
}
export function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DM.SubContent>) {
  return (
    <DM.Portal>
      <DM.SubContent className={cn(menuContent, className)} {...props} />
    </DM.Portal>
  );
}

export const ContextMenu = CM.Root;
export const ContextMenuTrigger = CM.Trigger;
export function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof CM.Content>) {
  return (
    <CM.Portal>
      <CM.Content className={cn(menuContent, className)} {...props} />
    </CM.Portal>
  );
}
export function ContextMenuItem({ className, danger, shortcut, children, ...props }: React.ComponentProps<typeof CM.Item> & { danger?: boolean; shortcut?: string }) {
  return (
    <CM.Item className={cn(menuItem, danger && 'text-destructive [&_svg]:text-destructive', className)} {...props}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-[11px] text-muted-foreground">{shortcut}</span>}
    </CM.Item>
  );
}
export function ContextMenuSeparator() {
  return <CM.Separator className="my-1 h-px bg-border" />;
}
export const ContextMenuSub = CM.Sub;
export function ContextMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof CM.SubTrigger>) {
  return (
    <CM.SubTrigger className={cn(menuItem, 'data-[state=open]:bg-accent', className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" />
    </CM.SubTrigger>
  );
}
export function ContextMenuSubContent({ className, ...props }: React.ComponentProps<typeof CM.SubContent>) {
  return (
    <CM.Portal>
      <CM.SubContent className={cn(menuContent, className)} {...props} />
    </CM.Portal>
  );
}
export function ContextMenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof CM.CheckboxItem>) {
  return (
    <CM.CheckboxItem className={cn(menuItem, 'pl-7', className)} {...props}>
      <CM.ItemIndicator className="absolute left-2">
        <Check />
      </CM.ItemIndicator>
      {children}
    </CM.CheckboxItem>
  );
}

// ───────── Tooltip / Popover ─────────
export const TooltipProvider = T.Provider;
export function Tooltip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-[60] rounded-md border border-border bg-popover px-2 py-1 text-[11.5px] text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content sideOffset={sideOffset} className={cn('z-50 rounded-xl border border-border bg-popover p-3 shadow-2xl outline-none animate-in fade-in-0 zoom-in-95', className)} {...props} />
    </P.Portal>
  );
}

// ───────── Misc ─────────
export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}

export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">{icon}</div>
      <div className="text-[14px] font-medium">{title}</div>
      {children && <div className="max-w-sm text-[12.5px] text-muted-foreground">{children}</div>}
    </div>
  );
}
