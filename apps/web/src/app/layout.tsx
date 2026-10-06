import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import "../index.css";
import "dialkit/styles.css";
import "@/components/dial/tokens.css";
import "@/components/dial/ui.css";
import "@/components/dial/chrome.css";
import "@/components/dial/hud.css";
import "@/components/dial/screens.css";
import "@/components/dial/learn.css";
import "@/components/dial/dial-theme.css";
import Header from "@/components/header";
import Providers from "@/components/providers";
import { ProgressiveReveal } from "@/components/reveal";

// ABC Diatype (UI, headings), Diatype Mono (numbers, codes) and ABC Otto (a rare
// display accent): the same faces and roles as the ditch site.
const diatype = localFont({
  variable: "--font-diatype",
  src: [
    { path: "../fonts/ABCDiatype-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ABCDiatype-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ABCDiatype-Bold.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "Arial", "sans-serif"],
});

const diatypeMono = localFont({
  variable: "--font-diatype-mono",
  src: [
    { path: "../fonts/ABCDiatypeMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ABCDiatypeMono-Medium.woff2", weight: "500", style: "normal" },
  ],
  display: "swap",
  fallback: ["ui-monospace", "Menlo", "monospace"],
});

const otto = localFont({
  variable: "--font-otto",
  src: [{ path: "../fonts/ABCOtto-Regular.woff2", weight: "400", style: "normal" }],
  display: "swap",
  fallback: ["Georgia", "serif"],
  preload: false,
});

export const metadata: Metadata = {
  title: { default: "Carcassonne", template: "%s · Carcassonne" },
  description: "Lay tiles, claim cities, roads and fields. Play against bots, friends on one device, or online.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4ead8" },
    { media: "(prefers-color-scheme: dark)", color: "#161412" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${diatype.variable} ${diatypeMono.variable} ${otto.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          <div className="bg-parchment relative flex h-svh flex-col">
            <Header />
            <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
            <ProgressiveReveal />
          </div>
        </Providers>
      </body>
    </html>
  );
}
