import { lazy, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { isConfigured } from '../supabase/client';
import { useApp } from './store';
import { useSessionBootstrap } from './session';
import { useThemeEffect, useViewportHeight } from './effects';
import { AuthScreen } from '../features/auth/AuthScreen';
import { BannedScreen, NoProfileScreen, SetupNeededScreen } from '../features/auth/Gates';
import { Layout } from './Layout';
import { ErrorBoundary } from './ErrorBoundary';
import { ChatScreen } from '../features/chat/ChatScreen';
import { EmptyMain } from './EmptyMain';
import { FullScreenSpinner, OfflineBanner, Toast } from '../ui/misc';
import { CallLayer } from '../features/calls/CallLayer';
import { useIncomingSounds } from './sounds';
import { usePushRegistration } from '../supabase/push';

const AdminPanel = lazy(() => import('../features/admin/AdminPanel'));
// Редкие экраны грузятся отдельными файлами при первом открытии — стартовый бандл меньше.
const ProfileRoute = lazy(() => import('../features/profile/ProfileView').then((m) => ({ default: m.ProfileRoute })));
const UsernameRoute = lazy(() => import('../features/profile/ProfileView').then((m) => ({ default: m.UsernameRoute })));
const SettingsScreen = lazy(() =>
  import('../features/settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })),
);
const EditProfileScreen = lazy(() =>
  import('../features/profile/EditProfile').then((m) => ({ default: m.EditProfileScreen })),
);
const BlocklistScreen = lazy(() => import('../features/settings/Blocklist').then((m) => ({ default: m.BlocklistScreen })));
const AppearanceScreen = lazy(() =>
  import('../features/settings/Appearance').then((m) => ({ default: m.AppearanceScreen })),
);
const PremiumScreen = lazy(() => import('../features/settings/Premium').then((m) => ({ default: m.PremiumScreen })));
const NewGroupScreen = lazy(() => import('../features/groups/NewGroup').then((m) => ({ default: m.NewGroupScreen })));
const ChatInfoRoute = lazy(() => import('../features/groups/ChatInfo').then((m) => ({ default: m.ChatInfoRoute })));
const JoinScreen = lazy(() => import('../features/groups/Join').then((m) => ({ default: m.JoinScreen })));

function Gate() {
  const { authReady, userId, profile } = useApp();
  if (!isConfigured) return <SetupNeededScreen />;
  if (!authReady) return <FullScreenSpinner />;
  if (!userId) return <AuthScreen />;
  if (profile === undefined) return <FullScreenSpinner />;
  if (profile === null) return <NoProfileScreen />;
  if (profile.banned) return <BannedScreen />;
  return <Messenger />;
}

function Messenger() {
  useIncomingSounds();
  usePushRegistration();
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<EmptyMain />} />
          <Route path="c/:chatId" element={<ChatScreen />} />
          <Route path="c/:chatId/info" element={<ChatInfoRoute />} />
          <Route path="u/:username" element={<UsernameRoute />} />
          <Route path="profile/:uid" element={<ProfileRoute />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="settings/profile" element={<EditProfileScreen />} />
          <Route path="settings/blocked" element={<BlocklistScreen />} />
          <Route path="settings/appearance" element={<AppearanceScreen />} />
          <Route path="settings/premium" element={<PremiumScreen />} />
          <Route path="new/group" element={<NewGroupScreen kind="group" />} />
          <Route path="new/channel" element={<NewGroupScreen kind="channel" />} />
          <Route path="join/:code" element={<JoinScreen />} />
          <Route path="admin" element={<AdminPanel />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <CallLayer />
    </>
  );
}

export function App() {
  useSessionBootstrap();
  useThemeEffect();
  useViewportHeight();
  useEffect(() => {
    document.getElementById('boot')?.remove();
  }, []);
  return (
    <HashRouter>
      <OfflineBanner />
      <ErrorBoundary>
        <Gate />
      </ErrorBoundary>
      <Toast />
    </HashRouter>
  );
}
