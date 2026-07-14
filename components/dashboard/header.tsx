'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { Search, Bell, Moon, Sun, CalendarDays, ChevronDown } from 'lucide-react'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':     'Overview',
  '/polls':         'Poll Requests',
  '/feedback':      'Feedback',
  '/participation': 'Participation',
  '/cadence':       'Poll Cadence',
  '/reports':       'Reports',
  '/archived':      'Archived',
  '/settings':      'Settings',
}

const QUARTER_DEFS = [
  { q: 1, months: [0,1,2],   label: 'Jan – Mar' },
  { q: 2, months: [3,4,5],   label: 'Apr – Jun' },
  { q: 3, months: [6,7,8],   label: 'Jul – Sep' },
  { q: 4, months: [9,10,11], label: 'Oct – Dec' },
]

interface Quarter { key: string; label: string; isCurrent: boolean }

// Anchored to the app's launch quarter (2026-Q2). Bounded at 40 iterations
// (10 years) as a hard safety net — the loop used to run unconditionally
// forward until it matched the current quarter, which never terminates if
// the system clock is ever before the anchor (misconfigured clock, a
// staging/replay environment, etc.).
function buildQuarters(): Quarter[] {
  const now = new Date()
  const curQ = Math.floor(now.getMonth() / 3) + 1
  const curY = now.getFullYear()
  const list: Quarter[] = []
  let y = 2026, q = 2
  for (let i = 0; i < 40; i++) {
    const def = QUARTER_DEFS[q - 1]
    list.push({ key: `${y}-Q${q}`, label: `${def.label} ${y}`, isCurrent: y === curY && q === curQ })
    if (y === curY && q === curQ) break
    q++; if (q > 4) { q = 1; y++ }
  }
  return list.reverse()
}

function currentQuarterKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
}

function keyToLabel(key: string): string {
  if (key === 'all') return 'All Time'
  const [yearStr, qStr] = key.split('-Q')
  const def = QUARTER_DEFS[parseInt(qStr) - 1]
  return def ? `${def.label} ${yearStr}` : key
}

export function Header({ title = 'Polls Dashboard' }: { userName?: string; userRole?: string; title?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const [dark, setDark] = useState(true)
  const [quarters] = useState<Quarter[]>(() => buildQuarters())
  const [selectedQuarter, setSelectedQuarter] = useState<string>(() => currentQuarterKey())
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('theme')
    setDark(saved === null ? true : saved === 'dark')
    const stored = localStorage.getItem('selectedQuarter')
    if (stored) setSelectedQuarter(stored)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selectQuarter = (key: string) => {
    setSelectedQuarter(key)
    localStorage.setItem('selectedQuarter', key)
    window.dispatchEvent(new CustomEvent('quarterchange', { detail: { key } }))
    setDropdownOpen(false)
  }

  const toggleDark = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    router.push(q ? `/polls?q=${encodeURIComponent(q)}` : '/polls')
  }

  const pageLabel = Object.entries(PAGE_TITLES).find(([k]) => pathname === k || (k !== '/dashboard' && pathname.startsWith(k)))?.[1] ?? 'Dashboard'
  const quarterLabel = keyToLabel(selectedQuarter)
  // Participation has its own date-range picker instead — the header quarter
  // selector doesn't apply to it and would be misleading if shown.
  const showQuarterPicker = !pathname.startsWith('/participation')

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-[#161b27] px-6">
      {/* Left: title + subtitle */}
      <div>
        <h1 className="text-base font-bold text-slate-800 dark:text-white leading-tight">{title}</h1>
        <p className="text-xs text-slate-400 leading-tight">{pageLabel}{showQuarterPicker ? ` · ${quarterLabel}` : ''}</p>
      </div>

      {/* Right: search + quarter + bell + theme */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <form onSubmit={handleSearch}
          className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 px-3 focus-within:border-purple-400 transition-colors">
          <Search className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search polls..."
            className="bg-transparent text-xs text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none w-36" />
        </form>

        {/* Quarter dropdown — not shown on Participation, which has its own date range picker */}
        {showQuarterPicker && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(o => !o)}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 px-3 text-xs font-medium text-slate-600 dark:text-slate-300 hover:border-purple-300 dark:hover:border-purple-600 transition-colors"
            >
              <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
              {quarterLabel}
              <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform duration-150 ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-50 w-48 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2535] shadow-xl overflow-hidden">
                <div className="py-1">
                  <button onClick={() => selectQuarter('all')}
                    className={`w-full px-4 py-2.5 text-left text-xs transition-colors ${selectedQuarter === 'all' ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 font-semibold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                    All Time
                  </button>
                  <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                  {quarters.map(q => (
                    <button key={q.key} onClick={() => selectQuarter(q.key)}
                      className={`w-full px-4 py-2.5 text-left text-xs transition-colors flex items-center justify-between ${selectedQuarter === q.key ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 font-semibold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                      <span>{q.label}</span>
                      {q.isCurrent && <span className="text-[9px] font-bold bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded-full">Current</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Notification bell */}
        <button className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-purple-300 transition-colors relative">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-purple-500" />
        </button>

        {/* Dark mode toggle */}
        <button onClick={toggleDark}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:border-purple-300 transition-colors"
          aria-label="Toggle dark mode">
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  )
}
