import type { ProductMaterialPreview } from '@shared/api.interface';
import { materialSelectionHtml } from '@shared/diagnosis-presentation';

export function copyMaterialSelection(items: ProductMaterialPreview[]): boolean {
  const content = document.createElement('div');
  content.contentEditable = 'true';
  content.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;';
  const html = materialSelectionHtml(items);
  content.innerHTML = html;
  const selected = window.getSelection();
  const ranges = selected ? Array.from({ length: selected.rangeCount }, (_, i) => selected.getRangeAt(i).cloneRange()) : [];
  const focused = document.activeElement;
  document.body.appendChild(content);
  try {
    content.focus();
    const range = document.createRange(); range.selectNodeContents(content);
    selected?.removeAllRanges(); selected?.addRange(range);
    return document.execCommand('copy');
  } catch { return false; }
  finally {
    content.remove();
    selected?.removeAllRanges(); ranges.forEach(range => selected?.addRange(range));
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}
