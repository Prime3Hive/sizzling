import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useRoles } from "@/hooks/useRoles";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Pencil, Trash2, Download, Printer, Search, X } from "lucide-react";
import StaffDocuments from "@/components/staff/StaffDocuments";
import { formatNairaCompact } from "@/lib/currency";
import { exportStaffProfilePDF, printStaffProfile } from "@/lib/staffProfileExport";
import StaffProfilePrintable from "@/components/StaffProfilePrintable";

interface Department {
  id: string;
  name: string;
}

interface StaffProfile {
  id: string;
  user_id: string;
  full_name: string;
  phone_number: string | null;
  date_of_birth: string | null;
  year_of_joining: number | null;
  department_id: string | null;
  salary: number | null;
  passport_path: string | null;
  skills_experience: string | null;
  position: string;
  created_at: string;
  updated_at: string;
  departments?: Department;
  // New fields
  gender: string | null;
  marital_status: string | null;
  state_of_origin: string | null;
  lga: string | null;
  residential_address: string | null;
  email_address: string | null;
  nin: string | null;
  employment_type: string | null;
  employment_date: string | null;
  level_of_education: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  linked_user_id: string | null;
}

const positionOptions = [
  { value: "managing_director", label: "Managing Director" },
  { value: "general_manager", label: "General Manager" },
  { value: "kitchen_manager", label: "Kitchen Manager" },
  { value: "event_manager", label: "Event Manager" },
  { value: "supervisor", label: "Supervisor" },
  { value: "staff", label: "Staff" },
];

const genderOptions = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

const maritalStatusOptions = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
];

const employmentTypeOptions = [
  { value: "full_time", label: "Full Time" },
  { value: "part_time", label: "Part Time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
];

const educationOptions = [
  { value: "primary", label: "Primary School" },
  { value: "secondary", label: "Secondary School (SSCE/WAEC)" },
  { value: "ond", label: "OND/NCE" },
  { value: "hnd", label: "HND" },
  { value: "bsc", label: "Bachelor's Degree (BSc/BA)" },
  { value: "msc", label: "Master's Degree (MSc/MA)" },
  { value: "phd", label: "Doctorate (PhD)" },
  { value: "professional", label: "Professional Certification" },
];

const nigerianStates = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", 
  "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe", 
  "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", 
  "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", 
  "Taraba", "Yobe", "Zamfara"
];

