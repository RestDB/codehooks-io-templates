import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchDatamodel, fetchCollection, deleteDocument } from '../api/collectionApi.js';
import MasterList from '../components/MasterList.jsx';
import DetailPanel from '../components/DetailPanel.jsx';
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
    // Check if arriving from a related list "+ New" navigation
    if (location.state?.creating) {
      setIsCreating(true);
      setPrefill(location.state.prefill || null);
    } else {
      setIsCreating(false);
      setPrefill(null);
    }
  }, [collection]);

  // Sync selectedId with URL
  useEffect(() => {
    setSelectedId(id || null);
  }, [id]);

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

      const data = await fetchCollection(collection, {
        search,
        searchFields,
        sort,
        limit: LIMIT,
        offset,
      });
      setItems(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [collection, config, search, sortField, sortDir, offset]);

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
