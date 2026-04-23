import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Cake, PartyPopper, Gift } from "lucide-react";

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
    profiles.filter((p) => {
      const d = new Date(p.date_of_birth);
      return d.getMonth() + 1 === month && d.getDate() === day;
    });

  const isToday = (month: number, day: number) =>
    today.getMonth() + 1 === month &&
    today.getDate() === day &&
    today.getFullYear() === viewDate.getFullYear();

  const isTodayBirthday = (p: BirthdayProfile) => {
    const d = new Date(p.date_of_birth);
    return d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  };

  const getAge = (dob: string) => {
    const d = new Date(dob);
    const age = today.getFullYear() - d.getFullYear();
    const hasHad = today.getMonth() > d.getMonth() ||
      (today.getMonth() === d.getMonth() && today.getDate() >= d.getDate());
    return hasHad ? age : age - 1;
  };

  const getDaysUntilBirthday = (dob: string) => {
    const d = new Date(dob);
    const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    if (next < today) next.setFullYear(today.getFullYear() + 1);
    const diff = Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

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
  const upcoming = profiles
    .map((p) => ({ ...p, daysUntil: getDaysUntilBirthday(p.date_of_birth) }))
    .filter((p) => p.daysUntil <= 60)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  // ── Today's birthdays ──────────────────────────────────────
  const todaysBirthdays = profiles.filter(isTodayBirthday);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-pink-100 rounded-lg">
          <Cake className="h-6 w-6 text-pink-600" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Birthday Calendar</h1>
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
                    🎂 Turns {getAge(p.date_of_birth)} today!
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
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
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
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
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
                      className={`min-h-[64px] rounded-lg p-1.5 border transition-colors ${
                        todayFlag
                          ? "bg-primary text-primary-foreground border-primary"
                          : dayBirthdays.length
                          ? "bg-pink-50 border-pink-200 hover:bg-pink-100"
                          : "border-transparent hover:bg-muted/50"
                      }`}
                    >
                      <p className={`text-xs font-semibold mb-1 ${todayFlag ? "text-primary-foreground" : "text-foreground"}`}>
                        {day}
                      </p>
                      {dayBirthdays.slice(0, 2).map((p) => (
                        <div
                          key={p.id}
                          className="text-[9px] leading-tight truncate bg-white/80 rounded px-1 py-0.5 mb-0.5 text-pink-700 font-medium border border-pink-100"
                          title={p.full_name}
                        >
                          🎂 {p.full_name.split(" ")[0]}
                        </div>
                      ))}
                      {dayBirthdays.length > 2 && (
                        <div className="text-[9px] text-pink-500 font-medium px-1">
                          +{dayBirthdays.length - 2} more
                        </div>
                      )}
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
                const dob = new Date(p.date_of_birth);
                const isNow = p.daysUntil === 0;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                      isNow ? "bg-pink-50 border border-pink-200" : "hover:bg-muted/50"
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
                      <p className="text-xs text-muted-foreground">
                        {MONTHS[dob.getMonth()].slice(0, 3)} {dob.getDate()} · {positionLabels[p.position] || p.position}
                      </p>
                    </div>
                    <Badge
                      variant={isNow ? "default" : "secondary"}
                      className={isNow ? "bg-pink-500 hover:bg-pink-600 text-white text-xs" : "text-xs"}
                    >
                      {isNow ? "Today!" : p.daysUntil === 1 ? "Tomorrow" : `${p.daysUntil}d`}
                    </Badge>
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
                const monthBirthdays = profiles
                  .filter((p) => new Date(p.date_of_birth).getMonth() + 1 === month)
                  .sort((a, b) => new Date(a.date_of_birth).getDate() - new Date(b.date_of_birth).getDate());
                if (!monthBirthdays.length)
                  return <p className="text-sm text-muted-foreground text-center py-3">No birthdays this month.</p>;
                return (
                  <div className="space-y-2">
                    {monthBirthdays.map((p) => {
                      const dob = new Date(p.date_of_birth);
                      return (
                        <div key={p.id} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-pink-400">🎂</span>
                            <span className="font-medium">{p.full_name}</span>
                          </div>
                          <span className="text-muted-foreground text-xs">{MONTHS[dob.getMonth()].slice(0, 3)} {dob.getDate()}</span>
                        </div>
                      );
                    })}
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
