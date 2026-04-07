export const dynamic = 'force-dynamic'

import { getAllUsers } from '@/lib/db/queries'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SendersManager } from '@/components/settings/senders-manager'
import { HuntGroupsManager } from '@/components/settings/hunt-groups-manager'
import { RequestLink } from '@/components/settings/request-link'
import { formatDate } from '@/lib/utils'
import { Shield, Users, Clock } from 'lucide-react'

export default async function SettingsPage() {
  const users = await getAllUsers()

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white">Settings</h2>
        <p className="text-sm text-white/50">System configuration and user management</p>
      </div>

      <RequestLink />
      <SendersManager />
      <HuntGroupsManager />

      {/* Cron Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-500" />
            Vercel Cron Jobs
          </CardTitle>
          <CardDescription>Automated background jobs running on Vercel.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pb-2 text-left font-medium text-gray-600">Job</th>
                  <th className="pb-2 text-left font-medium text-gray-600">Schedule</th>
                  <th className="pb-2 text-left font-medium text-gray-600">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[
                  { name: 'poll-inbox-reader', schedule: 'Every 15 min', purpose: 'Read Outlook, detect poll requests' },
                  { name: 'reminder-scheduler', schedule: 'Daily 9:00 AM', purpose: 'Send reminders for active polls' },
                  { name: 'poll-closure-trigger', schedule: 'Every hour', purpose: 'Auto-close polls 48 hrs post-send' },
                  { name: 'rms-retry', schedule: 'Every 30 min', purpose: 'Retry failed RMS task / publish' },
                ].map((job) => (
                  <tr key={job.name}>
                    <td className="py-2.5 font-mono text-xs text-gray-800">{job.name}</td>
                    <td className="py-2.5 text-gray-600">{job.schedule}</td>
                    <td className="py-2.5 text-gray-600">{job.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Decision Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-gray-500" />
            Enforced Decision Rules
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {[
              { rule: 'Never modify requester-provided questions', enforced: true },
              { rule: 'Never skip approval step', enforced: true },
              { rule: 'Never send without Poll Form link', enforced: true },
              { rule: 'Never exceed 4 questions', enforced: true },
              { rule: 'Always create RMS Task (blocking)', enforced: true },
              { rule: 'Always publish on RMS News Panel (blocking)', enforced: true },
              { rule: 'Always upload results before archiving', enforced: true },
              { rule: 'Only process emails from whitelist', enforced: true },
            ].map(({ rule, enforced }) => (
              <li key={rule} className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${enforced ? 'bg-green-500' : 'bg-red-400'}`} />
                <span className="text-gray-700">{rule}</span>
                <Badge variant={enforced ? 'success' : 'destructive'} className="ml-auto text-xs">
                  {enforced ? 'Enforced' : 'Disabled'}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* User Management — Super Admin only */}
      {(
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-500" />
              User Management
            </CardTitle>
            <CardDescription>Super Admin only — manage dashboard users.</CardDescription>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <p className="text-sm text-gray-400">No users found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 text-sm">
                  <thead>
                    <tr>
                      <th className="pb-2 text-left font-medium text-gray-600">Name</th>
                      <th className="pb-2 text-left font-medium text-gray-600">Email</th>
                      <th className="pb-2 text-left font-medium text-gray-600">Role</th>
                      <th className="pb-2 text-left font-medium text-gray-600">Auth</th>
                      <th className="pb-2 text-left font-medium text-gray-600">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="py-2.5 font-medium text-gray-900">{u.name}</td>
                        <td className="py-2.5 text-gray-600">{u.email}</td>
                        <td className="py-2.5">
                          <Badge variant={u.role === 'super_admin' ? 'default' : 'secondary'} className="capitalize text-xs">
                            {u.role.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="py-2.5 capitalize text-gray-600">{u.auth_provider}</td>
                        <td className="py-2.5 text-gray-600">{formatDate(u.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pending Items */}
      <Card className="border-yellow-200 bg-yellow-50">
        <CardHeader>
          <CardTitle className="text-yellow-800">Pending Configuration (Required Before Go-Live)</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-yellow-800">
            {[
              'RMS API base URL + auth method (Steps 5, 9, 11)',
              'RMS API field schema (Task + News Panel)',
              'Azure AD Tenant ID for Microsoft Graph + SSO',
              'HR team to grant "Send As" on polls@koenig-solutions.com',
              'Hunt group email list / distribution lists per department',
              'Working days / Holiday calendar for reminders',
              'Admin user list (names + emails for provisioning)',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0 font-bold">#{i + 1}</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
