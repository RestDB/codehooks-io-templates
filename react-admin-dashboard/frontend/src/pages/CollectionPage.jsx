import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchDatamodel, fetchCollection, deleteDocument } from '../api/collectionApi.js';
import MasterList from '../components/MasterList.jsx';
import TreeList from '../components/TreeList.jsx';
import DetailPanel from '../components/DetailPanel.jsx';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';

export default function CollectionPage() {
  const { collection, id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [config, setConfig] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(id || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState(1);
  const [offset, setOffset] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [prefill, setPrefill] = useState(null);

  const LIMIT = 25;

  // Load collection config + handle create-from-related-list
  useEffect(() => {
    setConfig(null);
    setError(null);
    fetchDatamodel()
      .then((dm) => {
        const collConfig = dm.collections[collection];
        if (collConfig) {
          setConfig(collConfig);
          if (collConfig.defaultSort) {
            const [field, dir] = Object.entries(collConfig.defaultSort)[0];
            setSortField(field);
            setSortDir(dir);
          }
        } else {
          setError(`Collection "${collection}" not found`);
          setLoading(false);
        }
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
    // Reset state on collection change
    setSelectedId(null);
    setSearch('');
    setOffset(0);
    setIsCreating(false);
    setPrefill(null);
  }, [collection]);

  // Handle "+ New" navigation (from related lists, tree children, etc.)
  useEffect(() => {
    if (location.state?.creating) {
      setIsCreating(true);
      setSelectedId(null);
      setPrefill(location.state.prefill || null);
    }
  }, [location.key]);

  // Sync selectedId with URL
  useEffect(() => {
    setSelectedId(id || null);
  }, [id]);

  const isTreeMode = !!config?.treeView;

  // Load items
  const loadItems = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    setError(null);
    try {
      const sort = sortField ? { [sortField]: sortDir } : {};
      // Resolve lookup fields to dot notation (e.g. "product" → "product.name")
      const searchFields = (config.searchFields || []).map((field) => {
        const prop = config.schema?.properties?.[field];
        if (prop?.type === 'object' && prop['x-lookup']?.displayField) {
          const df = prop['x-lookup'].displayField;
          const first = Array.isArray(df) ? df[0] : df;
          return `${field}.${first}`;
        }
        return field;
      });

      if (isTreeMode) {
        // Tree mode: fetch all items (no pagination, no server-side search)
        const data = await fetchCollection(collection, {
          sort,
          limit: 1000,
          offset: 0,
        });
        setItems(data);
      } else {
        const data = await fetchCollection(collection, {
          search,
          searchFields,
          sort,
          limit: LIMIT,
          offset,
        });
        setItems(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [collection, config, search, sortField, sortDir, offset, isTreeMode]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleSelect = (item) => {
    setIsCreating(false);
    setSelectedId(item._id);
    navigate(`/${collection}/${item._id}`);
  };

  const handleCreate = () => {
    setIsCreating(true);
    setSelectedId(null);
    setPrefill(null);
    navigate(`/${collection}`);
  };

  // Tree mode: create a child under a specific parent node
  const handleCreateChild = (parentItem) => {
    const parentField = config.treeView.parentField;
    const displayField = config.schema.properties[parentField]?.['x-lookup']?.displayField || 'name';
    const primaryField = Array.isArray(displayField) ? displayField[0] : displayField;
    setIsCreating(true);
    setSelectedId(null);
    setPrefill({
      foreignKey: `${parentField}._id`,
      parentId: parentItem._id,
      parentLabel: parentItem[primaryField] || parentItem.name || parentItem.title || parentItem._id,
      parentCollection: collection,
    });
    navigate(`/${collection}`, {
      state: {
        creating: true,
        prefill: {
          foreignKey: `${parentField}._id`,
          parentId: parentItem._id,
          parentLabel: parentItem[primaryField] || parentItem.name || parentItem.title || parentItem._id,
          parentCollection: collection,
        },
      },
    });
  };

  const handleBack = () => {
    setIsCreating(false);
    setSelectedId(null);
    setPrefill(null);
    navigate(`/${collection}`);
  };

  const handleDelete = async (itemId) => {
    try {
      await deleteDocument(collection, itemId);
      setSelectedId(null);
      setIsCreating(false);
      navigate(`/${collection}`);
      loadItems();
      toast.success('Record deleted');
    } catch (err) {
      setError(err.message);
      toast.error('Delete failed', { description: err.message });
    }
  };

  const handleSaved = (savedItem) => {
    setIsCreating(false);
    setPrefill(null);
    if (savedItem?._id) {
      setSelectedId(savedItem._id);
      navigate(`/${collection}/${savedItem._id}`);
    }
    loadItems();
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortField(field);
      setSortDir(1);
    }
    setOffset(0);
  };

  if (!config) {
    if (error) {
      return (
        <div className="bg-card border rounded-lg shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden p-4 gap-3 items-center justify-center">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      );
    }
    return (
      <div className="bg-card border rounded-lg shadow-sm flex-1 min-h-0 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const showDetail = selectedId || isCreating;

  if (showDetail) {
    return (
      <div className="bg-card border rounded-lg shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden">
        <DetailPanel
          collection={collection}
          config={config}
          selectedId={selectedId}
          isCreating={isCreating}
          prefill={prefill}
          onSaved={handleSaved}
          onDelete={handleDelete}
          onBack={handleBack}
          onCancel={handleBack}
        />
      </div>
    );
  }

  if (isTreeMode) {
    return (
      <div className="bg-card border rounded-lg shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Tree header */}
        <div className="p-3 border-b flex gap-2 items-center shrink-0">
          <Input
            type="text"
            placeholder={`Search ${config.label}...`}
            className="flex-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button size="sm" onClick={handleCreate}>
            + New
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="m-2">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="flex-1 min-h-0 p-3 flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <TreeList
            items={items}
            parentField={config.treeView.parentField}
            listFields={config.listFields || Object.keys(config.schema.properties).slice(0, 4)}
            config={config}
            selectedId={selectedId}
            onSelect={handleSelect}
            onCreate={handleCreateChild}
            search={search}
          />
        )}
      </div>
    );
  }

  return (
    <div className="bg-card border rounded-lg shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden">
      <MasterList
        collection={collection}
        config={config}
        items={items}
        loading={loading}
        error={error}
        selectedId={selectedId}
        search={search}
        onSearchChange={(val) => { setSearch(val); setOffset(0); }}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
        offset={offset}
        limit={LIMIT}
        onPageChange={setOffset}
        onSelect={handleSelect}
        onCreate={handleCreate}
      />
    </div>
  );
}
