import { useState, useEffect, useCallback } from 'react';
import {
  Title, Group, Button, Table, Badge, Modal, TextInput, Stack, Text, Alert, ActionIcon, Checkbox,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useNavigate } from 'react-router-dom';
import { IconUserPlus, IconAlertCircle, IconAlertTriangle, IconRefresh, IconTrash, IconKey, IconPower, IconLogout, IconPencil, IconCopy, IconShare, IconEye, IconSparkles, IconShieldUp, IconShieldDown } from '@tabler/icons-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

interface AdminUser {
  id: number;
  username: string;
  role: string;
  disabled: number;
  mustChangePassword: number;
  createdAt: string;
  lastLoginAt: string | null;
  activeSessions: number;
  pendingTour: boolean;
  demo: boolean;
}

export default function AdminUsersPage() {
  const { user: me, refresh } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'moderator' | 'admin'>('user');
  const [adminAccepted, setAdminAccepted] = useState(false);
  const [secret, setSecret] = useState<{ username: string; tempPassword: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState<AdminUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);
  const [permanent, setPermanent] = useState(false);
  const [renameUser, setRenameUser] = useState<AdminUser | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [revokeUser, setRevokeUser] = useState<AdminUser | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<AdminUser | null>(null);
  const [viewUser, setViewUser] = useState<AdminUser | null>(null);
  const [confirmRole, setConfirmRole] = useState<{ user: AdminUser; role: 'user' | 'moderator' } | null>(null);
  const [tourUser, setTourUser] = useState<AdminUser | null>(null);
  const [domain, setDomain] = useState('');

  const load = useCallback(async () => {
    try {
      setUsers(await api.admin.users());
    } catch {}
    try {
      const s = await api.admin.settings();
      setDomain(s.domain);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const createUser = async () => {
    const name = newUsername.trim();
    if (!name) return;
    try {
      const res = await api.admin.createUser(name, newRole);
      setCreateOpen(false);
      setNewUsername('');
      setNewRole('user');
      setAdminAccepted(false);
      setSecret({ username: res.user.username, tempPassword: res.tempPassword });
      await load();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const resetPassword = async (u: AdminUser) => {
    setConfirmReset(null);
    try {
      const res = await api.admin.resetPassword(u.id);
      setSecret({ username: u.username, tempPassword: res.tempPassword });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const confirmToggleDisabled = async () => {
    if (!confirmDisable) return;
    try {
      const disabling = !confirmDisable.disabled;
      await api.admin.updateUser(confirmDisable.id, { disabled: disabling });
      setConfirmDisable(null);
      await load();
      notifications.show({
        title: disabling ? 'Disabled' : 'Enabled',
        message: `${confirmDisable.username} has been ${disabling ? 'disabled' : 'enabled'}.`,
        color: disabling ? 'orange' : 'green',
      });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const deleteUser = async () => {
    if (!confirmDelete) return;
    try {
      await api.admin.deleteUser(confirmDelete.id, permanent);
      setConfirmDelete(null);
      setPermanent(false);
      await load();
      notifications.show({ title: 'Deleted', message: `${confirmDelete.username} ${permanent ? 'permanently deleted' : 'disabled'}`, color: 'green' });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const renameSubmit = async () => {
    if (!renameUser) return;
    try {
      await api.admin.updateUser(renameUser.id, { username: renameValue.trim() });
      setRenameUser(null);
      setRenameValue('');
      await load();
      notifications.show({ title: 'Renamed', message: 'Username updated.', color: 'green' });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const revokeSessions = async () => {
    if (!revokeUser) return;
    try {
      await api.admin.revokeSessions(revokeUser.id);
      setRevokeUser(null);
      await load();
      notifications.show({ title: 'Sessions revoked', message: `${revokeUser.username} has been signed out everywhere.`, color: 'green' });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const viewAsUser = async () => {
    if (!viewUser) return;
    try {
      await api.admin.impersonate(viewUser.id);
      setViewUser(null);
      await refresh();
      navigate('/dashboard');
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const retriggerTour = async () => {
    if (!tourUser) return;
    try {
      await api.admin.resetTour(tourUser.id);
      setTourUser(null);
      await load();
      notifications.show({ title: 'Tour reset', message: `The intro tour will show for ${tourUser.username} on their next sign-in.`, color: 'green' });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const confirmRoleChange = (u: AdminUser, role: 'user' | 'moderator') => {
    setConfirmRole({ user: u, role });
  };

  const submitRoleChange = async () => {
    if (!confirmRole) return;
    const { user: u, role } = confirmRole;
    setConfirmRole(null);
    try {
      await api.admin.updateUser(u.id, { role });
      await load();
      notifications.show({
        title: 'Role updated',
        message: `${u.username} is now ${role === 'moderator' ? 'a moderator' : 'a regular user'}.`,
        color: 'green',
      });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const loginUrl = (() => {
    const d = domain.trim();
    if (d) {
      const base = /^https?:\/\//i.test(d) ? d : `https://${d}`;
      return `${base.replace(/\/+$/, '')}/login`;
    }
    return `${window.location.origin}/login`;
  })();

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notifications.show({ title: 'Copied', message: `${label} copied to clipboard.`, color: 'green' });
    } catch {
      notifications.show({ title: 'Error', message: 'Could not copy to clipboard.', color: 'red' });
    }
  };

  const shareSecret = async () => {
    if (!secret) return;
    const text = `Username: ${secret.username}\nTemporary password: ${secret.tempPassword}\nSign in: ${loginUrl}`;
    await copy(text, 'Credentials');
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}>Users</Title>
          <Text c="dimmed" size="sm">Create and manage user accounts. Each user gets their own private collection.</Text>
        </div>
        <Button leftSection={<IconUserPlus size={16} />} onClick={() => setCreateOpen(true)}>Create user</Button>
      </Group>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Username</Table.Th>
            <Table.Th>Role</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Sessions</Table.Th>
            <Table.Th>Password</Table.Th>
            <Table.Th>Created</Table.Th>
            <Table.Th>Last login</Table.Th>
            <Table.Th ta="right">Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map(u => (
            <Table.Tr key={u.id} opacity={u.disabled ? 0.5 : 1}>
              <Table.Td fw={600}>
                {u.username}{u.id === me?.id ? ' (you)' : ''}
                {u.demo && <Badge size="xs" ml={6} color="orange" variant="light">Demo</Badge>}
                {!u.demo && u.id !== me?.id && (
                  <ActionIcon variant="subtle" size="xs" ml={4} color="gray" title="Rename user"
                    onClick={() => { setRenameValue(u.username); setRenameUser(u); }}>
                    <IconPencil size={13} />
                  </ActionIcon>
                )}
              </Table.Td>
              <Table.Td>
                <Group gap={4} wrap="nowrap">
                  <Badge size="sm" color={u.role === 'admin' ? 'grape' : u.role === 'moderator' ? 'cyan' : 'gray'} variant="light">
                    {u.role === 'admin' ? 'Admin' : u.role === 'moderator' ? 'Moderator' : 'User'}
                  </Badge>
                  {u.role === 'user' && u.id !== me?.id && (
                    <ActionIcon variant="subtle" size="xs" color="cyan" title="Make moderator" onClick={() => confirmRoleChange(u, 'moderator')}>
                      <IconShieldUp size={14} />
                    </ActionIcon>
                  )}
                  {u.role === 'moderator' && u.id !== me?.id && (
                    <ActionIcon variant="subtle" size="xs" color="gray" title="Demote to user" onClick={() => confirmRoleChange(u, 'user')}>
                      <IconShieldDown size={14} />
                    </ActionIcon>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>
                {u.disabled ? <Badge size="sm" color="red" variant="light">Disabled</Badge>
                  : u.mustChangePassword ? <Badge size="sm" color="yellow" variant="light">Needs password change</Badge>
                  : u.pendingTour ? <Badge size="sm" color="teal" variant="light">Pending intro tour</Badge>
                  : <Badge size="sm" color="green" variant="light">Active</Badge>}
              </Table.Td>
              <Table.Td>
                <Group gap={4} wrap="nowrap">
                  <Badge size="sm" variant="light" color={u.activeSessions > 0 ? 'blue' : 'gray'}>{u.activeSessions}</Badge>
                  {u.activeSessions > 0 && (
                    <ActionIcon variant="subtle" size="xs" color="red" title="Force sign out of all sessions"
                      onClick={() => setRevokeUser(u)}>
                      <IconLogout size={13} />
                    </ActionIcon>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>
                <ActionIcon variant="subtle" color="blue" title="Reset password" onClick={() => setConfirmReset(u)}>
                  <IconKey size={16} />
                </ActionIcon>
              </Table.Td>
              <Table.Td>{u.createdAt?.slice(0, 10)}</Table.Td>
              <Table.Td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}</Table.Td>
              <Table.Td>
                <Group gap={4} justify="flex-end" wrap="nowrap">
                  {(u.role === 'user' || u.role === 'moderator') && u.id !== me?.id && (
                    <ActionIcon variant="subtle" color="blue" title="View instance as this user"
                      onClick={() => setViewUser(u)}>
                      <IconEye size={16} />
                    </ActionIcon>
                  )}
                  {(u.role === 'user' || u.role === 'moderator') && (
                    <ActionIcon variant="subtle" color="teal" title="Re-trigger intro tour for this user"
                      onClick={() => setTourUser(u)}>
                      <IconSparkles size={16} />
                    </ActionIcon>
                  )}
                  <ActionIcon variant="subtle" color={u.disabled ? 'green' : 'orange'} title={u.disabled ? 'Enable' : 'Disable'}
                    onClick={() => setConfirmDisable(u)} disabled={u.id === me?.id}>
                    <IconPower size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="red" title={u.demo ? 'The demo user cannot be deleted (only disabled)' : 'Delete'}
                    onClick={() => setConfirmDelete(u)} disabled={u.id === me?.id || !!u.demo}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={createOpen} onClose={() => { setCreateOpen(false); setAdminAccepted(false); }} title="Create user" size="sm">
        <Stack gap="md">
          <TextInput label="Username" value={newUsername} onChange={e => setNewUsername(e.currentTarget.value)}
            placeholder="e.g. sarah" data-autofocus />
          <Text size="sm" fw={500}>Role</Text>
          <Group>
            <Button size="compact-sm" variant={newRole === 'user' ? 'filled' : 'light'} onClick={() => { setNewRole('user'); setAdminAccepted(false); }}>User</Button>
            <Button size="compact-sm" variant={newRole === 'moderator' ? 'filled' : 'light'} onClick={() => { setNewRole('moderator'); setAdminAccepted(false); }}>Moderator</Button>
            <Button size="compact-sm" variant={newRole === 'admin' ? 'filled' : 'light'} onClick={() => { setNewRole('admin'); setAdminAccepted(false); }}>Admin</Button>
          </Group>
          {newRole === 'admin' && (
            <>
              <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light">
                Admin users have <b>total power</b> over this instance. They can manage all users, view and delete other users'
                data, reset the instance, and change system settings.
              </Alert>
              <Checkbox
                label="I understand that admins have full control and can delete users, data, or reset the entire instance."
                checked={adminAccepted}
                onChange={e => setAdminAccepted(e.currentTarget.checked)}
              />
            </>
          )}
          <Button onClick={createUser} leftSection={<IconUserPlus size={16} />}
            disabled={newRole === 'admin' && !adminAccepted}>
            Create user
          </Button>
        </Stack>
      </Modal>

      <Modal opened={!!confirmReset} onClose={() => setConfirmReset(null)} title={`Reset password for ${confirmReset?.username ?? ''}`} size="sm">
        <Text size="sm" mb="md">
          A new temporary password will be generated and shown once. The user will be asked to set their own password on next login.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirmReset(null)}>Cancel</Button>
          <Button color="blue" onClick={() => confirmReset && resetPassword(confirmReset)}>Reset password</Button>
        </Group>
      </Modal>

      <Modal opened={!!renameUser} onClose={() => setRenameUser(null)} title={`Rename ${renameUser?.username ?? ''}`} size="sm">
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            The user's id and data stay the same — only the login name changes.
          </Text>
          <TextInput label="New username" value={renameValue} onChange={e => setRenameValue(e.currentTarget.value)}
            placeholder="3–32 characters (letters, numbers, . _ -)" data-autofocus />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRenameUser(null)}>Cancel</Button>
            <Button color="blue" onClick={renameSubmit} disabled={!renameValue.trim()}>Rename</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!revokeUser} onClose={() => setRevokeUser(null)} title={`Sign out ${revokeUser?.username ?? ''}?`} size="sm">
        <Text size="sm" mb="md">
          This signs the user out of all their active sessions. They'll need to log in again.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setRevokeUser(null)}>Cancel</Button>
          <Button color="red" onClick={revokeSessions}>Force sign out</Button>
        </Group>
      </Modal>

      <Modal opened={!!confirmDisable} onClose={() => setConfirmDisable(null)} size="sm"
        title={confirmDisable ? `${confirmDisable.disabled ? 'Enable' : 'Disable'} ${confirmDisable.demo ? 'demo user' : 'user'}` : ''}>
        {confirmDisable && (
          <Stack gap="md">
            {confirmDisable.demo ? (
              <Alert icon={<IconAlertTriangle size={16} />} color="orange" variant="light">
                This is the <b>shared demo account</b> used by the "Try the demo" button on the landing page.
                {confirmDisable.disabled
                  ? ' Enabling it lets visitors log in as demo again.'
                  : ' Disabling it will hide the demo login from visitors until you re-enable it in System Settings.'}
              </Alert>
            ) : (
              <Text size="sm">
                Are you sure you want to <b>{confirmDisable.disabled ? 'enable' : 'disable'}</b> the account for{' '}
                <b>{confirmDisable.username}</b>?
              </Text>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmDisable(null)}>Cancel</Button>
              <Button color={confirmDisable.disabled ? 'green' : 'orange'} onClick={confirmToggleDisabled}>
                {confirmDisable.disabled ? 'Enable' : 'Disable'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!confirmRole} onClose={() => setConfirmRole(null)} size="sm"
        title={confirmRole ? `${confirmRole.role === 'moderator' ? 'Promote to moderator' : 'Demote to user'}` : ''}>
        {confirmRole && (
          <Stack gap="md">
            {confirmRole.role === 'moderator' ? (
              <Alert icon={<IconShieldUp size={16} />} color="cyan" variant="light">
                Promote <b>{confirmRole.user.username}</b> to <b>moderator</b>? Moderators get a bell in the header
                showing how many pending user requests there are (and their types), but they <b>cannot</b> access the
                admin page or review the requests themselves. They keep their own collection.
              </Alert>
            ) : (
              <Alert icon={<IconShieldDown size={16} />} color="gray" variant="light">
                Demote <b>{confirmRole.user.username}</b> to a regular <b>user</b>? They'll lose the pending-requests
                bell and go back to a normal account. They keep their own collection.
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmRole(null)}>Cancel</Button>
              <Button color={confirmRole.role === 'moderator' ? 'cyan' : 'gray'} onClick={submitRoleChange}>
                {confirmRole.role === 'moderator' ? 'Promote' : 'Demote'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!viewUser} onClose={() => setViewUser(null)} title={`View as ${viewUser?.username ?? ''}`} size="sm">
        <Stack gap="md">
          <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light">
            You'll see this user's account exactly as they do. A red banner will stay visible until you exit. No
            password is required and their password state is not changed.
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setViewUser(null)}>Cancel</Button>
            <Button color="blue" leftSection={<IconEye size={16} />} onClick={viewAsUser}>View as user</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!tourUser} onClose={() => setTourUser(null)} title={`Re-trigger intro tour for ${tourUser?.username ?? ''}`} size="sm">
        <Stack gap="md">
          <Text size="sm">
            The intro tour will show the next time <b>{tourUser?.username}</b> signs in. Their status will be set to
            "pending intro tour".
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setTourUser(null)}>Cancel</Button>
            <Button color="teal" leftSection={<IconSparkles size={16} />} onClick={retriggerTour}>Re-trigger tour</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!confirmDelete} onClose={() => setConfirmDelete(null)} title={`Delete ${confirmDelete?.username ?? ''}`} size="sm">
        <Stack gap="md">
          <Text size="sm">Choose what to do with this account:</Text>
          <Group>
            <Button variant="light" color="orange" onClick={() => { setPermanent(false); deleteUser(); }}>
              Disable (keep data)
            </Button>
            <Button variant="light" color="red" onClick={() => { setPermanent(true); deleteUser(); }}>
              Permanently delete
            </Button>
          </Group>
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            Permanently deleting removes the user and their database file immediately. This cannot be undone.
          </Alert>
        </Stack>
      </Modal>

      <Modal opened={!!secret} onClose={() => setSecret(null)} title="Temporary password" size="sm">
        {secret && (
          <Stack gap="md">
            <Alert icon={<IconRefresh size={16} />} color="blue" variant="light">
              Share these credentials with <b>{secret.username}</b>. They are shown only once.
            </Alert>
            <Stack gap="xs">
              <Group justify="space-between" wrap="nowrap">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text size="xs" c="dimmed" fw={600}>Username</Text>
                  <Text fw={700} style={{ wordBreak: 'break-all' }}>{secret.username}</Text>
                </div>
                <ActionIcon variant="subtle" color="blue" title="Copy username" onClick={() => copy(secret.username, 'Username')}>
                  <IconCopy size={16} />
                </ActionIcon>
              </Group>
              <Group justify="space-between" wrap="nowrap">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text size="xs" c="dimmed" fw={600}>Temporary password</Text>
                  <Text fw={700} style={{ fontSize: 20, letterSpacing: '0.05em', wordBreak: 'break-all' }}>{secret.tempPassword}</Text>
                </div>
                <ActionIcon variant="subtle" color="blue" title="Copy password" onClick={() => copy(secret.tempPassword, 'Password')}>
                  <IconCopy size={16} />
                </ActionIcon>
              </Group>
              <Text size="xs" c="dimmed" mt={4}>
                Sign in link: <b>{loginUrl}</b>
              </Text>
            </Stack>
            <Group justify="space-between">
              <Button variant="default" onClick={() => setSecret(null)}>Done</Button>
              <Button color="blue" onClick={shareSecret} leftSection={<IconShare size={16} />}>
                Share credentials
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
