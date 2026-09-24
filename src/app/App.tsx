import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { isConfigured } from '../supabase/client';
import { useApp } from './store';
import { useSessionBootstrap } from './session';
import { useThemeEffect, useViewportHeight } from './effects';
import { AuthScreen } from '../features/auth/AuthScreen';
import { BannedScreen, NoProfileScreen, SetupNeededScreen } from '../features/auth/Gates';
import { Layout } from './Layout';
import { ChatScreen } from '../features/chat/ChatScreen';
import { EmptyMain } from './EmptyMain';
import { ProfileRoute, UsernameRoute } from '../features/profile/ProfileView';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { EditProfileScreen } from '../features/profile/EditProfile';
import { BlocklistScreen } from '../features/settings/Blocklist';
import { NewGroupScreen } from '../features/groups/NewGroup';
import { ChatInfoRoute } from '../features/groups/ChatInfo';
import { JoinScreen } from '../features/groups/Join';
import { FullScreenSpinner, OfflineBanner, Toast } from '../ui/misc';
import { CallLayer } from '../features/calls/CallLayer';
import { useIncomingSounds } from './sounds';
import { usePushRegistration } from '../supabase/push';

const AdminPanel = lazy(() => import('../features/admin/AdminPanel'));

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
          <Route path="new/group" element={<NewGroupScreen kind="group" />} />
          <Route path="new/channel" element={<NewGroupScreen kind="channel" />} />
          <Route path="join/:code" element={<JoinScreen />} />
          <Route
            path="admin"
            element={
              <Suspense fallback={<FullScreenSpinner />}>
                <AdminPanel />
              </Suspense>
            }
          />
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
      <Gate />
      <Toast />
    </HashRouter>
  );
}
