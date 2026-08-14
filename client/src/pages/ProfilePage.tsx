import { useEffect, useRef, useState } from 'react';
import {
  Title, Paper, Group, Text, TextInput, Button, Avatar, SimpleGrid, Stack,
  Loader, Alert, Tooltip, Box, Modal, ActionIcon, Divider, Badge,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconSearch, IconCheck, IconPencil, IconTrash } from '@tabler/icons-react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
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

export default function ProfilePage() {
  const { user, setUser } = useAuth();
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

  return (
    <Paper withBorder p="lg" radius="md" maw={860}>
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
  );
}
