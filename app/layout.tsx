import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import config from "@/config";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#6d4aff",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: { default: config.appName, template: `%s · ${config.appName}` },
  description: config.appDescription,
  metadataBase: new URL(`https://${config.domainName}`),
  // Private dashboard — keep it out of search indexes.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${spaceMono.variable}`}
    >
      <body className="min-h-screen bg-warm font-display text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
