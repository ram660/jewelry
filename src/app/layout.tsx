import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "EFJ Studio",
  description: "Elegant Fashion Jewellery: catalog studio",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA">
      <body>
        <header className="bar">
          <Link href="/" className="brand">✦ Elegant Fashion Jewellery · Studio</Link>
          <Link href="/" className="nav">Catalog</Link>
          <Link href="/upload" className="nav">Upload</Link>
          <Link href="/settings" className="nav">Settings</Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
