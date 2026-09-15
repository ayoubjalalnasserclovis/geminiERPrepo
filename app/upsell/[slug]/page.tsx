import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { UPSELL_CATEGORIES, UPSELL_CATEGORY_LABELS, UPSELL_CATEGORY_PUBLIC } from '@/lib/propria/upsell';
import { UpsellOrderForm } from './order-form';

// Page PUBLIQUE (QR code dans le logement). Pas d'auth, pas de cache long :
// le slug est non-devinable, la seule donnée affichée est le nom commercial
// du logement (déjà public sur Airbnb/Booking). Rien d'autre ne sort.
export const dynamic = 'force-dynamic';

export default async function UpsellPublicPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  // Garde stricte sur le format avant toute requête.
  if (!/^[a-f0-9]{8,64}$/.test(slug)) notFound();

  const admin = createAdminClient();
  const { data: unit } = await admin
    .from('propria_units')
    .select('id')
    .eq('upsell_slug', slug)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (!unit) notFound();

  // Nom commercial = nom du listing Hostaway (déjà public). JAMAIS le code
  // interne du lot (contient le nom du client propriétaire).
  const { data: listing } = await admin
    .from('hostaway_listings')
    .select('name')
    .eq('propria_unit_id', (unit as any).id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  const unitName = (listing as any)?.name || 'Votre logement';

  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      {/* ─── En-tête ──────────────────────────────────────────────────── */}
      <header className="text-center mb-8">
        <div className="text-xs uppercase tracking-[0.2em] text-stone-500 mb-2">
          Propria · Conciergerie
        </div>
        <h1 className="text-2xl font-semibold text-stone-900">{unitName}</h1>
        <p className="text-sm text-stone-600 mt-3">
          Bienvenue ! Commandez un service, notre équipe vous contacte rapidement.
        </p>
        <p className="text-xs text-stone-400 mt-1">
          Welcome! Order a service — our team will get back to you shortly.
        </p>
      </header>

      {/* ─── Les 6 services ───────────────────────────────────────────── */}
      <section className="space-y-3 mb-10">
        {UPSELL_CATEGORIES.map((cat) => {
          const info = UPSELL_CATEGORY_PUBLIC[cat];
          return (
            <div key={cat} className="bg-white border border-stone-200 rounded-xl p-4 flex gap-3">
              <div className="text-2xl leading-none mt-0.5">{info.emoji}</div>
              <div>
                <div className="font-medium text-stone-900 text-sm">
                  {UPSELL_CATEGORY_LABELS[cat]}
                </div>
                <p className="text-sm text-stone-600 mt-0.5">{info.fr}</p>
                <p className="text-xs text-stone-400 mt-0.5 italic">{info.en}</p>
              </div>
            </div>
          );
        })}
      </section>

      {/* ─── Formulaire de commande ───────────────────────────────────── */}
      <section className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-900 mb-1">
          Commander un service
        </h2>
        <p className="text-xs text-stone-500 mb-5">
          Order a service — no online payment, we confirm the price with you first.
        </p>
        <UpsellOrderForm slug={slug} />
      </section>

      <footer className="text-center text-xs text-stone-400 mt-8">
        Service proposé par Propria — l’équipe de gestion de votre logement.
      </footer>
    </main>
  );
}
