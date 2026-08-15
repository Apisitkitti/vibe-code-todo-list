import type { Metadata } from "next";

import { Toast } from "@heroui/react";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Todos",
  description: "A private todo list.",
};

/**
 * Applies the resolved theme before first paint so there is no flash of the
 * wrong theme (`docs/PRD.md` NFR-06). It reads the same storage key that
 * HeroUI's `useTheme` writes (`heroui-theme`) and performs the same DOM
 * write, so the hook stays the only thing that *changes* the theme.
 */
const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem("heroui-theme")||"system";var r=t==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;document.documentElement.classList.add(r);document.documentElement.setAttribute("data-theme",r);}catch(e){}})();`;

const RootLayout = ({ children }: LayoutProps<"/">) => {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">
        {children}
        <Toast.Provider placement="bottom" />
      </body>
    </html>
  );
};

export default RootLayout;
