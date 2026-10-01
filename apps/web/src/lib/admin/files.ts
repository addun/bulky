export function isImageFile(file: File | null | undefined): file is File {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(file.name || '');
}

export function isBillFile(file: File | null | undefined): file is File {
  if (!file) return false;
  const name = (file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return true;
  return isImageFile(file);
}

export function namedFile(file: File, fallback: string): File {
  if (file.name) return file;
  const ext = ((file.type || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg');
  try {
    return new File([file], `${fallback}.${ext}`, { type: file.type || 'image/png' });
  } catch {
    return file;
  }
}

export function putFile(input: HTMLInputElement, file: File, fallback: string): File {
  const named = namedFile(file, fallback);
  try {
    const transfer = new DataTransfer();
    transfer.items.add(named);
    input.files = transfer.files;
  } catch {
    /* The browser keeps the original picker value. */
  }
  return named;
}

export function firstMatching(files: FileList | File[], ok: (file: File) => boolean): File | null {
  for (const file of files) if (ok(file)) return file;
  return null;
}

export function pasteFailMessage(kind?: string): string {
  if (kind === 'empty') return 'No image on the clipboard.';
  if (kind === 'denied') return 'Could not read the clipboard.';
  return 'This browser cannot paste an image. Choose a photo instead.';
}

export async function readClipboardImage(): Promise<{ file?: File; error?: string }> {
  if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') return { error: 'unsupported' };
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((entry) => entry.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      return { file: namedFile(new File([blob], '', { type: blob.type }), 'paste') };
    }
    return { error: 'empty' };
  } catch {
    return { error: 'denied' };
  }
}

function clipboardImage(event: ClipboardEvent): File | null {
  const data = event.clipboardData;
  if (!data) return null;
  const fromFiles = firstMatching(data.files, isImageFile);
  if (fromFiles) return fromFiles;
  for (const item of data.items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (isImageFile(file)) return file;
  }
  return null;
}

function pasteIntoField(event: ClipboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && target.type !== 'file' && target.type !== 'checkbox';
}

export function bindPasteImage(handler: (file: File) => void): () => void {
  const onPaste = (event: ClipboardEvent) => {
    const file = clipboardImage(event);
    if (!file) return;
    if (pasteIntoField(event) && event.clipboardData?.getData('text/plain')) return;
    event.preventDefault();
    handler(file);
  };
  document.addEventListener('paste', onPaste);
  return () => document.removeEventListener('paste', onPaste);
}

export function bindFileDrop(wrap: HTMLElement, onFiles: (files: FileList) => void): () => void {
  let overTimer = 0;
  const hasFiles = (event: DragEvent) => {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('Files');
  };
  const mark = (on: boolean) => {
    clearTimeout(overTimer);
    wrap.classList.toggle('is-over', on);
  };
  const enter = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    mark(true);
  };
  const over = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    mark(true);
    overTimer = window.setTimeout(() => mark(false), 150);
  };
  const leave = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    if (event.relatedTarget) return;
    mark(false);
  };
  const drop = (event: DragEvent) => {
    if (!hasFiles(event) || !event.dataTransfer) return;
    event.preventDefault();
    mark(false);
    onFiles(event.dataTransfer.files);
  };
  document.addEventListener('dragenter', enter);
  document.addEventListener('dragover', over);
  document.addEventListener('dragleave', leave);
  document.addEventListener('drop', drop);
  return () => {
    clearTimeout(overTimer);
    document.removeEventListener('dragenter', enter);
    document.removeEventListener('dragover', over);
    document.removeEventListener('dragleave', leave);
    document.removeEventListener('drop', drop);
  };
}
