import React, { useRef, useState } from 'react';
import { Camera, FileText, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RECEIPT_ACCEPT, RECEIPT_MAX_BYTES } from '@/lib/expenseConfig';

// ─────────────────────────────────────────────────────────────────────────────
// ReceiptUpload
//
// §5.2: "Receipt upload must offer camera capture directly. Staff photograph a
// market receipt; they do not have a scanner."
//
// Two entry points on a phone — Take photo (capture="environment", opening the
// rear camera straight away) and Choose file (for a PDF or an existing photo).
// Images are compressed in the browser before upload, because a modern phone
// camera produces 4–8MB per shot and the cap is 5MB.
// ─────────────────────────────────────────────────────────────────────────────

/** Longest edge of a compressed receipt, in pixels. Text stays legible at this size. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  // A photo already small enough is left alone rather than re-encoded.
  if (file.size <= 400 * 1024) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  bitmap.close?.();
  if (!blob || blob.size >= file.size) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

interface ReceiptUploadProps {
  file: File | null;
  onChange: (file: File | null) => void;
  /** Existing receipt already stored, shown when nothing new is selected. */
  existingPath?: string | null;
  onRemoveExisting?: () => void;
  required?: boolean;
  error?: string | null;
  id?: string;
  disabled?: boolean;
}

export default function ReceiptUpload({
  file,
  onChange,
  existingPath,
  onRemoveExisting,
  required,
  error,
  id = 'receipt',
  disabled,
}: ReceiptUploadProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const accept = async (picked: File | undefined) => {
    if (!picked) return;
    setLocalError(null);
    setBusy(true);
    try {
      const isPdf = picked.type === 'application/pdf';
      const isImage = picked.type.startsWith('image/');
      if (!isPdf && !isImage) {
        setLocalError('Attach a photo or a PDF.');
        return;
      }

      const finished = isImage ? await compressImage(picked) : picked;
      if (finished.size > RECEIPT_MAX_BYTES) {
        setLocalError(
          `That file is ${(finished.size / 1024 / 1024).toFixed(1)}MB, over the 5MB limit. Try photographing it again in better light.`,
        );
        return;
      }

      onChange(finished);
      if (isImage) {
        const reader = new FileReader();
        reader.onload = (e) => setPreview(e.target?.result as string);
        reader.readAsDataURL(finished);
      } else {
        setPreview(null);
      }
    } finally {
      setBusy(false);
      // Allow re-picking the same file.
      if (cameraRef.current) cameraRef.current.value = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const clear = () => {
    onChange(null);
    setPreview(null);
    setLocalError(null);
  };

  const shown = error ?? localError;

  return (
    <div className="space-y-2">
      <input
        ref={cameraRef}
        type="file"
        id={`${id}-camera`}
        className="sr-only"
        accept="image/*"
        // Opens the rear camera directly on a phone.
        capture="environment"
        onChange={(e) => accept(e.target.files?.[0])}
        disabled={disabled}
      />
      <input
        ref={fileRef}
        type="file"
        id={id}
        className="sr-only"
        accept={RECEIPT_ACCEPT}
        onChange={(e) => accept(e.target.files?.[0])}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={!!shown || undefined}
        aria-describedby={shown ? `${id}-error` : undefined}
      />

      {file || existingPath ? (
        <div className="rounded-lg border p-3 space-y-3">
          {preview ? (
            <img
              src={preview}
              alt={`Receipt preview: ${file?.name ?? 'attached receipt'}`}
              className="w-full max-h-56 object-contain rounded bg-muted"
            />
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{file?.name ?? existingPath?.split('/').pop() ?? 'Receipt attached'}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 min-w-[8rem]"
              onClick={() => cameraRef.current?.click()}
              disabled={disabled || busy}
            >
              <Camera className="h-4 w-4 mr-2" aria-hidden />
              Retake
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 text-destructive"
              onClick={file ? clear : onRemoveExisting}
              disabled={disabled || busy}
            >
              <X className="h-4 w-4 mr-2" aria-hidden />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            // 44px minimum, and the primary action on a phone.
            className={cn('h-14 flex-col gap-1', shown && 'border-destructive')}
            onClick={() => cameraRef.current?.click()}
            disabled={disabled || busy}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Camera className="h-5 w-5" aria-hidden />}
            <span className="text-xs">Take photo</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className={cn('h-14 flex-col gap-1', shown && 'border-destructive')}
            onClick={() => fileRef.current?.click()}
            disabled={disabled || busy}
          >
            <Upload className="h-5 w-5" aria-hidden />
            <span className="text-xs">Choose file</span>
          </Button>
        </div>
      )}

      {shown ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive flex items-start gap-1">
          <span aria-hidden>⚠</span>
          <span>{shown}</span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Photo or PDF, up to 5MB. Photos are compressed automatically.</p>
      )}
    </div>
  );
}
