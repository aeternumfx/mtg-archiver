import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { Paper, Group, Text, Button, Progress, ActionIcon } from '@mantine/core';
import { IconRotate, IconX } from '@tabler/icons-react';

interface UndoEntry {
  id: number;
  message: string;
  actionLabel: string;
  undo: () => void | Promise<void>;
}

interface UndoContextValue {
  push: (message: string, undo: () => void | Promise<void>, actionLabel?: string) => void;
}

const UndoContext = createContext<UndoContextValue | null>(null);

export function useUndo(): UndoContextValue {
  const ctx = useContext(UndoContext);
  if (!ctx) throw new Error('useUndo must be used within UndoProvider');
  return ctx;
}

const DURATION = 8000;

export function UndoProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<UndoEntry | null>(null);
  const [progress, setProgress] = useState(100);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idRef = useRef(0);

  const clear = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setEntry(null);
    setProgress(100);
  }, []);

  const push = useCallback((message: string, undo: () => void | Promise<void>, actionLabel = 'Undo') => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const id = ++idRef.current;
    setEntry({ id, message, actionLabel, undo });
    setProgress(100);
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / DURATION) * 100);
      setProgress(remaining);
      if (elapsed >= DURATION) clear();
    }, 50);
  }, [clear]);

  const handleUndo = useCallback(async () => {
    const e = entry;
    if (!e) return;
    try { await e.undo(); } catch {}
    clear();
  }, [entry, clear]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const typing =
        tag === 'TEXTAREA' ||
        !!el?.isContentEditable ||
        (tag === 'INPUT' && (!!(el as HTMLInputElement).value || (el as HTMLInputElement).type !== 'text'));
      if (typing) return;
      e.preventDefault();
      handleUndo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo]);

  return (
    <UndoContext.Provider value={{ push }}>
      {children}
      {entry && (
        <Paper shadow="lg" radius="md" withBorder
          pos="fixed" bottom={20} right={20}
          style={{ zIndex: 1000, width: 380, overflow: 'hidden' }}>
          <Group p="sm" gap="sm" wrap="nowrap" align="center">
            <Text size="sm" fw={500} style={{ flex: 1 }} lineClamp={2}>{entry.message}</Text>
            <Button variant="light" color="blue" size="compact-sm" onClick={handleUndo} leftSection={<IconRotate size={14} />}>
              {entry.actionLabel}
            </Button>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={clear}><IconX size={14} /></ActionIcon>
          </Group>
          <Progress value={progress} size="xs" color="blue" />
        </Paper>
      )}
    </UndoContext.Provider>
  );
}
