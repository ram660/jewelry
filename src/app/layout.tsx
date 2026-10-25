import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { openDraftCount } from "@/lib/inbox";

// The inbox badge reads the database on every request, so this layout cannot be built ahead of time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "EFJ Studio",
  description: "Elegant Fashion Jewellery: catalog studio",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  let open = 0;
  try { open = openDraftCount(); } catch { /* a database problem must not take the whole site down */ }
  return (
    <html lang="en-CA">
      {/* Browser extensions such as Grammarly add attributes to <body> before React loads. Ignore those, only on this element. */}
      <body suppressHydrationWarning>
        <header className="bar">
          <Link href="/" className="brand">✦ Elegant Fashion Jewellery · Studio</Link>
          <Link href="/" className="nav">Catalog</Link>
          <Link href="/upload" className="nav">Upload</Link>
          <Link href="/inbox" className="nav">Inbox{open > 0 && <span className="count">{open}</span>}</Link>
          <Link href="/settings" className="nav">Settings</Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
