import { useState, useEffect } from 'react';
import { Modal, Group, Text, Button, Card, Stack, Badge, Box } from '@mantine/core';
import {
  IconBook, IconTarget, IconList, IconPackage, IconStack, IconHistory, IconShoppingCart,
  IconPackages, IconDashboard, IconSettings, IconArrowRight, IconSparkles, IconPlus,
} from '@tabler/icons-react';
import { api } from '../api/client';

interface TourStep {
  title: string;
  icon: any;
  desc: string;
}

const TOUR_STEPS: TourStep[] = [
  { title: 'Collection', icon: IconList, desc: 'Your cards, grouped by name into subcards. Add, edit, move, schedule, select (shift-click for ranges), and see ghost cards for cards you want in this location.' },
  { title: 'Add Cards', icon: IconBook, desc: 'Search the full Scryfall database (name, set + collector number like "blb023", or scryfall syntax). Add to a location, or fulfil a wantlist entry directly.' },
  { title: 'Locations', icon: IconPackage, desc: 'Organize cards into binders, boxes, decks, and Collection goals — like "collect a whole set" with progress and cost-to-complete.' },
  { title: 'Decks', icon: IconStack, desc: 'Build decks with commander/partner/background support, a legality checker, bracket estimate, and ghost cards for cards you still need.' },
  { title: 'Wantlist', icon: IconShoppingCart, desc: 'Track cards you want — specific printing or generic. Fulfil externally (add a new card) or internally (use a copy you already own).' },
  { title: 'Organize', icon: IconHistory, desc: 'Schedule and resolve moves between locations. History tracks everything, including undone actions.' },
  { title: 'Trades & Boosters', icon: IconPackages, desc: 'Log trades with card values, and open boosters to track value vs cost and add pulls to your collection.' },
  { title: 'Dashboard', icon: IconDashboard, desc: 'Collection value over time, breakdowns by rarity/condition/location, top cards, and recent additions.' },
  { title: 'Settings & Backup', icon: IconSettings, desc: 'Export/import a full backup, change themes, and reset or reload demo data. Back up often!' },
];

interface SetupChoice {
  mode: string;
  icon: any;
  title: string;
  desc: string;
}

const CHOICES: SetupChoice[] = [
  { mode: 'demo', icon: IconSparkles, title: 'Demo', desc: 'Load a sample collection with two decks, binders, and bulk so you can click around.' },
  { mode: 'recommended', icon: IconTarget, title: 'Recommended', desc: 'Set up a clean workspace: Inbox, binders, a bulk box — ready for you to add your cards.' },
  { mode: 'blank', icon: IconPlus, title: 'Blank slate', desc: 'Start completely empty, with just the Inbox. Build everything yourself.' },
];

export default function SetupGuide() {
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    api.setup.get().then(s => {
      if (!s.done) {
        setOpen(true);
        setMode(s.mode);
        setStep(s.mode ? 1 : 0);
      }
    }).catch(() => {});
    const onShow = () => { setMode(null); setStep(0); setOpen(true); };
    window.addEventListener('mtg:show-setup', onShow);
    setLoading(false);
    return () => window.removeEventListener('mtg:show-setup', onShow);
  }, []);

  const choose = async (m: string) => {
    setMode(m);
    await api.setup.configure({ mode: m, done: false }).catch(() => {});
    setStep(1);
  };

  const finish = async () => {
    await api.setup.configure({ done: true }).catch(() => {});
    setOpen(false);
  };

  const next = () => {
    if (step < TOUR_STEPS.length) {
      setStep(step + 1);
    } else {
      finish();
    }
  };

  if (loading || !open) return null;

  return (
    <Modal opened={open} onClose={finish} size="lg" centered closeOnClickOutside={false}
      title={<Text fw={700} size="lg">Welcome to mtg-archiver</Text>}>
      {step === 0 ? (
        <Box>
          <Text size="sm" c="dimmed" mb="md">A self-hosted Magic: The Gathering collection manager. How would you like to start?</Text>
          <Stack gap="sm">
            {CHOICES.map(c => (
              <Card key={c.mode} withBorder radius="md" padding="sm" style={{ cursor: 'pointer' }}
                onClick={() => choose(c.mode)}>
                <Group gap="sm" wrap="nowrap">
                  <c.icon size={26} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <Text fw={600} size="sm">{c.title}</Text>
                    <Text size="xs" c="dimmed">{c.desc}</Text>
                  </div>
                  <IconArrowRight size={16} opacity={0.4} />
                </Group>
              </Card>
            ))}
          </Stack>
        </Box>
      ) : (
        <Box>
          {mode && mode !== 'blank' && (
            <Group mb="sm">
              <Badge color="teal" variant="light" size="sm">
                {mode === 'demo' ? 'Demo loaded' : 'Recommended setup applied'}
              </Badge>
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
              <Button variant="subtle" color="gray" size="compact-sm" onClick={finish}>Skip tour</Button>
              <Button onClick={next} rightSection={step > TOUR_STEPS.length ? null : <IconArrowRight size={14} />}>
                {step >= TOUR_STEPS.length ? 'Get started' : 'Next'}
              </Button>
            </Group>
          </Group>
        </Box>
      )}
    </Modal>
  );
}
