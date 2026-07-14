import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { getUserByEmail } from '@/lib/db/queries'

// Microsoft Entra ID SSO was removed — it requires a redirect URI to be
// registered in the Azure App Registration (AADSTS900971), which was never
// completed. Email sending still works independently via app-only Graph
// credentials in lib/graph.ts (client-credentials flow, not tied to this).
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials) => {
        if (!credentials?.email || !credentials?.password) return null

        const user = await getUserByEmail(credentials.email as string)
        if (!user) return null

        const passwordHash = (user as unknown as Record<string, unknown>).password_hash as string | null
        if (!passwordHash) return null

        const isValid = await bcrypt.compare(credentials.password as string, passwordHash)
        if (!isValid) return null

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        }
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = (user as Record<string, unknown>).role
        token.userId = user.id
      }
      return token
    },
    session: async ({ session, token }) => {
      if (token) {
        (session.user as unknown as Record<string, unknown>).role = token.role
        ;(session.user as unknown as Record<string, unknown>).id = token.userId
      }
      return session
    },
  },
  session: { strategy: 'jwt' },
})
