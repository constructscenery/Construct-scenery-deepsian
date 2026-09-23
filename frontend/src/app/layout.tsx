import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { UIPreferencesProvider } from "@/contexts/UIPreferencesContext";
import AppShell from "@/components/AppShell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Construct Scenery Database",
  description: "Construct Scenery Database management platform",
  icons: {
    icon: "/construct scenery logo.png",
    apple: "/construct scenery logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} h-full antialiased`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var migrated = localStorage.getItem('cs_ui_v2');
                if (!migrated) {
                  localStorage.removeItem('cs_theme');
                  localStorage.removeItem('cs_sidebar_icons');
                  localStorage.setItem('cs_ui_v2', 'true');
                }
                var theme = localStorage.getItem('cs_theme');
                if (theme === 'light') {
                  document.documentElement.classList.remove('dark');
                  document.documentElement.style.colorScheme = 'light';
                } else {
                  document.documentElement.classList.add('dark');
                  document.documentElement.style.colorScheme = 'dark';
                }
              } catch (_) {}
            `,
          }}
        />
      </head>
      <body className="h-full bg-slate-50 text-slate-900 font-sans transition-colors duration-150">
        <AuthProvider>
          <UIPreferencesProvider>
            <AppShell>{children}</AppShell>
          </UIPreferencesProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
