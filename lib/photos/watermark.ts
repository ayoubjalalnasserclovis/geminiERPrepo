/**
 * Applique un watermark sur une image (date/heure + Marrakech) via Canvas.
 * Appliqué APRÈS processPhoto pour ne pas dégrader la compression.
 *
 * Pour les vidéos : on n'applique pas de watermark côté browser (FFmpeg trop lourd
 * sur mobile). On affichera l'horodatage en overlay UI lors de la lecture.
 */

export type WatermarkLines = {
  /** Ligne 1 (généralement « Marrakech »). */
  primary: string;
  /** Ligne 2 (généralement la date/heure formatée). */
  secondary: string;
};

/**
 * Construit les lignes de watermark par défaut : « Marrakech » + date FR.
 */
export function buildDefaultWatermark(now: Date = new Date()): WatermarkLines {
  const date = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return {
    primary: 'Marrakech',
    secondary: `${date} · ${time}`,
  };
}

/**
 * Applique le watermark sur une image (File ou Blob) via Canvas API.
 * Retourne un nouveau File au même format que l'entrée.
 *
 * Style : bandeau semi-transparent en bas, texte blanc avec ombre.
 * Taille auto-ajustée selon la largeur de l'image.
 */
export async function addWatermark(file: File, lines: WatermarkLines): Promise<File> {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file; // fallback : pas de Canvas → pas de watermark

  // 1. Dessine l'image d'origine
  ctx.drawImage(img, 0, 0);

  // 2. Calcule la taille du bandeau (5% de la hauteur, min 60px)
  const bannerH = Math.max(60, Math.round(img.naturalHeight * 0.07));
  const padding = Math.round(bannerH * 0.25);

  // 3. Bandeau semi-transparent en bas
  const gradient = ctx.createLinearGradient(0, img.naturalHeight - bannerH, 0, img.naturalHeight);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.72)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, img.naturalHeight - bannerH, img.naturalWidth, bannerH);

  // 4. Texte blanc avec ombre — primary en gras
  const primarySize = Math.round(bannerH * 0.42);
  const secondarySize = Math.round(bannerH * 0.30);

  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;

  // Primary (Marrakech)
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${primarySize}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  const primaryY = img.naturalHeight - padding - secondarySize - Math.round(padding * 0.3);
  ctx.fillText(lines.primary, padding, primaryY);

  // Secondary (date/heure)
  ctx.fillStyle = '#F5F5F5';
  ctx.font = `${secondarySize}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText(lines.secondary, padding, img.naturalHeight - padding);

  // 5. Reset shadow et export
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  const outputType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  const quality = 0.85;
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Impossible de générer le blob watermarké'))),
      outputType,
      quality,
    );
  });

  return new File([blob], file.name, { type: outputType });
}

function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Impossible de charger l'image pour le watermark"));
    };
    img.src = url;
  });
}
