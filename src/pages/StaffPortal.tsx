import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarDays, AlertTriangle, Mail, TrendingUp } from 'lucide-react';
import StaffLeaveRequests from '@/components/staff-portal/StaffLeaveRequests';
import StaffComplaints from '@/components/staff-portal/StaffComplaints';
import StaffMessages from '@/components/staff-portal/StaffMessages';
import StaffKPITasks from '@/components/staff-portal/StaffKPITasks';
import { useSearchParams } from 'react-router-dom';

const VALID_TABS = ['leave', 'complaints', 'messages', 'performance'];

const StaffPortal = () => {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const defaultTab = VALID_TABS.includes(tabParam || '') ? tabParam! : 'leave';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">Staff Portal</h1>
        <p className="text-muted-foreground mt-1">Submit leave requests, log complaints, and communicate with management</p>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-6">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="leave" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <CalendarDays className="h-4 w-4 mr-2" />Leave Requests
          </TabsTrigger>
          <TabsTrigger value="complaints" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <AlertTriangle className="h-4 w-4 mr-2" />Complaints
          </TabsTrigger>
          <TabsTrigger value="messages" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <Mail className="h-4 w-4 mr-2" />Messages
          </TabsTrigger>
          <TabsTrigger value="performance" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <TrendingUp className="h-4 w-4 mr-2" />My Performance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leave"><StaffLeaveRequests /></TabsContent>
        <TabsContent value="complaints"><StaffComplaints /></TabsContent>
        <TabsContent value="messages"><StaffMessages /></TabsContent>
        <TabsContent value="performance"><StaffKPITasks /></TabsContent>
      </Tabs>
    </div>
  );
};

export default StaffPortal;
