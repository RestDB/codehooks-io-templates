import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCollection } from '../api/collectionApi.js';
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

function RelatedCellValue({ value }) {
  if (value === undefined || value === null) return '--';
  if (typeof value === 'object' && value._id) {
    const display = Object.entries(value).find(([k, v]) => k !== '_id' && typeof v === 'string');
    return display ? display[1] : value._id;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

const EMPTY_FILTERS = [];

function buildFilterQuery(filters, activeSet) {
  const include = {};
  const exclude = {};

  for (let i = 0; i < filters.length; i++) {
    if (!activeSet.has(i)) continue;
    const { field, value } = filters[i];
    if (filters[i].exclude) {
      (exclude[field] ||= []).push(value);
    } else {
      (include[field] ||= []).push(value);
    }
  }

  const query = {};
  const allFields = new Set([...Object.keys(include), ...Object.keys(exclude)]);

  for (const field of allFields) {
    const inc = include[field];
    const exc = exclude[field];

    if (inc) {
      query[field] = inc.length === 1 ? inc[0] : { $in: inc };
    } else if (exc) {
      query[field] = exc.length === 1 ? { $ne: exc[0] } : { $nin: exc };
    }
  }

  return query;
}

export default function RelatedList({
  collection,
  foreignKey,
  title,
  displayFields,
  parentId,
  filters = EMPTY_FILTERS,
  sort = {},
  allowCreate = false,
  parentCollection,
  parentLabel,
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeFilters, setActiveFilters] = useState(
    () => new Set(filters.map((f, i) => i).filter((i) => filters[i].active !== false))
  );

  const toggleFilter = (index) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleCreate = (e) => {
    e.stopPropagation();
    navigate(`/${collection}`, {
      state: {
        creating: true,
        prefill: { foreignKey, parentId, parentLabel, parentCollection },
      },
    });
  };

  useEffect(() => {
    if (!parentId) return;

    setLoading(true);
    setError(null);

    const query = {
      [foreignKey]: parentId,
      ...buildFilterQuery(filters, activeFilters),
    };

    fetchCollection(collection, { query, sort, limit: 50 })
      .then((data) => setItems(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [collection, foreignKey, parentId, filters, activeFilters]);

  return (
    <div className="bg-muted rounded-lg mt-4">
      {/* Toolbar */}
      <div className="flex items-center px-3 py-2 gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{title}</span>
          {!loading && <Badge variant="secondary" className="text-xs">{items.length}</Badge>}
        </div>
        <div className="flex flex-wrap gap-1 flex-1 justify-center">
          {filters.map((filter, i) => (
            <button
              key={i}
              type="button"
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium cursor-pointer border transition-colors ${
                activeFilters.has(i)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-transparent text-muted-foreground border-border hover:bg-muted'
              }`}
              onClick={() => toggleFilter(i)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          {allowCreate && (
            <Button size="sm" variant="default" onClick={handleCreate}>
              + New
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-3 pb-3">
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : error ? (
          <Alert variant="destructive" className="py-1">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No related records.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {displayFields.map((field) => (
                    <TableHead key={field} className="text-xs">{field}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item._id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/${collection}/${item._id}`)}
                  >
                    {displayFields.map((field) => (
                      <TableCell key={field} className="text-xs">
                        <RelatedCellValue value={item[field]} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
