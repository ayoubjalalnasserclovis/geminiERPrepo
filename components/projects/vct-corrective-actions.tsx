'use client';

import { useRef, useState, useTransition } from 'react';
import { MessageCircle, Check, CircleDot, Hammer, Coins, X, Calendar } from 'lucide-react';
import {
  createCorrectiveActionAction,
  markActionNotifiedAction,
  setActionStatusAction,
  convertActionToInterventionAction,
} from '@/app/(team)/projects/[id]/reception/actions';
import { PhotoGallery, type Photo } from './photo-gallery';

export type CorrectiveAction = {
  id: string;
  description: string;
  artisan_id: string | null;
  responsible_role: string | null;
  deadline: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'verified' | 'cancelled';
  notified_at: string | null;
  notified_via: string | null;
  resolved_at: string | null;
  intervention_id: string | null;
  photos: Photo[];
};

export type ArtisanOpt = {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  speciality: string | null;
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  open:        { label: '🔴 À traiter',     cls: 'bg-red-100 text-red-800' },
  in_progress: { label: '🛠 En cours',      cls: 'bg-orange-100 text-orange-800' },
  resolved:    { label: '✓ Corrigé',        cls: 'bg-blue-100 text-blue-800' },
  verified:    { label: '✅ Vérifié',       cls: 'bg-emerald-100 text-emerald-800' },
  cancelled:   { label: '✕ Annulé',         cls: 'bg-stoniz-gray-200 text-stoniz-gray-600' },
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('fr-FR');
}

function whatsAppLink(phone: string, message: string): string {
  // Normalisation : retire espaces, tirets, parenthèses, points
  const cleaned = phone.replace(/[\s\-().]/g, '');
  // Maroc : ajoute +212 si commence par 0
  const withCountry = cleaned.startsWith('0') ? '+212' + cleaned.slice(1) : cleaned;
  return `https://wa.me/${withCountry.replace('+', '')}?text=${encodeURIComponent(message)}`;
}

