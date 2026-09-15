/**
 * Pipeline de traitement d'une photo avant upload :
 *   1. Si HEIC → conversion en JPEG (sinon les navigateurs ne savent pas l'afficher)
 *   2. Si > 1 MB → compression à 1920×1080 max + qualité 80% WebP
 *   3. Calcul du hash SHA-256 (dédup côté serveur)
 *   4. Extraction dimensions (utile pour la galerie)
 *
 * Le tout côté client → upload optimal sans charger le serveur.
 */

export type ProcessedPhoto = {
  file: File;
  hash: string;
  width: number;
  height: number;
  originalSizeBytes: number;
  finalSizeBytes: number;
};

const MAX_DIM = 1920;
const QUALITY = 0.82;
const TARGET_MAX_SIZE = 1024 * 1024; // 1 MB

/**
 * Détecte si le fichier est HEIC/HEIF (iPhone).
 * Le navigateur ne sait pas afficher ce format → conversion nécessaire.
 */
function isHeic(file: File): boolean {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return mime === 'image/heic' || mime === 'image/heif'
    || name.endsWith('.heic') || name.endsWith('.heif');
}

/**
 * Convertit un HEIC en JPEG via heic2any (dynamic import pour éviter le SSR).
 */
async function heicToJpeg(file: File): Promise<File> {
  const { default: heic2any } = await import('heic2any');
  const blob = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.9,
  });
  const finalBlob = Array.isArray(blob) ? blob[0] : blob;
  return new File(
    [finalBlob],
    file.name.replace(/\.(heic|heif)$/i, '.jpg'),
    { type: 'image/jpeg' },
  );
}

/**
 * Compresse une image au format WebP (compromis qualité/poids idéal pour le web).
 * Redimensionne à MAX_DIM × MAX_DIM en conservant l'aspect ratio.
 */
async function compressToWebp(file: File): Promise<{ file: File; width: number; height: number }> {
  const { default: imageCompression } = await import('browser-image-compression');
  const compressed = await imageCompression(file, {
    maxSizeMB: TARGET_MAX_SIZE / 1024 / 1024,
    maxWidthOrHeight: MAX_DIM,
    fileType: 'image/webp',
    initialQuality: QUALITY,
    useWebWorker: true,
  });

  // Détection des dimensions finales
  const dims = await readImageDimensions(compressed);

  const finalFile = compressed instanceof File
    ? compressed
    : new File(
        [compressed],
        file.name.replace(/\.(jpg|jpeg|png|heic|heif)$/i, '.webp'),
        { type: 'image/webp' },
      );

  return { file: finalFile, ...dims };
}

function readImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Impossible de lire les dimensions de l\'image'));
    };
    img.src = url;
  });
}

/**
 * Calcule le hash SHA-256 d'un fichier (utilisé pour la dédup serveur).
 */
async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Pipeline complet : convertit + compresse + hash. Retourne un fichier prêt à uploader.
 */
export async function processPhoto(input: File): Promise<ProcessedPhoto> {
  const originalSize = input.size;

  // 1. HEIC → JPEG si nécessaire
  let working = input;
  if (isHeic(input)) {
    working = await heicToJpeg(input);
  }

  // 2. Compression vers WebP avec resize
  const { file, width, height } = await compressToWebp(working);

  // 3. Hash SHA-256
  const hash = await computeSha256(file);

  return {
    file,
    hash,
    width,
    height,
    originalSizeBytes: originalSize,
    finalSizeBytes: file.size,
  };
}
