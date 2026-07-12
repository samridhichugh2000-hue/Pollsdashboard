'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Search, Bell, Moon, Sun, CalendarDays } from 'lucide-react'

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

function getQuarterLabel(): string {
  const now = new Date()
  const month = now.getMonth()
  const year = now.getFullYear()
  const quarters = [
    { months: [0,1,2],   label: 'Jan – Mar', q: 1 },
    { months: [3,4,5],   label: 'Apr – Jun', q: 2 },
    { months: [6,7,8],   label: 'Jul – Sep', q: 3 },
    { months: [9,10,11], label: 'Oct – Dec', q: 4 },
  ]
  const qObj = quarters.find(q => q.months.includes(month))!
  return `${qObj.label} ${year}`
}

export function Header({ userName }: { userName?: string; userRole?: string; title?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const [dark, setDark] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('theme')
    setDark(saved === null ? true : saved === 'dark')
  }, [])

  const toggleDark = () => {
    const next = !dark
    setDark(next)
    if (next) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    router.push(q ? `/polls?q=${encodeURIComponent(q)}` : '/polls')
  }

  const pageLabel = Object.entries(PAGE_TITLES).find(([k]) => pathname === k || (k !== '/dashboard' && pathname.startsWith(k)))?.[1] ?? 'Dashboard'
  const quarterLabel = getQuarterLabel()

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 bg-white dark:border-slate-800 dark:bg-[#161b27] px-6">
      {/* Left: title + subtitle */}
      <div>
        <h1 className="text-base font-bold text-slate-800 dark:text-white leading-tight">Polls Dashboard</h1>
        <p className="text-xs text-slate-400 leading-tight">{pageLabel} · {quarterLabel}</p>
      </div>

      {/* Right: search + date + bell + theme */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <form onSubmit={handleSearch}
          className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 px-3 focus-within:border-purple-400 transition-colors">
          <Search className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search polls..."
            className="bg-transparent text-xs text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none w-36"
          />
        </form>

        {/* Date range badge */}
        <button className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 px-3 text-xs font-medium text-slate-600 dark:text-slate-300 hover:border-purple-300 transition-colors">
          <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
          {quarterLabel}
        </button>

        {/* Notification bell */}
        <button className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-purple-300 transition-colors relative">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-purple-500" />
        </button>

        {/* Dark mode toggle */}
        <button
          onClick={toggleDark}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:border-purple-300 transition-colors"
          aria-label="Toggle dark mode"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  )
}
