// Local acceptance check of Tauri/minisign artifacts with the bundled PUBLIC key.
// This is a developer check; production verification is performed by Tauri.
import { readFileSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root,'src-tauri/tauri.conf.json'),'utf8'));
const version = process.argv[2] ?? config.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid version');
const installer = join(root,`releases/SportsDesk_${version}_x64-setup.exe`);
const pubText = Buffer.from(config.plugins.updater.pubkey,'base64').toString('utf8');
const publicBytes = Buffer.from(pubText.trim().split(/\r?\n/).at(-1),'base64');
const signatureText = Buffer.from(readFileSync(installer+'.sig','utf8').trim(),'base64').toString('utf8');
const lines = signatureText.trim().split(/\r?\n/);
const signature = Buffer.from(lines[1],'base64');
if (publicBytes.length !== 42 || signature.length !== 74 || !publicBytes.subarray(2,10).equals(signature.subarray(2,10))) throw new Error('Signature key does not match application public key');
const key = createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),publicBytes.subarray(10)]),format:'der',type:'spki'});
const algorithm = signature.subarray(0,2).toString('ascii');
if (!['Ed','ED'].includes(algorithm)) throw new Error('Unknown signature algorithm');
const verifyPayload = bytes => verify(null,algorithm==='ED'?createHash('blake2b512').update(bytes).digest():bytes,key,signature.subarray(10));
const bytes = readFileSync(installer);
if (!verifyPayload(bytes)) throw new Error('Installer signature is invalid');
if (!lines[2].startsWith('trusted comment: ')) throw new Error('Malformed trusted comment');
if (!verify(null,Buffer.concat([signature.subarray(10),Buffer.from(lines[2].slice(17))]),key,Buffer.from(lines[3],'base64'))) throw new Error('Signature metadata is invalid');
const modified = Buffer.from(bytes); modified[modified.length-1] ^= 1;
if (verifyPayload(modified)) throw new Error('Modified installer was accepted');
const sums = readFileSync(join(root,'releases/SHA256SUMS.txt'),'utf8').replace(/^\uFEFF/,'');
for (const name of [`SportsDesk_${version}_x64-setup.exe`,`SportsDesk_${version}_portable.exe`]) {
  const hash = createHash('sha256').update(readFileSync(join(root,'releases',name))).digest('hex');
  if (!sums.includes(`${hash}  ${name}`)) throw new Error(`Checksum mismatch: ${name}`);
}
console.log(`PASS ${version}: installer signature, trusted metadata, tamper rejection, installer/portable SHA256`);
