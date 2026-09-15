'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertOctagon, Camera, CheckCheck, X } from 'lucide-react';
import {
  createCleaningProofUploadUrl,
  reportCleaningIncidentAction,
  resolveCleaningIncidentAction,
} from '@/app/(team)/propria/menage/actions';
import { uploadToSignedUrl } from '@/lib/media/upload-direct';
import { CleaningProofUploader, type CleaningProof } from './cleaning-proof-uploader';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

export type CleaningIncident = {
  id: string;
  cleaning_id: string;
  description: string;
  severity: 'critique' | 'haute' | 'normale' | 'basse';
  status: 'reported' | 'acknowledged' | 'resolved' | 'declined';
  reported_by: string | null;
  reported_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
};

const SEV_ICON: Record<string, string> = { critique: '🔴', haute: '🟠', normale: '🟡', basse: '🟢' };
const SEV_LABEL: Record<string, string> = { critique: 'Critique', haute: 'Haute', normale: 'Normale', basse: 'Basse' };
const STATUS_BADGE: Record<string, string> = {
  reported: 'bg-red-100 text-red-800',
  acknowledged: 'bg-amber-100 text-amber-800',
  resolved: 'bg-emerald-100 text-emerald-800',
};
const STATUS_LABEL: Record<string, string> = {
  reported: '⚠ Signalé',
  acknowledged: '⚠ Signalé', // rétro-compat des incidents pré-2026-06-09
  resolved: '✓ Résolu',
  declined: '✕ Décliné',
};

/**
 * Section « Incidents à remonter » : liste des incidents existants +
 * formulaire de création. Tout signalement déclenche un email au CEO/assistante.
 */