const StaffProfiles = () => {
  const navigate = useNavigate();
  const { isAdmin, isHR, loading: rolesLoading } = useRoles();
  const { toast } = useToast();
  const [staffProfiles, setStaffProfiles] = useState<StaffProfile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<StaffProfile | null>(null);
  const [passportFile, setPassportFile] = useState<File | null>(null);
  const [exportingProfile, setExportingProfile] = useState<StaffProfile | null>(null);
  const printableRef = useRef<HTMLDivElement>(null);
  const exportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const printTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Search and filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDepartment, setFilterDepartment] = useState<string>("all");
  const [filterPosition, setFilterPosition] = useState<string>("all");

  // Filtered staff profiles
  const filteredProfiles = staffProfiles.filter((profile) => {
    const matchesSearch = searchQuery === "" || 
      profile.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      profile.email_address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      profile.phone_number?.includes(searchQuery);
    
    const matchesDepartment = filterDepartment === "all" || 
      profile.department_id === filterDepartment;
    
    const matchesPosition = filterPosition === "all" || 
      profile.position === filterPosition;
    
    return matchesSearch && matchesDepartment && matchesPosition;
  });

  const clearFilters = () => {
    setSearchQuery("");
    setFilterDepartment("all");
    setFilterPosition("all");
  };

  const hasActiveFilters = searchQuery !== "" || filterDepartment !== "all" || filterPosition !== "all";
  const [formData, setFormData] = useState({
    full_name: "",
    phone_number: "",
    date_of_birth: "",
    year_of_joining: new Date().getFullYear(),
    department_id: "",
    salary: "",
    skills_experience: "",
    position: "staff",
    // New fields
    gender: "",
    marital_status: "",
    state_of_origin: "",
    lga: "",
    residential_address: "",
    email_address: "",
    nin: "",
    employment_type: "",
    employment_date: "",
    level_of_education: "",
    bank_name: "",
    account_number: "",
    account_name: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    emergency_contact_relationship: "",
    linked_user_id: "",
  });

  const canAccess = isAdmin || isHR;

  useEffect(() => {
    if (!rolesLoading && !canAccess) {
      toast({
        title: "Access Denied",
        description: "You don't have permission to access this page.",
        variant: "destructive",
      });
      navigate("/");
    }
  }, [canAccess, rolesLoading, navigate, toast]);

  useEffect(() => {
    if (canAccess) {
      fetchStaffProfiles();
      fetchDepartments();
    }
  }, [canAccess]);

  const fetchStaffProfiles = async () => {
    try {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("*, departments(id, name)")
        .order("full_name");

      if (error) throw error;
      
      let profiles = data || [];
      
      // HR should not see profiles linked to admin users
      if (isHR && !isAdmin) {
        const { data: adminRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");
        
        const adminUserIds = new Set((adminRoles || []).map(r => r.user_id));
        profiles = profiles.filter(p => !p.linked_user_id || !adminUserIds.has(p.linked_user_id));
      }
      
      setStaffProfiles(profiles);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchDepartments = async () => {
    try {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name")
        .order("name");

      if (error) throw error;
      setDepartments(data || []);
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to fetch departments", variant: "destructive" });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let passportPath = editingProfile?.passport_path || null;

      if (passportFile) {
        const fileExt = passportFile.name.split(".").pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from("passports")
          .upload(fileName, passportFile);

        if (uploadError) throw uploadError;
        passportPath = fileName;
      }

      const profileData = {
        full_name: formData.full_name,
        phone_number: formData.phone_number || null,
        date_of_birth: formData.date_of_birth || null,
        year_of_joining: formData.year_of_joining || null,
        department_id: formData.department_id || null,
        salary: formData.salary ? parseFloat(formData.salary) : null,
        passport_path: passportPath,
        skills_experience: formData.skills_experience || null,
        position: formData.position as "managing_director" | "general_manager" | "kitchen_manager" | "event_manager" | "supervisor" | "staff",
        // New fields
        gender: formData.gender || null,
        marital_status: formData.marital_status || null,
        state_of_origin: formData.state_of_origin || null,
        lga: formData.lga || null,
        residential_address: formData.residential_address || null,
        email_address: formData.email_address || null,
        nin: formData.nin || null,
        employment_type: formData.employment_type || null,
        employment_date: formData.employment_date || null,
        level_of_education: formData.level_of_education || null,
        bank_name: formData.bank_name || null,
        account_number: formData.account_number || null,
        account_name: formData.account_name || null,
        emergency_contact_name: formData.emergency_contact_name || null,
        emergency_contact_phone: formData.emergency_contact_phone || null,
        emergency_contact_relationship: formData.emergency_contact_relationship || null,
      };

      if (editingProfile) {
        const { error } = await supabase
          .from("staff_profiles")
          .update(profileData)
          .eq("id", editingProfile.id);

        if (error) throw error;
        toast({ title: "Success", description: "Staff profile updated successfully" });
      } else {
        // Use the logged-in user's ID for user_id (required by foreign key constraint)
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("You must be logged in to create a staff profile");
        
        const { error } = await supabase
          .from("staff_profiles")
          .insert([{ ...profileData, user_id: user.id, created_by: user.id }]);

        if (error) throw error;
        toast({ title: "Success", description: "Staff profile created successfully" });
      }

      setIsDialogOpen(false);
      resetForm();
      fetchStaffProfiles();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this staff profile?")) return;

    try {
      const { error } = await supabase.from("staff_profiles").delete().eq("id", id);
      if (error) throw error;

      toast({ title: "Success", description: "Staff profile deleted successfully" });
      fetchStaffProfiles();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleEdit = (profile: StaffProfile) => {
    setEditingProfile(profile);
    setFormData({
      full_name: profile.full_name,
      phone_number: profile.phone_number || "",
      date_of_birth: profile.date_of_birth || "",
      year_of_joining: profile.year_of_joining || new Date().getFullYear(),
      department_id: profile.department_id || "",
      salary: profile.salary?.toString() || "",
      skills_experience: profile.skills_experience || "",
      position: profile.position,
      // New fields
      gender: profile.gender || "",
      marital_status: profile.marital_status || "",
      state_of_origin: profile.state_of_origin || "",
      lga: profile.lga || "",
      residential_address: profile.residential_address || "",
      email_address: profile.email_address || "",
      nin: profile.nin || "",
      employment_type: profile.employment_type || "",
      employment_date: profile.employment_date || "",
      level_of_education: profile.level_of_education || "",
      bank_name: profile.bank_name || "",
      account_number: profile.account_number || "",
      account_name: profile.account_name || "",
      emergency_contact_name: profile.emergency_contact_name || "",
      emergency_contact_phone: profile.emergency_contact_phone || "",
      emergency_contact_relationship: profile.emergency_contact_relationship || "",
      linked_user_id: profile.linked_user_id || "",
    });
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setEditingProfile(null);
    setPassportFile(null);
    setFormData({
      full_name: "",
      phone_number: "",
      date_of_birth: "",
      year_of_joining: new Date().getFullYear(),
      department_id: "",
      salary: "",
      skills_experience: "",
      position: "staff",
      // New fields
      gender: "",
      marital_status: "",
      state_of_origin: "",
      lga: "",
      residential_address: "",
      email_address: "",
      nin: "",
      employment_type: "",
      employment_date: "",
      level_of_education: "",
      bank_name: "",
      account_number: "",
      account_name: "",
      emergency_contact_name: "",
      emergency_contact_phone: "",
      emergency_contact_relationship: "",
      linked_user_id: "",
    });
  };

  const getPassportUrl = (path: string | null) => {
    if (!path) return null;
    const { data } = supabase.storage.from("passports").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleExportPDF = async (profile: StaffProfile) => {
    // Clear any existing timeout
    if (exportTimeoutRef.current) {
      clearTimeout(exportTimeoutRef.current);
    }
    
    setExportingProfile(profile);
    
    exportTimeoutRef.current = setTimeout(async () => {
      if (printableRef.current) {
        try {
          await exportStaffProfilePDF(printableRef.current, profile.full_name);
          toast({ title: "Success", description: "Staff profile exported successfully" });
        } catch (error) {
          toast({
            title: "Error",
            description: "Failed to export staff profile",
            variant: "destructive",
          });
        }
      }
      setExportingProfile(null);
    }, 100);
  };

  const handlePrint = (profile: StaffProfile) => {
    // Clear any existing timeout
    if (printTimeoutRef.current) {
      clearTimeout(printTimeoutRef.current);
    }
    
    setExportingProfile(profile);
    
    printTimeoutRef.current = setTimeout(() => {
      if (printableRef.current) {
        printStaffProfile(printableRef.current);
      }
      setExportingProfile(null);
    }, 100);
  };

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (exportTimeoutRef.current) {
        clearTimeout(exportTimeoutRef.current);
      }
      if (printTimeoutRef.current) {
        clearTimeout(printTimeoutRef.current);
      }
    };
  }, []);

  if (rolesLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  if (!canAccess) {
    return null;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Hidden printable component */}
      {exportingProfile && (
        <div className="fixed -left-[9999px] top-0">
          <div ref={printableRef}>
            <StaffProfilePrintable
              profile={exportingProfile}
              passportUrl={getPassportUrl(exportingProfile.passport_path)}
              isAdmin={isAdmin}
            />
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <img 
            src="/favicon.png" 
            alt="Sizzling Spices Logo" 
            className="w-16 h-16 object-contain"
          />
          <div>
            <h1 className="text-3xl font-bold">Staff Profiles</h1>
            <p className="text-muted-foreground">SIZZLING SPICES - Staff Management</p>
          </div>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          {(isAdmin || isHR) && (
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Staff
            </Button>
          </DialogTrigger>
          )}
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingProfile ? "Edit" : "Add"} Staff Profile</DialogTitle>
              <DialogDescription>
                {editingProfile ? "Update" : "Create"} staff member information
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Personal Information Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold border-b pb-2">Personal Information</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="full_name">Full Name *</Label>
                    <Input
                      id="full_name"
                      value={formData.full_name}
                      onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email_address">Email Address</Label>
                    <Input
                      id="email_address"
                      type="email"
                      value={formData.email_address}
                      onChange={(e) => setFormData({ ...formData, email_address: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone_number">Phone Number</Label>
                    <Input
                      id="phone_number"
                      type="tel"
                      value={formData.phone_number}
                      onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="date_of_birth">Date of Birth</Label>
                    <Input
                      id="date_of_birth"
                      type="date"
                      value={formData.date_of_birth}
                      onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="gender">Gender</Label>
                    <Select
                      value={formData.gender}
                      onValueChange={(value) => setFormData({ ...formData, gender: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                      <SelectContent>
                        {genderOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="marital_status">Marital Status</Label>
                    <Select
                      value={formData.marital_status}
                      onValueChange={(value) => setFormData({ ...formData, marital_status: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        {maritalStatusOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="state_of_origin">State of Origin</Label>
                    <Select
                      value={formData.state_of_origin}
                      onValueChange={(value) => setFormData({ ...formData, state_of_origin: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select state" />
                      </SelectTrigger>
                      <SelectContent>
                        {nigerianStates.map((state) => (
                          <SelectItem key={state} value={state}>
                            {state}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lga">LGA (Local Government Area)</Label>
                    <Input
                      id="lga"
                      value={formData.lga}
                      onChange={(e) => setFormData({ ...formData, lga: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="residential_address">Residential Address</Label>
                    <Textarea
                      id="residential_address"
                      value={formData.residential_address}
                      onChange={(e) => setFormData({ ...formData, residential_address: e.target.value })}
                      rows={2}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="nin">NIN (National Identification Number)</Label>
                    <Input
                      id="nin"
                      value={formData.nin}
                      onChange={(e) => setFormData({ ...formData, nin: e.target.value })}
                      maxLength={11}
                    />
                  </div>
                </div>
              </div>

              {/* Employment Details Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold border-b pb-2">Employment Details</h3>
                
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="position">Position *</Label>
                    <Select
                      value={formData.position}
                      onValueChange={(value) => setFormData({ ...formData, position: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {positionOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="department_id">Department</Label>
                    <Select
                      value={formData.department_id}
                      onValueChange={(value) => setFormData({ ...formData, department_id: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map((dept) => (
                          <SelectItem key={dept.id} value={dept.id}>
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="employment_type">Employment Type</Label>
                    <Select
                      value={formData.employment_type}
                      onValueChange={(value) => setFormData({ ...formData, employment_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {employmentTypeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="employment_date">Employment Date</Label>
                    <Input
                      id="employment_date"
                      type="date"
                      value={formData.employment_date}
                      onChange={(e) => setFormData({ ...formData, employment_date: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="year_of_joining">Year of Joining</Label>
                    <Input
                      id="year_of_joining"
                      type="number"
                      value={formData.year_of_joining}
                      onChange={(e) => setFormData({ ...formData, year_of_joining: parseInt(e.target.value) })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="level_of_education">Level of Education</Label>
                    <Select
                      value={formData.level_of_education}
                      onValueChange={(value) => setFormData({ ...formData, level_of_education: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select education" />
                      </SelectTrigger>
                      <SelectContent>
                        {educationOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="skills_experience">Skills & Experience</Label>
                  <Textarea
                    id="skills_experience"
                    value={formData.skills_experience}
                    onChange={(e) => setFormData({ ...formData, skills_experience: e.target.value })}
                    rows={3}
                  />
                </div>
              </div>

              {/* Bank Details Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold border-b pb-2">Bank Details & Salary</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bank_name">Bank Name</Label>
                    <Input
                      id="bank_name"
                      value={formData.bank_name}
                      onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="account_number">Account Number</Label>
                    <Input
                      id="account_number"
                      value={formData.account_number}
                      onChange={(e) => setFormData({ ...formData, account_number: e.target.value })}
                      maxLength={10}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="account_name">Account Name</Label>
                    <Input
                      id="account_name"
                      value={formData.account_name}
                      onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                    />
                  </div>

                  {isAdmin && (
                  <div className="space-y-2">
                    <Label htmlFor="salary">Monthly Salary (₦)</Label>
                    <Input
                      id="salary"
                      type="number"
                      step="0.01"
                      value={formData.salary}
                      onChange={(e) => setFormData({ ...formData, salary: e.target.value })}
                    />
                  </div>
                  )}
                </div>
              </div>

              {/* Emergency Contact Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold border-b pb-2">Emergency Contact</h3>
                
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="emergency_contact_name">Contact Name</Label>
                    <Input
                      id="emergency_contact_name"
                      value={formData.emergency_contact_name}
                      onChange={(e) => setFormData({ ...formData, emergency_contact_name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="emergency_contact_phone">Contact Phone</Label>
                    <Input
                      id="emergency_contact_phone"
                      type="tel"
                      value={formData.emergency_contact_phone}
                      onChange={(e) => setFormData({ ...formData, emergency_contact_phone: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="emergency_contact_relationship">Relationship</Label>
                    <Input
                      id="emergency_contact_relationship"
                      value={formData.emergency_contact_relationship}
                      onChange={(e) => setFormData({ ...formData, emergency_contact_relationship: e.target.value })}
                      placeholder="e.g., Spouse, Parent, Sibling"
                    />
                  </div>
                </div>
              </div>

              {/* Passport Upload Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold border-b pb-2">Documents</h3>
                <div className="space-y-2">
                  <Label htmlFor="passport">Passport Photograph</Label>
                  <Input
                    id="passport"
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setPassportFile(e.target.files?.[0] || null)}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving..." : editingProfile ? "Update" : "Create"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search and Filter Section */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={filterDepartment} onValueChange={setFilterDepartment}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={filterPosition} onValueChange={setFilterPosition}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="All Positions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Positions</SelectItem>
                {positionOptions.map((pos) => (
                  <SelectItem key={pos.value} value={pos.value}>
                    {pos.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {hasActiveFilters && (
              <Button variant="outline" onClick={clearFilters} className="gap-2">
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
          
          {/* Results count */}
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredProfiles.length} of {staffProfiles.length} staff members
            {hasActiveFilters && " (filtered)"}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredProfiles.map((profile) => (
          <Card key={profile.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src={getPassportUrl(profile.passport_path) || undefined} />
                    <AvatarFallback>{profile.full_name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle className="text-lg">{profile.full_name}</CardTitle>
                    <CardDescription>
                      {positionOptions.find((p) => p.value === profile.position)?.label}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(isAdmin || isHR) && (
                  <Button size="icon" variant="ghost" onClick={() => handleEdit(profile)} title="Edit">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  )}
                  <StaffDocuments staffProfileId={profile.id} staffName={profile.full_name} />
                  <Button size="icon" variant="ghost" onClick={() => handleExportPDF(profile)} title="Export PDF">
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handlePrint(profile)} title="Print">
                    <Printer className="h-4 w-4" />
                  </Button>
                  {isAdmin && (
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(profile.id)} title="Delete">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {profile.email_address && (
                <div>
                  <span className="font-medium">Email:</span> {profile.email_address}
                </div>
              )}
              {profile.phone_number && (
                <div>
                  <span className="font-medium">Phone:</span> {profile.phone_number}
                </div>
              )}
              {profile.date_of_birth && (
                <div>
                  <span className="font-medium">DOB:</span>{" "}
                  {new Date(profile.date_of_birth).toLocaleDateString()}
                </div>
              )}
              {profile.gender && (
                <div>
                  <span className="font-medium">Gender:</span>{" "}
                  {genderOptions.find(g => g.value === profile.gender)?.label || profile.gender}
                </div>
              )}
              {profile.departments && (
                <div>
                  <span className="font-medium">Department:</span> {profile.departments.name}
                </div>
              )}
              {isAdmin && profile.salary && (
                <div>
                  <span className="font-medium">Salary:</span> {formatNairaCompact(profile.salary)}
                </div>
              )}
              {profile.state_of_origin && (
                <div>
                  <span className="font-medium">State:</span> {profile.state_of_origin}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {staffProfiles.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No staff profiles found. Add your first staff member to get started.</p>
        </div>
      )}

      {staffProfiles.length > 0 && filteredProfiles.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No staff profiles match your search criteria.</p>
          <Button variant="link" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
};

export default StaffProfiles;
