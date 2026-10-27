import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import {
  ArrowLeft, ChevronRight, Compass, LayoutGrid, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, Sun,
  UserRound, WifiOff,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBirthdayNotifications } from '@/hooks/useBirthdayNotifications';
import { useInbox } from '@/hooks/useInbox';
import NotificationBell from '@/components/NotificationBell';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePrefetchOnIntent } from '@/lib/prefetch';
import { pushRecent } from '@/lib/recentPages';
import CommandPalette, { openCommandPalette } from './CommandPalette';
import CreateSheet from './CreateSheet';
import Tour from './Tour';
import { startTour } from './tourSteps';
import {
  HELP, HOME, INBOX, WORKSPACES, landingOf, locate, visibleTabs, visibleWorkspaces,
  type NavAccess,
} from './navigation';
import { useMe, useNavAccess } from './useNavAccess';
import { InitialsAvatar } from './ui';

// ── Pieces ───────────────────────────────────────────────────────────────────

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white"
      style={{ width: size, height: size }}
    >
      <img src="/favicon.png" alt="" className="h-full w-full object-contain p-0.5" />
    </span>
  );
}

function useInboxBadge(access: NavAccess) {
  const { canApproveAnything, waiting, myPending } = useInbox();
  if (access.isPending) return 0;
  return canApproveAnything ? waiting.length : myPending.length;
}

function Badge({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span className={cn(
      'inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-chilli px-1.5 text-xs font-bold tabular-nums text-white',
      className,
    )}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

// ── Sidebar width ────────────────────────────────────────────────────────────
// The desktop sidebar folds down to an icon rail. The choice is remembered per
// browser; until someone chooses, narrower laptops (under 1280px) start folded
// so the page gets the room.

const SIDEBAR_KEY = 'sidebar-collapsed';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_KEY);
      if (saved !== null) return saved === '1';
    } catch { /* storage blocked: fall through to the default */ }
    return typeof window !== 'undefined' && window.innerWidth < 1280;
  });

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch { /* not remembered */ }
      return next;
    });
  }, []);

  // Ctrl/⌘ + B, except while typing (where it may mean bold).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b' && !isTyping(e.target)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return [collapsed, toggle] as const;
}

/** In the folded rail, a control's name moves into a tooltip. */
function RailTip({ show, label, children }: { show: boolean; label: React.ReactNode; children: React.ReactElement }) {
  if (!show) return children;
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>{label}</TooltipContent>
    </Tooltip>
  );
}

