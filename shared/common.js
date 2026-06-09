/**
 * Общие утилиты и кроссбраузерный API (Chrome + Firefox).
 */
(function (root) {
  const api = (typeof root.browser !== 'undefined' && root.browser.runtime)
    ? root.browser
    : root.chrome;

  const DEFAULT_SETTINGS = {
    fileNamePattern: 'custom',
    customFileName: 'image',
    convertTo: 'original',
    zipFileName: 'images.zip'
  };

  const KNOWN_EXTS = new Set(['jpg', 'png', 'gif', 'webp', 'bmp', 'svg']);

  function normalizeFormat(format) {
    if (!format || format === 'original') return 'original';
    const f = String(format).toLowerCase();
    if (f === 'jpeg' || f === 'jfif' || f === 'pjpeg') return 'jpg';
    return f;
  }

  function formatToMime(format) {
    switch (normalizeFormat(format)) {
      case 'jpg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'webp': return 'image/webp';
      default: return null;
    }
  }

  function extFromUrl(url) {
    try {
      const name = new URL(url).pathname.split('/').pop() || '';
      if (!name.includes('.')) return '';
      return normalizeFormat(name.split('.').pop().toLowerCase());
    } catch {
      return '';
    }
  }

  function guessExt(url, blob) {
    const fromUrl = extFromUrl(url);
    if (KNOWN_EXTS.has(fromUrl)) return fromUrl;
    const fromType = normalizeFormat((blob?.type || '').split('/').pop() || '');
    if (KNOWN_EXTS.has(fromType)) return fromType;
    return 'jpg';
  }

  function ensureZipName(name) {
    const base = (name || 'images.zip').trim() || 'images.zip';
    return base.endsWith('.zip') ? base : `${base}.zip`;
  }

  function sanitizeBaseName(name) {
    return (name || 'image').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'image';
  }

  function buildFileName(url, index, total, settings, ext) {
    const pattern = settings.fileNamePattern || 'custom';
    let baseName;

    if (pattern === 'original') {
      try {
        const segment = new URL(url).pathname.split('/').pop() || '';
        baseName = segment.includes('.') ? segment.split('.').slice(0, -1).join('.') : segment;
      } catch {
        baseName = '';
      }
      baseName = sanitizeBaseName(baseName || `image_${index + 1}`);
    } else if (pattern === 'numbered') {
      baseName = `image_${index + 1}`;
    } else {
      baseName = sanitizeBaseName(settings.customFileName || 'image');
      if (total > 1) baseName = `${baseName}_${index + 1}`;
    }

    return `${baseName}.${ext}`;
  }

  function getRuntimeURL(path) {
    return api.runtime.getURL(path);
  }

  /** Скачивание blob в контексте страницы (корректное имя в Firefox и Chrome). */
function downloadBlobInPage(zipData, zipFileName) {
    const filename = ensureZipName(zipFileName);
    const bytes = zipData instanceof Uint8Array ? zipData : new Uint8Array(zipData);
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return filename;
  }

  root.IDPCommon = {
    api,
    DEFAULT_SETTINGS,
    KNOWN_EXTS,
    normalizeFormat,
    formatToMime,
    extFromUrl,
    guessExt,
    ensureZipName,
    sanitizeBaseName,
    buildFileName,
    getRuntimeURL,
    downloadBlobInPage
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
