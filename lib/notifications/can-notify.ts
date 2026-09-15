import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Source de vérité côté TS pour décider si on peut notifier un projet.
 * Appelle la fonction SQL `can_notify_for_project` qui vérifie :
 *   - is_preparation = false
 *   - legacy_imported = false
 *   - activated_at IS NOT NULL
 *   - client_id IS NOT NULL
 *   - deleted_at IS NULL
 *
 * Tout site d'envoi de mail lié à un projet DOIT passer par ce garde.
 * Le wrap dans sendEmail() le fait automatiquement quand project_id est
 * fourni dans les params — donc en pratique tu n'as PAS à l'appeler à la
 * main, c'est sendEmail qui le fait pour toi.
 *
 * Retours possibles :
 *   - true → ok, envoie l'email
 *   - false → bloque, log en status='skipped'
 *   - null → projet introuvable (NULL côté SQL), traité comme false
 *
 * NOTE 2026-06-19 : le kill switch global (`EMAIL_KILL_SWITCH`) a été
 * **retiré définitivement** sur décision CEO — trop dangereux (coupait tout
 * en silence sans alerte). Le garde-fou métier `can_notify_for_project`
 * suffit largement.
 */
export async function canNotifyForProject(projectId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('can_notify_for_project', { p_project_id: projectId });
  if (error) {
    console.error('[can-notify] erreur RPC pour', projectId, '→', error.message);
    return false;
  }
  return data === true;
}
