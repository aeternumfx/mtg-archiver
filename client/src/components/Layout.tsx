import { useState, useEffect } from 'react';
import {
  AppShell, Burger, Group, Title, NavLink, Text, Tooltip, Modal, Badge, Button, ActionIcon, Menu, Avatar, Stack,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconHome, IconCards, IconPlus, IconPackages, IconArchive, IconSettings, IconRefresh, IconGift, IconStack, IconHeart, IconArrowsLeftRight, IconSortDescending, IconCurrencyDollar, IconShieldLock, IconLogout, IconUser, IconChartBar, IconUsers, IconAdjustments, IconMessageCircle, IconEye, IconInfoCircle, IconRocket, IconCoin, IconClock } from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router-dom';
import SyncBanner from './SyncBanner';
import SetupGuide from './SetupGuide';
import AdminSetupWizard from './AdminSetupWizard';
import AdminUpdateBanner from './AdminUpdateBanner';
import ModeratorBell from './ModeratorBell';
import { RequestModal } from './RequestModal';
import { authFetch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { SyncStatus } from '../types';

const navItems: Array<{ label: string; path: string; icon: any; badge?: string; tour: string }> = [
  { label: 'Profile', path: '/profile', icon: IconUser, tour: 'nav-profile' },
  { label: 'Dashboard', path: '/dashboard', icon: IconHome, tour: 'nav-dashboard' },
  { label: 'Organize', path: '/organize', icon: IconSortDescending, tour: 'nav-organize' },
  { label: 'Add Cards', path: '/add', icon: IconPlus, tour: 'nav-add' },
  { label: 'Locations', path: '/locations', icon: IconPackages, tour: 'nav-locations' },
  { label: 'Collection', path: '/collection', icon: IconArchive, tour: 'nav-collection' },
  { label: 'Decks', path: '/decks', icon: IconStack, tour: 'nav-decks' },
  { label: 'Trades', path: '/trades', icon: IconArrowsLeftRight, badge: 'Beta', tour: 'nav-trades' },
  { label: 'Boosters', path: '/booster', icon: IconGift, badge: 'Beta', tour: 'nav-booster' },
  { label: 'Wantlist', path: '/wantlist', icon: IconHeart, tour: 'nav-wantlist' },
];

const adminNavItems: Array<{ label: string; path: string; icon: any; badge?: string; tour: string }> = [
  { label: 'Admin Dashboard', path: '/admin', icon: IconChartBar, tour: 'admin-dashboard' },
  { label: 'Users', path: '/admin/users', icon: IconUsers, tour: 'admin-users' },
  { label: 'Billing', path: '/admin/billing', icon: IconCoin, tour: 'admin-billing' },
  { label: 'User Requests', path: '/admin/requests', icon: IconMessageCircle, tour: 'admin-requests' },
  { label: 'System Settings', path: '/admin/settings', icon: IconAdjustments, tour: 'admin-settings' },
  { label: 'Updates & Backup', path: '/admin/updates', icon: IconRocket, tour: 'admin-updates' },
];

const PLAN_META: Record<string, { label: string; color: string; tooltip: string }> = {
  trial: {
    label: 'Trial',
    color: 'yellow',
    tooltip: 'You are on the free trial plan with full access to all features. Contact an admin to purchase a plan to continue using the service after the trial ends.',
  },
  complimentary: {
    label: 'Complimentary',
    color: 'gray',
    tooltip: 'You are on the complimentary plan with full access to all features!',
  },
  basic: {
    label: 'Basic',
    color: 'blue',
    tooltip: 'You are on the basic plan. Upgrade to a PRO plan for full access to all features!',
  },
  pro: {
    label: 'Pro',
    color: 'violet',
    tooltip: 'You are on the pro plan with full access to all features!',
  },
};

function PlanBadge({ tier }: { tier?: string }) {
  const meta = PLAN_META[tier ?? ''] ?? PLAN_META.complimentary;
  return (
    <Tooltip label={meta.tooltip} multiline w={280} withArrow zIndex={300}>
      <Badge size="sm" variant="filled" color={meta.color} radius="sm" tt="uppercase" style={{ fontWeight: 700, cursor: 'default' }}>
        {meta.label}
      </Badge>
    </Tooltip>
  );
}

function TrialCountdown({ paidUntil }: { paidUntil?: string | null }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!paidUntil) return;
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, [paidUntil]);

  if (!paidUntil) return null;
  const end = new Date(paidUntil + 'T23:59:59');
  const endTime = end.getTime();
  if (Number.isNaN(endTime)) return null;
  const diff = endTime - now;
  if (diff <= 0) {
    return (
      <Tooltip label="Your trial has ended. Contact an admin to continue using the service." withArrow>
        <Badge size="sm" variant="filled" color="red" radius="sm" tt="uppercase" style={{ fontWeight: 700, cursor: 'default' }}>Trial ended</Badge>
      </Tooltip>
    );
  }
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const text = days > 0 ? `${days}d ${hours}h left` : hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
  const soon = diff < 5 * 86400000;
  if (soon) {
    return (
      <Tooltip label="Upgrade for full access before your trial ends." withArrow>
        <Badge
          size="sm"
          variant="light"
          color="red"
          radius="sm"
          style={{
            fontWeight: 700,
            cursor: 'default',
            border: '1.5px solid var(--mantine-color-red-6)',
            color: 'var(--mantine-color-red-6)',
          }}
        >
          <IconClock size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
          {text} · Your trial will end soon! Upgrade for full access!
        </Badge>
      </Tooltip>
    );
  }
  return (
    <Tooltip label="Days left on your trial" withArrow>
      <Badge size="sm" variant="light" color="teal" radius="sm" style={{ fontWeight: 700, cursor: 'default' }}>
        <IconClock size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
        {text}
      </Badge>
    </Tooltip>
  );
}

