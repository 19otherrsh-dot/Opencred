import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { ServiceWorkerRegistration } from '@/components/service-worker';
import { PRODUCT, PUBLIC_URL } from '@/lib/config';

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_URL),
  title: {
    default: `${PRODUCT.name} — ${PRODUCT.tagline}`,
    template: `%s · ${PRODUCT.name}`,
  },
  description:
    'Issue, verify and manage digital certificates and Open Badges 3.0. Open source, self-hostable, API-first, transparently priced.',
  applicationName: PRODUCT.name,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: PRODUCT.name, statusBarStyle: 'default' },
  openGraph: {
    type: 'website',
    siteName: PRODUCT.name,
    title: `${PRODUCT.name} — ${PRODUCT.tagline}`,
  },
  // Verification pages are meant to be found and followed, not indexed as
  // content; individual pages override this where it matters.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f17' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/*
          A skip link is the cheapest accessibility win there is: without it,
          keyboard users tab through the whole navigation on every page.
        */}
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <AuthProvider>{children}</AuthProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
