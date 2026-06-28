import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Polls Dashboard | Koenig Solutions HR",
  description: "HR Poll Lifecycle Management Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Default to dark mode; respect saved preference */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t=localStorage.getItem('theme')||'dark';if(t==='dark')document.documentElement.classList.add('dark');})()` }} />
      </head>
      <body className={`${inter.className} h-full bg-gray-50 dark:bg-[#0f1117]`}>{children}</body>
    </html>
  );
}
