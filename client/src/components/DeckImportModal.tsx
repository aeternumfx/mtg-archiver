import { useState, useEffect } from 'react';
import {
  Modal, TextInput, Select, Textarea, SegmentedControl, Button, Group, Text, FileInput, Badge, Progress, Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconUpload, IconFileText } from '@tabler/icons-react';
import { api } from '../api/client';
import { DECK_TYPES } from './DeckFormModal';

export interface DeckImportResult {
  deck: any;
  importedCards: number;
  uniqueCards: number;
  commanders: string[];
}

const IMPORT_STAGES = ['Parsing decklist…', 'Checking cards…', 'Importing ghost cards…'];

export function DeckImportModal({ opened, onClose, onImported }: {
  opened: boolean;
  onClose: () => void;
  onImported: (result: DeckImportResult) => void;
}) {
  const [name, setName] = useState('');
  const [deckType, setDeckType] = useState('custom');
  const [content, setContent] = useState('');
  const [source, setSource] = useState<'paste' | 'upload'>('paste');
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (opened) {
      setName('');
      setDeckType('custom');
      setContent('');
      setSource('paste');
      setFile(null);
      setImporting(false);
      setProgress(0);
    }
  }, [opened]);

  useEffect(() => {
    if (!importing) return;
    setProgress(4);
    const t = window.setInterval(() => {
      setProgress(p => (p < 88 ? Math.min(88, p + 1.5 + Math.random() * 5) : p));
    }, 160);
    return () => window.clearInterval(t);
  }, [importing]);

  const handleFile = (f: File | null) => {
    setFile(f);
    if (!f) return;
    if (!name.trim()) setName(f.name.replace(/\.(csv|txt)$/i, ''));
    const reader = new FileReader();
    reader.onload = () => setContent(String(reader.result || ''));
    reader.readAsText(f);
  };

  const handleImport = async () => {
    if (!name.trim()) {
      notifications.show({ title: 'No name', message: 'Give the deck a name first', color: 'yellow', autoClose: 8000 });
      return;
    }
    if (!content.trim()) {
      notifications.show({ title: 'Empty decklist', message: 'Paste a decklist or upload a CSV file first', color: 'yellow', autoClose: 8000 });
      return;
    }
    setImporting(true);
    setProgress(4);
    try {
      const result = await api.decks.importDeck({ name: name.trim(), deckType, content, format: 'auto' });
      setProgress(100);
      onImported(result as DeckImportResult);
    } catch (err: any) {
      const body = err?.body as { error?: string; unknown?: string[] } | null | undefined;
      const unknown = body?.unknown;
      notifications.show({
        title: 'Import failed',
        message: unknown && unknown.length > 0
          ? `${body?.error ?? 'Some cards were not found.'}\n\n${unknown.join('\n')}`
          : (body?.error || err?.message || 'Something went wrong'),
        color: 'red',
        autoClose: 20000,
        withCloseButton: true,
      });
    } finally {
      setImporting(false);
      setProgress(0);
    }
  };

  const lineCount = content ? content.split(/\r?\n/).filter(l => l.trim()).length : 0;
  const stageLabel = progress < 25 ? IMPORT_STAGES[0] : progress < 55 ? IMPORT_STAGES[1] : IMPORT_STAGES[2];

  return (
    <Modal opened={opened} onClose={onClose} title="Import Deck" size="lg" centered>
      <TextInput label="Deck name" value={name} onChange={e => setName(e.currentTarget.value)} mb="sm" required
        placeholder="My New Deck" />
      <Select label="Deck type" data={DECK_TYPES} value={deckType} onChange={v => setDeckType(v || 'custom')} mb="sm" />

      <Text size="sm" fw={500} mb={4}>Source</Text>
      <SegmentedControl fullWidth mb="sm" value={source} onChange={v => setSource(v as 'paste' | 'upload')}
        data={[
          { value: 'paste', label: 'Paste decklist' },
          { value: 'upload', label: 'Upload CSV' },
        ]} />

      {source === 'upload' && (
        <FileInput
          label="CSV file"
          placeholder="Choose a .csv file (Archidekt / Moxfield export)"
          accept=".csv,.txt,text/csv,text/plain"
          value={file}
          onChange={handleFile}
          leftSection={<IconUpload size={14} />}
          mb="sm"
          clearable
        />
      )}

      <Textarea
        label="Decklist"
        description={source === 'upload' ? 'File contents (you can edit before importing).' : 'Paste a decklist or a CSV export from Archidekt / Moxfield.'}
        value={content}
        onChange={e => { setContent(e.currentTarget.value); if (file) setFile(null); }}
        placeholder={
          'Plain text format:\n1x Sword of Truth and Justice (h1r) 32 *F*\n2x Arcane Signet\nSol Ring x4\nGaea\'s Cradle\n\nUse any number of cards (the cards must exist in the card database to import).\n\nSection headers (e.g. //Commander, //Main, //Maybeboard) are ignored; Commander / Partner / Background sections set those roles.\n\nOr paste a CSV:\nCard,Set Code,Collector #,Quantity,Tags\nSol Ring,JMP,98,1,Commander\n...'
        }
        autosize minRows={9} maxRows={16}
        mb="xs"
      />

      <Group justify="space-between" mb="md">
        <Text size="xs" c="dimmed">
          <Badge size="xs" variant="light" color="gray" leftSection={<IconFileText size={12} />}>Auto-detect</Badge>
          {' '}Cards import as ghost cards (wishlist). Every card must exist in the card database or the import is cancelled. When a printing (set + collector #) is given and found, that exact printing is used; otherwise a generic ghost for that card is created.
        </Text>
        {lineCount > 0 && <Text size="xs" c="dimmed">{lineCount} line{lineCount !== 1 ? 's' : ''} detected</Text>}
      </Group>

      {importing && (
        <Box style={{ background: 'var(--mantine-color-default-hover)', borderRadius: 8 }} p="sm" mb="md">
          <Progress value={progress} striped animated size="sm" transitionDuration={200} mb={4} />
          <Text size="xs" c="dimmed">{stageLabel}</Text>
        </Box>
      )}

      <Group justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={importing}>Cancel</Button>
        <Button loading={importing} disabled={!name.trim() || !content.trim() || importing} onClick={handleImport} leftSection={source === 'upload' ? <IconUpload size={14} /> : undefined}>
          Import
        </Button>
      </Group>
    </Modal>
  );
}