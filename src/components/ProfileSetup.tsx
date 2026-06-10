import { useState } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { USER_COLORS, getInitials, type UserProfile } from '../types'

export default function ProfileSetup({
  onComplete,
}: {
  onComplete: (profile: UserProfile) => void
}) {
  const [name, setName] = useState('')
  const [colorIndex, setColorIndex] = useState(0)
  const [saving, setSaving] = useState(false)

  const initials = getInitials(name) || '??'
  const color = USER_COLORS[colorIndex]

  async function handleSave() {
    const uid = auth.currentUser?.uid
    if (!uid || !name.trim()) return
    setSaving(true)
    const profile: UserProfile = {
      uid,
      name: name.trim(),
      initials: getInitials(name.trim()),
      colorIndex,
    }
    try {
      await setDoc(doc(db, 'users', uid), {
        name: profile.name,
        initials: profile.initials,
        colorIndex: profile.colorIndex,
      })
      onComplete(profile)
    } catch (err) {
      console.error('Failed to save profile:', err)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <p className="mb-1 text-[10px] uppercase tracking-widest text-stone-400">Welcome</p>
        <h2 className="mb-6 text-base font-medium text-stone-900">Set up your profile</h2>

        <div className="mb-5">
          <label className="mb-1.5 block text-xs text-stone-500">Your name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSave() }}
            placeholder="e.g. Jane Smith"
            autoFocus
            className="w-full rounded-lg border border-stone-200 px-3 py-2.5 text-sm text-stone-800 outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-100"
          />
        </div>

        <div className="mb-6">
          <label className="mb-3 block text-xs text-stone-500">Pick your color</label>
          <div className="flex gap-2.5">
            {USER_COLORS.map((c, i) => (
              <button
                key={i}
                onClick={() => setColorIndex(i)}
                aria-label={c.label}
                className={`h-7 w-7 rounded-full transition-all duration-150 ${
                  colorIndex === i ? 'scale-125 ring-2 ring-offset-2 ring-stone-400' : 'hover:scale-110'
                }`}
                style={{ backgroundColor: c.accent }}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
              style={{ backgroundColor: color.bg, color: color.text, border: `1px solid ${color.border}` }}
            >
              {initials}
            </div>
            <span className="text-sm text-stone-600">{name || 'Your name'}</span>
          </div>
        </div>

        <button
          onClick={() => void handleSave()}
          disabled={!name.trim() || saving}
          className="w-full rounded-lg bg-stone-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save & continue'}
        </button>
      </div>
    </div>
  )
}
