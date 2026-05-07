import { ClipboardList, Clock, Send, CheckCircle, ListTodo, Upload } from 'lucide-react'
import type { KPIData } from '@/types'

interface KPICardsProps {
  data: KPIData
  filtered?: boolean
}

const cards = [
  {
    key: 'totalThisMonth' as keyof KPIData,
    label: 'Total Polls',
    sub: 'This month',
    subFiltered: 'In date range',
    icon: ClipboardList,
    color: 'text-cyan-600',
    iconBg: 'bg-cyan-50',
  },
  {
    key: 'awaitingApproval' as keyof KPIData,
    label: 'Awaiting Approval',
    sub: 'Pending action',
    subFiltered: 'In date range',
    icon: Clock,
    color: 'text-amber-500',
    iconBg: 'bg-amber-50',
  },
  {
    key: 'active' as keyof KPIData,
    label: 'Active Polls',
    sub: 'Currently live',
    subFiltered: 'In date range',
    icon: Send,
    color: 'text-violet-500',
    iconBg: 'bg-violet-50',
  },
  {
    key: 'closedThisMonth' as keyof KPIData,
    label: 'Closed',
    sub: 'This month',
    subFiltered: 'In date range',
    icon: CheckCircle,
    color: 'text-emerald-500',
    iconBg: 'bg-emerald-50',
  },
  {
    key: 'rmsTasksCreated' as keyof KPIData,
    label: 'RMS Tasks',
    sub: 'Created this month',
    subFiltered: 'In date range',
    icon: ListTodo,
    color: 'text-teal-600',
    iconBg: 'bg-teal-50',
  },
  {
    key: 'resultsUploaded' as keyof KPIData,
    label: 'Results Shared',
    sub: 'Total shared',
    subFiltered: 'In date range',
    icon: Upload,
    color: 'text-indigo-500',
    iconBg: 'bg-indigo-50',
  },
]

export function KPICards({ data, filtered }: KPICardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map(({ key, label, sub, subFiltered, icon: Icon, color, iconBg }) => (
        <div
          key={key}
          className="rounded-2xl bg-white px-4 py-5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-transform duration-200 hover:-translate-y-0.5"
        >
          <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
          <div className={`text-3xl font-bold ${color}`}>
            {data[key]}
          </div>
          <p className="mt-1 text-sm font-medium text-gray-700">{label}</p>
          <p className="text-xs text-gray-400">{filtered ? subFiltered : sub}</p>
        </div>
      ))}
    </div>
  )
}
