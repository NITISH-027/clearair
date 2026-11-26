/**
 * Static file serving. Every servable file is read into memory once and looked
 * up by URL path, so no request text ever reaches the file system.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_CONTROL_ASSET, CACHE_CONTROL_HTML, MIME_TYPES, SECURITY_HEADERS } from './config.js';
import { NotFoundError, ValidationError } from './errors.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');

/**
 * Add every servable file under `dir` to `files`, keyed by URL path.
 * @param {Map<string, {type: string, data: Buffer}>} files
 * @param {{dir: string, prefix: string}} source
 */
function addDirectory(files, { dir, prefix }) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- our own folders, not request input
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const type = entry.isFile() ? MIME_TYPES.get(path.extname(entry.name)) : undefined;
    if (!type) continue;
    const full = path.join(entry.parentPath, entry.name);
    const url = prefix + path.relative(dir, full).split(path.sep).join('/');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from readdir of our own folders
    files.set(url, { type, data: readFileSync(full) });
  }
}

/**
 * Load every servable file into memory once, keyed by URL path.
 * @param {string} [publicDir]
 * @param {string} [sharedDir]
 * @returns {Map<string, {type: string, data: Buffer}>}
 */
export function loadStaticFiles(publicDir = PUBLIC_DIR, sharedDir = SHARED_DIR) {
  const files = new Map();
  addDirectory(files, { dir: publicDir, prefix: '/' });
  addDirectory(files, { dir: sharedDir, prefix: '/shared/' });
  return files;
}

/**
 * Find the file for a request path. Throws 400 for a bad escape, 404 when unknown.
 * @param {Map<string, {type: string, data: Buffer}>} files
 * @param {string} pathname
 */
export function findStaticFile(files, pathname) {
  let key;
  try {
    key = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    throw new ValidationError('bad_path', 'Bad path.');
  }
  const file = files.get(key);
  if (!file) throw new NotFoundError();
  return file;
}

/**
 * Write a static file response (no body for HEAD).
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{type: string, data: Buffer}} file
 */
export function sendStaticFile(req, res, file) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': file.type,
    'Content-Length': file.data.length,
    'Cache-Control': file.type.startsWith('text/html') ? CACHE_CONTROL_HTML : CACHE_CONTROL_ASSET,
  });
  res.end(req.method === 'HEAD' ? undefined : file.data);
}
