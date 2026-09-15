'use client';

import { useState, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { allocateTransactionAction, attachToStonizPaymentAction, type PotentialDuplicate } from '../actions';
import { ALLOCATION_LABELS } from '@/lib/finance/bank-categorizer';
import { ProjectCombobox, type ProjectOption } from '@/components/projects/project-combobox';
import { LotAcompteSelector } from '@/components/finance/lot-acompte-selector';

type Project = {
  id: string;
  reference: string;
  client: { full_name: string } | null;
};

type TravauxLot = {
  id: string;
  project_id: string;
  artisan_name: string | null;
  category: string | null;
  description: string | null;
  status: string | null;
};

type AchatsLot = {
  id: string;
  project_id: string;
  supplier_name: string | null;
  category: string | null;
  description: string | null;
  status: string | null;
};

const ALLOCATION_TYPES_REQUIRES_PROJECT = ['travaux', 'achats', 'services', 'honoraires', 'propria'];

const SERVICE_CATEGORIES: Record<string, string> = {
  architecte: 'Architecte',
  geometre: 'Géomètre / topographe',
  bureau_etudes: "Bureau d'études techniques",
  juridique_notariat: 'Juridique / notariat',
  photo_video: 'Photo / vidéo',
  decoration_design: "Décoration / design d'intérieur",
  marketing_communication: 'Marketing / communication',
  conseil: 'Conseil',
  autre_service: 'Autre service',
};

export function AllocationForm({
  transactionId,
  remaining,
  projects,
  travauxLots = [],
  achatsLots = [],
  isDebit = false,
  beneficiary = null,
}: {
  transactionId: string;
  remaining: number;
  projects: Project[];
  travauxLots?: TravauxLot[];
  achatsLots?: AchatsLot[];
  isDebit?: boolean;
  beneficiary?: string | null;
}) {
  const [allocType, setAllocType] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<PotentialDuplicate[] | null>(null);
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);

  const requiresProject = ALLOCATION_TYPES_REQUIRES_PROJECT.includes(allocType);
  const isServices = allocType === 'services';
  const isTravaux = allocType === 'travaux';
  const isAchats = allocType === 'achats';
  // Sélecteur de lot pertinent uniquement pour les paiements sortants (débit)
  const showTravauxLotPicker = isTravaux && isDebit && !!selectedProjectId;
  const showAchatsLotPicker = isAchats && isDebit && !!selectedProjectId;

  const projectTravauxLots = useMemo(
    () => travauxLots.filter((l) => l.project_id === selectedProjectId),
    [travauxLots, selectedProjectId]
  );
  const projectAchatsLots = useMemo(
    () => achatsLots.filter((l) => l.project_id === selectedProjectId),
    [achatsLots, selectedProjectId]
  );

  const projectOptions: ProjectOption[] = useMemo(
    () =>
      projects.map((p) => ({
        id: p.id,
        reference: p.reference,
        client_name: p.client?.full_name ?? null,
      })),
    [projects]
  );

  async function submitFormData(fd: FormData, form?: HTMLFormElement) {
    setError(null);
    setSubmitting(true);
    try {
      const result = await allocateTransactionAction(fd);
      if ('duplicates' in result && Array.isArray(result.duplicates)) {
        // Le serveur a trouvé des doublons potentiels — on demande confirmation à l'user
        setDuplicates(result.duplicates);
        setPendingFormData(fd);
        return;
      }
      if (!result.ok) {
        setError('error' in result ? result.error : 'Erreur inattendue');
        return;
      }
      form?.reset();
      setAllocType('');
      setDuplicates(null);
      setPendingFormData(null);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur réseau');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    await submitFormData(fd, form);
  }

  async function forceCreate() {
    if (!pendingFormData) return;
    pendingFormData.set('force_create', 'true');
    await submitFormData(pendingFormData);
  }

  async function attachToExisting(dup: PotentialDuplicate) {
    if (!pendingFormData) return;
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set('transaction_id', String(pendingFormData.get('transaction_id') ?? ''));
      fd.set('source', dup.source);
      fd.set('source_id', dup.id);
      const projectId = pendingFormData.get('project_id');
      if (projectId) fd.set('project_id', String(projectId));
      fd.set('amount_mad', String(dup.amount_mad));
      const result = await attachToStonizPaymentAction(fd);
      if (!result.ok) {
        setError('error' in result ? result.error : 'Erreur inattendue');
        return;
      }
      setAllocType('');
      setDuplicates(null);
      setPendingFormData(null);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur réseau');
    } finally {
      setSubmitting(false);
    }
  }

  function cancelDuplicates() {
    setDuplicates(null);
    setPendingFormData(null);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="transaction_id" value={transactionId} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-stoniz-gray-600 block mb-1">Type d'allocation *</label>
          <select
            name="allocation_type"
            value={allocType}
            onChange={(e) => {
              setAllocType(e.target.value);
              // Reset le projet et le formulaire d'allocation quand on change de type
              // (sinon le sélecteur de lot resterait sur les lots d'un projet plus pertinent)
              setSelectedProjectId(null);
            }}
            required
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          >
            <option value="" disabled>— Choisir —</option>
            {Object.entries(ALLOCATION_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-stoniz-gray-600 block mb-1">
            Montant à allouer (MAD) *
          </label>
          <input
            type="text"
            name="amount_mad"
            required
            defaultValue={remaining.toFixed(2)}
            pattern="^-?\d+(\.\d{1,2})?$"
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm font-mono"
          />
          <p className="text-[10px] text-stoniz-gray-500 mt-1">
            Max {remaining.toFixed(2)} MAD · pré-rempli avec le reste à allouer
          </p>
        </div>
      </div>

      {requiresProject && (
        <div>
          <label className="text-xs text-stoniz-gray-600 block mb-1">Projet *</label>
          <ProjectCombobox
            projects={projectOptions}
            fieldName="project_id"
            required={requiresProject}
            placeholder="Tape un nom client ou une référence (ex : Hariss, STZ-2026-084)…"
            onSelect={(pid) => setSelectedProjectId(pid)}
          />
        </div>
      )}

      {showTravauxLotPicker && selectedProjectId && (
        <LotAcompteSelector
          projectId={selectedProjectId}
          kind="travaux"
          transactionAmount={remaining}
          beneficiary={beneficiary}
          lotInputName="travaux_lot_id"
        />
      )}

      {showAchatsLotPicker && selectedProjectId && (
        <LotAcompteSelector
          projectId={selectedProjectId}
          kind="achats"
          transactionAmount={remaining}
          beneficiary={beneficiary}
          lotInputName="achats_lot_id"
        />
      )}

      {isServices && (
        <div className="bg-purple-50 border border-purple-200 rounded p-3 space-y-3">
          <div className="flex items-start gap-2 text-xs text-purple-900">
            <span className="font-medium">ℹ Pôle Services</span>
            <span>
              Architecte, géomètre, juridique, photo, décoration, etc.
              Stoniz paye → le coût pèse sur la marge cabinet du projet.
              Un lot et un paiement seront créés automatiquement sur la fiche projet.
            </span>
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600 block mb-1">Catégorie de service *</label>
            <select
              name="service_category"
              required={isServices}
              defaultValue=""
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm bg-white"
            >
              <option value="" disabled>— Choisir —</option>
              {Object.entries(SERVICE_CATEGORIES).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div>
        <label className="text-xs text-stoniz-gray-600 block mb-1">Note (optionnel)</label>
        <input
          type="text"
          name="notes"
          placeholder={isServices ? "Ex : Plans d'avant-projet ARK ATELIER" : "Ex : Acompte 2 sur lot peinture"}
          className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {duplicates && duplicates.length > 0 && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={cancelDuplicates}>
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-orange-600 flex-shrink-0 mt-1" />
              <div>
                <h2 className="font-display text-xl">Doublon potentiel détecté</h2>
                <p className="text-sm text-stoniz-gray-600 mt-1">
                  Cette transaction bancaire ressemble à {duplicates.length === 1 ? 'un paiement déjà enregistré' : `${duplicates.length} paiements déjà enregistrés`} sur ce projet
                  (même montant ±1 MAD, ±7 jours). Pour éviter de créer un doublon, choisis :
                </p>
              </div>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {duplicates.map((dup) => (
                <div key={`${dup.source}-${dup.id}`} className="border border-stoniz-gray-200 rounded p-3 flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <div className="text-sm font-medium">
                      {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(dup.amount_mad)} MAD
                      <span className="text-stoniz-gray-500 ml-2 text-xs">
                        {new Date(dup.date).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                    <div className="text-xs text-stoniz-gray-600 mt-0.5">
                      {dup.partner_name && <strong>{dup.partner_name} · </strong>}
                      {dup.description}
                    </div>
                    <div className="text-[10px] uppercase text-stoniz-gray-400 mt-1">
                      {dup.source.replace(/_/g, ' ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => attachToExisting(dup)}
                    disabled={submitting}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded disabled:opacity-50"
                  >
                    Rattacher à celle-ci
                  </button>
                </div>
              ))}
            </div>

            <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded p-3 text-xs text-stoniz-gray-700">
              <strong>Recommandation :</strong> si l'une des lignes ci-dessus est le même paiement réel, choisis "Rattacher" pour
              juste relier ta saisie manuelle à la transaction bancaire (pas de doublon, marges projet préservées).
              Choisis "Créer quand même" uniquement si c'est vraiment un <strong>autre</strong> paiement de même montant à la même période.
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={cancelDuplicates}
                disabled={submitting}
                className="text-sm text-stoniz-gray-600 underline"
              >
                Annuler l'allocation
              </button>
              <button
                type="button"
                onClick={forceCreate}
                disabled={submitting}
                className="bg-stoniz-gray-800 hover:bg-stoniz-black text-white text-sm font-medium px-4 py-2 rounded disabled:opacity-50"
              >
                Créer quand même un nouveau payment
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || remaining < 0.01}
          className="bg-stoniz-black text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-stoniz-gray-800 disabled:opacity-50"
        >
          {submitting ? 'Ajout…' : 'Ajouter cette allocation'}
        </button>
      </div>
    </form>
  );
}
