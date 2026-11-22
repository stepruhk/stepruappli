import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const localFile = fileURLToPath(new URL('./private/stepru-ressources.json.gz', import.meta.url));
const bucket = 'stepru-lectures-privees';
const objectPath = bucket + '/ressources.json.gz';
let cached;

function storage() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return (route, init = {}) => fetch(url + '/storage/v1/' + route, {
    ...init, headers: { apikey: key, Authorization: 'Bearer ' + key, ...init.headers },
    signal: AbortSignal.timeout(20000),
  });
}

export function decodeMaterials(bytes) {
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw Error('Fichier de lectures invalide.');
  try {
    const pack = JSON.parse(gunzipSync(bytes, {maxOutputLength: 50 * 1024 * 1024}).toString('utf8'));
    if (typeof pack.instructions !== 'string' || !pack.instructions.trim() || !Array.isArray(pack.pages) ||
        !pack.pages.length || !pack.pages.every(p => typeof p.document === 'string' && typeof p.text === 'string' &&
          Number.isInteger(p.page) && p.page > 0)) throw Error();
    return pack;
  } catch { throw Error('Sélectionnez le fichier de ressources préparé pour stépru.'); }
}

async function missing(response) {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  const body = await response.clone().json().catch(() => ({}));
  return String(body.statusCode) === '404' || /not.?found|does not exist/i.test(body.message || '');
}

async function readMaterials() {
  try { return decodeMaterials(await readFile(localFile)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const request = storage();
  if (!request) return null;
  const result = await request('object/authenticated/' + objectPath);
  if (await missing(result)) return null;
  if (!result.ok) throw Error('Le stockage privé des lectures est indisponible.');
  return decodeMaterials(Buffer.from(await result.arrayBuffer()));
}

export async function getMaterials() {
  if (!cached) cached = readMaterials().catch(error => { cached = undefined; throw error; });
  return cached;
}

export async function saveMaterials(bytes) {
  const pack = decodeMaterials(bytes);
  const request = storage();
  if (request) {
    let result = await request('bucket/' + bucket);
    if (await missing(result)) {
      const created = await request('bucket', {method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({id: bucket, name: bucket, public: false})});
      // Another professor session may have initialized the same private bucket.
      if (!created.ok && ![400,409].includes(created.status)) throw Error('Impossible de créer le stockage privé.');
      result = await request('bucket/' + bucket);
    }
    if (!result.ok || (await result.json()).public !== false) throw Error('Le stockage privé des lectures doit être disponible.');
    const saved = await request('object/' + objectPath, {method: 'POST', headers: {'Content-Type':'application/gzip','x-upsert':'true'},body:bytes});
    if (!saved.ok) throw Error('Impossible d’enregistrer les lectures dans le stockage privé.');
  }
  // The local copy also lets the current Render instance serve readings during a storage interruption.
  const temp = localFile + '.' + randomUUID();
  try {
    await mkdir(dirname(localFile), {recursive:true});
    await writeFile(temp, bytes, {mode:0o600});
    await rename(temp, localFile);
  } catch (error) {
    if (!request) throw error;
  } finally { await rm(temp, {force:true}).catch(() => {}); }
  cached = Promise.resolve(pack);
  return { documents: new Set(pack.pages.map(p => p.document)).size, pages: pack.pages.length };
}
