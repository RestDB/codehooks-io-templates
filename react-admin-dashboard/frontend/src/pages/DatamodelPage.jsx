import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { fetchDatamodel, updateDatamodel, fetchDatamodelPrompt, fetchDatamodelVersions, fetchDatamodelVersion } from '../api/collectionApi.js';
import FieldEditorDrawer from '../components/FieldEditorDrawer.jsx';
import OptionsEditor from '../components/OptionsEditor.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowRight,
  Database,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Plus,
  Settings2,
  Loader2,
  X,
  Copy,
  Check,
  History,
  RotateCcw,
} from 'lucide-react';
import iconMap from '../lib/iconMap.js';

const TYPE_COLORS = {
  string: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  number: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  integer: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  boolean: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  object: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  array: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
};

const FORMAT_LABELS = {
  email: 'email',
  url: 'URL',
  date: 'date',
  'date-time': 'datetime',
  textarea: 'text',
  image: 'image',
  file: 'file',
};

const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'];

export default function DatamodelPage() {
  const [datamodel, setDatamodel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState(null);
  const [saving, setSaving] = useState(false);

  // Drawer state
  const [drawerField, setDrawerField] = useState(null); // { collection, name, definition }

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null); // { collection, field } or { collection }

  // Rename tracking
  const [renameField, setRenameField] = useState(null); // { collection, oldName }
  const [renameValue, setRenameValue] = useState('');
  const [renameColl, setRenameColl] = useState(null); // { oldName }
  const [renameCollValue, setRenameCollValue] = useState('');

  // JSON editor state
  const [jsonEditing, setJsonEditing] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState(null);
  const [jsonSaving, setJsonSaving] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptIncludeData, setPromptIncludeData] = useState(true);

  // Version history state
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [selectedVersionData, setSelectedVersionData] = useState(null);
  const [versionLoading, setVersionLoading] = useState(false);

  useEffect(() => {
    fetchDatamodel()
      .then(setDatamodel)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // ---- Edit mode actions ----
  const startEditing = () => {
    setEditData(structuredClone(datamodel));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setEditData(null);
    setIsEditing(false);
    setDrawerField(null);
    setDeleteTarget(null);
    setRenameField(null);
    setRenameColl(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Apply any pending renames before saving (blur + click race condition)
      let dataToSave = structuredClone(editData);

      if (renameField && renameValue && renameValue !== renameField.oldName) {
        const c = dataToSave.collections[renameField.collection];
        if (c && !c.schema.properties[renameValue]) {
          const entries = Object.entries(c.schema.properties);
          c.schema.properties = {};
          for (const [k, v] of entries) {
            c.schema.properties[k === renameField.oldName ? renameValue : k] = v;
          }
          c.schema.required = (c.schema.required || []).map((r) => r === renameField.oldName ? renameValue : r);
          c.listFields = c.listFields.map((f) => f === renameField.oldName ? renameValue : f);
          c.searchFields = c.searchFields.map((f) => f === renameField.oldName ? renameValue : f);
          if (c.defaultSort?.[renameField.oldName] !== undefined) {
            const dir = c.defaultSort[renameField.oldName];
            delete c.defaultSort[renameField.oldName];
            c.defaultSort[renameValue] = dir;
          }
        }
      }

      if (renameColl && renameCollValue) {
        const clean = renameCollValue.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (clean && clean !== renameColl.oldName && !dataToSave.collections[clean]) {
          const entries = Object.entries(dataToSave.collections);
          const rebuilt = {};
          for (const [k, v] of entries) {
            rebuilt[k === renameColl.oldName ? clean : k] = v;
          }
          dataToSave.collections = rebuilt;
        }
      }

      // Resolve lookup fields to dot notation before saving
      const firstDisplayField = (df) => {
        if (Array.isArray(df)) return df[0];
        return df;
      };
      for (const coll of Object.values(dataToSave.collections)) {
        const props = coll.schema?.properties || {};
        // Collection-level searchFields: "product" → "product.name"
        if (coll.searchFields) {
          coll.searchFields = coll.searchFields.map((f) => {
            const base = f.split('.')[0];
            const prop = props[base];
            if (prop?.type === 'object' && prop['x-lookup']?.displayField && !f.includes('.')) {
              return `${f}.${firstDisplayField(prop['x-lookup'].displayField)}`;
            }
            return f;
          });
        }
        // Lookup x-lookup.searchFields: resolve nested lookups in target collection
        for (const prop of Object.values(props)) {
          const lookup = prop['x-lookup'];
          if (lookup?.searchFields && lookup.collection) {
            const targetProps = dataToSave.collections[lookup.collection]?.schema?.properties || {};
            lookup.searchFields = lookup.searchFields.map((f) => {
              const base = f.split('.')[0];
              const targetProp = targetProps[base];
              if (targetProp?.type === 'object' && targetProp['x-lookup']?.displayField && !f.includes('.')) {
                return `${f}.${firstDisplayField(targetProp['x-lookup'].displayField)}`;
              }
              return f;
            });
          }
        }
      }

      await updateDatamodel(dataToSave);
      toast.success('Datamodel saved');
      window.location.reload();
    } catch (err) {
      toast.error('Save failed', { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  // ---- Collection-level helpers ----
  const getCollectionConfig = (collName) => editData.collections[collName];

  const updateCollection = (collName, updater) => {
    setEditData((prev) => {
      const next = structuredClone(prev);
      updater(next.collections[collName]);
      return next;
    });
  };

  const addCollection = () => {
    const base = 'newcollection';
    let name = base;
    let i = 1;
    while (editData.collections[name]) { name = `${base}${i++}`; }
    setEditData((prev) => {
      const next = structuredClone(prev);
      next.collections[name] = {
        label: name.charAt(0).toUpperCase() + name.slice(1),
        icon: 'list',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', title: 'Name', minLength: 1 },
          },
          required: ['name'],
        },
        listFields: ['name'],
        searchFields: ['name'],
        defaultSort: { name: 1 },
      };
      return next;
    });
  };

  const deleteCollection = (collName) => {
    setEditData((prev) => {
      const next = structuredClone(prev);
      delete next.collections[collName];
      return next;
    });
    setDeleteTarget(null);
  };

  const moveCollection = (collName, direction) => {
    setEditData((prev) => {
      const next = structuredClone(prev);
      const entries = Object.entries(next.collections);
      const idx = entries.findIndex(([k]) => k === collName);
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= entries.length) return prev;
      [entries[idx], entries[newIdx]] = [entries[newIdx], entries[idx]];
      next.collections = Object.fromEntries(entries);
      return next;
    });
  };

  const renameCollection = (oldName, newName) => {
    if (!newName || newName === oldName || editData.collections[newName]) return;
    setEditData((prev) => {
      const next = structuredClone(prev);
      const entries = Object.entries(next.collections);
      const rebuilt = {};
      for (const [k, v] of entries) {
        rebuilt[k === oldName ? newName : k] = v;
      }
      return { ...next, collections: rebuilt };
    });
  };

  const commitCollectionRename = (oldName, newName) => {
    const clean = newName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean && clean !== oldName && !editData.collections[clean]) {
      renameCollection(oldName, clean);
    }
    setRenameColl(null);
  };

  // ---- JSON editor actions ----
  const startJsonEditing = () => {
    setJsonText(JSON.stringify(datamodel, null, 2));
    setJsonError(null);
    setJsonEditing(true);
  };

  const cancelJsonEditing = () => {
    setJsonEditing(false);
    setJsonText('');
    setJsonError(null);
  };

  const handleJsonSave = async () => {
    setJsonError(null);
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      setJsonError(`Invalid JSON: ${e.message}`);
      return;
    }
    setJsonSaving(true);
    try {
      await updateDatamodel(parsed);
      toast.success('Datamodel saved');
      window.location.reload();
    } catch (err) {
      toast.error('Save failed', { description: err.message });
    } finally {
      setJsonSaving(false);
    }
  };

  const handleCopyPrompt = async () => {
    try {
      const data = await fetchDatamodelPrompt({ includeData: promptIncludeData });
      await navigator.clipboard.writeText(data.prompt);
      setPromptCopied(true);
      toast.success('Prompt copied to clipboard');
      setTimeout(() => setPromptCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy prompt', { description: err.message });
    }
  };

  // ---- Version history ----
  const loadVersions = async () => {
    setVersionsLoading(true);
    try {
      const data = await fetchDatamodelVersions();
      setVersions(Array.isArray(data) ? data : []);
    } catch { setVersions([]); }
    finally { setVersionsLoading(false); }
  };

  const selectVersion = async (version) => {
    if (selectedVersion?._id === version._id) {
      setSelectedVersion(null);
      setSelectedVersionData(null);
      if (jsonEditing) {
        setJsonText(JSON.stringify(datamodel, null, 2));
        setJsonError(null);
      }
      return;
    }
    setSelectedVersion(version);
    setVersionLoading(true);
    try {
      const doc = await fetchDatamodelVersion(version._id);
      setSelectedVersionData(doc.data);
      if (jsonEditing) {
        setJsonText(JSON.stringify(doc.data, null, 2));
        setJsonError(null);
      }
    } catch {
      toast.error('Failed to load version');
      setSelectedVersionData(null);
    } finally {
      setVersionLoading(false);
    }
  };

  const restoreVersion = () => {
    if (!selectedVersionData) return;
    setJsonText(JSON.stringify(selectedVersionData, null, 2));
    setJsonError(null);
    setSelectedVersion(null);
    setSelectedVersionData(null);
    toast.info('Version loaded into editor — save to apply');
  };

  const computeDiff = (current, other) => {
    if (!current?.collections || !other?.collections) return null;
    const currentKeys = Object.keys(current.collections);
    const otherKeys = Object.keys(other.collections);
    const added = currentKeys.filter((k) => !otherKeys.includes(k));
    const removed = otherKeys.filter((k) => !currentKeys.includes(k));
    const shared = currentKeys.filter((k) => otherKeys.includes(k));
    let fieldsAdded = 0, fieldsRemoved = 0, fieldsChanged = 0;
    for (const coll of shared) {
      const curFields = Object.keys(current.collections[coll].schema?.properties || {});
      const otherFields = Object.keys(other.collections[coll].schema?.properties || {});
      fieldsAdded += curFields.filter((f) => !otherFields.includes(f)).length;
      fieldsRemoved += otherFields.filter((f) => !curFields.includes(f)).length;
      for (const f of curFields.filter((f) => otherFields.includes(f))) {
        if (JSON.stringify(current.collections[coll].schema.properties[f]) !== JSON.stringify(other.collections[coll].schema.properties[f])) {
          fieldsChanged++;
        }
      }
    }
    return { added, removed, fieldsAdded, fieldsRemoved, fieldsChanged };
  };

  // ---- Field-level helpers ----
  const getFieldEntries = (collName) => {
    return Object.entries(getCollectionConfig(collName).schema.properties);
  };

  const updateFieldDef = (collName, fieldName, newDef) => {
    updateCollection(collName, (c) => {
      c.schema.properties[fieldName] = newDef;
    });
    // Also update drawer if open
    if (drawerField && drawerField.collection === collName && drawerField.name === fieldName) {
      setDrawerField({ collection: collName, name: fieldName, definition: newDef });
    }
  };

  const setFieldType = (collName, fieldName, newType) => {
    updateCollection(collName, (c) => {
      const def = c.schema.properties[fieldName];
      def.type = newType;
      // Clean up incompatible properties
      if (newType !== 'string') { delete def.minLength; delete def.maxLength; delete def.format; delete def.enum; }
      if (newType !== 'number' && newType !== 'integer') { delete def.minimum; delete def.maximum; }
      if (newType !== 'object') { delete def['x-lookup']; }
      if (newType !== 'array') { delete def.items; }
      if (newType === 'array') { def.items = { type: 'string' }; }
    });
  };

  const toggleRequired = (collName, fieldName) => {
    updateCollection(collName, (c) => {
      const req = c.schema.required || [];
      if (req.includes(fieldName)) {
        c.schema.required = req.filter((r) => r !== fieldName);
      } else {
        c.schema.required = [...req, fieldName];
      }
    });
  };

  const addField = (collName) => {
    const props = getCollectionConfig(collName).schema.properties;
    let name = 'newField';
    let i = 1;
    while (props[name]) { name = `newField${i++}`; }
    updateCollection(collName, (c) => {
      c.schema.properties[name] = { type: 'string', title: name };
    });
    // Auto-enter rename mode so user can immediately type the field name
    setRenameField({ collection: collName, oldName: name });
    setRenameValue('');
  };

  const deleteField = (collName, fieldName) => {
    updateCollection(collName, (c) => {
      delete c.schema.properties[fieldName];
      c.schema.required = (c.schema.required || []).filter((r) => r !== fieldName);
      c.listFields = c.listFields.filter((f) => f !== fieldName);
      c.searchFields = c.searchFields.filter((f) => f !== fieldName);
      if (c.defaultSort && c.defaultSort[fieldName] !== undefined) {
        delete c.defaultSort[fieldName];
        if (Object.keys(c.defaultSort).length === 0) delete c.defaultSort;
      }
    });
    setDeleteTarget(null);
  };

  const commitRename = (collName, oldName, newName) => {
    if (!newName || newName === oldName) { setRenameField(null); return; }
    const props = getCollectionConfig(collName).schema.properties;
    if (props[newName]) { setRenameField(null); return; } // duplicate
    updateCollection(collName, (c) => {
      // Rebuild properties preserving order
      const entries = Object.entries(c.schema.properties);
      c.schema.properties = {};
      for (const [k, v] of entries) {
        const renamed = k === oldName ? newName : k;
        c.schema.properties[renamed] = v;
        // Auto-update title if it matches the old key name
        if (k === oldName && (v.title === oldName || !v.title)) {
          v.title = newName.charAt(0).toUpperCase() + newName.slice(1);
        }
      }
      // Cascade to references
      c.schema.required = (c.schema.required || []).map((r) => r === oldName ? newName : r);
      c.listFields = c.listFields.map((f) => f === oldName ? newName : f);
      c.searchFields = c.searchFields.map((f) => f === oldName ? newName : f);
      if (c.defaultSort && c.defaultSort[oldName] !== undefined) {
        const dir = c.defaultSort[oldName];
        delete c.defaultSort[oldName];
        c.defaultSort[newName] = dir;
      }
    });
    setRenameField(null);
  };

  const moveField = (collName, fieldName, direction) => {
    updateCollection(collName, (c) => {
      const entries = Object.entries(c.schema.properties);
      const idx = entries.findIndex(([k]) => k === fieldName);
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= entries.length) return;
      [entries[idx], entries[targetIdx]] = [entries[targetIdx], entries[idx]];
      c.schema.properties = Object.fromEntries(entries);
    });
  };

  // ---- Render ----
  if (loading) {
    return (
      <div className="flex flex-col gap-6 overflow-auto">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    );
  }

  if (!datamodel) {
    return <p className="text-destructive text-sm">{error || 'Failed to load datamodel.'}</p>;
  }

  const displayData = isEditing ? editData : datamodel;
  const collections = Object.entries(displayData.collections);
  const allCollectionNames = collections.map(([name]) => name);

  return (
    <Tabs defaultValue="editor" className="flex flex-col overflow-auto min-h-0 flex-1 gap-0">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 mb-4">
        <h1 className="text-lg font-semibold">Datamodel</h1>
        <TabsList>
          <TabsTrigger value="editor">Model Editor</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
      </div>

      {/* ===== Model Editor Tab ===== */}
      <TabsContent value="editor" className="flex flex-col gap-6 overflow-auto">
        {/* Toolbar */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex-1" />
          {!isEditing ? (
            <Button size="sm" onClick={startEditing}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          ) : (
            <>
              {editData && (
                <Button variant="outline" size="sm" onClick={addCollection}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add Collection
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={cancelEditing} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Save
              </Button>
            </>
          )}
        </div>

        {/* App Settings */}
        {isEditing && editData && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">App Settings</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="app-title">Title</Label>
                <Input
                  id="app-title"
                  value={editData.app?.title || ''}
                  onChange={(e) => setEditData((prev) => ({
                    ...prev,
                    app: { ...prev.app, title: e.target.value }
                  }))}
                  placeholder="App title"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="app-subtitle">Subtitle</Label>
                <Input
                  id="app-subtitle"
                  value={editData.app?.subtitle || ''}
                  onChange={(e) => setEditData((prev) => ({
                    ...prev,
                    app: { ...prev.app, subtitle: e.target.value }
                  }))}
                  placeholder="App subtitle"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="app-icon">Icon</Label>
                <Input
                  id="app-icon"
                  value={editData.app?.icon || ''}
                  onChange={(e) => setEditData((prev) => ({
                    ...prev,
                    app: { ...prev.app, icon: e.target.value }
                  }))}
                  placeholder="e.g. zap, shield, globe"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Collection cards */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {collections.map(([collName, config]) => {
          const required = config.schema.required || [];
          const fields = Object.entries(config.schema.properties);
          const fieldNames = fields.map(([n]) => n);

          return (
            <Card key={collName} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono">{collName}</span>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {fields.length} fields
                    </span>
                    {isEditing && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground"
                          disabled={collections.findIndex(([k]) => k === collName) === 0}
                          onClick={() => moveCollection(collName, -1)}
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground"
                          disabled={collections.findIndex(([k]) => k === collName) === collections.length - 1}
                          onClick={() => moveCollection(collName, 1)}
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget({ collection: collName })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {isEditing && (
                  <div className="flex gap-2 mt-1">
                    <div className="space-y-0.5 w-32">
                      <label className="text-[10px] text-muted-foreground">Key</label>
                      <Input
                        className="h-7 text-xs font-mono"
                        defaultValue={collName}
                        onBlur={(e) => {
                          const clean = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '');
                          if (clean && clean !== collName && !editData.collections[clean]) {
                            renameCollection(collName, clean);
                          } else {
                            e.target.value = collName;
                          }
                        }}
                        placeholder="Collection key"
                      />
                    </div>
                    <div className="space-y-0.5 flex-1">
                      <label className="text-[10px] text-muted-foreground">Label</label>
                      <Input
                        className="h-7 text-xs"
                        value={config.label}
                        onChange={(e) => updateCollection(collName, (c) => { c.label = e.target.value; })}
                        placeholder="Display label"
                      />
                    </div>
                    <div className="space-y-0.5 w-36">
                      <label className="text-[10px] text-muted-foreground">Icon</label>
                      <Select value={config.icon || ''} onValueChange={(v) => updateCollection(collName, (c) => { c.icon = v; })}>
                        <SelectTrigger className="h-7 text-xs">
                          <div className="flex items-center gap-1.5">
                            {(() => {
                              const Icon = iconMap[config.icon];
                              return Icon ? <Icon className="h-3.5 w-3.5" /> : null;
                            })()}
                            <span>{config.icon || 'Select...'}</span>
                          </div>
                        </SelectTrigger>
                        <SelectContent position="popper" className="max-h-56">
                          {Object.entries(iconMap).map(([name, Icon]) => (
                            <SelectItem key={name} value={name}>
                              <div className="flex items-center gap-2">
                                <Icon className="h-3.5 w-3.5" />
                                <span>{name}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <details className="group">
                  <summary className="px-6 py-2 cursor-pointer select-none flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-0 -rotate-90" />
                    Schema
                    <span className="font-normal normal-case tracking-normal">({fields.length} fields)</span>
                  </summary>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {isEditing && <TableHead className="w-16 pl-2"></TableHead>}
                      <TableHead className={isEditing ? '' : 'pl-6'}>Field</TableHead>
                      <TableHead>Type</TableHead>
                      {!isEditing && <TableHead>Details</TableHead>}
                      {isEditing && <TableHead className="w-16"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map(([fieldName, prop], idx) => {
                      const isRequired = required.includes(fieldName);
                      const isRenaming = renameField?.collection === collName && renameField?.oldName === fieldName;

                      return (
                        <TableRow key={fieldName}>
                          {/* Reorder */}
                          {isEditing && (
                            <TableCell className="pl-2 pr-0">
                              <div className="flex flex-col">
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                                  disabled={idx === 0}
                                  onClick={() => moveField(collName, fieldName, -1)}
                                >
                                  <ChevronUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                                  disabled={idx === fields.length - 1}
                                  onClick={() => moveField(collName, fieldName, 1)}
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </TableCell>
                          )}

                          {/* Field name */}
                          <TableCell className={`font-mono text-sm ${isEditing ? '' : 'pl-6'}`}>
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <Checkbox
                                  checked={isRequired}
                                  onCheckedChange={() => toggleRequired(collName, fieldName)}
                                  title="Required"
                                />
                                {isRenaming ? (
                                  <Input
                                    className="h-7 w-28 font-mono text-sm"
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={() => commitRename(collName, fieldName, renameValue)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') commitRename(collName, fieldName, renameValue);
                                      if (e.key === 'Escape') setRenameField(null);
                                    }}
                                    autoFocus
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className="hover:underline text-left"
                                    onClick={() => { setRenameField({ collection: collName, oldName: fieldName }); setRenameValue(fieldName); }}
                                  >
                                    {fieldName}
                                  </button>
                                )}
                              </div>
                            ) : (
                              <>
                                {fieldName}
                                {isRequired && <span className="text-destructive ml-0.5">*</span>}
                              </>
                            )}
                          </TableCell>

                          {/* Type */}
                          <TableCell>
                            {isEditing ? (
                              <Select value={prop.type} onValueChange={(v) => setFieldType(collName, fieldName, v)}>
                                <SelectTrigger className="h-7 text-xs w-24">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {FIELD_TYPES.map((t) => (
                                    <SelectItem key={t} value={t}>{t}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge
                                variant="secondary"
                                className={`text-[11px] font-normal ${TYPE_COLORS[prop.type] || ''}`}
                              >
                                {prop.type}
                              </Badge>
                            )}
                          </TableCell>

                          {/* Details (read-only only) */}
                          {!isEditing && (
                            <TableCell className="text-sm max-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 overflow-hidden">
                                {prop['x-lookup'] && (
                                  <Badge variant="outline" className="text-[11px] font-normal gap-1 shrink-0">
                                    <ArrowRight className="h-3 w-3" />
                                    {prop['x-lookup'].collection}
                                  </Badge>
                                )}
                                {prop.format && FORMAT_LABELS[prop.format] && (
                                  <Badge variant="outline" className="text-[11px] font-normal shrink-0">
                                    {FORMAT_LABELS[prop.format]}
                                  </Badge>
                                )}
                                {prop.enum && (
                                  <span className="text-xs text-muted-foreground truncate" title={prop.enum.join(' | ')}>
                                    {prop.enum.join(' | ')}
                                  </span>
                                )}
                                {prop.default !== undefined && (
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    = {String(prop.default)}
                                  </span>
                                )}
                                {prop.minLength && (
                                  <span className="text-xs text-muted-foreground shrink-0">min:{prop.minLength}</span>
                                )}
                                {prop.minimum !== undefined && (
                                  <span className="text-xs text-muted-foreground shrink-0">&ge;{prop.minimum}</span>
                                )}
                              </div>
                            </TableCell>
                          )}

                          {/* Actions */}
                          {isEditing && (
                            <TableCell className="pr-2">
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  className="p-1 text-muted-foreground hover:text-foreground rounded"
                                  title="Configure field"
                                  onClick={() => setDrawerField({ collection: collName, name: fieldName, definition: prop })}
                                >
                                  <Settings2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="p-1 text-muted-foreground hover:text-destructive rounded"
                                  title="Delete field"
                                  onClick={() => setDeleteTarget({ collection: collName, field: fieldName })}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {/* Add field button */}
                {isEditing && (
                  <div className="px-6 py-2 border-t">
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => addField(collName)}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add field
                    </Button>
                  </div>
                )}
                </details>

                {/* Options section (collapsible) */}
                <details className="border-t group">
                  <summary className="px-6 py-2 cursor-pointer select-none flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-0 -rotate-90" />
                    Options
                  </summary>
                  <OptionsEditor
                    config={config}
                    collectionName={collName}
                    fieldNames={fieldNames}
                    readOnly={!isEditing}
                    allCollections={allCollectionNames}
                    collectionsData={displayData.collections}
                    onChange={(updated) => {
                      setEditData((prev) => {
                        const next = structuredClone(prev);
                        const coll = next.collections[collName];
                        coll.listFields = updated.listFields;
                        coll.searchFields = updated.searchFields;
                        coll.defaultSort = updated.defaultSort;
                        if (updated.relatedCollections) {
                          coll.relatedCollections = updated.relatedCollections;
                        } else {
                          delete coll.relatedCollections;
                        }
                        if (updated.treeView) {
                          coll.treeView = updated.treeView;
                        } else {
                          delete coll.treeView;
                        }
                        return next;
                      });
                    }}
                  />
                </details>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Field editor drawer */}
      <FieldEditorDrawer
        open={!!drawerField}
        onClose={() => setDrawerField(null)}
        field={drawerField}
        allCollections={allCollectionNames}
        collectionsData={displayData.collections}
        onUpdate={(newDef) => {
          if (drawerField) {
            updateFieldDef(drawerField.collection, drawerField.name, newDef);
          }
        }}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>
              {deleteTarget?.field
                ? `Delete field "${deleteTarget.field}" from ${deleteTarget.collection}? This cannot be undone after saving.`
                : `Delete the entire "${deleteTarget?.collection}" collection? This cannot be undone after saving.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget?.field) {
                  deleteField(deleteTarget.collection, deleteTarget.field);
                } else if (deleteTarget?.collection) {
                  deleteCollection(deleteTarget.collection);
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </TabsContent>

      {/* ===== JSON Tab ===== */}
      <TabsContent value="json" className="flex flex-col gap-4 flex-1 min-h-0 overflow-hidden">
        {/* JSON toolbar */}
        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <Checkbox
              checked={promptIncludeData}
              onCheckedChange={(v) => setPromptIncludeData(!!v)}
            />
            Include current datamodel
          </label>
          <Button variant="outline" size="sm" onClick={handleCopyPrompt}>
            {promptCopied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
            {promptCopied ? 'Copied' : 'Copy Prompt'}
          </Button>
          <div className="flex-1" />
          {!jsonEditing ? (
            <Button size="sm" onClick={startJsonEditing}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={cancelJsonEditing} disabled={jsonSaving}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleJsonSave} disabled={jsonSaving}>
                {jsonSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Save
              </Button>
            </>
          )}
        </div>

        {/* JSON error */}
        {jsonError && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {jsonError}
          </div>
        )}

        {/* JSON content + version history */}
        <div className="flex gap-4 flex-1 min-h-0">
          {/* JSON view */}
          <div className="flex-1 min-w-0">
            {jsonEditing ? (
              <textarea
                className="h-full min-h-[500px] w-full font-mono text-sm bg-muted/50 border rounded-md p-4 resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                value={jsonText}
                onChange={(e) => { setJsonText(e.target.value); setJsonError(null); }}
                spellCheck={false}
              />
            ) : (
              <Card className="h-full min-h-[500px] overflow-hidden flex flex-col">
                <CardContent className="p-0 flex-1 min-h-0 overflow-auto">
                  <pre className="text-sm font-mono p-4 whitespace-pre">
                    <JsonHighlight json={selectedVersionData || displayData} />
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Version history panel (hidden on mobile) */}
          <div className="w-64 shrink-0 hidden lg:flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" />
                History
              </h4>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={loadVersions} disabled={versionsLoading}>
                {versionsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load'}
              </Button>
            </div>

            {selectedVersion && selectedVersionData && jsonEditing && (() => {
              const diff = computeDiff(datamodel, selectedVersionData);
              return (
                <div className="space-y-2">
                  <Button size="sm" variant="outline" className="w-full text-xs" onClick={restoreVersion}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    Restore this version
                  </Button>
                  {diff && (
                    <div className="text-[11px] text-muted-foreground bg-muted/50 rounded-md p-2 space-y-0.5">
                      <p className="font-medium text-foreground">Diff vs current:</p>
                      {diff.added.length > 0 && <p className="text-emerald-600 dark:text-emerald-400">+ collections: {diff.added.join(', ')}</p>}
                      {diff.removed.length > 0 && <p className="text-rose-500 dark:text-rose-400">- collections: {diff.removed.join(', ')}</p>}
                      {diff.fieldsAdded > 0 && <p className="text-emerald-600 dark:text-emerald-400">+ {diff.fieldsAdded} fields</p>}
                      {diff.fieldsRemoved > 0 && <p className="text-rose-500 dark:text-rose-400">- {diff.fieldsRemoved} fields</p>}
                      {diff.fieldsChanged > 0 && <p className="text-amber-600 dark:text-amber-400">~ {diff.fieldsChanged} fields modified</p>}
                      {diff.added.length === 0 && diff.removed.length === 0 && diff.fieldsAdded === 0 && diff.fieldsRemoved === 0 && diff.fieldsChanged === 0 && (
                        <p>No differences</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex flex-col gap-0.5 overflow-auto">
              {versions.length === 0 && !versionsLoading && (
                <p className="text-xs text-muted-foreground py-2">Click Load to fetch history</p>
              )}
              {versions.map((v) => (
                <button
                  key={v._id}
                  type="button"
                  className={`text-left px-2 py-1.5 rounded text-xs transition-colors ${
                    selectedVersion?._id === v._id
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => selectVersion(v)}
                  disabled={versionLoading}
                >
                  <div className="font-medium">
                    {new Date(v.savedAt).toLocaleString()}
                  </div>
                  <div className={selectedVersion?._id === v._id ? 'opacity-70' : 'text-muted-foreground'}>
                    {v.savedBy}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function JsonHighlight({ json }) {
  const raw = JSON.stringify(json, null, 2);
  // Match JSON tokens: strings, numbers, booleans, null, punctuation
  const tokenRegex = /("(?:\\.|[^"\\])*")\s*(:)?|(-?\d+\.?\d*(?:e[+-]?\d+)?)\b|\b(true|false)\b|\b(null)\b|([{}[\],])/g;
  const elements = [];
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(raw)) !== null) {
    // Add any whitespace/text before this token
    if (match.index > lastIndex) {
      elements.push(<span key={`w${lastIndex}`}>{raw.slice(lastIndex, match.index)}</span>);
    }
    const i = match.index;
    if (match[1] !== undefined) {
      // String — key if followed by ':'
      if (match[2]) {
        elements.push(<span key={i} className="text-sky-600 dark:text-sky-400">{match[1]}</span>);
        elements.push(<span key={`c${i}`}>: </span>);
      } else {
        elements.push(<span key={i} className="text-emerald-600 dark:text-emerald-400">{match[1]}</span>);
      }
    } else if (match[3] !== undefined) {
      elements.push(<span key={i} className="text-amber-600 dark:text-amber-400">{match[3]}</span>);
    } else if (match[4] !== undefined) {
      elements.push(<span key={i} className="text-violet-600 dark:text-violet-400">{match[4]}</span>);
    } else if (match[5] !== undefined) {
      elements.push(<span key={i} className="text-rose-500 dark:text-rose-400">{match[5]}</span>);
    } else if (match[6] !== undefined) {
      elements.push(<span key={i} className="text-muted-foreground/60">{match[6]}</span>);
    }
    lastIndex = tokenRegex.lastIndex;
  }
  // Remaining whitespace
  if (lastIndex < raw.length) {
    elements.push(<span key={`end`}>{raw.slice(lastIndex)}</span>);
  }

  return <>{elements}</>;
}
