import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarDays, AlertTriangle, Mail } from 'lucide-react';
import StaffLeaveRequests from '@/components/staff-portal/StaffLeaveRequests';
import StaffComplaints from '@/components/staff-portal/StaffComplaints';
import StaffMessages from '@/components/staff-portal/StaffMessages';

const StaffPortal = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">Staff Portal</h1>
        <p className="text-muted-foreground mt-1">Submit leave requests, log complaints, and communicate with management</p>
      </div>

      <Tabs defaultValue="leave" className="space-y-6">
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
        </TabsList>

        <TabsContent value="leave"><StaffLeaveRequests /></TabsContent>
        <TabsContent value="complaints"><StaffComplaints /></TabsContent>
        <TabsContent value="messages"><StaffMessages /></TabsContent>
      </Tabs>
    </div>
  );
};

export default StaffPortal;