// Shown to an account whose paid period has ended but is still within the
// configured arrears grace period. Warns them to pay before access is lost.
function ArrearsBadge({ paidUntil, arrearsDays }: { paidUntil?: string | null; arrearsDays?: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!paidUntil) return;
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, [paidUntil]);

  if (!paidUntil) return null;
  const end = new Date(paidUntil + 'T23:59:59');
  const endTime = end.getTime();
  if (Number.isNaN(endTime)) return null;
  const graceMs = (arrearsDays ?? 0) * 86400000;
  const lastDay = endTime + graceMs;
  if (now <= endTime) return null; // not in arrears yet
  if (now > lastDay) return null; // arrears fully expired (account handled separately)

  const diff = lastDay - now;
  const days = Math.ceil(diff / 86400000);
  const lastDate = new Date(lastDay).toLocaleDateString();
  const text = days > 0 ? `${days} day${days > 1 ? 's' : ''} left` : 'less than a day left';
  return (
    <Tooltip
      label={`Your account is in arrears. Pay to continue using the service, otherwise you'll lose access on ${lastDate}.`}
      multiline w={280} withArrow
    >
      <Badge
        size="sm"
        variant="filled"
        color="orange"
        radius="sm"
        style={{
          fontWeight: 700,
          cursor: 'default',
          border: '1.5px solid var(--mantine-color-orange-8)',
        }}
      >
        <IconClock size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
        In arrears · {text}
      </Badge>
    </Tooltip>
  );
}

