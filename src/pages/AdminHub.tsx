import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HardDrive, Landmark, Mail, ToggleLeft, UserCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/shell/ui';
import { cn } from '@/lib/utils';

function Card({ to, icon: Icon, title, sub, stat, tone }: {
  to: string; icon: React.ElementType; title: string; sub: string; stat?: string | null; tone: string;
}) {
  return (
    <Link to={to} className="flex flex-col gap-3.5 rounded-2xl border bg-card p-5 transition-all hover:border-orange-300 hover:shadow-card-hover">
      <span className={cn('inline-flex h-11 w-11 items-center justify-center rounded-xl', tone)}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-base font-bold">{title}</span>
        <span className="text-[13px] leading-relaxed text-muted-foreground">{sub}</span>
      </span>
      {stat && <span className="text-[13px] font-bold text-brand-soft-foreground">{stat}</span>}
    </Link>
  );
}

export default function AdminHub() {
  const { data: pendingRoles = 0 } = useQuery({
    queryKey: ['admin-pending-roles'],
    queryFn: async () => {
      const { count } = await supabase.from('user_roles').select('id', { count: 'exact', head: true }).eq('role_status', 'pending');
      return count ?? 0;
    },
  });

  // Same poll as the old sidebar badge: null means the inbox table isn't deployed.
  const { data: unread = 0 } = useQuery({
    queryKey: ['contact-messages-unread'],
    retry: false,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('contact_messages').select('id', { count: 'exact', head: true }).eq('status', 'new');
      if (error) {
        if (error.code === 'PGRST205') return null;
        throw error;
      }
      return count ?? 0;
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Admin" description="Who can get in, what they can see, and the company’s records." />
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
        <Card to="/users" icon={UserCheck} title="Users & sign-ups" sub="Approve new accounts, assign roles, link staff profiles"
          tone="bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
          stat={pendingRoles ? `${pendingRoles} waiting for approval` : null} />
        <Card to="/department-permissions" icon={ToggleLeft} title="Access control" sub="What each department and person can see and do"
          tone="bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" />
        <Card to="/bank-accounts" icon={Landmark} title="Bank accounts" sub="Company accounts used in the ledger"
          tone="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" />
        <Card to="/company-files" icon={HardDrive} title="Company files" sub="Policies, contracts and templates"
          tone="bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300" />
        <Card to="/messages" icon={Mail} title="Messages" sub="Enquiries from the public contact form"
          tone="bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
          stat={unread ? `${unread} new` : null} />
      </div>
    </div>
  );
}
