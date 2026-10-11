import { useEffect, useId, useState, type ReactNode } from "react";

/**
 * Native modal dialog, shown while mounted: the browser traps focus, focuses the first control,
 * closes on Escape and gives focus back. `onClose` runs once it is closed.
 */
export const Dialog = ({
  title,
  description,
  onClose,
  children,
}: {
  readonly title: string;
  readonly description: string | null;
  readonly onClose: () => void;
  readonly children: (close: () => void) => ReactNode;
}) => {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, [dialog]);
  return (
    <dialog
      ref={setDialog}
      aria-labelledby={titleId}
      {...(description === null ? {} : { "aria-describedby": descriptionId })}
      onClose={onClose}
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-card border border-hairline bg-surface p-6 text-ink backdrop:bg-bg/80"
    >
      <h2 id={titleId} className="text-subtitle">
        {title}
      </h2>
      {description !== null && (
        <p id={descriptionId} className="mt-2">
          {description}
        </p>
      )}
      {children(() => {
        dialog?.close();
      })}
    </dialog>
  );
};