function SidebarLink({ to, icon: Icon, label, active, badge, tour, collapsed = false }: {
  to: string; icon: React.ElementType; label: string; active: boolean; badge?: number;
  /** Walkthrough anchor, see tourSteps.ts. */
  tour?: string;
  collapsed?: boolean;
}) {
  return (
    <RailTip show={collapsed} label={badge ? `${label} (${badge})` : label}>
      <Link
        to={to}
        data-tour={tour}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? (badge ? `${label}, ${badge} waiting` : label) : undefined}
        className={cn(
          'relative flex h-10 items-center rounded-[10px] text-sm transition-colors',
          collapsed ? 'w-10 justify-center self-center' : 'gap-3 px-3',
          active
            ? 'bg-brand-soft font-bold text-brand-soft-foreground'
            : 'font-medium text-foreground/75 hover:bg-accent hover:text-foreground',
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
        {!collapsed && <span className="flex-1 truncate">{label}</span>}
        {badge ? (
          collapsed
            ? <Badge n={badge} className="absolute -right-1.5 -top-1.5 h-[18px] min-w-[18px] px-1 text-[10.5px] ring-2 ring-card" />
            : <Badge n={badge} />
        ) : null}
      </Link>
    </RailTip>
  );
}

function SectionLabel({ children, collapsed = false }: { children: React.ReactNode; collapsed?: boolean }) {
  // Folded, the heading becomes a hairline so groups still read as groups.
  if (collapsed) return <div role="separator" aria-hidden className="mx-auto my-3 h-px w-6 bg-border" />;
  return (
    <div className="px-3 pb-1.5 pt-5 text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </div>
  );
}

function UserMenu({ compact, rail }: { compact?: boolean; /** Avatar only, inside the folded sidebar. */ rail?: boolean }) {
  const me = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === 'dark';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-tour={compact ? undefined : 'account'}
        className={cn(
          'flex items-center gap-2.5 rounded-[10px] text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
          compact || rail ? 'p-1' : 'w-full p-2',
          rail && 'self-center',
        )}
        aria-label="Account menu"
      >
        <InitialsAvatar name={me.name} size={36} />
        {!compact && !rail && (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-bold">{me.name}</span>
            <span className="truncate text-xs text-muted-foreground">{me.title ?? me.email}</span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact || rail ? 'end' : 'start'} side={compact ? 'bottom' : rail ? 'right' : 'top'} className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-bold">{me.name}</div>
          {me.email && <div className="truncate text-xs text-muted-foreground">{me.email}</div>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/me')}>
          <UserRound className="mr-2 h-4 w-4" aria-hidden /> Me
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate(HELP.to)}>
          <HELP.icon className="mr-2 h-4 w-4" aria-hidden /> {HELP.label}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={startTour}>
          <Compass className="mr-2 h-4 w-4" aria-hidden /> Take the tour
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme(dark ? 'light' : 'dark')}>
          {dark ? <Sun className="mr-2 h-4 w-4" aria-hidden /> : <Moon className="mr-2 h-4 w-4" aria-hidden />}
          {dark ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={async () => { await signOut(); navigate('/auth'); }}
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Desktop sidebar ──────────────────────────────────────────────────────────

function Sidebar({ access, badge, collapsed, onToggle }: {
  access: NavAccess; badge: number; collapsed: boolean; onToggle: () => void;
}) {
  const { pathname, search } = useLocation();
  const here = locate(pathname, search, access);
  const workspaces = visibleWorkspaces(access);
  const byId = (id: string) => workspaces.find((w) => w.id === id);

  const wsLink = (id: 'people' | 'finance' | 'operations' | 'admin' | 'me', tour?: string) => {
    const ws = byId(id);
    if (!ws) return null;
    const to = landingOf(ws, access)!;
    return (
      <SidebarLink key={id} to={to} icon={ws.icon} label={ws.label} active={here?.workspace.id === id} tour={tour} collapsed={collapsed} />
    );
  };

  const hasWork = ['people', 'finance', 'operations'].some((id) => byId(id));

  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  const toggleButton = (
    <RailTip show label={<span>{toggleLabel} <kbd className="ml-1 rounded border px-1 text-[10px] font-bold">Ctrl B</kbd></span>}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={toggleLabel}
        aria-expanded={!collapsed}
        aria-controls="app-sidebar"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden /> : <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />}
      </button>
    </RailTip>
  );

  return (
    <aside
      id="app-sidebar"
      aria-label="Sidebar"
      className={cn(
        'sticky top-0 hidden h-svh shrink-0 flex-col gap-4 overflow-hidden border-r bg-card py-5 lg:flex',
        'transition-[width,padding] duration-200 ease-out motion-reduce:transition-none',
        collapsed ? 'w-[72px] px-3' : 'w-64 px-3.5',
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-2">
          <RailTip show label="Home">
            <Link to="/dashboard" aria-label="Sizzling Spices home"><BrandMark /></Link>
          </RailTip>
          {toggleButton}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Link to="/dashboard" className="flex min-w-0 flex-1 items-center gap-3 px-1.5">
            <BrandMark />
            <span className="min-w-0">
              <span className="block truncate font-display text-[17px] font-bold leading-tight">Sizzling Spices</span>
              <span className="block truncate text-xs text-muted-foreground">Company portal</span>
            </span>
          </Link>
          {toggleButton}
        </div>
      )}

      <RailTip show={collapsed} label={<span>Search <kbd className="ml-1 rounded border px-1 text-[10px] font-bold">Ctrl K</kbd></span>}>
        <button
          type="button"
          onClick={openCommandPalette}
          data-tour="search"
          aria-label={collapsed ? 'Search' : undefined}
          className={cn(
            'flex h-[42px] items-center rounded-[10px] border bg-background text-sm text-muted-foreground transition-colors hover:border-foreground/20',
            collapsed ? 'w-10 justify-center self-center' : 'w-full gap-2.5 px-3',
          )}
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && <>
            <span className="flex-1 truncate text-left">Search or jump to…</span>
            <kbd className="rounded-md border bg-card px-1.5 py-0.5 text-[11px] font-bold">Ctrl K</kbd>
          </>}
        </button>
      </RailTip>

      <nav aria-label="Main" className="-mx-1 flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-1 py-1">
        <SidebarLink to={HOME.to} icon={HOME.icon} label={HOME.label} active={pathname === '/dashboard'} tour="home" collapsed={collapsed} />
        {!access.isPending && (
          <SidebarLink to={INBOX.to} icon={INBOX.icon} label={INBOX.label} active={pathname === '/inbox'} badge={badge} tour="inbox" collapsed={collapsed} />
        )}

        {hasWork && <SectionLabel collapsed={collapsed}>Workspaces</SectionLabel>}
        {hasWork && (
          <div data-tour="workspaces" className="flex flex-col gap-0.5">
            {wsLink('people')}
            {wsLink('finance')}
            {wsLink('operations')}
          </div>
        )}

        <SectionLabel collapsed={collapsed}>You</SectionLabel>
        {wsLink('me', 'me')}
        <SidebarLink to={HELP.to} icon={HELP.icon} label={HELP.label} active={pathname === HELP.to} tour="help" collapsed={collapsed} />

        {byId('admin') && <SectionLabel collapsed={collapsed}>Company</SectionLabel>}
        {wsLink('admin')}
      </nav>

      <UserMenu rail={collapsed} />
    </aside>
  );
}

// ── Section tabs above a workspace page ──────────────────────────────────────

function WorkspaceTabs({ access }: { access: NavAccess }) {
  const { pathname, search } = useLocation();
  const here = locate(pathname, search, access);
  const navRef = useRef<HTMLElement>(null);

  // On a phone the row is wider than the screen: bring the current tab into
  // view, so arriving on Budgets doesn't leave its tab cut off at the edge.
  useEffect(() => {
    const nav = navRef.current;
    const on = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
    // here?.tab.to: the row first renders once access has loaded.
  }, [pathname, search, here?.tab.to]);

  if (!here) return null;
  const tabs = visibleTabs(here.workspace, access);
  // A workspace with one page has nothing to switch between.
  if (tabs.length < 2) return null;

  return (
    // On a phone the row sticks under the top bar (which already names the
    // page), so switching sections never means scrolling back up.
    <div className={cn(
      'mb-6 border-b',
      'max-lg:sticky max-lg:top-[calc(60px+env(safe-area-inset-top))] max-lg:z-20 max-lg:-mx-4 max-lg:-mt-5 max-lg:mb-4 max-lg:bg-background/95 max-lg:px-4 max-lg:backdrop-blur sm:max-lg:-mx-6 sm:max-lg:px-6',
    )}>
      <div className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground max-lg:hidden">
        {here.workspace.label}
      </div>
      <nav ref={navRef} aria-label={`${here.workspace.label} sections`} className="relative flex gap-6 overflow-x-auto scrollbar-none max-lg:-mx-4 max-lg:px-4 sm:max-lg:-mx-6 sm:max-lg:px-6">
        {tabs.map((t) => {
          const on = t === here.tab;
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'flex h-11 shrink-0 items-center border-b-2 text-sm font-semibold transition-colors',
                on ? 'border-brand text-brand-soft-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

// ── Top bars ─────────────────────────────────────────────────────────────────

const TOP_LEVEL = new Set(['/dashboard', '/inbox', '/me', '/work', '/pending-approval']);

function titleFor(pathname: string, search: string, access: NavAccess): string {
  if (pathname === '/dashboard') return 'Sizzling Spices';
  if (pathname === '/inbox') return 'Inbox';
  if (pathname === '/work') return 'Work';
  if (pathname === HELP.to) return 'Help';
  const here = locate(pathname, search, access);
  if (!here) return 'Sizzling Spices';
  return here.tab.label === 'Overview' ? here.workspace.label : here.tab.label;
}

function DesktopTopBar({ access }: { access: NavAccess }) {
  const { pathname, search } = useLocation();
  const here = locate(pathname, search, access);
  const crumbs: string[] = pathname === '/dashboard' ? ['Home']
    : pathname === '/inbox' ? ['Inbox']
    : pathname === HELP.to ? [HELP.label]
    : here ? (here.tab.label === 'Overview' ? [here.workspace.label] : [here.workspace.label, here.tab.label])
    : [];

  return (
    <header className="sticky top-0 z-30 hidden h-16 shrink-0 items-center justify-between border-b bg-card/95 px-8 backdrop-blur lg:flex">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <span>Sizzling Spices</span>
        {crumbs.map((c, i) => (
          <span key={c} className="flex items-center gap-2">
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            <span className={cn(i === crumbs.length - 1 && 'font-semibold text-foreground')}>{c}</span>
          </span>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="Search"
          className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border bg-card text-foreground/75 hover:bg-accent"
        >
          <Search className="h-[18px] w-[18px]" aria-hidden />
        </button>
        <span data-tour="notifications" className="inline-flex"><NotificationBell /></span>
        <span className="ml-1.5"><UserMenu compact /></span>
      </div>
    </header>
  );
}

function MobileTopBar({ access }: { access: NavAccess }) {
  const { pathname, search, key } = useLocation();
  const navigate = useNavigate();
  const sub = !TOP_LEVEL.has(pathname);
  const title = titleFor(pathname, search, access);

  return (
    <header className="sticky top-0 z-30 flex h-[calc(60px+env(safe-area-inset-top))] shrink-0 items-center gap-1.5 border-b bg-card/95 pl-4 pr-2 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
      {sub ? (
        <button
          type="button"
          aria-label="Back"
          onClick={() => (key !== 'default' ? navigate(-1) : navigate('/work'))}
          className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-xl"
        >
          <ArrowLeft className="h-[22px] w-[22px]" aria-hidden />
        </button>
      ) : (
        <BrandMark size={34} />
      )}
      <span className="ml-1.5 min-w-0 flex-1 truncate font-display text-[19px] font-bold">{title}</span>
      <button
        type="button"
        aria-label="Search"
        onClick={openCommandPalette}
        data-tour="search"
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-foreground/80"
      >
        <Search className="h-[21px] w-[21px]" aria-hidden />
      </button>
      <span data-tour="notifications" className="inline-flex"><NotificationBell /></span>
    </header>
  );
}

function MobileTabBar({ access, badge, onCreate }: { access: NavAccess; badge: number; onCreate: () => void }) {
  const { pathname, search } = useLocation();
  const here = locate(pathname, search, access);
  const onMe = pathname === '/me' || here?.workspace.id === 'me';
  const onWork = pathname === '/work' || (!!here && here.workspace.id !== 'me');

  const Tab = ({ to, label, icon: Icon, active, n, tour }: {
    to: string; label: string; icon: React.ElementType; active: boolean; n?: number; tour?: string;
  }) => (
    <NavLink
      to={to}
      data-tour={tour}
      aria-current={active ? 'page' : undefined}
      aria-label={n ? `${label}, ${n} waiting` : undefined}
      className={cn(
        'relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11.5px] font-semibold',
        active ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <span className={cn('flex h-[30px] w-14 items-center justify-center rounded-full transition-colors', active && 'bg-brand-soft')}>
        <Icon className="h-[22px] w-[22px]" aria-hidden />
      </span>
      {label}
      {n ? <Badge n={n} className="absolute left-1/2 top-1.5 ml-2 h-[18px] min-w-[18px] border-2 border-card text-[11px]" /> : null}
    </NavLink>
  );

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex items-end border-t bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur lg:hidden"
    >
      <Tab to={HOME.to} label="Home" icon={HOME.icon} active={pathname === '/dashboard'} tour="home" />
      {!access.isPending && (
        <Tab to={INBOX.to} label="Inbox" icon={INBOX.icon} active={pathname === '/inbox'} n={badge} tour="inbox" />
      )}
      {!access.isPending && (
        // The thing people start from a phone most: a request or a record.
        <button
          type="button"
          onClick={onCreate}
          data-tour="new"
          className="flex h-16 flex-1 flex-col items-center justify-end gap-1 pb-[7px] text-[11.5px] font-semibold text-muted-foreground"
        >
          <span className="-mt-6 inline-flex h-[54px] w-[54px] items-center justify-center rounded-[18px] bg-primary text-primary-foreground shadow-[0_10px_22px_-8px_hsl(var(--primary)/0.7)] ring-4 ring-background transition-transform active:scale-95">
            <Plus className="h-[26px] w-[26px]" strokeWidth={2.4} aria-hidden />
          </span>
          New
        </button>
      )}
      <Tab to="/work" label="Work" icon={LayoutGrid} active={onWork} tour="workspaces" />
      <Tab to="/me" label="Me" icon={WORKSPACES.find((w) => w.id === 'me')!.icon} active={onMe} tour="me" />
    </nav>
  );
}

// ── Offline ──────────────────────────────────────────────────────────────────

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** Phones drop signal; say so instead of letting a save spin and then fail. */
function OfflineBanner() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" className="sticky top-[calc(60px+env(safe-area-inset-top))] z-30 flex items-center gap-2 bg-foreground px-4 py-2 text-[13px] font-semibold text-background lg:top-16">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      You’re offline. What’s on screen may be out of date, and nothing will save until you reconnect.
    </div>
  );
}

/** Feed the Work screen's "Recent" row from wherever the person goes. */
function useTrackRecent(access: NavAccess) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const here = locate(pathname, search, access);
    if (!here || here.workspace.id === 'me') return;
    pushRecent({
      to: here.tab.to,
      label: here.tab.label === 'Overview' ? here.workspace.label : here.tab.label,
      workspace: here.workspace.label,
    });
  }, [pathname, search, access]);
}

// ── The shell ────────────────────────────────────────────────────────────────

export default function AppShell() {
  const { user } = useAuth();
  const access = useNavAccess();
  const me = useMe();
  useBirthdayNotifications();
  const badge = useInboxBadge(access);
  const [creating, setCreating] = useState(false);
  const [collapsed, toggleSidebar] = useSidebarCollapsed();
  useTrackRecent(access);
  usePrefetchOnIntent(['/inbox', '/work', '/me', '/dashboard']);

  if (!user) return <Outlet />;

  return (
    <div className="flex min-h-svh w-full bg-background">
      <Sidebar access={access} badge={badge} collapsed={collapsed} onToggle={toggleSidebar} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DesktopTopBar access={access} />
        <MobileTopBar access={access} />
        <OfflineBanner />
        <main className="mx-auto w-full min-w-0 max-w-[1560px] flex-1 px-4 py-5 pb-[calc(96px+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8 lg:pb-10">
          <WorkspaceTabs access={access} />
          <Outlet />
        </main>
      </div>
      <MobileTabBar access={access} badge={badge} onCreate={() => setCreating(true)} />
      <CreateSheet open={creating} onOpenChange={setCreating} access={access} />
      <CommandPalette />
      <Tour access={access} loading={access.loading} firstName={me.firstName} />
    </div>
  );
}

