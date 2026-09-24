export const AVATAR_SIZE = 256;
export const AVATAR_MAX_BYTES = 50_000;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image-load'));
    };
    img.src = url;
  });
}

/** Примерный размер data-URL в байтах. */
export function dataUrlBytes(dataUrl: string): number {
  return dataUrl.length;
}

/**
 * Обрезает картинку по центру в квадрат, уменьшает до 256px и сжимает, пока не влезет в 50 КБ.
 * Safari не умеет кодировать webp, поэтому там получится jpeg.
 */
export async function makeAvatar(file: Blob): Promise<string> {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;

  let size = AVATAR_SIZE;
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      let url = canvas.toDataURL('image/webp', quality);
      if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', quality);
      if (dataUrlBytes(url) <= AVATAR_MAX_BYTES) return url;
    }
    size = Math.round(size * 0.75);
  }
  throw new Error('avatar-too-big');
}
