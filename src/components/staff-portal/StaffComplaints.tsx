import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Send } from 'lucide-react';
import { format } from 'date-fns';

const priorities = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const statusColors: Record<string, string> = {
  open: 'bg-warning/10 text-warning border-warning/20',
  in_progress: 'bg-primary/10 text-primary border-primary/20',
  resolved: 'bg-success/10 text-success border-success/20',
  closed: 'bg-muted text-muted-foreground border-border',
};

const priorityColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-warning/10 text-warning',
  high: 'bg-destructive/10 text-destructive',
  urgent: 'bg-destructive text-destructive-foreground',
};

export default function StaffComplaints() {
  const { user } = useAuth();
  const { isAdmin } = useRoles();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [responseOpen, setResponseOpen] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [responseStatus, setResponseStatus] = useState('in_progress');
  const [form, setForm] = useState({ subject: '', description: '', priority: 'medium' });

  const canManage = isAdmin;
  const { loading: roleLoading } = useRoles();

  // Server-side role filtering: admins fetch all complaints, staff fetch only their own.
  const { data: complaints = [] } = useQuery({
    queryKey: ['complaints', canManage ? 'all' : user?.id],
    queryFn: async () => {
      let q = supabase
        .from('staff_complaints')
        .select('*')
        .order('created_at', { ascending: false });
      if (!canManage) q = q.eq('user_id', user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !roleLoading,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: profile } = await supabase
        .from('staff_profiles')
        .select('id')
        .eq('linked_user_id', user!.id)
        .maybeSingle();

      const { error } = await supabase.from('staff_complaints').insert({
        user_id: user!.id,
        staff_profile_id: profile?.id || null,
        subject: form.subject,
        description: form.description,
        priority: form.priority,
      });
      if (error) throw error;

      // Notify admins only (exclude self)
      const { data: adminRoles } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin')
        .eq('role_status', 'approved');

      const userName = user!.user_metadata?.full_name || user!.email;
      for (const admin of (adminRoles || []).filter(a => a.user_id !== user!.id)) {
        await supabase.from('notifications').insert({
          user_id: admin.user_id,
          title: 'New Staff Complaint',
          message: `${userName} logged a ${form.priority} priority complaint: ${form.subject}`,
          type: 'complaint',
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      setOpen(false);
      setForm({ subject: '', description: '', priority: 'medium' });
      toast({ title: 'Complaint submitted' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const respondMutation = useMutation({
    mutationFn: async ({ id, status, response }: { id: string; status: string; response: string }) => {
      const { error } = await supabase
        .from('staff_complaints')
        .update({ status, admin_response: response, responded_by: user!.id, responded_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;

      const complaint = complaints.find(c => c.id === id);
      if (complaint) {
        await supabase.from('notifications').insert({
          user_id: complaint.user_id,
          title: `Complaint ${status === 'resolved' ? 'Resolved' : 'Updated'}`,
          message: `Your complaint "${complaint.subject}" has been ${status.replace('_', ' ')}.${response ? ' Response: ' + response : ''}`,
          type: 'complaint',
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      setResponseOpen(null);
      setResponseText('');
      toast({ title: 'Response sent' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  // When canManage=false query already returns only own complaints (server-filtered).
  const myComplaints = canManage ? complaints.filter(c => c.user_id === user?.id) : complaints;
  const otherComplaints = canManage ? complaints.filter(c => c.user_id !== user?.id) : [];

  const renderComplaintTable = (items: typeof complaints, showActions: boolean) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Subject</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Response</TableHead>
          {showActions && <TableHead>Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow><TableCell colSpan={showActions ? 6 : 5} className="text-center py-6 text-muted-foreground">No complaints</TableCell></TableRow>
        ) : items.map(c => (
          <TableRow key={c.id}>
            <TableCell className="font-medium">{c.subject}</TableCell>
            <TableCell><Badge variant="outline" className={priorityColors[c.priority] || ''}>{c.priority}</Badge></TableCell>
            <TableCell><Badge variant="outline" className={statusColors[c.status] || ''}>{c.status.replace('_', ' ')}</Badge></TableCell>
            <TableCell>{format(new Date(c.created_at), 'MMM d, yyyy')}</TableCell>
            <TableCell className="max-w-[200px] truncate">{c.admin_response || '—'}</TableCell>
            {showActions && (
              <TableCell>
                {(c.status === 'open' || c.status === 'in_progress') && (
                  <Dialog open={responseOpen === c.id} onOpenChange={v => { setResponseOpen(v ? c.id : null); setResponseText(''); }}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">Respond</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Respond to Complaint</DialogTitle></DialogHeader>
                      <div className="space-y-4">
                        <div className="p-3 bg-muted rounded-lg text-sm">
                          <p className="font-medium">{c.subject}</p>
                          <p className="text-muted-foreground mt-1">{c.description}</p>
                        </div>
                        <div className="space-y-2">
                          <Label>Status</Label>
                          <Select value={responseStatus} onValueChange={setResponseStatus}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="resolved">Resolved</SelectItem>
                              <SelectItem value="closed">Closed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Response</Label>
                          <Textarea value={responseText} onChange={e => setResponseText(e.target.value)} placeholder="Your response..." rows={3} />
                        </div>
                        <Button onClick={() => respondMutation.mutate({ id: c.id, status: responseStatus, response: responseText })} disabled={respondMutation.isPending} className="w-full">
                          {respondMutation.isPending ? 'Sending...' : 'Send Response'}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Complaints</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Log Complaint</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Log a Complaint</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Brief subject..." />
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{priorities.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe the issue in detail..." rows={4} />
              </div>
              <Button onClick={() => createMutation.mutate()} disabled={!form.subject || !form.description || createMutation.isPending} className="w-full">
                <Send className="h-4 w-4 mr-2" />{createMutation.isPending ? 'Submitting...' : 'Submit Complaint'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b bg-muted/30">
            <p className="text-sm font-medium text-muted-foreground">My Complaints</p>
          </div>
          {renderComplaintTable(myComplaints, false)}
        </CardContent>
      </Card>

      {canManage && otherComplaints.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b bg-muted/30">
              <p className="text-sm font-medium text-muted-foreground">Staff Complaints</p>
            </div>
            {renderComplaintTable(otherComplaints, true)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
