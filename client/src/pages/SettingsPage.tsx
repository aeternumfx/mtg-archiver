import { useState } from 'react';
import {
  Title, Card, Group, Text, Radio, Stack, Button, FileInput, TextInput, Alert, Modal,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconDownload, IconUpload, IconAlertTriangle, IconCheck, IconX, IconTrash, IconSparkles } from '@tabler/icons-react';
import { themes } from '../themes';
import { api } from '../api/client';
import type { ThemeKey } from '../themes';
import type { ImportDiffReport, ImportOptions } from '../types';
import ImportDiffModal from '../components/ImportDiffModal';

export default function SettingsPage({ themeKey, onThemeChange }: { themeKey: ThemeKey; onThemeChange: (k: ThemeKey) => void }) {
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [diffOpen, { open: openDiff, close: closeDiff }] = useDisclosure(false);
  const [diffReport, setDiffReport] = useState<ImportDiffReport | null>(null);
  const [pendingData, setPendingData] = useState<any>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await api.data.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mtg-archiver-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setImportMsg({ type: 'error', text: err.message });
    } finally {
      setExporting(false);
    }
  };

  const runImport = async (data: any, options?: ImportOptions) => {
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await api.data.import(data, importMode, options);
      setImportMsg({ type: 'ok', text: res.message });
      setImportFile(null);
      setConfirmText('');
    } catch (err: any) {
      setImportMsg({ type: 'error', text: err.message });
    } finally {
      setImporting(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    if (importMode === 'replace' && confirmText !== 'i am sure') return;

    setImporting(true);
    setImportMsg(null);

    try {
      const text = await importFile.text();
      const data = JSON.parse(text);
      if (!data.version) throw new Error('Invalid backup file.');
      const report = await api.data.importPreview(data);
      const hasDiffs = report.totalMissing > 0 || report.totalExtra > 0 || report.unknownCollections.length > 0;
      if (hasDiffs) {
        setDiffReport(report);
        setPendingData(data);
        openDiff();
        return;
      }
      await runImport(data);
    } catch (err: any) {
      setImportMsg({ type: 'error', text: err.message });
    } finally {
      setImporting(false);
    }
  };

  const handleImportConfirm = async (options: ImportOptions) => {
    if (!pendingData) return;
    closeDiff();
    await runImport(pendingData, options);
    setDiffReport(null);
    setPendingData(null);
  };

  const handleDelete = async () => {
    if (deleteConfirm !== 'i am sure') return;
    setDeleting(true);
    try {
      const res = await api.data.delete();
      setImportMsg({ type: 'ok', text: res.message });
      closeDelete();
      setDeleteConfirm('');
      window.dispatchEvent(new Event('mtg:show-initial-setup'));
    } catch (err: any) {
      setImportMsg({ type: 'error', text: err.message });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Title order={2} mb="lg" data-tour="settings-page">Settings</Title>

      <Card shadow="sm" padding="lg" radius="md" withBorder mb="md">
        <Text fw={600} mb="md">Theme</Text>
        <Radio.Group value={themeKey} onChange={v => onThemeChange(v as ThemeKey)}>
          <Stack gap="sm">
            {Object.entries(themes).map(([key, t]) => (
              <Card key={key} withBorder radius="sm" padding="sm" style={{ cursor: 'pointer' }}
                onClick={() => onThemeChange(key as ThemeKey)}
                bg={themeKey === key ? 'var(--mantine-color-blue-0)' : undefined}
              >
                <Group>
                  <Radio value={key} checked={themeKey === key} readOnly />
                  <Text size="lg">{t.icon}</Text>
                  <div>
                    <Text fw={500} size="sm">{t.label}</Text>
                    <Text size="xs" c="dimmed">{t.colorScheme === 'dark' ? 'Dark mode' : 'Light mode'} — {t.label === 'Galaxy' ? 'Purple/blue space theme' : 'Default Mantine theme'}</Text>
                  </div>
                </Group>
              </Card>
            ))}
          </Stack>
        </Radio.Group>
      </Card>

      <Card shadow="sm" padding="lg" radius="md" withBorder mb="md">
        <Text fw={600} mb="md">Intro Tour</Text>
        <Text size="sm" c="dimmed" mb="md">
          Replay the welcome tour and setup choices (demo / recommended / blank slate).
        </Text>
        <Button
          leftSection={<IconSparkles size={16} />}
          variant="light"
          onClick={() => {
            api.setup.configure({ done: false }).catch(() => {});
            window.dispatchEvent(new Event('mtg:show-setup'));
          }}
        >
          Replay Intro Tour
        </Button>
      </Card>

      <Card shadow="sm" padding="lg" radius="md" withBorder mb="md">
        <Text fw={600} mb="md">Export Data</Text>
        <Text size="sm" c="dimmed" mb="md">
          Download your collection data as a JSON file. You can use this file to
          back up your collection or migrate to a new instance.
        </Text>
        <Button
          leftSection={<IconDownload size={16} />}
          onClick={handleExport}
          loading={exporting}
        >
          Export Collection Data
        </Button>
      </Card>

      <Card shadow="sm" padding="lg" radius="md" withBorder mb="md">
        <Text fw={600} mb="md">Import Data</Text>
        <Text size="sm" c="dimmed" mb="md">
          Restore your collection from a previously exported JSON file.
        </Text>

        <Radio.Group value={importMode} onChange={v => setImportMode(v as 'merge' | 'replace')} mb="md">
          <Group gap="lg">
            <Radio value="merge" label="Add to existing collection" />
            <Radio value="replace" label="Replace all data" />
          </Group>
        </Radio.Group>

        {importMode === 'replace' && (
          <Alert icon={<IconAlertTriangle size={16} />} title="Warning" color="red" mb="md">
            This will permanently delete all your current locations, groups, and
            collection items before importing. Consider <b>exporting your data first</b>
            as a backup.
            <Button size="compact-xs" variant="light" leftSection={<IconDownload size={12} />}
              onClick={handleExport} loading={exporting} ml="sm">
              Export Now
            </Button>
          </Alert>
        )}

        <FileInput
          placeholder="Select backup file"
          accept=".json"
          value={importFile}
          onChange={f => { setImportFile(f); setImportMsg(null); }}
          mb="md"
        />

        {importMode === 'replace' && (
          <TextInput
            placeholder='Type "i am sure" to confirm'
            value={confirmText}
            onChange={e => setConfirmText(e.currentTarget.value)}
            mb="md"
          />
        )}

        {importMsg && (
          <Alert
            icon={importMsg.type === 'ok' ? <IconCheck size={16} /> : <IconX size={16} />}
            title={importMsg.type === 'ok' ? 'Success' : 'Error'}
            color={importMsg.type === 'ok' ? 'green' : 'red'}
            mb="md"
            withCloseButton
            onClose={() => setImportMsg(null)}
          >
            {importMsg.text}
          </Alert>
        )}

        <Button
          leftSection={<IconUpload size={16} />}
          onClick={handleImport}
          loading={importing}
          disabled={
            !importFile ||
            (importMode === 'replace' && confirmText !== 'i am sure')
          }
        >
          Import Data
        </Button>
      </Card>

      <Card shadow="sm" padding="lg" radius="md" withBorder>
        <Text fw={600} mb="md" c="red">Danger Zone</Text>
        <Text size="sm" c="dimmed" mb="md">
          Permanently delete all your collection data. This cannot be undone.
        </Text>
        <Button
          leftSection={<IconTrash size={16} />}
          color="red"
          onClick={openDelete}
        >
          Delete All Data
        </Button>
      </Card>

      <Modal opened={deleteOpened} onClose={closeDelete} title="Delete All Data" size="sm" centered>
        <Alert icon={<IconAlertTriangle size={16} />} title="Warning" color="red" mb="md">
          This will permanently delete all your collection data, locations, decks,
          and history, and start you back at the initial setup. Consider{' '}
          <b>exporting your data first</b> as a backup.
          <Button size="compact-xs" variant="light" leftSection={<IconDownload size={12} />}
            onClick={handleExport} loading={exporting} ml="sm">
            Export Now
          </Button>
        </Alert>

        <TextInput
          placeholder='Type "i am sure" to confirm'
          value={deleteConfirm}
          onChange={e => setDeleteConfirm(e.currentTarget.value)}
          mb="md"
        />

        <Group justify="flex-end">
          <Button variant="default" onClick={closeDelete}>Cancel</Button>
          <Button
            color="red"
            onClick={handleDelete}
            loading={deleting}
            disabled={deleteConfirm !== 'i am sure'}
          >
            Delete Everything
          </Button>
        </Group>
      </Modal>

      {diffReport && (
        <ImportDiffModal
          opened={diffOpen}
          onClose={() => { closeDiff(); setDiffReport(null); setPendingData(null); }}
          report={diffReport}
          importing={importing}
          onConfirm={handleImportConfirm}
        />
      )}
    </>
  );
}
