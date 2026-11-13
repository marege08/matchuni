// db-corsi.js
//
// Data layer for course-level data: one sql.js database per university,
// downloaded from corsi/<code>.sqlite only when something asks for it.
// Second-level (master's) degrees live in a separate source,
// corsi-magistrali/<code>.sqlite, downloaded only when a master's course is
// chosen: in the same file they would double the download for everyone who
// looks at first-level courses.
//
// This module deliberately touches no DOM. The interface will be redesigned,
// and keeping loading separate from rendering means the redesign can replace
// the table and selectors without rewriting how data reaches the browser.
//
// Why one file per university: all courses in a single database weigh 274 MB
// uncompressed, and the site loads databases INTO the browser. Split by
// university, the largest (Sapienza, 70026) is 13.9 MB on disk and 1.8 MB
// over the network, because GitHub Pages serves it gzip-compressed.

import { NOMI_ATENEO } from './nomi-ateneo.js';

const SQL_JS_BASE = 'https://cdn.jsdelivr.net/npm/sql.js@1.14.0/dist/';

// Each open database lives in the browser's memory. Beyond this many, the
// least recently used ones that no column needs are closed.
export const MAX_ATENEI_APERTI = 4;

// --- sql.js, initialized once ---

let promessaSql = null;

/**
 * Returns the sql.js module, initializing it on first use.
 *
 * Both the aggregate database and the per-university databases share this
 * instance, so the WebAssembly module is downloaded and compiled only once.
 * A failed initialization is forgotten so a later call can retry.
 *
 * @returns {Promise<object>} The sql.js module.
 */
export function inizializzaSql() {
  if (!promessaSql) {
    promessaSql = initSqlJs({ locateFile: (file) => `${SQL_JS_BASE}${file}` });
    promessaSql.catch(() => { promessaSql = null; });
  }
  return promessaSql;
}

// --- Per-university databases ---

// Only real university codes may become a download path, so neither a typo
// nor the AI layer can make the page fetch an arbitrary file.
const CODICI_VALIDI = new Set(Object.keys(NOMI_ATENEO));

// Source -> folder of its per-university files. 'corsi' holds first-level
// and single-cycle courses, 'magistrali' the second-level ones.
const CARTELLE = { corsi: 'corsi', magistrali: 'corsi-magistrali' };

/**
 * Returns the cache key of one university's database in one source.
 *
 * A 'corsi' key is the bare university code, as it was before the second
 * source existed; a 'magistrali' key is prefixed, so the two never collide.
 *
 * @param {string} codice - University code.
 * @param {string} [fonte] - 'corsi' (default) or 'magistrali'.
 * @returns {string} Cache key.
 */
export function chiaveAteneo(codice, fonte = 'corsi') {
  return fonte === 'corsi' ? codice : `${fonte}:${codice}`;
}

// key -> Promise<Database>. Map iteration follows insertion order, and every
// access re-inserts the entry, so the first entries are the least recently used.
const cache = new Map();

// key -> Database, only for downloads that have finished and are still
// cached. The comparison table renders synchronously, so it needs to know
// without awaiting whether a university is ready.
const aperti = new Map();

/**
 * Downloads and opens one university's course database.
 *
 * @param {string} codice - University code.
 * @param {string} fonte - Source, a key of CARTELLE.
 * @returns {Promise<object>} Open sql.js database.
 */
async function scaricaAteneo(codice, fonte) {
  const SQL = await inizializzaSql();
  const risposta = await fetch(`${CARTELLE[fonte]}/${codice}.sqlite`);
  if (!risposta.ok) {
    throw new Error(`Impossibile scaricare i corsi di ${NOMI_ATENEO[codice]} (HTTP ${risposta.status}).`);
  }
  const db = new SQL.Database(new Uint8Array(await risposta.arrayBuffer()));
  // A response that is not a course database (for example an HTML error page
  // served with status 200) would otherwise surface later as a confusing
  // query error far from its cause.
  try {
    db.exec('SELECT 1 FROM dati LIMIT 1;');
  } catch (errore) {
    db.close();
    throw new Error(`Il file dei corsi di ${NOMI_ATENEO[codice]} non è un database valido.`);
  }
  return db;
}

/**
 * Returns the course database of one university, downloading it on first use.
 *
 * Repeated or concurrent calls for the same code and source share one
 * download. A failed download is removed from the cache so the next call
 * retries it.
 *
 * @param {string} codice - University code, e.g. '70026'.
 * @param {string} [fonte] - 'corsi' (default) or 'magistrali'.
 * @returns {Promise<object>} Open sql.js database containing only that university's courses of that source.
 */
