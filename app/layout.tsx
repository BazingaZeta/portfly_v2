import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { I18nProvider } from "@/components/I18nProvider";
import { RiskProvider } from "@/components/RiskProvider";
import { getSession } from "@/lib/auth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Finance Bot — Daily Signals",
  description: "Daily news + technical scan with buy/sell tracking",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();

  return (
    <html
      lang="it"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col md:flex-row">
        <I18nProvider>
          <RiskProvider>
            {session && <Nav />}
            <main className={`flex-1 min-w-0 ${session ? "px-4 py-6 md:px-8 md:py-8" : ""}`}>
              {children}
            </main>
          </RiskProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
