import { useState, useEffect, useRef } from 'react';
import { fetchCollection } from '../api/collectionApi.js';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, Loader2, ExternalLink } from 'lucide-react';

export default function MultiLookupField({
  name,
  schema,
  value,
  onChange,
  readOnly,
  required,
  error,
}) {
  const label = schema.title || name;
  const lookup = schema['x-lookup'] || {};
  const collection = lookup.collection || '';
  const rawDisplayField = lookup.displayField || 'name';
  const displayFields = Array.isArray(rawDisplayField) ? rawDisplayField : [rawDisplayField];
  const searchFields = lookup.searchFields || displayFields;
  const navigate = useNavigate();

  const items = Array.isArray(value) ? value : [];

  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const dropdownRef = useRef(null);
  const debounceRef = useRef(null);

  const searchFieldsKey = searchFields.join(',');

  const resolveDisplay = (obj) => {
    if (obj == null) return '';
    const parts = displayFields.map((f) => {
      const val = obj[f];
      if (val == null) return null;
      if (typeof val === 'object') return val.name || val.title || val._id || '';
      return String(val);
    }).filter(Boolean);
    return parts.length > 0 ? parts.join(' — ') : obj._id || '';
  };

  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!searchText.trim() || !collection) {
      setResults([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const fields = searchFieldsKey.split(',').filter(Boolean);
        const data = await fetchCollection(collection, {
          search: searchText,
          searchFields: fields.length > 0 ? fields : displayFields,
          limit: 10,
        });
        setResults(Array.isArray(data) ? data : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [searchText, collection, searchFieldsKey]);

  const handleSelect = (item) => {
    if (items.some((i) => i._id === item._id)) return;
    const selected = { _id: item._id };
    for (const f of displayFields) {
      if (item[f] !== undefined) selected[f] = item[f];
    }
    onChange([...items, selected]);
    setSearchText('');
    setShowDropdown(false);
  };

  const handleRemove = (id) => {
    onChange(items.filter((i) => i._id !== id));
  };

  if (readOnly) {
    return (
      <div className="space-y-2">
        <Label className="font-medium">{label}</Label>
        <div className="px-3 py-2 bg-muted rounded-md min-h-[2.5rem]">
          {items.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {items.map((item) => (
                <Badge
                  key={item._id}
                  variant="secondary"
                  className="gap-1 text-xs font-normal cursor-pointer hover:bg-secondary/80"
                  onClick={() => navigate(`/${collection}/${item._id}`)}
                >
                  {resolveDisplay(item) || item._id}
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground/50">--</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" ref={dropdownRef}>
      <Label className="font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <Badge key={item._id} variant="secondary" className="gap-1 text-xs font-normal">
              {resolveDisplay(item) || item._id}
              <button
                type="button"
                className="ml-0.5 hover:text-destructive"
                onClick={() => handleRemove(item._id)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="relative">
        <Input
          type="text"
          className={error ? 'border-destructive' : ''}
          placeholder={`Search ${label.toLowerCase()}...`}
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => {
            if (searchText.trim()) setShowDropdown(true);
          }}
        />
        {searching && (
          <Loader2 className="h-4 w-4 animate-spin absolute right-3 top-2.5 text-muted-foreground" />
        )}

        {showDropdown && (searchText.trim() || results.length > 0) && (
          <div className="absolute z-50 w-full mt-1 max-h-48 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-lg">
            {results.length === 0 && !searching ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No results</div>
            ) : (
              results.map((item) => {
                const alreadySelected = items.some((i) => i._id === item._id);
                return (
                  <button
                    key={item._id}
                    type="button"
                    className={`w-full text-left px-3 py-2 text-sm cursor-pointer ${alreadySelected ? 'opacity-40' : 'hover:bg-accent hover:text-accent-foreground'}`}
                    onClick={() => handleSelect(item)}
                    disabled={alreadySelected}
                  >
                    {resolveDisplay(item)}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
