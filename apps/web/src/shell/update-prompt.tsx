import { useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";

/** Offers a new version instead of reloading, so a review session is never cut. */
export const UpdatePrompt = () => {
  const [failure, setFailure] = useState<string | null>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (error: unknown) => {
      setFailure(String(error));
    },
  });

  if (failure !== null) {
    return (
      <p role="status" className="mb-6 rounded-card border border-border-strong bg-surface p-4">
        Offline mode is unavailable: {failure}
      </p>
    );
  }
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-card border border-border-strong bg-surface p-4"
    >
      <p className="flex-1">A new version of OpenLinguo is available.</p>
      <Button onClick={() => void updateServiceWorker(true)}>Reload</Button>
      <Button
        variant="ghost"
        onClick={() => {
          setNeedRefresh(false);
        }}
      >
        Later
      </Button>
    </div>
  );
};
