import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { firebaseConfig, useEmulators } from './config';

export { isConfigured } from './config';

const env = import.meta.env;
export const vapidKey: string | undefined = env.VITE_FIREBASE_VAPID_KEY || undefined;
export const workerUrl: string | undefined = env.VITE_WORKER_URL?.replace(/\/$/, '') || undefined;

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const rtdb = getDatabase(app);

if (useEmulators) {
  const host = env.VITE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectDatabaseEmulator(rtdb, host, 9000);
}
