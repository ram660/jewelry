import InboxClient from "./InboxClient";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  return (
    <>
      <h1>Instagram inbox</h1>
      <p className="muted">
        Customer messages and comments, with a draft reply written from your product records and knowledge base. Nothing is sent until you
        approve it. See <code>docs/INSTAGRAM.md</code> for how messages reach this page.
      </p>
      <InboxClient />
    </>
  );
}
