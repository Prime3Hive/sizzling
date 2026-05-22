import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  File, FileText, FileSpreadsheet, FileImage,
  Download, Eye, FolderOpen,
} from 'lucide-react';
import { format } from 'date-fns';

interface StaffDocument {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number | null;
  description: string | null;
  created_at: string;
}

const formatBytes = (bytes: number | null) => {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

const FileIcon = ({ mimeType }: { mimeType: string | null }) => {
  const cls = 'h-9 w-9';
  if (!mimeType) return <File className={`${cls} text-muted-foreground`} />;
  if (mimeType.startsWith('image/')) return <FileImage className={`${cls} text-pink-500`} />;
  if (mimeType === 'application/pdf') return <FileText className={`${cls} text-red-500`} />;
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType === 'text/csv')
    return <FileSpreadsheet className={`${cls} text-green-600`} />;
  if (mimeType.includes('word') || mimeType.includes('document'))
    return <FileText className={`${cls} text-blue-600`} />;
  return <File className={`${cls} text-muted-foreground`} />;
};

export default function StaffMyDocuments() {
  const { user } = useAuth();
  const { toast } = useToast();

  // Step 1: resolve the staff profile linked to this user
  const { data: profileId, isLoading: profileLoading } = useQuery({
    queryKey: ['my-staff-profile-id', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('id')
        .eq('linked_user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
  });

  // Step 2: fetch documents for that profile (RLS further enforces this server-side)
  const { data: documents = [], isLoading: docsLoading } = useQuery({
    queryKey: ['my-staff-documents', profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_documents')
        .select('id, file_name, file_path, file_type, file_size, description, created_at')
        .eq('staff_profile_id', profileId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as StaffDocument[];
    },
    enabled: !!profileId,
  });

  const openSignedUrl = async (doc: StaffDocument, download = false) => {
    const { data, error } = await supabase.storage
      .from('staff-documents')
      .createSignedUrl(doc.file_path, 300);
    if (error || !data) {
      toast({ title: 'Could not open file', description: error?.message, variant: 'destructive' });
      return;
    }
    if (download) {
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = doc.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      window.open(data.signedUrl, '_blank');
    }
  };

  if (profileLoading || docsLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (!profileId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="p-4 bg-muted rounded-full">
            <FolderOpen className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="font-medium">No staff profile linked to your account</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Ask your administrator to link your account to your staff profile so documents
            assigned to you will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (documents.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="p-4 bg-muted rounded-full">
            <FileText className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="font-medium">No documents yet</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Documents assigned to you by HR or administration will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {documents.length} document{documents.length !== 1 ? 's' : ''} assigned to you
      </p>

      <div className="space-y-2">
        {documents.map(doc => (
          <Card key={doc.id} className="hover:shadow-sm transition-shadow">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="shrink-0">
                <FileIcon mimeType={doc.file_type} />
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{doc.file_name}</p>
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1">
                  {doc.description && (
                    <Badge variant="secondary" className="text-xs font-normal">
                      {doc.description}
                    </Badge>
                  )}
                  {formatBytes(doc.file_size) && (
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(doc.file_size)}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Added {format(new Date(doc.created_at), 'MMM d, yyyy')}
                  </span>
                </div>
              </div>

              <div className="flex gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  title="View"
                  onClick={() => openSignedUrl(doc, false)}
                >
                  <Eye className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Download"
                  onClick={() => openSignedUrl(doc, true)}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
