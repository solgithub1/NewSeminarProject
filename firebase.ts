import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyD1vzyH4jxFIcfyE4OUeW8TsZ2O0TXPc3g',
  authDomain: 'seminarproject-9f835.firebaseapp.com',
  projectId: 'seminarproject-9f835',
  storageBucket: 'seminarproject-9f835.firebasestorage.app',
  messagingSenderId: '241077793798',
  appId: '1:241077793798:web:effd7dd877ca52ae59bf87',
  measurementId: 'G-Q4TB4EXD6G',
};
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

/**
 * Ensures the current browser session is authenticated with Firebase
 * (anonymously) before any protected Firestore read/write is attempted.
 * Reuses the existing session if the user is already signed in — safe to
 * call on every login attempt without creating duplicate anonymous users.
 * @returns the authenticated Firebase user once the auth state is confirmed.
 */
export function ensureAuthenticated(): Promise<User> {
  return new Promise((resolve, reject) => {
    if (auth.currentUser) {
      resolve(auth.currentUser);
      return;
    }
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsubscribe();
          resolve(user);
        }
      },
      (error) => {
        unsubscribe();
        reject(error);
      }
    );
    signInAnonymously(auth).catch((err) => {
      unsubscribe();
      reject(err);
    });
  });
}