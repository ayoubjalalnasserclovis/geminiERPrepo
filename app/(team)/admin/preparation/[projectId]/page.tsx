import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { dryRunActivateAction } from '../actions';
import { ProjectActivationPanel } from './activation-panel';
import { ClientContactEditor } from './client-contact-editor';
import { AlertCircle, FileText, Calendar, KeyRound } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function PreparationDetailPage({
  params,
}: {
  params: { projectId: string };
}) {
  await requireRole(['ceo', 'developer']);
  const supabase = createClient();

  // Données projet + relations
  const { data: project } = await supabase
    .from('projects')
    .select(`
      id, code, reference, current_phase, status, is_preparation, legacy_imported,
      activated_at, created_at, prepared_at, notion_page_id,
      onboarding_date, compromis_date, acte_authentique_date,
      travaux_start_date, travaux_end_date, livraison_date,
      stoniz_fees_acquisition, stoniz_fees_travaux, stoniz_fees_manual_override,
      stoniz_fees_reduction,
      client:clients(id, full_name, email, phone, nationality),
      property:properties(id, name, quartier, type, superficie, price)
    `)
    .eq('id', params.projectId)
    .single();
  if (!project) notFound();

  const [docsRes, bypassRes] = await Promise.all([
    supabase
      .from('documents')
      .select('id, type, name, storage_path, created_at')
      .eq('project_id', params.projectId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('project_phase_bypass_log')
      .select('from_phase, to_phase, gates_skipped, reason, bypassed_at')
      .eq('project_id', params.projectId)
      .order('bypassed_at', { ascending: true }),
  ]);
  const documents = (docsRes.data ?? []) as any[];
  const bypasses = (bypassRes.data ?? []) as any[];

  // Dry-run pour preview activation
  const dryRun = (project as any).is_preparation
    ? await dryRunActivateAction(params.projectId)
    : null;

  const clientEmail: string = (project as any).client?.email ?? '';
  const isPlaceholder = clientEmail.endsWith('@no-email.stoniz.local');

  return (
    <div className="max-w-6xl">
      <div className="mb-4">
        <Link href="/admin/preparation" className="text-xs text-stoniz-gray-500 hover:text-stoniz-black">
          ← Retour à la liste préparation
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            Projet en préparation
          </div>
          <h1 className="text-3xl font-display">{(project as any).client?.full_name ?? 'Sans client'}</h1>
          <div className="flex items-center gap-2 mt-2 text-sm">
            <code className="px-2 py-0.5 bg-stoniz-beige rounded text-xs">
              {(project as any).code ?? (project as any).reference}
            </code>
            <span className="text-stoniz-gray-500">·</span>
            <span className="text-stoniz-gray-700">phase {(project as any).current_phase}</span>
            <span className="text-stoniz-gray-500">·</span>
            <span className="text-stoniz-gray-700">{(project as any).status}</span>
          </div>
        </div>
      </div>

      {isPlaceholder && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <div className="font-medium text-amber-900">Email placeholder détecté</div>
            <div className="text-amber-800 mt-1">
              Le client n'a pas d'email valide pour l'instant. Édite-le dans la section <strong>Client</strong> ci-dessous
              avant d'activer pour qu'il reçoive l'invitation.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Colonne gauche : 2/3 */}
        <div className="lg:col-span-2 space-y-6">
          {/* Bloc Client */}
          <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
            <h2 className="font-medium mb-3">Client</h2>
            <ClientContactEditor
              clientId={(project as any).client?.id}
              fullName={(project as any).client?.full_name ?? ''}
              email={clientEmail}
              phone={(project as any).client?.phone ?? null}
              isPlaceholder={isPlaceholder}
            />
          </section>

          {/* Bloc Bien */}
          <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
            <h2 className="font-medium mb-3">Bien associé</h2>
            {(project as any).property ? (
              <div className="text-sm space-y-1">
                <div className="font-medium">{(project as any).property.name}</div>
                <div className="text-stoniz-gray-600">
                  {(project as any).property.type} · {(project as any).property.quartier ?? '—'}
                  {(project as any).property.superficie && ` · ${(project as any).property.superficie} m²`}
                </div>
                {(project as any).property.price && (
                  <div className="text-stoniz-gray-700 mt-2">
                    Prix : {Number((project as any).property.price).toLocaleString('fr-FR')} €
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-stoniz-gray-500 italic">Aucun bien lié</div>
            )}
          </section>

          {/* Bloc Dates */}
          <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
            <h2 className="font-medium mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Dates clés
            </h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <DateRow label="Onboarding" value={(project as any).onboarding_date} />
              <DateRow label="Compromis" value={(project as any).compromis_date} />
              <DateRow label="Acte authentique" value={(project as any).acte_authentique_date} />
              <DateRow label="Début travaux" value={(project as any).travaux_start_date} />
              <DateRow label="Fin travaux" value={(project as any).travaux_end_date} />
              <DateRow label="Livraison" value={(project as any).livraison_date} />
            </div>
          </section>

          {/* Bloc Documents */}
          <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
            <h2 className="font-medium mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Documents ({documents.length})
            </h2>
            {documents.length === 0 ? (
              <div className="text-sm text-stoniz-gray-500 italic">Aucun document importé</div>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {documents.map(d => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-stoniz-gray-500 mr-2">{d.type}</span>
                      <span className="truncate">{d.name}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Bloc Bypass log */}
          {bypasses.length > 0 && (
            <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
              <h2 className="font-medium mb-3 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-600" />
                Gates bypassées ({bypasses.length})
              </h2>
              <p className="text-xs text-stoniz-gray-500 mb-3">
                Transitions de phase forcées via le mode préparation. À revoir avant l'activation
                pour s'assurer que les données manquantes ne posent pas problème côté client.
              </p>
              <ul className="space-y-2 text-sm">
                {bypasses.map((b, i) => (
                  <li key={i} className="border-l-2 border-amber-300 pl-3">
                    <div className="font-medium">
                      {b.from_phase ?? '—'} → {b.to_phase}
                    </div>
                    <div className="text-xs text-stoniz-gray-600 mt-0.5">
                      {Array.isArray(b.gates_skipped) ? b.gates_skipped.join(', ') : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Colonne droite : 1/3 — panneau activation */}
        <div className="space-y-6">
          <ProjectActivationPanel
            projectId={params.projectId}
            isPreparation={(project as any).is_preparation}
            isLegacy={(project as any).legacy_imported}
            activatedAt={(project as any).activated_at}
            isPlaceholderEmail={isPlaceholder}
            dryRunSummary={dryRun}
          />
        </div>
      </div>
    </div>
  );
}

function DateRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs text-stoniz-gray-500">{label}</div>
      <div className={`text-sm ${value ? 'font-medium' : 'text-stoniz-gray-400 italic'}`}>
        {value ? new Date(value).toLocaleDateString('fr-FR') : 'non renseigné'}
      </div>
    </div>
  );
}
