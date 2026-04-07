import { ClipboardList, Clock, Send, CheckCircle, ListTodo, Upload } from 'lucide-react'
import type { KPIData } from '@/types'

interface KPICardsProps {
  data: KPIData
}

const cards = [
  {
    key: 'totalThisMonth' as keyof KPIData,
    label: 'Total Polls',
    sub: 'This month',
    icon: ClipboardList,
    color: 'text-cyan-600',
    iconBg: 'bg-cyan-50',
    suffix: '',
  },
  {
    key: 'awaitingApproval' as keyof KPIData,
    label: 'Awaiting Approval',
    sub: 'Pending action',
    icon: Clock,
    color: 'text-amber-500',
    iconBg: 'bg-amber-50',
    suffix: '',
  },
  {
    key: 'active' as keyof KPIData,
    label: 'Active Polls',
    sub: 'Currently live',
    icon: Send,
    color: 'text-violet-500',
    iconBg: 'bg-violet-50',
    suffix: '',
  },
  {
    key: 'closedThisMonth' as keyof KPIData,
    label: 'Closed',
    sub: 'This month',
    icon: CheckCircle,
    color: 'text-emerald-500',
    iconBg: 'bg-emerald-50',
    suffix: '',
  },
  {
    key: 'rmsTasksCreatedPct' as keyof KPIData,
    label: 'RMS Tasks',
    sub: 'Created rate',
    icon: ListTodo,
    color: 'text-teal-600',
    iconBg: 'bg-teal-50',
    suffix: '%',
  },
  {
    key: 'resultsUploadedPct' as keyof KPIData,
    label: 'Results',
    sub: 'Upload rate',
    icon: Upload,
    color: 'text-indigo-500',
    iconBg: 'bg-indigo-50',
    suffix: '%',
  },
]

export function KPICards({ data }: KPICardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map(({ key, label, sub, icon: Icon, color, iconBg, suffix }) => (
        <div
          key={key}
          className="rounded-2xl bg-white px-4 py-5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-transform duration-200 hover:-translate-y-0.5"
        >
          <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
          <div className={`text-3xl font-bold ${color}`}>
            {data[key]}{suffix}
          </div>
          <p className="mt-1 text-sm font-medium text-gray-700">{label}</p>
          <p className="text-xs text-gray-400">{sub}</p>
        </div>
      ))}
    </div>
  )
}
