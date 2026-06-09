/**
 * Image Downloader Pro — Area Selector
 * Lets the user draw a rectangle on the screen and returns
 * only those images from the full list that intersect the selection.
 */
window.IDP = window.IDP || {};

(function(exports) {

  function startAreaSelection(fullImageList) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'z-index:2147483648;cursor:crosshair;background:rgba(0,0,0,0.15);';
      document.body.appendChild(overlay);

      let startX, startY, selectionDiv;
      let cleaned = false;

      function cleanup() {
        if (cleaned) return;
        cleaned = true;
        overlay.removeEventListener('mousedown', onDown, true);
        overlay.removeEventListener('mousemove', onMove, true);
        overlay.removeEventListener('mouseup', finish, true);
        document.removeEventListener('keydown', onEscape, true);
        if (overlay.parentNode) overlay.remove();
        if (selectionDiv && selectionDiv.parentNode) selectionDiv.remove();
      }

      const onDown = e => {
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;
        selectionDiv = document.createElement('div');
        selectionDiv.style.cssText =
          'position:fixed;border:2px dashed red;background:rgba(255,0,0,0.1);' +
          'pointer-events:none;z-index:2147483649;';
        overlay.appendChild(selectionDiv);
      };

      const onMove = e => {
        if (!selectionDiv) return;
        const left = Math.min(startX, e.clientX);
        const top = Math.min(startY, e.clientY);
        const width = Math.abs(e.clientX - startX);
        const height = Math.abs(e.clientY - startY);
        selectionDiv.style.left = left + 'px';
        selectionDiv.style.top = top + 'px';
        selectionDiv.style.width = width + 'px';
        selectionDiv.style.height = height + 'px';
      };

      const finish = () => {
        // ВАЖНО: получить rect ДО cleanup(), пока элемент ещё в DOM
        const rect = selectionDiv ? selectionDiv.getBoundingClientRect() : null;
        cleanup();

        if (!rect || (rect.width === 0 && rect.height === 0)) {
          return resolve([]);
        }

        const intersecting = [];

        for (const img of fullImageList) {
          if (img.el && typeof img.el.getBoundingClientRect === 'function') {
            try {
              const er = img.el.getBoundingClientRect();
              if (er.width === 0 || er.height === 0) continue;
              if (
                er.right > rect.left &&
                er.left < rect.right &&
                er.bottom > rect.top &&
                er.top < rect.bottom
              ) {
                intersecting.push({
                  url: img.url,
                  width: img.width,
                  height: img.height,
                  ext: img.ext,
                  size: null,
                  el: img.el
                });
              }
            } catch (e) {
              // Элемент мог быть удалён со страницы
            }
          }
        }

        // Если ничего не нашли по координатам, но есть изображения без DOM-элемента —
        // возвращаем пустой массив, а не всё подряд.
        // (Раньше здесь был агрессивный fallback, который портил логику)
        resolve(intersecting);
      };

      const onEscape = e => {
        if (e.key === 'Escape') {
          cleanup();
          resolve([]);
        }
      };

      overlay.addEventListener('mousedown', onDown, true);
      overlay.addEventListener('mousemove', onMove, true);
      overlay.addEventListener('mouseup', finish, true);
      overlay.addEventListener('dragstart', e => e.preventDefault());
      document.addEventListener('keydown', onEscape, true);
    });
  }

  exports.startAreaSelection = startAreaSelection;

})(window.IDP);