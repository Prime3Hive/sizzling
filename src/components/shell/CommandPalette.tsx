import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, Plus } from 'lucide-react';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { useStaffDirectory, positionLabel } from '@/hooks/useStaffDirectory';
import { startTour } from './tourSteps';
import { HELP, HOME, INBOX, visibleTabs, visibleWorkspaces } from './navigation';
import { useNavAccess } from './useNavAccess';
import { InitialsAvatar } from './ui';

const OPEN_EVENT = 'sizzling:open-search';

/** Open the search palette from anywhere (buttons, the phone's top bar). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const access = useNavAccess();
  const { data: people = [] } = useStaffDirectory();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const pages = useMemo(() => {
    const list: { label: string; hint: string; to: string; keywords?: string }[] = [
      { label: HOME.label, hint: 'Your dashboard', to: HOME.to },
    ];
    if (!access.isPending) list.push({ label: INBOX.label, hint: 'Approvals and your requests', to: INBOX.to, keywords: 'approvals requests' });
    for (const ws of visibleWorkspaces(access)) {
      for (const tab of visibleTabs(ws, access)) {
        list.push({
          label: tab.label === 'Overview' ? ws.label : `${ws.label} · ${tab.label}`,
          hint: tab.label === 'Overview' ? ws.description : ws.label,
          to: tab.to,
          keywords: tab.keywords,
        });
      }
    }
    list.push({ label: HELP.label, hint: 'How to use the portal', to: HELP.to, keywords: 'help guide documentation how to manual faq' });
    return list;
  }, [access]);

  const actions = useMemo(() => {
    const approved = !access.isPending && (access.isAdmin || access.isManager || access.isHR || access.isEmployee);
    const list: { label: string; to: string }[] = [];
    if (access.hasPermission('budgets', 'create')) list.push({ label: 'New expense', to: '/expenses?new=1' });
    if (approved) {
      list.push({ label: 'Request leave', to: '/staff-portal?tab=leave' });
      list.push({ label: 'Submit a daily report or expense claim', to: '/staff-portal?tab=reports' });
      list.push({ label: 'Request stock', to: '/business/inventory-requests' });
    }
    if (access.isAdmin || access.isHR) list.push({ label: 'Add staff', to: '/staff-profiles?new=1' });
    return list;
  }, [access]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages, people and actions…" />
      <CommandList className="max-h-[min(440px,60svh)]">
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Go to">
          {pages.map((p) => (
            <CommandItem key={p.to + p.label} value={`${p.label} ${p.hint} ${p.keywords ?? ''}`} onSelect={() => go(p.to)}>
              <span className="flex-1 font-semibold">{p.label}</span>
              <span className="text-xs text-muted-foreground">{p.hint}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {actions.length > 0 && (
          <CommandGroup heading="Actions">
            {actions.map((a) => (
              <CommandItem key={a.label} value={`action ${a.label}`} onSelect={() => go(a.to)}>
                <Plus className="mr-2 text-brand" aria-hidden />
                <span className="font-semibold">{a.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Help">
          <CommandItem value="take the tour walkthrough guide show me around" onSelect={() => { setOpen(false); startTour(); }}>
            <Compass className="mr-2 text-brand" aria-hidden />
            <span className="font-semibold">Take the tour</span>
          </CommandItem>
        </CommandGroup>
        {people.length > 0 && (
          <CommandGroup heading="People">
            {people.map((p) => (
              <CommandItem
                key={p.id}
                value={`person ${p.full_name} ${p.position ?? ''} ${p.departments?.name ?? ''}`}
                onSelect={() => go(`/people?person=${p.id}`)}
              >
                <InitialsAvatar name={p.full_name} size={28} className="mr-2.5" />
                <span className="flex-1 font-semibold">{p.full_name}</span>
                <span className="text-xs text-muted-foreground">
                  {positionLabel(p.position)}{p.departments?.name ? ` · ${p.departments.name}` : ''}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="hidden border-t bg-muted/50 px-4 py-2.5 text-xs text-muted-foreground sm:block">
        Press <kbd className="rounded border bg-card px-1.5 py-0.5 font-semibold">Ctrl</kbd>{' '}
        <kbd className="rounded border bg-card px-1.5 py-0.5 font-semibold">K</kbd> on any page to open this.
      </div>
    </CommandDialog>
  );
}
