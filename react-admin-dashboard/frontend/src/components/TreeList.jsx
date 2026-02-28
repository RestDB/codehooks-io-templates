import { useState, useMemo } from 'react';
import { CellValue } from './MasterList.jsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChevronRight, ChevronDown, Plus } from 'lucide-react';

/**
 * Builds a map: parentId -> [children] from a flat list of items.
 */
function buildChildrenMap(items, parentField) {
  const map = new Map();
  for (const item of items) {
    const parentRef = item[parentField];
    const parentId = parentRef?._id || null;
    if (!map.has(parentId)) map.set(parentId, []);
    map.get(parentId).push(item);
  }
  return map;
}

/**
 * Collect all ancestor IDs for a set of item IDs.
 * Used to preserve tree structure when filtering.
 */
function collectAncestorIds(itemIds, itemsById, parentField) {
  const ancestors = new Set();
  for (const id of itemIds) {
    let current = itemsById.get(id);
    while (current) {
      const parentRef = current[parentField];
      const parentId = parentRef?._id;
      if (!parentId || ancestors.has(parentId)) break;
      ancestors.add(parentId);
      current = itemsById.get(parentId);
    }
  }
  return ancestors;
}

export default function TreeList({
  items,
  parentField,
  listFields,
  config,
  selectedId,
  onSelect,
  onCreate,
  rootParentId = null,
  search = '',
}) {
  const [expanded, setExpanded] = useState(new Set());

  // Build lookup maps
  const { childrenMap, itemsById, visibleIds } = useMemo(() => {
    const byId = new Map(items.map((item) => [item._id, item]));
    const cMap = buildChildrenMap(items, parentField);

    // If searching, figure out which items match + their ancestors
    let visible = null;
    if (search.trim()) {
      const lowerSearch = search.toLowerCase();
      const searchFields = config.searchFields || [];
      const matchIds = new Set();
      for (const item of items) {
        for (const field of searchFields) {
          const val = item[field];
          const text = typeof val === 'object' && val !== null
            ? (val.name || val.title || val._id || '')
            : String(val ?? '');
          if (text.toLowerCase().includes(lowerSearch)) {
            matchIds.add(item._id);
            break;
          }
        }
      }
      const ancestorIds = collectAncestorIds(matchIds, byId, parentField);
      visible = new Set([...matchIds, ...ancestorIds]);
    }

    return { childrenMap: cMap, itemsById: byId, visibleIds: visible };
  }, [items, parentField, search, config.searchFields]);

  // Auto-expand ancestors of search matches
  const effectiveExpanded = useMemo(() => {
    if (visibleIds) {
      // When searching, expand everything that's visible
      return visibleIds;
    }
    return expanded;
  }, [expanded, visibleIds]);

  const toggleExpand = (id, e) => {
    e.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddChild = (parentItem, e) => {
    e.stopPropagation();
    onCreate(parentItem);
  };

  // Recursively render tree rows
  const renderRows = (parentId, depth = 0) => {
    const children = childrenMap.get(parentId) || [];
    const rows = [];

    for (const item of children) {
      // If searching, skip items not in visible set
      if (visibleIds && !visibleIds.has(item._id)) continue;

      const hasChildren = (childrenMap.get(item._id) || []).length > 0;
      const isExpanded = effectiveExpanded.has(item._id);

      rows.push(
        <TableRow
          key={item._id}
          className={`cursor-pointer group/row ${selectedId === item._id ? 'bg-muted' : ''}`}
          onClick={() => onSelect(item)}
        >
          {listFields.map((field, colIdx) => (
            <TableCell key={field}>
              {colIdx === 0 ? (
                <div className="flex items-center" style={{ paddingLeft: `${depth * 20}px` }}>
                  {hasChildren ? (
                    <button
                      type="button"
                      className="p-0.5 mr-1 rounded hover:bg-muted-foreground/10 shrink-0"
                      onClick={(e) => toggleExpand(item._id, e)}
                    >
                      {isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  ) : (
                    <span className="w-5 shrink-0" />
                  )}
                  <span className="truncate">
                    <CellValue value={item[field]} propDef={config.schema.properties[field]} />
                  </span>
                  <button
                    type="button"
                    className="ml-1 p-0.5 rounded opacity-0 group-hover/row:opacity-100 hover:bg-muted-foreground/10 shrink-0 transition-opacity"
                    onClick={(e) => handleAddChild(item, e)}
                    title="Add child"
                  >
                    <Plus className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
              ) : (
                <CellValue value={item[field]} propDef={config.schema.properties[field]} />
              )}
            </TableCell>
          ))}
        </TableRow>
      );

      // Render children if expanded
      if (hasChildren && isExpanded) {
        rows.push(...renderRows(item._id, depth + 1));
      }
    }

    return rows;
  };

  return (
    <div className="overflow-auto flex-1 min-h-0">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            {listFields.map((field) => {
              const prop = config.schema.properties[field];
              return (
                <TableHead key={field}>
                  <div className="flex items-center gap-1">
                    {prop?.title || field}
                  </div>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={listFields.length}
                className="text-center py-8 text-muted-foreground"
              >
                No {config.label.toLowerCase()} found.
              </TableCell>
            </TableRow>
          ) : (
            renderRows(rootParentId)
          )}
        </TableBody>
      </Table>
    </div>
  );
}
