'use client'

import { useState, useEffect } from 'react'

export interface QuarterRange {
  key: string
  from: string | null // ISO string, inclusive start (null = all time)
  to: string | null   // ISO string, inclusive end (null = all time)
}

function currentQuarterKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
}

function keyToRange(key: string): QuarterRange {
  if (!key || key === 'all') return { key: 'all', from: null, to: null }
  const [yStr, qStr] = key.split('-Q')
  const y = parseInt(yStr)
  const q = parseInt(qStr)
  if (!y || q < 1 || q > 4) return { key: 'all', from: null, to: null }
  const startMonth = (q - 1) * 3
  const from = new Date(y, startMonth, 1, 0, 0, 0, 0)
  const to = new Date(y, startMonth + 3, 0, 23, 59, 59, 999)
  return { key, from: from.toISOString(), to: to.toISOString() }
}

/**
 * Reactive access to the quarter chosen in the header dropdown.
 * Returns ISO string bounds (stable across renders unless the key changes) so
 * the value can be used directly in effect/fetch dependency arrays.
 */
export function useQuarter(): QuarterRange {
  const [key, setKey] = useState<string>(() => currentQuarterKey())

  useEffect(() => {
    const stored = localStorage.getItem('selectedQuarter')
    if (stored) setKey(stored)

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ key?: string }>).detail
      setKey(detail?.key ?? localStorage.getItem('selectedQuarter') ?? currentQuarterKey())
    }
    window.addEventListener('quarterchange', handler)
    return () => window.removeEventListener('quarterchange', handler)
  }, [])

  return keyToRange(key)
}

/** True when `dateStr` falls within the range (inclusive). All-time range matches everything. */
export function inQuarter(range: QuarterRange, dateStr: string | null | undefined): boolean {
  if (!range.from && !range.to) return true
  if (!dateStr) return false
  const t = new Date(dateStr).getTime()
  if (Number.isNaN(t)) return false
  if (range.from && t < new Date(range.from).getTime()) return false
  if (range.to && t > new Date(range.to).getTime()) return false
  return true
}
