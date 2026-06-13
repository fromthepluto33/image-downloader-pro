// background.js – фоновый скрипт (Firefox)
let JSZipLoaded = false;

function loadJSZip() {
  if (JSZipLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('libs/jszip.min.js');
    script.onload = function() {
      if (typeof JSZip !== 'undefined') {
        JSZipLoaded = true;
        resolve();
      } else reject(new Error('JSZip not found'));
    };
    script.onerror = function() { reject(new Error('Failed to load jszip.min.js')); };
    document.head.appendChild(script);
  });
}

async function convertBlob(blob, targetFormat) {
  if (targetFormat === 'original') return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    let mimeType = targetFormat === 'jpg' ? 'image/jpeg' : (targetFormat === 'png' ? 'image/png' : 'image/webp');
    const converted = await canvas.convertToBlob({ type: mimeType, quality: 0.92 });
    bitmap.close();
    return converted;
  } catch(e) { return blob; }
}

async function downloadSingleImage(url, targetFormat, fileName) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    let blob = await response.blob();
    let ext = (url.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
    if (!ext.match(/jpg|jpeg|png|gif|webp|bmp|svg/)) ext = 'jpg';
    if (targetFormat !== 'original' && targetFormat !== ext) {
      blob = await convertBlob(blob, targetFormat);
      ext = targetFormat;
    }
    let safeName = fileName.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!safeName || safeName === 'i') safeName = 'image';
    const finalFileName = safeName + '.' + ext;
    const objectUrl = URL.createObjectURL(blob);
    chrome.downloads.download({ url: objectUrl, filename: finalFileName, saveAs: true }, function() { URL.revokeObjectURL(objectUrl); });
  } catch(e) { console.error(e); }
}

async function downloadBatch(images, zipFileName) {
  await loadJSZip();
  const zip = new JSZip();
  for (const img of images) {
    try {
      const response = await fetch(img.url);
      if (!response.ok) continue;
      let blob = await response.blob();
      let ext = (img.url.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
      if (img.targetFormat !== 'original' && img.targetFormat !== ext) {
        blob = await convertBlob(blob, img.targetFormat);
        ext = img.targetFormat;
      }
      let safeBase = img.baseName.replace(/[<>:"/\\|?*]/g, '_').trim();
      if (!safeBase || safeBase === 'i') safeBase = 'image';
      const fileName = safeBase + '.' + ext;
      zip.file(fileName, blob, { binary: true });
    } catch(e) { console.warn(e); }
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const objectUrl = URL.createObjectURL(zipBlob);
  chrome.downloads.download({ url: objectUrl, filename: zipFileName, saveAs: true }, function() { URL.revokeObjectURL(objectUrl); });
}

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action === 'downloadSingleImage') downloadSingleImage(msg.url, msg.targetFormat, msg.fileName);
  else if (msg.action === 'downloadBatch') downloadBatch(msg.images, msg.zipFileName);
  sendResponse({ status: 'processing' });
  return true;
});

chrome.action.onClicked.addListener(async function(tab) {
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
  } catch(e) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/util.js', 'content/imageCollector.js', 'content/areaSelector.js', 'content/panel.js']
    });
    await new Promise(function(r) { setTimeout(r, 150); });
    await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
  }
});