export function caricaAteneoCorsi(codice, fonte = 'corsi') {
  if (!CODICI_VALIDI.has(codice)) {
    return Promise.reject(new Error(`Codice ateneo sconosciuto: ${codice}`));
  }
  if (!Object.hasOwn(CARTELLE, fonte)) {
    return Promise.reject(new Error(`Fonte dei corsi sconosciuta: ${fonte}`));
  }
  const chiave = chiaveAteneo(codice, fonte);
  let promessa = cache.get(chiave);
  if (promessa) {
    cache.delete(chiave);
  } else {
    promessa = scaricaAteneo(codice, fonte);
    promessa.then(
      (db) => {
        // An entry evicted while downloading is closed by the eviction and
        // must not reappear as ready.
        if (cache.get(chiave) === promessa) aperti.set(chiave, db);
      },
      () => {
        if (cache.get(chiave) === promessa) cache.delete(chiave);
      }
    );
  }
  cache.set(chiave, promessa);
  return promessa;
}

/**
 * Closes cached databases that no column needs, keeping at most
 * MAX_ATENEI_APERTI open.
 *
 * Closing never happens during a load, only here: the interface calls this
 * whenever it redraws, with the codes it is displaying, so a database still in
 * use is never closed, even when more than MAX_ATENEI_APERTI are displayed at
 * once. A download still in progress is not evicted either: dropping it would
 * waste the transfer and force a new one if the user returns to it.
 *
 * @param {Iterable<string>} chiaviInUso - Keys (chiaveAteneo) of the databases currently displayed.
 */
export function liberaAteneiNonUsati(chiaviInUso) {
  const inUso = new Set(chiaviInUso);
  for (const [chiave, promessa] of cache) {
    if (cache.size <= MAX_ATENEI_APERTI) break;
    if (inUso.has(chiave) || !aperti.has(chiave)) continue;
    cache.delete(chiave);
    aperti.delete(chiave);
    promessa.then((db) => db.close(), () => {});
  }
}

/**
 * Returns a university's course database if it has finished downloading.
 *
 * @param {string} codice - University code.
 * @param {string} [fonte] - 'corsi' (default) or 'magistrali'.
 * @returns {object|null} Open sql.js database, or null while not yet available.
 */
export function ateneoCaricato(codice, fonte = 'corsi') {
  return aperti.get(chiaveAteneo(codice, fonte)) ?? null;
}

/**
 * Reads the rows of one course sheet.
 *
 * Course rows carry both a university and a group code, so the aggregate
 * query (one of the two empty) never matches them: courses are selected by
 * their own code instead. The definition filter follows the same rule as the
 * aggregate query: '' and 'condivisa' rows are valid under every definition.
 *
 * @param {object} db - Course database of the course's university.
 * @param {string} corso - Course code.
 * @param {string} definizione - Selected definition of "employed".
 * @returns {object[]} Rows with the columns the comparison table reads.
 */
export function interrogaCorso(db, corso, definizione) {
  const stmt = db.prepare(
    `SELECT indagine, categoria, indicatore, valore, nota, valore_raw,
            numero_laureati, numero_compilatori
     FROM dati
     WHERE corso = :corso
       AND definizione IN ('', 'condivisa', :definizione)`
  );
  const righe = [];
  try {
    stmt.bind({ ':corso': corso, ':definizione': definizione });
    while (stmt.step()) righe.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return righe;
}

/**
 * Reads where a course belongs: its discipline group and its degree type.
 *
 * Every row of a course carries both, so one row is enough. The Base view
 * needs the group to rank a course among the courses of its group.
 *
 * @param {object} db - Course database of the course's university.
 * @param {string} corso - Course code.
 * @returns {{gruppo:string, tipoCorso:string}|null} Null when the database has no row for the course.
 */
export function descriviCorso(db, corso) {
  const stmt = db.prepare('SELECT gruppo, tipo_corso FROM dati WHERE corso = :corso LIMIT 1');
  try {
    stmt.bind({ ':corso': corso });
    if (!stmt.step()) return null;
    const riga = stmt.getAsObject();
    return { gruppo: riga.gruppo, tipoCorso: riga.tipo_corso };
  } finally {
    stmt.free();
  }
}

/** @returns {string[]} Keys (chiaveAteneo) of the cached databases, least recently used first. */
export function ateneiInMemoria() {
  return [...cache.keys()];
}
