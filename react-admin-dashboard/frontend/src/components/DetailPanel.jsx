import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  fetchDocument,
  createDocument,
  updateDocument,
  removeFile,
} from '../api/collectionApi.js';
import FormField from './FormField.jsx';
import RelatedList from './RelatedList.jsx';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChevronLeft, Loader2 } from 'lucide-react';

export default function DetailPanel({
  collection,
  config,
  selectedId,
  isCreating,
  onSaved,
  onDelete,
  onCancel,
  onBack,
  prefill,
}) {
  const [formData, setFormData] = useState({});
  const [originalData, setOriginalData] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Load selected document or initialize create form
  useEffect(() => {
    let cancelled = false;

    if (!selectedId) {
      if (isCreating) {
        const defaults = {};
        for (const [key, prop] of Object.entries(config.schema.properties)) {
          if (prop.default !== undefined) defaults[key] = prop.default;
        }
        // Apply prefill from related list navigation
        if (prefill) {
          const fieldName = prefill.foreignKey.split('.')[0];
          const prop = config.schema.properties[fieldName];
          if (prop?.['x-lookup']) {
            const df = prop['x-lookup'].displayField || 'name';
            const primaryField = Array.isArray(df) ? df[0] : df;
            defaults[fieldName] = { _id: prefill.parentId, [primaryField]: prefill.parentLabel };
          }
        }
        setFormData(defaults);
        setOriginalData({});
        setIsEditing(true);
        setError(null);
      } else {
        setFormData({});
        setOriginalData({});
        setIsEditing(false);
      }
      return;
    }

    setLoading(true);
    setError(null);
    fetchDocument(collection, selectedId)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setError('Document not found');
          return;
        }
        setFormData(data);
        setOriginalData(data);
        setIsEditing(false);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedId, isCreating, collection, config, prefill]);

  const handleFieldChange = (fieldName, value) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
    if (fieldErrors[fieldName]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
  };

  const validateForm = () => {
    const errors = {};
    const properties = config.schema.properties;
    const required = config.schema.required || [];

    for (const [fieldName, propDef] of Object.entries(properties)) {
      const val = formData[fieldName];
      const isEmpty = val === undefined || val === null || val === '';

      if (propDef['x-lookup']) {
        if (propDef.type === 'array') {
          if (required.includes(fieldName) && (!Array.isArray(val) || val.length === 0)) {
            errors[fieldName] = `${propDef.title || fieldName} is required`;
          }
        } else {
          if (required.includes(fieldName) && (!val || !val._id)) {
            errors[fieldName] = `${propDef.title || fieldName} is required`;
          }
        }
        continue;
      }

      // File/image array: empty array counts as empty
      if ((propDef.format === 'file' || propDef.format === 'image') && propDef.type === 'array') {
        if (required.includes(fieldName) && (!Array.isArray(val) || val.length === 0)) {
          errors[fieldName] = `${propDef.title || fieldName} is required`;
        }
        continue;
      }

      if (required.includes(fieldName) && isEmpty) {
        errors[fieldName] = `${propDef.title || fieldName} is required`;
        continue;
      }

      if (isEmpty) continue;

      if (propDef.format === 'email' && typeof val === 'string') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(val)) {
          errors[fieldName] = 'Invalid email address';
        }
      }

      if (propDef.format === 'url' && typeof val === 'string') {
        try { new URL(val); } catch {
          errors[fieldName] = 'Invalid URL';
        }
      }

      if (propDef.minLength && typeof val === 'string' && val.length < propDef.minLength) {
        errors[fieldName] = `Must be at least ${propDef.minLength} characters`;
      }

      if ((propDef.type === 'number' || propDef.type === 'integer') && typeof val === 'number') {
        if (propDef.minimum !== undefined && val < propDef.minimum) {
          errors[fieldName] = `Must be at least ${propDef.minimum}`;
        }
        if (propDef.maximum !== undefined && val > propDef.maximum) {
          errors[fieldName] = `Must be at most ${propDef.maximum}`;
        }
      }
    }

    return errors;
  };

  const handleSave = async () => {
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      let result;
      if (isCreating) {
        result = await createDocument(collection, formData);
        toast.success('Record created');
      } else {
        const changes = {};
        for (const [key, value] of Object.entries(formData)) {
          if (key === '_id') continue;
          if (JSON.stringify(value) !== JSON.stringify(originalData[key])) {
            changes[key] = value;
          }
        }
        if (Object.keys(changes).length === 0) {
          setIsEditing(false);
          setSaving(false);
          return;
        }
        result = await updateDocument(collection, selectedId, changes);
        toast.success('Record updated');
      }
      setIsEditing(false);
      onSaved(result);
    } catch (err) {
      if (err.fieldErrors) {
        setFieldErrors(err.fieldErrors);
        toast.error('Validation failed');
      } else {
        setError(err.message);
        toast.error(isCreating ? 'Create failed' : 'Update failed', { description: err.message });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (isCreating) {
      onCancel();
    } else {
      setFormData(originalData);
      setIsEditing(false);
      setError(null);
      setFieldErrors({});
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleteOpen(false);
    // Clean up uploaded files before deleting the document
    for (const [fieldName, propDef] of Object.entries(properties)) {
      if (propDef.format !== 'file' && propDef.format !== 'image') continue;
      const val = formData[fieldName];
      if (!val) continue;
      const paths = Array.isArray(val) ? val : [val];
      for (const path of paths) {
        try { await removeFile(path); } catch { /* best effort */ }
      }
    }
    onDelete(selectedId);
  };

  // Empty state
  if (!selectedId && !isCreating) {
    return null;
  }

  const properties = config.schema.properties;
  const requiredFields = config.schema.required || [];
  const singularLabel = config.label.replace(/s$/, '');

  return (
    <>
      {/* Sticky header */}
      <div className="p-3 border-b flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          {config.label}
        </Button>
        <div className="flex-1" />
        {!isEditing && !isCreating && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setIsEditing(true); setFieldErrors({}); setError(null); }}
            >
              Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
            >
              Delete
            </Button>
          </>
        )}
        {(isEditing || isCreating) && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {isCreating ? 'Create' : 'Save'}
            </Button>
          </>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto min-h-0 p-4">
        {loading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-7 w-48" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Title */}
            <h2 className="text-xl font-bold">
              {isCreating
                ? `New ${singularLabel}`
                : formData.name || formData.title || formData.orderNumber || `${singularLabel} Detail`}
            </h2>

            {/* Error */}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Form fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(properties).map(([fieldName, propDef]) => (
                <FormField
                  key={fieldName}
                  name={fieldName}
                  schema={propDef}
                  value={formData[fieldName]}
                  onChange={(val) => handleFieldChange(fieldName, val)}
                  readOnly={!isEditing && !isCreating}
                  required={requiredFields.includes(fieldName)}
                  error={fieldErrors[fieldName]}
                />
              ))}
            </div>

            {/* Related collections (reverse lookups) */}
            {formData._id && config.relatedCollections?.map((rel) => (
              <RelatedList
                key={`${rel.collection}-${rel.foreignKey}`}
                collection={rel.collection}
                foreignKey={rel.foreignKey}
                title={rel.title}
                displayFields={rel.displayFields}
                filters={rel.filters}
                sort={rel.sort}
                parentId={formData._id}
                allowCreate={rel.allowCreate}
                parentCollection={collection}
                parentLabel={formData.name || formData.title || formData.orderNumber || formData._id}
              />
            ))}

            {/* Metadata */}
            {formData._id && (
              <>
                <Separator />
                <div className="text-sm text-muted-foreground">
                  <p>ID: {formData._id}</p>
                  {formData.createdAt && (
                    <p>Created: {new Date(formData.createdAt).toLocaleString()}</p>
                  )}
                  {formData.updatedAt && (
                    <p>Updated: {new Date(formData.updatedAt).toLocaleString()}</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this {singularLabel.toLowerCase()}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
