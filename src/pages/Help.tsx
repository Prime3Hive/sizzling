// The portal's user guide: how to get in, find your way around, and use each
// page. Written for staff, not developers, so every article says what a button
// is called and where it lives.
//
// Each article's `show` mirrors the matching tab in navigation.ts, so "For my
// role" lists only what this person can actually open. When a route's guard
// changes, change the article's check here too.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BookOpen, Compass, LifeBuoy, Package, Search, ShieldCheck, UserRound, Users, Wallet, X,
  type LucideIcon,
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { FilterChips, PageHeader } from '@/components/shell/ui';
import { Button } from '@/components/ui/button';
import { startTour } from '@/components/shell/tourSteps';
import { useNavAccess } from '@/components/shell/useNavAccess';
import type { NavAccess } from '@/components/shell/navigation';
import { CASUAL_LIMIT, SICK_LIMIT } from '@/lib/leave';
import { cn } from '@/lib/utils';

type Audience = 'Everyone' | 'Staff' | 'Admin' | 'HR' | 'Manager' | 'Department access';

interface Article {
  id: string;
  title: string;
  /** Who the page is for, shown as tags. */
  who: Audience[];
  summary: string;
  steps?: string[];
  tips?: string[];
  /** Where the feature lives, when it has its own page. */
  to?: string;
  show: (a: NavAccess) => boolean;
}

interface Section {
  id: string;
  title: string;
  icon: LucideIcon;
  intro: string;
  articles: Article[];
}

const everyone = () => true;
const approved = (a: NavAccess) => !a.isPending && (a.isAdmin || a.isManager || a.isHR || a.isEmployee);

