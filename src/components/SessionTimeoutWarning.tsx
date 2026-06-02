import { useState, useEffect, useCallback } from "react";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ShieldAlert, LogOut } from "lucide-react";

const TIMEOUT_MS = 30 * 60 * 1000; // 30 min inactivity timeout
const WARNING_MS =  5 * 60 * 1000; // show warning 5 min before

function formatCountdown(ms: number) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export default function SessionTimeoutWarning() {
  const { user, signOut } = useAuth();
  const [open, setOpen]             = useState(false);
  const [remainingMs, setRemainingMs] = useState(WARNING_MS);

  const handleExpire = useCallback(async () => {
    setOpen(false);
    await signOut();
  }, [signOut]);

  const { resetTimer } = useSessionTimeout({
    timeoutMs: TIMEOUT_MS,
    warningMs: WARNING_MS,
    onWarn: (remaining) => {
      setRemainingMs(remaining);
      setOpen(true);
    },
    onExpire: handleExpire,
  });

  // Countdown ticker while warning is visible
  useEffect(() => {
    if (!open) return;
    const tick = setInterval(() => {
      setRemainingMs((prev) => {
        const next = prev - 1000;
        if (next <= 0) {
          clearInterval(tick);
          handleExpire();
        }
        return Math.max(0, next);
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [open, handleExpire]);

  const handleStayLoggedIn = () => {
    resetTimer();
    setOpen(false);
  };

  // Don't render if not logged in
  if (!user) return null;

  return (
    <AlertDialog open={open} onOpenChange={() => {}}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 shrink-0">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <AlertDialogTitle>Session Expiring</AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                You've been inactive for a while. For your security, you'll be
                automatically signed out in:
              </p>
              <div className="text-center">
                <span className="text-4xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {formatCountdown(remainingMs)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Any unsaved work may be lost.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={async () => { setOpen(false); await signOut(); }}
          >
            <LogOut className="h-4 w-4" />
            Sign out now
          </Button>
          <Button onClick={handleStayLoggedIn}>
            Stay logged in
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
