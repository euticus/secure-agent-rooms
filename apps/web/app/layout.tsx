import type { Metadata } from "next";
import { Archivo, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { AppChrome } from "./nav";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-archivo",
  display: "swap",
});
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-source-serif",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Secure Agent Rooms",
  description: "Secure cross-company AI collaboration",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${sourceSerif.variable} ${mono.variable}`}>
      <head>
        {/* Runtime config, so the API URL is a restart-time change rather than
            a rebuild. Synchronous on purpose: it must be set before hydration. */}
        <script src="/config.js" />
      </head>
      <body>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
