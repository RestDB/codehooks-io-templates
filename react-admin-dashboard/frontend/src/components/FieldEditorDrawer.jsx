import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { X, Plus } from 'lucide-react';

const FORMAT_OPTIONS = {
  string: [
    { value: '', label: 'None' },
    { value: 'email', label: 'Email' },
    { value: 'url', label: 'URL' },
    { value: 'date', label: 'Date' },
    { value: 'date-time', label: 'Date & Time' },
    { value: 'textarea', label: 'Textarea' },
    { value: 'image', label: 'Image upload' },
    { value: 'file', label: 'File upload' },
  ],
  array: [
    { value: '', label: 'None' },
    { value: 'file', label: 'File upload (multi)' },
    { value: 'image', label: 'Image upload (multi)' },
  ],
};

/** Input that stores a comma-separated string locally and only parses to array on blur. */
function CommaInput({ value = [], onChange, ...props }) {
  const [text, setText] = useState(value.join(', '));
  const key = value.join(',');
  useEffect(() => { setText(value.join(', ')); }, [key]);
  return (
    <Input
      {...props}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const parsed = text.split(',').map((s) => s.trim()).filter(Boolean);
        onChange(parsed);
      }}
    />
  );
}

export default function FieldEditorDrawer({ open, onClose, field, onUpdate, allCollections, collectionsData }) {
  const [enumInput, setEnumInput] = useState('');

  if (!field) return null;

  const { name, definition } = field;
  const type = definition.type;
  const format = definition.format || '';
  const isObject = type === 'object';
  const isArray = type === 'array';
  const hasLookup = !!definition['x-lookup'];
  const formatOptions = FORMAT_OPTIONS[type];

  const update = (key, value) => {
    const next = { ...definition };
    if (value === '' || value === undefined || value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onUpdate(next);
  };

  const updateLookup = (key, value) => {
    const lookup = { ...(definition['x-lookup'] || {}) };
    lookup[key] = value;
    onUpdate({ ...definition, 'x-lookup': lookup });
  };

  const addEnumValue = () => {
    const val = enumInput.trim();
    if (!val) return;
    const current = definition.enum || [];
    if (!current.includes(val)) {
      update('enum', [...current, val]);
    }
    setEnumInput('');
  };

  const removeEnumValue = (val) => {
    const current = definition.enum || [];
    const next = current.filter((v) => v !== val);
    update('enum', next.length > 0 ? next : undefined);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="sm:max-w-md overflow-auto">
        <SheetHeader>
          <SheetTitle className="font-mono">{name}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 py-4">
          {/* Title */}
          <div className="space-y-1.5">
            <Label>Display title</Label>
            <Input
              value={definition.title || ''}
              onChange={(e) => update('title', e.target.value)}
              placeholder={name}
            />
          </div>

          {/* Format */}
          {formatOptions && !isObject && !hasLookup && (
            <div className="space-y-1.5">
              <Label>Format</Label>
              <Select value={format} onValueChange={(v) => update('format', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {formatOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value || '_none'}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Enum values (string type, no format) */}
          {type === 'string' && !format && !isObject && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <Label>Enum values</Label>
                <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
                  {(definition.enum || []).map((val) => (
                    <Badge key={val} variant="secondary" className="gap-1 text-xs">
                      {val}
                      <button type="button" onClick={() => removeEnumValue(val)} className="ml-0.5 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={enumInput}
                    onChange={(e) => setEnumInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEnumValue(); } }}
                    placeholder="Add value..."
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addEnumValue}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Default value */}
          {!isObject && (
            <div className="space-y-1.5">
              <Label>Default value</Label>
              <Input
                value={definition.default !== undefined ? String(definition.default) : ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') { update('default', undefined); return; }
                  if (type === 'number' || type === 'integer') {
                    const n = Number(raw);
                    if (!isNaN(n)) update('default', n);
                  } else if (type === 'boolean') {
                    update('default', raw === 'true');
                  } else {
                    update('default', raw);
                  }
                }}
                placeholder="No default"
              />
            </div>
          )}

          {/* Constraints */}
          {(type === 'string') && !isObject && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Min length</Label>
                  <Input
                    type="number"
                    min="0"
                    value={definition.minLength ?? ''}
                    onChange={(e) => update('minLength', e.target.value ? Number(e.target.value) : undefined)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Max length</Label>
                  <Input
                    type="number"
                    min="0"
                    value={definition.maxLength ?? ''}
                    onChange={(e) => update('maxLength', e.target.value ? Number(e.target.value) : undefined)}
                  />
                </div>
              </div>
            </>
          )}

          {(type === 'number' || type === 'integer') && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Minimum</Label>
                  <Input
                    type="number"
                    value={definition.minimum ?? ''}
                    onChange={(e) => update('minimum', e.target.value !== '' ? Number(e.target.value) : undefined)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Maximum</Label>
                  <Input
                    type="number"
                    value={definition.maximum ?? ''}
                    onChange={(e) => update('maximum', e.target.value !== '' ? Number(e.target.value) : undefined)}
                  />
                </div>
              </div>
            </>
          )}

          {/* Lookup config */}
          {(isObject || isArray) && (
            <>
              <Separator />
              <h4 className="text-sm font-medium">Lookup configuration</h4>
              {!hasLookup && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const firstColl = allCollections[0] || '';
                    const next = { ...definition, 'x-lookup': { collection: firstColl, displayField: 'name', searchFields: ['name'] } };
                    if (isArray) {
                      next.items = { type: 'object', properties: { _id: { type: 'string' } } };
                    }
                    onUpdate(next);
                  }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add lookup
                </Button>
              )}
              {hasLookup && (
                <>
                  <div className="space-y-1.5">
                    <Label>Target collection</Label>
                    <Select
                      value={definition['x-lookup']?.collection || ''}
                      onValueChange={(v) => updateLookup('collection', v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select collection" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {allCollections.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Display fields</Label>
                    {(() => {
                      const targetColl = definition['x-lookup']?.collection;
                      const targetFields = targetColl && collectionsData?.[targetColl]
                        ? Object.keys(collectionsData[targetColl].schema.properties)
                        : [];
                      const raw = definition['x-lookup']?.displayField;
                      const current = Array.isArray(raw) ? raw : (raw ? [raw] : []);
                      const toggleDisplay = (f) => {
                        const next = current.includes(f)
                          ? current.filter((d) => d !== f)
                          : [...current, f];
                        if (next.length > 0) {
                          updateLookup('displayField', next.length === 1 ? next[0] : next);
                        }
                      };
                      return (
                        <div className="flex flex-col gap-1.5">
                          {targetFields.map((f) => (
                            <label key={f} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={current.includes(f)}
                                onCheckedChange={() => toggleDisplay(f)}
                              />
                              <span className="font-mono text-xs">{f}</span>
                            </label>
                          ))}
                          {targetFields.length === 0 && (
                            <span className="text-xs text-muted-foreground">No fields available</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Search fields</Label>
                    {(() => {
                      const targetColl = definition['x-lookup']?.collection;
                      const targetProps = targetColl && collectionsData?.[targetColl]
                        ? collectionsData[targetColl].schema.properties
                        : {};
                      const targetFields = Object.keys(targetProps);
                      const currentSearch = definition['x-lookup']?.searchFields || [];
                      // Resolve field to dot notation if it's a lookup in the target collection
                      const resolveField = (f) => {
                        const prop = targetProps[f];
                        if (prop?.type === 'object' && prop['x-lookup']?.displayField) {
                          const df = prop['x-lookup'].displayField;
                          return `${f}.${Array.isArray(df) ? df[0] : df}`;
                        }
                        return f;
                      };
                      // Check if a base field is in currentSearch (handles both "product" and "product.name")
                      const isSelected = (f) => {
                        const resolved = resolveField(f);
                        return currentSearch.includes(f) || currentSearch.includes(resolved);
                      };
                      const toggleField = (f) => {
                        const resolved = resolveField(f);
                        const selected = isSelected(f);
                        const next = selected
                          ? currentSearch.filter((s) => s !== f && s !== resolved)
                          : [...currentSearch, resolved];
                        if (next.length > 0) updateLookup('searchFields', next);
                      };
                      return (
                        <div className="flex flex-col gap-1.5">
                          {targetFields.map((f) => {
                            const resolved = resolveField(f);
                            const isLookup = resolved !== f;
                            return (
                              <label key={f} className="flex items-center gap-2 text-sm cursor-pointer">
                                <Checkbox
                                  checked={isSelected(f)}
                                  onCheckedChange={() => toggleField(f)}
                                />
                                <span className="font-mono text-xs">
                                  {isLookup ? resolved : f}
                                </span>
                              </label>
                            );
                          })}
                          {targetFields.length === 0 && (
                            <span className="text-xs text-muted-foreground">No fields available</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      const next = { ...definition };
                      delete next['x-lookup'];
                      if (isArray) delete next.items;
                      onUpdate(next);
                    }}
                  >
                    <X className="h-3.5 w-3.5 mr-1.5" />
                    Remove lookup
                  </Button>
                </>
              )}
            </>
          )}

          {/* File/image accept */}
          {(format === 'file' || format === 'image') && (
            <div className="space-y-1.5">
              <Label>Accepted file types</Label>
              <Input
                value={definition['x-accept'] || ''}
                onChange={(e) => update('x-accept', e.target.value)}
                placeholder="e.g., .jpg,.png,.pdf"
              />
            </div>
          )}
        </div>

        <SheetFooter>
          <Button onClick={onClose}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
