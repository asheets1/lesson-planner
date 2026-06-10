import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { Loader2, Settings } from 'lucide-react'
import { auth, isFirebaseConfigured } from './firebase'
import Login from './components/Login'
import Dashboard from './components/Dashboard'

/**
 * Authentication wrapper: shows the login form until Firebase reports a
 * signed-in user, then renders the planning dashboard. If Firebase has
 * not been configured yet, shows setup instructions instead of crashing.
 */
export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    if (!isFirebaseConfigured) return
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setAuthReady(true)
    })
    return unsubscribe
  }, [])

  if (!isFirebaseConfigured) {
    return <SetupNotice />
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <Loader2 size={24} className="animate-spin text-indigo-500" aria-hidden="true" />
      </div>
    )
  }

  return user ? <Dashboard /> : <Login />
}

/** Shown until .env.local is filled in with real Firebase credentials. */
function SetupNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-200">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
            <Settings size={20} aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">
            Firebase setup required
          </h1>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          The app is running, but it isn&apos;t connected to Firebase yet.
          Finish these one-time steps:
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>
            Create a project at{' '}
            <a
              href="https://console.firebase.google.com"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-indigo-600 underline"
            >
              console.firebase.google.com
            </a>{' '}
            and add a <strong>Web App</strong>.
          </li>
          <li>
            Enable <strong>Authentication → Email/Password</strong> and create
            the shared team user (e.g.{' '}
            <code className="rounded bg-slate-100 px-1">team4@school.edu</code>).
          </li>
          <li>
            Create a <strong>Firestore</strong> database and publish the rules
            from <code className="rounded bg-slate-100 px-1">firestore.rules</code>.
          </li>
          <li>
            Copy <code className="rounded bg-slate-100 px-1">.env.example</code>{' '}
            to <code className="rounded bg-slate-100 px-1">.env.local</code> and
            paste in your web app&apos;s config keys.
          </li>
        </ol>
        <p className="mt-4 text-xs text-slate-400">
          Vite restarts automatically when .env.local changes — this page will
          become the login screen once the keys are in place.
        </p>
      </div>
    </div>
  )
}
