import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

const BIRTHDAY_MESSAGE = (name: string) =>
  `🎂 Happy Birthday, ${name}! Today is your special day and the whole Sizzling Spices team celebrates you. Your dedication and energy make such a difference to us all. Wishing you a wonderful day filled with joy, laughter, and everything you love. Many happy returns! 🎉🥳`;

export const useBirthdayNotifications = () => {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    checkAndSendBirthdayNotifications();
  }, [user]);

  const checkAndSendBirthdayNotifications = async () => {
    try {
      const now = new Date();
      const todayMonth = now.getMonth() + 1; // 1-12
      const todayDay = now.getDate();

      // Fetch all staff with a date_of_birth and a linked_user_id
      const { data: profiles, error } = await supabase
        .from('staff_profiles')
        .select('id, full_name, date_of_birth, linked_user_id')
        .not('date_of_birth', 'is', null)
        .not('linked_user_id', 'is', null);

      if (error || !profiles?.length) return;

      // Filter to today's birthdays (month + day match only)
      const todayBirthdays = profiles.filter((p) => {
        const dob = new Date(p.date_of_birth!);
        return dob.getMonth() + 1 === todayMonth && dob.getDate() === todayDay;
      });

      if (!todayBirthdays.length) return;

      // For each birthday person, check if we already sent a notification today
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

      for (const person of todayBirthdays) {
        const { data: existing } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', person.linked_user_id!)
          .eq('type', 'birthday')
          .gte('created_at', startOfDay)
          .maybeSingle();

        if (existing) continue; // already sent today

        // Send birthday notification to the staff member
        await supabase.from('notifications').insert({
          user_id: person.linked_user_id!,
          title: `🎂 Happy Birthday, ${person.full_name}!`,
          message: BIRTHDAY_MESSAGE(person.full_name),
          type: 'birthday',
        });
      }
    } catch {
      // Silent fail — birthday notifications are non-critical
    }
  };
};
