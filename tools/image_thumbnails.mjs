import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, stat, rename, unlink, readdir, utimes, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const tools = path.dirname(fileURLToPath(import.meta.url));
const cache = path.resolve(tools, '../.paseo-codey/image-previews');
const pending = new Map();
const maxThumbnailBytes = 256 * 1024;

export async function createThumbnail(source, info, config) {
  const key = createHash('sha256').update(JSON.stringify([source, info.size, info.mtimeMs, config.CODEY_LINK_IMAGE_THUMBNAIL_EDGE, config.CODEY_LINK_IMAGE_THUMBNAIL_HEIGHT, config.CODEY_LINK_IMAGE_THUMBNAIL_QUALITY, 2])).digest('hex');
  if (pending.has(key)) return pending.get(key);
  const work = (async () => {
    await mkdir(cache, { recursive: true });
    const destination = path.join(cache, `${key}.jpg`);
    const receiptPath = path.join(cache, `${key}.json`);
    try {
      const existing = await stat(destination);
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      if (existing.size > 0 && existing.size <= maxThumbnailBytes && receipt.version === 1 && receipt.source === source && receipt.sourceSize === info.size && receipt.sourceMtimeMs === info.mtimeMs) {
        await utimes(destination, new Date(), new Date());
        return { path: destination, size: existing.size };
      }
    } catch {}
    const temporary = path.join(cache, `${key}.${randomUUID()}.tmp.jpg`);
    try {
      // 参数直接交给 PowerShell -File，文件名不会作为脚本求值。
      const output = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(tools, 'create_image_thumbnail.ps1'),
        '-SourcePath', source, '-DestinationPath', temporary,
        '-MaxDimension', String(config.CODEY_LINK_IMAGE_THUMBNAIL_EDGE), '-MaxHeight', String(config.CODEY_LINK_IMAGE_THUMBNAIL_HEIGHT), '-Quality', String(config.CODEY_LINK_IMAGE_THUMBNAIL_QUALITY)],
      { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 });
      const generated = await stat(temporary);
      const current = await stat(source);
      if (current.size !== info.size || current.mtimeMs !== info.mtimeMs) throw new Error('Source image changed');
      if (generated.size === 0 || generated.size > maxThumbnailBytes) throw new Error('Thumbnail exceeds size limit');
      const dimensions = JSON.parse(output.stdout.trim());
      if (!['width','height','imageWidth','imageHeight','originalWidth','originalHeight'].every(key => Number.isInteger(dimensions[key]) && dimensions[key] > 0)) throw new Error('Invalid thumbnail dimensions');
      await rename(temporary, destination);
      const receiptTemporary = `${temporary}.json`;
      try {
        await writeFile(receiptTemporary, JSON.stringify({version:1,source,sourceSize:info.size,sourceMtimeMs:info.mtimeMs,...dimensions}));
        await rename(receiptTemporary, receiptPath);
      } finally { await unlink(receiptTemporary).catch(()=>{}); }
      return { path: destination, size: generated.size };
    } finally { await unlink(temporary).catch(() => {}); }
  })();
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
}

export async function pruneThumbnails(protectedPaths = new Set()) {
  // 只回收本模块生成的散列文件；当前批次保留，旧缓存最多保留 128 MiB。
  let names;
  try { names = await readdir(cache); } catch { return; }
  const files = [];
  for (const name of names.filter(n => /^[a-f0-9]{64}\.jpg$/.test(n))) {
    const file = path.join(cache, name);
    try { const info = await stat(file); files.push({ file, size: info.size, modified: info.mtimeMs }); } catch {}
  }
  let bytes = files.reduce((sum, f) => sum + f.size, 0);
  for (const file of files.sort((a, b) => a.modified - b.modified)) {
    if (bytes <= 128 * 1024 * 1024) break;
    if (!protectedPaths.has(file.file)) {
      try { await unlink(file.file); await unlink(file.file.replace(/\.jpg$/, '.json')).catch(()=>{}); bytes -= file.size; } catch {}
    }
  }
}
