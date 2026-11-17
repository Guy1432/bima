import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="anim-fade fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        dir="rtl"
        className={cn(
          "anim-modal fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-popover p-6 shadow-2xl outline-none",
          className,
        )}
        {...props}
      >
        <div className="flex flex-col gap-1.5">
          <DialogPrimitive.Title className="text-lg font-semibold leading-none">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="text-sm text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
        </div>
        {children}
        <DialogPrimitive.Close className="absolute top-4 left-4 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100">
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DropdownMenu(props: React.ComponentProps<typeof Menu.Root>) {
  return <Menu.Root dir="rtl" {...props} />;
}
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={4}
        className={cn(
          "anim-pop origin-menu z-50 min-w-44 overflow-hidden rounded-lg border border-border bg-popover p-1 text-sm shadow-xl shadow-black/40",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof Menu.Item> & { destructive?: boolean }) {
  return (
    <Menu.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-muted-foreground",
        destructive && "text-red-400 data-[highlighted]:text-red-300 [&_svg]:text-red-400",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="-mx-1 my-1 h-px bg-border" />;
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)} {...props} />;
}

/* ---------------- context menu (right-click) - same look as the dropdown ---------------- */
import * as Ctx from "@radix-ui/react-context-menu";

export function ContextMenu(props: React.ComponentProps<typeof Ctx.Root>) {
  return <Ctx.Root dir="rtl" {...props} />;
}
export const ContextMenuTrigger = Ctx.Trigger;

export function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof Ctx.Content>) {
  return (
    <Ctx.Portal>
      <Ctx.Content
        className={cn(
          "anim-pop z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-popover p-1 text-sm shadow-xl shadow-black/40 [transform-origin:var(--radix-context-menu-content-transform-origin)]",
          className,
        )}
        {...props}
      />
    </Ctx.Portal>
  );
}

export function ContextMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof Ctx.Item> & { destructive?: boolean }) {
  return (
    <Ctx.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-muted-foreground",
        destructive && "text-red-400 data-[highlighted]:text-red-300 [&_svg]:text-red-400",
        className,
      )}
      {...props}
    />
  );
}

export function ContextMenuSeparator() {
  return <Ctx.Separator className="-mx-1 my-1 h-px bg-border" />;
}
