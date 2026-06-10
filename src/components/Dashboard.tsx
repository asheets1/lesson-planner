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
  updateDoc,
} from 'firebase/firestore'
import {
  Archive,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  CirclePlus,
  CloudUpload,
  ListTodo,
  Loader2,
  LogOut,
  Trash2,
} from 'lucide-react'
import { auth, db } from '../firebase'
import ProfileSetup from './ProfileSetup'
import {
  DAYS,
  SUBJECTS,
  WEEKS,
  WEEK_LABELS,
  USER_COLORS,
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
  type SubjectNotes,
  type TodoItem,
  type UserProfile,
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
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>({})
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [openTodosSubject, setOpenTodosSubject] = useState<Subject | null>(null)

  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const pendingRef = useRef(new Map<string, string>())
  const inFlightRef = useRef(0)

  // Load current user's profile and all user profiles
  useEffect(() => {
    const uid = auth.currentUser?.uid
    if (!uid) { setProfileLoading(false); return }

    void getDoc(doc(db, 'users', uid)).then((snap) => {
      if (snap.exists()) {
        setMyProfile({ uid, ...(snap.data() as Omit<UserProfile, 'uid'>) })
      }
      setProfileLoading(false)
    })

    void getDocs(collection(db, 'users')).then((snap) => {
      const profiles: Record<string, UserProfile> = {}
      snap.docs.forEach((d) => {
        profiles[d.id] = { uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }
      })
      setUserProfiles(profiles)
    })
  }, [])

  // Real-time plan subscription
  useEffect(() => {
    const unsubscribe = onSnapshot(
      planDoc(),
      (snapshot) => {
        if (!snapshot.exists()) {
          void setDoc(planDoc(), createEmptyPlan())
          return
        }
        const raw = snapshot.data()
        const startDate =
          typeof raw.startDate === 'string' ? raw.startDate : currentCycleStart()

        if (!raw.startDate) {
          void updateDoc(planDoc(), { startDate })
        }

        const uid = auth.currentUser?.uid ?? ''

        setPlan(() => {
          const next = createEmptyPlan(startDate)
          for (const week of WEEKS) {
            for (const day of DAYS) {
              for (const subject of SUBJECTS) {
                const cell = raw?.[week]?.[day]?.[subject]
                if (typeof cell === 'string') {
                  // Migrate legacy single-string format
                  next[week][day][subject] = cell ? { legacy: cell } : {}
                } else if (cell && typeof cell === 'object') {
                  next[week][day][subject] = { ...(cell as SubjectNotes) }
                }
                // Overlay current user's in-flight edit
                const key = cellKey(week, day, subject)
                const pending = pendingRef.current.get(key)
                if (uid && pending !== undefined) {
                  next[week][day][subject] = { ...next[week][day][subject], [uid]: pending }
                }
              }
            }
          }
          next.todos = (raw.todos as SchedulePlan['todos']) ?? {}
          return next
        })
      },
      (err) => console.error('Firestore subscription failed:', err),
    )
    return unsubscribe
  }, [])

  const flushCell = useCallback(
    async (week: Week, day: Day, subject: Subject, value: string) => {
      const uid = auth.currentUser?.uid
      if (!uid) return
      const key = cellKey(week, day, subject)
      inFlightRef.current += 1
      setSaveState('pending')
      try {
        await updateDoc(planDoc(), { [`${week}.${day}.${subject}.${uid}`]: value })
        if (pendingRef.current.get(key) === value) pendingRef.current.delete(key)
      } catch (err) {
        console.error('Failed to save note:', err)
      } finally {
        inFlightRef.current -= 1
        if (inFlightRef.current === 0 && timersRef.current.size === 0) setSaveState('saved')
      }
    },
    [],
  )

  const handleCellChange = useCallback(
    (week: Week, day: Day, subject: Subject, value: string) => {
      const uid = auth.currentUser?.uid
      if (!uid) return
      setPlan((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          [week]: {
            ...prev[week],
            [day]: {
              ...prev[week][day],
              [subject]: { ...prev[week][day][subject], [uid]: value },
            },
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

  async function handleAddTodo(week: Week, day: Day, subject: Subject, text: string) {
    if (!text.trim() || !plan) return
    const uid = auth.currentUser?.uid
    if (!uid) return
    const newItem: TodoItem = {
      id: crypto.randomUUID(),
      text: text.trim(),
      done: false,
      userId: uid,
      createdAt: Date.now(),
    }
    const path = `todos.${week}.${day}.${subject}`
    const existing = plan.todos?.[week]?.[day]?.[subject] ?? []
    await updateDoc(planDoc(), { [path]: [...existing, newItem] })
  }

  async function handleToggleTodo(week: Week, day: Day, subject: Subject, id: string) {
    if (!plan) return
    const path = `todos.${week}.${day}.${subject}`
    const existing = plan.todos?.[week]?.[day]?.[subject] ?? []
    await updateDoc(planDoc(), {
      [path]: existing.map((item) => item.id === id ? { ...item, done: !item.done } : item),
    })
  }

  async function handleDeleteTodo(week: Week, day: Day, subject: Subject, id: string) {
    if (!plan) return
    const path = `todos.${week}.${day}.${subject}`
    const existing = plan.todos?.[week]?.[day]?.[subject] ?? []
    await updateDoc(planDoc(), { [path]: existing.filter((item) => item.id !== id) })
  }

  function handleWeekChange(week: Week) {
    setActiveWeek(week)
    setOpenTodosSubject(null)
  }

  function handleDayChange(day: Day) {
    setActiveDay(day)
    setOpenTodosSubject(null)
  }

  function handleProfileComplete(profile: UserProfile) {
    setMyProfile(profile)
    setUserProfiles((prev) => ({ ...prev, [profile.uid]: profile }))
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (!plan || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="flex items-center gap-3 text-stone-400">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm tracking-wide">Loading…</span>
        </div>
      </div>
    )
  }

  const myUid = auth.currentUser?.uid ?? ''

  // ── Profile setup (first login) ───────────────────────────────────────────
  const needsProfile = !myProfile

  // ── Archive list ──────────────────────────────────────────────────────────
  if (view.type === 'archive-list') {
    return (
      <div className="min-h-screen bg-stone-50">
        {needsProfile && <ProfileSetup onComplete={handleProfileComplete} />}
        <AppHeader plan={plan} saveState={saveState}
          onArchives={() => void handleOpenArchives()}
          onNewCycle={() => setShowConfirm(true)}
          onSignOut={() => void signOut(auth)} />
        <main className="mx-auto max-w-xl px-6 py-10">
          <button onClick={() => setView({ type: 'current' })}
            className="mb-8 flex items-center gap-2 text-xs uppercase tracking-widest text-stone-400 hover:text-stone-700 transition-colors">
            <ArrowLeft size={14} /> Back to planner
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
                  <button onClick={() => void handleViewArchive(item)}
                    className="flex w-full items-center justify-between py-4 text-sm text-stone-700 hover:text-stone-900 transition-colors group">
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
        {needsProfile && <ProfileSetup onComplete={handleProfileComplete} />}
        <AppHeader plan={plan} saveState={saveState}
          onArchives={() => void handleOpenArchives()}
          onNewCycle={() => setShowConfirm(true)}
          onSignOut={() => void signOut(auth)} />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <button onClick={() => void handleOpenArchives()}
            className="mb-8 flex items-center gap-2 text-xs uppercase tracking-widest text-stone-400 hover:text-stone-700 transition-colors">
            <ArrowLeft size={14} /> Archives
          </button>
          <div className="mb-1 flex items-center gap-2">
            <Archive size={13} className="text-stone-400" />
            <span className="text-xs uppercase tracking-widest text-stone-400">Archived cycle</span>
          </div>
          <p className="mb-8 text-lg font-light text-stone-800">{formatCycleRange(ap.startDate)}</p>
          <PlannerView
            plan={ap} activeWeek={archiveWeek} activeDay={archiveDay}
            openTodosSubject={null} myUid={myUid} userProfiles={userProfiles}
            readOnly
            onWeekChange={setArchiveWeek} onDayChange={setArchiveDay}
            onToggleTodosSubject={() => {}}
            onCellChange={() => {}}
            onAddTodo={() => Promise.resolve()}
            onToggleTodo={() => Promise.resolve()}
            onDeleteTodo={() => Promise.resolve()}
          />
        </main>
      </div>
    )
  }

  // ── Current planner ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-50">
      {needsProfile && <ProfileSetup onComplete={handleProfileComplete} />}

      <AppHeader plan={plan} saveState={saveState}
        onArchives={() => void handleOpenArchives()}
        onNewCycle={() => setShowConfirm(true)}
        onSignOut={() => void signOut(auth)} />

      <main className="mx-auto max-w-2xl px-6 py-10">
        <PlannerView
          plan={plan} activeWeek={activeWeek} activeDay={activeDay}
          openTodosSubject={openTodosSubject} myUid={myUid} userProfiles={userProfiles}
          onWeekChange={handleWeekChange} onDayChange={handleDayChange}
          onToggleTodosSubject={(s) => setOpenTodosSubject((prev) => prev === s ? null : s)}
          onCellChange={handleCellChange}
          onAddTodo={(s, t) => handleAddTodo(activeWeek, activeDay, s, t)}
          onToggleTodo={(s, id) => handleToggleTodo(activeWeek, activeDay, s, id)}
          onDeleteTodo={(s, id) => handleDeleteTodo(activeWeek, activeDay, s, id)}
        />
      </main>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4 backdrop-blur-sm"
          role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
            <p className="mb-1 text-[10px] uppercase tracking-widest text-stone-400">New cycle</p>
            <h2 className="mb-4 text-base font-medium text-stone-900">Archive this cycle?</h2>
            <p className="mb-8 text-sm leading-relaxed text-stone-500">
              {formatCycleRange(plan.startDate)} will be saved to Archives. The next cycle will
              cover <span className="text-stone-800">{formatCycleRange(nextCycleStart(plan.startDate))}</span>.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowConfirm(false)} disabled={cycling}
                className="rounded-lg px-4 py-2 text-sm text-stone-500 hover:text-stone-900 transition-colors disabled:opacity-40">
                Cancel
              </button>
              <button onClick={() => void handleStartNewCycle()} disabled={cycling}
                className="flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 transition-colors disabled:opacity-40">
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

// ── App header ────────────────────────────────────────────────────────────────

function AppHeader({ plan, saveState, onArchives, onNewCycle, onSignOut }: {
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
            <Archive size={13} /> Archives
          </button>
          <button onClick={onNewCycle} className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-700 transition-colors">
            New cycle <ChevronRight size={13} />
          </button>
          <button onClick={onSignOut} className="text-stone-300 hover:text-stone-600 transition-colors">
            <LogOut size={14} aria-label="Sign out" />
          </button>
        </div>
      </div>
    </header>
  )
}

// ── Planner view ──────────────────────────────────────────────────────────────

function PlannerView({
  plan, activeWeek, activeDay, openTodosSubject,
  myUid, userProfiles, readOnly = false,
  onWeekChange, onDayChange, onToggleTodosSubject,
  onCellChange, onAddTodo, onToggleTodo, onDeleteTodo,
}: {
  plan: SchedulePlan
  activeWeek: Week
  activeDay: Day
  openTodosSubject: Subject | null
  myUid: string
  userProfiles: Record<string, UserProfile>
  readOnly?: boolean
  onWeekChange: (w: Week) => void
  onDayChange: (d: Day) => void
  onToggleTodosSubject: (s: Subject) => void
  onCellChange: (week: Week, day: Day, subject: Subject, value: string) => void
  onAddTodo: (subject: Subject, text: string) => Promise<void>
  onToggleTodo: (subject: Subject, id: string) => Promise<void>
  onDeleteTodo: (subject: Subject, id: string) => Promise<void>
}) {
  return (
    <div>
      {/* Week selector */}
      <div className="mb-6 flex gap-1 rounded-xl bg-stone-100 p-1">
        {WEEKS.map((week) => (
          <button key={week} onClick={() => onWeekChange(week)}
            className={`flex-1 rounded-lg py-2 text-xs font-medium transition-all ${
              activeWeek === week ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-400 hover:text-stone-600'
            }`}>
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
            <button key={day} onClick={() => onDayChange(day)}
              className={`flex flex-1 flex-col items-center rounded-xl py-3 transition-all duration-150 ${
                isActive ? 'bg-white shadow-md ring-1 ring-stone-100' : 'hover:bg-white/60'
              }`}>
              <span className={`mb-1 text-[10px] tracking-widest font-medium transition-colors ${
                isActive ? 'text-stone-400' : 'text-stone-300'}`}>
                {DAY_ABBR[day]}
              </span>
              <span className={`text-xl font-light leading-none transition-colors ${
                isActive ? 'text-stone-900' : 'text-stone-400'}`}>
                {date.getDate()}
              </span>
              <span className={`mt-1 text-[10px] transition-colors ${
                isActive ? 'text-stone-400' : 'text-stone-300'}`}>
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
          <p className="text-[10px] uppercase tracking-widest text-stone-400">{DAY_ABBR[activeDay]}</p>
          <p className="mt-0.5 text-sm font-light text-stone-500">
            {formatFullDate(getCycleDate(plan.startDate, activeWeek, activeDay))}
          </p>
        </div>

        {/* Subject sections */}
        {SUBJECTS.map((subject) => (
          <SubjectSection
            key={subject}
            subject={subject}
            week={activeWeek}
            day={activeDay}
            plan={plan}
            myUid={myUid}
            userProfiles={userProfiles}
            readOnly={readOnly}
            todosOpen={openTodosSubject === subject}
            onToggleTodos={() => onToggleTodosSubject(subject)}
            onCellChange={(value) => onCellChange(activeWeek, activeDay, subject, value)}
            onAddTodo={(text) => onAddTodo(subject, text)}
            onToggleTodo={(id) => onToggleTodo(subject, id)}
            onDeleteTodo={(id) => onDeleteTodo(subject, id)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Subject section ───────────────────────────────────────────────────────────

function SubjectSection({
  subject, week, day, plan, myUid, userProfiles,
  readOnly, todosOpen,
  onToggleTodos, onCellChange, onAddTodo, onToggleTodo, onDeleteTodo,
}: {
  subject: Subject
  week: Week
  day: Day
  plan: SchedulePlan
  myUid: string
  userProfiles: Record<string, UserProfile>
  readOnly: boolean
  todosOpen: boolean
  onToggleTodos: () => void
  onCellChange: (value: string) => void
  onAddTodo: (text: string) => Promise<void>
  onToggleTodo: (id: string) => Promise<void>
  onDeleteTodo: (id: string) => Promise<void>
}) {
  const notes = plan[week][day][subject] ?? {}
  const todos = plan.todos?.[week]?.[day]?.[subject] ?? []
  const pendingTodos = todos.filter((t) => !t.done).length

  const myNoteValue = notes[myUid] ?? ''
  const otherEntries = Object.entries(notes).filter(
    ([uid, text]) => uid !== myUid && uid !== 'legacy' && text,
  )
  const legacyNote = notes['legacy']

  return (
    <div className="border-t border-stone-100">
      {/* Clickable subject header */}
      <button
        onClick={onToggleTodos}
        className="flex w-full items-center justify-between px-8 py-4 transition-colors hover:bg-stone-50"
      >
        <span className="text-[10px] uppercase tracking-widest text-stone-400">{subject}</span>
        <div className="flex items-center gap-2">
          {pendingTodos > 0 && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-500">
              {pendingTodos} open
            </span>
          )}
          <ListTodo
            size={13}
            className={todosOpen ? 'text-stone-600' : 'text-stone-300'}
          />
        </div>
      </button>

      {/* Notes */}
      <div className="px-8 pb-6">
        {/* Current user (always editable unless readOnly) */}
        {!readOnly && myUid && (
          <UserNoteBlock
            uid={myUid}
            profile={userProfiles[myUid]}
            value={myNoteValue}
            editable
            onChange={onCellChange}
          />
        )}

        {/* Other users' notes (read-only, non-empty) */}
        {otherEntries.map(([uid, text]) => (
          <UserNoteBlock
            key={uid}
            uid={uid}
            profile={userProfiles[uid]}
            value={text}
            editable={false}
          />
        ))}

        {/* Legacy migration notes */}
        {legacyNote && (
          <div className="mt-2 rounded-lg bg-stone-50 p-3">
            <p className="mb-1 text-[10px] uppercase tracking-widest text-stone-400">Previous notes</p>
            <p className="text-sm leading-6 text-stone-500">{legacyNote}</p>
          </div>
        )}

        {/* Archive read-only: show all users */}
        {readOnly && (
          <>
            {Object.entries(notes)
              .filter(([, text]) => text)
              .map(([uid, text]) => (
                <UserNoteBlock
                  key={uid}
                  uid={uid}
                  profile={userProfiles[uid]}
                  value={text}
                  editable={false}
                />
              ))}
            {Object.values(notes).every((t) => !t) && (
              <div className="min-h-[88px]" />
            )}
          </>
        )}
      </div>

      {/* Todo panel */}
      {todosOpen && (
        <TodoPanel
          todos={todos}
          userProfiles={userProfiles}
          readOnly={readOnly}
          onAdd={onAddTodo}
          onToggle={onToggleTodo}
          onDelete={onDeleteTodo}
        />
      )}
    </div>
  )
}

// ── User note block ───────────────────────────────────────────────────────────

function UserNoteBlock({ uid, profile, value, editable, onChange }: {
  uid: string
  profile?: UserProfile
  value: string
  editable: boolean
  onChange?: (val: string) => void
}) {
  const color = profile ? USER_COLORS[profile.colorIndex] : null
  const initials = profile?.initials ?? (uid === 'legacy' ? '?' : uid.slice(0, 2).toUpperCase())
  const name = profile?.name ?? (uid === 'legacy' ? 'Previous' : 'Team member')

  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-2 flex items-center gap-2">
        <div
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
          style={
            color
              ? { backgroundColor: color.bg, color: color.text, border: `1px solid ${color.border}` }
              : { backgroundColor: '#f5f5f4', color: '#78716c', border: '1px solid #e7e5e4' }
          }
        >
          {initials}
        </div>
        <span className="text-xs text-stone-400">{name}</span>
      </div>

      {editable ? (
        <textarea
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
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
      ) : (
        <div
          className="min-h-[28px] text-sm leading-7 text-stone-600"
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {value}
        </div>
      )}
    </div>
  )
}

// ── Todo panel ────────────────────────────────────────────────────────────────

function TodoPanel({ todos, userProfiles, readOnly, onAdd, onToggle, onDelete }: {
  todos: TodoItem[]
  userProfiles: Record<string, UserProfile>
  readOnly: boolean
  onAdd: (text: string) => Promise<void>
  onToggle: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [newText, setNewText] = useState('')

  function handleAdd() {
    if (!newText.trim()) return
    void onAdd(newText.trim())
    setNewText('')
  }

  return (
    <div className="border-t border-stone-100 bg-stone-50/60 px-8 py-5">
      <p className="mb-4 text-[10px] uppercase tracking-widest text-stone-400">To-do list</p>

      {todos.length === 0 && (
        <p className="mb-4 text-xs text-stone-300">No items yet — add one below.</p>
      )}

      <ul className="mb-4 space-y-2.5">
        {todos.map((item) => {
          const profile = userProfiles[item.userId]
          const color = profile ? USER_COLORS[profile.colorIndex] : null
          const initials = profile?.initials ?? '?'

          return (
            <li key={item.id} className="group flex items-start gap-3">
              <button
                onClick={() => void onToggle(item.id)}
                disabled={readOnly}
                className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                  item.done
                    ? 'border-transparent bg-stone-800 text-white'
                    : 'border-stone-300 hover:border-stone-600'
                } disabled:cursor-default`}
              >
                {item.done && <Check size={9} />}
              </button>

              <span
                className={`flex-1 text-sm leading-snug transition-colors ${
                  item.done ? 'text-stone-300 line-through' : 'text-stone-700'
                }`}
              >
                {item.text}
              </span>

              {/* User indicator */}
              <div
                className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-semibold"
                style={
                  color
                    ? { backgroundColor: color.bg, color: color.text, border: `1px solid ${color.border}` }
                    : { backgroundColor: '#f5f5f4', color: '#78716c' }
                }
                title={profile?.name ?? 'Unknown'}
              >
                {initials}
              </div>

              {!readOnly && (
                <button
                  onClick={() => void onDelete(item.id)}
                  className="mt-0.5 hidden text-stone-300 transition-colors hover:text-red-400 group-hover:block"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {!readOnly && (
        <div className="flex items-center gap-2 border-t border-stone-100 pt-4">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            placeholder="Add item…"
            className="flex-1 bg-transparent text-sm text-stone-700 outline-none placeholder:text-stone-300"
          />
          <button
            onClick={handleAdd}
            disabled={!newText.trim()}
            className="text-stone-400 transition-colors hover:text-stone-700 disabled:opacity-30"
          >
            <CirclePlus size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
