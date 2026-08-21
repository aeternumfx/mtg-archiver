import { useEffect, useRef, useState } from 'react';
import {
  Title, Paper, Group, Text, TextInput, Button, Avatar, SimpleGrid, Stack,
  Loader, Alert, Tooltip, Box, Modal, ActionIcon, Divider, Badge, SegmentedControl, PasswordInput, Code, Tabs,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconSearch, IconCheck, IconPencil, IconTrash, IconCopy, IconCoin, IconCreditCard, IconAlertTriangle, IconLock } from '@tabler/icons-react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { notifications } from '@mantine/notifications';
import type { GroupedCard } from '../types';

interface PickedArt {
  cardId: string;
  faceIdx: number | null;
  url: string;
  name: string;
}

function artFor(card: GroupedCard): { url: string; faceIdx: number | null } {
  if (card.imageUris?.art_crop) return { url: card.imageUris.art_crop, faceIdx: null };
  const faces = card.cardFaces ?? [];
  for (let i = 0; i < faces.length; i++) {
    const u = faces[i]?.image_uris;
    if (u?.art_crop) return { url: u.art_crop, faceIdx: i };
  }
  if (card.imageUris?.normal || card.imageUris?.large) {
    return { url: card.imageUris.normal || card.imageUris.large!, faceIdx: null };
  }
  for (let i = 0; i < faces.length; i++) {
    const u = faces[i]?.image_uris;
    if (u?.normal || u?.large) return { url: u.normal || u.large!, faceIdx: i };
  }
  return { url: '', faceIdx: null };
}

function PlanCard({ name, color, rawPrice, active, accent }: {
  name: string; color: string; rawPrice: string; active?: boolean; accent?: string;
}) {
  const price = rawPrice
    .trim()
    .replace(/^[$€£]/, '')
    .replace(/\s*\/\s*(mo|month)s?.*$/i, '')
    .replace(/\s*per\s*(mo|month)s?.*$/i, '')
    .trim();
  if (!price) return null;
  return (
    <Paper withBorder p="lg" radius="md"
      style={active && accent ? { borderColor: accent, borderWidth: 2 } : undefined}>
      <Group gap="sm" mb="sm" align="center">
        <Badge size="sm" color={color} variant="light">{name}</Badge>
        {active && <Badge size="xs" color={color} variant="filled">Current plan</Badge>}
      </Group>
      <Group align="baseline" gap={4} wrap="nowrap">
        <Text size="md" fw={700}>$</Text>
        <Text size="xl" fw={700} style={{ lineHeight: 1 }}>{price}</Text>
        <Text size="sm" c="dimmed">/month</Text>
      </Group>
    </Paper>
  );
}

