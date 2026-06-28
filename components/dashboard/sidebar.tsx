'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ClipboardList,
  BarChart3,
  Archive,
  Settings,
  CalendarClock,
  MessageSquare,
  Users,
  BarChart2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const mainNav = [
  { href: '/dashboard',     label: 'Overview',      icon: LayoutDashboard },
  { href: '/polls',         label: 'Poll Requests', icon: ClipboardList },
  { href: '/feedback',      label: 'Feedback',      icon: MessageSquare },
  { href: '/participation', label: 'Participation', icon: Users },
  { href: '/cadence',       label: 'Poll Cadence',  icon: CalendarClock },
  { href: '/reports',       label: 'Reports',       icon: BarChart3 },
  { href: '/archived',      label: 'Archived',      icon: Archive },
]

const settingsNav = [
  { href: '/settings', label: 'Settings', icon: Settings },
]

function NavItem({ href, label, icon: Icon }: { href: string; label: string; icon: React.ElementType }) {
  const pathname = usePathname()
  const isActive = href === '/dashboard'
    ? pathname === '/dashboard'
    : href === '/polls'
      ? pathname === '/polls' || pathname.startsWith('/polls/')
      : pathname.startsWith(href)

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
        isActive
          ? 'bg-purple-600 text-white shadow-md shadow-purple-200 dark:shadow-purple-900/40'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
      )}
    >
      <Icon className="h-[18px] w-[18px] flex-shrink-0" />
      <span>{label}</span>
    </Link>
  )
}

export function Sidebar() {
  return (
    <aside className="flex h-full w-56 flex-col border-r border-slate-100 bg-white dark:border-slate-800 dark:bg-[#161b27] py-5">
      {/* Logo */}
      <div className="mb-6 flex items-center gap-3 px-4">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-purple-600">
          <BarChart2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-800 dark:text-white leading-tight">PollsHQ</p>
          <p className="text-xs text-slate-400 leading-tight">HR Dashboard</p>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {mainNav.map(item => <NavItem key={item.href} {...item} />)}
      </nav>

      {/* Settings section */}
      <div className="px-3">
        <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600">Settings</p>
        {settingsNav.map(item => <NavItem key={item.href} {...item} />)}
      </div>

      {/* User profile */}
      <div className="mx-3 mt-4 flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
          SC
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">Samridhi Chugh</p>
          <p className="text-[10px] text-slate-400">HR Admin</p>
        </div>
      </div>
    </aside>
  )
}
