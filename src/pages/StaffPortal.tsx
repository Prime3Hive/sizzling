import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarDays, AlertTriangle, Mail, TrendingUp, FileText, ClipboardList, ListChecks, CalendarCheck } from 'lucide-react';
import StaffLeaveRequests from '@/components/staff-portal/StaffLeaveRequests';
import StaffComplaints from '@/components/staff-portal/StaffComplaints';
import StaffMessages from '@/components/staff-portal/StaffMessages';
import StaffKPITasks from '@/components/staff-portal/StaffKPITasks';
import StaffMyDocuments from '@/components/staff-portal/StaffMyDocuments';
import StaffAttendance from '@/components/staff-portal/StaffAttendance';
import MyReports from '@/components/reports/MyReports';
import MyChecklists from '@/components/reports/MyChecklists';
import { useSearchParams } from 'react-router-dom';

const VALID_TABS = ['leave', 'attendance', 'complaints', 'messages', 'reports', 'checklists', 'performance', 'documents'];

const StaffPortal = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = VALID_TABS.includes(tabParam || '') ? tabParam! : 'leave';
  const handleTabChange = (tab: string) =>
    setSearchParams(tab === 'leave' ? {} : { tab }, { replace: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">Staff Portal</h1>
        <p className="text-muted-foreground mt-1">Submit leave requests, log complaints, and communicate with management</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="bg-muted/50 p-1 flex-wrap h-auto gap-1">
          <TabsTrigger value="leave" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <CalendarDays className="h-4 w-4 mr-2" />Leave Requests
          </TabsTrigger>
          <TabsTrigger value="attendance" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <CalendarCheck className="h-4 w-4 mr-2" />My Attendance
          </TabsTrigger>
          <TabsTrigger value="complaints" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <AlertTriangle className="h-4 w-4 mr-2" />Complaints
          </TabsTrigger>
          <TabsTrigger value="messages" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <Mail className="h-4 w-4 mr-2" />Messages
          </TabsTrigger>
          <TabsTrigger value="reports" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <ClipboardList className="h-4 w-4 mr-2" />My Reports
          </TabsTrigger>
          <TabsTrigger value="checklists" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <ListChecks className="h-4 w-4 mr-2" />My Checklists
          </TabsTrigger>
          <TabsTrigger value="performance" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <TrendingUp className="h-4 w-4 mr-2" />My Performance
          </TabsTrigger>
          <TabsTrigger value="documents" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <FileText className="h-4 w-4 mr-2" />My Documents
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leave"><StaffLeaveRequests /></TabsContent>
        <TabsContent value="attendance"><StaffAttendance /></TabsContent>
        <TabsContent value="complaints"><StaffComplaints /></TabsContent>
        <TabsContent value="messages"><StaffMessages /></TabsContent>
        <TabsContent value="reports"><MyReports /></TabsContent>
        <TabsContent value="checklists"><MyChecklists /></TabsContent>
        <TabsContent value="performance"><StaffKPITasks /></TabsContent>
        <TabsContent value="documents"><StaffMyDocuments /></TabsContent>
      </Tabs>
    </div>
  );
};

export default StaffPortal;
