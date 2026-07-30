"use client";

import { useEffect, useState } from "react";

export const overlayExitDurationMs = 240;

export function usePresence(
  open: boolean,
  exitDurationMs = overlayExitDurationMs,
) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      let active = true;
      queueMicrotask(() => {
        if (active) setMounted(true);
      });
      return () => {
        active = false;
      };
    }

    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), exitDurationMs);
    return () => window.clearTimeout(timer);
  }, [exitDurationMs, mounted, open]);

  return {
    mounted,
    state: open ? "open" : "closing",
  } as const;
}
