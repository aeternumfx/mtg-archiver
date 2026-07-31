import { useState, useEffect, useCallback } from 'react';
import {
  AppShell, Burger, Group, Title, NavLink, Text, Tooltip, Modal, Badge, Button, ActionIcon,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconHome, IconCards, IconPlus, IconPackages, IconArchive, IconSettings, IconRefresh, IconGift, IconStack, IconHeart, IconArrowsLeftRight, IconSortDescending } from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router-dom';
import SyncBanner from './SyncBanner';
import type { SyncStatus } from '../types';

const navItems: Array<{ label: string; path: string; icon: any; badge?: string }> = [
  { label: 'Dashboard', path: '/', icon: IconHome },
  { label: 'Organize', path: '/organize', icon: IconSortDescending },
  { label: 'Add Cards', path: '/add', icon: IconPlus },
  { label: 'Locations', path: '/locations', icon: IconPackages },
  { label: 'Collection', path: '/collection', icon: IconArchive },
  { label: 'Decks', path: '/decks', icon: IconStack },
  { label: 'Trades', path: '/trades', icon: IconArrowsLeftRight, badge: 'Beta' },
  { label: 'Boosters', path: '/booster', icon: IconGift, badge: 'Beta' },
  { label: 'Wantlist', path: '/wantlist', icon: IconHeart },
];

function syncAge(lastSync: string | null): { label: string; color: string; hours: number | null } {
  if (!lastSync) return { label: 'Never synced', color: 'red', hours: null };
  const hours = (Date.now() - new Date(lastSync).getTime()) / 3600000;
  if (hours < 24) return { label: `${Math.round(hours)}h ago`, color: 'green', hours };
  if (hours < 48) return { label: `${Math.floor(hours / 24)}d ago`, color: 'yellow', hours };
  return { label: `${Math.floor(hours / 24)}d ago`, color: 'red', hours };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [opened, { toggle }] = useDisclosure();
  const [syncOpened, { open: openSync, close: closeSync }] = useDisclosure(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ syncing: false, lastSync: null, progress: null, stage: null });

  useEffect(() => {
    let mounted = true;
    let timeout: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const s = await (await fetch('/api/sync-status')).json();
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

  const handleResync = useCallback(async () => {
    closeSync();
    setSyncStatus(prev => ({ ...prev, syncing: true, progress: 0, stage: 'Starting sync...' }));
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        setSyncStatus(prev => ({ ...prev, syncing: false, progress: null, stage: null }));
        throw new Error(err.error);
      }
    } catch (err: any) {
      setSyncStatus(prev => ({ ...prev, syncing: false, progress: null, stage: null }));
    }
  }, [closeSync]);

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
          </Group>
          <Group gap="xs">
            <Tooltip label={`Last sync: ${ago}. Click to resync.`}>
              <Group gap={4} style={{ cursor: 'pointer' }} onClick={!syncStatus.syncing ? openSync : undefined}>
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
            <ActionIcon variant="subtle" size="sm" onClick={() => navigate('/settings')}>
              <IconSettings size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs" style={{ backdropFilter: 'blur(12px)' }}>
        <Group gap="xs" px="xs" pb="sm" mb="xs">
          <Text size="lg" fw={700} style={{ letterSpacing: '-0.02em' }}>Menu</Text>
        </Group>
        {navItems.map(item => (
          <NavLink
            key={item.path}
            label={item.label}
            leftSection={<item.icon size={20} />}
            rightSection={item.badge ? <Badge size="xs" color="yellow" variant="light">{item.badge}</Badge> : undefined}
            active={location.pathname === item.path}
            onClick={() => { navigate(item.path); toggle(); }}
            variant="light"
            mb={4}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <div key={location.pathname} className="page-enter">
          <SyncBanner syncStatus={syncStatus} />
          {children}
        </div>
      </AppShell.Main>

      <Modal opened={syncOpened} onClose={closeSync} title="Resync from Scryfall" size="sm">
        <Text size="sm" mb="md">
          Last sync was <b>{ago}</b>.
        </Text>
        <Text size="sm" mb="md" c="dimmed">
          We don't recommend syncing more than once per day. The Scryfall bulk data file
          is 532MB and frequent downloads may trigger rate limiting.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={closeSync}>Cancel</Button>
          <Button color="blue" onClick={handleResync}>Sync Now</Button>
        </Group>
      </Modal>
    </AppShell>
  );
}


