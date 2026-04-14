import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mail, MailOpen, Send, Plus, Lightbulb, ThumbsUp, Eye, AlertTriangle, MessageSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const messageCategories = [
  { value: 'general', label: 'General', icon: MessageSquare },
  { value: 'idea', label: 'Idea', icon: Lightbulb },
  { value: 'suggestion', label: 'Suggestion', icon: MessageSquare },
  { value: 'compliment', label: 'Compliment', icon: ThumbsUp },
  { value: 'observation', label: 'Observation', icon: Eye },
  { value: 'theft', label: 'Theft Report', icon: AlertTriangle },
];

const categoryColors: Record<string, string> = {
  general: 'bg-muted text-muted-foreground',
  idea: 'bg-primary/10 text-primary',
  suggestion: 'bg-accent/50 text-accent-foreground',
  compliment: 'bg-success/10 text-success',
  observation: 'bg-warning/10 text-warning',
  theft: 'bg-destructive/10 text-destructive',
};

export default function StaffMessages() {
  const { user } = useAuth();
  const { isAdmin, isHR } = useRoles();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<any>(null);
  const [form, setForm] = useState({ recipient_id: '', subject: '', message: '', category: 'general' });

  const isBroadcast = form.recipient_id === '__all__';

  const canManage = isAdmin;

  const { data: messages = [] } = useQuery({
    queryKey: ['staff-messages', user?.id, isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('staff_messages')
        .select('*')
        .order('created_at', { ascending: false });
      if (!isAdmin) {
        query = query.or(`sender_id.eq.${user!.id},recipient_id.eq.${user!.id}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Build recipient list based on role
  const { data: recipients = [] } = useQuery({
    queryKey: ['message-recipients', isAdmin, isHR],
    queryFn: async () => {
      if (isAdmin) {
        // Admin: All Staff broadcast + every individual user
        const { data, error } = await supabase.from('profiles').select('user_id, full_name');
        if (error) throw error;
        return [
          { user_id: '__all__', full_name: '📢 All Staff (Broadcast)' },
          ...(data || []),
        ];
      }
      if (isHR) {
        // HR: every individual user (no broadcast)
        const { data, error } = await supabase.from('profiles').select('user_id, full_name');
        if (error) throw error;
        return data || [];
      }
      // Staff: only admin users as recipients
      const { data: adminRoles, error } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin')
        .eq('role_status', 'approved');
      if (error) throw error;
      const adminIds = (adminRoles || []).map((a: any) => a.user_id);
      if (adminIds.length === 0) return [];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', adminIds);
      return profiles || [];
    },
    enabled: !!user,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const catLabel = messageCategories.find(c => c.value === form.category)?.label || 'General';

      if (isBroadcast) {
        // Admin broadcast: send individual message to every user except self
        const targets = recipients.filter(r => r.user_id !== '__all__' && r.user_id !== user!.id);
        for (const target of targets) {
          await supabase.from('staff_messages').insert({
            sender_id: user!.id,
            recipient_id: target.user_id,
            subject: `[Broadcast][${catLabel}] ${form.subject}`,
            message: form.message,
          });
          await supabase.from('notifications').insert({
            user_id: target.user_id,
            title: 'Broadcast Message',
            message: `${form.subject}`,
            type: 'message',
          });
        }
        return;
      }

      // Single recipient
      const { error } = await supabase.from('staff_messages').insert({
        sender_id: user!.id,
        recipient_id: form.recipient_id,
        subject: `[${catLabel}] ${form.subject}`,
        message: form.message,
      });
      if (error) throw error;

      await supabase.from('notifications').insert({
        user_id: form.recipient_id,
        title: 'New Message',
        message: `You have a new ${form.category} message: ${form.subject}`,
        type: 'message',
      });

      // If HR sends to a non-admin: notify all admins with a copy
      if (isHR) {
        const { data: recipientRole } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', form.recipient_id)
          .maybeSingle();
        if (recipientRole?.role !== 'admin') {
          const { data: admins } = await supabase
            .from('user_roles')
            .select('user_id')
            .eq('role', 'admin')
            .eq('role_status', 'approved');
          const senderName = user!.user_metadata?.full_name || user!.email;
          for (const admin of (admins || []).filter((a: any) => a.user_id !== user!.id)) {
            await supabase.from('notifications').insert({
              user_id: admin.user_id,
              title: 'HR Message to Staff (Copy)',
              message: `HR ${senderName} sent a message to staff: ${form.subject}`,
              type: 'message',
            });
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-messages'] });
      setComposeOpen(false);
      setForm({ recipient_id: '', subject: '', message: '', category: 'general' });
      toast({ title: 'Message sent' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('staff_messages').update({ read: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-messages'] }),
  });

  const handleViewMessage = (msg: any) => {
    setSelectedMsg(msg);
    if (!msg.read && msg.recipient_id === user?.id) {
      markReadMutation.mutate(msg.id);
    }
  };

  const unreadCount = messages.filter(m => !m.read && m.recipient_id === user?.id).length;

  // Detect category from subject prefix
  const getCategory = (subject: string) => {
    const match = subject.match(/^\[(.+?)\]\s/);
    if (match) {
      const cat = messageCategories.find(c => c.label === match[1]);
      return cat?.value || 'general';
    }
    return 'general';
  };

  const getCategoryIcon = (category: string) => {
    const cat = messageCategories.find(c => c.value === category);
    const Icon = cat?.icon || MessageSquare;
    return <Icon className="h-3.5 w-3.5" />;
  };

  const cleanSubject = (subject: string) => subject.replace(/^\[.+?\]\s/, '');

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">
          Messages {unreadCount > 0 && <Badge variant="destructive" className="ml-2">{unreadCount} unread</Badge>}
        </h2>
        <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Compose</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Compose Message</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {messageCategories.map(c => (
                      <SelectItem key={c.value} value={c.value}>
                        <span className="flex items-center gap-2">
                          <c.icon className="h-3.5 w-3.5" />{c.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>To</Label>
                <Select value={form.recipient_id} onValueChange={v => setForm({ ...form, recipient_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select recipient" /></SelectTrigger>
                  <SelectContent>
                    {recipients.filter(r => r.user_id !== user?.id).map(r => (
                      <SelectItem key={r.user_id} value={r.user_id}>{r.full_name || r.user_id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Message subject..." />
              </div>
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Your message..." rows={5} />
              </div>
              <Button onClick={() => sendMutation.mutate()} disabled={!form.recipient_id || !form.subject || !form.message || sendMutation.isPending} className="w-full">
                <Send className="h-4 w-4 mr-2" />{sendMutation.isPending ? 'Sending...' : 'Send Message'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Inbox & Sent</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[400px]">
              {messages.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">No messages</div>
              ) : messages.map(m => {
                const category = getCategory(m.subject);
                return (
                  <button
                    key={m.id}
                    onClick={() => handleViewMessage(m)}
                    className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted/50 transition-colors ${
                      selectedMsg?.id === m.id ? 'bg-primary/5' : ''
                    } ${!m.read && m.recipient_id === user?.id ? 'bg-primary/5' : ''}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {!m.read && m.recipient_id === user?.id ? (
                        <Mail className="h-4 w-4 text-primary shrink-0" />
                      ) : (
                        <MailOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${categoryColors[category] || ''}`}>
                        {getCategoryIcon(category)}
                      </Badge>
                      <span className={`text-sm truncate ${!m.read && m.recipient_id === user?.id ? 'font-semibold' : ''}`}>
                        {cleanSubject(m.subject)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">
                        {m.sender_id === user?.id ? 'Sent' : 'Received'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </button>
                );
              })}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Message Detail</CardTitle></CardHeader>
          <CardContent>
            {selectedMsg ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={categoryColors[getCategory(selectedMsg.subject)] || ''}>
                    {messageCategories.find(c => c.value === getCategory(selectedMsg.subject))?.label || 'General'}
                  </Badge>
                  <h3 className="font-semibold">{cleanSubject(selectedMsg.subject)}</h3>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>{selectedMsg.sender_id === user?.id ? 'Sent by you' : 'Received'}</span>
                  <span>{formatDistanceToNow(new Date(selectedMsg.created_at), { addSuffix: true })}</span>
                </div>
                <div className="bg-muted/50 rounded-lg p-4 text-sm whitespace-pre-wrap">{selectedMsg.message}</div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-12">Select a message to view</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
