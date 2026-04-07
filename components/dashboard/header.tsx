import { Bell, User, Search } from 'lucide-react'

interface HeaderProps {
  title: string
  userName?: string
  userRole?: string
}

export function Header({ title, userName, userRole }: HeaderProps) {
  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <header className="flex h-16 shrink-0 items-center justify-between px-6">
      <div>
        <p className="text-xs font-medium text-white/50 uppercase tracking-widest">{greeting}</p>
        <h1 className="text-lg font-bold text-white">{userName ?? 'Priya Upadhyay'}</h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="flex h-9 items-center gap-2 rounded-xl bg-white/10 px-3 backdrop-blur-sm">
          <Search className="h-3.5 w-3.5 text-white/50" />
          <span className="text-xs text-white/40 hidden sm:block">Search polls...</span>
        </div>

        {/* Bell */}
        <button className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm hover:bg-white/20 transition-colors">
          <Bell className="h-4 w-4 text-white/70" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-rose-400" />
        </button>

        {/* Avatar */}
        <div className="flex h-9 items-center gap-2 rounded-xl bg-white/10 px-3 backdrop-blur-sm">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
            <User className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="hidden sm:block">
            <p className="text-xs font-semibold text-white leading-none">{userName ?? 'Priya'}</p>
            <p className="text-xs text-white/50 capitalize leading-none mt-0.5">{userRole?.replace('_', ' ') ?? 'Super Admin'}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
