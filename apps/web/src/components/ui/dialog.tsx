import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Native modal dialog, shown while mounted: the browser traps focus, focuses the first control,
 * closes on Escape and gives focus back. `onClose` runs once it is closed. A `sheet` sits at the
 * bottom of the screen with a close button, and its heading takes focus.
 */
export const Dialog = ({
  title,
  description,
  onClose,
  sheet,
  children,
}: {
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly onClose: () => void;
  readonly sheet: { readonly closeLabel: string } | null;
  readonly children: (close: () => void) => ReactNode;
}) => {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const focusHeading = sheet !== null;
  useEffect(() => {
    if (dialog === null || dialog.open) return;
    dialog.showModal();
    // Otherwise the browser focuses the first focusable element, or the one marked to start on.
    if (focusHeading) heading.current?.focus();
    else dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [dialog, focusHeading]);
  const close = (): void => {
    dialog?.close();
  };
  return (
    <dialog
      ref={setDialog}
      aria-labelledby={titleId}
      {...(description === null ? {} : { "aria-describedby": descriptionId })}
      onClose={onClose}
      className={cn(
        "bg-surface text-ink backdrop:bg-bg/80",
        sheet === null
          ? "m-auto w-[min(28rem,calc(100%-2rem))] rounded-card border border-hairline p-6"
          : "mx-auto mt-auto mb-0 max-h-[50dvh] w-full max-w-2xl overflow-y-auto rounded-t-card border border-b-0 border-hairline p-4 sm:p-6",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h2
          id={titleId}
          ref={heading}
          {...(sheet === null ? {} : { tabIndex: -1 })}
          className="min-w-0 text-subtitle"
        >
          {title}
        </h2>
        {sheet !== null && (
          <button
            type="button"
            aria-label={sheet.closeLabel}
            onClick={close}
            className="-mt-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control hover:bg-sunken"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        )}
      </div>
      {description !== null && (
        <p id={descriptionId} className="mt-2">
          {description}
        </p>
      )}
      {children(close)}
    </dialog>
  );
};
