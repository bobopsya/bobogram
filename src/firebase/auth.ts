import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from './init';
import { createProfile } from './db';

function actionSettings() {
  return { url: window.location.origin + import.meta.env.BASE_URL };
}

/** Письмо со ссылкой возврата в приложение; если домен не разрешён в Firebase — без неё. */
async function sendVerification(user: User) {
  try {
    await sendEmailVerification(user, actionSettings());
  } catch (err) {
    console.warn('sendEmailVerification with continue URL failed, retrying without it', err);
    await sendEmailVerification(user);
  }
}

export async function register(email: string, password: string, displayName: string, username: string) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  // Если юзернейм успели занять — профиль не создастся, и приложение попросит выбрать другой.
  try {
    await createProfile(cred.user.uid, username, displayName);
  } finally {
    await sendVerification(cred.user).catch((err) => console.warn('sendEmailVerification failed', err));
  }
}

export async function login(email: string, password: string) {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function logout() {
  await signOut(auth);
}

export async function resetPassword(email: string) {
  await sendPasswordResetEmail(auth, email.trim(), actionSettings());
}

export async function resendVerification() {
  if (auth.currentUser) await sendVerification(auth.currentUser);
}

/** Перечитывает пользователя и обновляет токен, чтобы правила увидели email_verified. */
export async function refreshVerification(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  await user.reload();
  if (user.emailVerified) await user.getIdToken(true);
  return user.emailVerified;
}

/** Код ошибки Firebase → ключ перевода. */
export function authErrorKey(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'errors.invalidEmail';
    case 'auth/email-already-in-use':
      return 'errors.emailInUse';
    case 'auth/weak-password':
      return 'errors.weakPassword';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'errors.wrongCredentials';
    case 'auth/too-many-requests':
      return 'errors.tooManyRequests';
    case 'auth/network-request-failed':
    case 'unavailable':
      return 'errors.network';
    case 'permission-denied':
      return 'errors.permission';
    default:
      return 'errors.generic';
  }
}
