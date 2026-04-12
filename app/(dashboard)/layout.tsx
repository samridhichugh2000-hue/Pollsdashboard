import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { Toaster } from 'sonner'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'linear-gradient(135deg, #0e7490 0%, #0c6478 40%, #0a5568 100%)' }}>
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header userName="Priya Upadhyay" userRole="super_admin" title="Polls Dashboard" />

        {/* Main scrollable area */}
        <main className="flex-1 overflow-y-auto px-6 pb-6">
          {children}
        </main>
      </div>

      <Toaster position="top-right" richColors theme="light" />
    </div>
  )
}