export function VctCorrectiveActions({
  vctId,
  projectId,
  projectReference,
  actions,
  artisans,
  showEditableForm = true,
}: {
  vctId: string;
  projectId: string;
  projectReference: string;
  actions: CorrectiveAction[];
  artisans: ArtisanOpt[];
  showEditableForm?: boolean;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const artisanMap = new Map(artisans.map(a => [a.id, a]));

  const openCount = actions.filter(a => !['verified','cancelled'].includes(a.status)).length;

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await createCorrectiveActionAction(fd);
        formRef.current?.reset();
        setShowAddForm(false);
      } catch (err: any) {
        alert(err?.message ?? 'Erreur ajout action');
      }
    });
  }

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
      <header className="px-4 py-3 bg-stoniz-gray-50 border-b border-stoniz-gray-200 flex items-center justify-between">
        <div>
          <h3 className="font-medium">🔧 Actions correctives</h3>
          <p className="text-xs text-stoniz-gray-600 mt-0.5">
            {openCount > 0
              ? `${openCount} action(s) à traiter avant la livraison`
              : 'Aucune action ouverte'}
          </p>
        </div>
        {showEditableForm && !showAddForm && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="text-xs bg-stoniz-black text-white px-3 py-1.5 rounded hover:bg-stoniz-gray-800"
          >
            + Nouvelle action
          </button>
        )}
      </header>

      {showAddForm && (
        <form
          ref={formRef}
          onSubmit={handleAdd}
          className="p-4 bg-stoniz-gray-50 border-b border-stoniz-gray-200 space-y-3"
        >
          <input type="hidden" name="vct_id" value={vctId} />
          <input type="hidden" name="project_id" value={projectId} />
          <textarea
            name="description"
            required
            rows={2}
            placeholder="Description de l'action à corriger (ex: Reprise peinture du WC, traces de coulure)"
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <select
              name="artisan_id"
              className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            >
              <option value="">— Artisan responsable (optionnel) —</option>
              {artisans.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.speciality ? ` · ${a.speciality}` : ''}
                </option>
              ))}
            </select>
            <select
              name="responsible_role"
              defaultValue="artisan"
              className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            >
              <option value="artisan">Artisan</option>
              <option value="stoniz">Stoniz</option>
            </select>
            <input
              name="deadline"
              type="date"
              className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs text-stoniz-gray-600 hover:text-stoniz-black px-3 py-1.5"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="text-xs bg-stoniz-black text-white px-4 py-1.5 rounded disabled:opacity-50"
            >
              {isPending ? 'Ajout…' : '+ Ajouter l\'action'}
            </button>
          </div>
        </form>
      )}

      {actions.length === 0 ? (
        <div className="p-8 text-center text-sm text-stoniz-gray-500">
          Aucune action corrective.
          {showEditableForm && ' Identifie les défauts via la checklist et ajoute-les ici.'}
        </div>
      ) : (
        <ul className="divide-y divide-stoniz-gray-100">
          {actions.map(action => {
            const artisan = action.artisan_id ? artisanMap.get(action.artisan_id) : null;
            const isOverdue = action.deadline && new Date(action.deadline) < new Date() &&
              !['verified','cancelled'].includes(action.status);
            const message = `Bonjour ${artisan?.name ?? ''}, action à réaliser sur le chantier ${projectReference} : ${action.description}${action.deadline ? `. Deadline : ${fmtDate(action.deadline)}` : ''}. Merci. — Stoniz`;
            return (
              <li key={action.id} className="p-4 hover:bg-stoniz-gray-50">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{action.description}</p>
                    {/* Photos preuve avant/après correction */}
                    <PhotoGallery
                      projectId={projectId}
                      entityType="vct_action"
                      entityId={action.id}
                      photos={action.photos ?? []}
                      canEdit={!['verified','cancelled'].includes(action.status)}
                      compact
                    />
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-stoniz-gray-600 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full ${STATUS_LABEL[action.status]?.cls}`}>
                        {STATUS_LABEL[action.status]?.label}
                      </span>
                      {artisan && (
                        <span className="inline-flex items-center gap-1">
                          <Hammer className="w-3 h-3" />
                          {artisan.name}
                          {artisan.speciality && ` (${artisan.speciality})`}
                        </span>
                      )}
                      {action.responsible_role === 'stoniz' && (
                        <span className="inline-flex items-center gap-1 text-stoniz-black">
                          <CircleDot className="w-3 h-3" />
                          Responsable Stoniz
                        </span>
                      )}
                      {action.deadline && (
                        <span className={`inline-flex items-center gap-1 ${isOverdue ? 'text-red-700 font-medium' : ''}`}>
                          <Calendar className="w-3 h-3" />
                          {fmtDate(action.deadline)}
                          {isOverdue && ' (en retard)'}
                        </span>
                      )}
                      {action.notified_at && (
                        <span className="text-emerald-700 inline-flex items-center gap-1">
                          <MessageCircle className="w-3 h-3" />
                          notifié le {fmtDate(action.notified_at)}
                        </span>
                      )}
                      {action.intervention_id && (
                        <span className="text-blue-700 inline-flex items-center gap-1">
                          <Coins className="w-3 h-3" />
                          Intervention créée
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    {/* WhatsApp — préfère le numéro WhatsApp dédié, sinon fallback sur le téléphone */}
                    {(artisan?.whatsapp || artisan?.phone) && !action.notified_at && (
                      <a
                        href={whatsAppLink(artisan.whatsapp || artisan.phone!, message)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          startTransition(async () => {
                            try {
                              await markActionNotifiedAction(action.id, projectId, 'whatsapp');
                            } catch (e: any) {
                              console.error(e);
                            }
                          });
                        }}
                        className="text-xs bg-emerald-600 text-white px-3 py-1 rounded hover:bg-emerald-700 inline-flex items-center gap-1"
                        title="Envoyer un message WhatsApp à l'artisan"
                      >
                        <MessageCircle className="w-3 h-3" />
                        WhatsApp
                      </a>
                    )}

                    {/* Workflow d'état */}
                    {action.status === 'open' && (
                      <form action={async () => {
                        await setActionStatusAction(action.id, projectId, 'in_progress');
                      }}>
                        <button className="text-xs text-stoniz-gray-600 hover:text-stoniz-black underline">
                          Marquer en cours
                        </button>
                      </form>
                    )}
                    {action.status === 'in_progress' && (
                      <form action={async () => {
                        await setActionStatusAction(action.id, projectId, 'resolved');
                      }}>
                        <button className="text-xs text-blue-700 hover:underline">
                          Marquer corrigé
                        </button>
                      </form>
                    )}
                    {(action.status === 'resolved' || action.status === 'in_progress') && (
                      <form action={async () => {
                        await setActionStatusAction(action.id, projectId, 'verified');
                      }}>
                        <button className="text-xs text-emerald-700 hover:underline">
                          ✓ Vérifier
                        </button>
                      </form>
                    )}

                    {!action.intervention_id && !['verified','cancelled'].includes(action.status) && (
                      <form action={async () => {
                        await convertActionToInterventionAction(action.id, projectId);
                      }}>
                        <button
                          className="text-[11px] text-stoniz-gray-500 hover:text-stoniz-black underline"
                          title="Crée une intervention pour tracer un coût additionnel"
                        >
                          💰 Convertir en intervention
                        </button>
                      </form>
                    )}

                    {!['verified','cancelled'].includes(action.status) && (
                      <form action={async () => {
                        await setActionStatusAction(action.id, projectId, 'cancelled');
                      }}>
                        <button
                          className="text-[11px] text-red-600 hover:underline"
                          title="Annuler cette action (faux positif)"
                        >
                          <X className="w-3 h-3 inline" /> Annuler
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
