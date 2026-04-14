import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { User, Save, CalendarDays, AlertTriangle, Mail } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import StaffLeaveRequests from '@/components/staff-portal/StaffLeaveRequests';
import StaffComplaints from '@/components/staff-portal/StaffComplaints';
import StaffMessages from '@/components/staff-portal/StaffMessages';
import { formatNairaCompact } from '@/lib/currency';

const genderOptions = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

const maritalStatusOptions = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
];

const nigerianStates = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
  "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe",
  "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
  "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara"
];

interface StaffProfile {
  id: string;
  full_name: string;
  phone_number: string | null;
  date_of_birth: string | null;
  gender: string | null;
  marital_status: string | null;
  state_of_origin: string | null;
  lga: string | null;
  residential_address: string | null;
  email_address: string | null;
  nin: string | null;
  position: string;
  salary: number | null;
  department_id: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  departments?: { name: string } | null;
}

const MyProfile = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get('tab') || 'profile';
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (user) fetchProfile();
  }, [user]);

  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('*, departments(name)')
        .eq('linked_user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setProfile(data as unknown as StaffProfile);
        setForm({
          phone_number: data.phone_number || '',
          residential_address: data.residential_address || '',
          email_address: data.email_address || '',
          gender: data.gender || '',
          marital_status: data.marital_status || '',
          state_of_origin: data.state_of_origin || '',
          lga: data.lga || '',
          emergency_contact_name: data.emergency_contact_name || '',
          emergency_contact_phone: data.emergency_contact_phone || '',
          emergency_contact_relationship: data.emergency_contact_relationship || '',
        });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('staff_profiles')
        .update({
          phone_number: form.phone_number || null,
          residential_address: form.residential_address || null,
          email_address: form.email_address || null,
          gender: form.gender || null,
          marital_status: form.marital_status || null,
          state_of_origin: form.state_of_origin || null,
          lga: form.lga || null,
          emergency_contact_name: form.emergency_contact_name || null,
          emergency_contact_phone: form.emergency_contact_phone || null,
          emergency_contact_relationship: form.emergency_contact_relationship || null,
        })
        .eq('id', profile.id);
      if (error) throw error;
      toast({ title: 'Success', description: 'Profile updated successfully' });
      fetchProfile();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleRequestProfile = async () => {
    if (!user) return;
    setRequesting(true);
    try {
      // Send notification to all admins
      const { data: adminRoles } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin')
        .eq('role_status', 'approved');

      const profileName = user.user_metadata?.full_name || user.email || 'A user';

      for (const admin of (adminRoles || [])) {
        await supabase.from('notifications').insert({
          user_id: admin.user_id,
          title: 'Profile Assignment Request',
          message: `${profileName} has requested to be linked to a staff profile.`,
          type: 'info',
          related_id: user.id,
        });
      }

      toast({ title: 'Request Sent', description: 'Your profile assignment request has been sent to the administrator.' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setRequesting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
        <User className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-2xl font-bold mb-2">No Profile Found</h2>
        <p className="text-muted-foreground max-w-md">
          Your account has not been linked to a staff profile yet. You can request a profile assignment below, or contact your administrator.
        </p>
        <Button onClick={handleRequestProfile} disabled={requesting}>
          {requesting ? 'Requesting...' : 'Request Profile Assignment'}
        </Button>
      </div>
    );
  }

  const positionLabel = profile.position.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <User className="h-8 w-8" /> My Profile
        </h1>
        <p className="text-muted-foreground mt-1">View your profile and submit requests to management</p>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-6">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="profile" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <User className="h-4 w-4 mr-2" />My Profile
          </TabsTrigger>
          <TabsTrigger value="leave" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <CalendarDays className="h-4 w-4 mr-2" />Leave Requests
          </TabsTrigger>
          <TabsTrigger value="complaints" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <AlertTriangle className="h-4 w-4 mr-2" />Complaints
          </TabsTrigger>
          <TabsTrigger value="messages" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <Mail className="h-4 w-4 mr-2" />Messages
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">

      {/* Read-only info */}
      <Card>
        <CardHeader><CardTitle>Employment Details</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-muted-foreground">Name</span><p className="font-medium">{profile.full_name}</p></div>
            <div><span className="text-muted-foreground">Position</span><p className="font-medium">{positionLabel}</p></div>
            <div><span className="text-muted-foreground">Department</span><p className="font-medium">{profile.departments?.name || 'N/A'}</p></div>
            <div><span className="text-muted-foreground">Salary</span><p className="font-medium">{profile.salary ? formatNairaCompact(profile.salary) : 'N/A'}</p></div>
          </div>
        </CardContent>
      </Card>

      {/* Editable fields */}
      <Card>
        <CardHeader><CardTitle>Personal Information</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input value={form.phone_number} onChange={e => setForm({ ...form, phone_number: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Email Address</Label>
              <Input type="email" value={form.email_address} onChange={e => setForm({ ...form, email_address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Gender</Label>
              <Select value={form.gender} onValueChange={v => setForm({ ...form, gender: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{genderOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Marital Status</Label>
              <Select value={form.marital_status} onValueChange={v => setForm({ ...form, marital_status: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{maritalStatusOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>State of Origin</Label>
              <Select value={form.state_of_origin} onValueChange={v => setForm({ ...form, state_of_origin: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{nigerianStates.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>LGA</Label>
              <Input value={form.lga} onChange={e => setForm({ ...form, lga: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Residential Address</Label>
            <Textarea value={form.residential_address} onChange={e => setForm({ ...form, residential_address: e.target.value })} rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Emergency Contact</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Contact Name</Label>
              <Input value={form.emergency_contact_name} onChange={e => setForm({ ...form, emergency_contact_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Contact Phone</Label>
              <Input value={form.emergency_contact_phone} onChange={e => setForm({ ...form, emergency_contact_phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Relationship</Label>
              <Input value={form.emergency_contact_relationship} onChange={e => setForm({ ...form, emergency_contact_relationship: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bank details - read only */}
      <Card>
        <CardHeader><CardTitle>Bank Details</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><span className="text-muted-foreground">Bank Name</span><p className="font-medium">{profile.bank_name || 'N/A'}</p></div>
            <div><span className="text-muted-foreground">Account Number</span><p className="font-medium">{profile.account_number || 'N/A'}</p></div>
            <div><span className="text-muted-foreground">Account Name</span><p className="font-medium">{profile.account_name || 'N/A'}</p></div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Contact admin to update bank details.</p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

        </TabsContent>

        <TabsContent value="leave">
          <StaffLeaveRequests />
        </TabsContent>

        <TabsContent value="complaints">
          <StaffComplaints />
        </TabsContent>

        <TabsContent value="messages">
          <StaffMessages />
        </TabsContent>

      </Tabs>
    </div>
  );
};

export default MyProfile;
