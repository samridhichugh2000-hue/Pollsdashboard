'use client'

import { Plus, Trash2, X, ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type QuestionType = 'open_ended' | 'rating' | 'yes_no' | 'multiple_choice'

export interface Question {
  text: string
  type: QuestionType
  options?: string[]
}

interface QuestionBuilderProps {
  questions: Question[]
  onChange: (questions: Question[]) => void
  maxQuestions?: number
}

const TYPES: { value: QuestionType; label: string; icon: string; color: string }[] = [
  { value: 'open_ended',      label: 'Open Ended',      icon: '✍️', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' },
  { value: 'rating',          label: 'Rating (1–5)',     icon: '⭐', color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' },
  { value: 'yes_no',          label: 'Yes / No',         icon: '✅', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
  { value: 'multiple_choice', label: 'Multiple Choice',  icon: '☰',  color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100' },
]

const ACTIVE_COLOR: Record<QuestionType, string> = {
  open_ended:      'bg-blue-600 text-white border-blue-600',
  rating:          'bg-amber-500 text-white border-amber-500',
  yes_no:          'bg-emerald-600 text-white border-emerald-600',
  multiple_choice: 'bg-purple-600 text-white border-purple-600',
}

export function QuestionBuilder({ questions, onChange, maxQuestions = 10 }: QuestionBuilderProps) {
  const addQuestion = () => {
    if (questions.length >= maxQuestions) return
    onChange([...questions, { text: '', type: 'open_ended' }])
  }

  const removeQuestion = (i: number) => {
    onChange(questions.filter((_, idx) => idx !== i))
  }

  const moveQuestion = (i: number, dir: -1 | 1) => {
    const next = i + dir
    if (next < 0 || next >= questions.length) return
    const reordered = [...questions]
    ;[reordered[i], reordered[next]] = [reordered[next], reordered[i]]
    onChange(reordered)
  }

  const updateText = (i: number, text: string) => {
    onChange(questions.map((q, idx) => idx === i ? { ...q, text } : q))
  }

  const updateType = (i: number, type: QuestionType) => {
    const q = questions[i]
    const updated: Question = { ...q, type }
    if (type === 'multiple_choice' && !updated.options?.length) {
      updated.options = ['', '']
    }
    if (type !== 'multiple_choice') {
      delete updated.options
    }
    onChange(questions.map((q, idx) => idx === i ? updated : q))
  }

  const addOption = (qi: number) => {
    const q = questions[qi]
    onChange(questions.map((item, idx) => idx === qi ? { ...item, options: [...(item.options ?? []), ''] } : item))
  }

  const removeOption = (qi: number, oi: number) => {
    const q = questions[qi]
    onChange(questions.map((item, idx) => idx === qi
      ? { ...item, options: (item.options ?? []).filter((_, i) => i !== oi) }
      : item
    ))
  }

  const updateOption = (qi: number, oi: number, value: string) => {
    // Multi-select respondent answers are serialized as a ", "-joined string
    // (app/respond/[id]/page.tsx) and split back on the same delimiter — an
    // option containing a literal ", " would corrupt that round-trip, so it's
    // disallowed at the source instead of every consumer having to guard
    // against it.
    const safeValue = value.replace(/,\s*/g, '; ')
    onChange(questions.map((item, idx) => idx === qi
      ? { ...item, options: (item.options ?? []).map((o, i) => i === oi ? safeValue : o) }
      : item
    ))
  }

  return (
    <div className="space-y-3">
      {questions.map((q, i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          {/* Question header */}
          <div className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-cyan-600 text-xs font-bold text-white mt-0.5">
              {i + 1}
            </span>
            <input
              type="text"
              value={q.text}
              onChange={e => updateText(i, e.target.value)}
              placeholder={`Question ${i + 1}`}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <div className="flex flex-col gap-0.5 flex-shrink-0">
              <button type="button" onClick={() => moveQuestion(i, -1)} disabled={i === 0}
                className="flex h-3.5 w-6 items-center justify-center rounded text-gray-300 hover:text-cyan-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors">
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => moveQuestion(i, 1)} disabled={i === questions.length - 1}
                className="flex h-3.5 w-6 items-center justify-center rounded text-gray-300 hover:text-cyan-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors">
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0"
              onClick={() => removeQuestion(i)}>
              <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-rose-500" />
            </Button>
          </div>

          {/* Type selector */}
          <div className="flex flex-wrap gap-1.5 pl-9">
            {TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => updateType(i, t.value)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all ${
                  q.type === t.value ? ACTIVE_COLOR[t.value] : t.color
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {/* Multiple choice options */}
          {q.type === 'multiple_choice' && (
            <div className="pl-9 space-y-2">
              <p className="text-xs text-gray-500 font-medium">Answer options:</p>
              {(q.options ?? []).map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <span className="h-3 w-3 flex-shrink-0 rounded-sm border-2 border-purple-400" />
                  <input
                    type="text"
                    value={opt}
                    onChange={e => updateOption(i, oi, e.target.value)}
                    placeholder={`Option ${oi + 1}`}
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                  {(q.options ?? []).length > 2 && (
                    <button type="button" onClick={() => removeOption(i, oi)}
                      className="text-gray-300 hover:text-rose-400 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => addOption(i)}
                className="inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 font-medium">
                <Plus className="h-3 w-3" /> Add option
              </button>
            </div>
          )}

          {/* Type hints */}
          <div className="pl-9">
            {q.type === 'open_ended' && <p className="text-xs text-gray-400">Respondents will type a free-text answer.</p>}
            {q.type === 'rating' && <p className="text-xs text-gray-400">Respondents pick 1–5 stars (Very Poor → Excellent).</p>}
            {q.type === 'yes_no' && <p className="text-xs text-gray-400">Respondents choose Yes or No.</p>}
            {q.type === 'multiple_choice' && <p className="text-xs text-gray-400">Respondents can select one or more options above.</p>}
          </div>
        </div>
      ))}

      {questions.length < maxQuestions && (
        <button type="button" onClick={addQuestion}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm text-gray-400 hover:border-cyan-400 hover:text-cyan-600 transition-colors">
          <Plus className="h-4 w-4" /> Add Question
        </button>
      )}

      {questions.length === 0 && (
        <p className="text-center text-xs text-gray-400 pb-1">No questions yet — click above to add one.</p>
      )}
    </div>
  )
}

// Parse any stored questions format into Question[]
export function parseQuestions(raw: string | unknown[]): Question[] {
  try {
    const arr: unknown[] = typeof raw === 'string' ? JSON.parse(raw) : raw
    return arr.map(q => {
      if (typeof q === 'string') return { text: q, type: 'open_ended' as QuestionType }
      const obj = q as { text?: string; type?: string; options?: string[] }
      return {
        text: obj.text ?? '',
        type: (obj.type as QuestionType) ?? 'open_ended',
        options: obj.options,
      }
    })
  } catch {
    return []
  }
}
