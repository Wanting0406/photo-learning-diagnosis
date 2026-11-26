export function clipboardPhotos(data: Pick<DataTransfer, 'files' | 'items'>): File[] {
  // Browsers expose the same copied files through both collections.
  const files = Array.from(data.files);
  const candidates = files.length ? files : Array.from(data.items)
    .filter((item) => item.kind === 'file').map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  return candidates.filter((file) => file.type.startsWith('image/'));
}

export function photoSelectionError(files: File[]): string {
  if (files.length > 6) return '一次最多选择 6 张照片';
  if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
    return '仅支持 JPG、PNG、WebP 照片';
  }
  if (files.some((file) => file.size > 10 * 1024 * 1024) ||
    files.reduce((size, file) => size + file.size, 0) > 12 * 1024 * 1024) {
    return '单张最多 10 MB，照片合计最多 12 MB';
  }
  return '';
}
