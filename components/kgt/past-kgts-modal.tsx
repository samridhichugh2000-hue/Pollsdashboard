'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { X, Loader2, History, Search, Pencil, Check, Users } from 'lucide-react'
import { toast } from 'sonner'
import type { PastKGT } from '@/types'
import { PAST_KGT_OUTCOME_LABELS, PAST_KGT_OUTCOME_COLORS } from '@/types'
import { parsePastKgtParticipants, getErrorMessage } from '@/lib/utils'

type ViewMode = 'by-kgt' | 'by-participant'

// Editable inline — clicking the cell (or its pencil) turns it into a text
// input; Enter/blur saves via PATCH, Escape cancels. Used for Finalised
// Kite since that field doesn't exist in the source spreadsheet at all and
// has to be filled in by hand after the fact.
function EditableFinalisedKite({ record, onSaved }: { record: PastKGT; onSaved: (updated: PastKGT) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(record.finalised_kite ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const trimmed = value.trim()
    if (trimmed === (record.finalised_kite ?? '')) { setEditing(false); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/kgt/past/${record.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalised_kite: trimmed || null }),
      })
      if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to save'))
      onSaved(await res.json() as PastKGT)
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') { setValue(record.finalised_kite ?? ''); setEditing(false) }
          }}
          placeholder="Kite name"
          className="w-32 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-1 text-xs text-gray-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        />
        <button onClick={() => void save()} disabled={saving} className="text-emerald-600 hover:text-emerald-800 disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group flex items-center gap-1.5 text-gray-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400"
    >
      <span>{record.finalised_kite || '—'}</span>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60" />
    </button>
  )
}

// Backfilled historical KGTs — flat records imported once from a spreadsheet,
// never `polls` rows, so they're listed here rather than in the main table.
export function PastKGTsModal({ onClose }: { onClose: () => void }) {
  const [records, setRecords] = useState<PastKGT[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<ViewMode>('by-kgt')

  useEffect(() => {
    fetch('/api/kgt/past')
      .then(r => r.ok ? r.json() : [])
      .then((data: PastKGT[]) => setRecords(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const updateRecord = (updated: PastKGT) => {
    setRecords(prev => prev.map(r => r.id === updated.id ? updated : r))
  }

  const q = search.toLowerCase().trim()
  const filtered = q
    ? records.filter(r =>
        r.topic.toLowerCase().includes(q) ||
        (r.audience ?? '').toLowerCase().includes(q) ||
        parsePastKgtParticipants(r.participants).some(p => p.toLowerCase().includes(q)) ||
        (r.finalised_kite ?? '').toLowerCase().includes(q)
      )
    : records

  // Participation leaderboard — how many past KGTs each person shows up in,
  // which the raw free-text format made impossible to compute.
  const participation = useMemo(() => {
    const byName = new Map<string, { name: string; count: number; topics: string[] }>()
    for (const r of filtered) {
      for (const name of parsePastKgtParticipants(r.participants)) {
        const key = name.toLowerCase()
        const entry = byName.get(key) ?? { name, count: 0, topics: [] }
        entry.count += 1
        entry.topics.push(r.topic)
        byName.set(key, entry)
      }
    }
    return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [filtered])

  const [expandedName, setExpandedName] = useState<string | null>(null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-5xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 dark:border-slate-700 px-6 py-5">
          <div>
            <h2 className="flex items-center gap-2 font-bold text-gray-900 dark:text-slate-100 text-lg leading-tight">
              <History className="h-5 w-5 text-cyan-500" /> Past KGTs
            </h2>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
              {records.length} historical KGT{records.length === 1 ? '' : 's'} on record
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 pt-4 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by topic, audience, participant, or finalised kite..."
              className="w-full rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-2 pl-9 pr-3 text-sm text-gray-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-100"
            />
          </div>
          <div className="flex rounded-md border border-gray-200 dark:border-slate-700 overflow-hidden shrink-0">
            <button
              onClick={() => setView('by-kgt')}
              className={`px-3 py-2 text-xs font-medium ${view === 'by-kgt' ? 'bg-cyan-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300'}`}
            >
              By KGT
            </button>
            <button
              onClick={() => setView('by-participant')}
              className={`flex items-center gap-1 px-3 py-2 text-xs font-medium ${view === 'by-participant' ? 'bg-cyan-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300'}`}
            >
              <Users className="h-3.5 w-3.5" /> By Participant
            </button>
          </div>
        </div>

        <div className="overflow-auto px-6 py-4 flex-1">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500 py-6 text-center">
              {records.length === 0 ? 'No past KGTs have been recorded yet.' : 'No past KGTs match your search.'}
            </p>
          ) : view === 'by-kgt' ? (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide border-b border-gray-100 dark:border-slate-700">
                  <th className="py-2 pr-4 whitespace-nowrap">Date</th>
                  <th className="py-2 pr-4">Topic</th>
                  <th className="py-2 pr-4">Audience</th>
                  <th className="py-2 pr-4">Participants</th>
                  <th className="py-2 pr-4 whitespace-nowrap">Outcome</th>
                  <th className="py-2 pr-4">Finalised Kite</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const names = parsePastKgtParticipants(r.participants)
                  return (
                    <tr key={r.id} className="border-b border-gray-50 dark:border-slate-800 align-top">
                      <td className="py-3 pr-4 whitespace-nowrap text-gray-600 dark:text-slate-300">{r.kgt_date || '—'}</td>
                      <td className="py-3 pr-4 font-medium text-gray-900 dark:text-slate-100">{r.topic}</td>
                      <td className="py-3 pr-4 text-gray-600 dark:text-slate-300">{r.audience || '—'}</td>
                      <td className="py-3 pr-4 text-gray-600 dark:text-slate-300">{names.length ? names.join(', ') : '—'}</td>
                      <td className="py-3 pr-4 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${PAST_KGT_OUTCOME_COLORS[r.outcome]}`}>
                          {PAST_KGT_OUTCOME_LABELS[r.outcome]}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-xs">
                        <EditableFinalisedKite record={r} onSaved={updateRecord} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide border-b border-gray-100 dark:border-slate-700">
                  <th className="py-2 pr-4">Participant</th>
                  <th className="py-2 pr-4 whitespace-nowrap">KGTs Participated In</th>
                </tr>
              </thead>
              <tbody>
                {participation.map(p => (
                  <Fragment key={p.name}>
                    <tr className="border-b border-gray-50 dark:border-slate-800">
                      <td className="py-2.5 pr-4 font-medium text-gray-900 dark:text-slate-100">{p.name}</td>
                      <td className="py-2.5 pr-4">
                        <button
                          onClick={() => setExpandedName(prev => prev === p.name ? null : p.name)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-900/50 px-2.5 py-0.5 text-xs font-semibold text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-900/40"
                        >
                          {p.count}
                        </button>
                      </td>
                    </tr>
                    {expandedName === p.name && (
                      <tr className="border-b border-gray-50 dark:border-slate-800">
                        <td colSpan={2} className="pb-3 pl-2 pr-4">
                          <ul className="list-disc list-inside text-xs text-gray-500 dark:text-slate-400 space-y-0.5">
                            {p.topics.map((t, i) => <li key={i}>{t}</li>)}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
