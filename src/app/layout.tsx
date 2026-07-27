import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gestionale Baccanalia",
  description: "Gestione tavoli, comande e cassa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
