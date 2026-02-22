import { useState, useRef, useCallback } from 'react';
import { uploadFile, removeFile, getFileUrl } from '../api/collectionApi.js';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Upload, X, FileText, ImageIcon, Loader2 } from 'lucide-react';

export default function FileField({
  name,
  schema,
  value,
  onChange,
  readOnly,
  required,
  error,
}) {
  const label = schema.title || name;
  const isImage = schema.format === 'image';
  const isMulti = schema.type === 'array';
  const accept = schema['x-accept'] || (isImage ? 'image/*' : undefined);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  // Normalize value to array for internal handling
  const files = isMulti
    ? (Array.isArray(value) ? value : [])
    : (value ? [value] : []);

  const handleFiles = useCallback(async (fileList) => {
    if (!fileList.length) return;
    setUploading(true);
    setUploadError(null);

    try {
      const newPaths = [];
      for (const file of fileList) {
        const result = await uploadFile(file);
        newPaths.push(result.path);
      }

      if (isMulti) {
        onChange([...files, ...newPaths]);
      } else {
        if (files[0]) {
          try { await removeFile(files[0]); } catch { /* ignore */ }
        }
        onChange(newPaths[0]);
      }
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [files, isMulti, onChange]);

  const handleRemove = useCallback(async (path) => {
    try { await removeFile(path); } catch { /* best effort */ }
    if (isMulti) {
      onChange(files.filter((f) => f !== path));
    } else {
      onChange(null);
    }
  }, [files, isMulti, onChange]);

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setDragOver(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (readOnly) return;
    handleFiles(Array.from(e.dataTransfer.files));
  };

  // Read-only display
  if (readOnly) {
    return (
      <div className="space-y-2 md:col-span-2">
        <Label className="font-medium">{label}</Label>
        <div className="px-3 py-2 bg-muted rounded-md min-h-[2.5rem]">
          {files.length === 0 ? (
            <span className="text-muted-foreground/50">--</span>
          ) : (
            <div className={isImage ? 'flex flex-wrap gap-3' : 'flex flex-col gap-1.5'}>
              {files.map((path) =>
                isImage ? (
                  <a key={path} href={getFileUrl(path)} target="_blank" rel="noopener noreferrer">
                    <img
                      src={getFileUrl(path)}
                      alt=""
                      className="h-24 w-24 object-cover rounded-md border"
                    />
                  </a>
                ) : (
                  <a
                    key={path}
                    href={getFileUrl(path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline text-sm flex items-center gap-1.5"
                  >
                    <FileText className="h-4 w-4 shrink-0" />
                    {extractFilename(path)}
                  </a>
                )
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Edit mode
  const showDropZone = isMulti || files.length === 0;

  return (
    <div className="space-y-2 md:col-span-2">
      <Label className="font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>

      {/* Existing files */}
      {files.length > 0 && (
        <div className={isImage ? 'flex flex-wrap gap-3' : 'flex flex-col gap-1.5'}>
          {files.map((path) => (
            <div
              key={path}
              className={
                isImage
                  ? 'group relative'
                  : 'flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md text-sm'
              }
            >
              {isImage ? (
                <img
                  src={getFileUrl(path)}
                  alt=""
                  className="h-24 w-24 object-cover rounded-md border"
                />
              ) : (
                <>
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <a
                    href={getFileUrl(path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline truncate"
                  >
                    {extractFilename(path)}
                  </a>
                </>
              )}
              <button
                type="button"
                onClick={() => handleRemove(path)}
                className={
                  isImage
                    ? 'absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm'
                    : 'ml-auto shrink-0 text-muted-foreground hover:text-destructive transition-colors'
                }
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      {showDropZone && (
        <div
          className={`border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors
            ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'}
            ${error ? 'border-destructive' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={accept}
            multiple={isMulti}
            onChange={(e) => handleFiles(Array.from(e.target.files))}
          />
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading...
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
              {isImage ? <ImageIcon className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
              <span className="text-sm">
                {isImage ? 'Drop image here or click to browse' : 'Drop file here or click to browse'}
              </span>
              {accept && accept !== 'image/*' && (
                <span className="text-xs opacity-70">{accept}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <p className="text-sm text-destructive">{uploadError}</p>
      )}

      {/* Field validation error */}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function extractFilename(path) {
  if (!path) return '';
  const name = path.split('/').pop() || '';
  // Remove the unique prefix (e.g., "lq3x5abc_report.pdf" -> "report.pdf")
  const underscoreIdx = name.indexOf('_');
  return underscoreIdx > 0 ? name.slice(underscoreIdx + 1) : name;
}
