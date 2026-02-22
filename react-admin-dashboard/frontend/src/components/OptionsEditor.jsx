import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  List,
  Search,
  ArrowUpDown,
  Link,
  X,
  Plus,
  Trash2,
  Filter,
  GripVertical,
} from 'lucide-react';

function SortableBadge({ id, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="inline-flex items-center rounded-full border border-transparent pl-1 pr-2 py-0.5 text-[11px] font-normal font-mono gap-0.5 bg-secondary text-secondary-foreground cursor-grab shrink-0 touch-none select-none"
    >
      <GripVertical className="h-3 w-3 text-muted-foreground/50" />
      {id}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(id); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="hover:text-destructive"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

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

export default function OptionsEditor({ config, fieldNames, onChange, readOnly, allCollections, collectionsData }) {
  const listFields = config.listFields || [];
  const searchFields = config.searchFields || [];
  const defaultSort = config.defaultSort || {};
  const sortEntries = Object.entries(defaultSort);
  const availableForList = fieldNames.filter((f) => !listFields.includes(f));

  // Resolve field name for search: lookup fields use dot notation (e.g. "customer.name")
  const resolveSearchField = (field) => {
    const prop = config.schema?.properties?.[field];
    if (prop?.type === 'object' && prop['x-lookup']?.displayField) {
      const df = prop['x-lookup'].displayField;
      const first = Array.isArray(df) ? df[0] : df;
      return `${field}.${first}`;
    }
    return field;
  };

  // Build available search fields: show resolved names, exclude already-added base fields
  const searchBaseFields = searchFields.map((f) => f.split('.')[0]);
  const availableForSearch = fieldNames.filter((f) => !searchBaseFields.includes(f));
  const sortField = sortEntries.length > 0 ? sortEntries[0][0] : '';
  const sortDir = sortEntries.length > 0 ? sortEntries[0][1] : 1;

  const update = (key, value) => {
    onChange({ ...config, [key]: value });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const removeListField = (f) => update('listFields', listFields.filter((x) => x !== f));
  const addListField = (f) => update('listFields', [...listFields, f]);
  const removeSearchField = (f) => update('searchFields', searchFields.filter((x) => x !== f));
  const addSearchField = (f) => update('searchFields', [...searchFields, resolveSearchField(f)]);

  const handleListDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = listFields.indexOf(active.id);
      const newIndex = listFields.indexOf(over.id);
      update('listFields', arrayMove(listFields, oldIndex, newIndex));
    }
  };


  const setSortField = (f) => {
    if (!f) { update('defaultSort', undefined); return; }
    update('defaultSort', { [f]: sortDir });
  };
  const toggleSortDir = () => {
    if (sortField) update('defaultSort', { [sortField]: sortDir === 1 ? -1 : 1 });
  };

  const relatedCollections = config.relatedCollections || [];

  const updateRelated = (index, key, value) => {
    const next = relatedCollections.map((r, i) => i === index ? { ...r, [key]: value } : r);
    update('relatedCollections', next);
  };

  const addRelated = () => {
    const firstColl = allCollections?.[0] || '';
    update('relatedCollections', [
      ...relatedCollections,
      { collection: firstColl, foreignKey: '', title: '', displayFields: ['name'], allowCreate: false },
    ]);
  };

  const removeRelated = (index) => {
    const next = relatedCollections.filter((_, i) => i !== index);
    update('relatedCollections', next.length > 0 ? next : undefined);
  };

  const updateFilter = (relIdx, filtIdx, key, value) => {
    const rel = { ...relatedCollections[relIdx] };
    rel.filters = rel.filters.map((f, i) => i === filtIdx ? { ...f, [key]: value } : f);
    const next = relatedCollections.map((r, i) => i === relIdx ? rel : r);
    update('relatedCollections', next);
  };

  const addFilter = (relIdx) => {
    const rel = { ...relatedCollections[relIdx] };
    rel.filters = [...(rel.filters || []), { field: '', value: '', label: '', active: true }];
    const next = relatedCollections.map((r, i) => i === relIdx ? rel : r);
    update('relatedCollections', next);
  };

  const removeFilter = (relIdx, filtIdx) => {
    const rel = { ...relatedCollections[relIdx] };
    rel.filters = rel.filters.filter((_, i) => i !== filtIdx);
    if (rel.filters.length === 0) delete rel.filters;
    const next = relatedCollections.map((r, i) => i === relIdx ? rel : r);
    update('relatedCollections', next);
  };

  // Read-only mode — same as current display
  if (readOnly) {
    return (
      <div className="px-6 pb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <List className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">List fields</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {listFields.map((f) => (
            <Badge key={f} variant="secondary" className="text-[11px] font-normal font-mono">{f}</Badge>
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Search className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Search fields</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {searchFields.map((f) => (
            <Badge key={f} variant="secondary" className="text-[11px] font-normal font-mono">{f}</Badge>
          ))}
        </div>

        {sortEntries.length > 0 && (
          <>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Default sort</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {sortEntries.map(([k, v]) => (
                <Badge key={k} variant="secondary" className="text-[11px] font-normal font-mono">
                  {k} {v === 1 ? '\u2191' : '\u2193'}
                </Badge>
              ))}
            </div>
          </>
        )}

        {config.relatedCollections?.length > 0 && (
          <>
            <div className="flex items-center gap-1.5 text-muted-foreground col-span-2 pt-1">
              <Link className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Related collections</span>
            </div>
            {config.relatedCollections.map((rel) => (
              <div key={`${rel.collection}-${rel.foreignKey}`} className="col-span-2 ml-5 pl-1 border-l-2 border-muted py-1.5 flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-[11px] font-normal font-mono">{rel.collection}</Badge>
                  <span className="text-xs text-muted-foreground">via</span>
                  <Badge variant="outline" className="text-[11px] font-normal font-mono">{rel.foreignKey}</Badge>
                  <span className="text-xs text-muted-foreground">&mdash; &ldquo;{rel.title}&rdquo;</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>Show: {rel.displayFields.join(', ')}</span>
                  {rel.sort && (
                    <span>Sort: {Object.entries(rel.sort).map(([k, v]) => `${k} ${v === 1 ? '\u2191' : '\u2193'}`).join(', ')}</span>
                  )}
                  {rel.allowCreate && <span>+ Create</span>}
                </div>
                {rel.filters?.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-xs mt-0.5">
                    <Filter className="h-3 w-3 text-muted-foreground" />
                    {rel.filters.map((f, i) => (
                      <Badge key={i} variant={f.exclude ? 'destructive' : 'outline'} className="text-[10px] font-normal font-mono">
                        {f.label}{!f.active && ' (off)'}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  // Edit mode
  return (
    <div className="px-6 pb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {/* List fields */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <List className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">List fields</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleListDragEnd}>
          <SortableContext items={listFields} strategy={horizontalListSortingStrategy}>
            {listFields.map((f) => (
              <SortableBadge key={f} id={f} onRemove={removeListField} />
            ))}
          </SortableContext>
        </DndContext>
        {availableForList.length > 0 && (
          <Select key={`list-${listFields.join(',')}`} onValueChange={addListField}>
            <SelectTrigger className="h-6 text-xs px-2 border-dashed gap-1 w-auto">
              <Plus className="h-3 w-3" />
              <span>Add</span>
            </SelectTrigger>
            <SelectContent position="popper" className="min-w-[8rem]">
              {availableForList.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Search fields */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Search className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Search fields</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {searchFields.map((f) => (
          <Badge key={f} variant="secondary" className="text-[11px] font-normal font-mono gap-1">
            {f}
            <button type="button" onClick={() => removeSearchField(f)} className="hover:text-destructive">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {availableForSearch.length > 0 && (
          <Select key={`search-${searchFields.join(',')}`} onValueChange={addSearchField}>
            <SelectTrigger className="h-6 text-xs px-2 border-dashed gap-1 w-auto">
              <Plus className="h-3 w-3" />
              <span>Add</span>
            </SelectTrigger>
            <SelectContent position="popper" className="min-w-[8rem]">
              {availableForSearch.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Default sort */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <ArrowUpDown className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Default sort</span>
      </div>
      <div className="flex items-center gap-2">
        <Select value={sortField || '_none'} onValueChange={(v) => setSortField(v === '_none' ? '' : v)}>
          <SelectTrigger className="h-7 text-xs w-auto">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">None</SelectItem>
            {fieldNames.map((f) => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sortField && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={toggleSortDir}>
            {sortDir === 1 ? '\u2191 asc' : '\u2193 desc'}
          </Button>
        )}
      </div>

      {/* Related collections */}
      <div className="flex items-center gap-1.5 text-muted-foreground col-span-2 pt-2">
        <Link className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Related collections</span>
      </div>

      {relatedCollections.map((rel, idx) => (
        <div key={idx} className="col-span-2 border rounded-md p-3 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="grid grid-cols-2 gap-2 flex-1">
              <div className="space-y-1">
                <Label className="text-xs">Collection</Label>
                <Select value={rel.collection} onValueChange={(v) => updateRelated(idx, 'collection', v)}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(allCollections || []).map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Foreign key</Label>
                {(() => {
                  const props = collectionsData?.[rel.collection]?.schema?.properties;
                  if (!props) {
                    return (
                      <Input
                        className="h-7 text-xs font-mono"
                        value={rel.foreignKey}
                        onChange={(e) => updateRelated(idx, 'foreignKey', e.target.value)}
                        placeholder="e.g., customerId"
                      />
                    );
                  }
                  // Build field paths including subfields for lookup/object fields
                  const fieldPaths = [];
                  for (const [name, def] of Object.entries(props)) {
                    fieldPaths.push(name);
                    if (def.type === 'object' && def['x-lookup']) {
                      fieldPaths.push(`${name}._id`);
                      const df = def['x-lookup'].displayField;
                      const displayFields = Array.isArray(df) ? df : df ? [df] : [];
                      for (const sf of displayFields) {
                        fieldPaths.push(`${name}.${sf}`);
                      }
                    }
                  }
                  return (
                    <Select value={rel.foreignKey || '_none'} onValueChange={(v) => updateRelated(idx, 'foreignKey', v === '_none' ? '' : v)}>
                      <SelectTrigger className="h-7 text-xs font-mono">
                        <SelectValue placeholder="Select field..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">Select field...</SelectItem>
                        {fieldPaths.map((f) => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                })()}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Title</Label>
                <Input
                  className="h-7 text-xs"
                  value={rel.title}
                  onChange={(e) => updateRelated(idx, 'title', e.target.value)}
                  placeholder="Section title"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Display fields</Label>
                <CommaInput
                  className="h-7 text-xs font-mono"
                  value={rel.displayFields || []}
                  onChange={(parsed) => updateRelated(idx, 'displayFields', parsed)}
                  placeholder="e.g., name, amount"
                />
              </div>
            </div>
            <button
              type="button"
              className="p-1 text-muted-foreground hover:text-destructive rounded mt-4"
              onClick={() => removeRelated(idx)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`allowCreate-${idx}`}
              checked={rel.allowCreate || false}
              onCheckedChange={(v) => updateRelated(idx, 'allowCreate', !!v)}
            />
            <Label htmlFor={`allowCreate-${idx}`} className="text-xs">Allow inline create</Label>
          </div>

          {/* Filters */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-1.5">
              <Filter className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Filters</span>
            </div>
            {(rel.filters || []).map((filt, fIdx) => (
              <div key={fIdx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-end">
                <div className="space-y-0.5">
                  <Label className="text-[10px]">Field</Label>
                  <Input
                    className="h-6 text-xs font-mono"
                    value={filt.field}
                    onChange={(e) => updateFilter(idx, fIdx, 'field', e.target.value)}
                    placeholder="field"
                  />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">Value</Label>
                  <Input
                    className="h-6 text-xs font-mono"
                    value={typeof filt.value === 'object' ? JSON.stringify(filt.value) : String(filt.value ?? '')}
                    onChange={(e) => {
                      const raw = e.target.value;
                      try { updateFilter(idx, fIdx, 'value', JSON.parse(raw)); }
                      catch { updateFilter(idx, fIdx, 'value', raw); }
                    }}
                    placeholder="value"
                  />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">Label</Label>
                  <Input
                    className="h-6 text-xs"
                    value={filt.label}
                    onChange={(e) => updateFilter(idx, fIdx, 'label', e.target.value)}
                    placeholder="label"
                  />
                </div>
                <button
                  type="button"
                  className="p-0.5 text-muted-foreground hover:text-destructive rounded mb-0.5"
                  onClick={() => removeFilter(idx, fIdx)}
                >
                  <X className="h-3 w-3" />
                </button>
                <div className="col-span-4 flex items-center gap-3 -mt-1">
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id={`filt-active-${idx}-${fIdx}`}
                      checked={filt.active !== false}
                      onCheckedChange={(v) => updateFilter(idx, fIdx, 'active', !!v)}
                    />
                    <Label htmlFor={`filt-active-${idx}-${fIdx}`} className="text-[10px]">Active</Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id={`filt-exclude-${idx}-${fIdx}`}
                      checked={filt.exclude || false}
                      onCheckedChange={(v) => updateFilter(idx, fIdx, 'exclude', !!v)}
                    />
                    <Label htmlFor={`filt-exclude-${idx}-${fIdx}`} className="text-[10px]">Exclude</Label>
                  </div>
                </div>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="h-6 text-[11px] text-muted-foreground px-2" onClick={() => addFilter(idx)}>
              <Plus className="h-3 w-3 mr-1" />
              Add filter
            </Button>
          </div>
        </div>
      ))}

      <div className="col-span-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={addRelated}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add related collection
        </Button>
      </div>
    </div>
  );
}
