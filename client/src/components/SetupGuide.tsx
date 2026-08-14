import { useState, useEffect } from 'react';
import { Modal, Group, Text, Button, Card, Stack, Badge, Box, SimpleGrid } from '@mantine/core';
import {
  IconTarget, IconList, IconPackage, IconStack,
  IconDashboard, IconSettings, IconArrowRight, IconArrowLeft, IconPlus, IconCheck,
  IconHeart, IconGift, IconArrowsLeftRight, IconSortDescending, IconMessageCircle, IconUser,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface TourStep {
  title: string;
  icon: any;
  desc: string;
  path?: string;
  target?: string;
}

const TOUR_STEPS: TourStep[] = [
  { title: 'Profile', icon: IconUser, path: '/profile', target: '[data-tour="nav-profile"]', desc: 'Set a display name and pick a profile picture from any MTG card art. Your avatar shows up in the top-right of every page.' },
  { title: 'Dashboard', icon: IconDashboard, path: '/dashboard', target: '[data-tour="nav-dashboard"]', desc: 'A quick overview of your collection — total cards, market value, breakdowns by rarity, condition and location, your most valuable cards, and recent additions.' },
  { title: 'Organize', icon: IconSortDescending, path: '/organize', target: '[data-tour="nav-organize"]', desc: 'Schedule and resolve moves between locations, with a full history that tracks every action — including undos.' },
  { title: 'Add Cards', icon: IconPlus, path: '/add', target: '[data-tour="nav-add"]', desc: 'Search the entire Scryfall database — by name, by set + collector number (e.g. "blb023"), or with scryfall syntax. Add cards to any location or fulfil a wantlist entry.' },
  { title: 'Locations', icon: IconPackage, path: '/locations', target: '[data-tour="nav-locations"]', desc: 'Organize cards into binders, boxes and decks, and create collection goals — like "collect a whole set" — with live progress and cost-to-complete.' },
  { title: 'Collection', icon: IconList, path: '/collection', target: '[data-tour="nav-collection"]', desc: 'Browse your cards grouped by name into subcards. Add, edit, move, schedule, and select multiple (shift-click for ranges). Ghost rows show cards you still want here.' },
  { title: 'Decks', icon: IconStack, path: '/decks', target: '[data-tour="nav-decks"]', desc: 'Build decks with commander / partner / background support, a legality checker, bracket estimate, and ghost cards for what you still need.' },
  { title: 'Trades', icon: IconArrowsLeftRight, path: '/trades', target: '[data-tour="nav-trades"]', desc: 'Log trades with card values and cash on both sides, and track the difference.' },
  { title: 'Boosters', icon: IconGift, path: '/booster', target: '[data-tour="nav-booster"]', desc: 'Open boosters to compare value against cost, and add the pulls straight to your collection.' },
  { title: 'Wantlist', icon: IconHeart, path: '/wantlist', target: '[data-tour="nav-wantlist"]', desc: 'Track the cards you want — a specific printing or a generic entry — and fulfil them from a new card or a copy you already own.' },
  { title: 'Submit a request', icon: IconMessageCircle, target: '[data-tour="request-button"]', desc: 'Need help or have an idea? Click the message icon in the top-right header to submit a request to the admin. You can flag it as urgent.' },
  { title: 'Settings & re-trigger', icon: IconSettings, path: '/settings', target: '[data-tour="settings-button"]', desc: 'Settings lets you change themes, back up or restore your data, and reset. You can re-trigger this tour any time from Settings → "Replay intro tour".' },
];

interface SetupChoice {
  mode: string;
  icon: any;
  title: string;
  desc: string;
  items: string[];
}

const CHOICES: SetupChoice[] = [
  {
    mode: 'recommended',
    icon: IconTarget,
    title: 'Recommended',
    desc: 'A clean workspace, ready for you to add your cards.',
    items: ['Inbox', 'Binders & Bulk groups', 'A bulk box to fill'],
  },
  {
    mode: 'blank',
    icon: IconPlus,
    title: 'Blank slate',
    desc: 'Start from nothing and build it yourself.',
    items: ['Just the Inbox', 'Everything else your choice'],
  },
];

export default function SetupGuide() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState(false);
  const [spot, setSpot] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!user || user.role === 'admin' || user.impersonating) return;
    if (user.mustChangePassword) return; // wait until the user has set their own password
    let cancelled = false;
    api.setup.get().then(s => {
      if (cancelled) return;
      if (!s.done) {
        setSkipped(false);
        setMode(s.mode);
        setStep(s.mode ? 1 : 0);
        setOpen(true);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    const onShow = () => {
      setSkipped(false);
      setMode(null);
      setStep(1);
      setOpen(true);
      navigate('/dashboard');
    };
    const onResetSetup = () => {
      setSkipped(false);
      setMode(null);
      setStep(0);
      setOpen(true);
      navigate('/dashboard');
    };
    window.addEventListener('mtg:show-setup', onShow);
    window.addEventListener('mtg:show-initial-setup', onResetSetup);
    return () => {
      window.removeEventListener('mtg:show-setup', onShow);
      window.removeEventListener('mtg:show-initial-setup', onResetSetup);
    };
  }, [navigate]);

  const goToStep = (n: number) => {
    setStep(n);
    const s = TOUR_STEPS[n - 1];
    if (s?.path) navigate(s.path);
  };

  const choose = async (m: string) => {
    setMode(m);
    await api.setup.configure({ mode: m, done: false }).catch(() => {});
    goToStep(1);
  };

  const finish = async () => {
    await api.setup.configure({ done: true }).catch(() => {});
    setOpen(false);
    navigate('/dashboard', { replace: true });
  };

  const next = () => {
    if (step < TOUR_STEPS.length) {
      goToStep(step + 1);
    } else {
      finish();
    }
  };

  const skip = () => {
    setSkipped(true);
  };

  const goBack = () => {
    if (step > 1) goToStep(step - 1);
  };

  useEffect(() => {
    const s = TOUR_STEPS[step - 1];
    if (!open || !s?.target) {
      setSpot(null);
      return;
    }
    const selector = s.target;
    const measure = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setSpot({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const reveal = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      requestAnimationFrame(measure);
    };
    let attempts = 0;
    const poll = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) reveal();
      else if (attempts < 15) {
        attempts += 1;
        setTimeout(poll, 100);
      } else {
        setSpot(null);
      }
    };
    poll();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step, open]);

  if (!open) return null;

  return (
    <>
      {spot && (
        <Box style={{
          position: 'fixed',
          top: spot.top - 4,
          left: spot.left - 4,
          width: spot.width + 8,
          height: spot.height + 8,
          zIndex: 205,
          pointerEvents: 'none',
          borderRadius: 8,
          animation: 'tourPulse 1.6s ease-in-out infinite',
        }} />
      )}
      <Modal opened={open} onClose={finish} size="lg" centered closeOnClickOutside={false}
        overlayProps={{ opacity: 0.35, blur: 0 }}
        title={<Text fw={700} size="lg">Welcome to mtg-archiver</Text>}>
      {skipped ? (
        <Box>
          <Group gap="md" align="flex-start" wrap="nowrap">
            <Box p="sm" style={{ background: 'var(--mantine-color-default-hover)', borderRadius: 12 }}>
              <IconSettings size={28} />
            </Box>
            <div>
              <Text fw={600} size="md" mb={4}>Re-trigger the tour any time</Text>
              <Text size="sm" c="dimmed">
                Open <b>Settings</b> (the gear icon in the header) and click <b>Replay intro tour</b>
                whenever you need a refresher.
              </Text>
            </div>
          </Group>
          <Group justify="flex-end" mt="xl">
            <Button onClick={finish} rightSection={<IconArrowRight size={14} />}>Go to dashboard</Button>
          </Group>
        </Box>
      ) : step === 0 ? (
        <Box>
          <Text size="sm" c="dimmed" mb="md">A self-hosted Magic: The Gathering collection manager. How would you like to start?</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            {CHOICES.map(c => (
              <Card key={c.mode} withBorder radius="md" padding="md" style={{ cursor: 'pointer' }}
                onClick={() => choose(c.mode)}>
                <Group gap="sm" mb="xs">
                  <c.icon size={24} style={{ flexShrink: 0 }} />
                  <Text fw={600} size="md">{c.title}</Text>
                </Group>
                <Text size="xs" c="dimmed" mb="sm">{c.desc}</Text>
                <Stack gap={4}>
                  {c.items.map(item => (
                    <Group key={item} gap={6} wrap="nowrap">
                      <IconCheck size={14} color="var(--mantine-color-teal-6)" style={{ flexShrink: 0 }} />
                      <Text size="xs">{item}</Text>
                    </Group>
                  ))}
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        </Box>
      ) : (
        <Box>
          {mode && mode !== 'blank' && (
            <Group mb="sm">
              <Badge color="teal" variant="light" size="sm">Recommended setup applied</Badge>
            </Group>
          )}
          {step - 1 < TOUR_STEPS.length && (() => {
            const s = TOUR_STEPS[step - 1];
            return (
              <Group gap="lg" align="flex-start" wrap="nowrap">
                <Box p="sm" style={{ background: 'var(--mantine-color-default-hover)', borderRadius: 12 }}>
                  <s.icon size={28} />
                </Box>
                <div style={{ flex: 1 }}>
                  <Text fw={600} size="md" mb={4}>{s.title}</Text>
                  <Text size="sm" c="dimmed">{s.desc}</Text>
                </div>
              </Group>
            );
          })()}
          <Group justify="space-between" mt="xl">
            <Text size="xs" c="dimmed">Step {Math.min(step, TOUR_STEPS.length)} of {TOUR_STEPS.length}</Text>
            <Group gap="xs">
              <Button variant="subtle" color="gray" size="compact-sm" onClick={goBack} disabled={step <= 1}
                leftSection={<IconArrowLeft size={14} />}>
                Back
              </Button>
              <Button variant="subtle" color="gray" size="compact-sm" onClick={skip}>Skip tour</Button>
              <Button onClick={next} rightSection={step >= TOUR_STEPS.length ? null : <IconArrowRight size={14} />}>
                {step >= TOUR_STEPS.length ? 'Get started' : 'Next'}
              </Button>
            </Group>
          </Group>
        </Box>
      )}
    </Modal>
    </>
  );
}
