'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

// ─── Règles d'upload média d'un bien ────────────────────────────────────────
// Architecture : l'upload se fait en DIRECT du navigateur vers le stockage
// Supabase (signed upload URL). Le serveur ne reçoit JAMAIS les octets du
// fichier — uniquement la demande d'URL signée puis l'enregistrement de la
// fiche. Cela contourne le plafond ~4,5 Mo des Server Actions sur Vercel et
// permet des vidéos jusqu'à 1 Go.
//
// Défense en profondeur : le bucket `property-media` applique aussi
// allowed_mime_types + file_size_limit (1 Go) côté stockage
// (voir migration 20260531100000_property_media_bucket_1gb.sql).

const ALLOWED_MIME = [
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
  'video/mp4', 'video/quicktime', 'video/webm',
];
const MAX_SIZE = 1024 * 1024 * 1024; // 1 Go

const MEDIA_TYPES = ['photo', 'video_bien', 'video_facade', 'video_parties_communes'];

const ROLES = ['ceo', 'chef_projet', 'sourcing'] as const;

function sanitizeExt(fileName: string): string {
  const raw = (fileName.split('.').pop() || 'bin').toLowerCase();
  // On ne garde que des caractères d'extension sûrs (évite l'injection de chemin).
  return /^[a-z0-9]{1,5}$/.test(raw) ? raw : 'bin';
}

/**
 * Étape 1 de l'upload : le serveur autorise (assertRole), choisit le chemin de
 * stockage et délivre une URL signée à usage unique. Le navigateur utilisera
 * cette URL pour envoyer les octets directement au stockage.
 */
export async function createPropertyMediaUploadUrl(args: {
  propertyId: string;
  type: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}) {
  try {
    await assertRole([...ROLES]);

    const { propertyId, type, fileName, fileType, fileSize } = args;

    if (!propertyId) return { ok: false as const, error: 'Bien manquant' };
    if (!MEDIA_TYPES.includes(type)) return { ok: false as const, error: 'Type média invalide' };
    if (!fileSize) return { ok: false as const, error: 'Fichier vide' };
    if (fileSize > MAX_SIZE) {
      const mb = (fileSize / (1024 * 1024)).toFixed(0);
      return { ok: false as const, error: `Fichier trop volumineux : ${mb} Mo (max 1 Go)` };
    }
    if (!ALLOWED_MIME.includes(fileType)) {
      return { ok: false as const, error: `Type non supporté : ${fileType || 'inconnu'}` };
    }

    const supabase = createClient();
    const path = `${propertyId}/${crypto.randomUUID()}.${sanitizeExt(fileName)}`;

    const { data, error } = await supabase.storage
      .from('property-media')
      .createSignedUploadUrl(path);

    if (error || !data) {
      return { ok: false as const, error: error?.message ?? 'Impossible de préparer l\'upload' };
    }

    return { ok: true as const, path: data.path, token: data.token };
  } catch (e: any) {
    console.error('[createPropertyMediaUploadUrl]', e);
    return { ok: false as const, error: e?.message ?? 'Erreur serveur inattendue' };
  }
}

/**
 * Étape 2 de l'upload : une fois les octets envoyés au stockage par le
 * navigateur, on enregistre la fiche média. Le premier média photo devient la
 * couverture par défaut.
 */
export async function recordPropertyMediaAction(args: {
  propertyId: string;
  type: string;
  storagePath: string;
}) {
  try {
    await assertRole([...ROLES]);

    const { propertyId, type, storagePath } = args;

    if (!propertyId || !storagePath) return { ok: false as const, error: 'Données manquantes' };
    if (!MEDIA_TYPES.includes(type)) return { ok: false as const, error: 'Type média invalide' };
    // Le chemin doit appartenir au bien (cohérence avec le préfixe choisi par le serveur).
    if (!storagePath.startsWith(`${propertyId}/`)) {
      return { ok: false as const, error: 'Chemin de stockage incohérent' };
    }

    const supabase = createClient();

    const { count } = await supabase.from('property_media')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId);

    const { error: insertErr } = await supabase.from('property_media').insert({
      property_id: propertyId,
      type,
      storage_path: storagePath,
      display_order: count ?? 0,
      is_cover: (count ?? 0) === 0 && type === 'photo',
    });

    if (insertErr) {
      // L'enregistrement a échoué : on nettoie l'objet uploadé pour ne pas
      // laisser un fichier orphelin dans le stockage.
      await supabase.storage.from('property-media').remove([storagePath]);
      return { ok: false as const, error: insertErr.message };
    }

    revalidatePath(`/properties/${propertyId}`);
    return { ok: true as const };
  } catch (e: any) {
    console.error('[recordPropertyMediaAction]', e);
    return { ok: false as const, error: e?.message ?? 'Erreur serveur inattendue' };
  }
}

export async function deletePropertyMediaAction(mediaId: string, propertyId: string) {
  await assertRole([...ROLES]);
  const supabase = createClient();

  const { data: media } = await supabase
    .from('property_media')
    .select('storage_path')
    .eq('id', mediaId)
    .single();

  if (media?.storage_path) {
    await supabase.storage.from('property-media').remove([media.storage_path]);
  }

  await supabase.from('property_media').delete().eq('id', mediaId);
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true };
}

export async function getPropertyMediaSignedUrls(propertyId: string) {
  const supabase = createClient();
  const { data: media } = await supabase
    .from('property_media')
    .select('id, type, storage_path, is_cover, display_order')
    .eq('property_id', propertyId)
    .order('display_order');

  if (!media) return [];

  const withUrls = await Promise.all(
    media.map(async (m) => {
      const { data } = await supabase.storage
        .from('property-media')
        .createSignedUrl(m.storage_path, 3600);
      return { ...m, url: data?.signedUrl ?? null };
    })
  );
  return withUrls;
}
