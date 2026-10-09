import type { ErrorComponentProps } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

/** Error boundary of one module: the rest of the app stays usable. */
export const ModuleError = ({ error, reset }: ErrorComponentProps) => (
  <section role="alert" className="rounded-card border border-border-strong bg-surface p-6">
    <h1 className="text-title">This section failed to load</h1>
    <p className="mt-2 text-muted">{error instanceof Error ? error.message : String(error)}</p>
    <Button className="mt-4" onClick={reset}>
      Try again
    </Button>
  </section>
);
