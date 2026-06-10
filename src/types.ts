export const WEEKS = ['week1', 'week2'] as const
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const
export const SUBJECTS = ['Math', 'Science', 'Social Studies', 'Reading', 'Writing'] as const

export type Week = (typeof WEEKS)[number]
export type Day = (typeof DAYS)[number]
export type Subject = (typeof SUBJECTS)[number]

// Per-user notes: uid → text
export type SubjectNotes = Record<string, string>
export type DayPlan = Record<Subject, SubjectNotes>
export type WeekPlan = Record<Day, DayPlan>

export interface TodoItem {
  id: string
  text: string
  done: boolean
  userId: string
  createdAt: number
}

// todos[week][day][subject] = TodoItem[]
export type TodosMap = Record<string, Record<string, Record<string, TodoItem[]>>>

export interface SchedulePlan {
  startDate: string
  week1: WeekPlan
  week2: WeekPlan
  todos?: Partial<TodosMap>
}

export interface UserProfile {
  uid: string
  name: string
  initials: string
  colorIndex: number
}

export const USER_COLORS = [
  { label: 'Indigo',  bg: '#eef2ff', text: '#4338ca', border: '#c7d2fe', accent: '#818cf8' },
  { label: 'Rose',    bg: '#fff1f2', text: '#be123c', border: '#fecdd3', accent: '#fb7185' },
  { label: 'Amber',   bg: '#fffbeb', text: '#b45309', border: '#fde68a', accent: '#fbbf24' },
  { label: 'Emerald', bg: '#ecfdf5', text: '#065f46', border: '#a7f3d0', accent: '#34d399' },
  { label: 'Sky',     bg: '#f0f9ff', text: '#0369a1', border: '#bae6fd', accent: '#38bdf8' },
  { label: 'Violet',  bg: '#f5f3ff', text: '#5b21b6', border: '#ddd6fe', accent: '#a78bfa' },
] as const

export const WEEK_LABELS: Record<Week, string> = {
  week1: 'Week 1',
  week2: 'Week 2',
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toISODate(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

export function currentCycleStart(): string {
  const today = new Date()
  const dow = today.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  const monday = new Date(today)
  monday.setDate(today.getDate() + diff)
  return toISODate(monday)
}

export function nextCycleStart(startDate: string): string {
  const d = parseLocalDate(startDate)
  d.setDate(d.getDate() + 14)
  return toISODate(d)
}

export function getCycleDate(startDate: string, week: Week, day: Day): Date {
  const base = parseLocalDate(startDate)
  base.setDate(base.getDate() + (week === 'week2' ? 7 : 0) + DAYS.indexOf(day))
  return base
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatCycleRange(startDate: string): string {
  const start = parseLocalDate(startDate)
  const end = new Date(start)
  end.setDate(end.getDate() + 13)
  return `${formatShortDate(start)} – ${formatShortDate(end)}, ${end.getFullYear()}`
}

export function formatWeekRange(startDate: string, week: Week): string {
  const s = getCycleDate(startDate, week, 'Monday')
  const e = getCycleDate(startDate, week, 'Friday')
  return `${formatShortDate(s)} – ${formatShortDate(e)}`
}

export function formatFullDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

export function createEmptyPlan(startDate?: string): SchedulePlan {
  const emptyDay = (): DayPlan =>
    Object.fromEntries(SUBJECTS.map((s) => [s, {} as SubjectNotes])) as DayPlan
  const emptyWeek = (): WeekPlan =>
    Object.fromEntries(DAYS.map((d) => [d, emptyDay()])) as WeekPlan
  return {
    startDate: startDate ?? currentCycleStart(),
    week1: emptyWeek(),
    week2: emptyWeek(),
    todos: {},
  }
}
