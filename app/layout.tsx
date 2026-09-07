/* oxlint-disable next/no-page-custom-font -- Global App Router layout, not a page-specific font link. */
import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'KEYS — Online Piano & Organ with Recording | Raito Studio Tools',
  description:
    'Play piano and organ in your browser for free. Practice with a metronome, record short musical ideas and export MIDI or WAV. No installation required.',
  metadataBase: new URL('https://keys.raito.studio'),
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    url: 'https://keys.raito.studio/',
    title: 'KEYS — Online Piano & Organ with Recording',
    description: 'Play, practice and capture musical ideas. Free browser piano and organ with MIDI and WAV export.',
    siteName: 'Raito Studio Tools',
  },
  twitter: { card: 'summary' },
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
