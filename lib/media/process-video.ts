/**
 * Compression vidéo côté navigateur (best-effort) via ffmpeg.wasm.
 *
 * PRINCIPE DE SÛRETÉ : cette compression est purement opportuniste. Si quoi que
 * ce soit échoue (chargement de ffmpeg, mémoire insuffisante, codec absent,
 * fichier trop gros), on renvoie la vidéo D'ORIGINE. L'upload direct (1 Go)
 * fonctionne dans tous les cas — la compression ne fait que réduire le poids
 * quand c'est possible.
 *
 * Choix techniques :
 *   - Core single-thread → pas besoin d'isolation cross-origin (COOP/COEP).
 *   - Downscale à 720p max, H.264 CRF 28, preset veryfast (wasm est lent).
 *   - On NE compresse PAS les fichiers déjà légers ni les très gros (mémoire).
 *
 * ⚠️ À VALIDER EN NAVIGATEUR RÉEL avant prod (ffmpeg.wasm + CSP). La CSP a été
 * ajustée dans next.config.js (blob: workers, CDN unpkg, wasm).
 */

export type ProcessedVideo = {
  file: File;
  compressed: boolean;          // true si la compression a réellement eu lieu
  originalSizeBytes: number;
  finalSizeBytes: number;
};

// Version épinglée du core ffmpeg.wasm (cohérente avec la CSP / unpkg).
const FFMPEG_CORE_VERSION = '0.12.6';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

// En dessous de ce seuil : déjà assez léger, on n'a rien à gagner.
const SKIP_BELOW_BYTES = 8 * 1024 * 1024;        // 8 Mo
// Au dessus : risque d'OOM dans le wasm → on n'essaie même pas, upload direct.
const SKIP_ABOVE_BYTES = 200 * 1024 * 1024;      // 200 Mo

let _ffmpegPromise: Promise<any> | null = null;

async function loadFfmpeg() {
  if (_ffmpegPromise) return _ffmpegPromise;
  _ffmpegPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    return ffmpeg;
  })().catch((e) => {
    _ffmpegPromise = null; // permet une nouvelle tentative au prochain fichier
    throw e;
  });
  return _ffmpegPromise;
}

function isVideo(file: File): boolean {
  return file.type.startsWith('video/');
}

/**
 * Compresse la vidéo si c'est pertinent et possible. Renvoie toujours un File
 * uploadable (compressé ou original).
 */
export async function processVideo(input: File): Promise<ProcessedVideo> {
  const originalSize = input.size;
  const fallback: ProcessedVideo = {
    file: input,
    compressed: false,
    originalSizeBytes: originalSize,
    finalSizeBytes: originalSize,
  };

  if (!isVideo(input)) return fallback;
  if (input.size < SKIP_BELOW_BYTES) return fallback;
  if (input.size > SKIP_ABOVE_BYTES) return fallback;

  try {
    const { fetchFile } = await import('@ffmpeg/util');
    const ffmpeg = await loadFfmpeg();

    const inputName = 'input';
    const outputName = 'output.mp4';
    await ffmpeg.writeFile(inputName, await fetchFile(input));

    // Downscale à 720p de hauteur max (largeur auto, divisible par 2), H.264.
    await ffmpeg.exec([
      '-i', inputName,
      '-vf', "scale='min(1280,iw)':'-2'",
      '-c:v', 'libx264',
      '-crf', '28',
      '-preset', 'veryfast',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputName,
    ]);

    const data = await ffmpeg.readFile(outputName);
    // Nettoyage mémoire wasm.
    try { await ffmpeg.deleteFile(inputName); await ffmpeg.deleteFile(outputName); } catch {}

    const blob = new Blob([data], { type: 'video/mp4' });

    // Si la "compression" a grossi le fichier, on garde l'original.
    if (blob.size >= originalSize) return fallback;

    const file = new File(
      [blob],
      input.name.replace(/\.[^.]+$/, '') + '.mp4',
      { type: 'video/mp4' },
    );

    return {
      file,
      compressed: true,
      originalSizeBytes: originalSize,
      finalSizeBytes: file.size,
    };
  } catch (e) {
    console.warn('[processVideo] compression ignorée, upload de l\'original :', e);
    return fallback;
  }
}
