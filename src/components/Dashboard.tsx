import { useCallback, useEffect, useRef, useState } from 'react'
import { signOut } from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore'
import {
  Archive,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  CloudUpload,
  Loader2,
  LogOut,
  Plus,
} from 'lucide-react'
import { auth, db } from '../firebase'
import {
  DAYS,
  SUBJECTS,
  WEEKS,
  WEEK_LABELS,
  createEmptyPlan,
  currentCycleStart,
  formatCycleRange,
  formatShortDate,
  getCycleDate,
  nextCycleStart,
  type Day,
  type SchedulePlan,
  type Subject,
  type Week,
} from '../types'

const planDoc = () => doc(db, 'plans', 'current-cycle')
const cyclesCol = () => collection(db, 'cycles')
const cycleDoc = (id: string) => doc(db, 'cycles', id)
const DEBOUNCE_MS = 600

type SaveState = 'idle' | 'pending' | 'saved'
type ArchiveItem = { id: string; startDate: string }
type View =
  | { type: 'current' }
  | { type: 'archive-list'; items: ArchiveItem[] | null }
  | { type: 'archive-detail'; plan: SchedulePlan }

const cellKey = (week: Week, day: Day, subject: Subject) =>
  `${week}|${day}|${subject}`

export default function Dashboard() {
  const [plan, setPlan] = useState<SchedulePlan | null>(null)
  const [activeWeek, setActiveWeek] = useState<Week>('week1')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [view, setView] = useState<View>({ type: 'current' })
  const [showConfirm, setShowConfirm] = useState(false)
  const [cycling, setCycling] = useState(false)
  const [archiveWeek, setArchiveWeek] = useState<Week>('week1')

  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const pendingRef = useRef(new Map<string, string>())
  const inFlightRef = useRef(0)

  useEffect(() => {
    const unsubscribe = onSnapshot(
      planDoc(),
      (snapshot) => {
        if (!snapshot.exists()) {
          void setDoc(planDoc(), createEmptyPlan())
          return
        }
        const remote = snapshot.data() as SchedulePlan
        // Migrate existing plans that predate the startDate field.
        if (!remote.startDate) {
          const startDate = currentCycleStart()
          void setDoc(planDoc(), { startDate }, { merge: true })
          remote.startDate = startDate
        }
        setPlan(() => {
          const next = createEmptyPlan(remote.startDate)
          for (const week of WEEKS) {
            for (const day of DAYS) {
              for (const subject of SUBJECTS) {
                const key = cellKey(week, day, subject)
                next[week][day][subject] =
                  pendingRef.current.get(key) ??
                  remote?.[week]?.[day]?.[subject] ??
                  ''
              }
            }
          }
          return next
        })
      },
      (err) => console.error('Firestore subscription failed:', err),
    )
    return unsubscribe
  }, [])

  const flushCell = useCallback(
    async (week: Week, day: Day, subject: Subject, value: string) => {
      const key = cellKey(week, day, subject)
      inFlightRef.current += 1
      setSaveState('pending')
      try {
        await setDoc(
          planDoc(),
          { [week]: { [day]: { [subject]: value } } },
          { merge: true },
        )
        if (pendingRef.current.get(key) === value) {
          pendingRef.current.delete(key)
        }
      } catch (err) {
        console.error('Failed to save lesson note:', err)
      } finally {
        inFlightRef.current -= 1
        if (inFlightRef.current === 0 && timersRef.current.size === 0) {
          setSaveState('saved')
        }
      }
    },
    [],
  )

  const handleCellChange = useCallback(
    (week: Week, day: Day, subject: Subject, value: string) => {
      setPlan((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          [week]: {
            ...prev[week],
            [day]: { ...prev[week][day], [subject]: value },
          },
        }
      })
      const key = cellKey(week, day, subject)
      pendingRef.current.set(key, value)
      setSaveState('pending')
      const existing = timersRef.current.get(key)
      if (existing) clearTimeout(existing)
      timersRef.current.set(
        key,
        setTimeout(() => {
          timersRef.current.delete(key)
          void flushCell(week, day, subject, value)
        }, DEBOUNCE_MS),
      )
    },
    [flushCell],
  )

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
    }
  }, [])

  async function handleStartNewCycle() {
    if (!plan) return
    setCycling(true)
    try {
      await setDoc(cycleDoc(plan.startDate), plan)
      await setDoc(planDoc(), createEmptyPlan(nextCycleStart(plan.startDate)))
    } catch (err) {
      console.error('Failed to start new cycle:', err)
    } finally {
      setCycling(false)
      setShowConfirm(false)
    }
  }

  async function handleOpenArchives() {
    setView({ type: 'archive-list', items: null })
    try {
      const snap = await getDocs(query(cyclesCol(), orderBy('startDate', 'desc')))
      const items = snap.docs.map((d) => ({ id: d.id, startDate: d.id }))
      setView({ type: 'archive-list', items })
    } catch (err) {
      console.error('Failed to load archives:', err)
      setView({ type: 'archive-list', items: [] })
    }
  }

  async function handleViewArchive(item: ArchiveItem) {
    try {
      const snap = await getDoc(cycleDoc(item.id))
      if (snap.exists()) {
        setView({ type: 'archive-detail', plan: snap.data() as SchedulePlan })
      }
    } catch (err) {
      console.error('Failed to load archive:', err)
    }
  }

  if (!plan) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 size={20} className="animate-spin" aria-hidden="true" />
          <span className="text-sm font-medium">Loading the team plan…</span>
        </div>
      </div>
    )
  }

  // ── Archive list ──────────────────────────────────────────────────────────
  if (view.type === 'archive-list') {
    return (
      <div className="min-h-screen bg-slate-100">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
            <button
              onClick={() => setView({ type: 'current' })}
              className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back to Current Cycle
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Past Cycles</h2>
          {view.items === null ? (
            <div className="flex justify-center py-12">
              <Loader2 size={20} className="animate-spin text-indigo-500" aria-hidden="true" />
            </div>
          ) : view.items.length === 0 ? (
            <p className="text-sm text-slate-500">
              No archived cycles yet. Use "New Cycle" to archive the current one.
            </p>
          ) : (
            <ul className="space-y-2">
              {view.items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => void handleViewArchive(item)}
                    className="w-full rounded-xl bg-white px-4 py-3 text-left text-sm font-medium text-slate-800 shadow-sm ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:ring-indigo-200"
                  >
                    {formatCycleRange(item.startDate)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    )
  }

  // ── Archive detail (read-only) ────────────────────────────────────────────
  if (view.type === 'archive-detail') {
    const archivePlan = view.plan
    return (
      <div className="min-h-screen bg-slate-100">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
            <button
              onClick={() => void handleOpenArchives()}
              className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back to Archives
            </button>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-400 text-white">
                <Archive size={18} aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-base font-semibold leading-tight text-slate-900">
                  Archived Cycle
                </h1>
                <p className="text-xs text-slate-500">{formatCycleRange(archivePlan.startDate)}</p>
              </div>
            </div>
            <div
              role="tablist"
              aria-label="Select week"
              className="ml-auto flex rounded-lg bg-slate-100 p-1"
            >
              {WEEKS.map((week) => (
                <button
                  key={week}
                  role="tab"
                  aria-selected={archiveWeek === week}
                  onClick={() => setArchiveWeek(week)}
                  className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition ${
                    archiveWeek === week
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <CalendarDays size={14} aria-hidden="true" />
                  {WEEK_LABELS[week]}
                </button>
              ))}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <PlanGrid plan={archivePlan} activeWeek={archiveWeek} readOnly />
          <p className="mt-3 text-center text-xs text-slate-400">
            Read-only archive · {WEEK_LABELS[archiveWeek]} · {formatCycleRange(archivePlan.startDate)}
          </p>
        </main>
      </div>
    )
  }

  // ── Current cycle ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <BookOpen size={18} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight text-slate-900">
                4th Grade Team Planner
              </h1>
              <p className="text-xs text-slate-500">{formatCycleRange(plan.startDate)}</p>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Select week"
            className="ml-auto flex rounded-lg bg-slate-100 p-1"
          >
            {WEEKS.map((week) => (
              <button
                key={week}
                role="tab"
                aria-selected={activeWeek === week}
                onClick={() => setActiveWeek(week)}
                className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition ${
                  activeWeek === week
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CalendarDays size={14} aria-hidden="true" />
                {WEEK_LABELS[week]}
              </button>
            ))}
          </div>

          <div
            className="flex w-32 items-center gap-1.5 text-xs font-medium text-slate-500"
            aria-live="polite"
          >
            {saveState === 'pending' && (
              <>
                <CloudUpload size={14} className="text-amber-500" aria-hidden="true" />
                Saving…
              </>
            )}
            {saveState === 'saved' && (
              <>
                <Check size={14} className="text-emerald-500" aria-hidden="true" />
                All changes saved
              </>
            )}
          </div>

          <button
            onClick={() => void handleOpenArchives()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Archive size={14} aria-hidden="true" />
            Archives
          </button>

          <button
            onClick={() => setShowConfirm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            <Plus size={14} aria-hidden="true" />
            New Cycle
          </button>

          <button
            onClick={() => void signOut(auth)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <PlanGrid plan={plan} activeWeek={activeWeek} onChange={handleCellChange} />
        <p className="mt-3 text-center text-xs text-slate-400">
          Edits sync to the whole team in real time · {WEEK_LABELS[activeWeek]} ·{' '}
          {formatCycleRange(plan.startDate)}
        </p>
      </main>

      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-base font-semibold text-slate-900">Start a new cycle?</h2>
            <p className="mb-6 text-sm text-slate-600">
              The current cycle ({formatCycleRange(plan.startDate)}) will be saved to Archives.
              The next cycle will cover{' '}
              <strong>{formatCycleRange(nextCycleStart(plan.startDate))}</strong>.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={cycling}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleStartNewCycle()}
                disabled={cycling}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {cycling && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                Start New Cycle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PlanGrid({
  plan,
  activeWeek,
  readOnly = false,
  onChange,
}: {
  plan: SchedulePlan
  activeWeek: Week
  readOnly?: boolean
  onChange?: (week: Week, day: Day, subject: Subject, value: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="grid min-w-[900px] grid-cols-6">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-3" />
        {DAYS.map((day) => (
          <div
            key={day}
            className="border-b border-l border-slate-200 bg-slate-50 px-3 py-3 text-center"
          >
            <div className="text-sm font-semibold text-slate-700">{day}</div>
            <div className="text-xs font-normal text-slate-400">
              {formatShortDate(getCycleDate(plan.startDate, activeWeek, day))}
            </div>
          </div>
        ))}
        {SUBJECTS.map((subject) => (
          <SubjectRow
            key={subject}
            subject={subject}
            week={activeWeek}
            plan={plan}
            readOnly={readOnly}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  )
}

function SubjectRow({
  subject,
  week,
  plan,
  readOnly = false,
  onChange,
}: {
  subject: Subject
  week: Week
  plan: SchedulePlan
  readOnly?: boolean
  onChange?: (week: Week, day: Day, subject: Subject, value: string) => void
}) {
  return (
    <>
      <div className="flex items-center border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
        {subject}
      </div>
      {DAYS.map((day) => (
        <div key={day} className="border-b border-l border-slate-200 p-1.5">
          {readOnly ? (
            <div className="h-full min-h-[6rem] w-full whitespace-pre-wrap rounded-md p-2 text-sm text-slate-800">
              {plan[week][day][subject] || (
                <span className="text-slate-300">—</span>
              )}
            </div>
          ) : (
            <textarea
              value={plan[week][day][subject]}
              onChange={(e) => onChange?.(week, day, subject, e.target.value)}
              aria-label={`${subject} on ${day}, ${WEEK_LABELS[week]}`}
              placeholder="Lesson notes…"
              rows={4}
              className="h-full w-full resize-none rounded-md border border-transparent bg-transparent p-2 text-sm text-slate-800 placeholder:text-slate-300 transition focus:border-indigo-300 focus:bg-indigo-50/40 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          )}
        </div>
      ))}
    </>
  )
}
