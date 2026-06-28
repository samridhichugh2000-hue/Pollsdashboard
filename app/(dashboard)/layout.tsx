import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { Toaster } from 'sonner'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-[#0f1117]">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header userName="Samridhi Chugh" userRole="super_admin" title="Polls Dashboard" />

        <main className="flex-1 overflow-y-auto px-6 pb-6 pt-5">
          {children}
        </main>
      </div>

      <Toaster position="top-right" richColors theme="system" />
    </div>
  )
}
