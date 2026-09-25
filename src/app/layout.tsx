import type { Metadata, Viewport } from 'next';
import '@fontsource/noto-sans-devanagari/devanagari-400.css';
import '@fontsource/noto-sans-devanagari/devanagari-500.css';
import '@fontsource/noto-sans-devanagari/devanagari-600.css';
import './globals.css';
import { LanguageProvider } from '@/lib/i18n/client';
import { FirebaseAuthProvider } from '@/lib/firebase/auth-context';
import { OfflineStatus } from '@/components/offline/OfflineStatus';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/brand';

export const metadata: Metadata = {
  title: {
    default: `${PRODUCT_NAME} - a browser electronics lab`,
    template: `%s · ${PRODUCT_NAME}`,
  },
  description: PRODUCT_TAGLINE,
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0b0e11',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-[var(--color-accent)] focus:px-3 focus:py-2 focus:text-black"
        >
          Skip to content
        </a>
        <LanguageProvider>
          <FirebaseAuthProvider>
            {children}
            <OfflineStatus />
          </FirebaseAuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
