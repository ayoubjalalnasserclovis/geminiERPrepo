'use client';

import { useState } from 'react';
import { defaultChecklist, type ChecklistSection } from '@/lib/propria/maintenance-checklist';

export function MaintenanceChecklistEditor({
  initial,
  initialNotes,
  visitId,
  saveAction,
  completeAction,
  canComplete = false,
}: {
  initial: ChecklistSection[] | null;
  initialNotes: string | null;
  visitId: string;
  saveAction: (visitId: string, checklist: ChecklistSection[], notes: string) => Promise<void>;
  completeAction: (visitId: string) => Promise<void>;
  canComplete?: boolean;
}) {
  const [sections, setSections] = useState<ChecklistSection[]>(
    initial && initial.length > 0 ? initial : defaultChecklist()
  );
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function toggle(sectionIdx: number, itemIdx: number) {
    setSections(prev => {
      const next = [...prev];
      next[sectionIdx] = { ...next[sectionIdx], items: [...next[sectionIdx].items] };
      next[sectionIdx].items[itemIdx] = {
        ...next[sectionIdx].items[itemIdx],
        done: !next[sectionIdx].items[itemIdx].done,
      };
      return next;
    });
  }

  function setObs(sectionIdx: number, itemIdx: number, obs: string) {
    setSections(prev => {
      const next = [...prev];
      next[sectionIdx] = { ...next[sectionIdx], items: [...next[sectionIdx].items] };
      next[sectionIdx].items[itemIdx] = {
        ...next[sectionIdx].items[itemIdx],
        observation: obs,
      };
      return next;
    });
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      await saveAction(visitId, sections, notes);
      setSavedAt(new Date());
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function complete() {
    setSaving(true); setErr(null);
    try {
      await saveAction(visitId, sections, notes);
      await completeAction(visitId);
    } catch (e: any) {
      setErr(e.message);
      setSaving(false);
    }
  }

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const done = sections.reduce((n, s) => n + s.items.filter(i => i.done).length, 0);
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div>
      {/* Sticky progress */}
      <div className="sticky top-0 bg-white z-10 border-b border-stoniz-gray-200 py-3 mb-5 -mx-2 px-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">Avancement</span>
              <span className="text-xs text-stoniz-gray-600">{done} / {total} ({pct}%)</span>
            </div>
            <div className="h-2 bg-stoniz-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="border border-stoniz-gray-300 px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-50 disabled:opacity-50"
            >
              {saving ? '...' : 'Enregistrer'}
            </button>
            {canComplete && (
              <button
                type="button"
                onClick={complete}
                disabled={saving}
                className="bg-emerald-600 text-white px-4 py-2 rounded-md text-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                ✓ Marquer comme réalisée
              </button>
            )}
          </div>
        </div>
        {savedAt && <div className="text-xs text-emerald-600 mt-1">Enregistré à {savedAt.toLocaleTimeString('fr-FR')}</div>}
        {err && <div className="text-xs text-red-700 mt-1">{err}</div>}
      </div>

      <div className="space-y-4">
        {sections.map((section, sIdx) => {
          const sDone = section.items.filter(i => i.done).length;
          return (
            <details
              key={section.key}
              open={sDone < section.items.length}
              className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden"
            >
              <summary className="cursor-pointer px-5 py-3 bg-stoniz-gray-50 hover:bg-stoniz-gray-100 flex items-center justify-between">
                <span className="font-medium flex items-center gap-2">
                  <span>{section.icon}</span> {section.title}
                </span>
                <span className="text-xs text-stoniz-gray-600">
                  {sDone} / {section.items.length}
                </span>
              </summary>
              <div className="p-4 space-y-2">
                {section.items.map((item, iIdx) => (
                  <div key={item.key} className="flex items-start gap-3 py-1">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggle(sIdx, iIdx)}
                      className="mt-1 w-4 h-4 rounded border-stoniz-gray-400"
                    />
                    <div className="flex-1">
                      <label className={`text-sm ${item.done ? 'line-through text-stoniz-gray-400' : ''}`}>
                        {item.label}
                      </label>
                      <input
                        type="text"
                        value={item.observation ?? ''}
                        onChange={(e) => setObs(sIdx, iIdx, e.target.value)}
                        placeholder="Observation (optionnel)"
                        className="mt-1 w-full border border-stoniz-gray-200 rounded px-2 py-1 text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>

      <div className="mt-5">
        <label className="text-xs text-stoniz-gray-600">Notes globales</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Synthèse de la visite, points d'attention..."
          className="mt-1 w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}
