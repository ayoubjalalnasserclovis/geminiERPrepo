import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import {
  createProviderAction,
  toggleProviderActiveAction,
} from '../actions';

export default async function ProvidersSettingsPage() {
  await requireRole(['ceo','developer','propria']);
  const supabase = createClient();

  const [provRes, typesRes] = await Promise.all([
    supabase.from('propria_providers')
      .select('id, name, function, phone, email, indicative_rate, is_active')
      .is('deleted_at', null)
      .order('name'),
    supabase.from('propria_intervention_types')
      .select('id, name, category, is_active')
      .order('display_order'),
  ]);

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria/interventions" className="hover:text-stoniz-black">Interventions</Link> · Paramètres
        </div>
        <h1 className="text-2xl md:text-3xl font-display">Prestataires & types</h1>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Prestataires */}
        <section>
          <h2 className="font-display text-lg mb-3">Prestataires externes</h2>
          <form action={async (fd) => {
            'use server';
            await createProviderAction(fd);
          }} className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-3 space-y-2">
            <input
              name="name" required placeholder="Nom (ex: Abdellatif)"
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
            <input
              name="function" placeholder="Fonction (ex: Plomberie / Tout)"
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
            <input
              name="phone" placeholder="Téléphone"
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
            <input
              name="indicative_rate" placeholder="Tarif indicatif (forfait, etc.)"
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
            <button className="w-full bg-stoniz-black text-white py-2 rounded text-sm hover:bg-stoniz-gray-800">
              + Ajouter
            </button>
          </form>

          <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">Nom</th>
                  <th className="px-3 py-2 text-left">Fonction</th>
                  <th className="px-3 py-2 text-left">Tél</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stoniz-gray-100">
                {(provRes.data ?? []).map((p: any) => (
                  <tr key={p.id} className={p.is_active ? '' : 'opacity-50'}>
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2 text-xs">{p.function ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{p.phone ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <form action={async () => {
                        'use server';
                        await toggleProviderActiveAction(p.id, !p.is_active);
                      }}>
                        <button className="text-xs text-stoniz-gray-600 hover:text-stoniz-black">
                          {p.is_active ? 'Désactiver' : 'Réactiver'}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Types */}
        <section>
          <h2 className="font-display text-lg mb-3">Types d'intervention</h2>
          <p className="text-xs text-stoniz-gray-600 mb-3">
            Catalogue géré côté base. Les types pré-seedés sont actifs par défaut.
          </p>
          <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">Nom</th>
                  <th className="px-3 py-2 text-left">Catégorie</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stoniz-gray-100">
                {(typesRes.data ?? []).map((t: any) => (
                  <tr key={t.id} className={t.is_active ? '' : 'opacity-50'}>
                    <td className="px-3 py-2">{t.name}</td>
                    <td className="px-3 py-2 text-xs">{t.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
