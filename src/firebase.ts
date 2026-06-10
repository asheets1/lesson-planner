import { initializeApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

/**
 * Firebase configuration.
 *
 * Values are read from Vite environment variables. Create a `.env.local`
 * file in the project root (see `.env.example`) with your project's keys
 * from the Firebase Console > Project Settings > Web App.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

/**
 * True once `.env.local` provides real credentials. While false, the app
 * renders a setup-instructions screen instead of crashing at module load
 * (getAuth throws `auth/invalid-api-key` on an empty config).
 */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId,
)

let authInstance: Auth | undefined
let dbInstance: Firestore | undefined

if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig)
  authInstance = getAuth(app)
  dbInstance = getFirestore(app)
} else {
  console.warn(
    'Firebase is not configured. Copy .env.example to .env.local and fill in your project keys.',
  )
}

// Non-null casts are safe: App.tsx gates all consumers behind isFirebaseConfigured.
export const auth = authInstance as Auth
export const db = dbInstance as Firestore
