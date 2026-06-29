'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useRef } from 'react'
import { BarChart2, Download, Loader2, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Participant } from '@/app/api/participation/route'

const STALE_HOURS = 24

const DEPT_COLORS: Record<string, { bg: string; text: string }> = {}
const PALETTE = [
  { bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-700 dark:text-purple-300' },
  { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300' },
  { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300' },
  { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300' },
  { bg: 'bg-rose-100 dark:bg-rose-900/40', text: 'text-rose-700 dark:text-rose-300' },
  { bg: 'bg-teal-100 dark:bg-teal-900/40', text: 'text-teal-700 dark:text-teal-300' },
  { bg: 'bg-indigo-100 dark:bg-indigo-900/40', text: 'text-indigo-700 dark:text-indigo-300' },
  { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-700 dark:text-orange-300' },
]
let paletteIdx = 0
function deptColor(dept: string | null) {
  if (!dept) return { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-500 dark:text-slate-400' }
  if (!DEPT_COLORS[dept]) {
    DEPT_COLORS[dept] = PALETTE[paletteIdx % PALETTE.length]
    paletteIdx++
  }
  return DEPT_COLORS[dept]
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/40 text-xs font-semibold text-purple-700 dark:text-purple-300">
      {initials || '?'}
    </div>
  )
}

function PollsModal({ participant, onClose }: { participant: Participant; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4">
      <div className="absolute inset-0 bg-black/35" onClick={onClose} />
      <div className="relative w-full max-w-[520px] rounded-xl bg-white dark:bg-[#1a2035] border border-gray-200 dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[400px]">
        <div className="flex items-center justify-between px-[18px] py-[14px] border-b border-gray-100 dark:border-slate-700">
          <div>
            <p className="text-[15px] font-medium text-gray-900 dark:text-slate-100">{participant.full_name}</p>
            <p className="text-[12px] text-gray-400 dark:text-slate-500 mt-0.5">{participant.email} · {participant.department_name ?? '—'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 text-lg leading-none">×</button>
        </div>
        <div className="overflow-y-auto px-[18px] py-3">
          {participant.polls.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500 py-6 text-center">No poll participation yet</p>
          ) : participant.polls.map((poll, i) => (
            <div key={i} className="flex items-center justify-between py-[10px] border-b border-gray-100 dark:border-slate-700 last:border-0">
              <div>
                <p className="text-[13px] font-medium text-gray-800 dark:text-slate-200">{poll.topic}</p>
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{poll.department}{poll.submitted_at ? ` · ${formatDate(poll.submitted_at)}` : ''}</p>
              </div>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 ml-4 flex-shrink-0">Voted</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ParticipationPage() {
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [bgSyncing, setBgSyncing] = useState(false)
  const [totalEmployees, setTotalEmployees] = useState(0)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null)
  const [filterParticipated, setFilterParticipated] = useState<'all' | 'yes' | 'no'>('all')
  const [filterDept, setFilterDept] = useState('all')
  const [sortField, setSortField] = useState<'name' | 'count' | 'dept'>('count')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const syncedOnce = useRef(false)

  const triggerBackgroundSync = useCallback(async () => {
    if (bgSyncing) return
    setBgSyncing(true)
    try {
      await fetch('/api/employees', { method: 'POST' })
      const r2 = await fetch('/api/participation')
      const d2 = await r2.json() as { participants: Participant[]; totalEmployees: number; lastSyncedAt: string | null }
      setParticipants(d2.participants)
      setTotalEmployees(d2.totalEmployees)
      setLastSyncedAt(d2.lastSyncedAt)
    } catch { /* silent */ }
    finally { setBgSyncing(false) }
  }, [bgSyncing])

  const fetchData = useCallback(async (triggeredByUser = false) => {
    if (triggeredByUser) setLoading(true)
    try {
      const res = await fetch('/api/participation')
      const data = await res.json() as {
        participants: Participant[]
        employeeSynced: boolean
        totalEmployees: number
        lastSyncedAt: string | null
      }
      setParticipants(data.participants)
      setTotalEmployees(data.totalEmployees)
      setLastSyncedAt(data.lastSyncedAt)
      if (!syncedOnce.current) {
        syncedOnce.current = true
        const isStale = !data.lastSyncedAt || (Date.now() - new Date(data.lastSyncedAt).getTime()) / 3600000 > STALE_HOURS
        const isIncomplete = data.totalEmployees < 200
        if (isStale || isIncomplete) void triggerBackgroundSync()
      }
    } catch { toast.error('Failed to load participation data') }
    finally { setLoading(false) }
  }, [triggerBackgroundSync])

  useEffect(() => { void fetchData() }, [fetchData])

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const depts = Array.from(new Set(participants.map(p => p.department_name).filter(Boolean))).sort() as string[]

  const participated = participants.filter(p => p.participation_count >= 2).length
  const notParticipated = participants.filter(p => p.participation_count === 0).length
  const totalResponses = participants.reduce((s, p) => s + p.participation_count, 0)
  const avgPolls = participants.length > 0 ? (totalResponses / participants.length).toFixed(1) : '0'

  const filtered = participants
    .filter(p => {
      if (filterParticipated === 'yes' && p.participation_count === 0) return false
      if (filterParticipated === 'no' && p.participation_count > 0) return false
      if (filterDept !== 'all' && p.department_name !== filterDept) return false
      if (!search) return true
      const q = search.toLowerCase()
      return (
        p.full_name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.department_name ?? '').toLowerCase().includes(q) ||
        (p.manager_name ?? '').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') cmp = a.full_name.localeCompare(b.full_name)
      else if (sortField === 'count') cmp = a.participation_count - b.participation_count
      else if (sortField === 'dept') cmp = (a.department_name ?? '').localeCompare(b.department_name ?? '')
      return sortDir === 'asc' ? cmp : -cmp
    })

  const SortCaret = ({ field }: { field: typeof sortField }) => (
    <span className="ml-1 text-[10px] opacity-50">
      {sortField === field ? (sortDir === 'asc' ? '▲' : '▼') : '▲▼'}
    </span>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-medium text-gray-900 dark:text-white">Poll participation</h1>
          <p className="text-[13px] text-gray-400 dark:text-slate-500 mt-0.5 flex items-center gap-1.5">
            {bgSyncing && <Loader2 className="h-3 w-3 animate-spin text-purple-500" />}
            {bgSyncing ? 'Updating directory…' : 'Track employee engagement across all polls'}
            {!bgSyncing && lastSyncedAt && (
              <span className="text-gray-300 dark:text-slate-600">· synced {formatDate(lastSyncedAt)}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void fetchData(true)} disabled={loading}
            className="flex items-center gap-1.5 h-[34px] px-3 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button className="flex items-center gap-1.5 h-[34px] px-3.5 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total employees', value: loading ? '—' : totalEmployees.toLocaleString(), color: '' },
          { label: 'Participated in ≥2 polls', value: loading ? '—' : participated.toLocaleString(), color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Never participated', value: loading ? '—' : notParticipated.toLocaleString(), color: 'text-red-500 dark:text-red-400' },
          { label: 'Avg polls / employee', value: loading ? '—' : avgPolls, color: '' },
        ].map(c => (
          <div key={c.label} className="bg-white dark:bg-[#1a2035] border border-gray-100 dark:border-slate-700 rounded-xl p-4">
            <div className="text-[13px] text-gray-500 dark:text-slate-400 mb-1">{c.label}</div>
            <div className={`text-[22px] font-medium ${c.color || 'text-gray-900 dark:text-white'}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email or manager…"
          className="flex-1 max-w-[260px] h-[34px] border border-gray-200 dark:border-slate-700 rounded px-2.5 text-[13px] bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-400"
        />
        <select
          value={filterDept}
          onChange={e => setFilterDept(e.target.value)}
          className="h-[34px] border border-gray-200 dark:border-slate-700 rounded px-2.5 text-[13px] bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-purple-400"
        >
          <option value="all">All departments</option>
          {depts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={filterParticipated}
          onChange={e => setFilterParticipated(e.target.value as 'all' | 'yes' | 'no')}
          className="h-[34px] border border-gray-200 dark:border-slate-700 rounded px-2.5 text-[13px] bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-purple-400"
        >
          <option value="all">All participation</option>
          <option value="yes">Participated</option>
          <option value="no">Never participated</option>
        </select>
        {(search || filterDept !== 'all' || filterParticipated !== 'all') && (
          <button onClick={() => { setSearch(''); setFilterDept('all'); setFilterParticipated('all') }}
            className="flex items-center gap-1 h-[34px] px-2.5 rounded border border-gray-200 dark:border-slate-700 text-[12px] text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 bg-white dark:bg-slate-800 transition-colors">
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-[12px] text-gray-400 dark:text-slate-500">
          {filtered.length.toLocaleString()} of {participants.length.toLocaleString()}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#1a2035] border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '28%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800/60 border-b border-gray-100 dark:border-slate-700">
              {[
                { label: 'Employee', field: 'name' as const },
                { label: 'Manager', field: null },
                { label: 'Department', field: 'dept' as const },
                { label: 'Designation', field: null },
                { label: 'Polls participated', field: 'count' as const },
              ].map(col => (
                <th key={col.label}
                  className="px-3.5 py-2.5 text-[12px] font-medium text-gray-500 dark:text-slate-400 text-left"
                  onClick={col.field ? () => handleSort(col.field!) : undefined}
                  style={col.field ? { cursor: 'pointer' } : {}}>
                  {col.label}{col.field && <SortCaret field={col.field} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="py-20 text-center">
                <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="py-16 text-center text-[13px] text-gray-400 dark:text-slate-500">
                {participants.length === 0 ? 'Loading employee directory…' : 'No results match your search.'}
              </td></tr>
            ) : filtered.map((p, idx) => {
              const dc = deptColor(p.department_name)
              return (
                <tr key={idx} className="border-b border-gray-100 dark:border-slate-700/60 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-3.5 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar name={p.full_name} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-gray-800 dark:text-slate-100 truncate">{p.full_name}</div>
                        <div className="text-[11px] text-gray-400 dark:text-slate-500 truncate">{p.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3.5 py-3 text-[13px] text-gray-600 dark:text-slate-400 truncate">
                    {p.manager_name ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-3.5 py-3">
                    {p.department_name
                      ? <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${dc.bg} ${dc.text}`}>{p.department_name}</span>
                      : <span className="text-gray-300 dark:text-slate-600 text-[13px]">—</span>}
                  </td>
                  <td className="px-3.5 py-3 text-[12px] text-gray-500 dark:text-slate-400 truncate">
                    {p.designation_name ?? <span className="text-gray-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-3.5 py-3 text-center">
                    {p.participation_count > 0 ? (
                      <button onClick={() => setSelectedParticipant(p)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[13px] font-medium hover:bg-purple-100 dark:hover:bg-purple-800/50 transition-colors">
                        <BarChart2 className="h-3 w-3" />{p.participation_count}
                      </button>
                    ) : (
                      <span className="inline-flex px-2.5 py-1 rounded border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-400 dark:text-slate-500 text-[13px]">0</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selectedParticipant && (
        <PollsModal participant={selectedParticipant} onClose={() => setSelectedParticipant(null)} />
      )}
    </div>
  )
}
