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
  Check,
  ChevronRight,
  CloudUpload,
  Loader2,
  LogOut,
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
  formatFullDate,
  formatWeekRange,
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

const DAY_ABBR: Record<Day, string> = {
  Monday: 'MON', Tuesday: 'TUE', Wednesday: 'WED', Thursday: 'THU', Friday: 'FRI',
}

function getInitialDay(): Day {
  const dow = new Date().getDay()
  return dow >= 1 && dow <= 5 ? DAYS[dow - 1] : 'Monday'
}

export default function Dashboard() {
  const [plan, setPlan] = useState<SchedulePlan | null>(null)
  const [activeWeek, setActiveWeek] = useState<Week>('week1')
  const [activeDay, setActiveDay] = useState<Day>(getInitialDay())
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [view, setView] = useState<View>({ type: 'current' })
  const [showConfirm, setShowConfirm] = useState(false)
  const [cycling, setCycling] = useState(false)
  const [archiveWeek, setArchiveWeek] = useState<Week>('week1')
  const [archiveDay, setArchiveDay] = useState<Day>('Monday')

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
        await setDoc(planDoc(), { [week]: { [day]: { [subject]: value } } }, { merge: true })
        if (pendingRef.current.get(key) === value) pendingRef.current.delete(key)
      } catch (err) {
        console.error('Failed to save lesson note:', err)
      } finally {
        inFlightRef.current -= 1
        if (inFlightRef.current === 0 && timersRef.current.size === 0) setSaveState('saved')
      }
    },
    [],
  )

  const handleCellChange = useCallback(
    (week: Week, day: Day, subject: Subject, value: string) => {
      setPlan((prev) => {
        if (!prev) return prev
        return { ...prev, [week]: { ...prev[week], [day]: { ...prev[week][day], [subject]: value } } }
      })
      const key = cellKey(week, day, subject)
      pendingRef.current.set(key, value)
      setSaveState('pending')
      const existing = timersRef.current.get(key)
      if (existing) clearTimeout(existing)
      timersRef.current.set(key, setTimeout(() => {
        timersRef.current.delete(key)
        void flushCell(week, day, subject, value)
      }, DEBOUNCE_MS))
    },
    [flushCell],
  )

  useEffect(() => {
    const timers = timersRef.current
    return () => { for (const t of timers.values()) clearTimeout(t) }
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
      setView({ type: 'archive-list', items: snap.docs.map((d) => ({ id: d.id, startDate: d.id })) })
    } catch (err) {
      console.error('Failed to load archives:', err)
      setView({ type: 'archive-list', items: [] })
    }
  }

  async function handleViewArchive(item: ArchiveItem) {
    try {
      const snap = await getDoc(cycleDoc(item.id))
      if (snap.exists()) setView({ type: 'archive-detail', plan: snap.data() as SchedulePlan })
    } catch (err) {
      console.error('Failed to load archive:', err)
    }
  }

  if (!plan) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="flex items-center gap-3 text-stone-400">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm tracking-wide">Loading…</span>
        </div>
      </div>
    )
  }

  // ── Archive list ──────────────────────────────────────────────────────────
  if (view.type === 'archive-list') {
    return (
      <div className="min-h-screen bg-stone-50">
        <AppHeader
          plan={plan}
          saveState={saveState}
          onArchives={() => void handleOpenArchives()}
          onNewCycle={() => setShowConfirm(true)}
          onSignOut={() => void signOut(auth)}
        />
        <main className="mx-auto max-w-xl px-6 py-10">
          <button
            onClick={() => setView({ type: 'current' })}
            className="mb-8 flex items-center gap-2 text-xs uppercase tracking-widest text-stone-400 hover:text-stone-700 transition-colors"
          >
            <ArrowLeft size={14} />
            Back to planner
          </button>
          <h2 className="mb-6 text-xs uppercase tracking-widest text-stone-400">Past cycles</h2>
          {view.items === null ? (
            <div className="flex justify-center py-16">
              <Loader2 size={18} className="animate-spin text-stone-300" />
            </div>
          ) : view.items.length === 0 ? (
            <p className="text-sm text-stone-400">No archived cycles yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {view.items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => void handleViewArchive(item)}
                    className="flex w-full items-center justify-between py-4 text-left text-sm text-stone-700 hover:text-stone-900 transition-colors group"
                  >
                    <span>{formatCycleRange(item.startDate)}</span>
                    <ChevronRight size={14} className="text-stone-300 group-hover:text-stone-500 transition-colors" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    )
  }

  // ── Archive detail ────────────────────────────────────────────────────────
  if (view.type === 'archive-detail') {
    const ap = view.plan
    return (
      <div className="min-h-screen bg-stone-50">
        <AppHeader
          plan={plan}
          saveState={saveState}
          onArchives={() => void handleOpenArchives()}
          onNewCycle={() => setShowConfirm(true)}
          onSignOut={() => void signOut(auth)}
        />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <button
            onClick={() => void handleOpenArchives()}
            className="mb-8 flex items-center gap-2 text-xs uppercase tracking-widest text-stone-400 hover:text-stone-700 transition-colors"
          >
            <ArrowLeft size={14} />
            Archives
          </button>
          <div className="mb-1 flex items-center gap-2">
            <Archive size={13} className="text-stone-400" />
            <span className="text-xs uppercase tracking-widest text-stone-400">Archived cycle</span>
          </div>
          <p className="mb-8 text-lg font-light text-stone-800">{formatCycleRange(ap.startDate)}</p>
          <PlannerView
            plan={ap}
            activeWeek={archiveWeek}
            activeDay={archiveDay}
            readOnly
            onWeekChange={setArchiveWeek}
            onDayChange={setArchiveDay}
          />
        </main>
      </div>
    )
  }

  // ── Current planner ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-50">
      <AppHeader
        plan={plan}
        saveState={saveState}
        onArchives={() => void handleOpenArchives()}
        onNewCycle={() => setShowConfirm(true)}
        onSignOut={() => void signOut(auth)}
      />

      <main className="mx-auto max-w-2xl px-6 py-10">
        <PlannerView
          plan={plan}
          activeWeek={activeWeek}
          activeDay={activeDay}
          onWeekChange={setActiveWeek}
          onDayChange={setActiveDay}
          onChange={handleCellChange}
        />
      </main>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
            <p className="mb-1 text-xs uppercase tracking-widest text-stone-400">New cycle</p>
            <h2 className="mb-4 text-base font-medium text-stone-900">Archive this cycle?</h2>
            <p className="mb-8 text-sm leading-relaxed text-stone-500">
              {formatCycleRange(plan.startDate)} will be saved to Archives.
              The next cycle will cover <span className="text-stone-800">{formatCycleRange(nextCycleStart(plan.startDate))}</span>.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={cycling}
                className="rounded-lg px-4 py-2 text-sm text-stone-500 hover:text-stone-900 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleStartNewCycle()}
                disabled={cycling}
                className="flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 transition-colors disabled:opacity-40"
              >
                {cycling && <Loader2 size={14} className="animate-spin" />}
                Start new cycle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Shared header ─────────────────────────────────────────────────────────────

function AppHeader({
  plan,
  saveState,
  onArchives,
  onNewCycle,
  onSignOut,
}: {
  plan: SchedulePlan
  saveState: SaveState
  onArchives: () => void
  onNewCycle: () => void
  onSignOut: () => void
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-stone-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-4 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <BookOpen size={15} className="text-stone-400" aria-hidden="true" />
          <span className="text-sm font-medium text-stone-800">4th Grade Team Planner</span>
          <span className="text-stone-200">·</span>
          <span className="text-xs text-stone-400">{formatCycleRange(plan.startDate)}</span>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-stone-400" aria-live="polite">
            {saveState === 'pending' && <><CloudUpload size={12} className="text-amber-400" />Saving</>}
            {saveState === 'saved' && <><Check size={12} className="text-emerald-400" />Saved</>}
          </div>

          <button onClick={onArchives} className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-700 transition-colors">
            <Archive size={13} />
            Archives
          </button>

          <button onClick={onNewCycle} className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-700 transition-colors">
            New cycle
            <ChevronRight size={13} />
          </button>

          <button onClick={onSignOut} className="text-stone-300 hover:text-stone-600 transition-colors">
            <LogOut size={14} aria-label="Sign out" />
          </button>
        </div>
      </div>
    </header>
  )
}

// ── Planner view (week selector + day strip + day page) ───────────────────────

function PlannerView({
  plan,
  activeWeek,
  activeDay,
  readOnly = false,
  onWeekChange,
  onDayChange,
  onChange,
}: {
  plan: SchedulePlan
  activeWeek: Week
  activeDay: Day
  readOnly?: boolean
  onWeekChange: (w: Week) => void
  onDayChange: (d: Day) => void
  onChange?: (week: Week, day: Day, subject: Subject, value: string) => void
}) {
  return (
    <div>
      {/* Week selector */}
      <div className="mb-6 flex gap-1 rounded-xl bg-stone-100 p-1">
        {WEEKS.map((week) => (
          <button
            key={week}
            onClick={() => onWeekChange(week)}
            className={`flex-1 rounded-lg py-2 text-xs font-medium transition-all ${
              activeWeek === week
                ? 'bg-white text-stone-900 shadow-sm'
                : 'text-stone-400 hover:text-stone-600'
            }`}
          >
            {WEEK_LABELS[week]}
            <span className={`ml-2 font-normal ${activeWeek === week ? 'text-stone-500' : 'text-stone-300'}`}>
              {plan.startDate ? formatWeekRange(plan.startDate, week) : ''}
            </span>
          </button>
        ))}
      </div>

      {/* Day strip */}
      <div className="mb-6 flex gap-2">
        {DAYS.map((day) => {
          const date = getCycleDate(plan.startDate, activeWeek, day)
          const isActive = activeDay === day
          return (
            <button
              key={day}
              onClick={() => onDayChange(day)}
              className={`flex flex-1 flex-col items-center rounded-xl py-3 transition-all duration-150 ${
                isActive
                  ? 'bg-white shadow-md ring-1 ring-stone-100'
                  : 'hover:bg-white/60'
              }`}
            >
              <span className={`mb-1 text-[10px] tracking-widest font-medium transition-colors ${
                isActive ? 'text-stone-400' : 'text-stone-300'
              }`}>
                {DAY_ABBR[day]}
              </span>
              <span className={`text-xl font-light leading-none transition-colors ${
                isActive ? 'text-stone-900' : 'text-stone-400'
              }`}>
                {date.getDate()}
              </span>
              <span className={`mt-1 text-[10px] transition-colors ${
                isActive ? 'text-stone-400' : 'text-stone-300'
              }`}>
                {date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
              </span>
            </button>
          )
        })}
      </div>

      {/* Planner page */}
      <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
        {/* Page header */}
        <div className="border-b border-stone-100 px-8 py-5">
          <p className="text-[10px] uppercase tracking-widest text-stone-400">
            {DAY_ABBR[activeDay]}
          </p>
          <p className="mt-0.5 text-sm font-light text-stone-500">
            {formatFullDate(getCycleDate(plan.startDate, activeWeek, activeDay))}
          </p>
        </div>

        {/* Subject sections */}
        {SUBJECTS.map((subject, i) => (
          <div key={subject} className={i > 0 ? 'border-t border-stone-100' : ''}>
            <div className="px-8 py-5">
              <p className="mb-3 text-[10px] uppercase tracking-widest text-stone-400">{subject}</p>
              {readOnly ? (
                <div className="min-h-[88px] whitespace-pre-wrap text-sm leading-7 text-stone-700">
                  {plan[activeWeek][activeDay][subject] || (
                    <span className="text-stone-200">—</span>
                  )}
                </div>
              ) : (
                <textarea
                  value={plan[activeWeek][activeDay][subject]}
                  onChange={(e) => onChange?.(activeWeek, activeDay, subject, e.target.value)}
                  aria-label={`${subject} on ${activeDay}`}
                  placeholder="Add lesson notes…"
                  rows={4}
                  className="w-full resize-none bg-transparent text-sm leading-7 text-stone-800 outline-none placeholder:text-stone-200"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(transparent, transparent 27px, #f1f5f9 27px, #f1f5f9 28px)',
                    lineHeight: '28px',
                    paddingTop: '2px',
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

