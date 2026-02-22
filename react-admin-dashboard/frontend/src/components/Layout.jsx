import { Outlet, Link, useParams, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppSidebar } from './AppSidebar.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export default function Layout() {
  const { collection, id } = useParams();
  const location = useLocation();
  const isSubPage = collection || location.pathname !== '/';

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                {isSubPage ? (
                  <BreadcrumbLink asChild>
                    <Link to="/">Admin</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>Admin</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {location.pathname === '/activity' && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>Activity Log</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
              {location.pathname === '/datamodel' && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>Datamodel</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
              {location.pathname === '/users' && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>Users</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
              {collection && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {id ? (
                      <BreadcrumbLink asChild>
                        <Link to={`/${collection}`}>
                          {collection.charAt(0).toUpperCase() + collection.slice(1)}
                        </Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>
                        {collection.charAt(0).toUpperCase() + collection.slice(1)}
                      </BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {id && (
                    <>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbPage>Detail</BreadcrumbPage>
                      </BreadcrumbItem>
                    </>
                  )}
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>
        <div className="flex-1 p-4 overflow-hidden flex flex-col min-h-0">
          <Outlet />
        </div>
      </SidebarInset>
      <Toaster richColors position="bottom-right" />
    </SidebarProvider>
  );
}
