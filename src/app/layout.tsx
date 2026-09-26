import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter, JetBrains_Mono, Press_Start_2P, VT323 } from "next/font/google";
import "./globals.css";
import "./retro.css";
import "./world.css";
import { Toasts } from "@/client/ui";
import { Pwa } from "@/client/Pwa";

const barlow = Barlow_Condensed({ variable: "--font-barlow", subsets: ["latin"], weight: ["500", "600", "700"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-jb", subsets: ["latin"], weight: ["400", "600"] });
// Fontes bitmap do tema retrô (retro.css): títulos/botões e texto de LCD.
const pixel = Press_Start_2P({ variable: "--font-pixel", subsets: ["latin"], weight: "400" });
const lcd = VT323({ variable: "--font-lcd", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: { default: "Linha de Sobrevivência", template: "%s · Linha de Sobrevivência" },
  description: "Sobrevivência, mistério e decisões com consequências — sozinho ou com até 4 jogadores.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Linha de Sobrevivência",
  },
};

export const viewport: Viewport = {
  themeColor: "#07050a",
  width: "device-width",
  initialScale: 1,
  // Ocupa a tela toda no iPhone (notch); o CSS respeita env(safe-area-inset-*).
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${barlow.variable} ${inter.variable} ${mono.variable} ${pixel.variable} ${lcd.variable}`}>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#07050a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icons/apple-icon-180.png" />
      </head>
      <body>
        {children}
        <Toasts />
        <Pwa />
      </body>
    </html>
  );
}
