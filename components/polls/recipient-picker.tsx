'use client'

import { useEffect, useRef, useState } from 'react'
import { Users, X, Search } from 'lucide-react'
import type { HuntGroup } from '@/components/settings/hunt-groups-manager'

interface RecipientPickerProps {
  value: string[]
  onChange: (emails: string[]) => void
}

interface KnownEmail {
  email: string
  label: string // display name or group name
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr.map(e => e.toLowerCase().trim()).filter(Boolean))]
}

export function RecipientPicker({ value, onChange }: RecipientPickerProps) {
  const [huntGroups, setHuntGroups] = useState<HuntGroup[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [individualEmails, setIndividualEmails] = useState<string[]>([])
  const [knownEmails, setKnownEmails] = useState<KnownEmail[]>([])
  const [inputText, setInputText] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [initialized, setInitialized] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Load hunt groups + senders once
  useEffect(() => {
    Promise.all([
      fetch('/api/hunt-groups').then(r => r.ok ? r.json() : []),
      fetch('/api/senders').then(r => r.ok ? r.json() : []),
    ]).then(([groups, senders]: [HuntGroup[], { name: string; email: string }[]]) => {
      setHuntGroups(groups)

      const known: KnownEmail[] = [
        ...groups.map(g => ({ email: g.email, label: g.name })),
        ...senders.map(s => ({ email: s.email, label: s.name })),
      ]
      // Deduplicate by email
      const seen = new Set<string>()
      setKnownEmails(known.filter(k => {
        const key = k.email.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key); return true
      }))

      // Reconcile existing value into groups + individual
      const groupByEmail = new Map(groups.map(g => [g.email.toLowerCase(), g.id]))
      const matchedIds: string[] = []
      const unmatched: string[] = []
      for (const email of value) {
        const id = groupByEmail.get(email.toLowerCase())
        if (id) matchedIds.push(id)
        else if (email.trim()) unmatched.push(email)
      }
      setSelectedGroupIds(matchedIds)
      setIndividualEmails(unmatched)
      setInitialized(true)
    }).catch(() => setInitialized(true))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Emit combined value when selections change
  useEffect(() => {
    if (!initialized) return
    const groupEmails = huntGroups
      .filter(g => selectedGroupIds.includes(g.id))
      .map(g => g.email)
    onChangeRef.current(dedup([...groupEmails, ...individualEmails]))
  }, [selectedGroupIds, individualEmails, huntGroups, initialized])

  // Click-outside to close dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Toggle a hunt group
  const toggleGroup = (group: HuntGroup) => {
    setSelectedGroupIds(prev =>
      prev.includes(group.id) ? prev.filter(id => id !== group.id) : [...prev, group.id]
    )
  }

  // Autocomplete suggestions
  const allSelected = new Set(value.map(e => e.toLowerCase()))
  const suggestions = inputText.length >= 2
    ? knownEmails
        .filter(k => k.email.toLowerCase().includes(inputText.toLowerCase()) && !allSelected.has(k.email.toLowerCase()))
        .slice(0, 6)
    : []

  const addEmail = (email: string) => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) return
    // If it matches a hunt group, select the group instead
    const matchedGroup = huntGroups.find(g => g.email.toLowerCase() === trimmed)
    if (matchedGroup) {
      setSelectedGroupIds(prev => prev.includes(matchedGroup.id) ? prev : [...prev, matchedGroup.id])
    } else if (!individualEmails.some(e => e.toLowerCase() === trimmed)) {
      setIndividualEmails(prev => [...prev, trimmed])
    }
    setInputText('')
    setShowSuggestions(false)
  }

  const removeEmail = (email: string) => {
    const lower = email.toLowerCase()
    // Check if it's a group email
    const group = huntGroups.find(g => g.email.toLowerCase() === lower)
    if (group) {
      setSelectedGroupIds(prev => prev.filter(id => id !== group.id))
    } else {
      setIndividualEmails(prev => prev.filter(e => e.toLowerCase() !== lower))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (suggestions.length > 0 && inputText) {
        addEmail(suggestions[0].email)
      } else {
        addEmail(inputText)
      }
    }
    if (e.key === 'Backspace' && !inputText && individualEmails.length > 0) {
      setIndividualEmails(prev => prev.slice(0, -1))
    }
    if (e.key === 'Escape') setShowSuggestions(false)
  }

  // Separate selected emails into group-sourced and individual for display
  const groupEmailSet = new Set(
    huntGroups.filter(g => selectedGroupIds.includes(g.id)).map(g => g.email.toLowerCase())
  )

  return (
    <div className="space-y-4">

      {/* ── Hunt Groups ──────────────────────────────────────────────── */}
      {huntGroups.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Users className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs font-medium text-gray-600">Hunt Groups</span>
            <span className="text-xs text-gray-400">(click to select)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {huntGroups.map(g => {
              const selected = selectedGroupIds.includes(g.id)
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGroup(g)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                    selected
                      ? 'border-cyan-500 bg-cyan-50 text-cyan-700 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-cyan-300 hover:bg-cyan-50/50'
                  }`}
                >
                  <Users className={`h-3 w-3 ${selected ? 'text-cyan-500' : 'text-gray-400'}`} />
                  <span>{g.name}</span>
                  {selected && (
                    <span className="ml-0.5 rounded-full bg-cyan-500 text-white text-[10px] px-1 font-bold">✓</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Individual email input ────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Search className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-xs font-medium text-gray-600">Add Individual Emails</span>
          <span className="text-xs text-gray-400">(type, autocomplete, or paste)</span>
        </div>
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={e => { setInputText(e.target.value); setShowSuggestions(true) }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={handleKeyDown}
            placeholder="name@koenig-solutions.com — Enter or comma to add"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />

          {/* Autocomplete dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div ref={dropdownRef}
              className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
              {suggestions.map(s => (
                <button
                  key={s.email}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); addEmail(s.email) }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-cyan-50 transition-colors"
                >
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-cyan-100 text-xs font-bold text-cyan-700">
                    {s.label[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{s.label}</p>
                    <p className="text-xs text-gray-400">{s.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Selected recipients ───────────────────────────────────────── */}
      {value.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-600 mb-2">
            Selected Recipients <span className="text-gray-400">({value.length})</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {value.map(email => {
              const isFromGroup = groupEmailSet.has(email.toLowerCase())
              const group = huntGroups.find(g => g.email.toLowerCase() === email.toLowerCase())
              return (
                <span
                  key={email}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                    isFromGroup
                      ? 'border-cyan-200 bg-cyan-50 text-cyan-800'
                      : 'border-gray-200 bg-gray-50 text-gray-700'
                  }`}
                >
                  {isFromGroup && <Users className="h-3 w-3 text-cyan-500 flex-shrink-0" />}
                  <span>{isFromGroup && group ? `${group.name} (${email})` : email}</span>
                  <button type="button" onClick={() => removeEmail(email)}
                    className="ml-0.5 text-gray-400 hover:text-rose-500 transition-colors flex-shrink-0">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {value.length === 0 && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No recipients selected yet — choose a hunt group above or type an email address.
        </p>
      )}
    </div>
  )
}
