import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

// Root-cause fix: almost every API route and every /(dashboard) page had zero
// server-side auth check — each route relied on the caller having gone through
// the UI, which anyone with the URL (or curl) could simply skip. This gates
// everything by default and only lets through the paths that are genuinely
// meant to be public: the login page, the external poll-request/respond/approve
// flows (which use their own token/email-based checks), NextAuth's own
// handlers, and the secret-header-protected cron/db-init endpoints.
const PUBLIC_PAGE_PATHS = new Set(['/login', '/request'])
const PUBLIC_PAGE_PREFIXES = ['/respond/', '/approve/']
const PUBLIC_API_PREFIXES = ['/api/auth', '/api/cron', '/api/db-init', '/api/public', '/api/respond', '/api/approve']

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

function isPublicPagePath(pathname: string): boolean {
  if (PUBLIC_PAGE_PATHS.has(pathname)) return true
  return PUBLIC_PAGE_PREFIXES.some(p => pathname.startsWith(p))
}

export default auth((req) => {
  const { pathname } = req.nextUrl

  if (pathname.startsWith('/api/')) {
    if (isPublicApiPath(pathname)) return NextResponse.next()
    if (!req.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.next()
  }

  if (isPublicPagePath(pathname)) return NextResponse.next()
  if (!req.auth) {
    const loginUrl = new URL('/login', req.nextUrl.origin)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }
  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
