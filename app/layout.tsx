import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Stoniz',
  description: 'Plateforme de gestion de projets Clé en Main',
};

// Sans ce viewport, les navigateurs mobiles rendent la page en 980px
// puis dézooment : aucun breakpoint responsive ne s'applique.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
