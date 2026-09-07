/* oxlint-disable next/no-page-custom-font -- Global App Router layout, not a page-specific font link. */
import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'KEYS — Play / Practice / Capture',
  description:
    'A browser keyboard by Raito. Play piano and organ, practice with a metronome, and capture musical ideas.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
