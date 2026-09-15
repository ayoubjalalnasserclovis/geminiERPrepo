import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { BackLink } from '@/components/ui/back-link';
import { PhotoGalleryPageClient } from '@/components/projects/photo-gallery-page-client';

const ENTITY_TYPE_LABELS: Record<string, string> = {
  vct_action:   'Action VCT',
  pv_reserve:   'Réserve PV',
  vct_item:     'Item VCT',
  pv_item:      'Item PV',
  intervention: 'Intervention',
  project:      'Projet',
};

const KIND_LABELS: Record<string, { label: string; cls: string }> = {
  before:    { label: 'Avant',     cls: 'bg-red-100 text-red-800' },
  after:     { label: 'Après',     cls: 'bg-emerald-100 text-emerald-800' },
  verified:  { label: 'Vérifié',   cls: 'bg-blue-100 text-blue-800' },
  defaut:    { label: 'Défaut',    cls: 'bg-orange-100 text-orange-800' },
  reference: { label: 'Référence', cls: 'bg-stoniz-gray-100 text-stoniz-gray-700' },
};

export default async function ProjectPhotosGalleryPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { entity_type?: string; kind?: string };
}) {
  await requireRole(['ceo','chef_projet','developer','assistante']);
  const supabase = createClient();

  const projectId = params.id;
  const { data: project } = await supabase
    .from('projects')
    .select('id, reference, client:clients(full_name)')
    .eq('id', projectId).single();
  if (!project) notFound();

  let query = supabase
    .from('project_photos_enriched')
    .select('id, entity_type, entity_id, kind, storage_path, caption, width, height, uploaded_at, uploaded_by, entity_label')
    .eq('project_id', projectId)
    .order('uploaded_at', { ascending: false });

  if (searchParams.entity_type) {
    query = query.eq('entity_type', searchParams.entity_type);
  }
  if (searchParams.kind) {
    query = query.eq('kind', searchParams.kind);
  }

  const { data: photos } = await query;
  const rows = (photos ?? []) as any[];

  const { data: profiles } = await supabase
    .from('profiles').select('id, full_name').neq('role', 'client');
  const profMap = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));

  // Compte par catégorie pour les filtres
  const { data: counts } = await supabase
    .from('project_photos')
    .select('entity_type, kind').eq('project_id', projectId).is('deleted_at', null);
  const byType = new Map<string, number>();
  const byKind = new Map<string, number>();
  for (const c of counts ?? []) {
    byType.set((c as any).entity_type, (byType.get((c as any).entity_type) ?? 0) + 1);
    byKind.set((c as any).kind, (byKind.get((c as any).kind) ?? 0) + 1);
  }
  const total = counts?.length ?? 0;

  return (
    <div className="space-y-6 max-w-7xl">
      <BackLink href={`/projects/${projectId}`} label={`Retour au projet ${project.reference}`} />

      <div>
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          {project.reference} · Galerie photos
        </div>
        <h1 className="text-3xl font-display">Galerie photos du projet</h1>
        <p className="text-sm text-stoniz-gray-600 mt-1">
          {total} photo{total > 1 ? 's' : ''} archivée{total > 1 ? 's' : ''} sur ce projet
          {(project.client as any)?.full_name && ` · Client : ${(project.client as any).full_name}`}
        </p>
      </div>

      {/* Filtres */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-stoniz-gray-500 uppercase tracking-wider self-center mr-1">Type :</span>
          <Link
            href={`/projects/${projectId}/photos`}
            className={`px-3 py-1 rounded-full border ${
              !searchParams.entity_type
                ? 'bg-stoniz-black text-white border-stoniz-black'
                : 'bg-white border-stoniz-gray-200 hover:bg-stoniz-gray-50'
            }`}
          >Tout ({total})</Link>
          {Array.from(byType.entries()).map(([type, count]) => (
            <Link
              key={type}
              href={`/projects/${projectId}/photos?entity_type=${type}${searchParams.kind ? `&kind=${searchParams.kind}` : ''}`}
              className={`px-3 py-1 rounded-full border ${
                searchParams.entity_type === type
                  ? 'bg-stoniz-black text-white border-stoniz-black'
                  : 'bg-white border-stoniz-gray-200 hover:bg-stoniz-gray-50'
              }`}
            >
              {ENTITY_TYPE_LABELS[type] ?? type} ({count})
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-stoniz-gray-500 uppercase tracking-wider self-center mr-1">Catégorie :</span>
          {Array.from(byKind.entries()).map(([kind, count]) => (
            <Link
              key={kind}
              href={`/projects/${projectId}/photos?kind=${kind}${searchParams.entity_type ? `&entity_type=${searchParams.entity_type}` : ''}`}
              className={`px-3 py-1 rounded-full border ${
                searchParams.kind === kind
                  ? 'bg-stoniz-black text-white border-stoniz-black'
                  : KIND_LABELS[kind]?.cls + ' border-transparent'
              }`}
            >
              {KIND_LABELS[kind]?.label ?? kind} ({count})
            </Link>
          ))}
          {searchParams.kind && (
            <Link
              href={`/projects/${projectId}/photos${searchParams.entity_type ? `?entity_type=${searchParams.entity_type}` : ''}`}
              className="px-3 py-1 rounded-full border bg-stoniz-gray-50 hover:bg-stoniz-gray-100 text-stoniz-gray-600"
            >
              ✕ Effacer le filtre
            </Link>
          )}
        </div>
      </div>

      {/* Galerie */}
      {rows.length === 0 ? (
        <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded-xl p-10 text-center">
          <p className="text-sm text-stoniz-gray-600">
            Aucune photo {searchParams.entity_type || searchParams.kind ? 'pour ce filtre' : 'sur ce projet'}.
          </p>
        </div>
      ) : (
        <PhotoGalleryPageClient
          projectId={projectId}
          photos={rows.map(r => ({
            ...r,
            uploader_name: profMap.get(r.uploaded_by) ?? '—',
            kind_label: KIND_LABELS[r.kind]?.label ?? r.kind,
            kind_cls: KIND_LABELS[r.kind]?.cls ?? '',
            entity_type_label: ENTITY_TYPE_LABELS[r.entity_type] ?? r.entity_type,
          }))}
        />
      )}
    </div>
  );
}
