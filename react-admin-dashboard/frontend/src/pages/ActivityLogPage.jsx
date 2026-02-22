import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchActivityLog, fetchDatamodel, clearActivityLog } from '../api/collectionApi.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Activity, Trash2, Loader2 } from 'lucide-react';

export default function ActivityLogPage() {
  const { isAdmin } = useAuth();
  const [activities, setActivities] = useState([]);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterAction, setFilterAction] = useState('');
  const [filterCollection, setFilterCollection] = useState('');
  const [offset, setOffset] = useState(0);
  const [clearing, setClearing] = useState(false);
  const LIMIT = 25;

  useEffect(() => {
    fetchDatamodel()
      .then((dm) => setCollections(Object.keys(dm.collections)))
      .catch(() => { /* toast already shown by request() */ });
  }, []);

  const loadActivities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchActivityLog({
        action: filterAction || undefined,
        collection: filterCollection || undefined,
        limit: LIMIT,
        offset,
      });
      setActivities(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterAction, filterCollection, offset]);

  useEffect(() => {
    loadActivities();
  }, [loadActivities]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-6 w-6" />
          Activity Log
        </h1>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            disabled={clearing}
            onClick={async () => {
              if (!confirm('Clear the entire activity log? This cannot be undone.')) return;
              setClearing(true);
              try {
                await clearActivityLog();
                toast.success('Activity log cleared');
                setOffset(0);
                loadActivities();
              } catch (err) {
                toast.error('Failed to clear activity log');
              } finally {
                setClearing(false);
              }
            }}
          >
            {clearing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
            Clear Log
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap shrink-0">
        <Select
          value={filterAction || 'all'}
          onValueChange={(val) => { setFilterAction(val === 'all' ? '' : val); setOffset(0); }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All Actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="created">Created</SelectItem>
            <SelectItem value="updated">Updated</SelectItem>
            <SelectItem value="deleted">Deleted</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filterCollection || 'all'}
          onValueChange={(val) => { setFilterCollection(val === 'all' ? '' : val); setOffset(0); }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Collections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Collections</SelectItem>
            {collections.map((col) => (
              <SelectItem key={col} value={col}>
                {col.charAt(0).toUpperCase() + col.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4 shrink-0">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Table */}
      <div className="bg-card border rounded-lg shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Collection</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : activities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No activity found.
                  </TableCell>
                </TableRow>
              ) : (
                activities.map((act) => (
                  <TableRow key={act._id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(act.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{act.user}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          act.action === 'created' ? 'default' :
                          act.action === 'updated' ? 'secondary' :
                          'destructive'
                        }
                        className="text-xs"
                      >
                        {act.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {act.collection.charAt(0).toUpperCase() + act.collection.slice(1)}
                    </TableCell>
                    <TableCell className="max-w-[400px]">
                      {act.action !== 'deleted' && act.documentId ? (
                        <Link
                          to={`/${act.collection}/${act.documentId}`}
                          className="truncate block text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {act.summary}
                        </Link>
                      ) : (
                        <span className="truncate block">{act.summary}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="p-2 border-t flex justify-between items-center text-sm shrink-0">
          <span className="text-muted-foreground">
            {activities.length > 0
              ? `${offset + 1}\u2013${offset + activities.length} items`
              : '0 items'}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={activities.length < LIMIT}
              onClick={() => setOffset(offset + LIMIT)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
