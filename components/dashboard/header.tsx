'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { User, Search } from 'lucide-react'

interface HeaderProps {
  title: string
  userName?: string
  userRole?: string
}

export function Header({ title, userName, userRole }: HeaderProps) {
  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'
  const [query, setQuery] = useState('')
  const router = useRouter()

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (q) router.push(`/polls?q=${encodeURIComponent(q)}`)
    else router.push('/polls')
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 bg-white px-6 shadow-sm">
      <div>
        <p className="text-xs font-medium text-slate-400 uppercase tracking-widest">{greeting}</p>
        <h1 className="text-lg font-bold text-slate-800">{userName ?? 'Priya Upadhyay'}</h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Search */}
        <form onSubmit={handleSearch} className="flex h-9 items-center gap-2 rounded-xl bg-slate-100 px-3 focus-within:bg-slate-200 transition-colors">
          <Search className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search polls..."
            className="bg-transparent text-xs text-slate-700 placeholder-slate-400 outline-none w-36 sm:w-48"
          />
        </form>

        {/* Avatar */}
        <div className="flex h-9 items-center gap-2 rounded-xl bg-slate-100 px-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600">
            <User className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="hidden sm:block">
            <p className="text-xs font-semibold text-slate-700 leading-none">{userName ?? 'Priya'}</p>
            <p className="text-xs text-slate-400 capitalize leading-none mt-0.5">{userRole?.replace('_', ' ') ?? 'Super Admin'}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
