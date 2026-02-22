import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { fetchUsers, createUser, updateUser, deleteUser } from '../api/collectionApi.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Trash2, KeyRound, Loader2, Shield, User, Ban, CheckCircle2 } from 'lucide-react';

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Add user dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ username: '', email: '', password: '', role: 'user' });
  const [addSaving, setAddSaving] = useState(false);

  // Edit role dialog
  const [editTarget, setEditTarget] = useState(null);
  const [editRole, setEditRole] = useState('user');
  const [editSaving, setEditSaving] = useState(false);

  // Reset password dialog
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetSaving, setResetSaving] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  const loadUsers = () => {
    setLoading(true);
    fetchUsers()
      .then(setUsers)
      .catch(() => toast.error('Failed to load users'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadUsers(); }, []);

  const handleAdd = async () => {
    if (!addForm.username || !addForm.password) {
      toast.error('Username and password are required');
      return;
    }
    setAddSaving(true);
    try {
      await createUser(addForm);
      toast.success(`User "${addForm.username}" created`);
      setAddOpen(false);
      setAddForm({ username: '', email: '', password: '', role: 'user' });
      loadUsers();
    } catch (err) {
      toast.error('Failed to create user', { description: err.message });
    } finally {
      setAddSaving(false);
    }
  };

  const handleEditRole = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      await updateUser(editTarget._id, { role: editRole });
      toast.success(`Role updated for "${editTarget.username}"`);
      setEditTarget(null);
      loadUsers();
    } catch (err) {
      toast.error('Failed to update role', { description: err.message });
    } finally {
      setEditSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget || !resetPassword) return;
    setResetSaving(true);
    try {
      await updateUser(resetTarget._id, { password: resetPassword });
      toast.success(`Password reset for "${resetTarget.username}"`);
      setResetTarget(null);
      setResetPassword('');
    } catch (err) {
      toast.error('Failed to reset password', { description: err.message });
    } finally {
      setResetSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try {
      await deleteUser(deleteTarget._id);
      toast.success(`User "${deleteTarget.username}" deleted`);
      setDeleteTarget(null);
      loadUsers();
    } catch (err) {
      toast.error('Failed to delete user', { description: err.message });
    } finally {
      setDeleteSaving(false);
    }
  };

  const handleToggleActive = async (u) => {
    try {
      await updateUser(u._id, { active: !(u.active !== false) });
      toast.success(`User "${u.username}" ${u.active !== false ? 'deactivated' : 'activated'}`);
      loadUsers();
    } catch (err) {
      toast.error('Failed to update user', { description: err.message });
    }
  };

  if (loading) {
    return (
      <div className="overflow-auto flex-1 min-h-0">
        <div className="flex flex-col gap-4 py-4 md:py-6 px-4 lg:px-6">
          <Skeleton className="h-8 w-48" />
          <Card>
            <CardContent className="p-0">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-4 border-b last:border-b-0">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-14" />
                  <Skeleton className="h-4 w-32 ml-auto" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-auto flex-1 min-h-0">
      <div className="flex flex-col gap-4 py-4 md:py-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Users</h1>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add User
          </Button>
        </div>

        {/* Users table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No users found
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((u) => {
                    const isSelf = u.username === currentUser?.username;
                    const isActive = u.active !== false;
                    return (
                      <TableRow key={u._id} className={!isActive ? 'opacity-50' : ''}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {u.role === 'admin' ? (
                              <Shield className="h-3.5 w-3.5 text-amber-500" />
                            ) : (
                              <User className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            {u.username}
                            {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{u.email || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={u.role === 'admin' ? 'default' : 'secondary'} className="text-xs">
                            {u.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {isActive ? (
                            <Badge variant="outline" className="text-xs text-emerald-600 dark:text-emerald-400">Active</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              title={isActive ? 'Deactivate user' : 'Activate user'}
                              disabled={isSelf}
                              onClick={() => handleToggleActive(u)}
                            >
                              {isActive ? (
                                <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => { setEditTarget(u); setEditRole(u.role); }}
                            >
                              Role
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              title="Reset password"
                              onClick={() => { setResetTarget(u); setResetPassword(''); }}
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-muted-foreground hover:text-destructive"
                              title="Delete user"
                              disabled={isSelf}
                              onClick={() => setDeleteTarget(u)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Add User Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>Create a new user account.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="add-username">Username</Label>
              <Input
                id="add-username"
                value={addForm.username}
                onChange={(e) => setAddForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="Enter username"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-email">Email (optional)</Label>
              <Input
                id="add-email"
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="user@example.com"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-password">Password</Label>
              <Input
                id="add-password"
                type="password"
                value={addForm.password}
                onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Enter password"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Role</Label>
              <Select value={addForm.role} onValueChange={(v) => setAddForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addSaving}>Cancel</Button>
            <Button onClick={handleAdd} disabled={addSaving}>
              {addSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
            <DialogDescription>Update the role for "{editTarget?.username}".</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label>Role</Label>
            <Select value={editRole} onValueChange={setEditRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditTarget(null)} disabled={editSaving}>Cancel</Button>
            <Button onClick={handleEditRole} disabled={editSaving}>
              {editSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>Set a new password for "{resetTarget?.username}".</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label htmlFor="reset-password">New Password</Label>
            <Input
              id="reset-password"
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="Enter new password"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetTarget(null)} disabled={resetSaving}>Cancel</Button>
            <Button onClick={handleResetPassword} disabled={resetSaving || !resetPassword}>
              {resetSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.username}"? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteSaving}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteSaving}>
              {deleteSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
