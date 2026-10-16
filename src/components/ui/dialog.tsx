import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Phone: a bottom sheet — full width, rising from the thumb's end of the
        // screen, never taller than the visual viewport (svh allows for browser
        // chrome) and clear of the home indicator. From sm up: the centred
        // dialog. Content scrolls inside instead of being clipped.
        "fixed inset-x-0 bottom-0 z-50 mx-auto grid w-full max-w-lg max-sm:max-w-none max-h-[92svh] overflow-y-auto overscroll-contain gap-4 rounded-t-3xl border-t bg-background px-5 pt-8 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-lg duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom sm:inset-x-auto sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border sm:p-6 sm:duration-200 sm:data-[state=closed]:fade-out-0 sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%] sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]",
        className,
      )}
      {...props}
    >
      <span aria-hidden className="absolute left-1/2 top-2.5 h-1.5 w-10 -translate-x-1/2 rounded-full bg-border sm:hidden" />
      {children}
      {/* 40×40 tap target (icon stays 16px) so the close control clears the
          44px-ish minimum without visually growing. */}
      <DialogPrimitive.Close className="absolute right-2 top-2 z-10 inline-flex h-10 w-10 items-center justify-center rounded-md bg-background/80 opacity-70 ring-offset-background transition-opacity data-[state=open]:text-muted-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none sm:right-3 sm:top-3">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

// pr-8 keeps the title clear of the absolutely-positioned close button instead
// of wrapping underneath it on narrow screens.
const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 pr-8 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

// gap-2 (not sm:space-x-2) so stacked mobile buttons are also separated.
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // On a phone the actions stick to the bottom of the sheet, so Save is in
      // reach however long the form is.
      "flex flex-col-reverse gap-2 [&>*]:w-full max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-5 max-sm:border-t max-sm:bg-background max-sm:px-5 max-sm:pt-3 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:-mb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:[&>*]:h-12 sm:flex-row sm:justify-end sm:[&>*]:w-auto",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
