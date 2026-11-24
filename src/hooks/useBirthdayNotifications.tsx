import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { isBirthdayToday } from '@/lib/birthday';

const BIRTHDAY_MESSAGE = (name: string) =>
  `🎂 Happy Birthday, ${name}! Today is your special day and the whole Sizzling Spices team celebrates you. Your dedication and energy make such a difference to us all. Wishing you a wonderful day filled with joy, laughter, and everything you love. Many happy returns! 🎉🥳`;

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Each person gets their own birthday message, created the first time THEY
// open the portal that day.
//
// It used to be created by whoever opened the portal, for every staff member
// with a birthday. The "already sent today?" check read the birthday person's
// notifications, which nobody else is allowed to see, so the answer was always
// "no" and a new notification was written on every page load.
export const useBirthdayNotifications = () => {
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      try {
        const now = new Date();
        const flag = `birthday-notified:${userId}:${localDay(now)}`;
        try { if (localStorage.getItem(flag)) return; } catch { /* storage blocked: the database check below still applies */ }

        const { data: me } = await supabase
          .from('staff_profiles')
          .select('full_name, date_of_birth')
          .eq('linked_user_id', userId)
          .eq('employment_status', 'active')
          .not('date_of_birth', 'is', null)
          .limit(1);
        const person = me?.[0];
        if (cancelled || !person || !isBirthdayToday(person.date_of_birth!, now)) return;

        // The signed-in person can read their own notifications. limit(1), not
        // maybeSingle(): with two rows maybeSingle() errors and reads as "none".
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const { data: existing, error } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', userId)
          .eq('type', 'birthday')
          .gte('created_at', startOfDay)
          .limit(1);
        if (cancelled || error) return;

        if (!existing?.length) {
          const { error: insErr } = await supabase.from('notifications').insert({
            user_id: userId,
            title: `🎂 Happy Birthday, ${person.full_name}!`,
            message: BIRTHDAY_MESSAGE(person.full_name),
            type: 'birthday',
          });
          if (insErr) return;
        }
        try { localStorage.setItem(flag, '1'); } catch { /* ignore */ }
      } catch {
        // Birthday notifications are non-critical.
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);
};
