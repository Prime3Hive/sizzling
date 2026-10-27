// The first-login walkthrough: which steps a person sees, and whether they have
// seen them. The steps point at elements tagged `data-tour="<anchor>"` in the
// shell; the same anchor is used on the desktop sidebar and the phone tab bar,
// and Tour.tsx highlights whichever copy is on screen.
//
// Pending users get a short tour. Once approved they get the full one, because
// most of what it points at only appears then.

import { visibleWorkspaces, type NavAccess } from './navigation';

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Anchors to try in order; none (or none on screen) centres the card. */
  anchors?: string[];
}

const START_EVENT = 'portal:start-tour';
const VERSION = 1;

export type TourKind = 'pending' | 'full';

export const tourKind = (a: NavAccess): TourKind => (a.isPending ? 'pending' : 'full');

const key = (userId: string, kind: TourKind) => `tour:v${VERSION}:${userId}:${kind}`;

export function hasSeenTour(userId: string, kind: TourKind): boolean {
  try { return localStorage.getItem(key(userId, kind)) === '1'; } catch { return true; }
}

export function markTourSeen(userId: string, kind: TourKind) {
  try { localStorage.setItem(key(userId, kind), '1'); } catch { /* private mode: they may see it again */ }
}

/** Open the tour from anywhere: the account menu, Me, Help or the search palette. */
export function startTour() {
  window.dispatchEvent(new Event(START_EVENT));
}

export function onStartTour(cb: () => void) {
  window.addEventListener(START_EVENT, cb);
  return () => window.removeEventListener(START_EVENT, cb);
}

const listOf = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

export function tourSteps(a: NavAccess, opts: { desktop: boolean; firstName?: string }): TourStep[] {
  const { desktop } = opts;
  const hi = opts.firstName ? `Welcome, ${opts.firstName}!` : 'Welcome!';
  const steps: TourStep[] = [];

  if (a.isPending) {
    steps.push({
      id: 'welcome',
      title: hi,
      body: 'Your account is waiting for an administrator to approve it. This page updates by itself once they do. In the meantime, here is a quick look around.',
    });
  } else {
    steps.push({
      id: 'welcome',
      title: hi,
      body: 'This is the Sizzling Spices company portal. Take a one-minute tour of where everything is. You can skip it now and replay it any time.',
    });
  }

  if (!a.isPending) {
    steps.push({
      id: 'search',
      title: 'Search or jump anywhere',
      body: desktop
        ? 'Press Ctrl K (⌘ K on a Mac), or click here, to find any page, a colleague or a common action, such as “request leave” or “payslip”.'
        : 'Tap the magnifier to find any page, a colleague or a common action, such as “request leave” or “payslip”.',
      anchors: ['search'],
    });
  }

  steps.push({
    id: 'home',
    title: 'Home',
    body: 'Your starting page: what needs your attention today, your week, and shortcuts to the pages you use most.',
    anchors: ['home'],
  });

  if (!a.isPending) {
    const approves = a.isAdmin || a.isManager || a.canFeature('approve_attendance');
    steps.push({
      id: 'inbox',
      title: 'Inbox',
      body: approves
        ? 'Everything waiting for your decision, such as expenses, leave and stock requests, in one list. You can approve with a tap and undo for a few seconds. “My requests” tracks what you have asked for.'
        : 'Follow every request you make, including leave, expense claims and stock, and see the decision as soon as it is made.',
      anchors: ['inbox'],
    });
  }

  if (!a.isPending && !desktop) {
    steps.push({
      id: 'new',
      title: 'Start something new',
      body: 'Tap ＋ New to send a daily report, claim an expense, ask for leave or request stock. Each one opens straight into its form.',
      anchors: ['new'],
    });
  }

  const work = visibleWorkspaces(a).filter((w) => w.id !== 'me').map((w) => w.label);
  if (work.length > 0) {
    steps.push({
      id: 'workspaces',
      title: desktop ? 'Your workspaces' : 'Work',
      body: desktop
        ? `${listOf(work)}: the pages your role uses, grouped together. Inside each one, tabs across the top switch between its pages.`
        : `Every page your role can open, across ${listOf(work)}, with a search box and your recent pages.`,
      anchors: ['workspaces'],
    });
  }

  steps.push({
    id: 'me',
    title: 'Me',
    body: a.isPending
      ? 'Your profile. Check that your details are right while you wait.'
      : desktop
        ? 'Everything about you: profile, payslips, leave balance, attendance, reports, performance and documents.'
        : 'Everything about you: profile, payslips, leave, attendance and reports. Dark mode and Sign out are here too.',
    anchors: ['me'],
  });

  steps.push({
    id: 'notifications',
    title: 'Notifications',
    body: 'The bell lights up when something changes for you, such as a decision on a request or something new to review. Tap one to go straight to it.',
    anchors: ['notifications'],
  });

  if (desktop) {
    steps.push({
      id: 'account',
      title: 'Your account',
      body: 'Switch dark mode on or off, replay this tour, or sign out. You are signed out automatically after 30 minutes without activity.',
      anchors: ['account'],
    });
  }

  steps.push({
    id: 'help',
    title: 'Help is always here',
    body: desktop
      ? 'The Help & guide explains every page step by step, filtered to what your role can use.'
      : 'The Help & guide explains every page step by step. Find it under Me › Settings, along with this tour.',
    anchors: desktop ? ['help'] : ['me'],
  });

  steps.push({
    id: 'done',
    title: 'You’re all set',
    body: a.isPending
      ? 'Once you’re approved, we’ll show you the rest of the portal. You can replay this tour from the account menu or Me at any time.'
      : 'That’s the tour. You can replay it from the account menu or Me at any time.',
  });

  return steps;
}
