import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="font-display text-6xl mb-2">404</h1>
        <p className="text-stoniz-gray-500 mb-6">Cette page n'existe pas.</p>
        <Link href="/" className="underline">Retour à l'accueil</Link>
      </div>
    </div>
  );
}
