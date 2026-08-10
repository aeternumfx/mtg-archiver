import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import Layout from './components/Layout';
import { UndoProvider } from './components/UndoToasts';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireAuth, RequireAdmin } from './auth/RequireAuth';
import { ChangePasswordModal } from './auth/ChangePasswordModal';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
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
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import AdminRequestsPage from './pages/admin/AdminRequestsPage';
import AdminUpdatesPage from './pages/admin/AdminUpdatesPage';
import AdminSystemSettingsPage from './pages/admin/AdminSystemSettingsPage';
import { themes } from './themes';
import type { ThemeKey } from './themes';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.role === 'admin' && !user.impersonating) return <Navigate to="/admin" replace />;
  return (
    <RequireAuth>
      <Layout>{children}</Layout>
    </RequireAuth>
  );
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;
  return <Navigate to={(user.role === 'admin' && !user.impersonating) ? '/admin' : '/dashboard'} replace />;
}

export default function App() {
  const [themeKey, setThemeKey] = useState<ThemeKey>(() => {
    const saved = localStorage.getItem('mtg-archiver-theme');
    return (saved && saved in themes ? saved : 'light') as ThemeKey;
  });

  useEffect(() => {
    localStorage.setItem('mtg-archiver-theme', themeKey);
  }, [themeKey]);

  const current = themes[themeKey];

  return (
    <MantineProvider theme={current.theme} forceColorScheme={current.colorScheme}>
      <Notifications position="bottom-right" autoClose={1200} />
      <AuthProvider>
        <UndoProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
            <Route path="/add" element={<Protected><AddCardsPage /></Protected>} />
            <Route path="/locations" element={<Protected><LocationsPage /></Protected>} />
            <Route path="/collection" element={<Protected><CollectionPage /></Protected>} />
            <Route path="/settings" element={<Protected><SettingsPage themeKey={themeKey} onThemeChange={setThemeKey} /></Protected>} />
            <Route path="/booster" element={<Protected><BoosterPage /></Protected>} />
            <Route path="/decks" element={<Protected><DecksPage /></Protected>} />
            <Route path="/wantlist" element={<Protected><WantlistPage /></Protected>} />
            <Route path="/trades" element={<Protected><TradesPage /></Protected>} />
            <Route path="/organize" element={<Protected><OrganizePage /></Protected>} />
            <Route path="/admin" element={
              <RequireAuth><RequireAdmin><Layout><AdminDashboardPage /></Layout></RequireAdmin></RequireAuth>
            } />
            <Route path="/admin/users" element={
              <RequireAuth><RequireAdmin><Layout><AdminUsersPage /></Layout></RequireAdmin></RequireAuth>
            } />
            <Route path="/admin/requests" element={
              <RequireAuth><RequireAdmin><Layout><AdminRequestsPage /></Layout></RequireAdmin></RequireAuth>
            } />
            <Route path="/admin/settings" element={
              <RequireAuth><RequireAdmin><Layout><AdminSystemSettingsPage /></Layout></RequireAdmin></RequireAuth>
            } />
            <Route path="/admin/updates" element={
              <RequireAuth><RequireAdmin><Layout><AdminUpdatesPage /></Layout></RequireAdmin></RequireAuth>
            } />
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
          <ChangePasswordModal />
        </UndoProvider>
      </AuthProvider>
    </MantineProvider>
  );
}
