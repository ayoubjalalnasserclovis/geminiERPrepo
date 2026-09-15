import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import {
  createCleaningTypeAction,
  updateCleaningTypeAction,
  toggleCleaningTypeActiveAction,
} from '../actions';

export default async function CleaningTypesSettingsPage() {
  await requireRole(['ceo', 'assistante']);
  const supabase = createClient();

  const { data: types } = await supabase
    .from('propria_cleaning_types')
    .select('id, name, display_order, is_active, created_at')
    .order('display_order');

  return (
    <div className="max-w-3xl">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · '}
        <Link href="/propria/menage" className="hover:text-stoniz-black">Ménage</Link>
        {' · Types'}
      </div>
      <h1 className="text-2xl md:text-3xl font-display mb-6">Types de ménage</h1>

      {/* Liste des types */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
            <tr>
              <th className="px-3 py-3 text-left">Nom</th>
              <th className="px-3 py-3 text-left">Ordre</th>
              <th className="px-3 py-3 text-center">Actif</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {(types ?? []).map((t: any) => (
              <tr key={t.id} className="hover:bg-stoniz-gray-50">
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="px-3 py-2 text-stoniz-gray-600">{t.display_order}</td>
                <td className="px-3 py-2 text-center">
                  <form action={async () => {
                    'use server';
                    await toggleCleaningTypeActiveAction(t.id, !t.is_active);
                  }}>
                    <button
                      type="submit"
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        t.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-stoniz-gray-100 text-stoniz-gray-500'
                      }`}
                      title={t.is_active ? 'Désactiver' : 'Réactiver'}
                    >
                      {t.is_active ? '✓ Actif' : '○ Inactif'}
                    </button>
                  </form>
                </td>
                <td className="px-3 py-2">
                  <details>
                    <summary className="cursor-pointer text-xs text-stoniz-gray-500 hover:text-stoniz-black">
                      Modifier
                    </summary>
                    <form
                      action={async (fd) => {
                        'use server';
                        await updateCleaningTypeAction(t.id, fd);
                      }}
                      className="mt-2 flex gap-2"
                    >
                      <input
                        type="text" name="name" defaultValue={t.name} required
                        className="text-xs border border-stoniz-gray-300 rounded px-2 py-1 flex-1"
                      />
                      <input
                        type="number" name="display_order" defaultValue={t.display_order}
                        className="text-xs border border-stoniz-gray-300 rounded px-2 py-1 w-16"
                      />
                      <button type="submit" className="text-xs bg-stoniz-black text-white rounded px-2 py-1">OK</button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Création */}
      <h2 className="text-sm uppercase text-stoniz-gray-500 mb-2">Ajouter un type</h2>
      <form action={createCleaningTypeAction} className="bg-white border border-stoniz-gray-200 rounded-xl p-4 flex gap-2">
        <input
          type="text" name="name" placeholder="Ex : Ménage post-travaux" required
          className="text-sm border border-stoniz-gray-300 rounded px-3 py-2 flex-1"
        />
        <input
          type="number" name="display_order" defaultValue={99} title="Ordre d'affichage"
          className="text-sm border border-stoniz-gray-300 rounded px-3 py-2 w-20"
        />
        <button type="submit" className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm">
          + Ajouter
        </button>
      </form>
    </div>
  );
}
