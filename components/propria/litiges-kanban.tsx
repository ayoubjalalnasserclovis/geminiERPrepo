'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, CheckCircle2, XCircle, MoveRight, Paperclip, PanelRightOpen } from 'lucide-react';
import {
  moveLitigeColumnAction,
  assignLitigeAction,
  setLitigeNoteAction,
  addLitigeActionAction,
} from '@/app/(team)/propria/litiges/actions';
import { LitigeDetailModal } from '@/components/propria/litige-detail-modal';

type Column = 'ouvrir_ticket' | 'ticket_ouvert' | 'appel' | 'gagne' | 'perdu';

type Litige = {
  id: string;
  type: string;
  description: string | null;
  amount: number | null;            // legacy — affichage remplacé par total_claimed_mad dérivé
  currency: string | null;
  kanban_column: Column;
  ticket_opened_at: string | null;
  call_started_at: string | null;
  won_at: string | null;
  lost_at: string | null;
  opened_at: string;
  assignee_id: string | null;
  internal_notes: string | null;
  attachment_path: string | null;
  aircover_reference: string | null;
  guest_name: string | null;
  arrival_date: string;
  departure_date: string;
  unit_code: string | null;
  property_name: string | null;
  channel_name: string | null;
  nb_actions: number;
  // Totaux dérivés (vue propria_litiges_totals — décision B4)
  nb_items: number;
  total_claimed_mad: number;
  total_cost_real_mad: number;
  marge_mad: number;
};

type Assignee = { id: string; full_name: string | null };
type Profile = { id: string; full_name: string | null };

const COLUMNS: { key: Column; label: string; color: string; bg: string }[] = [
  { key: 'ouvrir_ticket', label: '📝 Ouvrir le ticket', color: 'text-stoniz-gray-700', bg: 'bg-stoniz-gray-50 border-stoniz-gray-300' },
  { key: 'ticket_ouvert', label: '📩 Ticket ouvert',   color: 'text-blue-700',         bg: 'bg-blue-50 border-blue-200' },
  { key: 'appel',         label: '📞 Appel',           color: 'text-orange-700',       bg: 'bg-orange-50 border-orange-200' },
  { key: 'gagne',         label: '✅ Gagné',            color: 'text-emerald-700',      bg: 'bg-emerald-100 border-emerald-400' },
  { key: 'perdu',         label: '❌ Perdu',            color: 'text-red-700',          bg: 'bg-red-100 border-red-400' },
];

const TYPE_BADGE: Record<string, { label: string; color: string }> = {
  caution:           { label: '🛡️ Caution',           color: 'bg-blue-100 text-blue-800' },
  degats:            { label: '🔨 Dégâts',             color: 'bg-red-100 text-red-800' },
  frais_contestes:   { label: '💶 Frais',              color: 'bg-amber-100 text-amber-800' },
  annulation_tardive:{ label: '⏰ Annulation',          color: 'bg-purple-100 text-purple-800' },
  tapage:            { label: '📢 Tapage',             color: 'bg-pink-100 text-pink-800' },
  menage:            { label: '🧹 Ménage',             color: 'bg-teal-100 text-teal-800' },
  autre:             { label: '🔧 Autre',              color: 'bg-stoniz-gray-100 text-stoniz-gray-700' },
};

const ACTION_LABELS: Record<string, string> = {
  ouverture_ticket: 'Ouverture ticket',
  appel: 'Appel',
  message: 'Message',
  escalade: 'Escalade',
  reponse_airbnb: 'Réponse Airbnb',
  autre: 'Autre',
};

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });
}

