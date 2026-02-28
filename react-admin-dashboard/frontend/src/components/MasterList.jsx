import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function MasterList({
  collection,
  config,
  items,
  loading,
  error,
  selectedId,
  search,
  onSearchChange,
  sortField,
  sortDir,
  onSort,
  offset,
  limit,
  onPageChange,
  onSelect,
  onCreate,
}) {
  const [localSearch, setLocalSearch] = useState(search);
  const timerRef = useRef(null);

  // Sync local state when parent resets search (e.g. collection change)
  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  const handleSearchInput = (value) => {
    setLocalSearch(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onSearchChange(value), 300);
  };

  // Cleanup timer on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const listFields =
    config.listFields || Object.keys(config.schema.properties).slice(0, 4);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="p-3 border-b flex gap-2 items-center shrink-0">
        <Input
          type="text"
          placeholder={`Search ${config.label}...`}
          className="flex-1"
          value={localSearch}
          onChange={(e) => handleSearchInput(e.target.value)}
        />
        <Button size="sm" onClick={onCreate}>
          + New
        </Button>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive" className="m-2">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Table */}
      <div className="overflow-auto flex-1 min-h-0">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              {listFields.map((field) => {
                const prop = config.schema.properties[field];
                return (
                  <TableHead
                    key={field}
                    className="cursor-pointer select-none hover:bg-muted/50"
                    onClick={() => onSort(field)}
                  >
                    <div className="flex items-center gap-1">
                      {prop?.title || field}
                      {sortField === field && (
                        <span className="text-xs opacity-60">
                          {sortDir === 1 ? '\u25B2' : '\u25BC'}
                        </span>
                      )}
                    </div>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {listFields.map((field) => (
                    <TableCell key={field}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={listFields.length}
                  className="text-center py-8 text-muted-foreground"
                >
                  No {config.label.toLowerCase()} found.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow
                  key={item._id}
                  className={`cursor-pointer ${
                    selectedId === item._id ? 'bg-muted' : ''
                  }`}
                  onClick={() => onSelect(item)}
                >
                  {listFields.map((field) => (
                    <TableCell key={field}>
                      <CellValue
                        value={item[field]}
                        propDef={config.schema.properties[field]}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="p-2 border-t flex justify-between items-center text-sm shrink-0">
        <span className="text-muted-foreground">
          {items.length > 0
            ? `${offset + 1}\u2013${offset + items.length} items`
            : '0 items'}
        </span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => onPageChange(Math.max(0, offset - limit))}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={items.length < limit}
            onClick={() => onPageChange(offset + limit)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CellValue({ value, propDef }) {
  if (value === undefined || value === null) {
    return <span className="text-muted-foreground/50">--</span>;
  }
  if (propDef?.['x-lookup'] && Array.isArray(value)) {
    const raw = propDef['x-lookup']?.displayField || 'name';
    const fields = Array.isArray(raw) ? raw : [raw];
    const resolveItem = (item) => {
      if (!item || typeof item !== 'object') return '';
      return fields.map((f) => {
        const v = item[f];
        if (v == null) return null;
        if (typeof v === 'object') return v.name || v.title || v._id || '';
        return String(v);
      }).filter(Boolean).join(' — ') || item._id || '';
    };
    const displayed = value.slice(0, 3).map(resolveItem).filter(Boolean);
    const more = value.length > 3 ? ` +${value.length - 3}` : '';
    return (
      <span className="truncate max-w-[200px] block">{displayed.join(', ')}{more}</span>
    );
  }
  if (propDef?.['x-lookup'] && typeof value === 'object') {
    const raw = propDef['x-lookup']?.displayField || 'name';
    const fields = Array.isArray(raw) ? raw : [raw];
    const display = fields.map((f) => {
      const v = value[f];
      if (v == null) return null;
      if (typeof v === 'object') return v.name || v.title || v._id || '';
      return String(v);
    }).filter(Boolean).join(' — ') || value._id || '--';
    return (
      <span className="truncate max-w-[200px] block">{display}</span>
    );
  }
  if (propDef?.type === 'boolean') {
    return (
      <Badge variant={value ? 'default' : 'secondary'} className="text-xs">
        {value ? 'Yes' : 'No'}
      </Badge>
    );
  }
  if (propDef?.enum) {
    return <Badge variant="outline" className="text-xs">{String(value)}</Badge>;
  }
  if (propDef?.type === 'number') {
    return <span>{Number(value).toLocaleString()}</span>;
  }
  if (typeof value === 'object') {
    const display = value.name || value.title || value._id || JSON.stringify(value);
    return <span className="truncate max-w-[200px] block">{String(display)}</span>;
  }
  return (
    <span className="truncate max-w-[200px] block">{String(value)}</span>
  );
}
