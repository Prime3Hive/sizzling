import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Upload, FileText, Trash2, Download, Eye, File, Image, FileSpreadsheet } from "lucide-react";

interface StaffDocument {
  id: string;
  staff_profile_id: string;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number | null;
  description: string | null;
  uploaded_by: string | null;
  created_at: string;
}

interface StaffDocumentsProps {
  staffProfileId: string;
  staffName: string;
}

const formatFileSize = (bytes: number | null) => {
  if (!bytes) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (fileType: string | null) => {
  if (!fileType) return <File className="h-5 w-5 text-muted-foreground" />;
  if (fileType.startsWith("image/")) return <Image className="h-5 w-5 text-blue-500" />;
  if (fileType.includes("pdf")) return <FileText className="h-5 w-5 text-red-500" />;
  if (fileType.includes("sheet") || fileType.includes("excel") || fileType.includes("csv"))
    return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
  if (fileType.includes("word") || fileType.includes("document"))
    return <FileText className="h-5 w-5 text-blue-600" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
};

const StaffDocuments = ({ staffProfileId, staffName }: StaffDocumentsProps) => {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");

  useEffect(() => {
    fetchDocuments();
  }, [staffProfileId]);

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from("staff_documents")
        .select("*")
        .eq("staff_profile_id", staffProfileId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to fetch documents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const fileExt = selectedFile.name.split(".").pop();
      const filePath = `${staffProfileId}/${Date.now()}-${selectedFile.name}`;

      const { error: uploadError } = await supabase.storage
        .from("staff-documents")
        .upload(filePath, selectedFile);

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from("staff_documents")
        .insert({
          staff_profile_id: staffProfileId,
          file_name: selectedFile.name,
          file_path: filePath,
          file_type: selectedFile.type,
          file_size: selectedFile.size,
          description: description || null,
          uploaded_by: user.id,
        });

      if (dbError) throw dbError;

      toast({ title: "Success", description: "Document uploaded successfully" });
      setUploadDialogOpen(false);
      setSelectedFile(null);
      setDescription("");
      fetchDocuments();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: StaffDocument) => {
    if (!confirm(`Delete "${doc.file_name}"?`)) return;

    try {
      const { error: storageError } = await supabase.storage
        .from("staff-documents")
        .remove([doc.file_path]);

      if (storageError) console.warn("Storage delete error:", storageError);

      const { error: dbError } = await supabase
        .from("staff_documents")
        .delete()
        .eq("id", doc.id);

      if (dbError) throw dbError;

      toast({ title: "Success", description: "Document deleted" });
      fetchDocuments();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDownload = async (doc: StaffDocument) => {
    try {
      const { data, error } = await supabase.storage
        .from("staff-documents")
        .createSignedUrl(doc.file_path, 60);

      if (error) throw error;

      const link = document.createElement("a");
      link.href = data.signedUrl;
      link.download = doc.file_name;
      link.click();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleView = async (doc: StaffDocument) => {
    try {
      const { data, error } = await supabase.storage
        .from("staff-documents")
        .createSignedUrl(doc.file_path, 300);

      if (error) throw error;
      window.open(data.signedUrl, "_blank");
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Documents">
          <FileText className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Documents - {staffName}</span>
            <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Upload className="h-4 w-4" />
                  Upload
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Upload Document</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>File *</Label>
                    <Input
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.txt"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description (optional)</Label>
                    <Textarea
                      placeholder="e.g., CV, Offer Letter, Certificate..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={handleUpload}
                    disabled={!selectedFile || uploading}
                    className="w-full"
                  >
                    {uploading ? "Uploading..." : "Upload Document"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-center py-8 text-muted-foreground">Loading documents...</p>
        ) : documents.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No documents uploaded yet.</p>
            <p className="text-xs mt-1">Click Upload to add files for this staff member.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <Card key={doc.id} className="p-0">
                <CardContent className="flex items-center gap-3 p-3">
                  {getFileIcon(doc.file_type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.file_name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatFileSize(doc.file_size)}</span>
                      <span>•</span>
                      <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                      {doc.description && (
                        <>
                          <span>•</span>
                          <span className="truncate">{doc.description}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => handleView(doc)} title="View">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDownload(doc)} title="Download">
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(doc)} title="Delete">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default StaffDocuments;
