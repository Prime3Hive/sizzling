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

const leaveTypes = [
  { value: 'casual', label: 'Casual Leave' },
  { value: 'sick', label: 'Sick Leave' },
  { value: 'unpaid', label: 'Unpaid Leave (Absence)' },
];

const SICK_LIMIT = 4;       // occurrences per year
const CASUAL_LIMIT = 14;    // days per year

const statusColors: Record<string, string> = {
  pending: 'bg-warning/10 text-warning border-warning/20',
  approved: 'bg-success/10 text-success border-success/20',
  rejected: 'bg-destructive/10 text-destructive border-destructive/20',
};

export default function StaffLeaveRequests() {
  const { user } = useAuth();
  const { isAdmin, isHR } = useRoles();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [responseOpen, setResponseOpen] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [responseStatus, setResponseStatus] = useState('approved');
  const [form, setForm] = useState({ leave_type: 'casual', start_date: '', end_date: '', reason: '' });

  const canManage = isAdmin;
  const { loading: roleLoading } = useRoles();

  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;

  const { data: myYearRequests = [] } = useQuery({
    queryKey: ['my-year-leave', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_leave_requests')
        .select('leave_type, start_date, end_date, status')
        .eq('user_id', user!.id)
        .in('status', ['pending', 'approved'])
        .gte('start_date', yearStart)
        .lte('start_date', yearEnd);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !roleLoading,
  });

  const sickUsed = myYearRequests.filter(r => r.leave_type === 'sick').length;
  const casualDaysUsed = myYearRequests
    .filter(r => r.leave_type === 'casual')
    .reduce((sum, r) => {
      const days = Math.floor((new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86400000) + 1;
      return sum + days;
    }, 0);
  const sickRemaining = SICK_LIMIT - sickUsed;
  const casualDaysRemaining = CASUAL_LIMIT - casualDaysUsed;

  // Server-side role filtering: admins fetch all requests, staff fetch only their own.
  // This prevents data leaking to non-admin users if RLS is ever misconfigured.
  const { data: requests = [] } = useQuery({
    queryKey: ['leave-requests', canManage ? 'all' : user?.id],
    queryFn: async () => {
      let q = supabase
        .from('staff_leave_requests')
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

      const { error } = await supabase.from('staff_leave_requests').insert({
        user_id: user!.id,
        staff_profile_id: profile?.id || null,
        leave_type: form.leave_type,
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason || null,
      });
      if (error) throw error;

      // Notify admins and HR
      const { data: notifyRoles } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('role', ['admin', 'hr'])
        .eq('role_status', 'approved');

      const userName = user!.user_metadata?.full_name || user!.email;
      for (const r of (notifyRoles || []).filter(r => r.user_id !== user!.id)) {
        await supabase.from('notifications').insert({
          user_id: r.user_id,
          title: 'New Leave Request',
          message: `${userName} submitted a ${form.leave_type.replace(/_/g, ' ')} leave request.`,
          type: 'leave_request',
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-year-leave', user?.id] });
      setOpen(false);
      setForm({ leave_type: 'casual', start_date: '', end_date: '', reason: '' });
      toast({ title: 'Leave request submitted' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const respondMutation = useMutation({
    mutationFn: async ({ id, status, response }: { id: string; status: string; response: string }) => {
      const { error } = await supabase
        .from('staff_leave_requests')
        .update({ status, admin_response: response, responded_by: user!.id, responded_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;

      const req = requests.find(r => r.id === id);
      if (req) {
        await supabase.from('notifications').insert({
          user_id: req.user_id,
          title: `Leave Request ${status.charAt(0).toUpperCase() + status.slice(1)}`,
          message: `Your ${(req.leave_type as string).replace(/_/g, ' ')} leave request has been ${status}.${response ? ' Response: ' + response : ''}`,
          type: 'leave_request',
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
      setResponseOpen(null);
      setResponseText('');
      toast({ title: 'Response sent' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const handleSubmit = () => {
    if (!form.start_date || !form.end_date) return;
    if (form.leave_type === 'sick') {
      if (sickUsed >= SICK_LIMIT) {
        toast({ title: 'Sick leave limit reached', description: `You have used all ${SICK_LIMIT} sick leave occurrences for ${currentYear}.`, variant: 'destructive' });
        return;
      }
    }
    if (form.leave_type === 'casual') {
      const requestDays = Math.floor((new Date(form.end_date).getTime() - new Date(form.start_date).getTime()) / 86400000) + 1;
      if (casualDaysUsed + requestDays > CASUAL_LIMIT) {
        toast({ title: 'Casual leave limit exceeded', description: `You only have ${casualDaysRemaining} casual leave day(s) remaining for ${currentYear}.`, variant: 'destructive' });
        return;
      }
    }
    createMutation.mutate();
  };

  // When canManage=false the query already returns only own requests (server-filtered).
  // When canManage=true it fetches all, so we split here for the two-table view.
  const myRequests = canManage ? requests.filter(r => r.user_id === user?.id) : requests;
  const otherRequests = canManage ? requests.filter(r => r.user_id !== user?.id) : [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Leave Requests</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />New Request</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Submit Leave Request</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="rounded-md bg-muted/40 border px-3 py-2 text-sm space-y-1">
                <p>Casual leave: <span className={casualDaysRemaining <= 0 ? 'text-destructive font-medium' : 'text-success font-medium'}>{casualDaysRemaining} of {CASUAL_LIMIT} days remaining</span></p>
                <p>Sick leave: <span className={sickRemaining <= 0 ? 'text-destructive font-medium' : 'text-success font-medium'}>{sickRemaining} of {SICK_LIMIT} occurrences remaining</span></p>
              </div>
              <div className="space-y-2">
                <Label>Leave Type</Label>
                <Select value={form.leave_type} onValueChange={v => setForm({ ...form, leave_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{leaveTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Reason</Label>
                <Textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Reason for leave..." rows={3} />
              </div>
              <Button onClick={handleSubmit} disabled={!form.start_date || !form.end_date || createMutation.isPending} className="w-full">
                <Send className="h-4 w-4 mr-2" />{createMutation.isPending ? 'Submitting...' : 'Submit Request'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* My Requests */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b bg-muted/30">
            <p className="text-sm font-medium text-muted-foreground">My Requests</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Response</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {myRequests.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No requests yet</TableCell></TableRow>
              ) : myRequests.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium capitalize">{(r.leave_type as string).replace(/_/g, ' ')}</TableCell>
                  <TableCell>{format(new Date(r.start_date), 'MMM d, yyyy')}</TableCell>
                  <TableCell>{format(new Date(r.end_date), 'MMM d, yyyy')}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{r.reason || '—'}</TableCell>
                  <TableCell><Badge variant="outline" className={statusColors[r.status] || ''}>{r.status}</Badge></TableCell>
                  <TableCell className="max-w-[200px] truncate">{r.admin_response || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Staff Requests: Admin can view + respond; HR can view only */}
      {(isAdmin || isHR) && otherRequests.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b bg-muted/30">
              <p className="text-sm font-medium text-muted-foreground">Staff Requests</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Response</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {otherRequests.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium capitalize">{(r.leave_type as string).replace(/_/g, ' ')}</TableCell>
                    <TableCell>{format(new Date(r.start_date), 'MMM d, yyyy')}</TableCell>
                    <TableCell>{format(new Date(r.end_date), 'MMM d, yyyy')}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{r.reason || '—'}</TableCell>
                    <TableCell><Badge variant="outline" className={statusColors[r.status] || ''}>{r.status}</Badge></TableCell>
                    <TableCell className="max-w-[200px] truncate">{r.admin_response || '—'}</TableCell>
                    <TableCell>
                      {r.status === 'pending' && canManage && (
                        <Dialog open={responseOpen === r.id} onOpenChange={v => { setResponseOpen(v ? r.id : null); setResponseText(''); }}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline">Respond</Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Respond to Leave Request</DialogTitle></DialogHeader>
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <Label>Decision</Label>
                                <Select value={responseStatus} onValueChange={setResponseStatus}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="approved">Approve</SelectItem>
                                    <SelectItem value="rejected">Reject</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label>Response Message</Label>
                                <Textarea value={responseText} onChange={e => setResponseText(e.target.value)} placeholder="Optional message..." rows={3} />
                              </div>
                              <Button onClick={() => respondMutation.mutate({ id: r.id, status: responseStatus, response: responseText })} disabled={respondMutation.isPending} className="w-full">
                                {respondMutation.isPending ? 'Sending...' : 'Send Response'}
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