function LitigeCard({ l, assignees, profiles, canDeleteComments, onRefresh }: {
  l: Litige;
  assignees: Assignee[];
  profiles: Profile[];
  canDeleteComments: boolean;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [, start] = useTransition();
  const [notes, setNotes] = useState(l.internal_notes ?? '');
  const [actionType, setActionType] = useState('message');
  const [actionDesc, setActionDesc] = useState('');

  const currentIdx = COLUMNS.findIndex((c) => c.key === l.kanban_column);
  const nextCol = currentIdx < 3 ? COLUMNS[currentIdx + 1] : null; // pas suggérer gagné/perdu en auto-next

  function moveTo(column: Column) {
    start(async () => {
      await moveLitigeColumnAction({ litige_id: l.id, column });
      onRefresh();
    });
  }
  function assign(assignee_id: string | null) {
    start(async () => {
      await assignLitigeAction({ litige_id: l.id, assignee_id });
      onRefresh();
    });
  }
  function saveNote() {
    start(async () => {
      await setLitigeNoteAction({ litige_id: l.id, notes });
      onRefresh();
    });
  }
  function addAction() {
    start(async () => {
      await addLitigeActionAction({ litige_id: l.id, action_type: actionType as any, description: actionDesc || null });
      setActionDesc('');
      onRefresh();
    });
  }

  const isClosed = l.kanban_column === 'gagne' || l.kanban_column === 'perdu';
  const typeBadge = TYPE_BADGE[l.type] ?? TYPE_BADGE.autre;

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-lg p-3 text-xs space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{l.guest_name ?? 'Voyageur'}</div>
          <div className="text-[10px] text-stoniz-gray-500">
            {fmtDate(l.arrival_date)} → {fmtDate(l.departure_date)} · {l.channel_name ?? '?'}
          </div>
        </div>
        {l.unit_code && (
          <div className="text-[10px] font-mono text-stoniz-gray-700 shrink-0">{l.unit_code}</div>
        )}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        <span className={`text-[10px] px-2 py-0.5 rounded ${typeBadge.color}`}>{typeBadge.label}</span>
        {l.total_claimed_mad > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-stoniz-gray-100 text-stoniz-gray-700 font-medium"
            title={`Total demandé (somme des ${l.nb_items} ligne${l.nb_items > 1 ? 's' : ''})`}>
            {Intl.NumberFormat('fr-FR').format(Number(l.total_claimed_mad))} MAD
          </span>
        )}
        {l.nb_items > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-stoniz-gray-50 text-stoniz-gray-500 border border-stoniz-gray-200">
            {l.nb_items} élém.
          </span>
        )}
        {l.aircover_reference && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200"
            title="N° dossier AirCover">
            🛡 {l.aircover_reference}
          </span>
        )}
        {l.attachment_path && <Paperclip className="w-3 h-3 text-blue-600" />}
        {l.nb_actions > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
            {l.nb_actions} action{l.nb_actions > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <select value={l.assignee_id ?? ''} onChange={(e) => assign(e.target.value || null)}
        className={`w-full border rounded px-1.5 py-0.5 text-[10px] ${l.assignee_id ? 'border-blue-300 bg-blue-50' : 'border-stoniz-gray-200 bg-stoniz-gray-50 text-stoniz-gray-500'}`}>
        <option value="">— Non assigné —</option>
        {assignees.map((a) => <option key={a.id} value={a.id}>👤 {a.full_name ?? '—'}</option>)}
      </select>

      {l.description && (
        <p className={`text-stoniz-gray-700 ${open ? '' : 'line-clamp-2'}`}>{l.description}</p>
      )}

      {open && (
        <div className="space-y-2 pt-2 border-t border-stoniz-gray-100">
          <div className="space-y-0.5 text-[10px] text-stoniz-gray-500">
            <div>Ouvert le {fmtDate(l.opened_at)}</div>
            {l.ticket_opened_at && <div>📩 Ticket ouvert le {fmtDate(l.ticket_opened_at)}</div>}
            {l.call_started_at && <div>📞 Appel démarré le {fmtDate(l.call_started_at)}</div>}
            {l.won_at && <div>✅ Gagné le {fmtDate(l.won_at)}</div>}
            {l.lost_at && <div>❌ Perdu le {fmtDate(l.lost_at)}</div>}
          </div>

          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNote}
            placeholder="Note interne (échanges Airbnb, statut…)"
            className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-[11px]" rows={2} />

          {!isClosed && (
            <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded p-2 space-y-1">
              <div className="text-[10px] font-medium">+ Ajouter une action</div>
              <select value={actionType} onChange={(e) => setActionType(e.target.value)}
                className="w-full border border-stoniz-gray-300 rounded px-1 py-0.5 text-[11px]">
                {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input value={actionDesc} onChange={(e) => setActionDesc(e.target.value)}
                placeholder="Description (optionnel)"
                className="w-full border border-stoniz-gray-300 rounded px-1 py-0.5 text-[11px]" />
              <button type="button" onClick={addAction}
                className="bg-stoniz-black text-white px-2 py-1 rounded text-[10px] w-full">
                Ajouter
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-1">
            {nextCol && (
              <button type="button" onClick={() => moveTo(nextCol.key)}
                className="bg-blue-600 text-white px-2 py-1 rounded text-[10px] inline-flex items-center gap-1 hover:bg-blue-700">
                <MoveRight className="w-3 h-3" /> {nextCol.label.replace(/^.\s/, '')}
              </button>
            )}
            {l.kanban_column !== 'gagne' && (
              <button type="button" onClick={() => moveTo('gagne')}
                className="bg-emerald-600 text-white px-2 py-1 rounded text-[10px] inline-flex items-center gap-1 hover:bg-emerald-700">
                <CheckCircle2 className="w-3 h-3" /> Gagné
              </button>
            )}
            {l.kanban_column !== 'perdu' && (
              <button type="button" onClick={() => moveTo('perdu')}
                className="bg-red-600 text-white px-2 py-1 rounded text-[10px] inline-flex items-center gap-1 hover:bg-red-700">
                <XCircle className="w-3 h-3" /> Perdu
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)}
          className="text-blue-600 hover:underline text-[10px] inline-flex items-center gap-1">
          <MessageSquare className="w-2.5 h-2.5" />
          {open ? 'Réduire' : 'Détails / Actions'}
        </button>
        <button type="button" onClick={() => setDetailOpen(true)}
          className="text-stoniz-gray-600 hover:text-stoniz-black hover:underline text-[10px] inline-flex items-center gap-1">
          <PanelRightOpen className="w-2.5 h-2.5" />
          Dossier complet
        </button>
      </div>

      {detailOpen && (
        <LitigeDetailModal
          litigeId={l.id}
          title={`${typeBadge.label} · ${l.guest_name ?? 'Voyageur'}`}
          subtitle={`${l.unit_code ?? '—'}${l.property_name ? ` (${l.property_name})` : ''} · ${fmtDate(l.arrival_date)} → ${fmtDate(l.departure_date)}`}
          aircoverReference={l.aircover_reference}
          profiles={profiles}
          canDeleteComments={canDeleteComments}
          onClose={() => { setDetailOpen(false); onRefresh(); }}
        />
      )}
    </div>
  );
}

export function LitigesKanban({ litiges, assignees, profiles, canDeleteComments }: {
  litiges: Litige[];
  assignees: Assignee[];
  profiles: Profile[];
  canDeleteComments: boolean;
}) {
  const router = useRouter();

  const byColumn = new Map<Column, Litige[]>();
  for (const c of COLUMNS) byColumn.set(c.key, []);
  for (const l of litiges) byColumn.get(l.kanban_column)?.push(l);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {COLUMNS.map((col) => {
        const items = byColumn.get(col.key) ?? [];
        return (
          <div key={col.key} className={`rounded-xl border-2 p-3 ${col.bg}`}>
            <div className={`text-xs font-medium mb-3 flex items-center justify-between ${col.color}`}>
              <span>{col.label}</span>
              <span className="bg-white border border-current rounded-full px-2 text-[10px]">{items.length}</span>
            </div>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {items.map((l) => (
                <LitigeCard key={l.id} l={l} assignees={assignees} profiles={profiles}
                  canDeleteComments={canDeleteComments} onRefresh={() => router.refresh()} />
              ))}
              {items.length === 0 && (
                <div className="text-[10px] text-stoniz-gray-400 text-center py-4">vide</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
