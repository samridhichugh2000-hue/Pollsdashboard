import NextAuth from 'next-auth'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { getUserByEmail } from '@/lib/db/queries'

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
      authorization: {
        params: {
          scope: 'openid profile email offline_access Mail.Read Mail.Send User.Read',
          tenant: process.env.AZURE_AD_TENANT_ID,
        },
      },
    }),
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
    jwt: async ({ token, user, account }) => {
      if (user) {
        token.role = (user as Record<string, unknown>).role
        token.userId = user.id
      }
      if (account?.access_token) {
        token.accessToken = account.access_token
      }
      return token
    },
    session: async ({ session, token }) => {
      if (token) {
        (session.user as unknown as Record<string, unknown>).role = token.role
        ;(session.user as unknown as Record<string, unknown>).id = token.userId
        ;(session as unknown as Record<string, unknown>).accessToken = token.accessToken
      }
      return session
    },
  },
  session: { strategy: 'jwt' },
})
