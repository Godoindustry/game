import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toasts } from "@/client/ui";

const barlow = Barlow_Condensed({ variable: "--font-barlow", subsets: ["latin"], weight: ["500", "600", "700"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-jb", subsets: ["latin"], weight: ["400", "600"] });

export const metadata: Metadata = {
  title: { default: "Linha de Sobrevivência", template: "%s · Linha de Sobrevivência" },
  description: "Sobrevivência, mistério e decisões com consequências — sozinho ou com até 4 jogadores.",
};

export const viewport: Viewport = { themeColor: "#090c0b", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${barlow.variable} ${inter.variable} ${mono.variable}`}>
      <body>
        {children}
        <Toasts />
      </body>
    </html>
  );
}
