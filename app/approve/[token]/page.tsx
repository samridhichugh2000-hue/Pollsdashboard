import { ApprovePageClient } from './client'

export default async function ApprovePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const sp = await searchParams
  const raw = typeof sp.mode === 'string' ? sp.mode : ''
  const initialMode = (raw === 'edit' || raw === 'reject' || raw === 'feedback') ? raw : 'view' as const

  return <ApprovePageClient token={token} initialMode={initialMode} />
}
