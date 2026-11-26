import html2canvas from 'html2canvas';

export async function reportImage(html: string): Promise<Blob> {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:1000px;border:0;';
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('报告加载超时')), 10000);
      frame.onload = () => { window.clearTimeout(timeout); resolve(); };
      frame.srcdoc = html;
    });
    const document = frame.contentDocument;
    if (!document) throw new Error('报告读取失败');
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(async (image) => {
      await image.decode();
      if (!image.naturalWidth) throw new Error('报告图片加载失败，请重试');
    }));
    const height = document.body.scrollHeight;
    if (height > 16000) throw new Error('报告较长，请导出 HTML 报告');
    frame.style.height = `${height}px`;
    const canvas = await html2canvas(document.body, { width: 900, height, windowWidth: 900,
      windowHeight: height, scale: 1, backgroundColor: '#ffffff', logging: false });
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) =>
      blob ? resolve(blob) : reject(new Error('图片导出失败，请使用 HTML 报告')), 'image/png'));
  } finally { frame.remove(); }
}
