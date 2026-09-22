import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1');

// Opt-in: send callable functions to the local emulator (`firebase emulators:start
// --only functions`) instead of production, to try backend changes before they
// are deployed. Everything else — Auth, Firestore, Storage — stays on the real
// project. Set VITE_FUNCTIONS_EMULATOR=localhost:5001 in .env.local.
const functionsEmulator = import.meta.env.VITE_FUNCTIONS_EMULATOR as string | undefined;
if (import.meta.env.DEV && functionsEmulator) {
  const [host, port] = functionsEmulator.split(':');
  connectFunctionsEmulator(functions, host || 'localhost', Number(port) || 5001);
  console.info(`[firebase] Callable functions → emulator ${host || 'localhost'}:${Number(port) || 5001}`);
}
export const googleProvider = new GoogleAuthProvider();

export default app;
