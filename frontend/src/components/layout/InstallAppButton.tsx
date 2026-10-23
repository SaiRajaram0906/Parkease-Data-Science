import { useState } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/use-install-prompt";

/**
 * Installs ParkEase like an app (home-screen icon, opens full screen).
 * On iPhone it explains Share → Add to Home Screen instead.
 */
export function InstallAppButton({ className, variant = "outline" }: { className?: string; variant?: "outline" | "ghost" | "default" }) {
  const { canInstall, showIOSHint, install } = useInstallPrompt();
  const [hint, setHint] = useState(false);
  if (canInstall) {
    return (
      <Button variant={variant} className={className} onClick={() => void install()}>
        <Download className="mr-2 h-4 w-4" /> Install app
      </Button>
    );
  }
  if (showIOSHint) {
    return (
      <div className={className}>
        <Button variant={variant} className="w-full" onClick={() => setHint((v) => !v)}>
          <Download className="mr-2 h-4 w-4" /> Install app
        </Button>
        {hint && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            Tap <Share className="h-3.5 w-3.5" /> Share in Safari, then <strong>Add to Home Screen</strong>.
          </p>
        )}
      </div>
    );
  }
  return null;
}
