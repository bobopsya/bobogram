const env = import.meta.env;
const projectId = env.VITE_FIREBASE_PROJECT_ID || 'demo-bobogram';

export const useEmulators = env.VITE_USE_EMULATORS === 'true';

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
  projectId,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL || `https://${projectId}-default-rtdb.firebaseio.com`,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '0',
  appId: env.VITE_FIREBASE_APP_ID || '1:0:web:0',
};

/** true, если приложение подключено к настоящему проекту или к эмуляторам. */
export const isConfigured = useEmulators || Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID);
