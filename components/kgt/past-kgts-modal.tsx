'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { X, Loader2, History, Search, Users } from 'lucide-react'
import type { PastKGT } from '@/types'
import { PAST_KGT_OUTCOME_LABELS, PAST_KGT_OUTCOME_COLORS } from '@/types'
import { parsePastKgtParticipants } from '@/lib/utils'

type ViewMode = 'by-kgt' | 'by-participant'

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

  const q = search.toLowerCase().trim()
  const filtered = q
    ? records.filter(r =>
        r.topic.toLowerCase().includes(q) ||
        (r.audience ?? '').toLowerCase().includes(q) ||
        parsePastKgtParticipants(r.participants).some(p => p.toLowerCase().includes(q))
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
              placeholder="Search by topic, audience, or participant..."
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
