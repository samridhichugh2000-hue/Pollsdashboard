'use client'

import { useState } from 'react'
import { Copy, Check, ExternalLink, Link2 } from 'lucide-react'

export function RequestLink() {
  const [copied, setCopied] = useState(false)

  const url = typeof window !== 'undefined'
    ? `${window.location.origin}/request`
    : '/request'

  const copy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-2xl bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] overflow-hidden">
      {/* Header band */}
      <div className="flex items-center gap-3 bg-cyan-600 px-5 py-4">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/20">
          <Link2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-white">Public Poll Request Link</p>
          <p className="text-xs text-cyan-100">Share this with anyone who needs to raise a poll request</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* URL display */}
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <span className="flex-1 truncate text-sm font-mono text-gray-700">{url}</span>
          <button
            onClick={copy}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              copied
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-cyan-50 text-cyan-600 hover:bg-cyan-100'
            }`}
          >
            {copied ? <><Check className="h-3.5 w-3.5" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
          </button>
        </div>

        <div className="flex items-start gap-3">
          <a
            href="/request"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <ExternalLink className="h-4 w-4" /> Preview Page
          </a>
          <div className="flex-1 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            External users can only submit requests — they cannot view the dashboard or any poll data.
          </div>
        </div>
      </div>
    </div>
  )
}