const SECTIONS: Section[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    icon: BookOpen,
    intro: 'How to reach the portal, create your account and get access.',
    articles: [
      {
        id: 'access',
        title: 'Opening the portal',
        who: ['Everyone'],
        summary: 'The portal is a website. There is nothing to install: open it in any modern browser on a computer, tablet or phone.',
        steps: [
          'Open Chrome, Safari, Edge or Firefox.',
          'Go to the portal’s web address (shown at the top of this guide) and bookmark it.',
          'On a phone, use the browser’s menu and choose “Add to Home screen” so the portal opens like an app.',
        ],
        tips: [
          'The portal works the same on phone and desktop. On a phone, the main menu is the tab bar at the bottom of the screen.',
          'If a page looks out of date after an update, refresh it. The portal reloads itself once if it detects a new version.',
        ],
        show: everyone,
      },
      {
        id: 'sign-up',
        title: 'Creating an account',
        who: ['Everyone'],
        summary: 'New staff create their own account, then an administrator approves it.',
        steps: [
          'On the sign-in screen, switch to “Sign up”.',
          'Enter your full name, work email and a password of at least 6 characters, then repeat the password.',
          'Complete the security check (the small “verify you are human” box) and press the sign-up button.',
          'Open the verification email we send you and follow the link. If it does not arrive, check spam, then use “Resend” on the sign-in screen.',
        ],
        show: everyone,
      },
      {
        id: 'sign-in',
        title: 'Signing in, and forgotten passwords',
        who: ['Everyone'],
        summary: 'Sign in with the email and password you registered with.',
        steps: [
          'Enter your email and password, complete the security check and press “Sign in”.',
          'Forgot your password? Press “Forgot password?”, enter your email, complete the security check, and follow the reset link we email you.',
        ],
        tips: [
          'For your security you are signed out after 30 minutes without activity. A warning appears first, so you can stay signed in.',
          'Too many attempts in a short time are blocked for a while. Wait a few minutes and try again.',
        ],
        show: everyone,
      },
      {
        id: 'pending',
        title: 'Waiting for approval',
        who: ['Everyone'],
        summary: 'Until an administrator approves your account you see an “Awaiting Approval” screen. You can still open Home, Me and your profile.',
        steps: [
          'Let your manager or an administrator know you have signed up.',
          'Stay on the page: it checks every 30 seconds and takes you in as soon as you are approved.',
        ],
        show: everyone,
      },
      {
        id: 'roles',
        title: 'Roles: what you can see and why',
        who: ['Everyone'],
        summary: 'What you see depends on your role, and for finance and stock pages, on what your department is allowed to do.',
        steps: [
          'Staff / Employee: your own profile, payslips, leave, attendance, reports, checklists, performance, complaints, messages and documents, plus stock requests.',
          'Manager: everything staff have, plus team performance (KPIs), procurement and approving stock requests.',
          'HR: everything staff have, plus the staff directory, marking attendance, complaints and team performance.',
          'Admin: everything, including approvals, payroll, accounting and company settings.',
          'Department access: an administrator can give a department view, create, edit or delete rights on Inventory, Sales/Payments, Invoices, Finance, Budgets and Reports.',
        ],
        tips: ['If a page you need is missing, ask an administrator to check your role and department under Admin › Access control.'],
        show: everyone,
      },
    ],
  },
  {
    id: 'finding-your-way',
    title: 'Finding your way around',
    icon: Compass,
    intro: 'The parts of the screen you will use every day.',
    articles: [
      {
        id: 'layout',
        title: 'Menu, workspaces and section tabs',
        who: ['Everyone'],
        summary: 'Pages are grouped into workspaces: People, Finance, Operations, Me and Admin. You only see the ones your role can use.',
        steps: [
          'On a computer, the menu is on the left: Home, Inbox, then your workspaces.',
          'Inside a workspace, the tabs across the top switch between its pages (for example Finance › Expenses, Invoices, Payments).',
          'On a phone, the bottom tab bar has Home, Inbox, ＋ New, Work and Me. Work lists every page you can open, with a search box and your recent pages.',
          'Your name in the corner opens the account menu: Me, dark/light mode and Sign out.',
        ],
        show: everyone,
      },
      {
        id: 'search',
        title: 'Search and jump (Ctrl K)',
        who: ['Everyone'],
        summary: 'Press Ctrl K (⌘ K on a Mac), or the search button, to jump to any page, find a colleague or start a common action.',
        tips: ['Search understands everyday words: “salary” finds Payroll, “stock” finds Inventory, “time off” finds Leave.'],
        show: everyone,
      },
      {
        id: 'new',
        title: 'Starting something new (＋ New)',
        who: ['Staff'],
        summary: 'On a phone, ＋ New in the tab bar opens the things people start most often, each straight into its form.',
        steps: [
          'Expense (if you manage budgets) or Expense claim (money you spent for work).',
          'Leave, Stock request and Daily report.',
          'Under “For your team”, if your role allows: mark this week’s attendance, invoice a customer, record a payment received.',
        ],
        show: approved,
      },
      {
        id: 'home',
        title: 'Home',
        who: ['Everyone'],
        summary: 'Your starting page: a summary of what needs your attention, your week, and shortcuts into the pages you use most.',
        to: '/dashboard',
        show: everyone,
      },
      {
        id: 'inbox',
        title: 'Inbox: approvals and your requests',
        who: ['Staff'],
        summary: 'One place for everything waiting on you, and for following the requests you have made.',
        steps: [
          '“Waiting” lists what you can decide: expenses and leave (admin), stock requests (admin and managers), attendance weeks and new sign-ups (admin).',
          'Open an item to see its details, add an optional note, then Approve or Reject (attendance weeks are “Sent back” to HR instead).',
          'Expenses, leave and stock requests can be approved in one tap from the list. You get 5 seconds to Undo before the decision is saved.',
          '“My requests” shows everything you have asked for and where it stands.',
        ],
        tips: ['The person who made the request is notified of your decision automatically.'],
        to: '/inbox',
        show: approved,
      },
      {
        id: 'notifications',
        title: 'Notifications',
        who: ['Everyone'],
        summary: 'The bell at the top shows updates such as decisions on your requests, new requests to review, birthdays and low-stock alerts. Open one to go to the related page.',
        show: everyone,
      },
    ],
  },
  {
    id: 'me',
    title: 'Me: your own records',
    icon: UserRound,
    intro: 'Everything about you. Open it from Me in the menu or the tab bar.',
    articles: [
      {
        id: 'profile',
        title: 'Your profile',
        who: ['Everyone'],
        summary: 'Your personal details, emergency contact and employment information.',
        steps: ['Go to Me › Profile, update your details and save.'],
        tips: ['Salary and bank details can only be changed by HR or an administrator. Ask them if something is wrong.'],
        to: '/my-profile',
        show: everyone,
      },
      {
        id: 'payslips',
        title: 'Payslips',
        who: ['Staff'],
        summary: 'Every payslip issued to you, with the breakdown of pay, PAYE, pension, NHF, commission and deductions.',
        steps: ['Go to Me › Payslips and pick a month. Use the download button for a PDF copy.'],
        to: '/my-payslip',
        show: approved,
      },
      {
        id: 'leave',
        title: 'Requesting leave',
        who: ['Staff'],
        summary: 'Ask for time off and track your balance.',
        steps: [
          'Go to Me › Leave and press “New Request”.',
          'Choose the type (Casual, Sick, or Unpaid), the start and end dates, and give a reason.',
          'Submit. An administrator approves or rejects it, and you are notified with any response.',
        ],
        tips: [`Casual leave is limited to ${CASUAL_LIMIT} days a year and sick leave to ${SICK_LIMIT} occasions a year. The form warns you before you go over.`],
        to: '/staff-portal?tab=leave',
        show: approved,
      },
      {
        id: 'my-attendance',
        title: 'Your attendance',
        who: ['Staff'],
        summary: 'Your attendance for each week, once HR has marked it and an administrator has approved it.',
        steps: [
          'Go to Me › Attendance to see each day (Present, Late, Half day, Absent, Excused, On leave, Holiday, Off day).',
          'If a day is wrong, press “Request review”, explain why, and send it. You are notified when it is approved or declined.',
        ],
        to: '/staff-portal?tab=attendance',
        show: approved,
      },
      {
        id: 'reports',
        title: 'Daily reports and expense claims',
        who: ['Staff'],
        summary: 'Send the reports you are assigned, and claim back money you spent for work.',
        steps: [
          'Go to Me › Reports and press the button to submit a report.',
          'Pick the report type: Sales (takings), Inventory (counts and usage), Expense (money you spent), Credit (items bought on credit), Kitchen (food prepared, served and wasted) or Operations (activities, challenges, observations, suggestions).',
          'Fill in the lines and amounts, then press “Submit Report”.',
          'An administrator reviews it. Once approved, a sales report becomes revenue in the books, an expense report becomes an expense, and a credit report goes to the payables register.',
        ],
        tips: ['Your reports are graded for completeness and on-time delivery. Your average score and on-time rate are shown at the top of the page.'],
        to: '/staff-portal?tab=reports',
        show: approved,
      },
      {
        id: 'checklists',
        title: 'Checklists',
        who: ['Staff'],
        summary: 'Tasks assigned to you. Tick them off as you complete them.',
        to: '/staff-portal?tab=checklists',
        show: approved,
      },
      {
        id: 'performance',
        title: 'Your performance (KPIs)',
        who: ['Staff'],
        summary: 'The KPI tasks set for you in each review period, and your scores once they are finalised.',
        to: '/staff-portal?tab=performance',
        show: approved,
      },
      {
        id: 'complaints-messages',
        title: 'Complaints and messages',
        who: ['Staff'],
        summary: 'Raise an issue with HR, or message management, and see their replies.',
        steps: ['Go to Me › Complaints or Me › Messages, write your message and send it.'],
        to: '/staff-portal?tab=complaints',
        show: approved,
      },
      {
        id: 'documents',
        title: 'Your documents',
        who: ['Staff'],
        summary: 'Your contract and other personal files that HR has uploaded for you.',
        to: '/staff-portal?tab=documents',
        show: approved,
      },
    ],
  },
  {
    id: 'people',
    title: 'People',
    icon: Users,
    intro: 'Staff records, attendance, pay and performance, for HR, managers and administrators.',
    articles: [
      {
        id: 'directory',
        title: 'Staff directory and profiles',
        who: ['Admin', 'HR'],
        summary: 'Every current staff member, by department. Open someone to see their full profile: personal, employment, banking and emergency details, and documents.',
        steps: [
          'Go to People › Directory. Search or filter by department.',
          'To add someone, use “Add staff” (also available from Ctrl K) and fill in each tab of the profile.',
          'When someone leaves, open their profile and use “Mark as left” with the exit date and reason. Their history is kept, and they drop out of attendance, payroll (after their final pay) and other lists.',
        ],
        tips: ['Marking someone as left does not remove their portal login. Remove their access in Admin › Users as well.'],
        to: '/people',
        show: (a) => a.isAdmin || a.isHR,
      },
      {
        id: 'attendance',
        title: 'Marking and approving attendance',
        who: ['HR', 'Admin'],
        summary: 'HR marks attendance for the week; an administrator approves it, and it then appears on each person’s portal.',
        steps: [
          'Go to People › Attendance. Use the arrows to pick the week (or “This week”).',
          'Mark each person for each day: P Present, L Late, H Half day, A Absent, E Excused, V On leave, X Holiday, O Off day. You can add a comment to any day.',
          'When the week is complete, add an optional comment and submit it for approval.',
          'An administrator opens it from the Inbox or the Weekly Reports tab and approves it, or sends it back with a note for HR to correct and resubmit.',
          'Review requests from staff appear on the same page. Approve or decline them, with a note.',
        ],
        to: '/attendance',
        show: (a) => a.canFeature('mark_attendance'),
      },
      {
        id: 'payroll',
        title: 'Running payroll',
        who: ['Admin'],
        summary: 'Generate monthly pay for all staff (or one person), with Nigerian PAYE, pension and NHF worked out automatically.',
        steps: [
          'Go to People › Payroll and press “Generate Payroll”.',
          'Choose All Staff or a single person, then the salary period. Salaries come from each staff profile; approved sales commission for the month is added automatically.',
          'Check the records. Use the pencil to adjust allowances or other deductions; tax is recalculated.',
          'Press “Pay” on a record (or pay all pending) once the money has gone out. This posts the payroll to the books.',
          'Download payslip PDFs, or export the register to Excel or PDF. The statutory schedules export gives PAYE, pension and NHF sheets ready for filing.',
        ],
        to: '/payroll',
        show: (a) => a.isAdmin,
      },
      {
        id: 'leave-admin',
        title: 'Managing leave',
        who: ['Admin'],
        summary: 'Approve or reject leave requests, with a response to the staff member.',
        steps: ['Go to People › Leave (or the Inbox), open a request, choose Approve or Reject, add a message if needed and send.'],
        to: '/staff-portal?tab=leave',
        show: (a) => a.isAdmin,
      },
      {
        id: 'complaints-admin',
        title: 'Handling complaints',
        who: ['Admin', 'HR'],
        summary: 'Read complaints raised by staff, respond, and update their status as you resolve them.',
        to: '/staff-portal?tab=complaints',
        show: (a) => a.isAdmin || a.isHR,
      },
      {
        id: 'kpi',
        title: 'Performance (KPIs)',
        who: ['Admin', 'Manager', 'HR'],
        summary: 'Set review periods, assign KPI tasks, score them and see the leaderboard.',
        steps: [
          'Periods: create a review period (monthly, quarterly or annual).',
          'Assign: pick staff and assign tasks from the library or add a custom task, with a target and maximum score.',
          'Score: as tasks finish, mark them Completed or Failed and enter scores with notes.',
          'Overview and Reports: see rankings, department results and history once scores are calculated.',
        ],
        to: '/business/kpi',
        show: (a) => a.isAdmin || a.isManager || a.isHR,
      },
      {
        id: 'birthdays',
        title: 'Birthdays',
        who: ['Admin', 'Manager', 'HR'],
        summary: 'A calendar of staff birthdays. A reminder notification also appears on the day.',
        to: '/birthdays',
        show: (a) => a.isAdmin || a.isManager || a.isHR,
      },
    ],
  },
  {
    id: 'finance',
    title: 'Finance',
    icon: Wallet,
    intro: 'Money in, money out, and the books. Most pages here depend on your department’s access.',
    articles: [
      {
        id: 'finance-overview',
        title: 'Finance overview',
        who: ['Admin'],
        summary: 'Profit, cash, receivables and spending for the year to date, at a glance.',
        to: '/finance/overview',
        show: (a) => a.isAdmin,
      },
      {
        id: 'expenses',
        title: 'Expenses',
        who: ['Department access'],
        summary: 'Record company spending against a budget and category.',
        steps: [
          'Go to Finance › Expenses and press the button to add an expense (or ＋ New › Expense on a phone).',
          'Enter the amount, category, budget, date and description, and attach a receipt if you have one.',
          'Expenses entered by non-admins wait as Pending until an administrator approves them in the Inbox or on this page. Only approved expenses reach the books and reports.',
        ],
        tips: ['No access to Expenses? Claim the money back with an Expense report under Me › Reports instead.'],
        to: '/expenses',
        show: (a) => a.hasPermission('budgets', 'view'),
      },
      {
        id: 'invoices',
        title: 'Quotations and invoices',
        who: ['Department access'],
        summary: 'Quote customers, turn quotes into invoices, and track what has been paid.',
        steps: [
          'Go to Finance › Invoices and press “New Quotation / Invoice”. Choose an existing customer or enter new details, add the items, VAT and any event details.',
          'When the customer accepts, open the quotation and use “Convert to Invoice”. If stock is tracked for an item, there must be enough on hand.',
          'Record payments against the invoice as they arrive (including any withholding tax). The status moves from Unpaid to Partial to Paid.',
          'Use the tabs to filter Quotations, Invoices, Events, Daily Sales and Cancelled. Download or print any document as PDF.',
        ],
        tips: ['Once issued, an invoice’s amounts are locked. An invoice with payments recorded cannot be cancelled.'],
        to: '/business/invoices',
        show: (a) => a.hasPermission('invoices', 'view'),
      },
      {
        id: 'payments',
        title: 'Payments received',
        who: ['Department access'],
        summary: 'Record and reconcile money received from sales, with the method and bank reference.',
        steps: ['Go to Finance › Payments and press “Record Payment”. Choose the method (cash, transfer, card, cheque), date and reference.'],
        to: '/business/payments',
        show: (a) => a.hasPermission('sales', 'view'),
      },
      {
        id: 'budgets',
        title: 'Budgets',
        who: ['Department access'],
        summary: 'Spending limits by department or purpose, and how much of each has been used by approved expenses.',
        steps: ['Go to Finance › Budgets to create a budget (title, type, period and amount) and watch its usage bar.'],
        to: '/budgets',
        show: (a) => a.hasPermission('budgets', 'view'),
      },
      {
        id: 'ledger',
        title: 'Ledger',
        who: ['Department access'],
        summary: 'The finance feed of money in and out, receivables and expenses, with an overview of each.',
        to: '/business/finance',
        show: (a) => a.hasPermission('finance', 'view'),
      },
      {
        id: 'accounting',
        title: 'Accounting',
        who: ['Admin'],
        summary: 'The double-entry books. Most entries are posted automatically by sales, invoices, expenses, payroll and stock.',
        steps: [
          'Trial balance, Income statement and Balance sheet: the standard reports for any period.',
          'Journal and Chart of accounts: every posted entry, and the accounts they use. Use Corrections to post an adjusting entry.',
          'Remittances: what is owed for VAT, PAYE, pension and NHF, with deadlines. “Remit” records the payment.',
          'Bank rec: tick off entries against your bank statement.',
          'Books check: compares the books with the operational pages so differences are spotted early.',
        ],
        to: '/accounting',
        show: (a) => a.isAdmin,
      },
      {
        id: 'reports-finance',
        title: 'Reports and profit & loss',
        who: ['Department access', 'Admin'],
        summary: 'Analytics & Reports gives revenue, spending and trends; Profit & loss (admin) gives the income statement by month, net of VAT.',
        to: '/reports',
        show: (a) => a.hasPermission('reports', 'view') || a.isAdmin,
      },
      {
        id: 'commission',
        title: 'Sales commission',
        who: ['Admin'],
        summary: 'Monthly commission worked out from staff sales reports, paid with salary.',
        steps: [
          'Go to Finance › Commission and pick the month. Weekly sales come from approved staff sales reports.',
          'Set “Targets and rates”, pool shares and department groups once; they apply from then on.',
          'Review any sales reports still waiting (the month cannot be approved while any are pending).',
          'Approve the month. The commission is booked, and added automatically to the next payroll run for each person.',
        ],
        to: '/commission',
        show: (a) => a.isAdmin,
      },
      {
        id: 'staff-reports',
        title: 'Reviewing staff reports',
        who: ['Admin'],
        summary: 'Approve, reject and grade the reports staff send, decide who must send what, and settle credit purchases.',
        steps: [
          'Review: open a report, give a score and optional note, then approve or reject. Approved sales, expense and credit reports post automatically.',
          'Assignments: “Assign report” to set which staff must send which report, daily, weekly or monthly, with an optional due time.',
          'Payables: credit purchases waiting to be paid. “Mark paid” records the settlement.',
          'Performance and Checklists: on-time rates, average grades and checklist progress per person.',
        ],
        to: '/staff-reports',
        show: (a) => a.isAdmin,
      },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    icon: Package,
    intro: 'Stock, purchasing and supply, from request to delivery.',
    articles: [
      {
        id: 'stock-requests',
        title: 'Stock requests',
        who: ['Staff'],
        summary: 'Ask the store for items, and (for admins and managers) approve and fulfil requests.',
        steps: [
          'Go to Operations › Stock requests (or ＋ New › Stock request) and add the lines you need: stock items from the list, or miscellaneous items with a description and amount.',
          'Add a reason and submit. The request is Pending.',
          'An admin or manager approves it (or rejects it with a reason) from the Inbox or this page.',
          'Approved requests are fulfilled by issuing the stock, raising an LPO to buy it, or recording a direct purchase. The request then shows as Fulfilled.',
        ],
        tips: ['Open any request to see its full details and history at every stage.'],
        to: '/business/inventory-requests',
        show: approved,
      },
      {
        id: 'inventory',
        title: 'Inventory',
        who: ['Department access'],
        summary: 'Every stock item, how much is on hand, and every movement in or out.',
        steps: [
          'Items: search, add or edit items (name, category, unit, cost and selling price, reorder level). Low-stock alerts appear at the top.',
          'Purchase: record stock coming in. Usage: record stock used or issued.',
          'Stock take: count what is on the shelves and reconcile the differences.',
          'Movements and History: every change, by whom and when. Open an item to see its own history and running balance.',
          'Analytics: value, turnover and category breakdowns.',
        ],
        to: '/business/inventory',
        show: (a) => a.hasPermission('inventory', 'view'),
      },
      {
        id: 'procurement',
        title: 'Procurement (LPOs)',
        who: ['Admin', 'Manager'],
        summary: 'Local purchase orders to suppliers, and goods received notes when they deliver.',
        steps: [
          'Go to Operations › Procurement and create an LPO (or raise one from an approved stock request). It starts as a Draft.',
          'Export the LPO as a PDF and send it to the supplier, then mark it as Sent. Set your company details once for the PDF header.',
          'When the goods arrive, receive them against the LPO. This creates a goods received note and adds the stock. Partial deliveries show as Partial until complete.',
        ],
        to: '/procurement',
        show: (a) => a.isAdmin || a.isManager,
      },
      {
        id: 'njc',
        title: 'NJC Supplies',
        who: ['Admin'],
        summary: 'Supply records for the NJC account, with export.',
        to: '/njc-supplies',
        show: (a) => a.canFeature('njc_supplies'),
      },
    ],
  },
  {
    id: 'admin',
    title: 'Admin',
    icon: ShieldCheck,
    intro: 'Who can get in, what they can see, and the company’s records. Administrators only.',
    articles: [
      {
        id: 'users',
        title: 'Approving users and assigning roles',
        who: ['Admin'],
        summary: 'Approve new sign-ups, set each person’s role and department, and link their login to their staff profile.',
        steps: [
          'Go to Admin › Users. New sign-ups show as pending (also in the Inbox).',
          'Use “Assign Role & Department”: choose Admin, Manager, HR or Staff / Employee, and their department, then Approve.',
          'Use “Link Profile” to connect the login to the right staff profile, so their payslips, leave and attendance appear under Me.',
          'Create new departments from the Departments section on the same page.',
        ],
        to: '/users',
        show: (a) => a.isAdmin,
      },
      {
        id: 'access-control',
        title: 'Access control',
        who: ['Admin'],
        summary: 'Decide what each department can do in Inventory, Sales, Invoices, Finance, Budgets and Reports: view, create, edit or delete.',
        to: '/department-permissions',
        show: (a) => a.isAdmin,
      },
      {
        id: 'bank-accounts',
        title: 'Bank accounts',
        who: ['Admin'],
        summary: 'The company’s bank accounts, used for payments, the books and the account details printed on invoices.',
        to: '/bank-accounts',
        show: (a) => a.isAdmin,
      },
      {
        id: 'company-files',
        title: 'Company files',
        who: ['Admin'],
        summary: 'A shared library of policies, contracts and templates, organised in folders.',
        to: '/company-files',
        show: (a) => a.isAdmin,
      },
      {
        id: 'messages',
        title: 'Website messages',
        who: ['Admin'],
        summary: 'Enquiries and newsletter sign-ups from the public contact page (/contact), which anyone can open without signing in.',
        to: '/messages',
        show: (a) => a.isAdmin,
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    icon: LifeBuoy,
    intro: 'Quick fixes for the most common problems.',
    articles: [
      {
        id: 'cant-sign-in',
        title: 'I can’t sign in',
        who: ['Everyone'],
        summary: 'Check your email is verified (look for our verification email, or use Resend), that the security check completed, and that caps lock is off. If you still can’t get in, reset your password.',
        show: everyone,
      },
      {
        id: 'missing-page',
        title: 'A page or button is missing',
        who: ['Everyone'],
        summary: 'Pages appear only for the roles and departments allowed to use them. Ask an administrator to check your role in Admin › Users and your department’s rights in Admin › Access control.',
        show: everyone,
      },
      {
        id: 'missing-payslip',
        title: 'My payslips, leave or attendance are empty',
        who: ['Staff'],
        summary: 'Your login probably isn’t linked to your staff profile yet. Ask an administrator to use “Link Profile” in Admin › Users.',
        show: everyone,
      },
      {
        id: 'error',
        title: '“Something went wrong”',
        who: ['Everyone'],
        summary: 'Press “Try again” or refresh the page. The error is reported automatically; if it keeps happening, tell an administrator what you were doing when it appeared.',
        show: everyone,
      },
    ],
  },
];

type Scope = 'mine' | 'all';

const matches = (art: Article, q: string) =>
  !q || [art.title, art.summary, ...(art.steps ?? []), ...(art.tips ?? []), ...art.who]
    .some((s) => s.toLowerCase().includes(q));

function ArticleBody({ art, canOpen }: { art: Article; canOpen: boolean }) {
  return (
    <div className="space-y-3 text-[14.5px] leading-relaxed">
      <p className="text-muted-foreground">{art.summary}</p>
      {art.steps && (
        <ol className="list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-muted-foreground">
          {art.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
      )}
      {art.tips?.map((t) => (
        <p key={t} className="rounded-xl border bg-brand-soft/60 px-3.5 py-2.5 text-[13.5px]">
          <b className="font-bold">Tip: </b>{t}
        </p>
      ))}
      {art.to && canOpen && (
        <Link to={art.to} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-soft-foreground hover:underline">
          Open this page <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}

export default function Help() {
  const access = useNavAccess();
  const [scope, setScope] = useState<Scope>('mine');
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const sections = useMemo(() => SECTIONS
    .map((s) => ({
      ...s,
      articles: s.articles.filter((art) => (scope === 'all' || art.show(access)) && matches(art, query)),
    }))
    .filter((s) => s.articles.length > 0), [access, scope, query]);

  const portalUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Help & guide"
        description="How to get into the portal and use each part of it."
        actions={(
          <Button variant="outline" onClick={startTour} className="h-10">
            <Compass className="h-4 w-4" aria-hidden /> Take the tour
          </Button>
        )}
      />

      <section className="rounded-2xl border bg-card p-4 sm:p-5">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Portal address</div>
        <div className="mt-1 break-all font-display text-lg font-bold">{portalUrl}</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Share this with new staff. They sign up there, then wait for an administrator to approve them.
        </p>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex h-11 flex-1 items-center gap-2.5 rounded-xl border border-input bg-card px-3.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the guide — payslip, leave, invoice…"
            aria-label="Search the guide"
            className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Clear search"
              className="-mr-1.5 inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-accent">
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </label>
        <FilterChips<Scope>
          label="Show"
          options={[{ value: 'mine', label: 'For my role' }, { value: 'all', label: 'Everything' }]}
          value={scope}
          onChange={setScope}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Guide contents" className="hidden lg:block">
          <div className="sticky top-24 flex flex-col gap-0.5">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Contents</div>
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`}
                className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                {s.title}
              </a>
            ))}
          </div>
        </nav>

        <div className="flex min-w-0 flex-col gap-8">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <section key={s.id} id={s.id} className="scroll-mt-24">
                <div className="mb-2 flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-display text-xl font-bold leading-tight">{s.title}</h2>
                    <p className="text-sm text-muted-foreground">{s.intro}</p>
                  </div>
                </div>
                <Accordion
                  type="multiple"
                  // While searching, open every match so the hit is visible;
                  // the key remounts it so clearing the search collapses them.
                  key={query ? 'search' : 'browse'}
                  defaultValue={query ? s.articles.map((a) => a.id) : []}
                  className="rounded-2xl border bg-card px-4 sm:px-5"
                >
                  {s.articles.map((art) => (
                    <AccordionItem key={art.id} value={art.id} id={art.id} className="last:border-b-0">
                      <AccordionTrigger className="gap-3 text-left hover:no-underline">
                        <span className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-[15px] font-bold">{art.title}</span>
                          <span className="flex flex-wrap gap-1.5">
                            {art.who.map((w) => (
                              <span key={w} className={cn(
                                'rounded-full border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground',
                                w === 'Everyone' && 'border-transparent bg-muted',
                              )}>
                                {w}
                              </span>
                            ))}
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <ArticleBody art={art} canOpen={art.show(access)} />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </section>
            );
          })}

          {sections.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing in the guide matches “{q}”.{scope === 'mine' && ' Try “Everything” to search pages for other roles too.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
