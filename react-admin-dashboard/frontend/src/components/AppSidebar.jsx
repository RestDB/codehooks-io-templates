import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { fetchDatamodel } from '../api/collectionApi.js';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  LayoutDashboard,
  LogOut,
  Activity,
  Code,
  DatabaseZap,
  Users,
  List,
} from 'lucide-react';
import iconMap from '../lib/iconMap.js';

export function AppSidebar() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { collection: activeCollection } = useParams();
  const location = useLocation();
  const { setOpenMobile } = useSidebar();
  const [datamodel, setDatamodel] = useState(null);
  const [sidebarError, setSidebarError] = useState(false);

  useEffect(() => {
    fetchDatamodel()
      .then(setDatamodel)
      .catch(() => setSidebarError(true));
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleNav = () => {
    setOpenMobile(false);
  };

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/" onClick={handleNav}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  {(() => { const I = iconMap[datamodel?.app?.icon] || LayoutDashboard; return <I className="size-4" />; })()}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{datamodel?.app?.title || 'Admin Panel'}</span>
                  <span className="truncate text-xs text-muted-foreground">{datamodel?.app?.subtitle || ''}</span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={!activeCollection && location.pathname === '/'}>
                  <NavLink to="/" onClick={handleNav}>
                    <LayoutDashboard className="size-4" />
                    <span>Dashboard</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/activity'}>
                  <NavLink to="/activity" onClick={handleNav}>
                    <Activity className="size-4" />
                    <span>Activity Log</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Collections</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {sidebarError && (
                <SidebarMenuItem>
                  <span className="px-2 text-xs text-destructive">Failed to load</span>
                </SidebarMenuItem>
              )}
              {datamodel && Object.entries(datamodel.collections).map(([key, config]) => {
                const Icon = iconMap[config.icon] || List;
                return (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton asChild isActive={activeCollection === key}>
                      <NavLink to={`/${key}`} onClick={handleNav}>
                        <Icon className="size-4" />
                        <span>{config.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/users'}>
                    <NavLink to="/users" onClick={handleNav}>
                      <Users className="size-4" />
                      <span>Users</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/datamodel'}>
                    <NavLink to="/datamodel" onClick={handleNav}>
                      <DatabaseZap className="size-4" />
                      <span>Datamodel</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/docs" target="_blank" rel="noopener noreferrer" onClick={handleNav}>
                      <Code className="size-4" />
                      <span>API Docs</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                  {user?.username?.[0]?.toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user?.username || 'User'}</span>
                <span className="truncate text-xs text-muted-foreground capitalize">{user?.role || 'user'}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout}>
              <LogOut className="size-4" />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
