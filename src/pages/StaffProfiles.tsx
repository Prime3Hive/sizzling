import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useRoles } from "@/hooks/useRoles";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus, Pencil, Trash2, Download, Printer, Search, X,
  LayoutGrid, AlignJustify, Users, Building2, Link2,
  Mail, Phone, Calendar, MapPin, GraduationCap, Briefcase,
  CreditCard, MoreHorizontal, FileText, CheckCircle2,
  Banknote, User, AlertCircle, Clock, Shield, BookOpen,
  Heart, Home, IdCard,
} from "lucide-react";
import StaffDocuments from "@/components/staff/StaffDocuments";
import StaffKPIPanel from "@/components/staff-profiles/StaffKPIPanel";
import { formatNairaCompact } from "@/lib/currency";
import { exportStaffProfilePDF, printStaffProfile } from "@/lib/staffProfileExport";
import StaffProfilePrintable from "@/components/StaffProfilePrintable";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Department { id: string; name: string }

interface StaffProfile {
  id: string;
  user_id: string;
  full_name: string;
  phone_number: string | null;
  date_of_birth: string | null;
  year_of_joining: number | null;
  department_id: string | null;
  salary: number | null;
  passport_path: string | null;
  skills_experience: string | null;
  position: string;
  created_at: string;
  updated_at: string;
  departments?: Department;
  gender: string | null;
  marital_status: string | null;
  state_of_origin: string | null;
  lga: string | null;
  residential_address: string | null;
  email_address: string | null;
  nin: string | null;
  employment_type: string | null;
  employment_date: string | null;
  level_of_education: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  linked_user_id: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const positionOptions = [
  { value: "managing_director", label: "Managing Director" },
  { value: "general_manager",   label: "General Manager"   },
  { value: "kitchen_manager",   label: "Kitchen Manager"   },
  { value: "event_manager",     label: "Event Manager"     },
  { value: "supervisor",        label: "Supervisor"        },
  { value: "staff",             label: "Staff"             },
];

const genderOptions = [
  { value: "male",   label: "Male"   },
  { value: "female", label: "Female" },
];

const maritalStatusOptions = [
  { value: "single",   label: "Single"   },
  { value: "married",  label: "Married"  },
  { value: "divorced", label: "Divorced" },
  { value: "widowed",  label: "Widowed"  },
];

const employmentTypeOptions = [
  { value: "full_time",   label: "Full Time"   },
  { value: "part_time",   label: "Part Time"   },
  { value: "contract",    label: "Contract"    },
  { value: "internship",  label: "Internship"  },
];

const educationOptions = [
  { value: "primary",       label: "Primary School"              },
  { value: "secondary",     label: "Secondary School (SSCE/WAEC)"},
  { value: "ond",           label: "OND/NCE"                     },
  { value: "hnd",           label: "HND"                         },
  { value: "bsc",           label: "Bachelor's Degree"           },
  { value: "msc",           label: "Master's Degree"             },
  { value: "phd",           label: "Doctorate (PhD)"             },
  { value: "professional",  label: "Professional Certification"  },
];

const nigerianStates = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT Abuja","Gombe",
  "Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos",
  "Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto",
  "Taraba","Yobe","Zamfara",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEPT_PALETTE = [
  { card: "from-blue-500 to-cyan-500",     avatar: "from-blue-500 to-cyan-500",     chip: "bg-blue-50 text-blue-700 border-blue-200"    },
  { card: "from-violet-500 to-purple-600", avatar: "from-violet-500 to-purple-600", chip: "bg-violet-50 text-violet-700 border-violet-200"},
  { card: "from-emerald-500 to-teal-500",  avatar: "from-emerald-500 to-teal-500",  chip: "bg-emerald-50 text-emerald-700 border-emerald-200"},
  { card: "from-orange-500 to-amber-500",  avatar: "from-orange-500 to-amber-500",  chip: "bg-orange-50 text-orange-700 border-orange-200"},
  { card: "from-rose-500 to-pink-500",     avatar: "from-rose-500 to-pink-500",     chip: "bg-rose-50 text-rose-700 border-rose-200"    },
  { card: "from-sky-500 to-blue-600",      avatar: "from-sky-500 to-blue-600",      chip: "bg-sky-50 text-sky-700 border-sky-200"       },
  { card: "from-amber-500 to-yellow-500",  avatar: "from-amber-500 to-yellow-500",  chip: "bg-amber-50 text-amber-700 border-amber-200" },
  { card: "from-indigo-500 to-blue-600",   avatar: "from-indigo-500 to-blue-600",   chip: "bg-indigo-50 text-indigo-700 border-indigo-200"},
];

const POSITION_BADGE: Record<string, string> = {
  managing_director: "bg-red-100 text-red-700 border-red-200",
  general_manager:   "bg-orange-100 text-orange-700 border-orange-200",
  kitchen_manager:   "bg-amber-100 text-amber-700 border-amber-200",
  event_manager:     "bg-violet-100 text-violet-700 border-violet-200",
  supervisor:        "bg-blue-100 text-blue-700 border-blue-200",
  staff:             "bg-slate-100 text-slate-600 border-slate-200",
};

function getDeptPalette(deptId: string | null) {
  if (!deptId) return DEPT_PALETTE[0];
  let h = 0;
  for (let i = 0; i < deptId.length; i++) h = (h + deptId.charCodeAt(i)) % DEPT_PALETTE.length;
  return DEPT_PALETTE[h];
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join("");
}

function getTenure(employmentDate: string | null, yearOfJoining: number | null): string {
  const start = employmentDate
    ? new Date(employmentDate)
    : yearOfJoining ? new Date(yearOfJoining, 0, 1) : null;
  if (!start) return "";
  const now = new Date();
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (months < 1) return "New";
  if (months < 12) return `${months}mo`;
  const yrs = Math.floor(months / 12);
  return yrs === 1 ? "1 yr" : `${yrs} yrs`;
}

function posLabel(val: string) {
  return positionOptions.find(p => p.value === val)?.label ?? val;
}

function empTypeLabel(val: string | null) {
  return employmentTypeOptions.find(e => e.value === val)?.label ?? val ?? "";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 p-1.5 rounded-md bg-muted shrink-0">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm mt-0.5 leading-snug">{value}</p>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{children}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─── Profile Detail Sheet ────────────────────────────────────────────────────

function ProfileSheet({
  profile,
  open,
  onClose,
  passportUrl,
  isAdmin,
  canScore,
  onEdit,
  onDelete,
  onExport,
  onPrint,
}: {
  profile: StaffProfile | null;
  open: boolean;
  onClose: () => void;
  passportUrl: string | null;
  isAdmin: boolean;
  canScore: boolean;
  onEdit: (p: StaffProfile) => void;
  onDelete: (id: string) => void;
  onExport: (p: StaffProfile) => void;
  onPrint: (p: StaffProfile) => void;
}) {
  if (!profile) return null;
  const palette = getDeptPalette(profile.department_id);
  const tenure = getTenure(profile.employment_date, profile.year_of_joining);

  return (
    <Sheet open={open} onOpenChange={open => !open && onClose()}>
      <SheetContent side="right" className="w-[440px] sm:w-[480px] p-0 flex flex-col">
        {/* Gradient header */}
        <div className={`relative bg-gradient-to-br ${palette.card} pb-16 pt-8 px-6`}>
          <div className="flex items-start justify-between">
            <SheetHeader className="text-left text-white space-y-0">
              <SheetTitle className="text-white text-xl font-bold leading-tight">
                {profile.full_name}
              </SheetTitle>
              <p className="text-white/80 text-sm">{posLabel(profile.position)}</p>
            </SheetHeader>
            <div className="flex gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => onEdit(profile)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => onExport(profile)}>
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export PDF</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => onPrint(profile)}>
                    <Printer className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Print</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Avatar bridging header + content */}
        <div className="relative -mt-12 px-6 flex items-end gap-4">
          <Avatar className="h-20 w-20 ring-4 ring-background shadow-lg">
            <AvatarImage src={passportUrl ?? undefined} />
            <AvatarFallback className={`bg-gradient-to-br ${palette.avatar} text-white text-xl font-bold`}>
              {getInitials(profile.full_name)}
            </AvatarFallback>
          </Avatar>
          <div className="pb-1 flex flex-wrap gap-1.5">
            {profile.departments && (
              <Badge variant="outline" className={`text-xs ${palette.chip}`}>
                {profile.departments.name}
              </Badge>
            )}
            {profile.employment_type && (
              <Badge variant="outline" className="text-xs">
                {empTypeLabel(profile.employment_type)}
              </Badge>
            )}
            {tenure && (
              <Badge variant="outline" className="text-xs gap-1">
                <Clock className="h-3 w-3" />{tenure}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-xs gap-1 ${profile.linked_user_id ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}
            >
              {profile.linked_user_id
                ? <><CheckCircle2 className="h-3 w-3" />Linked</>
                : <><AlertCircle className="h-3 w-3" />Not linked</>
              }
            </Badge>
          </div>
        </div>

        {/* Scrollable content */}
        <ScrollArea className="flex-1 px-6 pb-6">
          <div className="space-y-4 pt-4">

            {/* Contact */}
            <SectionHeading>Contact</SectionHeading>
            <div className="space-y-3">
              <DetailRow icon={Mail}  label="Email"  value={profile.email_address} />
              <DetailRow icon={Phone} label="Phone"  value={profile.phone_number}  />
            </div>

            {/* Personal */}
            <SectionHeading>Personal Information</SectionHeading>
            <div className="space-y-3">
              <DetailRow icon={Calendar} label="Date of Birth"    value={profile.date_of_birth ? new Date(profile.date_of_birth).toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" }) : null} />
              <DetailRow icon={User}     label="Gender"           value={genderOptions.find(g => g.value === profile.gender)?.label} />
              <DetailRow icon={Heart}    label="Marital Status"   value={maritalStatusOptions.find(m => m.value === profile.marital_status)?.label} />
              <DetailRow icon={MapPin}   label="State of Origin"  value={profile.state_of_origin} />
              <DetailRow icon={MapPin}   label="LGA"              value={profile.lga} />
              <DetailRow icon={Home}     label="Address"          value={profile.residential_address} />
              <DetailRow icon={IdCard}   label="NIN"              value={profile.nin} />
              <DetailRow icon={GraduationCap} label="Education"   value={educationOptions.find(e => e.value === profile.level_of_education)?.label} />
            </div>

            {/* Employment */}
            <SectionHeading>Employment</SectionHeading>
            <div className="space-y-3">
              <DetailRow icon={Briefcase} label="Position"        value={posLabel(profile.position)} />
              <DetailRow icon={Building2} label="Department"      value={profile.departments?.name} />
              <DetailRow icon={Briefcase} label="Employment Type" value={empTypeLabel(profile.employment_type)} />
              <DetailRow icon={Calendar}  label="Employment Date" value={profile.employment_date ? new Date(profile.employment_date).toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" }) : null} />
              <DetailRow icon={Calendar}  label="Year of Joining" value={profile.year_of_joining?.toString()} />
              {profile.skills_experience && (
                <div className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Skills &amp; Experience</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{profile.skills_experience}</p>
                </div>
              )}
            </div>

            {/* Banking — visible to all for account details, salary only for admin */}
            {(profile.bank_name || profile.account_number || (isAdmin && profile.salary)) && (
              <>
                <SectionHeading>Banking</SectionHeading>
                <div className="space-y-3">
                  <DetailRow icon={Banknote}  label="Bank Name"       value={profile.bank_name} />
                  <DetailRow icon={CreditCard} label="Account Number" value={profile.account_number} />
                  <DetailRow icon={User}       label="Account Name"   value={profile.account_name} />
                  {isAdmin && profile.salary && (
                    <DetailRow icon={Banknote} label="Monthly Salary" value={formatNairaCompact(profile.salary)} />
                  )}
                </div>
              </>
            )}

            {/* Emergency */}
            {profile.emergency_contact_name && (
              <>
                <SectionHeading>Emergency Contact</SectionHeading>
                <div className="space-y-3">
                  <DetailRow icon={User}  label="Name"         value={profile.emergency_contact_name} />
                  <DetailRow icon={Phone} label="Phone"        value={profile.emergency_contact_phone} />
                  <DetailRow icon={Heart} label="Relationship" value={profile.emergency_contact_relationship} />
                </div>
              </>
            )}

            {/* KPI Performance */}
            <SectionHeading>KPI Performance</SectionHeading>
            <div className="pt-1">
              <StaffKPIPanel
                staffProfileId={profile.id}
                staffName={profile.full_name}
                canScore={canScore}
              />
            </div>

            {/* Documents */}
            <SectionHeading>Documents</SectionHeading>
            <div className="pt-1">
              <StaffDocuments staffProfileId={profile.id} staffName={profile.full_name} />
            </div>

            {/* Danger zone */}
            {isAdmin && (
              <>
                <SectionHeading>Actions</SectionHeading>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-2"
                  onClick={() => { onClose(); onDelete(profile.id); }}
                >
                  <Trash2 className="h-4 w-4" /> Delete Profile
                </Button>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ─── Staff Card ───────────────────────────────────────────────────────────────

function StaffCard({
  profile,
  passportUrl,
  isAdmin,
  isHR,
  onView,
  onEdit,
  onDelete,
  onExport,
  onPrint,
}: {
  profile: StaffProfile;
  passportUrl: string | null;
  isAdmin: boolean;
  isHR: boolean;
  onView: (p: StaffProfile) => void;
  onEdit: (p: StaffProfile) => void;
  onDelete: (id: string) => void;
  onExport: (p: StaffProfile) => void;
  onPrint: (p: StaffProfile) => void;
}) {
  const palette = getDeptPalette(profile.department_id);
  const tenure = getTenure(profile.employment_date, profile.year_of_joining);
  const posStyle = POSITION_BADGE[profile.position] ?? POSITION_BADGE.staff;

  return (
    <div
      className="group relative bg-card rounded-2xl border border-border/60 overflow-hidden
                 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col"
      onClick={() => onView(profile)}
    >
      {/* Gradient band */}
      <div className={`h-20 bg-gradient-to-br ${palette.card} relative`}>
        {/* Linked indicator dot */}
        <div className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full ring-2 ring-white/40
            ${profile.linked_user_id ? "bg-emerald-300" : "bg-white/30"}`}
          title={profile.linked_user_id ? "Portal linked" : "Not linked"}
        />
      </div>

      {/* Avatar */}
      <div className="flex justify-center -mt-10 relative z-10">
        <Avatar className="h-20 w-20 ring-4 ring-background shadow-md">
          <AvatarImage src={passportUrl ?? undefined} />
          <AvatarFallback className={`bg-gradient-to-br ${palette.avatar} text-white text-xl font-bold`}>
            {getInitials(profile.full_name)}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Identity */}
      <div className="px-4 pt-3 pb-2 text-center flex flex-col items-center gap-1.5">
        <p className="font-bold text-sm leading-tight line-clamp-1">{profile.full_name}</p>
        <Badge variant="outline" className={`text-[10px] px-2 py-0 ${posStyle}`}>
          {posLabel(profile.position)}
        </Badge>
        {profile.departments && (
          <p className="text-[11px] text-muted-foreground">{profile.departments.name}</p>
        )}
      </div>

      <Separator />

      {/* Key info */}
      <div className="px-4 py-3 space-y-1.5 flex-1">
        {profile.email_address && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" title={profile.email_address}>
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{profile.email_address}</span>
          </div>
        )}
        {profile.phone_number && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Phone className="h-3 w-3 shrink-0" />
            <span>{profile.phone_number}</span>
          </div>
        )}
        {(tenure || profile.employment_type) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" />
            <span>{[tenure, empTypeLabel(profile.employment_type)].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      </div>

      <Separator />

      {/* Actions */}
      <div
        className="px-4 py-2.5 flex items-center justify-between gap-1"
        onClick={e => e.stopPropagation()}
      >
        <StaffDocuments staffProfileId={profile.id} staffName={profile.full_name} />

        {(isAdmin || isHR) && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(profile)} title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onView(profile)}>
              <User className="h-3.5 w-3.5 mr-2" /> View Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport(profile)}>
              <Download className="h-3.5 w-3.5 mr-2" /> Export PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPrint(profile)}>
              <Printer className="h-3.5 w-3.5 mr-2" /> Print
            </DropdownMenuItem>
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(profile.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─── Staff List Row ───────────────────────────────────────────────────────────

function StaffListRow({
  profile, passportUrl, isAdmin, isHR, onView, onEdit, onDelete, onExport, onPrint,
}: {
  profile: StaffProfile; passportUrl: string | null; isAdmin: boolean; isHR: boolean;
  onView: (p: StaffProfile) => void; onEdit: (p: StaffProfile) => void;
  onDelete: (id: string) => void; onExport: (p: StaffProfile) => void; onPrint: (p: StaffProfile) => void;
}) {
  const palette = getDeptPalette(profile.department_id);
  const posStyle = POSITION_BADGE[profile.position] ?? POSITION_BADGE.staff;

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-xl border border-border/60 bg-card
                 hover:shadow-md hover:border-primary/20 transition-all duration-200 cursor-pointer group"
      onClick={() => onView(profile)}
    >
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarImage src={passportUrl ?? undefined} />
        <AvatarFallback className={`bg-gradient-to-br ${palette.avatar} text-white text-sm font-bold`}>
          {getInitials(profile.full_name)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0 grid grid-cols-4 gap-3 items-center">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{profile.full_name}</p>
          <p className="text-xs text-muted-foreground truncate">{profile.email_address}</p>
        </div>
        <Badge variant="outline" className={`text-[10px] px-2 py-0 w-fit ${posStyle}`}>
          {posLabel(profile.position)}
        </Badge>
        <p className="text-xs text-muted-foreground truncate">{profile.departments?.name ?? "—"}</p>
        <p className="text-xs text-muted-foreground">{profile.phone_number ?? "—"}</p>
      </div>

      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        {(isAdmin || isHR) && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(profile)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onExport(profile)}><Download className="h-3.5 w-3.5 mr-2" />Export PDF</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPrint(profile)}><Printer className="h-3.5 w-3.5 mr-2" />Print</DropdownMenuItem>
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(profile.id)}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" />Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, accent }: {
  icon: React.ElementType; label: string; value: number | string; accent: string;
}) {
  return (
    <Card className="border-border/60 overflow-hidden">
      <CardContent className="p-4 flex items-center gap-4">
        <div className={`p-2.5 rounded-xl ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function FormField({ id, label, required, children }: {
  id?: string; label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const DEFAULT_FORM = {
  full_name: "", phone_number: "", date_of_birth: "", year_of_joining: new Date().getFullYear(),
  department_id: "", salary: "", skills_experience: "", position: "staff",
  gender: "", marital_status: "", state_of_origin: "", lga: "", residential_address: "",
  email_address: "", nin: "", employment_type: "", employment_date: "",
  level_of_education: "", bank_name: "", account_number: "", account_name: "",
  emergency_contact_name: "", emergency_contact_phone: "", emergency_contact_relationship: "",
  linked_user_id: "",
};

const StaffProfiles = () => {
  const navigate = useNavigate();
  const { isAdmin, isHR, isManager, loading: rolesLoading } = useRoles();
  const { toast } = useToast();

  const [staffProfiles, setStaffProfiles] = useState<StaffProfile[]>([]);
  const [departments, setDepartments]     = useState<Department[]>([]);
  const [loading, setLoading]             = useState(true);
  const [isDialogOpen, setIsDialogOpen]   = useState(false);
  const [editingProfile, setEditingProfile] = useState<StaffProfile | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<StaffProfile | null>(null);
  const [passportFile, setPassportFile]   = useState<File | null>(null);
  const [exportingProfile, setExportingProfile] = useState<StaffProfile | null>(null);
  const [viewMode, setViewMode]           = useState<"grid" | "list">("grid");
  const printableRef = useRef<HTMLDivElement>(null);
  const exportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const printTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [searchQuery, setSearchQuery]         = useState("");
  const [filterDepartment, setFilterDepartment] = useState("all");
  const [filterPosition, setFilterPosition]   = useState("all");
  const [formData, setFormData]               = useState(DEFAULT_FORM);

  const canAccess = isAdmin || isHR;
  const canScore  = isAdmin || isManager;

  const filteredProfiles = staffProfiles.filter(p => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
      p.full_name.toLowerCase().includes(q) ||
      p.email_address?.toLowerCase().includes(q) ||
      p.phone_number?.includes(q);
    const matchDept = filterDepartment === "all" || p.department_id === filterDepartment;
    const matchPos  = filterPosition === "all"   || p.position === filterPosition;
    return matchSearch && matchDept && matchPos;
  });

  const hasFilters = searchQuery !== "" || filterDepartment !== "all" || filterPosition !== "all";

  // Computed stats
  const uniqueDepts  = new Set(staffProfiles.map(p => p.department_id).filter(Boolean)).size;
  const linkedCount  = staffProfiles.filter(p => p.linked_user_id).length;
  const fullTimeCount = staffProfiles.filter(p => p.employment_type === "full_time").length;

  useEffect(() => {
    if (!rolesLoading && !canAccess) {
      toast({ title: "Access Denied", description: "You don't have permission to view this page.", variant: "destructive" });
      navigate("/");
    }
  }, [canAccess, rolesLoading, navigate, toast]);

  useEffect(() => {
    if (canAccess) { fetchStaffProfiles(); fetchDepartments(); }
  }, [canAccess]);

  // Cleanup timeouts
  useEffect(() => () => {
    if (exportTimeoutRef.current) clearTimeout(exportTimeoutRef.current);
    if (printTimeoutRef.current)  clearTimeout(printTimeoutRef.current);
  }, []);

  const fetchStaffProfiles = async () => {
    try {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("*, departments(id, name)")
        .order("full_name");
      if (error) throw error;

      let profiles = data || [];
      if (isHR && !isAdmin) {
        const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
        const adminIds = new Set((adminRoles || []).map(r => r.user_id));
        profiles = profiles.filter(p => !p.linked_user_id || !adminIds.has(p.linked_user_id));
      }
      setStaffProfiles(profiles);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fetchDepartments = async () => {
    const { data, error } = await supabase.from("departments").select("id, name").order("name");
    if (!error) setDepartments(data || []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      let passportPath = editingProfile?.passport_path || null;
      if (passportFile) {
        const ext = passportFile.name.split(".").pop();
        const name = `${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from("passports").upload(name, passportFile);
        if (error) throw error;
        passportPath = name;
      }

      const payload = {
        full_name: formData.full_name,
        phone_number: formData.phone_number || null,
        date_of_birth: formData.date_of_birth || null,
        year_of_joining: formData.year_of_joining || null,
        department_id: formData.department_id || null,
        salary: formData.salary ? parseFloat(formData.salary) : null,
        passport_path: passportPath,
        skills_experience: formData.skills_experience || null,
        position: formData.position as StaffProfile["position"],
        gender: formData.gender || null,
        marital_status: formData.marital_status || null,
        state_of_origin: formData.state_of_origin || null,
        lga: formData.lga || null,
        residential_address: formData.residential_address || null,
        email_address: formData.email_address || null,
        nin: formData.nin || null,
        employment_type: formData.employment_type || null,
        employment_date: formData.employment_date || null,
        level_of_education: formData.level_of_education || null,
        bank_name: formData.bank_name || null,
        account_number: formData.account_number || null,
        account_name: formData.account_name || null,
        emergency_contact_name: formData.emergency_contact_name || null,
        emergency_contact_phone: formData.emergency_contact_phone || null,
        emergency_contact_relationship: formData.emergency_contact_relationship || null,
      };

      if (editingProfile) {
        const { error } = await supabase.from("staff_profiles").update(payload).eq("id", editingProfile.id);
        if (error) throw error;
        toast({ title: "Profile updated" });
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");
        const { error } = await supabase.from("staff_profiles").insert([{ ...payload, user_id: user.id, created_by: user.id }]);
        if (error) throw error;
        toast({ title: "Profile created" });
      }

      setIsDialogOpen(false);
      resetForm();
      fetchStaffProfiles();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this staff profile? This cannot be undone.")) return;
    const { error } = await supabase.from("staff_profiles").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Profile deleted" }); fetchStaffProfiles(); }
  };

  const handleEdit = (profile: StaffProfile) => {
    setEditingProfile(profile);
    setFormData({
      full_name: profile.full_name,
      phone_number: profile.phone_number || "",
      date_of_birth: profile.date_of_birth || "",
      year_of_joining: profile.year_of_joining || new Date().getFullYear(),
      department_id: profile.department_id || "",
      salary: profile.salary?.toString() || "",
      skills_experience: profile.skills_experience || "",
      position: profile.position,
      gender: profile.gender || "",
      marital_status: profile.marital_status || "",
      state_of_origin: profile.state_of_origin || "",
      lga: profile.lga || "",
      residential_address: profile.residential_address || "",
      email_address: profile.email_address || "",
      nin: profile.nin || "",
      employment_type: profile.employment_type || "",
      employment_date: profile.employment_date || "",
      level_of_education: profile.level_of_education || "",
      bank_name: profile.bank_name || "",
      account_number: profile.account_number || "",
      account_name: profile.account_name || "",
      emergency_contact_name: profile.emergency_contact_name || "",
      emergency_contact_phone: profile.emergency_contact_phone || "",
      emergency_contact_relationship: profile.emergency_contact_relationship || "",
      linked_user_id: profile.linked_user_id || "",
    });
    setIsDialogOpen(true);
  };

  const resetForm = () => { setEditingProfile(null); setPassportFile(null); setFormData(DEFAULT_FORM); };

  const getPassportUrl = (path: string | null) => {
    if (!path) return null;
    return supabase.storage.from("passports").getPublicUrl(path).data.publicUrl;
  };

  const handleExportPDF = async (profile: StaffProfile) => {
    if (exportTimeoutRef.current) clearTimeout(exportTimeoutRef.current);
    setExportingProfile(profile);
    exportTimeoutRef.current = setTimeout(async () => {
      if (printableRef.current) {
        try {
          await exportStaffProfilePDF(printableRef.current, profile.full_name);
          toast({ title: "Exported successfully" });
        } catch {
          toast({ title: "Export failed", variant: "destructive" });
        }
      }
      setExportingProfile(null);
    }, 100);
  };

  const handlePrint = (profile: StaffProfile) => {
    if (printTimeoutRef.current) clearTimeout(printTimeoutRef.current);
    setExportingProfile(profile);
    printTimeoutRef.current = setTimeout(() => {
      if (printableRef.current) printStaffProfile(printableRef.current);
      setExportingProfile(null);
    }, 100);
  };

  const f = (key: keyof typeof formData, val: string | number) =>
    setFormData(prev => ({ ...prev, [key]: val }));

  if (rolesLoading || loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-64 rounded-2xl bg-muted animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!canAccess) return null;

  return (
    <div className="space-y-6">
      {/* Hidden printable */}
      {exportingProfile && (
        <div className="fixed -left-[9999px] top-0">
          <div ref={printableRef}>
            <StaffProfilePrintable
              profile={exportingProfile}
              passportUrl={getPassportUrl(exportingProfile.passport_path)}
              isAdmin={isAdmin}
            />
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff Profiles</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sizzling Spices &middot; {staffProfiles.length} member{staffProfiles.length !== 1 ? "s" : ""}
          </p>
        </div>
        {(isAdmin || isHR) && (
          <Button onClick={() => { resetForm(); setIsDialogOpen(true); }} className="gap-2 shrink-0">
            <Plus className="h-4 w-4" /> Add Staff
          </Button>
        )}
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users}     label="Total Staff"      value={staffProfiles.length} accent="bg-primary/10 text-primary" />
        <StatCard icon={Building2} label="Departments"      value={uniqueDepts}           accent="bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400" />
        <StatCard icon={Link2}     label="Portal Linked"    value={linkedCount}           accent="bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400" />
        <StatCard icon={Briefcase} label="Full-time"        value={fullTimeCount}         accent="bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-400" />
      </div>

      {/* ── Filter Bar ── */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 rounded-lg"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Select value={filterDepartment} onValueChange={setFilterDepartment}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterPosition} onValueChange={setFilterPosition}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Positions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Positions</SelectItem>
            {positionOptions.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(""); setFilterDepartment("all"); setFilterPosition("all"); }} className="gap-1.5 text-muted-foreground">
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}

        <div className="ml-auto flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setViewMode("grid")}
            className={`px-2.5 py-1.5 transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            title="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-2.5 py-1.5 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            title="List view"
          >
            <AlignJustify className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-muted-foreground -mt-2">
        Showing {filteredProfiles.length} of {staffProfiles.length}{hasFilters ? " (filtered)" : ""}
      </p>

      {/* ── Staff Grid ── */}
      {filteredProfiles.length > 0 ? (
        viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredProfiles.map(profile => (
              <StaffCard
                key={profile.id}
                profile={profile}
                passportUrl={getPassportUrl(profile.passport_path)}
                isAdmin={isAdmin}
                isHR={isHR}
                onView={setSelectedProfile}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onExport={handleExportPDF}
                onPrint={handlePrint}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {/* List header */}
            <div className="hidden md:grid grid-cols-4 gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Name</span><span>Position</span><span>Department</span><span>Phone</span>
            </div>
            {filteredProfiles.map(profile => (
              <StaffListRow
                key={profile.id}
                profile={profile}
                passportUrl={getPassportUrl(profile.passport_path)}
                isAdmin={isAdmin}
                isHR={isHR}
                onView={setSelectedProfile}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onExport={handleExportPDF}
                onPrint={handlePrint}
              />
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <div className="p-6 bg-muted rounded-full">
            <Users className="h-10 w-10 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-lg">
              {staffProfiles.length === 0 ? "No staff profiles yet" : "No results found"}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              {staffProfiles.length === 0
                ? "Add your first staff member to get started."
                : "Try adjusting your search or filters."}
            </p>
          </div>
          {staffProfiles.length === 0 && (isAdmin || isHR) && (
            <Button onClick={() => { resetForm(); setIsDialogOpen(true); }} className="gap-2">
              <Plus className="h-4 w-4" /> Add First Staff Member
            </Button>
          )}
          {hasFilters && (
            <Button variant="outline" onClick={() => { setSearchQuery(""); setFilterDepartment("all"); setFilterPosition("all"); }}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      {/* ── Profile Detail Sheet ── */}
      <ProfileSheet
        profile={selectedProfile}
        open={!!selectedProfile}
        onClose={() => setSelectedProfile(null)}
        passportUrl={getPassportUrl(selectedProfile?.passport_path ?? null)}
        isAdmin={isAdmin}
        canScore={canScore}
        onEdit={p => { setSelectedProfile(null); handleEdit(p); }}
        onDelete={handleDelete}
        onExport={handleExportPDF}
        onPrint={handlePrint}
      />

      {/* ── Add / Edit Dialog ── */}
      <Dialog open={isDialogOpen} onOpenChange={open => { setIsDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle className="text-xl">
              {editingProfile ? `Edit — ${editingProfile.full_name}` : "New Staff Profile"}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {editingProfile ? "Update the staff member's information below." : "Fill in the details to create a new staff profile."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            <ScrollArea className="flex-1 px-6">
              <Tabs defaultValue="personal" className="pt-4">
                <TabsList className="mb-6 grid grid-cols-4 w-full">
                  <TabsTrigger value="personal"   className="gap-1.5 text-xs"><User className="h-3.5 w-3.5" />Personal</TabsTrigger>
                  <TabsTrigger value="employment" className="gap-1.5 text-xs"><Briefcase className="h-3.5 w-3.5" />Employment</TabsTrigger>
                  <TabsTrigger value="banking"    className="gap-1.5 text-xs"><CreditCard className="h-3.5 w-3.5" />Banking</TabsTrigger>
                  <TabsTrigger value="emergency"  className="gap-1.5 text-xs"><Shield className="h-3.5 w-3.5" />Emergency</TabsTrigger>
                </TabsList>

                {/* ── Personal ── */}
                <TabsContent value="personal" className="space-y-4 pb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField id="full_name" label="Full Name" required>
                      <Input id="full_name" value={formData.full_name} onChange={e => f("full_name", e.target.value)} required />
                    </FormField>
                    <FormField id="email_address" label="Email Address">
                      <Input id="email_address" type="email" value={formData.email_address} onChange={e => f("email_address", e.target.value)} />
                    </FormField>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <FormField id="phone_number" label="Phone Number">
                      <Input id="phone_number" type="tel" value={formData.phone_number} onChange={e => f("phone_number", e.target.value)} />
                    </FormField>
                    <FormField id="date_of_birth" label="Date of Birth">
                      <Input id="date_of_birth" type="date" value={formData.date_of_birth} onChange={e => f("date_of_birth", e.target.value)} />
                    </FormField>
                    <FormField label="Gender">
                      <Select value={formData.gender} onValueChange={v => f("gender", v)}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{genderOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormField>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <FormField label="Marital Status">
                      <Select value={formData.marital_status} onValueChange={v => f("marital_status", v)}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{maritalStatusOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormField>
                    <FormField label="State of Origin">
                      <Select value={formData.state_of_origin} onValueChange={v => f("state_of_origin", v)}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{nigerianStates.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormField>
                    <FormField id="lga" label="LGA">
                      <Input id="lga" value={formData.lga} onChange={e => f("lga", e.target.value)} />
                    </FormField>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField id="residential_address" label="Residential Address">
                      <Textarea id="residential_address" value={formData.residential_address} onChange={e => f("residential_address", e.target.value)} rows={2} />
                    </FormField>
                    <FormField id="nin" label="NIN">
                      <Input id="nin" value={formData.nin} onChange={e => f("nin", e.target.value)} maxLength={11} placeholder="11 digits" />
                    </FormField>
                  </div>
                  <FormField id="passport" label="Passport Photograph">
                    <Input id="passport" type="file" accept="image/*,.pdf" onChange={e => setPassportFile(e.target.files?.[0] || null)} />
                  </FormField>
                </TabsContent>

                {/* ── Employment ── */}
                <TabsContent value="employment" className="space-y-4 pb-6">
                  <div className="grid grid-cols-3 gap-4">
                    <FormField label="Position" required>
                      <Select value={formData.position} onValueChange={v => f("position", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{positionOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormField>
                    <FormField label="Department">
                      <Select value={formData.department_id} onValueChange={v => f("department_id", v)}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormField>
                    <FormField label="Employment Type">
                      <Select value={formData.employment_type} onValueChange={v => f("employment_type", v)}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{employmentTypeOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormField>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <FormField id="employment_date" label="Employment Date">
                      <Input id="employment_date" type="date" value={formData.employment_date} onChange={e => f("employment_date", e.target.value)} />
                    </FormField>
                    <FormField id="year_of_joining" label="Year of Joining">
                      <Input id="year_of_joining" type="number" value={formData.year_of_joining} onChange={e => f("year_of_joining", parseInt(e.target.value))} />
                    </FormField>
                    <FormField label="Level of Education">
                      <Select value={formData.level_of_education} onValueChange={v => f("level_of_education", v)}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{educationOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormField>
                  </div>
                  <FormField id="skills_experience" label="Skills & Experience">
                    <Textarea id="skills_experience" value={formData.skills_experience} onChange={e => f("skills_experience", e.target.value)} rows={4} placeholder="List key skills, qualifications, and relevant experience…" />
                  </FormField>
                </TabsContent>

                {/* ── Banking ── */}
                <TabsContent value="banking" className="space-y-4 pb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField id="bank_name" label="Bank Name">
                      <Input id="bank_name" value={formData.bank_name} onChange={e => f("bank_name", e.target.value)} placeholder="e.g. First Bank" />
                    </FormField>
                    <FormField id="account_number" label="Account Number">
                      <Input id="account_number" value={formData.account_number} onChange={e => f("account_number", e.target.value)} maxLength={10} placeholder="10 digits" />
                    </FormField>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField id="account_name" label="Account Name">
                      <Input id="account_name" value={formData.account_name} onChange={e => f("account_name", e.target.value)} />
                    </FormField>
                    {isAdmin && (
                      <FormField id="salary" label="Monthly Salary (₦)">
                        <Input id="salary" type="number" step="0.01" value={formData.salary} onChange={e => f("salary", e.target.value)} placeholder="0.00" />
                      </FormField>
                    )}
                  </div>
                </TabsContent>

                {/* ── Emergency ── */}
                <TabsContent value="emergency" className="space-y-4 pb-6">
                  <div className="grid grid-cols-3 gap-4">
                    <FormField id="ec_name" label="Contact Name">
                      <Input id="ec_name" value={formData.emergency_contact_name} onChange={e => f("emergency_contact_name", e.target.value)} />
                    </FormField>
                    <FormField id="ec_phone" label="Contact Phone">
                      <Input id="ec_phone" type="tel" value={formData.emergency_contact_phone} onChange={e => f("emergency_contact_phone", e.target.value)} />
                    </FormField>
                    <FormField id="ec_rel" label="Relationship">
                      <Input id="ec_rel" value={formData.emergency_contact_relationship} onChange={e => f("emergency_contact_relationship", e.target.value)} placeholder="e.g. Spouse, Parent" />
                    </FormField>
                  </div>
                </TabsContent>
              </Tabs>
            </ScrollArea>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t bg-muted/30 shrink-0">
              <Button type="button" variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="min-w-[100px]">
                {loading ? "Saving…" : editingProfile ? "Save Changes" : "Create Profile"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StaffProfiles;
