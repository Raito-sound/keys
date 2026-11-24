import type { Metadata } from 'next';
import './globals.css';
const webApplication = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'KEYS',
  url: 'https://keys.raito.studio/',
  description:
    'A free browser piano and organ for practice, recording, MIDI export and WAV export.',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Any',
  browserRequirements: 'Requires a modern browser with Web Audio API support.',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: 0, priceCurrency: 'JPY' },
  creator: { '@id': 'https://raito.studio/#person' },
};
export const metadata: Metadata = {
  title: 'KEYS — Online Piano & Organ with Recording | Raito Studio Tools',
  description:
    'Play piano and organ in your browser for free. Practice with a metronome, record short musical ideas and export MIDI or WAV. No installation required.',
  metadataBase: new URL('https://keys.raito.studio'),
  icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }] },
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    url: 'https://keys.raito.studio/',
    title: 'KEYS — Online Piano & Organ with Recording',
    description:
      'Play, practice and capture musical ideas. Free browser piano and organ with MIDI and WAV export.',
    siteName: 'Raito Studio Tools',
  },
  twitter: { card: 'summary' },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webApplication) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