function currentPlan(tier?: string): { card: 'basic' | 'pro'; accent: string } | null {
  if (!tier) return null;
  if (tier === 'basic') return { card: 'basic', accent: 'var(--mantine-color-blue-6)' };
  if (tier === 'trial') return { card: 'pro', accent: 'var(--mantine-color-yellow-6)' };
  if (tier === 'pro' || tier === 'complimentary') return { card: 'pro', accent: 'var(--mantine-color-violet-6)' };
  return null;
}

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const plan = currentPlan(user?.membershipTier);
  const [displayName, setDisplayName] = useState<string>(user?.displayName ?? '');
  const [dirtyName, setDirtyName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [pickerOpened, { open: openPicker, close: closePicker }] = useDisclosure(false);
  const [selection, setSelection] = useState<PickedArt | 'remove' | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<GroupedCard[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = user?.displayName || (user?.username ? `@${user.username}` : '');
  const showUsernameSubtitle = !!user?.displayName && user.displayName !== user.username;

  const previewUrl =
    selection === 'remove'
      ? null
      : selection && typeof selection === 'object'
        ? selection.url
        : user?.avatar || null;

  const runSearch = (q: string, p: number, append: boolean) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setTotalPages(0);
      setPage(1);
      setLoading(false);
      setSearched(false);
      return;
    }
    setLoading(true);
    api.cards.grouped(trimmed, p)
      .then(r => {
        setResults(prev => (append ? [...prev, ...r.data] : r.data));
        setTotalPages(r.totalPages);
        setPage(p);
        setSearched(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(search, 1, false), 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openPickerModal = () => {
    setSelection(null);
    setAvatarError(null);
    setSearch('');
    openPicker();
  };

  const saveName = async () => {
    setSavingName(true);
    setNameError(null);
    setSaved(false);
    try {
      const res = await api.auth.profile({ displayName });
      setUser(res.user);
      setDirtyName(false);
      setSaved(true);
    } catch (err: any) {
      setNameError(err.message || 'Failed to save display name');
    } finally {
      setSavingName(false);
    }
  };

  const saveAvatar = async () => {
    setSavingAvatar(true);
    setAvatarError(null);
    try {
      const avatarCardId = selection === 'remove'
        ? null
        : selection && typeof selection === 'object'
          ? selection.cardId
          : undefined;
      const avatarFace = selection && typeof selection === 'object' ? selection.faceIdx : undefined;
      const res = await api.auth.profile({ avatarCardId, avatarFace });
      setUser(res.user);
      closePicker();
    } catch (err: any) {
      setAvatarError(err.message || 'Failed to save profile picture');
    } finally {
      setSavingAvatar(false);
    }
  };

  const canSaveAvatar = selection === 'remove'
    ? !!user?.avatar
    : selection !== null;

  const [privacy, setPrivacy] = useState({ collectionPrivacy: 'private', wantlistPrivacy: 'private' });
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(true);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyMsg, setPrivacyMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [colPassword, setColPassword] = useState('');
  const [wantPassword, setWantPassword] = useState('');
  const [billingInfo, setBillingInfo] = useState<{ basicPrice: string; proPrice: string; accountName: string; accountHolder: string } | null>(null);

  useEffect(() => {
    api.data.billing()
      .then(s => setBillingInfo({ basicPrice: s.basicPrice, proPrice: s.proPrice, accountName: s.accountName, accountHolder: s.accountHolder }))
      .catch(() => {});
  }, []);


  useEffect(() => {
    api.privacy.get()
      .then(p => {
        setPrivacy({ collectionPrivacy: p.collectionPrivacy, wantlistPrivacy: p.wantlistPrivacy });
        setShareToken(p.shareToken);
      })
      .catch(() => setPrivacyMsg({ type: 'error', text: 'Failed to load privacy settings' }))
      .finally(() => setPrivacyLoading(false));
  }, []);

  const savePrivacy = async () => {
    setPrivacySaving(true);
    setPrivacyMsg(null);
    try {
      const data: Record<string, any> = { collectionPrivacy: privacy.collectionPrivacy, wantlistPrivacy: privacy.wantlistPrivacy };
      if (privacy.collectionPrivacy === 'password' && colPassword.trim()) data.collectionPassword = colPassword.trim();
      if (privacy.wantlistPrivacy === 'password' && wantPassword.trim()) data.wantlistPassword = wantPassword.trim();
      const res = await api.privacy.update(data);
      setPrivacy({ collectionPrivacy: res.collectionPrivacy, wantlistPrivacy: res.wantlistPrivacy });
      setShareToken(res.shareToken);
      setPrivacyMsg({ type: 'ok', text: 'Privacy settings saved.' });
      setColPassword('');
      setWantPassword('');
    } catch (err: any) {
      setPrivacyMsg({ type: 'error', text: err.message || 'Failed to save' });
    } finally {
      setPrivacySaving(false);
    }
  };

  const shareLink = shareToken ? `${window.location.origin}/share/${shareToken}` : '';
  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setPrivacyMsg({ type: 'ok', text: 'Share link copied to clipboard.' });
    } catch {
      setPrivacyMsg({ type: 'error', text: 'Could not copy. Select the link manually.' });
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notifications.show({ title: 'Copied', message: `${label} copied to clipboard`, color: 'green' });
    } catch {
      notifications.show({ title: 'Error', message: `Could not copy ${label.toLowerCase()}.`, color: 'red' });
    }
  };

  return (
    <Stack maw={860}>
    <Paper withBorder p="lg" radius="md">
      <Group align="flex-start" wrap="nowrap" gap="xl">
        <Box style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar radius="xl" size={120} color="blue" src={user?.avatar || undefined}>
            {user?.username?.[0]?.toUpperCase() ?? '?'}
          </Avatar>
          <Tooltip label="Change profile picture" position="bottom">
            <ActionIcon
              size={32}
              radius="xl"
              variant="filled"
              color="blue"
              aria-label="Change profile picture"
              style={{ position: 'absolute', bottom: -2, right: -2, border: '3px solid var(--mantine-color-body)' }}
              onClick={openPickerModal}
            >
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
        </Box>

        <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
          <Box>
            <Group gap={8} align="baseline" wrap="nowrap">
              <Title order={2} style={{ wordBreak: 'break-word' }}>{title}</Title>
              {user?.isDemo && <Badge size="sm" color="orange" variant="light">DEMO</Badge>}
            </Group>
            {showUsernameSubtitle && (
              <Text c="dimmed" size="sm">@{user?.username}</Text>
            )}
          </Box>

          <Divider />

          <Box>
            <Text size="xs" c="dimmed" fw={600} mb={6}>Display name</Text>
            <Group gap="sm" align="flex-end">
              <TextInput
                placeholder="What should people call you?"
                value={displayName}
                onChange={e => { setDisplayName(e.currentTarget.value); setDirtyName(true); setSaved(false); }}
                maxLength={60}
                style={{ flex: 1, minWidth: 220 }}
              />
              <Button onClick={saveName} loading={savingName} disabled={!dirtyName}>
                Save name
              </Button>
            </Group>
            <Text size="xs" c="dimmed" mt={2}>Shown as your main title and in the top bar.</Text>
          </Box>

          {nameError && <Alert color="red" title="Could not save">{nameError}</Alert>}
          {saved && (
            <Alert color="green" title="Display name updated">
              Your changes have been saved.
            </Alert>
          )}
        </Stack>
      </Group>

      <Modal opened={pickerOpened} onClose={closePicker} title="Choose a profile picture" size="lg" centered>
        <Stack gap="md">
          <Group gap="md" align="center" wrap="nowrap">
            <Avatar radius="xl" size={80} color="blue" src={previewUrl || undefined}>
              {user?.username?.[0]?.toUpperCase() ?? '?'}
            </Avatar>
            <Text size="sm" c="dimmed">
              Search the card catalog and pick the art to use as your avatar. A square crop of the art is used.
            </Text>
          </Group>

          {selection === 'remove' && (
            <Alert color="gray" title="Picture will be removed">
              Your current profile picture will be cleared.
            </Alert>
          )}

          <TextInput
            placeholder="Search cards… e.g. Lightning Bolt"
            value={search}
            onChange={e => setSearch(e.currentTarget.value)}
            leftSection={<IconSearch size={16} />}
          />

          {loading && results.length === 0 ? (
            <Group justify="center" py="xl"><Loader /></Group>
          ) : results.length === 0 ? (
            searched ? (
              <Text c="dimmed" size="sm" py="md">No cards found. Try a different search.</Text>
            ) : null
          ) : (
            <>
              <SimpleGrid cols={{ base: 4, xs: 5, sm: 7, md: 9 }} spacing="sm">
                {results.map(card => {
                  const art = artFor(card);
                  const selected = selection !== null && typeof selection === 'object'
                    && selection.cardId === card.id && selection.faceIdx === art.faceIdx;
                  if (!art.url) return null;
                  return (
                    <Tooltip key={`${card.id}-${art.faceIdx}`} label={card.name} position="top" withArrow>
                      <Box
                        onClick={() => setSelection({ cardId: card.id, faceIdx: art.faceIdx, url: art.url, name: card.name })}
                        style={{
                          aspectRatio: '1 / 1',
                          borderRadius: 6,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          position: 'relative',
                          border: selected ? '3px solid var(--mantine-color-blue-6)' : '3px solid transparent',
                        }}
                      >
                        <img src={art.url} alt={card.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        {selected && (
                          <Box style={{
                            position: 'absolute', inset: 0, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(0,0,0,0.35)',
                          }}>
                            <IconCheck size={28} color="#fff" />
                          </Box>
                        )}
                      </Box>
                    </Tooltip>
                  );
                })}
              </SimpleGrid>
              {page < totalPages && (
                <Group justify="center" mt="sm">
                  <Button variant="light" loading={loading} onClick={() => runSearch(search, page + 1, true)}>
                    Load more
                  </Button>
                </Group>
              )}
            </>
          )}

          {avatarError && <Alert color="red" title="Could not save">{avatarError}</Alert>}

          <Group justify="space-between" mt="sm">
            <Button
              variant="light"
              color="gray"
              leftSection={<IconTrash size={16} />}
              onClick={() => setSelection('remove')}
              disabled={!user?.avatar}
            >
              Remove picture
            </Button>
            <Group>
              <Button variant="default" onClick={closePicker}>Cancel</Button>
              <Button onClick={saveAvatar} loading={savingAvatar} disabled={!canSaveAvatar}>
                Save picture
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
    </Paper>

      <Tabs defaultValue={user?.role === 'admin' ? 'plan' : 'privacy'}>
        <Tabs.List>
          {user?.role !== 'admin' && (
            <Tabs.Tab value="privacy" leftSection={<IconLock size={14} />}>Sharing & Privacy</Tabs.Tab>
          )}
          <Tabs.Tab value="plan" leftSection={<IconCoin size={14} />}>Plan & Payments</Tabs.Tab>
        </Tabs.List>

        {user?.role !== 'admin' && (
          <Tabs.Panel value="privacy" pt="md">
            <Paper withBorder p="lg" radius="md">
              <Group justify="space-between" mb="md">
                <Title order={3}>Sharing & Privacy</Title>
                <Button size="compact-sm" onClick={savePrivacy} loading={privacySaving}>Save</Button>
              </Group>
          <Text size="sm" c="dimmed" mb="lg">
            Control how your Collection and Wantlist can be seen by friends. You can share a link, and optionally
            protect each view with a password. Shared views are read-only.
          </Text>

          {privacyMsg && (
            <Alert color={privacyMsg.type === 'ok' ? 'green' : 'red'} mb="md" withCloseButton onClose={() => setPrivacyMsg(null)}>
              {privacyMsg.text}
            </Alert>
          )}

          {privacyLoading ? (
            <Group justify="center" py="lg"><Loader size="sm" /></Group>
          ) : (
            <>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" mb="xl">
                <Box>
                  <Text size="sm" fw={600} mb={6}>Collection</Text>
                  <SegmentedControl fullWidth mb="sm"
                    value={privacy.collectionPrivacy}
                    onChange={v => setPrivacy(p => ({ ...p, collectionPrivacy: v }))}
                    data={[
                      { value: 'public', label: 'Public' },
                      { value: 'password', label: 'Password' },
                      { value: 'private', label: 'Private' },
                    ]} />
                  {privacy.collectionPrivacy === 'password' && (
                    <PasswordInput placeholder="Set a password for your collection" value={colPassword}
                      onChange={e => setColPassword(e.currentTarget.value)} size="sm" />
                  )}
                </Box>
                <Box>
                  <Text size="sm" fw={600} mb={6}>Wantlist</Text>
                  <SegmentedControl fullWidth mb="sm"
                    value={privacy.wantlistPrivacy}
                    onChange={v => setPrivacy(p => ({ ...p, wantlistPrivacy: v }))}
                    data={[
                      { value: 'public', label: 'Public' },
                      { value: 'password', label: 'Password' },
                      { value: 'private', label: 'Private' },
                    ]} />
                  {privacy.wantlistPrivacy === 'password' && (
                    <PasswordInput placeholder="Set a password for your wantlist" value={wantPassword}
                      onChange={e => setWantPassword(e.currentTarget.value)} size="sm" />
                  )}
                </Box>
              </SimpleGrid>

              <Divider mb="lg" />

              <Text size="sm" fw={600} mb={4}>Your share link</Text>
              <Text size="xs" c="dimmed" mb="sm">
                Share this link with friends. It reveals only what you've made public.
              </Text>
              {shareLink ? (
                <Group gap="sm" align="center" wrap="nowrap">
                  <Code style={{ flex: 1, wordBreak: 'break-all' }}>{shareLink}</Code>
                  <Button variant="light" size="compact-sm" leftSection={<IconCopy size={14} />} onClick={copyShare}>Copy</Button>
                </Group>
              ) : (
                <Text size="xs" c="dimmed">Set Collection or Wantlist to Public or Password to generate a share link.</Text>
              )}
            </>
          )}
        </Paper>
        </Tabs.Panel>
      )}

      <Tabs.Panel value="plan" pt="md">
        <Paper withBorder p="lg" radius="md">
          <Group mb="md">
            <IconCoin size={20} />
            <Title order={3}>Plan & Payments</Title>
          </Group>
        <Text size="sm" c="dimmed" mb="lg">
          Your membership makes supporting this instance possible. Use your payment reference when sending a payment
          so it can be matched to your account.
        </Text>

        {billingInfo && (billingInfo.basicPrice || billingInfo.proPrice) && (
          <>
            <Divider mb="lg" />
            <Text size="sm" fw={600} mb="sm">Plans</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <PlanCard name="Basic" color="blue" rawPrice={billingInfo.basicPrice}
                active={plan?.card === 'basic'} accent={plan?.card === 'basic' ? plan.accent : undefined} />
              <PlanCard name="Pro" color="violet" rawPrice={billingInfo.proPrice}
                active={plan?.card === 'pro'} accent={plan?.card === 'pro' ? plan.accent : undefined} />
            </SimpleGrid>
            {user?.membershipTier === 'trial' && (
              <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light" mt="md">
                <Text size="sm" fw={600}>You're on the trial of the Pro version.</Text>
                <Text size="xs" c="dimmed">
                  You currently have full access to all Pro features while your trial is active.
                </Text>
              </Alert>
            )}
          </>
        )}

        <Divider my="lg" />

        <Group gap="sm" mb="xs">
          <IconCreditCard size={18} />
          <Text size="sm" fw={600}>How to pay</Text>
        </Group>
        <Text size="xs" c="dimmed" mb="md">
          Your reference is mandatory and appears on every payment you send.
        </Text>

        {user?.paymentRef ? (
          <Paper withBorder p="md" radius="md" style={{ background: 'transparent' }}>
            <Stack gap="sm">
              <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light" p="sm" mb="xs">
                <Text size="sm" fw={600}>Your payment reference is mandatory.</Text>
                <Text size="xs" c="dimmed">
                  Include it in the payment note/reference when you pay. Payments without it can't be matched to your
                  account.
                </Text>
              </Alert>

              <Group gap="sm" align="center" wrap="nowrap">
                <Text size="xs" c="dimmed" fw={600} w={140}>Your reference</Text>
                <Code style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.15em' }}>{user.paymentRef}</Code>
                <Button variant="light" size="compact-sm" leftSection={<IconCopy size={14} />}
                  onClick={() => copy(user.paymentRef ?? '', 'Payment reference')}>
                  Copy
                </Button>
              </Group>

              {billingInfo?.accountName && (
                <Group gap="sm" align="center" wrap="nowrap">
                  <Text size="xs" c="dimmed" w={140}>Account number</Text>
                  <Code style={{ flex: 1 }}>{billingInfo.accountName}</Code>
                  <Button variant="light" size="compact-sm" leftSection={<IconCopy size={14} />}
                    onClick={() => copy(billingInfo.accountName, 'Account number')}>
                    Copy
                  </Button>
                </Group>
              )}
              {billingInfo?.accountHolder && (
                <Group gap="sm" align="center" wrap="nowrap">
                  <Text size="xs" c="dimmed" w={140}>Account holder</Text>
                  <Text size="sm" fw={500} style={{ flex: 1 }}>{billingInfo.accountHolder}</Text>
                  <Button variant="light" size="compact-sm" leftSection={<IconCopy size={14} />}
                    onClick={() => copy(billingInfo.accountHolder, 'Account holder')}>
                    Copy
                  </Button>
                </Group>
              )}
            </Stack>
          </Paper>
        ) : (
          <Text size="sm" c="dimmed">A payment reference will be assigned to your account.</Text>
        )}
      </Paper>
      </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}