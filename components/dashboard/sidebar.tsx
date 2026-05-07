'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ClipboardList,
  BarChart3,
  Archive,
  Settings,
  CheckSquare,
  CalendarClock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/polls', label: 'Polls', icon: ClipboardList },
  { href: '/regular-polls', label: 'Regular Polls', icon: CalendarClock },
  { href: '/results', label: 'Results & Follow-up', icon: BarChart3 },
  { href: '/archived', label: 'Archived', icon: Archive },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex h-full w-52 flex-col bg-slate-900 py-4">
      {/* Logo */}
      <div className="mb-8 flex items-center gap-3 px-4">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-teal-600">
          <CheckSquare className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-white leading-tight">Polls</p>
          <p className="text-xs text-slate-400 leading-tight">Dashboard</p>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex flex-1 flex-col gap-1 px-2">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = item.href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-teal-600 text-white shadow-lg'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              )}
            >
              <Icon className="h-[18px] w-[18px] flex-shrink-0" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Bottom status */}
      <div className="flex items-center gap-2 px-4 pt-4 border-t border-slate-700/50">
        <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.4)]" />
        <span className="text-xs text-slate-500">Connected</span>
      </div>
    </aside>
  )
}
