import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useRoles } from '@/hooks/useRoles';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Shield, User, Building, Link2 } from 'lucide-react';

interface UserItem {
  id: string;
  user_id: string;
  full_name?: string;
  role: 'admin' | 'manager' | 'employee' | 'hr';
  department_name?: string;
  department_id?: string;
  role_status?: string;
  has_role_record?: boolean;
  linked_staff_profile?: string;
}

interface Department {
  id: string;
  name: string;
  description?: string;
}

interface StaffProfile {
  id: string;
  full_name: string;
  linked_user_id: string | null;
  position: string;
}

interface UserRoleData {
  id: string;
  user_id: string;
  role: 'admin' | 'manager' | 'employee' | 'hr';
  role_status: string;
  department_id: string | null;
  departments?: { name: string } | null;
}

interface ProfileData {
  user_id: string;
  full_name: string;
}

export default function UserManagement() {
  const { isAdmin } = useRoles();
  const { user } = useAuth();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staffProfiles, setStaffProfiles] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<'admin' | 'manager' | 'employee' | 'hr'>('employee');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('none');
  const [selectedStaffProfileId, setSelectedStaffProfileId] = useState<string>('none');

  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptDescription, setNewDeptDescription] = useState('');
  const [deptDialogOpen, setDeptDialogOpen] = useState(false);

  useEffect(() => {
    if (isAdmin) fetchData();
  }, [isAdmin]);

  const fetchData = async () => {
    try {
      setLoading(true);

      const [profilesRes, rolesRes, deptRes, staffRes] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name'),
        supabase.from('user_roles').select('id, user_id, role, role_status, department_id, departments(name)'),
        supabase.from('departments').select('*').order('name'),
        supabase.from('staff_profiles').select('id, full_name, linked_user_id, position'),
      ]);

      if (profilesRes.error) {
        toast({ title: 'Error', description: 'Failed to fetch users', variant: 'destructive' });
        return;
      }

      const rolesData = (rolesRes.data || []) as unknown as UserRoleData[];
      const staffData = (staffRes.data || []) as unknown as StaffProfile[];
      const profilesData = (profilesRes.data || []) as unknown as ProfileData[];
      
      const rolesMap = new Map(rolesData.map((r) => [r.user_id, r]));
      const staffLinkMap = new Map(staffData.filter((s) => s.linked_user_id).map((s) => [s.linked_user_id, s.full_name]));

      const formattedUsers = profilesData.map((profile) => {
        const roleData = rolesMap.get(profile.user_id);
        return {
          id: roleData?.id || profile.user_id,
          user_id: profile.user_id,
          full_name: profile.full_name,
          role: roleData?.role || 'employee',
          department_id: roleData?.department_id,
          department_name: roleData?.departments?.name,
          role_status: roleData?.role_status || 'approved',
          has_role_record: !!roleData,
          linked_staff_profile: staffLinkMap.get(profile.user_id) || null,
        };
      });

      setUsers(formattedUsers);
      setDepartments(deptRes.data || []);
      setStaffProfiles(staffRes.data || []);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to fetch user data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleAssignRole = async () => {
    if (!selectedUserId || !user?.id) return;
    try {
      const targetUser = users.find(u => u.user_id === selectedUserId);
      const roleStatus = ['admin', 'manager', 'hr'].includes(selectedRole) ? 'pending' : 'approved';

      if (targetUser?.has_role_record) {
        const { error } = await supabase.from('user_roles').update({
          role: selectedRole,
          department_id: selectedDepartmentId === 'none' ? null : selectedDepartmentId,
          assigned_by: user.id,
          assigned_at: new Date().toISOString(),
          role_status: roleStatus,
        }).eq('user_id', selectedUserId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('user_roles').insert({
          user_id: selectedUserId,
          role: selectedRole,
          department_id: selectedDepartmentId === 'none' ? null : selectedDepartmentId,
          assigned_by: user.id,
          role_status: roleStatus,
        });
        if (error) throw error;
      }

      toast({ title: 'Success', description: 'Role assigned successfully' });
      setAssignDialogOpen(false);
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleLinkProfile = async () => {
    if (!selectedUserId || selectedStaffProfileId === 'none') return;
    try {
      const { error } = await supabase
        .from('staff_profiles')
        .update({ linked_user_id: selectedUserId })
        .eq('id', selectedStaffProfileId);
      if (error) throw error;

      toast({ title: 'Success', description: 'Staff profile linked to user account' });
      setLinkDialogOpen(false);
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleCreateDepartment = async () => {
    if (!newDeptName.trim()) return;
    try {
      const { error } = await supabase.from('departments').insert({
        name: newDeptName.trim(),
        description: newDeptDescription.trim() || null,
      });
      if (error) throw error;
      toast({ title: 'Success', description: 'Department created' });
      setDeptDialogOpen(false);
      setNewDeptName('');
      setNewDeptDescription('');
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error?.message || 'Failed to create department', variant: 'destructive' });
    }
  };

  const handleApproveRole = async (userId: string) => {
    try {
      const { error } = await supabase.from('user_roles').update({ role_status: 'approved' }).eq('user_id', userId);
      if (error) throw error;
      toast({ title: 'Success', description: 'Role approved' });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-6">
            <Shield className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold">Access Denied</h3>
            <p className="text-muted-foreground">Only administrators can access user management.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) return <div>Loading...</div>;

  const unlinkedProfiles = staffProfiles.filter(sp => !sp.linked_user_id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground">Manage users, roles, departments, and profile assignments</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={deptDialogOpen} onOpenChange={setDeptDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Building className="h-4 w-4 mr-2" />New Department</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Department</DialogTitle>
                <DialogDescription>Add a new department to organize your users.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Department Name</Label>
                  <Input value={newDeptName} onChange={e => setNewDeptName(e.target.value)} placeholder="Enter department name" />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input value={newDeptDescription} onChange={e => setNewDeptDescription(e.target.value)} placeholder="Enter description" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeptDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleCreateDepartment}>Create Department</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Departments */}
      <Card>
        <CardHeader>
          <CardTitle>Departments</CardTitle>
          <CardDescription>Active departments in your organization</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {departments.map(dept => (
              <Card key={dept.id}>
                <CardContent className="pt-4">
                  <h3 className="font-semibold">{dept.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{dept.description}</p>
                  <Badge variant="secondary" className="mt-2">{users.filter(u => u.department_id === dept.id).length} users</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Users & Roles</CardTitle>
          <CardDescription>Manage user roles, departments, and staff profile links</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Staff Profile</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(u => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      <span>{u.full_name || 'No name'}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === 'admin' ? 'default' : u.role === 'manager' || u.role === 'hr' ? 'secondary' : 'outline'}>
                      {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role_status === 'pending' ? 'destructive' : 'outline'}>
                      {u.role_status === 'pending' ? 'Pending' : 'Approved'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {u.department_name ? <Badge variant="outline">{u.department_name}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {u.linked_staff_profile ? (
                      <Badge variant="outline" className="text-primary border-primary/30">{u.linked_staff_profile}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">Not linked</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {u.role_status === 'pending' && (
                        <Button variant="default" size="sm" onClick={() => handleApproveRole(u.user_id)}>Approve</Button>
                      )}
                      {!u.linked_staff_profile && (
                        <Dialog open={linkDialogOpen && selectedUserId === u.user_id} onOpenChange={setLinkDialogOpen}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" onClick={() => { setSelectedUserId(u.user_id); setSelectedStaffProfileId('none'); setLinkDialogOpen(true); }}>
                              <Link2 className="h-3 w-3 mr-1" />Link Profile
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Link Staff Profile</DialogTitle>
                              <DialogDescription>Assign an existing staff profile to {u.full_name}</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <Label>Staff Profile</Label>
                              <Select value={selectedStaffProfileId} onValueChange={setSelectedStaffProfileId}>
                                <SelectTrigger><SelectValue placeholder="Select staff profile" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Select a profile...</SelectItem>
                                  {unlinkedProfiles.map(sp => (
                                    <SelectItem key={sp.id} value={sp.id}>{sp.full_name} ({sp.position.replace(/_/g, ' ')})</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>Cancel</Button>
                              <Button onClick={handleLinkProfile} disabled={selectedStaffProfileId === 'none'}>Link Profile</Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                      <Dialog open={assignDialogOpen && selectedUserId === u.user_id} onOpenChange={setAssignDialogOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" onClick={() => { setSelectedUserId(u.user_id); setSelectedRole(u.role); setSelectedDepartmentId(u.department_id || 'none'); setAssignDialogOpen(true); }}>
                            Edit Role
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Assign Role & Department</DialogTitle>
                            <DialogDescription>Update role for {u.full_name}</DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="space-y-2">
                              <Label>Role</Label>
                              <Select value={selectedRole} onValueChange={(v: any) => setSelectedRole(v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="employee">Staff / Employee</SelectItem>
                                  <SelectItem value="hr">HR</SelectItem>
                                  <SelectItem value="manager">Manager</SelectItem>
                                  <SelectItem value="admin">Admin</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>Department</Label>
                              <Select value={selectedDepartmentId} onValueChange={setSelectedDepartmentId}>
                                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No department</SelectItem>
                                  {departments.map(dept => (
                                    <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
                            <Button onClick={handleAssignRole}>Assign Role</Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}