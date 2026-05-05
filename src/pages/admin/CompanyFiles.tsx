import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FolderOpen, Folder, FolderPlus, Upload, File, FileText,
  FileSpreadsheet, FileImage, Trash2, Download, MoreHorizontal,
  Pencil, HardDrive, ArrowLeft, AlertTriangle, CloudUpload,
} from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

interface CompanyFolder {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

interface CompanyFile {
  id: string;
  folder_id: string;
  name: string;
  storage_path: string;
  file_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
}

const BUCKET = 'company-files';

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

const getFileIcon = (mimeType: string | null) => {
  if (!mimeType) return File;
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType === 'application/pdf') return FileText;
  if (
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType === 'text/csv'
  ) return FileSpreadsheet;
  if (mimeType.startsWith('text/')) return FileText;
  return File;
};

const getFileColor = (mimeType: string | null): string => {
  if (!mimeType) return 'text-muted-foreground';
  if (mimeType.startsWith('image/')) return 'text-pink-500';
  if (mimeType === 'application/pdf') return 'text-red-500';
  if (
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType === 'text/csv'
  ) return 'text-green-600';
  if (mimeType.startsWith('text/')) return 'text-blue-500';
  return 'text-muted-foreground';
};

export default function CompanyFiles() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFolder, setSelectedFolder] = useState<CompanyFolder | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [editFolder, setEditFolder] = useState<CompanyFolder | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<CompanyFolder | null>(null);
  const [deleteFileTarget, setDeleteFileTarget] = useState<CompanyFile | null>(null);
  const [folderForm, setFolderForm] = useState({ name: '', description: '' });
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: folders = [] } = useQuery({
    queryKey: ['company-folders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_folders')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as CompanyFolder[];
    },
  });

  const { data: files = [], isFetching: filesFetching } = useQuery({
    queryKey: ['company-files', selectedFolder?.id],
    queryFn: async () => {
      if (!selectedFolder) return [];
      const { data, error } = await supabase
        .from('company_files')
        .select('*')
        .eq('folder_id', selectedFolder.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as CompanyFile[];
    },
    enabled: !!selectedFolder,
  });

  const { data: fileCounts = {} } = useQuery({
    queryKey: ['company-file-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_files')
        .select('folder_id');
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((f: any) => {
        counts[f.folder_id] = (counts[f.folder_id] || 0) + 1;
      });
      return counts;
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('company_folders').insert({
        name: folderForm.name.trim(),
        description: folderForm.description.trim() || null,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-folders'] });
      setCreateFolderOpen(false);
      setFolderForm({ name: '', description: '' });
      toast({ title: 'Folder created' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const editFolderMutation = useMutation({
    mutationFn: async () => {
      if (!editFolder) return;
      const { error } = await supabase
        .from('company_folders')
        .update({ name: folderForm.name.trim(), description: folderForm.description.trim() || null })
        .eq('id', editFolder.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-folders'] });
      if (selectedFolder?.id === editFolder?.id) {
        setSelectedFolder(f =>
          f ? { ...f, name: folderForm.name.trim(), description: folderForm.description.trim() || null } : f
        );
      }
      setEditFolder(null);
      setFolderForm({ name: '', description: '' });
      toast({ title: 'Folder updated' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folder: CompanyFolder) => {
      const { data: storageFiles } = await supabase.storage.from(BUCKET).list(folder.id);
      if (storageFiles && storageFiles.length > 0) {
        const paths = storageFiles.map(f => `${folder.id}/${f.name}`);
        await supabase.storage.from(BUCKET).remove(paths);
      }
      const { error } = await supabase.from('company_folders').delete().eq('id', folder.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-folders'] });
      queryClient.invalidateQueries({ queryKey: ['company-file-counts'] });
      if (selectedFolder?.id === deleteFolderTarget?.id) setSelectedFolder(null);
      setDeleteFolderTarget(null);
      toast({ title: 'Folder deleted' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (file: CompanyFile) => {
      const { error: storageErr } = await supabase.storage.from(BUCKET).remove([file.storage_path]);
      if (storageErr) throw storageErr;
      const { error } = await supabase.from('company_files').delete().eq('id', file.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-files', selectedFolder?.id] });
      queryClient.invalidateQueries({ queryKey: ['company-file-counts'] });
      setDeleteFileTarget(null);
      toast({ title: 'File deleted' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || !selectedFolder || fileList.length === 0) return;
    setUploading(true);
    let uploaded = 0;
    let failed = 0;
    for (const file of Array.from(fileList)) {
      const storagePath = `${selectedFolder.id}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(storagePath, file);
      if (uploadErr) { failed++; continue; }
      const { error: dbErr } = await supabase.from('company_files').insert({
        folder_id: selectedFolder.id,
        name: file.name,
        storage_path: storagePath,
        file_type: file.type || null,
        file_size: file.size,
        uploaded_by: user!.id,
      });
      if (dbErr) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        failed++;
      } else {
        uploaded++;
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    queryClient.invalidateQueries({ queryKey: ['company-files', selectedFolder.id] });
    queryClient.invalidateQueries({ queryKey: ['company-file-counts'] });
    if (uploaded > 0) toast({ title: `${uploaded} file${uploaded > 1 ? 's' : ''} uploaded` });
    if (failed > 0) toast({ title: `${failed} upload${failed > 1 ? 's' : ''} failed`, variant: 'destructive' });
  };

  const handleDownload = async (file: CompanyFile) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(file.storage_path, 60);
    if (error || !data) {
      toast({ title: 'Download failed', description: error?.message, variant: 'destructive' });
      return;
    }
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleUpload(e.dataTransfer.files);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedFolder]
  );

  const openCreate = () => {
    setFolderForm({ name: '', description: '' });
    setCreateFolderOpen(true);
  };

  const openEdit = (folder: CompanyFolder) => {
    setFolderForm({ name: folder.name, description: folder.description || '' });
    setEditFolder(folder);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Company Files</h1>
          <p className="text-muted-foreground mt-1 hidden sm:block">
            Organise and store company documents in folders
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2 shrink-0">
          <FolderPlus className="h-4 w-4" /> New Folder
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Folder Panel ── */}
        <div className="lg:col-span-1 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
            Folders ({folders.length})
          </p>

          {folders.length === 0 && (
            <Card>
              <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
                <div className="p-4 bg-muted rounded-full">
                  <HardDrive className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No folders yet.</p>
                <Button variant="outline" size="sm" onClick={openCreate} className="gap-2">
                  <FolderPlus className="h-3.5 w-3.5" /> Create First Folder
                </Button>
              </CardContent>
            </Card>
          )}

          {folders.map(folder => {
            const count = fileCounts[folder.id] || 0;
            const isSelected = selectedFolder?.id === folder.id;
            return (
              <button
                key={folder.id}
                onClick={() => setSelectedFolder(folder)}
                className={`w-full text-left rounded-lg border p-4 transition-all hover:shadow-sm ${
                  isSelected
                    ? 'bg-primary/5 border-primary/30 shadow-sm'
                    : 'bg-card border-border hover:border-primary/20'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 p-1.5 rounded-md ${isSelected ? 'bg-primary/10' : 'bg-muted'}`}>
                    {isSelected
                      ? <FolderOpen className="h-5 w-5 text-primary" />
                      : <Folder className="h-5 w-5 text-muted-foreground" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm truncate ${isSelected ? 'text-primary' : ''}`}>
                      {folder.name}
                    </p>
                    {folder.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {folder.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {count} file{count !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 -mr-1">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={e => { e.stopPropagation(); openEdit(folder); }}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={e => { e.stopPropagation(); setDeleteFolderTarget(folder); }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── File Panel ── */}
        <div className="lg:col-span-2">
          {!selectedFolder ? (
            <Card className="min-h-[420px]">
              <CardContent className="flex flex-col items-center justify-center min-h-[420px] text-center gap-4">
                <div className="p-5 bg-muted/60 rounded-full">
                  <FolderOpen className="h-10 w-10 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Select a folder to view its files</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    or create a new folder to get started
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Folder header */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen className="h-5 w-5 text-primary shrink-0" />
                  <h2 className="text-lg font-semibold truncate">{selectedFolder.name}</h2>
                  <Badge variant="secondary" className="shrink-0">
                    {filesFetching ? '…' : `${files.length} file${files.length !== 1 ? 's' : ''}`}
                  </Badge>
                </div>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="gap-2 shrink-0"
                >
                  <Upload className="h-4 w-4" />
                  {uploading ? 'Uploading…' : 'Upload Files'}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={e => handleUpload(e.target.files)}
                />
              </div>

              {/* Drop zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all select-none ${
                  isDragging
                    ? 'border-primary bg-primary/5 scale-[1.01]'
                    : 'border-border hover:border-primary/40 hover:bg-muted/20'
                }`}
              >
                <CloudUpload
                  className={`h-7 w-7 mx-auto mb-2 transition-colors ${
                    isDragging ? 'text-primary' : 'text-muted-foreground'
                  }`}
                />
                <p className="text-sm font-medium">
                  {isDragging ? 'Drop files to upload' : 'Drag & drop files here, or click to browse'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Any file type · Max 50 MB per file
                </p>
              </div>

              {/* Files */}
              {!filesFetching && files.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center">
                    <p className="text-sm text-muted-foreground">
                      This folder is empty. Upload files to get started.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {files.map(file => {
                        const FileIcon = getFileIcon(file.file_type);
                        const iconColor = getFileColor(file.file_type);
                        return (
                          <div
                            key={file.id}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group"
                          >
                            <div className={`shrink-0 ${iconColor}`}>
                              <FileIcon className="h-8 w-8" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{file.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {formatBytes(file.file_size)} &middot;{' '}
                                {format(new Date(file.created_at), 'MMM d, yyyy')}
                              </p>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleDownload(file)}
                                title="Download"
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setDeleteFileTarget(file)}
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create Folder Dialog */}
      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="h-5 w-5" /> New Folder
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Folder Name</Label>
              <Input
                value={folderForm.name}
                onChange={e => setFolderForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. HR Documents, Finance Records"
                onKeyDown={e =>
                  e.key === 'Enter' && folderForm.name.trim() && createFolderMutation.mutate()
                }
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>
                Description{' '}
                <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Textarea
                value={folderForm.description}
                onChange={e => setFolderForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What kind of files go in this folder?"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createFolderMutation.mutate()}
              disabled={!folderForm.name.trim() || createFolderMutation.isPending}
              className="gap-2"
            >
              <FolderPlus className="h-4 w-4" />
              {createFolderMutation.isPending ? 'Creating…' : 'Create Folder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Folder Dialog */}
      <Dialog open={!!editFolder} onOpenChange={open => { if (!open) setEditFolder(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" /> Edit Folder
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Folder Name</Label>
              <Input
                value={folderForm.name}
                onChange={e => setFolderForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e =>
                  e.key === 'Enter' && folderForm.name.trim() && editFolderMutation.mutate()
                }
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>
                Description{' '}
                <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Textarea
                value={folderForm.description}
                onChange={e => setFolderForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFolder(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => editFolderMutation.mutate()}
              disabled={!folderForm.name.trim() || editFolderMutation.isPending}
            >
              {editFolderMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Confirm */}
      <Dialog
        open={!!deleteFolderTarget}
        onOpenChange={open => { if (!open) setDeleteFolderTarget(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Delete Folder
            </DialogTitle>
            <DialogDescription>
              {deleteFolderTarget && (
                <>
                  This will permanently delete{' '}
                  <strong>{deleteFolderTarget.name}</strong> and all{' '}
                  <strong>
                    {fileCounts[deleteFolderTarget.id] || 0} file
                    {(fileCounts[deleteFolderTarget.id] || 0) !== 1 ? 's' : ''}
                  </strong>{' '}
                  inside it. This cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFolderTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteFolderTarget && deleteFolderMutation.mutate(deleteFolderTarget)}
              disabled={deleteFolderMutation.isPending}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {deleteFolderMutation.isPending ? 'Deleting…' : 'Delete Folder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete File Confirm */}
      <Dialog
        open={!!deleteFileTarget}
        onOpenChange={open => { if (!open) setDeleteFileTarget(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Delete File
            </DialogTitle>
            <DialogDescription>
              <strong>{deleteFileTarget?.name}</strong> will be permanently deleted and cannot
              be recovered.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFileTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteFileTarget && deleteFileMutation.mutate(deleteFileTarget)}
              disabled={deleteFileMutation.isPending}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {deleteFileMutation.isPending ? 'Deleting…' : 'Delete File'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
