import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import Layout from './components/Layout';
import { UndoProvider } from './components/UndoToasts';
import SetupGuide from './components/SetupGuide';
import Dashboard from './pages/Dashboard';
import AddCardsPage from './pages/AddCardsPage';
import LocationsPage from './pages/LocationsPage';
import CollectionPage from './pages/CollectionPage';
import SettingsPage from './pages/SettingsPage';
import BoosterPage from './pages/BoosterPage';
import DecksPage from './pages/DecksPage';
import WantlistPage from './pages/WantlistPage';
import TradesPage from './pages/TradesPage';
import OrganizePage from './pages/OrganizePage';
import { themes } from './themes';
import type { ThemeKey } from './themes';

export default function App() {
  const [themeKey, setThemeKey] = useState<ThemeKey>(() => {
    const saved = localStorage.getItem('mtg-archiver-theme');
    return (saved && saved in themes ? saved : 'dark') as ThemeKey;
  });

  useEffect(() => {
    localStorage.setItem('mtg-archiver-theme', themeKey);
  }, [themeKey]);

  const current = themes[themeKey];

  return (
    <MantineProvider theme={current.theme} forceColorScheme={current.colorScheme}>
      <Notifications position="bottom-right" autoClose={1200} />
      <UndoProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/add" element={<AddCardsPage />} />
            <Route path="/locations" element={<LocationsPage />} />
            <Route path="/collection" element={<CollectionPage />} />
            <Route path="/settings" element={<SettingsPage themeKey={themeKey} onThemeChange={setThemeKey} />} />
            <Route path="/booster" element={<BoosterPage />} />
            <Route path="/decks" element={<DecksPage />} />
            <Route path="/wantlist" element={<WantlistPage />} />
            <Route path="/trades" element={<TradesPage />} />
            <Route path="/organize" element={<OrganizePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
        <SetupGuide />
      </UndoProvider>
    </MantineProvider>
  );
}
