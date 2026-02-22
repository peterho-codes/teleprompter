import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Textream Web — Real-time Teleprompter",
  description: "A browser-based teleprompter that highlights your script as you speak.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