export function CleaningIncidentsPanel({
  cleaningId,
  incidents,
  proofs,
  uploaderNames,
  canReport,
  canManage,
}: {
  cleaningId: string;
  incidents: CleaningIncident[];
  proofs: CleaningProof[];
  uploaderNames: Record<string, string>;
  canReport: boolean;
  canManage: boolean; // CEO / back-office (peut acquitter/résoudre)
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'critique'|'haute'|'normale'|'basse'>('normale');
  // Chantier 8 (U8) : photo OBLIGATOIRE pour signaler — fichiers choisis avant envoi
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pour les preuves : on les rattache à incidentId via checklist_item_key='incident:<id>'
  const proofsByIncident = new Map<string, CleaningProof[]>();
  for (const p of proofs) {
    if (p.section !== 'incident') continue;
    const id = p.checklistItemKey?.startsWith('incident:') ? p.checklistItemKey.slice(9) : null;
    if (!id) continue;
    const arr = proofsByIncident.get(id) ?? [];
    arr.push(p);
    proofsByIncident.set(id, arr);
  }

  function submit() {
    if (description.trim().length < 3) {
      setErr('Décris l’incident (au moins 3 caractères).');
      return;
    }
    if (files.length === 0) {
      setErr('📸 Au moins une photo est obligatoire — pas de signalement sans preuve.');
      return;
    }
    setErr(null);
    start(async () => {
      try {
        // 1) Upload des preuves vers le bucket (avant création de l'incident)
        const proofs: { storage_path: string; mime_type: string; size_bytes: number }[] = [];
        for (const f of files) {
          const urlRes = await createCleaningProofUploadUrl({
            cleaningId,
            filename: f.name,
            contentType: f.type || 'application/octet-stream',
          });
          if (!urlRes || !urlRes.ok) throw new Error(urlRes?.error ?? 'Upload impossible');
          await uploadToSignedUrl(urlRes.path, urlRes.token, f, 'intervention-proofs');
          proofs.push({
            storage_path: urlRes.path,
            mime_type: f.type || 'application/octet-stream',
            size_bytes: f.size,
          });
        }
        // 2) Création de l'incident avec ses preuves (atomique côté serveur)
        const r = await reportCleaningIncidentAction({
          cleaning_id: cleaningId,
          description: description.trim(),
          severity,
          proofs,
        });
        if (!r || !r.ok) {
          setErr(r?.error ?? 'Échec.');
          return;
        }
        setDescription('');
        setSeverity('normale');
        setFiles([]);
        setShowForm(false);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur pendant l’upload des photos.');
      }
    });
  }

  function resolve(id: string) {
    const notes = window.prompt('Note de résolution (optionnel) :', '');
    setErr(null);
    start(async () => {
      try {
        const r = await resolveCleaningIncidentAction(id, notes && notes.trim() ? notes.trim() : null);
        if (!r || !r.ok) {
          setErr(r?.error ?? 'Erreur inconnue');
          return;
        }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  return (
    <div id="incidents" className="bg-white border border-stoniz-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-lg flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-red-600" />
            Incidents à remonter ({incidents.length})
          </h2>
          <p className="text-xs text-stoniz-gray-500 mt-0.5">
            Canapé sale, télé cassée, dégradation… Le CEO et le back-office sont notifiés par mail.
          </p>
        </div>
        {canReport && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="bg-red-600 text-white px-4 py-2 rounded-md text-sm hover:bg-red-700"
          >
            + Signaler un incident
          </button>
        )}
      </div>

      {showForm && (
        <div className="border border-red-200 bg-red-50/40 rounded-lg p-4 space-y-3">
          <div>
            <label className="block text-xs text-stoniz-gray-600 mb-1">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Ex : Canapé du salon taché, impossible à nettoyer avec produits standards."
              className="w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-stoniz-gray-600 mb-1">Gravité *</label>
            <div className="flex gap-2">
              {(['critique','haute','normale','basse'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={`flex-1 px-3 py-2 rounded-md border text-sm ${severity === s ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white'}`}
                >
                  {SEV_ICON[s]} {SEV_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
          {/* Chantier 8 (U8) : photo obligatoire — gros bouton terrain */}
          <div>
            <label className="block text-xs text-stoniz-gray-600 mb-1">
              Photos de preuve * <span className="text-red-600">(obligatoire)</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (list.length) setFiles((prev) => [...prev, ...list]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending}
              className={`w-full border-2 border-dashed rounded-lg p-4 text-sm flex items-center justify-center gap-2 ${
                files.length > 0
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                  : 'border-red-300 bg-white text-red-700 hover:bg-red-50'
              }`}
            >
              <Camera className="w-5 h-5" />
              {files.length > 0
                ? `✅ ${files.length} photo${files.length > 1 ? 's' : ''} — ajouter encore`
                : '📸 Prendre / choisir une photo'}
            </button>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between text-xs bg-white border border-stoniz-gray-200 rounded px-2 py-1">
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="text-stoniz-gray-500 hover:text-red-600 ml-2"
                      aria-label="Retirer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {err && <SessionExpiredBanner error={err} />}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowForm(false); setDescription(''); setFiles([]); setErr(null); }}
              disabled={pending}
              className="px-4 py-2 rounded-md text-sm border border-stoniz-gray-300 hover:bg-stoniz-gray-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || description.trim().length < 3 || files.length === 0}
              className="bg-red-600 text-white px-4 py-2 rounded-md text-sm hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? 'Envoi…' : 'Signaler & alerter le back-office'}
            </button>
          </div>
        </div>
      )}

      {/* Bandeau d'erreur (cas resolve() hors du formulaire de création) */}
      {err && !showForm && <SessionExpiredBanner error={err} />}

      {incidents.length === 0 && !showForm ? (
        <p className="text-sm text-stoniz-gray-500 italic">Aucun incident signalé sur ce ménage.</p>
      ) : (
        <ul className="space-y-3">
          {incidents.map((inc) => {
            const incProofs = proofsByIncident.get(inc.id) ?? [];
            return (
              <li key={inc.id} className="border border-stoniz-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium">{SEV_ICON[inc.severity]} {SEV_LABEL[inc.severity]}</span>
                      <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full ${STATUS_BADGE[inc.status]}`}>
                        {STATUS_LABEL[inc.status]}
                      </span>
                      <span className="text-[11px] text-stoniz-gray-500">
                        {inc.reported_by && uploaderNames[inc.reported_by] ? uploaderNames[inc.reported_by] : 'Inconnu'}
                        {' · '}
                        {new Date(inc.reported_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                    <p className="text-sm text-stoniz-gray-800">{inc.description}</p>
                    {inc.resolution_notes && (
                      <p className="text-xs text-emerald-700 mt-1">
                        <strong>Résolution :</strong> {inc.resolution_notes}
                      </p>
                    )}
                  </div>
                  {canManage && inc.status !== 'resolved' && inc.status !== 'declined' && (
                    <div className="flex gap-2 flex-shrink-0">
                      <a
                        href="/propria/menage/incidents"
                        className="text-xs border border-blue-300 bg-blue-50 text-blue-800 px-3 py-1 rounded hover:bg-blue-100"
                        title="Aller sur la page incidents pour transformer / résoudre / décliner"
                      >
                        Traiter →
                      </a>
                      <button
                        type="button"
                        onClick={() => resolve(inc.id)}
                        disabled={pending}
                        className="text-xs border border-emerald-300 bg-emerald-50 text-emerald-800 px-3 py-1 rounded hover:bg-emerald-100 inline-flex items-center gap-1"
                      >
                        <CheckCheck className="w-3 h-3" /> Résoudre
                      </button>
                    </div>
                  )}
                </div>
                {/* Preuves de l'incident : photos / vidéos */}
                <CleaningProofUploader
                  cleaningId={cleaningId}
                  proofs={incProofs}
                  uploaderNames={uploaderNames}
                  canUpload={canReport}
                  canDelete={canManage}
                  section="incident"
                  checklistItemKey={`incident:${inc.id}`}
                  compact
                  title={`${incProofs.length} preuve${incProofs.length > 1 ? 's' : ''}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
