import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchDatamodel, fetchStats, fetchActivityLog } from '../api/collectionApi.js';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ClipboardList,
  Activity,
  TrendingUp,
} from 'lucide-react';
import iconMap from '../lib/iconMap.js';

export default function DashboardPage() {
  const [datamodel, setDatamodel] = useState(null);
  const [stats, setStats] = useState({});
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([fetchDatamodel(), fetchStats(), fetchActivityLog({ limit: 10 })])
      .then(([dm, st, acts]) => {
        setDatamodel(dm);
        setStats(st || {});
        setActivities(acts || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="overflow-auto flex-1 min-h-0">
        <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="@container/card">
                <CardHeader>
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-20" />
                </CardHeader>
                <CardFooter className="flex-col items-start gap-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </CardFooter>
              </Card>
            ))}
          </div>
          <div className="px-4 lg:px-6">
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full mt-3 first:mt-0" />
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (!datamodel) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-destructive text-sm">{error || 'Failed to load dashboard data'}</p>
      </div>
    );
  }

  return (
    <div className="overflow-auto flex-1 min-h-0">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          {/* Section Cards */}
          <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
            {Object.entries(datamodel.collections).map(([key, config]) => {
              const Icon = iconMap[config.icon] || ClipboardList;
              const count = stats[key]?.count ?? 0;
              return (
                <Link key={key} to={`/${key}`}>
                  <Card className="@container/card hover:shadow-md transition-shadow">
                    <CardHeader>
                      <CardDescription>{config.label}</CardDescription>
                      <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                        {count.toLocaleString()}
                      </CardTitle>
                      <CardAction>
                        <Badge variant="outline">
                          <Icon className="size-3" />
                          records
                        </Badge>
                      </CardAction>
                    </CardHeader>
                    <CardFooter className="flex-col items-start gap-1.5 text-sm">
                      <div className="line-clamp-1 flex gap-2 font-medium">
                        View {config.label.toLowerCase()} <TrendingUp className="size-4" />
                      </div>
                      <div className="text-muted-foreground">
                        {count} total records
                      </div>
                    </CardFooter>
                  </Card>
                </Link>
              );
            })}
          </div>

          {/* Recent Activity */}
          <div className="px-4 lg:px-6">
            <Card>
              <CardHeader>
                <CardDescription>Recent changes across all collections</CardDescription>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="size-5" />
                  Recent Activity
                </CardTitle>
                <CardAction>
                  <Link to="/activity">
                    <Badge variant="outline" className="cursor-pointer">View All</Badge>
                  </Link>
                </CardAction>
              </CardHeader>
              <CardContent>
                {activities.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No activity recorded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {activities.map((act) => (
                      <div key={act._id} className="flex items-start gap-3 text-sm">
                        <Badge
                          variant={
                            act.action === 'created' ? 'default' :
                            act.action === 'updated' ? 'secondary' :
                            'destructive'
                          }
                          className="text-xs shrink-0 mt-0.5"
                        >
                          {act.action}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          {act.action !== 'deleted' && act.documentId ? (
                            <Link
                              to={`/${act.collection}/${act.documentId}`}
                              className="truncate block hover:underline text-primary"
                            >
                              {act.summary}
                            </Link>
                          ) : (
                            <p className="truncate">{act.summary}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {new Date(act.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
