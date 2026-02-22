import { useState, useEffect, useRef } from 'react';
import { fetchCollection } from '../api/collectionApi.js';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Loader2, ExternalLink } from 'lucide-react';

export default function LookupField({
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
  const primaryDisplayField = displayFields[0];
  const searchFields = lookup.searchFields || displayFields;
  const navigate = useNavigate();

  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const dropdownRef = useRef(null);
  const debounceRef = useRef(null);

  // Stable stringified key to avoid re-triggering effect on array reference changes
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

  const displayValue = resolveDisplay(value);

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
  }, [searchText, collection, primaryDisplayField, searchFieldsKey]);

  const handleSelect = (item) => {
    const selected = { _id: item._id };
    for (const f of displayFields) {
      if (item[f] !== undefined) selected[f] = item[f];
    }
    onChange(selected);
    setSearchText('');
    setShowDropdown(false);
  };

  const handleClear = () => {
    onChange(null);
    setSearchText('');
  };

  if (readOnly) {
    return (
      <div className="space-y-2">
        <Label className="font-medium">{label}</Label>
        <div className="px-3 py-2 bg-muted rounded-md min-h-[2.5rem]">
          {value?._id ? (
            <Badge
              variant="secondary"
              className="gap-1 text-xs font-normal cursor-pointer hover:bg-secondary/80"
              onClick={() => navigate(`/${collection}/${value._id}`)}
            >
              {displayValue || value._id}
              <ExternalLink className="h-3 w-3 opacity-50" />
            </Badge>
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

      {value?._id ? (
        <div className={`flex h-9 w-full items-center gap-2 rounded-md border bg-transparent px-3 py-1 text-sm ${error ? 'border-destructive' : 'border-input'}`}>
          <span className="flex-1 truncate">{displayValue || value._id}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            onClick={handleClear}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
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
                results.map((item) => (
                  <button
                    key={item._id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                    onClick={() => handleSelect(item)}
                  >
                    {resolveDisplay(item)}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
