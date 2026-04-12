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
    <aside className="flex h-full w-16 flex-col items-center bg-cyan-800/40 py-4 backdrop-blur-sm">
      {/* Logo */}
      <div className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
        <CheckSquare className="h-5 w-5 text-white" />
      </div>

      {/* Nav icons */}
      <nav className="flex flex-1 flex-col items-center gap-2">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = item.href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                'group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200',
                isActive
                  ? 'bg-white/25 shadow-lg'
                  : 'hover:bg-white/15'
              )}
            >
              <Icon className={cn('h-5 w-5', isActive ? 'text-white' : 'text-white/60 group-hover:text-white')} />
              {/* Tooltip */}
              <span className="absolute left-14 z-50 hidden whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-xl group-hover:block">
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Bottom dot */}
      <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.5)]" title="Connected" />
    </aside>
  )
}
