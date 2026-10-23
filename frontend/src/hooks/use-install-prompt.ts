import { useEffect, useState } from "react";

/**
 * "Install app" support.
 *  - Chrome / Edge / Android: the browser fires `beforeinstallprompt`; we keep
 *    it and show our own Install button.
 *  - iPhone / iPad (Safari): there is no such event; the user installs with
 *    Share → Add to Home Screen, so we show that hint instead.
 */
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let saved: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    saved = e as InstallEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    saved = null;
    listeners.forEach((l) => l());
  });
}

const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const update = () => force((n) => n + 1);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const installed = standalone();
  return {
    installed,
    canInstall: !installed && saved !== null,
    showIOSHint: !installed && isIOS,
    install: async () => {
      if (!saved) return false;
      await saved.prompt();
      const choice = await saved.userChoice;
      saved = null;
      force((n) => n + 1);
      return choice.outcome === "accepted";
    },
  };
}
