import Link from 'next/link';
import Image from 'next/image';
import { LoginForm } from './login-form';

export default function LoginPage({ searchParams }: { searchParams: { redirectTo?: string; error?: string } }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-cream relative overflow-hidden">
      {/* Forme blob jaune décorative en arrière-plan */}
      <div
        className="absolute -top-32 -right-32 w-[600px] h-[600px] opacity-60 pointer-events-none"
        style={{
          backgroundImage: 'url(/shape-yellow.svg)',
          backgroundSize: 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'top right',
        }}
      />

      <div className="w-full max-w-md bg-white rounded-md border border-grey-line p-10 shadow-[0_2px_8px_rgba(10,10,10,0.04)] relative">
        <div className="mb-8">
          <img src="/logo-full.svg" alt="Stoniz" className="h-8 w-auto text-stoniz-black" />
          <p className="eyebrow mt-4">Espace privé</p>
          <h1 className="font-display text-2xl mt-1">Connectez-vous à votre <mark>espace</mark></h1>
        </div>

        {searchParams.error && (
          <div className="mb-4 rounded-sm bg-red-50 border border-red-200 p-3 text-sm text-red-800">
            {decodeURIComponent(searchParams.error)}
          </div>
        )}

        <LoginForm redirectTo={searchParams.redirectTo ?? '/'} />

        <div className="mt-6 text-center text-sm">
          <Link href="/reset-password" className="text-grey-text hover:text-stoniz-black underline underline-offset-2">
            Mot de passe oublié ?
          </Link>
        </div>
      </div>
    </div>
  );
}
