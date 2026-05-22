import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';

export default function PendingApproval() {
  const { signOut } = useAuth();
  const { userRole, isAdmin, isHR, isManager, isEmployee, refetchRole } = useRoles();
  const navigate = useNavigate();

  // Redirect as soon as the role is approved
  useEffect(() => {
    if (isAdmin || isHR || isManager || isEmployee) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAdmin, isHR, isManager, isEmployee, navigate]);

  // Poll every 30 s so approval is reflected without a manual refresh
  useEffect(() => {
    const id = setInterval(refetchRole, 30_000);
    return () => clearInterval(id);
  }, [refetchRole]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full space-y-8 text-center">

        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-warning/10 border border-warning/20 flex items-center justify-center">
            <Clock className="w-10 h-10 text-warning" />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl font-bold tracking-tight">Awaiting Approval</h1>
          <p className="text-muted-foreground leading-relaxed">
            Your{' '}
            <span className="font-semibold capitalize text-foreground">
              {userRole?.role ?? 'role'}
            </span>{' '}
            access has been submitted and is pending administrator approval.
            This page will update automatically once approved.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-4 flex gap-3 text-left">
          <Mail className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            Contact your system administrator to approve your access request, or
            wait — this page refreshes automatically every 30 seconds.
          </p>
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={handleSignOut}
        >
          Sign Out
        </Button>

      </div>
    </div>
  );
}
