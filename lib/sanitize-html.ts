'use client'

import DOMPurify from 'dompurify'

// Real HTML sanitizer for content that gets rendered via dangerouslySetInnerHTML
// or inserted into a contentEditable surface. sanitizeWordHtml() in lib/utils.ts
// only strips Word/Outlook clipboard cruft — it is not a security boundary and
// will pass through <script>, event handlers, and javascript: URLs untouched.
// This is the actual XSS guard and must run before any of that content is
// rendered as HTML or reinserted into the editor.
export function sanitizeHtml(html: string): string {
  if (!html) return html
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    ALLOW_DATA_ATTR: false,
  })
}
