import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: {
    default: "Legible — accessibility reports for small business websites",
    template: "%s · Legible",
  },
  description: "Legible tests your site against WCAG 2.1 AA and shows you exactly what to fix.",
  openGraph: {
    title: "Legible — accessibility reports for small business websites",
    description: "Legible tests your site against WCAG 2.1 AA and shows you exactly what to fix.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#161826",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The "js" and "gate-seen" classes let CSS show or skip script-only UI
    // (the landing page's loading gate) without a flash; they are set before
    // first paint, so React is told not to treat them as a mismatch.
    <html lang="en-GB" className={inter.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            // "gate-seen": the landing page's loading screen has been shown
            // once in this browser, so return visits skip it.
            __html:
              "document.documentElement.classList.add('js');try{if(localStorage.getItem('legible-gate-seen'))document.documentElement.classList.add('gate-seen')}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
