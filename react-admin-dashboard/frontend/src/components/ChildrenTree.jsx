import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCollection } from '../api/collectionApi.js';
import TreeList from './TreeList.jsx';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export default function ChildrenTree({ collection, config, parentId, parentLabel }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const parentField = config.treeView.parentField;
  const listFields = config.listFields || Object.keys(config.schema.properties).slice(0, 4);
  const singularLabel = config.label.replace(/s$/, '');

  useEffect(() => {
    if (!parentId) return;
    setLoading(true);

    // Fetch all items that are descendants — we get all items in the collection
    // that have a parent, then filter client-side for the subtree
    fetchCollection(collection, {
      query: { [`${parentField}._id`]: { $exists: true } },
      limit: 1000,
      offset: 0,
    })
      .then((data) => setItems(data))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [collection, parentField, parentId]);

  const handleSelect = (item) => {
    navigate(`/${collection}/${item._id}`);
  };

  const handleCreateChild = (parentItem) => {
    const displayField = config.schema.properties[parentField]?.['x-lookup']?.displayField || 'name';
    const primaryField = Array.isArray(displayField) ? displayField[0] : displayField;
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

  const handleCreateDirectChild = () => {
    navigate(`/${collection}`, {
      state: {
        creating: true,
        prefill: {
          foreignKey: `${parentField}._id`,
          parentId,
          parentLabel: parentLabel || parentId,
          parentCollection: collection,
        },
      },
    });
  };

  return (
    <div className="bg-muted rounded-lg mt-4">
      <div className="flex items-center px-3 py-2 gap-2">
        <span className="font-medium text-sm">Sub-{config.label.toLowerCase()}</span>
        {!loading && <Badge variant="secondary" className="text-xs">{items.filter((i) => i[parentField]?._id === parentId).length}</Badge>}
        <div className="flex-1" />
        <Button size="sm" variant="default" onClick={handleCreateDirectChild}>
          + New
        </Button>
      </div>

      <div className="px-3 pb-3">
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : items.filter((i) => i[parentField]?._id === parentId).length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No sub-{config.label.toLowerCase()}.</p>
        ) : (
          <TreeList
            items={items}
            parentField={parentField}
            listFields={listFields}
            config={config}
            onSelect={handleSelect}
            onCreate={handleCreateChild}
            rootParentId={parentId}
          />
        )}
      </div>
    </div>
  );
}
