import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Cake, PartyPopper, Gift } from "lucide-react";
import {
  nextBirthday, isBirthdayOn, parseDob, countdownLabel, formatBirthdayShort,
  type NextBirthday,
} from "@/lib/birthday";

interface BirthdayProfile {
  id: string;
  full_name: string;
  date_of_birth: string;
  position: string;
  department_name: string | null;
  passport_path: string | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const positionLabels: Record<string, string> = {
  managing_director: "Managing Director",
  general_manager: "General Manager",
  kitchen_manager: "Kitchen Manager",
  event_manager: "Event Manager",
  supervisor: "Supervisor",
  staff: "Staff",
};

const BirthdayCalendar = () => {
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const queryClient = useQueryClient();

  // Realtime: invalidate cache on any staff_profiles change
  useEffect(() => {
    const channel = supabase
      .channel("birthday-calendar-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "staff_profiles" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["birthday-profiles"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: profiles = [] } = useQuery<BirthdayProfile[]>({
    queryKey: ["birthday-profiles"],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_birthday_profiles");
      if (error) throw error;
      return (data || []) as BirthdayProfile[];
    },
  });

  // ── Helpers ────────────────────────────────────────────────
  const getPassportUrl = (path: string | null) => {
    if (!path) return null;
    const { data } = supabase.storage.from("passports").getPublicUrl(path);
    return data.publicUrl;
  };

  const profilesByMonthDay = (month: number, day: number) =>
    profiles.filter((p) => isBirthdayOn(p.date_of_birth, year, month - 1, day));

  const isToday = (month: number, day: number) =>
    today.getMonth() + 1 === month &&
    today.getDate() === day &&
    today.getFullYear() === viewDate.getFullYear();

  // ── Calendar grid ──────────────────────────────────────────
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth() + 1; // 1-12
  const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => setViewDate(new Date(year, month - 2, 1));
  const nextMonth = () => setViewDate(new Date(year, month, 1));

  // ── Upcoming birthdays (next 60 days) ─────────────────────
  const withNext = profiles
    .map((p) => ({ ...p, next: nextBirthday(p.date_of_birth, today) }))
    .filter((p): p is BirthdayProfile & { next: NextBirthday } => p.next !== null);

  const upcoming = withNext
    .filter((p) => p.next.daysUntil <= 60)
    .sort((a, b) => a.next.daysUntil - b.next.daysUntil);

  // ── Today's birthdays ──────────────────────────────────────
  const todaysBirthdays = upcoming.filter((p) => p.next.daysUntil === 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-pink-100 rounded-lg">
          <Cake className="h-6 w-6 text-pink-600" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Birthday Calendar</h1>
          <p className="text-muted-foreground text-sm">Celebrate your colleagues on their special day</p>
        </div>
      </div>

      {/* Today's birthdays banner */}
      {todaysBirthdays.length > 0 && (
        <div className="rounded-xl border border-pink-200 bg-gradient-to-r from-pink-50 to-orange-50 p-4">
          <div className="flex items-center gap-3 mb-3">
            <PartyPopper className="h-5 w-5 text-pink-500" />
            <h2 className="font-bold text-pink-700">
              {todaysBirthdays.length === 1 ? "Today's Birthday!" : `${todaysBirthdays.length} Birthdays Today!`}
            </h2>
          </div>
          <div className="flex flex-wrap gap-3">
            {todaysBirthdays.map((p) => (
              <div key={p.id} className="flex items-center gap-3 bg-white rounded-lg px-4 py-3 shadow-sm border border-pink-100">
                <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center text-pink-600 font-bold text-lg overflow-hidden">
                  {getPassportUrl(p.passport_path) ? (
                    <img src={getPassportUrl(p.passport_path)!} alt={p.full_name} className="w-full h-full object-cover rounded-full" />
                  ) : (
                    p.full_name.charAt(0)
                  )}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{p.full_name}</p>
                  <p className="text-xs text-pink-500 font-medium">
                    🎂 Turns {p.next.turning} today!
                  </p>
                </div>
              </div>
            ))}
          </div>
          {/* Drafted message */}
          <div className="mt-4 p-3 bg-white rounded-lg border border-pink-100 text-sm text-gray-600 italic leading-relaxed">
            🎉 &ldquo;Happy Birthday! Today is your special day and the whole Sizzling Spices team celebrates you.
            Your dedication and energy make such a difference to us all. Wishing you a wonderful day filled with joy,
            laughter, and everything you love. Many happy returns!&rdquo; 🥳
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Calendar ── */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  {MONTHS[month - 1]} {year}
                </CardTitle>
                <div className="flex gap-1">
                  <Button variant="outline" size="icon" className="h-9 w-9 md:h-8 md:w-8" onClick={prevMonth}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setViewDate(new Date(today.getFullYear(), today.getMonth(), 1))}
                  >
                    Today
                  </Button>
                  <Button variant="outline" size="icon" className="h-9 w-9 md:h-8 md:w-8" onClick={nextMonth}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Weekday headers */}
              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">
                    {d}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, idx) => {
                  if (!day) return <div key={`empty-${idx}`} />;
                  const dayBirthdays = profilesByMonthDay(month, day);
                  const todayFlag = isToday(month, day);

                  return (
                    <div
                      key={day}
                      title={dayBirthdays.map((p) => p.full_name).join(", ") || undefined}
                      className={`min-h-[52px] sm:min-h-[72px] rounded-lg p-1 sm:p-1.5 border transition-colors ${
                        dayBirthdays.length
                          ? "bg-pink-50 border-pink-200 hover:bg-pink-100 dark:bg-pink-950/40 dark:border-pink-900"
                          : "border-transparent hover:bg-muted/50"
                      } ${todayFlag ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
                    >
                      <p
                        className={`text-xs font-semibold mb-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 ${
                          todayFlag ? "bg-primary text-primary-foreground" : "text-foreground"
                        }`}
                      >
                        {day}
                      </p>
                      {/* Phones: a cake with a count — names don't fit a 40px cell. */}
                      {dayBirthdays.length > 0 && (
                        <div className="sm:hidden text-[11px] leading-none text-pink-700 dark:text-pink-300 font-semibold">
                          🎂{dayBirthdays.length > 1 ? ` ${dayBirthdays.length}` : ""}
                        </div>
                      )}
                      <div className="hidden sm:block">
                        {dayBirthdays.slice(0, 2).map((p) => (
                          <div
                            key={p.id}
                            className="text-[11px] leading-tight truncate bg-white/90 dark:bg-background/60 rounded px-1 py-0.5 mb-0.5 text-pink-700 dark:text-pink-300 font-medium border border-pink-100 dark:border-pink-900"
                          >
                            🎂 {p.full_name.split(" ")[0]}
                          </div>
                        ))}
                        {dayBirthdays.length > 2 && (
                          <div className="text-[11px] text-pink-600 dark:text-pink-300 font-medium px-1">
                            +{dayBirthdays.length - 2} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Upcoming Birthdays ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Gift className="h-4 w-4 text-pink-500" />
                Upcoming (60 days)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[460px] overflow-y-auto">
              {upcoming.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No birthdays in the next 60 days.
                </p>
              )}
              {upcoming.map((p) => {
                const isNow = p.next.daysUntil === 0;
                const isSoon = p.next.daysUntil <= 7;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                      isNow ? "bg-pink-50 border border-pink-200 dark:bg-pink-950/40 dark:border-pink-900" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-pink-100 flex items-center justify-center text-pink-600 font-bold text-sm flex-shrink-0 overflow-hidden">
                      {getPassportUrl(p.passport_path) ? (
                        <img src={getPassportUrl(p.passport_path)!} alt={p.full_name} className="w-full h-full object-cover rounded-full" />
                      ) : (
                        p.full_name.charAt(0)
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{p.full_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {formatBirthdayShort(p.next.date)} · turns {p.next.turning}
                      </p>
                      <p className="text-[11px] text-muted-foreground/80 truncate">
                        {positionLabels[p.position] || p.position}
                        {p.department_name ? ` · ${p.department_name}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <Badge
                        variant={isNow ? "default" : "secondary"}
                        className={`text-xs whitespace-nowrap ${
                          isNow
                            ? "bg-pink-500 hover:bg-pink-600 text-white"
                            : isSoon
                            ? "bg-pink-100 text-pink-700 hover:bg-pink-100 dark:bg-pink-950 dark:text-pink-300"
                            : ""
                        }`}
                      >
                        {isNow ? "🎉 Today" : countdownLabel(p.next.daysUntil)}
                      </Badge>
                      {p.next.daysUntil >= 14 && (
                        <span className="text-[10px] text-muted-foreground mt-0.5">{p.next.daysUntil} days</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* All Birthdays by Month */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cake className="h-4 w-4 text-pink-500" />
                {MONTHS[month - 1]} Birthdays
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const monthBirthdays = withNext
                  .map((p) => ({ ...p, dob: parseDob(p.date_of_birth)! }))
                  .filter((p) => p.dob.month === month - 1)
                  .sort((a, b) => a.dob.day - b.dob.day);
                if (!monthBirthdays.length)
                  return <p className="text-sm text-muted-foreground text-center py-3">No birthdays this month.</p>;
                return (
                  <div className="space-y-2">
                    {monthBirthdays.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-12 shrink-0 text-xs font-semibold text-pink-600 dark:text-pink-300">
                            {MONTHS[p.dob.month].slice(0, 3)} {p.dob.day}
                          </span>
                          <span className="font-medium truncate">{p.full_name}</span>
                        </div>
                        <span className="text-muted-foreground text-xs whitespace-nowrap">
                          {p.next.daysUntil === 0
                            ? "🎉 Today"
                            : p.next.daysUntil > 300
                            ? "Celebrated"
                            : countdownLabel(p.next.daysUntil)}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default BirthdayCalendar;
