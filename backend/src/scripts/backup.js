// Logical backup, restore and restore drill for the application database.
//
//   node src/scripts/backup.js dump    --out backups/schole-<time>.ndjson.gz
//   node src/scripts/backup.js restore --in <file> --to-db <name> [--drop]
//   node src/scripts/backup.js drill   [--keep]
//
// Uses only the MongoDB driver the app already has, so it runs wherever the app runs (Atlas, a VPS,
// a container) without mongodump. Format: gzip of newline-delimited Extended JSON (canonical, so
// ObjectIds, dates and binary survive exactly); the first line is a header listing every collection
// with its document count and index definitions.
//
// `drill` proves a backup can actually be restored: dump → restore into a scratch database on the
// same server → compare every collection (count and a SHA-256 over its documents in _id order) and
// its indexes → drop the scratch database. It exits non-zero on any difference. Run it on a schedule.
//
// Recordings (video files on disk) are not in the database: back up RECORDINGS_DIR separately.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { once } from 'node:events';
import mongoose from 'mongoose';
import env from '../config/env.js';

const { EJSON } = mongoose.mongo.BSON;
const [cmd, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i += 1) {
  if (!rest[i].startsWith('--')) continue;
  const key = rest[i].slice(2);
  opt[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
}
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const log = (...a) => console.log(...a);

async function collectionsOf(db) {
  const list = await db.listCollections({}, { nameOnly: true }).toArray();
  return list.map((c) => c.name).filter((n) => !n.startsWith('system.')).sort();
}

async function dump(db, file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const names = await collectionsOf(db);
  const header = { format: 'schole-backup', version: 1, db: db.databaseName, createdAt: new Date().toISOString(), collections: [] };
  for (const name of names) {
    const indexes = (await db.collection(name).indexes()).filter((ix) => ix.name !== '_id_').map(({ v, ns, ...ix }) => ix);
    header.collections.push({ name, count: await db.collection(name).countDocuments(), indexes });
  }
  const gz = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(file, { mode: 0o600 }); // backups hold personal data: owner-only
  gz.pipe(out);
  const write = async (line) => {
    if (!gz.write(`${line}\n`)) await once(gz, 'drain');
  };
  await write(JSON.stringify(header));
  let total = 0;
  for (const { name } of header.collections) {
    for await (const doc of db.collection(name).find({}).sort({ _id: 1 })) {
      await write(JSON.stringify({ c: name, d: EJSON.serialize(doc, { relaxed: false }) }));
      total += 1;
    }
  }
  gz.end();
  await once(out, 'finish');
  return { header, total, bytes: fs.statSync(file).size };
}

async function* readArchive(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line) yield JSON.parse(line);
}

async function restore(db, file, { drop = false } = {}) {
  let header;
  const batches = new Map();
  let total = 0;
  const flush = async (name) => {
    const docs = batches.get(name);
    if (docs?.length) {
      await db.collection(name).insertMany(docs, { ordered: true });
      total += docs.length;
      batches.set(name, []);
    }
  };
  for await (const row of readArchive(file)) {
    if (!header) {
      if (row.format !== 'schole-backup') throw new Error('Not a Scholé backup file');
      header = row;
      const existing = await collectionsOf(db);
      for (const { name } of header.collections) {
        if (existing.includes(name)) {
          if (!drop) throw new Error(`Collection "${name}" already exists in ${db.databaseName}. Pass --drop to replace it.`);
          await db.collection(name).drop();
        }
        await db.createCollection(name);
      }
      continue;
    }
    if (!batches.has(row.c)) batches.set(row.c, []);
    batches.get(row.c).push(EJSON.deserialize(row.d, { relaxed: false }));
    if (batches.get(row.c).length >= 500) await flush(row.c);
  }
  for (const name of batches.keys()) await flush(name);
  for (const { name, indexes } of header.collections) {
    for (const { key, name: ixName, ...options } of indexes) {
      await db.collection(name).createIndex(key, { name: ixName, ...options });
    }
  }
  return { header, total };
}

/** Count and a SHA-256 over the canonical form of every document, in _id order, plus index names. */
async function fingerprint(db) {
  const out = {};
  for (const name of await collectionsOf(db)) {
    const hash = crypto.createHash('sha256');
    let count = 0;
    for await (const doc of db.collection(name).find({}).sort({ _id: 1 })) {
      hash.update(JSON.stringify(EJSON.serialize(doc, { relaxed: false })));
      count += 1;
    }
    const indexes = (await db.collection(name).indexes()).map((ix) => ix.name).sort();
    out[name] = { count, sha256: hash.digest('hex').slice(0, 16), indexes: indexes.join(',') };
  }
  return out;
}

const conn = await mongoose.createConnection(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 }).asPromise();
const source = conn.db;
let code = 0;
try {
  if (cmd === 'dump') {
    const file = opt.out || `backups/schole-${stamp()}.ndjson.gz`;
    const { header, total, bytes } = await dump(source, file);
    log(`backup ok: ${file} · ${header.collections.length} collections · ${total} documents · ${(bytes / 1024).toFixed(1)} KiB`);
  } else if (cmd === 'restore') {
    if (!opt.in || !opt['to-db']) throw new Error('restore needs --in <file> and --to-db <database name>');
    const target = conn.useDb(opt['to-db'], { useCache: false }).db;
    const { header, total } = await restore(target, opt.in, { drop: Boolean(opt.drop) });
    log(`restore ok: ${total} documents into ${opt['to-db']} (backup of ${header.db}, taken ${header.createdAt})`);
  } else if (cmd === 'drill') {
    const started = Date.now();
    const file = opt.out || path.join(env.RECORDINGS_DIR, '..', 'backups', `drill-${stamp()}.ndjson.gz`);
    const scratchName = `${source.databaseName}_drill_${stamp().toLowerCase()}`;
    log(`drill: ${source.databaseName} → ${file} → ${scratchName}`);
    const before = await fingerprint(source);
    const { total, bytes } = await dump(source, file);
    const scratch = conn.useDb(scratchName, { useCache: false }).db;
    try {
      await restore(scratch, file);
      const after = await fingerprint(scratch);
      const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
      log(`\n  ${'collection'.padEnd(22)} ${'docs'.padStart(7)}  checksum          indexes  result`);
      for (const n of names) {
        const a = before[n];
        const b = after[n];
        const same = a && b && a.count === b.count && a.sha256 === b.sha256 && a.indexes === b.indexes;
        if (!same) code = 1;
        log(`  ${n.padEnd(22)} ${String(a?.count ?? '-').padStart(7)}  ${(a?.sha256 ?? '-').padEnd(16)}  ${String(a?.indexes.split(',').length ?? '-').padStart(7)}  ${same ? 'identical' : `DIFFERS (restored: ${b ? `${b.count} docs, ${b.sha256}, ${b.indexes}` : 'missing'})`}`);
      }
      log(`\n  ${total} documents, ${(bytes / 1024).toFixed(1)} KiB compressed, ${((Date.now() - started) / 1000).toFixed(1)} s`);
      log(code ? '\ndrill FAILED: the restored copy differs from the source.' : '\ndrill passed: the backup restores to an identical database.');
      log('note: writes made during the drill would show as differences; run it at a quiet hour or against a replica.');
    } finally {
      if (!opt.keep) await scratch.dropDatabase();
      if (!opt.keep && !opt.out) fs.rmSync(file, { force: true });
    }
  } else {
    log('usage: backup.js dump [--out file] | restore --in file --to-db name [--drop] | drill [--keep] [--out file]');
    code = 2;
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  code = 1;
} finally {
  await conn.close();
}
process.exit(code);
