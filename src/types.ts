export const WEEKS = ['week1', 'week2'] as const
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const
export const SUBJECTS = ['Math', 'Science', 'Social Studies', 'Reading', 'Writing'] as const

export type Week = (typeof WEEKS)[number]
export type Day = (typeof DAYS)[number]
export type Subject = (typeof SUBJECTS)[number]

export type DayPlan = Record<Subject, string>
export type WeekPlan = Record<Day, DayPlan>

export interface SchedulePlan {
  startDate: string // ISO "YYYY-MM-DD" of the Monday that starts week 1
  week1: WeekPlan
  week2: WeekPlan
}

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

/** Monday of the current week. */
export function currentCycleStart(): string {
  const today = new Date()
  const dow = today.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  const monday = new Date(today)
  monday.setDate(today.getDate() + diff)
  return toISODate(monday)
}

/** Monday 14 days after a given cycle start. */
export function nextCycleStart(startDate: string): string {
  const d = parseLocalDate(startDate)
  d.setDate(d.getDate() + 14)
  return toISODate(d)
}

/** Calendar date for a given week/day within a cycle. */
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

export function createEmptyPlan(startDate?: string): SchedulePlan {
  const emptyDay = (): DayPlan =>
    Object.fromEntries(SUBJECTS.map((s) => [s, ''])) as DayPlan
  const emptyWeek = (): WeekPlan =>
    Object.fromEntries(DAYS.map((d) => [d, emptyDay()])) as WeekPlan
  return {
    startDate: startDate ?? currentCycleStart(),
    week1: emptyWeek(),
    week2: emptyWeek(),
  }
}
