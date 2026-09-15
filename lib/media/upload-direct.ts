/**
 * Upload DIRECT navigateur → stockage Supabase via une URL signée.
 *
 * Le fichier ne transite PAS par le serveur Next.js / Vercel : on évite ainsi
 * le plafond ~4,5 Mo des Server Actions et on peut envoyer des vidéos jusqu'à
 * 1 Go (limite du bucket `property-media`).
 *
 * L'autorisation a déjà été faite côté serveur (createPropertyMediaUploadUrl,
 * qui vérifie le rôle et choisit le chemin). Le `token` signé suffit ici : on
 * utilise donc un client anon, sans session.
 */

import { createClient } from '@supabase/supabase-js';

let _client: ReturnType<typeof createClient> | null = null;

function getStorageClient() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('Configuration Supabase manquante (URL / clé anon).');
  }
  // persistSession: false → ce client ne sert qu'à pousser des octets, pas d'auth.
  _client = createClient(url, anon, { auth: { persistSession: false } });
  return _client;
}

/**
 * Envoie `file` au stockage en utilisant le chemin + token signés par le serveur.
 * Lève une erreur explicite en cas d'échec (taille, type, réseau).
 */
export async function uploadToSignedUrl(
  path: string,
  token: string,
  file: File,
  bucket: string = 'property-media',
): Promise<void> {
  const supabase = getStorageClient();
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(path, token, file, { contentType: file.type });

  if (error) {
    throw new Error(error.message || 'Échec de l\'envoi vers le stockage');
  }
}
