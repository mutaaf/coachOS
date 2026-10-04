"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

/**
 * A modal. On a phone it rises from the bottom as a sheet that scrolls inside
 * itself, with the title pinned at the top and the close button always in
 * reach; from `sm` up it is the usual centred card.
 *
 * Escape and a tap on the backdrop close it (through `onOpenChange`), and so
 * does the × in the corner, which DialogContent shows by itself. Pass
 * `hideClose` to DialogContent for a dialog that must be answered.
 *
 * Wrap a dialog's buttons in DialogFooter: on a phone it sticks to the bottom
 * of the sheet, so the primary action is reachable without scrolling.
 */

interface DialogContextValue {
  close: () => void;
  titleId: string;
  descriptionId: string;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

// Open dialogs, innermost last: Escape closes only the top one.
const openStack: symbol[] = [];

function Dialog({ open, onOpenChange, children }: DialogProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const close = React.useCallback(() => onOpenChangeRef.current(false), []);
  // Where a press on the overlay began: a drag that starts inside the dialog
  // (selecting text in a field) and ends outside it is not a tap on the backdrop.
  const pressStartedOnOverlay = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    const me = Symbol("dialog");
    openStack.push(me);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || openStack[openStack.length - 1] !== me) return;
      e.stopPropagation();
      close();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = openStack.indexOf(me);
      if (i >= 0) openStack.splice(i, 1);
      // Back to whatever opened it, if that is still on the page.
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open, close]);

  const value = React.useMemo(() => ({ close, titleId, descriptionId }), [close, titleId, descriptionId]);

  if (!open) return null;

  return (
    <DialogContext.Provider value={value}>
      <div className="fixed inset-0 z-50">
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in-0" aria-hidden />
        <div
          data-dialog-overlay
          className="fixed inset-0 flex items-end justify-center pt-[max(1rem,env(safe-area-inset-top))] sm:items-center sm:p-4"
          onPointerDown={(e) => {
            pressStartedOnOverlay.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && pressStartedOnOverlay.current) close();
            pressStartedOnOverlay.current = false;
          }}
        >
          {children}
        </div>
      </div>
    </DialogContext.Provider>
  );
}

const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { onClose?: () => void; hideClose?: boolean }
>(({ className, children, onClose, hideClose, ...props }, forwardedRef) => {
  const ctx = React.useContext(DialogContext);
  const close = onClose ?? ctx?.close;
  const innerRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLDivElement);

  // Focus the dialog itself rather than its first field, so a phone doesn't
  // throw the keyboard up over it the moment it opens.
  React.useEffect(() => {
    const el = innerRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={innerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ctx?.titleId}
      tabIndex={-1}
      className={cn(
        // Phone: a sheet from the bottom, as tall as it needs up to the top
        // inset, scrolling inside so the submit button is never out of reach.
        "relative z-50 w-full max-w-lg overflow-y-auto overscroll-contain bg-background shadow-xl outline-none",
        "max-h-[calc(100dvh-max(1rem,env(safe-area-inset-top)))] rounded-t-2xl px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        "animate-in fade-in-0 slide-in-from-bottom-8 duration-200",
        // sm and up: the centred card.
        "sm:max-h-[calc(100dvh-4rem)] sm:rounded-2xl sm:p-6 sm:slide-in-from-bottom-0 sm:zoom-in-95",
        className
      )}
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      {close && !hideClose && (
        // Zero-height and sticky: it rides at the top-right as the sheet
        // scrolls, without taking any room from the content.
        <div className="pointer-events-none sticky top-0 z-20 -mr-2 flex h-0 justify-end sm:-mr-3">
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            data-dialog-close
            className="pointer-events-auto -mt-2 flex h-10 w-10 items-center justify-center rounded-full bg-background/90 text-muted-foreground ring-offset-background transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:-mt-3"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      {children}
    </div>
  );
});
DialogContent.displayName = "DialogContent";

function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // Pinned to the top of the sheet while its body scrolls. The negative
        // margins pull it over the sheet's padding so nothing shows above it;
        // the negative top keeps it there (sticky measures from inside the
        // padding).
        "sticky -top-5 z-10 -mx-5 -mt-5 mb-1 flex flex-col space-y-1.5 bg-background px-5 pb-3 pr-14 pt-2 text-left",
        // On a phone, a grab handle above the title so it reads as a sheet.
        "before:mx-auto before:mb-2 before:block before:h-1 before:w-10 before:shrink-0 before:rounded-full before:bg-muted-foreground/25 before:content-['']",
        "sm:-top-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pr-14 sm:pt-6 sm:before:hidden",
        className
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  id,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  const ctx = React.useContext(DialogContext);
  return (
    <h2
      id={id ?? ctx?.titleId}
      className={cn("text-lg font-semibold leading-tight tracking-tight", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * A dialog's buttons. On a phone they stack full width, primary on top, and
 * stick to the bottom of the sheet; from `sm` up they sit in a row on the right.
 */
function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "sticky -bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-10 -mx-5 -mb-[max(1.25rem,env(safe-area-inset-bottom))] mt-4 flex flex-col-reverse gap-2 border-t bg-background px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3",
        "[&>*]:w-full sm:static sm:mx-0 sm:mb-0 sm:flex-row sm:flex-wrap sm:justify-end sm:border-0 sm:px-0 sm:pb-0 sm:pt-0 sm:[&>*]:w-auto",
        className
      )}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