function syncAge(lastSync: string | null): { label: string; color: string; hours: number | null } {
  if (!lastSync) return { label: 'Never synced', color: 'red', hours: null };
  const hours = (Date.now() - new Date(lastSync).getTime()) / 3600000;
  if (hours < 24) return { label: `${Math.round(hours)}h ago`, color: 'green', hours };
  if (hours < 48) return { label: `${Math.floor(hours / 24)}d ago`, color: 'yellow', hours };
  return { label: `${Math.floor(hours / 24)}d ago`, color: 'red', hours };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [opened, { toggle }] = useDisclosure();
  const [currencyOpened, { open: openCurrency, close: closeCurrency }] = useDisclosure(false);
  const [requestOpened, { open: openRequest, close: closeRequest }] = useDisclosure(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, exitImpersonation } = useAuth();
  const isAdmin = user?.role === 'admin';
  const items = isAdmin ? adminNavItems : navItems;
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ syncing: false, lastSync: null, progress: null, stage: null });

  useEffect(() => {
    let mounted = true;
    let timeout: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await authFetch('/api/sync-status');
        if (!res.ok) { if (mounted) timeout = setTimeout(poll, 10000); return; }
        const s = await res.json();
        if (!mounted) return;
        setSyncStatus(s);
        timeout = setTimeout(poll, s.syncing ? 3000 : 30000);
      } catch {
        if (mounted) timeout = setTimeout(poll, 10000);
      }
    };

    poll();
    return () => { mounted = false; clearTimeout(timeout); };
  }, []);

  const age = syncAge(syncStatus.lastSync);
  const ago = syncStatus.lastSync ? new Date(syncStatus.lastSync).toLocaleString() : 'never';

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header style={{ backdropFilter: 'blur(12px)', background: 'color-mix(in srgb, var(--mantine-color-body) 75%, transparent)' }}>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <IconCards size={26} />
            <Title order={3}>MTG Archiver</Title>
            {import.meta.env.DEV && (
              <Badge size="sm" variant="filled" color="lime" radius="sm" tt="uppercase" style={{ fontWeight: 700 }}>
                DEV
              </Badge>
            )}
            {!user?.isDemo && user?.membershipTier && <PlanBadge tier={user.membershipTier} />}
          </Group>
          <Group gap="xs">
            {!user?.isDemo && user?.membershipTier === 'trial' && (
              <TrialCountdown paidUntil={user?.paidUntil} />
            )}
            {!user?.isDemo && user?.paidUntil && (
              <ArrearsBadge paidUntil={user?.paidUntil} arrearsDays={user?.arrearsDays} />
            )}
            <Tooltip label={`Card data last synced: ${ago}`}>
              <Group gap={4} style={{ cursor: 'default' }}>
                <IconRefresh size={14} style={{ opacity: 0.5 }} />
                <Badge
                  size="sm"
                  variant="light"
                  color={age.color}
                  styles={{ root: { textTransform: 'none' } }}
                >
                  {syncStatus.syncing ? 'Syncing...' : age.label}
                </Badge>
              </Group>
            </Tooltip>
            {user?.role === 'moderator' && <ModeratorBell />}
            <Tooltip label="Submit a request to the admin">
              <ActionIcon variant="subtle" size="sm" onClick={openRequest} data-tour="request-button">
                <IconMessageCircle size={18} />
              </ActionIcon>
            </Tooltip>
            {!isAdmin && (
              <Tooltip label="Prices shown in USD">
                <Badge size="sm" variant="light" color="gray" leftSection={<IconCurrencyDollar size={12} />}
                  style={{ cursor: 'pointer' }} onClick={openCurrency}>
                  USD
                </Badge>
              </Tooltip>
            )}
            {!isAdmin && (
              <ActionIcon variant="subtle" size="sm" onClick={() => navigate('/settings')} data-tour="settings-button">
                <IconSettings size={18} />
              </ActionIcon>
            )}
            <Menu shadow="md" width={220} position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="light" radius="xl" size="md" style={{ cursor: 'pointer' }}>
                  <Avatar radius="xl" size={26} color="blue" src={user?.avatar || undefined}>
                    {user?.username?.[0]?.toUpperCase() ?? '?'}
                  </Avatar>
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Group gap={6} wrap="nowrap">
                      <IconUser size={14} />
                      <Text fw={600} size="sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {user?.displayName || (user?.username ? `@${user.username}` : '')}
                      </Text>
                      {isAdmin && <Badge size="xs" color="grape" variant="light">Admin</Badge>}
                    </Group>
                    {user?.displayName && user?.username && user.displayName !== user.username && (
                      <Text size="xs" c="dimmed" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        @{user.username}
                      </Text>
                    )}
                  </Stack>
                </Menu.Label>
                <Menu.Item leftSection={<IconUser size={16} />} onClick={() => navigate('/profile')}>
                  Profile
                </Menu.Item>
                {isAdmin && (
                  <Menu.Item leftSection={<IconShieldLock size={16} />} onClick={() => navigate('/admin')}>
                    Admin
                  </Menu.Item>
                )}
                <Menu.Item leftSection={<IconLogout size={16} />} color="red" onClick={logout}>
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs" style={{ backdropFilter: 'blur(12px)' }}>
        <Group gap="xs" px="xs" pb="sm" mb="xs">
          <Text size="lg" fw={700} style={{ letterSpacing: '-0.02em' }}>Menu</Text>
        </Group>
        {items.map(item => (
          <NavLink
            key={item.path}
            label={item.label}
            leftSection={<item.icon size={20} />}
            rightSection={item.badge ? <Badge size="xs" color="yellow" variant="light">{item.badge}</Badge> : undefined}
            active={location.pathname === item.path}
            onClick={() => { navigate(item.path); toggle(); }}
            variant="light"
            mb={4}
            data-tour={item.tour}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        {isAdmin && <AdminUpdateBanner />}
        {user?.isDemo && (
          <Group px="md" py={10} mb="md" justify="center" wrap="wrap" gap={8}
            style={{ background: 'var(--mantine-color-orange-6)', borderRadius: 8, textAlign: 'center' }}>
            <IconInfoCircle size={20} color="#fff" style={{ flexShrink: 0 }} />
            <Text size="md" fw={700} c="white">
              DEMO USER — you're browsing the shared demo account. Anything you add or change is visible to everyone.
            </Text>
          </Group>
        )}
        {user?.impersonating && (
          <Group pos="sticky" top={0} px="md" py={6} mb="sm" justify="space-between" wrap="nowrap"
            style={{ background: 'var(--mantine-color-red-9)', borderRadius: 8, zIndex: 100 }}>
            <Group gap={6} wrap="nowrap">
              <IconEye size={16} color="#fff" />
              <Text size="sm" fw={600} c="white">
                Viewing as <b>@{user.username}</b> — admin preview. Changes are made to this user's account.
              </Text>
            </Group>
            <Button size="compact-xs" variant="white" color="red" onClick={exitImpersonation}>Exit preview</Button>
          </Group>
        )}
        <SyncBanner syncStatus={syncStatus} />
        <div key={location.pathname} className="page-enter">
          {children}
        </div>
      </AppShell.Main>

      <Modal opened={currencyOpened} onClose={closeCurrency} title="Currency" size="sm">
        <Text size="sm" mb="md">
          All prices shown in this app are in <b>USD</b>.
        </Text>
        <Text size="sm" mb="md" c="dimmed">
          Support for more currencies is planned to be added later.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={closeCurrency}>Close</Button>
        </Group>
      </Modal>

      {!isAdmin && !user?.impersonating && <SetupGuide />}
      {isAdmin && <AdminSetupWizard />}

      <RequestModal opened={requestOpened} onClose={closeRequest} />
    </AppShell>
  );
}
