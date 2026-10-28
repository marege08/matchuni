// app.js
//
// Connects the prepared components:
//   sql.js + almalaurea.sqlite loading -> CONFIG_FILTRI (config-filtri.js)
//   -> selected-sheet queries -> processData (processData.js)
//   -> comparison table.
//
// No bundler is used: ES modules are imported directly from static files.

import { CONFIG_FILTRI } from './config-filtri.js';
import { processData } from './processData.js';
import { NOMI_ATENEO } from './nomi-ateneo.js';
import { NOMI_GRUPPO } from './nomi-gruppo.js';
import { chiediConfronto } from './ai/connettore.js';
import { NOMI_CORSO } from './nomi-corso.js';
import { SIGLE_ATENEO, SIGLE_GRUPPO } from './sigle.js';
import {
  inizializzaSql,
  caricaAteneoCorsi,
  ateneoCaricato,
  interrogaCorso,
  descriviCorso,
  liberaAteneiNonUsati,
} from './db-corsi.js';
import {
  INDICATORI_CRUSCOTTO,
  ALTRI_INDICATORI_PRINCIPALI,
  etichettaUfficiale,
  scalaPer,
  posizioneSu,
  formattaConUnita,
  etichetteScala,
} from './indicatori-chiave.js';
import { calcolaVoto, fraseVoto, SOGLIA_RISPONDENTI } from './voto.js';
import { TERMINI_PARAGONE } from './termini-paragone.js';
import { creaTendina, potenziaSelect } from './tendina.js';
import { creaXlsx } from './esporta-xlsx.js';
import { attivaSuggerimenti } from './suggerimento.js';

const ORDINE_MACRO = Object.keys(CONFIG_FILTRI);

// --- Small-sample threshold ---
// Below this number of respondents a percentage is unstable: with thirty
// respondents, one case more or less moves the value by more than three
// points, and the difference between two columns becomes noise. Cells based on
// a sample smaller than the threshold are de-emphasized and explained in their
// tooltip instead of being displayed like every other cell.
//
// Aggregate university and group data never fall below the threshold: the
// smallest sample in the published database has 61 respondents. The mechanism
// is intended for course-level data, where respondents regularly number only a
// few dozen, and keeping it as a single constant makes it adjustable in one
// place. The 0-10 score (js/voto.js) uses the same threshold, so a value
// marked as a small sample here never gets a score there.
const SOGLIA_CAMPIONE_PICCOLO = SOGLIA_RISPONDENTI;

// --- In-memory UI state ---
let db = null;
let codiciAteneo = [];
let codiciGruppo = [];
// Entries have the shape { id, tipo: 'ateneo'|'gruppo'|'corso', codice }; a
// 'corso' column also stores its university in `ateneo`, since course codes
// are looked up inside that university's database.
let colonne = [];
let contatoreColonne = 0;
// The full table as last drawn by renderTabella(), for the Excel download:
// { colonne: [{ colonna, numerosita }], righe: [{ macro, domanda, opzione,
// celle: [{ valore, testo, piccolo }] }] }, or null when it shows no values.
let tabellaMostrata = null;

// --- Definition of "employed" (only the `occupazione` employment outcomes survey) ---
// AlmaLaurea sheets contain TWO complete versions of these data, one for each
// official definition, while their JavaScript displays only one. The default
// matches the site (ampia for years after 2020), avoiding apparent discrepancies
// between the official site and this application for the same question.
const DEFINIZIONE_PREDEFINITA = 'ampia';
let definizioneScelta = DEFINIZIONE_PREDEFINITA;
let definizioniDisponibili = [];

// These are AlmaLaurea's official definitions, copied from sheet tooltips.
const TESTO_DEFINIZIONE = {
  ampia:
    'Si considerano occupati tutti coloro che dichiarano di svolgere un\u2019attivit\u00e0, ' +
    'anche di formazione, purch\u00e9 retribuita.',
  restrittiva:
    'Sono considerati occupati i laureati che dichiarano di svolgere un\u2019attivit\u00e0 ' +
    'lavorativa retribuita, anche con assegno di ricerca, purch\u00e9 non si tratti di ' +
    'un\u2019attivit\u00e0 di formazione (tirocinio, praticantato, dottorato, specializzazione, ecc.).',
};

// An entry is queryable when it is definition-independent ('' is the graduate
// profile survey, where no duplicate exists; 'condivisa' is a block not duplicated on
// the page and valid for both definitions) or exists under the selected
// definition. The four questions available under only one definition are thus
// hidden instead of rendered as dashes.
function voceDisponibile(voce) {
  return voceNelConfronto(voce) && voce.definizioni.some(
    (d) => d === '' || d === 'condivisa' || d === definizioneScelta
  );
}

// Course-only questions (`soloCorso`, see config-filtri.js) ask first-level
// graduates what they did after the degree; universities and groups mix all
// degree types and have no answer. They join the comparison only when at least
// one course column is present, instead of adding rows every column leaves
// empty.
function voceNelConfronto(voce) {
  return !voce.soloCorso || colonne.some((c) => c.tipo === 'corso');
}

// Map entry IDs to { voce, macro } for quick CONFIG_FILTRI lookup from a
// selected checkbox ID.
const VOCE_PER_ID = new Map();
for (const macro of ORDINE_MACRO) {
  for (const voce of CONFIG_FILTRI[macro]) {
    VOCE_PER_ID.set(voce.id, { voce, macro });
  }
}

// --- DOM references ---
const elStatoCaricamento = document.getElementById('stato-caricamento');
const elAreaApp = document.getElementById('area-app');
const elAreaErrore = document.getElementById('area-errore');
const elColonneSchede = document.getElementById('colonne-schede');
const elBtnAggiungiColonna = document.getElementById('btn-aggiungi-colonna');
const elGettoni = document.getElementById('gettoni');
const elDlgColonna = document.getElementById('dlg-colonna');
const elDlgColonnaCorpo = document.getElementById('dlg-colonna-corpo');
const elAccordionFiltri = document.getElementById('accordion-filtri');
const elRiquadroDefinizione = document.getElementById('riquadro-definizione');
const elSelDefinizione = document.getElementById('sel-definizione');
const elNotaDefinizione = document.getElementById('nota-definizione');
const elTabellaHead = document.getElementById('tabella-head');
const elTabellaBody = document.getElementById('tabella-body');
const elLegendaCampione = document.getElementById('legenda-campione');
const elNotaSintesi = document.getElementById('nota-sintesi');
const elGrigliaSintesi = document.getElementById('griglia-sintesi');

const elAvvisi = document.getElementById('avvisi');
const elAvvisiTitolo = document.getElementById('avvisi-titolo');
const elAvvisiLista = document.getElementById('avvisi-lista');
const elContaDomande = document.getElementById('conta-domande');
const elRisultato = document.getElementById('risultato');
const elAzioneConfronta = document.getElementById('azione-confronta');

// One marker per comparison column, shared by the column selector, the table
// header and the summary, so a value can be matched to its
// column at a glance. Columns differ by SHAPE first and by tone second (the
// tones are CSS classes f0..f5 in style.css): several greens alone would not
// be enough. Shapes are drawn on a 12x12 box.
const SVG = 'http://www.w3.org/2000/svg';
const FORME_SEGNO = [
  ['circle', { cx: 6, cy: 6, r: 5 }],
  ['polygon', { points: '6,0.5 11.5,6 6,11.5 0.5,6' }],
  ['rect', { x: 1.5, y: 1.5, width: 9, height: 9 }],
  ['polygon', { points: '6,1 11.5,11 0.5,11' }],
  ['polygon', { points: '0.5,1 11.5,1 6,11' }],
  ['polygon', { points: '3,1 9,1 11.5,6 9,11 3,11 0.5,6' }],
];

/**
 * Creates the marker of a comparison column.
 *
 * A hollow marker means a value based on fewer respondents than
 * SOGLIA_CAMPIONE_PICCOLO, the same meaning everywhere on the page.
 *
 * @param {number} indice - Position of the column, from 0.
 * @param {boolean} [vuoto] - Draw the outline only (small sample).
 * @param {string} [testo] - Tooltip, for a marker that stands for a value.
 * @returns {SVGSVGElement} Marker.
 */
function creaSegno(indice, vuoto = false, testo = '') {
  const posizione = indice % FORME_SEGNO.length;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('class', `segno f${posizione}${vuoto ? ' segno-incerto' : ''}`);
  const [tag, attributi] = FORME_SEGNO[posizione];
  const forma = document.createElementNS(SVG, tag);
  for (const [nome, valore] of Object.entries(attributi)) forma.setAttribute(nome, valore);
  forma.setAttribute('fill', vuoto ? 'none' : 'currentColor');
  if (vuoto) {
    forma.setAttribute('stroke', 'currentColor');
    forma.setAttribute('stroke-width', '2');
  }
  svg.append(forma);
  if (testo) {
    const titolo = document.createElementNS(SVG, 'title');
    titolo.textContent = testo;
    svg.prepend(titolo);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  return svg;
}

/**
 * Creates an element with attributes and children.
 *
 * Children that are strings become text nodes, never HTML: course names come
 * from an external source and must not be interpreted as markup.
 *
 * @param {string} tag - Element name.
 * @param {object} [attributi] - Attributes; `class` sets className, `style` accepts an object.
 * @param {...(Node|string|null|undefined|false)} figli - Children; empty values are skipped.
 * @returns {HTMLElement} New element.
 */
function el(tag, attributi = {}, ...figli) {
  const nodo = document.createElement(tag);
  for (const [nome, valore] of Object.entries(attributi)) {
    if (valore === null || valore === undefined || valore === false) continue;
    if (nome === 'class') nodo.className = valore;
    else if (nome === 'style') Object.assign(nodo.style, valore);
    else nodo.setAttribute(nome, valore === true ? '' : valore);
  }
  for (const figlio of figli) {
    if (figlio === null || figlio === undefined || figlio === false) continue;
    nodo.append(figlio);
  }
  return nodo;
}

/**
 * Displays an error message and optionally logs the underlying error.
 *
 * @param {string} messaggio - Message to display.
 * @param {Error|undefined} errore - Error to log, when available.
 */
function mostraErrore(messaggio, errore) {
  elStatoCaricamento.classList.add('nascosto');
  elAreaErrore.classList.remove('nascosto');
  elAreaErrore.textContent = messaggio;
  if (errore) console.error(errore);
}

// --- 1. Database loading (sql.js + almalaurea.sqlite) ---

/** @returns {Promise<object>} In-memory sql.js database. */
async function caricaDatabase() {
  // Shared with the per-university course databases (db-corsi.js), so sql.js
  // is initialized once for the whole page.
  const SQL = await inizializzaSql();
  const risposta = await fetch('almalaurea.sqlite');
  if (!risposta.ok) {
    throw new Error(`Impossibile scaricare almalaurea.sqlite (HTTP ${risposta.status}). È nella stessa cartella di questa pagina?`);
  }
  const buffer = await risposta.arrayBuffer();
  return new SQL.Database(new Uint8Array(buffer));
}

/** @param {object} database - sql.js database to inspect. */
function leggiCodici(database) {
  const ateneo = database.exec("SELECT DISTINCT ateneo FROM dati WHERE ateneo != '' ORDER BY ateneo;");
  const gruppo = database.exec("SELECT DISTINCT gruppo FROM dati WHERE gruppo != '' ORDER BY gruppo;");
  codiciAteneo = ateneo.length ? ateneo[0].values.map((riga) => riga[0]) : [];
  codiciGruppo = gruppo.length ? gruppo[0].values.map((riga) => riga[0]) : [];
  // Group codes are text ('1'..'15'), so numeric rather than lexicographic
  // ordering is required; otherwise '10' would precede '2'.
  codiciGruppo.sort((a, b) => Number(a) - Number(b));

  // Read definitions from the dataset rather than a hard-coded list. If a data
  // update removes one, the selector stops offering a choice with no rows.
  const definizioni = database.exec(
    "SELECT DISTINCT definizione FROM dati " +
    "WHERE definizione NOT IN ('', 'condivisa', 'sconosciuta') ORDER BY definizione;"
  );
  definizioniDisponibili = definizioni.length
    ? definizioni[0].values.map((riga) => riga[0])
    : [];
  if (!definizioniDisponibili.includes(definizioneScelta)) {
    definizioneScelta = definizioniDisponibili[0] ?? DEFINIZIONE_PREDEFINITA;
  }
}

// --- 2. Selector for sheets to compare ---

/**
 * Returns codes for the selected entity type.
 *
 * @param {string} tipo - Entity type.
 * @returns {string[]} Codes for the selected entity type.
 */
function codiciPerTipo(tipo) {
  return tipo === 'ateneo' ? codiciAteneo : codiciGruppo;
}

/**
 * Returns the display label for an entity code.
 *
 * @param {string} tipo - Entity type.
 * @param {string} codice - Entity code.
 * @returns {string} Display label.
 */
function etichettaCodice(tipo, codice) {
  if (tipo === 'ateneo') return NOMI_ATENEO[codice] ?? `Ateneo ${codice}`;
  return NOMI_GRUPPO[codice] ?? `Gruppo ${codice}`;
}

/**
 * Returns the display label for a comparison column.
 *
 * @param {{tipo:string,codice:string,ateneo?:string}} colonna - Sheet selection.
 * @returns {string} Display label.
 */
function etichettaColonna(colonna) {
  if (colonna.tipo === 'corso') {
    return NOMI_CORSO[colonna.ateneo]?.[colonna.codice] ?? `Corso ${colonna.codice}`;
  }
  return etichettaCodice(colonna.tipo, colonna.codice);
}

/**
 * Counts a column the user picked as an anonymous GoatCounter event, so the
 * dashboard shows which universities, areas and courses people look for. The
 * counter (index.html) loads on its own and may be blocked or still loading:
 * then nothing is counted and nothing breaks.
 *
 * @param {{tipo:string,codice:string,ateneo?:string}} colonna - Column just picked.
 */
function contaScelta(colonna) {
  const nome = colonna.tipo === 'corso'
    ? `corso: ${etichettaColonna(colonna)} (${etichettaCodice('ateneo', colonna.ateneo)})`
    : `${colonna.tipo === 'gruppo' ? 'area' : 'ateneo'}: ${etichettaColonna(colonna)}`;
  window.goatcounter?.count?.({ path: nome, title: nome, event: true });
}

/**
 * Returns codes sorted by display label.
 *
 * @param {string} tipo - Entity type.
 * @returns {string[]} Codes sorted by display label.
 */
function codiciOrdinatiPerVisualizzazione(tipo) {
  const codici = [...codiciPerTipo(tipo)];
  // Both universities and groups are easier to scan alphabetically by name;
  // their codes have no meaningful display order.
  codici.sort((a, b) => etichettaCodice(tipo, a).localeCompare(etichettaCodice(tipo, b), 'it'));
  return codici;
}

/**
 * Returns the options of an "Ateneo o area" field: the universities, then the
 * discipline groups, each sorted by name.
 *
 * @returns {object[]} Options for creaTendina(), valued `ateneo:<code>` or `gruppo:<code>`.
 */
function opzioniEntita() {
  return [
    ...codiciOrdinatiPerVisualizzazione('ateneo').map((c) =>
      ({ valore: `ateneo:${c}`, testo: etichettaCodice('ateneo', c), sezione: 'Atenei' })),
    ...codiciOrdinatiPerVisualizzazione('gruppo').map((c) =>
      ({ valore: `gruppo:${c}`, testo: etichettaCodice('gruppo', c), sezione: 'Aree disciplinari, in tutta Italia' })),
  ];
}

/**
 * Downloads the university of a course column, then redraws the table.
 *
 * The table renders synchronously, so a course column first appears with a
 * loading note and is drawn again here once its data is available. A failed
 * download is shown in the column header instead of as empty cells.
 *
 * @param {object} stato - Course column state.
 */
async function preparaColonnaCorso(stato) {
  const ateneo = stato.ateneo;
  if (ateneoCaricato(ateneo)) return;
  // The error is cleared by every new user selection (mostra), never here: a
  // late successful download of a university the user has already left must
  // not erase the error of the university now selected.
  try {
    await caricaAteneoCorsi(ateneo);
  } catch (errore) {
    if (stato.ateneo === ateneo) stato.errore = errore.message;
  }
  // The user may have removed the column or picked another university while
  // the download was running; only a still-current selection is redrawn.
  if (colonne.includes(stato) && stato.ateneo === ateneo) renderTabella();
}

// Refresh functions of the drawn column fields, by column id: the fields
// show the column state, which every redraw may have changed.
const AGGIORNA_CAMPI_COLONNA = new Map();

/**
 * Creates a comparison column.
 *
 * The three native selects (type, university or group, course) hold the
 * column state and carry the change handlers; they stay in the page, hidden.
 * The user sees two drawn fields instead (js/tendina.js): "Ateneo o area",
 * which lists the universities and the discipline groups, and "Corso, se
 * vuoi", which lists the university's courses after "Tutto l'ateneo". A pick
 * in a drawn field sets the selects in the order a user would and dispatches
 * their "change" events, so the handlers below are the only place where the
 * state changes.
 *
 * A course column created here needs its university
 * too, since course codes are looked up inside that university's database;
 * the course download starts at once and the table redraws when it ends.
 *
 * @param {string} tipoIniziale - Initial entity type ('ateneo', 'gruppo' or 'corso').
 * @param {string} codiceIniziale - Initial entity code.
 * @param {string} [ateneoIniziale] - University of a course column.
 */
function creaColonna(tipoIniziale, codiceIniziale, ateneoIniziale) {
  const id = `colonna-${contatoreColonne++}`;
  const stato = {
    id,
    tipo: tipoIniziale,
    codice: codiceIniziale,
    ateneo: tipoIniziale === 'corso' ? ateneoIniziale : null,
  };
  colonne.push(stato);

  const contenitore = document.createElement('div');
  contenitore.className = 'colonna-scheda';
  contenitore.dataset.id = id;

  // Filled by renderTabella(), which knows the column's current position.
  const postoSegno = document.createElement('span');
  postoSegno.className = 'posto-segno';
  const numeroColonna = document.createElement('span');
  numeroColonna.className = 'numero-colonna';

  const selectTipo = document.createElement('select');
  selectTipo.className = 'sel-tipo';
  selectTipo.innerHTML =
    '<option value="ateneo">Ateneo</option><option value="gruppo">Gruppo</option>' +
    '<option value="corso">Corso</option>';
  selectTipo.value = tipoIniziale;

  // University or group; for a course column, the course's university.
  const selectCodice = document.createElement('select');
  selectCodice.className = 'sel-codice';
  const selectCorso = document.createElement('select');
  selectCorso.className = 'sel-corso';

  function aggiornaOpzioniCorso() {
    const corsi = Object.entries(NOMI_CORSO[stato.ateneo] ?? {});
    // Options are built as DOM nodes: course names come from an external
    // source and are never interpreted as HTML.
    selectCorso.replaceChildren(...corsi.map(([c, nome]) => new Option(nome, c)));
    if (!corsi.some(([c]) => c === stato.codice)) stato.codice = corsi[0]?.[0] ?? '';
    selectCorso.value = stato.codice;
  }

  function aggiornaOpzioniCodice() {
    const perCorso = selectTipo.value === 'corso';
    const tipoLista = perCorso ? 'ateneo' : selectTipo.value;
    const codici = codiciOrdinatiPerVisualizzazione(tipoLista);
    selectCodice.innerHTML = codici
      .map((c) => `<option value="${c}">${etichettaCodice(tipoLista, c)}</option>`)
      .join('');
    const voluto = perCorso ? stato.ateneo : stato.codice;
    const scelto = codici.includes(voluto) ? voluto : codici[0] ?? '';
    selectCodice.value = scelto;
    if (perCorso) {
      stato.ateneo = scelto;
      aggiornaOpzioniCorso();
    } else {
      stato.codice = scelto;
      stato.ateneo = null;
    }
  }

  function mostra() {
    stato.errore = undefined;
    renderTabella();
    if (stato.tipo === 'corso') preparaColonnaCorso(stato);
  }

  selectTipo.addEventListener('change', () => {
    // Switching from a university to "Corso" keeps that university.
    if (selectTipo.value === 'corso' && stato.tipo === 'ateneo') stato.ateneo = stato.codice;
    stato.tipo = selectTipo.value;
    aggiornaOpzioniCodice();
    mostra();
  });
  selectCodice.addEventListener('change', () => {
    if (stato.tipo === 'corso') {
      stato.ateneo = selectCodice.value;
      aggiornaOpzioniCorso();
    } else {
      stato.codice = selectCodice.value;
    }
    mostra();
  });
  selectCorso.addEventListener('change', () => {
    stato.codice = selectCorso.value;
    mostra();
  });

  aggiornaOpzioniCodice();
  // For a course column aggiornaOpzioniCodice() has already placed both the
  // university and the course; its code list is the universities' one.
  if (tipoIniziale !== 'corso') {
    selectCodice.value = codiceIniziale;
    stato.codice = codiceIniziale;
  }

  const btnRimuovi = document.createElement('button');
  btnRimuovi.type = 'button';
  btnRimuovi.className = 'rimuovi-colonna togli';
  btnRimuovi.title = 'Rimuovi questa colonna';
  btnRimuovi.textContent = '×';
  btnRimuovi.addEventListener('click', () => {
    colonne = colonne.filter((c) => c.id !== id);
    AGGIORNA_CAMPI_COLONNA.delete(id);
    contenitore.remove();
    renderTabella();
    // Removed from its phone pop-up: nothing is left to edit there.
    if (elDlgColonna.open && !elDlgColonnaCorpo.firstChild) elDlgColonna.close();
  });

  btnRimuovi.setAttribute('aria-label', 'Rimuovi questa colonna');
  selectTipo.setAttribute('aria-label', 'Tipo di colonna');
  selectCodice.setAttribute('aria-label', 'Ateneo o gruppo');
  selectCorso.setAttribute('aria-label', 'Corso');
  for (const s of [selectTipo, selectCodice, selectCorso]) {
    s.hidden = true;
    s.tabIndex = -1;
  }

  /**
   * Sets one of the hidden selects as a user would, firing its handler.
   *
   * @param {HTMLSelectElement} select - Select to set.
   * @param {string} valore - Value to choose.
   */
  function imposta(select, valore) {
    select.value = valore;
    select.dispatchEvent(new Event('change'));
  }
  const ateneoDellaColonna = () => (stato.tipo === 'corso' ? stato.ateneo : stato.codice);

  const campoEntita = creaTendina({
    etichetta: 'Ateneo o area',
    classe: 'campo-entita',
    cerca: true,
    segnaposto: 'Cerca un ateneo o un\'area…',
    opzioni: opzioniEntita,
    valore: () => (stato.tipo === 'gruppo' ? `gruppo:${stato.codice}` : `ateneo:${ateneoDellaColonna()}`),
    testo: () => etichettaCodice(stato.tipo === 'gruppo' ? 'gruppo' : 'ateneo', ateneoDellaColonna()),
    scegli: (valore) => {
      const [tipo, codice] = valore.split(':');
      // Picking a university shows the whole university: a course of the
      // previous one would not belong to it.
      if (stato.tipo !== tipo) imposta(selectTipo, tipo);
      imposta(selectCodice, codice);
      contaScelta(stato);
    },
  });

  const campoCorso = creaTendina({
    etichetta: 'Corso, se vuoi',
    classe: 'campo-corso facoltativo',
    cerca: true,
    segnaposto: 'Cerca un corso…',
    opzioni: () => [
      { valore: '', testo: 'Tutto l\'ateneo', nota: 'tutti i corsi e tutti i tipi di laurea' },
      ...Object.entries(NOMI_CORSO[ateneoDellaColonna()] ?? {}).map(([c, nome]) =>
        ({ valore: c, testo: nome })),
    ],
    valore: () => (stato.tipo === 'corso' ? stato.codice : ''),
    testo: () => (stato.tipo === 'corso' ? etichettaColonna(stato) : 'Tutto l\'ateneo'),
    scegli: (corso) => {
      const ateneo = ateneoDellaColonna();
      if (!corso) {
        imposta(selectTipo, 'ateneo');
        imposta(selectCodice, ateneo);
      } else {
        if (stato.tipo !== 'corso') imposta(selectTipo, 'corso');
        imposta(selectCorso, corso);
      }
      contaScelta(stato);
    },
  });

  AGGIORNA_CAMPI_COLONNA.set(id, () => {
    campoEntita.aggiorna();
    campoCorso.aggiorna();
    campoCorso.elemento.hidden = stato.tipo === 'gruppo';
  });

  const testa = el('div', { class: 'colonna-testa' }, postoSegno, numeroColonna, btnRimuovi);
  contenitore.append(testa, campoEntita.elemento, campoCorso.elemento, selectTipo, selectCodice, selectCorso);
  elColonneSchede.appendChild(contenitore);
  AGGIORNA_CAMPI_COLONNA.get(id)();
  if (stato.tipo === 'corso') preparaColonnaCorso(stato);
}

/** Adds a university column on a wide screen and redraws. */
function aggiungiColonna() {
  // Prefer a university that has not already been selected, when available.
  const usati = new Set(colonne.filter((c) => c.tipo === 'ateneo').map((c) => c.codice));
  const prossimo = codiciAteneo.find((c) => !usati.has(c)) ?? codiciAteneo[0];
  creaColonna('ateneo', prossimo);
  renderTabella();
}

elBtnAggiungiColonna.addEventListener('click', aggiungiColonna);

// --- 2b. Column tokens and pop-up, on a phone ---
// The column boxes take half a phone screen before the first number. There
// each column becomes a round token with its short label (js/sigle.js), its
// marker and one word, and touching it opens that column's box in a pop-up.
// The box is MOVED into the pop-up and back, never copied, so the fields keep
// one set of handlers.

const TELEFONO = matchMedia('(max-width: 760px)');

/**
 * Returns the short label of a column, for its token.
 *
 * @param {{tipo:string,codice:string,ateneo?:string}} colonna - Column state.
 * @returns {string} Two to four characters.
 */
function siglaColonna(colonna) {
  if (colonna.tipo === 'gruppo') return SIGLE_GRUPPO[colonna.codice] ?? colonna.codice;
  const ateneo = colonna.tipo === 'corso' ? colonna.ateneo : colonna.codice;
  return SIGLE_ATENEO[ateneo] ?? etichettaCodice('ateneo', ateneo).slice(0, 3);
}

/**
 * Opens a column's box in the phone pop-up.
 *
 * @param {string} id - Column id.
 */
function apriColonna(id) {
  const box = document.querySelector(`.colonna-scheda[data-id="${id}"]`);
  if (!box) return;
  rimettiBox();
  elDlgColonnaCorpo.append(box);
  if (!elDlgColonna.open) elDlgColonna.showModal();
}

/**
 * Opens the phone pop-up on an empty "Ateneo o area" field, with its list
 * closed. The column is created only when the user picks something, so no
 * example university ever appears and closing the pop-up adds nothing.
 */
function apriNuovaColonna() {
  const campo = creaTendina({
    etichetta: 'Ateneo o area',
    classe: 'campo-entita',
    cerca: true,
    segnaposto: 'Cerca un ateneo o un\'area…',
    opzioni: opzioniEntita,
    valore: () => '',
    testo: () => 'Scegli un ateneo o un\'area',
    scegli: (valore) => {
      const [tipo, codice] = valore.split(':');
      creaColonna(tipo, codice);
      contaScelta(colonne.at(-1));
      renderTabella();
      // The real box takes the empty field's place, with its "Corso" field.
      apriColonna(colonne.at(-1).id);
    },
  });
  const nuova = el('div', { class: 'colonna-nuova' },
    el('div', { class: 'colonna-testa' }, el('span', {}, `Colonna ${colonne.length + 1}`)),
    campo.elemento);
  rimettiBox();
  elDlgColonnaCorpo.append(nuova);
  if (!elDlgColonna.open) elDlgColonna.showModal();
}

/** Draws one token per column, then the add button. */
function renderGettoni() {
  const gettoni = colonne.map((c, i) => {
    const nota = c.tipo === 'corso' ? etichettaColonna(c) : c.tipo === 'gruppo' ? 'Area' : 'Ateneo';
    const descrizione = c.tipo === 'corso'
      ? `${etichettaColonna(c)}, ${etichettaCodice('ateneo', c.ateneo)}`
      : etichettaColonna(c);
    const gettone = el('button',
      { type: 'button', class: 'gettone', 'data-posto': i % FORME_SEGNO.length,
        'aria-label': `Colonna ${i + 1}: ${descrizione}. Cambia`, title: descrizione },
      el('span', { class: 'gettone-cerchio', 'aria-hidden': 'true' }, siglaColonna(c)),
      el('span', { class: 'gettone-nota', 'aria-hidden': 'true' }, creaSegno(i), el('span', {}, nota)));
    gettone.addEventListener('click', () => apriColonna(c.id));
    return gettone;
  });
  // With no column the add button is the whole row; then it shrinks to a
  // token of its own next to the others.
  const vuoto = colonne.length === 0;
  const aggiungi = vuoto
    ? el('button', { type: 'button', id: 'btn-aggiungi-uni', class: 'aggiungi' }, 'Scegli uni da confrontare')
    : el('button', { type: 'button', id: 'btn-aggiungi-uni', class: 'gettone gettone-aggiungi', 'aria-label': 'Aggiungi colonna' },
      el('span', { class: 'gettone-cerchio', 'aria-hidden': 'true' }, '+'),
      el('span', { class: 'gettone-nota', 'aria-hidden': 'true' }, 'UNI'));
  aggiungi.addEventListener('click', apriNuovaColonna);
  elGettoni.replaceChildren(...gettoni, aggiungi);
}

/**
 * Puts the box in the pop-up back among the others, in column order. The
 * empty field of a column not yet chosen is simply discarded.
 */
function rimettiBox() {
  const box = elDlgColonnaCorpo.firstElementChild;
  if (!box) return;
  if (!box.classList.contains('colonna-scheda')) {
    box.remove();
    return;
  }
  const posto = colonne.findIndex((c) => c.id === box.dataset.id);
  const seguente = colonne.slice(posto + 1)
    .map((c) => elColonneSchede.querySelector(`[data-id="${c.id}"]`))
    .find(Boolean);
  elColonneSchede.insertBefore(box, seguente ?? null);
}

elDlgColonna.addEventListener('close', rimettiBox);
elDlgColonna.addEventListener('click', (evento) => {
  if (evento.target === elDlgColonna) elDlgColonna.close();
});
document.getElementById('fatto-colonna').addEventListener('click', () => elDlgColonna.close());
// Turning a phone sideways past the breakpoint shows the boxes again: the
// one in the pop-up goes back first.
TELEFONO.addEventListener('change', () => { if (!TELEFONO.matches && elDlgColonna.open) elDlgColonna.close(); });

// --- 3. Question-filter accordion generated from CONFIG_FILTRI ---

// Filter counters, also used by the AI layer (applicaQuery).
const conteggiPerMacro = new Map();
// voce.id -> its checkbox label, so entries unavailable under the selected
// definition can be hidden.
const ELEMENTO_VOCE = new Map();

// The main questions, selected when the page opens: the ones behind the key
// indicators (indicatori-chiave.js), matched on survey and category, so the
// editorial choice lives in one file.
const ID_PRINCIPALI = new Set();
for (const ind of [...INDICATORI_CRUSCOTTO, ...ALTRI_INDICATORI_PRINCIPALI]) {
  for (const { voce } of VOCE_PER_ID.values()) {
    if (voce.indagine === ind.indagine && voce.categoria === ind.categoria &&
        voce.indicatori.includes(ind.indicatore)) {
      ID_PRINCIPALI.add(voce.id);
    }
  }
}

/** @param {string} macro */
function aggiornaConteggio(macro) {
  const dati = conteggiPerMacro.get(macro);
  if (!dati) return;
  // The denominator includes only questions available under the selected
  // definition; "3 of 22" would be misleading if two are hidden.
  const disponibili = dati.voci.filter(voceDisponibile);
  const tot = disponibili.filter((v) => document.getElementById(`chk-${v.id}`)?.checked).length;
  dati.spanConteggio.textContent = `${tot} di ${disponibili.length} selezionate`;
  aggiornaContaDomande();
}

/** Writes how many questions the table will show, across all groups. */
function aggiornaContaDomande() {
  const n = vociSelezionate().reduce((somma, { voci }) => somma + voci.length, 0);
  elContaDomande.textContent = n === 1 ? '1 domanda scelta' : `${n} domande scelte`;
}

/**
 * Selects the questions that satisfy a rule and deselects the others.
 *
 * @param {(voce: object) => boolean} regola - Whether a question is selected.
 */
function impostaSelezione(regola) {
  for (const { voce } of VOCE_PER_ID.values()) {
    const chk = document.getElementById(`chk-${voce.id}`);
    if (chk) chk.checked = regola(voce);
  }
  aggiornaTuttiIConteggi();
  renderTabella();
}

document.getElementById('btn-principali')
  .addEventListener('click', () => impostaSelezione((v) => ID_PRINCIPALI.has(v.id)));
document.getElementById('btn-tutte')
  .addEventListener('click', () => impostaSelezione(() => true));

// Build each checkbox once and toggle visibility so changing the definition
// does not clear the user's selections elsewhere on the page.
/** Updates question visibility for the selected occupation definition. */
function aggiornaVisibilitaVoci() {
  for (const [id, elemento] of ELEMENTO_VOCE) {
    const trovata = VOCE_PER_ID.get(id);
    if (trovata) elemento.hidden = !voceDisponibile(trovata.voce);
  }
  for (const dati of conteggiPerMacro.values()) {
    // A macro-category with no questions under the definition should not remain
    // open and empty.
    dati.details.hidden = !dati.voci.some(voceDisponibile);
  }
  aggiornaTuttiIConteggi();
}
/** Refreshes all macro-category question counters. */
function aggiornaTuttiIConteggi() {
  for (const macro of conteggiPerMacro.keys()) aggiornaConteggio(macro);
}

/**
 * Renders the question-filter accordion.
 *
 * Every question is a checkbox drawn as a pill. Only the main questions
 * (ID_PRINCIPALI) start selected; a group that holds some opens with them in
 * view and the others one click away, a group that holds none starts closed
 * and shows all of its questions when opened.
 */
function renderFiltri() {
  elAccordionFiltri.innerHTML = '';
  conteggiPerMacro.clear();
  ELEMENTO_VOCE.clear();

  for (const macro of ORDINE_MACRO) {
    const voci = CONFIG_FILTRI[macro];
    const principali = voci.filter((v) => ID_PRINCIPALI.has(v.id)).length;

    const details = document.createElement('details');
    details.open = principali > 0;
    if (principali === 0) details.classList.add('tutte');

    const summary = document.createElement('summary');
    const spanTitolo = document.createElement('span');
    spanTitolo.textContent = macro;
    const spanConteggio = document.createElement('span');
    spanConteggio.className = 'conteggio';
    summary.append(spanTitolo, spanConteggio);
    details.appendChild(summary);

    const lista = document.createElement('div');
    lista.className = 'lista-checkbox';

    conteggiPerMacro.set(macro, { spanConteggio, voci, details });

    for (const voce of voci) {
      const principale = ID_PRINCIPALI.has(voce.id);
      const label = document.createElement('label');
      label.className = principale ? 'voce-checkbox' : 'voce-checkbox secondaria';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `chk-${voce.id}`;
      input.checked = principale;
      input.addEventListener('change', () => {
        aggiornaConteggio(macro);
        renderTabella();
      });

      const testo = document.createElement('span');
      testo.textContent = voce.label;

      label.append(input, testo);
      lista.appendChild(label);
      ELEMENTO_VOCE.set(voce.id, label);
    }

    if (principali > 0 && principali < voci.length) {
      const mostra = el('button', { type: 'button', class: 'mostra-tutte', 'aria-expanded': 'false' },
        'Mostra tutte');
      mostra.addEventListener('click', () => {
        const aperto = details.classList.toggle('tutte');
        mostra.textContent = aperto ? 'Mostra solo le scelte' : 'Mostra tutte';
        mostra.setAttribute('aria-expanded', String(aperto));
      });
      lista.appendChild(mostra);
    }

    details.appendChild(lista);
    elAccordionFiltri.appendChild(details);
    aggiornaConteggio(macro);
  }
}

// --- `occupazione` employment outcomes survey definition selector ---

// Derive the macro-category containing the `occupazione` employment outcomes survey from the data,
// so a future generator rename does not make this text inaccurate.
const MACRO_OCCUPAZIONE = ORDINE_MACRO.find((m) =>
  CONFIG_FILTRI[m].some((v) => v.indagine === 'occupazione')
);

/** Updates the explanation and available-question count for the definition. */
function aggiornaNotaDefinizione() {
  if (!elNotaDefinizione || !MACRO_OCCUPAZIONE) return;
  // The denominator leaves out course-only questions while no course column
  // exists: they do not depend on the definition, and counting them would
  // report as hidden by the definition questions it does not hide.
  const voci = CONFIG_FILTRI[MACRO_OCCUPAZIONE].filter(voceNelConfronto);
  const disponibili = voci.filter(voceDisponibile).length;
  const spiegazione = TESTO_DEFINIZIONE[definizioneScelta] ?? '';
  elNotaDefinizione.textContent =
    `${spiegazione} Con questa scelta sono consultabili ${disponibili} delle ` +
    `${voci.length} domande di «${MACRO_OCCUPAZIONE}»; le altre categorie non cambiano.`;
}

/** Renders the employment outcomes survey definition selector when multiple definitions exist. */
function renderSelettoreDefinizione() {
  // With fewer than two definitions, the selector has no purpose and remains
  // hidden; this occurs when the dataset contains only the graduate profile survey.
  if (!elRiquadroDefinizione || definizioniDisponibili.length < 2) return;

  elSelDefinizione.innerHTML = definizioniDisponibili
    .map((d) => `<option value="${d}">${d}</option>`)
    .join('');
  elSelDefinizione.value = definizioneScelta;
  elRiquadroDefinizione.classList.remove('nascosto');
  potenziaSelect(elSelDefinizione, { etichetta: 'Definizione di «occupato»', classe: 'compatto' });

  elSelDefinizione.addEventListener('change', () => {
    definizioneScelta = elSelDefinizione.value;
    aggiornaNotaDefinizione();
    aggiornaVisibilitaVoci();
    renderTabella();
  });

  aggiornaNotaDefinizione();
}

/** @returns {{macro:string, voci:object[]}[]} Selected questions by category. */
function vociSelezionate() {
  // Preserve CONFIG_FILTRI order rather than relying on arbitrary iteration order.
  const risultato = [];
  for (const macro of ORDINE_MACRO) {
    const voci = CONFIG_FILTRI[macro].filter(
      (v) => voceDisponibile(v) && document.getElementById(`chk-${v.id}`)?.checked
    );
    if (voci.length > 0) risultato.push({ macro, voci });
  }
  return risultato;
}

// --- 4. Querying a sheet (university or group) ---

const SEPARATORE_CHIAVE = '\u0001';

// Include the survey in the key: the graduate profile survey and employment
// outcomes survey contain similar
// (category, indicator) pairs, and this extra string prevents silent collisions.
/**
 * Builds a stable key for a data row.
 *
 * @param {string} indagine - Survey identifier.
 * @param {string} categoria - Category label.
 * @param {string} indicatore - Indicator label.
 * @returns {string} Stable row key.
 */
function chiave(indagine, categoria, indicatore) {
  return `${indagine}${SEPARATORE_CHIAVE}${categoria}${SEPARATORE_CHIAVE}${indicatore}`;
}

/**
 * Converts the rows of one sheet into cell values and sample sizes.
 *
 * Aggregate and course sheets share this conversion, so keys, sample sizes
 * and the small-sample marker behave identically at both levels.
 *
 * @param {object[]} righe - Rows read from a sheet.
 * @returns {{mappa:Map,numerosita:Map}} Sheet data and sample sizes.
 */
function costruisciScheda(righe) {
  const mappa = new Map();
  // Keep sample sizes per survey because reading them from an arbitrary row
  // of an unordered query would make them depend on insertion order.
  const numerosita = new Map();

  for (const riga of righe) {
    mappa.set(chiave(riga.indagine, riga.categoria, riga.indicatore), {
      valore: riga.valore,
      nota: riga.nota,
      valore_raw: riga.valore_raw,
    });
    if (!numerosita.has(riga.indagine)) {
      numerosita.set(riga.indagine, {
        laureati: riga.numero_laureati,
        compilatori: riga.numero_compilatori,
      });
    }
  }
  return { mappa, numerosita };
}

/**
 * Queries the data for one sheet.
 *
 * A course column whose university is still downloading returns no data and
 * `inCaricamento: true`; the column is drawn again when the download ends.
 *
 * @param {{tipo:string,codice:string,ateneo?:string}} colonna - Sheet selection.
 * @returns {{mappa:Map,numerosita:Map,inCaricamento?:boolean}} Sheet data and sample sizes.
 */
function interrogaScheda(colonna) {
  if (colonna.tipo === 'corso') {
    const dbAteneo = ateneoCaricato(colonna.ateneo);
    if (!dbAteneo) return { ...costruisciScheda([]), inCaricamento: true };
    return costruisciScheda(interrogaCorso(dbAteneo, colonna.codice, definizioneScelta));
  }

  const colonnaFiltro = colonna.tipo === 'ateneo' ? 'ateneo' : 'gruppo';
  const altraColonna = colonna.tipo === 'ateneo' ? 'gruppo' : 'ateneo';

  // The definition filter is not merely presentational. Without it, both
  // 'occupazione' versions return the same (category, indicator) pair for
  // 69 collisions, and the later row silently overwrites the first even when
  // employment rates differ by six points. '' and 'condivisa' always pass:
  // they are definition-independent rows (the graduate profile survey and blocks not
  // duplicated on the AlmaLaurea page, respectively).
  const stmt = db.prepare(
    `SELECT indagine, categoria, indicatore, valore, nota, valore_raw,
            numero_laureati, numero_compilatori
     FROM dati
     WHERE ${colonnaFiltro} = :codice AND ${altraColonna} = ''
       AND definizione IN ('', 'condivisa', :definizione)`
  );
  stmt.bind({ ':codice': colonna.codice, ':definizione': definizioneScelta });
  const righe = [];
  while (stmt.step()) righe.push(stmt.getAsObject());
  stmt.free();

  return costruisciScheda(righe);
}

// --- 5. Rendering the comparison table ---

/**
 * Formats a count with Italian digit grouping.
 *
 * @param {number|null|undefined} n - Count to format.
 * @returns {string} Formatted count, or an em dash when the count is missing.
 */
// Grouping is forced: Italian locale data leaves four-digit numbers ungrouped
// by default, which would print 6086 next to 21.984.
const formattaNumero = (n) => (n != null ? n.toLocaleString('it-IT', { useGrouping: 'always' }) : '—');

// AlmaLaurea's own terms for respondents in each survey: graduate profile
// survey respondents complete a questionnaire, while employment outcomes
// survey respondents are interviewed by telephone. The labels quote
// AlmaLaurea's wording.
const NOME_RISPONDENTI = {
  profilo: 'compilatori del questionario',
  occupazione: 'intervistati',
};

/**
 * Returns the sample on which one table cell is based.
 *
 * The sample is the respondent count of the survey that the row belongs to,
 * not of the column as a whole, because the two surveys cover different
 * populations. Respondents are the true denominator of a percentage; when
 * that count is missing, the graduate count is used as the best available
 * upper bound and the tooltip names it as such.
 *
 * @param {Map} numerosita - Sample sizes by survey.
 * @param {string} indagine - Survey of the row.
 * @returns {{indagine: string, numero: number, nome: string, laureati: (number|null)}|null}
 *   Sample description, or null when no count is available.
 */
function campioneDellaRiga(numerosita, indagine) {
  const n = numerosita.get(indagine);
  if (!n) return null;
  if (n.compilatori != null) {
    return {
      indagine,
      numero: n.compilatori,
      nome: NOME_RISPONDENTI[indagine] ?? 'rispondenti',
      laureati: n.laureati,
    };
  }
  if (n.laureati != null) {
    return { indagine, numero: n.laureati, nome: 'laureati', laureati: null };
  }
  return null;
}

/**
 * Returns whether a sample is below the small-sample threshold.
 *
 * @param {object|null} campione - Sample returned by campioneDellaRiga().
 * @returns {boolean} True when the sample is known and below SOGLIA_CAMPIONE_PICCOLO.
 */
function campionePiccolo(campione) {
  return campione != null && campione.numero < SOGLIA_CAMPIONE_PICCOLO;
}

/**
 * Builds the tooltip line that states the sample behind a value.
 *
 * Below the threshold the text also explains why the sample size matters.
 *
 * @param {object} campione - Sample returned by campioneDellaRiga().
 * @returns {string} Tooltip text.
 */
function testoCampione(campione) {
  const base = `${formattaNumero(campione.numero)} ${campione.nome}`;
  const suLaureati =
    campione.laureati != null ? ` su ${formattaNumero(campione.laureati)} laureati` : '';
  if (campionePiccolo(campione)) {
    return (
      `Campione piccolo: ${base}${suLaureati} (indagine ${campione.indagine}), ` +
      `sotto la soglia di ${SOGLIA_CAMPIONE_PICCOLO}. Su cos\u00ec pochi rispondenti ` +
      'una percentuale \u00e8 instabile: leggi il valore con prudenza e non fidarti ' +
      'delle differenze piccole fra colonne.'
    );
  }
  return `Campione: ${base}${suLaureati} (indagine ${campione.indagine}).`;
}

// Show one sample-size row for each survey present in the table. One number is
// insufficient because the surveys cover different populations; assigning the
// employment sample size to the profile (or vice versa) would mislabel the data.
/**
 * Formats a comparison-column header.
 *
 * @param {object} colonna - Sheet selection.
 * @param {Map} numerosita - Sample sizes by survey.
 * @param {string[]} indaginiMostrate - Surveys displayed in the table.
 * @param {boolean} inCaricamento - Whether a course column is still downloading.
 * @param {number} indice - Position of the column, from 0.
 * @returns {HTMLElement} Column header.
 */
function formattaIntestazioneColonna(colonna, numerosita, indaginiMostrate, inCaricamento, indice) {
  const contenitore = document.createElement('div');
  const riga1 = document.createElement('div');
  riga1.append(creaSegno(indice), etichettaColonna(colonna));
  contenitore.appendChild(riga1);

  // A course name alone does not say where the course is taught.
  const sottotitolo =
    colonna.tipo === 'corso'
      ? colonna.errore ?? (inCaricamento
        ? `${etichettaCodice('ateneo', colonna.ateneo)} · caricamento dei corsi…`
        : etichettaCodice('ateneo', colonna.ateneo))
      : null;
  if (sottotitolo) {
    const riga = document.createElement('small');
    riga.className = 'sottotitolo-colonna';
    riga.textContent = sottotitolo;
    contenitore.appendChild(riga);
  }

  for (const indagine of indaginiMostrate) {
    const n = numerosita.get(indagine);
    if (!n || n.laureati == null) continue;
    const riga = document.createElement('small');
    riga.textContent =
      indagine === 'occupazione'
        ? `${formattaNumero(n.laureati)} laureati · ${formattaNumero(n.compilatori)} intervistati`
        : `${formattaNumero(n.laureati)} laureati`;
    contenitore.appendChild(riga);
  }
  return contenitore;
}

/**
 * Creates a text table cell.
 *
 * @param {string} testo - Cell text.
 * @param {string|undefined} classe - Optional CSS class.
 * @returns {HTMLElement} Table cell.
 */
function creaCellaTesto(testo, classe) {
  const td = document.createElement('td');
  if (classe) td.className = classe;
  td.textContent = testo;
  return td;
}

/**
 * Creates a table cell for a data value.
 *
 * The sample size appears in the cell tooltip as well as in the column header,
 * so a reader can see the sample behind a value without tracing its survey.
 * Writing it as visible text would double the numbers in the table, so the
 * visual marker is reserved for cells below the threshold.
 *
 * @param {object|undefined} infoValore - Value information.
 * @param {object|null} campione - Sample returned by campioneDellaRiga().
 * @returns {HTMLElement} Value cell.
 */
function creaCellaValore(infoValore, campione) {
  const td = document.createElement('td');
  if (!infoValore) {
    td.textContent = '—';
    td.title = 'Nessun dato per questa combinazione';
    return td;
  }
  const testo = processData(infoValore);
  td.textContent = testo;
  td.className = infoValore.valore !== null && infoValore.valore !== undefined
    ? 'cella-valore'
    : 'cella-nota';
  // The small-sample mark qualifies a number: a note in its place gets none.
  if (td.className === 'cella-valore' && campionePiccolo(campione)) {
    td.classList.add('cella-campione-piccolo');
  }

  const righe = [];
  if (campione) righe.push(testoCampione(campione));
  righe.push(`Valore originale AlmaLaurea: ${infoValore.valore_raw}`);
  td.title = righe.join('\n');
  return td;
}

/**
 * Creates the cell of a course-only question in a university or group column.
 *
 * A dash would read as missing data; the question simply does not exist for
 * a mixed-degree aggregate, and the tooltip says why.
 *
 * @returns {HTMLElement} Explanatory cell.
 */
const TESTO_SOLO_CORSO = 'solo per i corsi';

function creaCellaSoloCorso() {
  const td = creaCellaTesto(TESTO_SOLO_CORSO, 'cella-solo-corso');
  td.title =
    'Domanda posta solo ai laureati di primo livello: AlmaLaurea la pubblica per ' +
    'il singolo corso, non per atenei e gruppi, che mettono insieme tutti i tipi di laurea.';
  return td;
}

/**
 * Shows or hides the small-sample legend below the table.
 *
 * The legend appears only when at least one cell carries the marker, so the
 * table gains no explanatory line for a case that does not occur. The text
 * reads the threshold from the constant so that it cannot drift out of sync.
 *
 * @param {number} quante - Number of cells below the threshold.
 */
function aggiornaLegendaCampione(quante) {
  if (!elLegendaCampione) return;
  elLegendaCampione.classList.toggle('nascosto', quante === 0);
  if (quante === 0) return;
  elLegendaCampione.textContent =
    `* Valore basato su meno di ${SOGLIA_CAMPIONE_PICCOLO} rispondenti: ` +
    'campione piccolo, differenze piccole fra colonne non sono significative. ' +
    'Passa il mouse su una cella per la numerosit\u00e0 esatta.';
}

/**
 * Marks in bold the highest value of a table row.
 *
 * Only numeric values compete, and only when at least two columns have one
 * and they are not all equal: a lone value or a tie has no "highest". The
 * note under the table says that highest does not mean best.
 *
 * @param {{td: HTMLElement, valore: (number|null|undefined)}[]} celle - Cells of one row.
 */
function segnaMassimo(celle) {
  const numeriche = celle.filter((c) => typeof c.valore === 'number');
  if (numeriche.length < 2) return;
  const massimo = Math.max(...numeriche.map((c) => c.valore));
  if (numeriche.every((c) => c.valore === massimo)) return;
  for (const c of numeriche) if (c.valore === massimo) c.td.classList.add('alto');
}

/** Name of the survey's respondents, as a warning sentence uses it. */
const AMBITO_INDAGINE = { profilo: 'sul questionario', occupazione: 'sul lavoro' };

/**
 * Writes the warnings about the comparison as a whole, or hides the box.
 *
 * Two cases: course columns (first-level graduates only) next to university
 * or group columns (all degree types together), and columns whose sample in
 * one survey is below SOGLIA_CAMPIONE_PICCOLO. Names are inserted as text,
 * never as HTML: course names come from an external source.
 *
 * @param {object[]} datiPerColonna - Data of each comparison column.
 */
function aggiornaAvvisi(datiPerColonna) {
  const avvisi = [];
  const corsi = datiPerColonna.filter((d) => d.colonna.tipo === 'corso');
  if (corsi.length > 0 && corsi.length < datiPerColonna.length) {
    avvisi.push([
      el('strong', {}, 'Colonne di tipo diverso.'),
      ' I corsi contano solo laureati di primo livello; atenei e gruppi mettono ' +
      'insieme triennali, magistrali e ciclo unico. Sul lavoro non sono gruppi ' +
      'uguali: molti triennalisti stanno ancora studiando.',
    ]);
  }
  for (const { colonna, numerosita, inCaricamento } of datiPerColonna) {
    if (inCaricamento || colonna.errore) continue;
    for (const indagine of ['profilo', 'occupazione']) {
      const campione = campioneDellaRiga(numerosita, indagine);
      if (!campionePiccolo(campione)) continue;
      avvisi.push([
        el('strong', {}, `Campione piccolo per ${etichettaColonna(colonna)} ${AMBITO_INDAGINE[indagine]}.`),
        ` ${formattaNumero(campione.numero)} ${campione.nome}, sotto la soglia di ` +
        `${SOGLIA_CAMPIONE_PICCOLO}: questi numeri oscillano molto da un anno all'altro.`,
      ]);
    }
  }
  elAvvisi.classList.toggle('nascosto', avvisi.length === 0);
  elAvvisiTitolo.textContent = avvisi.length === 1
    ? '1 avviso su questo confronto'
    : `${avvisi.length} avvisi su questo confronto`;
  elAvvisiLista.replaceChildren(...avvisi.map((parti) => el('li', {}, ...parti)));
}

// The full table stays hidden until the first press of "Confronta"; from then
// on it follows every change by itself, so it can never show numbers that no
// longer match the menus.
let risultatoMostrato = false;

/**
 * Shows the full table, the first time replacing the button with a note.
 *
 * @param {boolean} scorri - Scroll the table into view.
 */
function mostraRisultato(scorri) {
  if (!risultatoMostrato) {
    risultatoMostrato = true;
    elRisultato.classList.remove('nascosto');
    elAzioneConfronta.replaceChildren(
      el('p', { class: 'dal-vivo' }, 'Da qui in poi il confronto si aggiorna da solo a ogni modifica.')
    );
  }
  if (scorri) elRisultato.scrollIntoView({ block: 'start' });
}

document.getElementById('btn-confronta').addEventListener('click', () => mostraRisultato(true));

/** Renders the comparison table from the current selections and database. */
function renderTabella() {
  elTabellaHead.innerHTML = '';
  elTabellaBody.innerHTML = '';
  // Recount on every render: the columns and questions, and therefore the
  // cells below the threshold, can change.
  let sottoSoglia = 0;
  aggiornaLegendaCampione(0);
  tabellaMostrata = null;

  // Course-only questions follow the columns: adding or removing a course
  // column shows or hides them in the filters too, with their counters.
  aggiornaVisibilitaVoci();
  aggiornaNotaDefinizione();

  // Release course databases no column shows any more. Universities in use
  // are never closed, so this is safe before the queries below.
  liberaAteneiNonUsati(colonne.filter((c) => c.tipo === 'corso').map((c) => c.ateneo));
  // Every change of columns ends up here, so the address follows them.
  scriviIndirizzo();

  // The selector boxes follow the column order, which removals change.
  colonne.forEach((c, i) => {
    // Searched in the whole page: on a phone one box may be in its pop-up.
    const box = document.querySelector(`.colonna-scheda[data-id="${c.id}"]`);
    box?.querySelector('.posto-segno').replaceChildren(creaSegno(i));
    if (box) {
      box.querySelector('.numero-colonna').textContent = `Colonna ${i + 1}`;
      // The heading takes the column's tone (style.css, data-posto).
      box.dataset.posto = String(i % FORME_SEGNO.length);
    }
    AGGIORNA_CAMPI_COLONNA.get(c.id)?.();
  });
  renderGettoni();

  if (colonne.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = 'Aggiungi almeno una colonna per vedere il confronto.';
    tr.appendChild(td);
    elTabellaBody.appendChild(tr);
    renderSintesi([]);
    renderVoti([]);
    aggiornaAvvisi([]);
    return;
  }

  // Query each column once rather than issuing one query per question. The
  // summary reads the same data, so it can never disagree with the table.
  const datiPerColonna = colonne.map((colonna, indice) => ({
    colonna,
    indice,
    ...interrogaScheda(colonna),
  }));
  renderSintesi(datiPerColonna);
  renderVoti(datiPerColonna);
  aggiornaAvvisi(datiPerColonna);

  // Determine selected questions before rendering the header to identify which
  // surveys will appear and which sample sizes belong below each column name.
  const gruppi = vociSelezionate();
  const indaginiMostrate = [];
  for (const { voci } of gruppi) {
    for (const voce of voci) {
      if (!indaginiMostrate.includes(voce.indagine)) indaginiMostrate.push(voce.indagine);
    }
  }

  // --- Header ---
  const trHead = document.createElement('tr');
  const thDomanda = document.createElement('th');
  thDomanda.className = 'colonna-domanda';
  thDomanda.textContent = 'Domanda';
  trHead.appendChild(thDomanda);
  for (const { colonna, indice, numerosita, inCaricamento } of datiPerColonna) {
    const th = document.createElement('th');
    th.appendChild(
      formattaIntestazioneColonna(colonna, numerosita, indaginiMostrate, inCaricamento, indice)
    );
    trHead.appendChild(th);
  }
  elTabellaHead.appendChild(trHead);
  const modello = {
    colonne: datiPerColonna.map(({ colonna, numerosita }) => ({ colonna, numerosita })),
    righe: [],
  };

  // --- Body grouped by macro-category ---

  if (gruppi.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = 'Nessuna domanda selezionata: spunta almeno una voce nei filtri qui sopra.';
    tr.appendChild(td);
    elTabellaBody.appendChild(tr);
    return;
  }

  // The download writes the table exactly as shown, from this model.
  tabellaMostrata = modello;
  for (const { macro, voci } of gruppi) {
    const trMacro = document.createElement('tr');
    trMacro.className = 'riga-macro-categoria';
    const tdMacro = document.createElement('td');
    tdMacro.colSpan = 1 + datiPerColonna.length;
    tdMacro.textContent = macro;
    trMacro.appendChild(tdMacro);
    elTabellaBody.appendChild(trMacro);

    for (const voce of voci) {
      if (voce.indicatori.length === 1) {
        // Standalone indicator: one row with its direct value.
        const tr = document.createElement('tr');
        tr.className = 'riga-domanda-intestazione';
        tr.appendChild(creaCellaTesto(voce.label, 'colonna-domanda'));
        const k = chiave(voce.indagine, voce.categoria, voce.indicatori[0]);
        const celle = [];
        const celleModello = [];
        for (const { colonna, mappa, numerosita } of datiPerColonna) {
          if (voce.soloCorso && colonna.tipo !== 'corso') {
            tr.appendChild(creaCellaSoloCorso());
            celleModello.push({ valore: null, testo: TESTO_SOLO_CORSO, piccolo: false });
            continue;
          }
          const campione = campioneDellaRiga(numerosita, voce.indagine);
          const info = mappa.get(k);
          const cella = creaCellaValore(info, campione);
          if (cella.classList.contains('cella-campione-piccolo')) sottoSoglia++;
          celle.push({ td: cella, valore: info?.valore });
          celleModello.push({
            valore: info?.valore ?? null,
            testo: cella.textContent,
            piccolo: cella.classList.contains('cella-campione-piccolo'),
          });
          tr.appendChild(cella);
        }
        segnaMassimo(celle);
        elTabellaBody.appendChild(tr);
        modello.righe.push({ macro, domanda: voce.label, opzione: '', celle: celleModello });
      } else {
        // Multi-option question: a title row without values followed by one
        // sub-row per indicator, using the same sheet columns.
        const trTitolo = document.createElement('tr');
        trTitolo.className = 'riga-domanda-intestazione';
        trTitolo.appendChild(creaCellaTesto(voce.label, 'colonna-domanda'));
        for (let i = 0; i < datiPerColonna.length; i++) {
          trTitolo.appendChild(creaCellaTesto(''));
        }
        elTabellaBody.appendChild(trTitolo);

        for (const indicatore of voce.indicatori) {
          const tr = document.createElement('tr');
          tr.className = 'riga-indicatore';
          tr.appendChild(creaCellaTesto(indicatore, 'colonna-domanda'));
          const k = chiave(voce.indagine, voce.categoria, indicatore);
          const celle = [];
          const celleModello = [];
          for (const { colonna, mappa, numerosita } of datiPerColonna) {
            if (voce.soloCorso && colonna.tipo !== 'corso') {
              tr.appendChild(creaCellaSoloCorso());
              celleModello.push({ valore: null, testo: TESTO_SOLO_CORSO, piccolo: false });
              continue;
            }
            const campione = campioneDellaRiga(numerosita, voce.indagine);
            const info = mappa.get(k);
            const cella = creaCellaValore(info, campione);
            if (cella.classList.contains('cella-campione-piccolo')) sottoSoglia++;
            celle.push({ td: cella, valore: info?.valore });
            celleModello.push({
              valore: info?.valore ?? null,
              testo: cella.textContent,
              piccolo: cella.classList.contains('cella-campione-piccolo'),
            });
            tr.appendChild(cella);
          }
          segnaMassimo(celle);
          elTabellaBody.appendChild(tr);
          modello.righe.push({ macro, domanda: voce.label, opzione: indicatore, celle: celleModello });
        }
      }
    }
  }

  aggiornaLegendaCampione(sottoSoglia);
}

// --- 5b. The ruler: summary ("In sintesi") rows ---
// One visual language for key numbers: a row per indicator with the question,
// a line on a fixed scale carrying one marker per column, and the values.
// The summary draws it for the columns of the comparison.

/**
 * Returns the text of one key value.
 *
 * @param {object|undefined} info - Value information from a sheet map.
 * @param {string} unita - Unit of the indicator.
 * @returns {string} Formatted value, the source's note, or a dash when the row is missing.
 */
function testoValoreChiave(info, unita) {
  if (!info) return '—';
  if (info.valore === null || info.valore === undefined) return processData(info);
  return formattaConUnita(info.valore, unita);
}

/**
 * @typedef {object} EntitaRighello
 * @property {string} chiave - Stable identifier, written in data-entita.
 * @property {number} indice - Marker position (shape and tone).
 * @property {string} nome - Full name, for tooltips.
 * @property {string} breve - Short name, above the values or beside them on a phone.
 * @property {{mappa:Map, numerosita:Map}|null} dati - Sheet data, or null when absent.
 * @property {string|null} [assente] - Text shown instead of a value (loading, error).
 */

/**
 * Creates one row of the ruler: an indicator for every entity.
 *
 * @param {object} ind - Indicator from indicatori-chiave.js.
 * @param {EntitaRighello[]} entita - Entities, in marker order.
 * @returns {{riga: HTMLElement, piccoli: boolean[]}} Row, and per entity whether its value rests on a small sample.
 */
function creaRigaRighello(ind, entita) {
  const k = chiave(ind.indagine, ind.categoria, ind.indicatore);
  const letture = entita.map((e) => {
    const info = e.assente ? undefined : e.dati?.mappa.get(k);
    const campione = !e.assente && e.dati ? campioneDellaRiga(e.dati.numerosita, ind.indagine) : null;
    return {
      e,
      info,
      campione,
      haValore: info?.valore !== null && info?.valore !== undefined,
    };
  });
  // The small-sample mark qualifies a number: a note in its place gets none.
  for (const l of letture) l.piccolo = l.haValore && campionePiccolo(l.campione);
  const scala = scalaPer(ind.unita, letture.filter((l) => l.haValore).map((l) => l.info.valore));
  const [estremoMin, estremoMax] = etichetteScala(scala, ind.unita);

  // Drawn back to front, so the first entity's marker always sits on top.
  const segni = [...letture].reverse().filter((l) => l.haValore).map((l) => {
    const segno = creaSegno(l.e.indice, l.piccolo,
      `${l.e.nome}: ${formattaConUnita(l.info.valore, ind.unita)}`);
    segno.style.left = `${posizioneSu(l.info.valore, scala)}%`;
    return segno;
  });

  const valori = letture.map((l) =>
    el('span', {
      class: `paragone-valore${l.haValore ? '' : ' paragone-nota'}` +
        `${l.piccolo ? ' valore-campione-piccolo' : ''}`,
      'data-entita': l.e.chiave,
      title: l.campione ? testoCampione(l.campione) : null,
    },
      creaSegno(l.e.indice, l.piccolo),
      el('span', { class: 'paragone-valore-nome' }, l.e.breve),
      el('span', { class: 'paragone-numero' }, l.e.assente ?? testoValoreChiave(l.info, ind.unita))
    )
  );

  const riga = el('div', { class: 'paragone-riga', 'data-indicatore': ind.id },
    el('div', { class: 'paragone-etichetta' },
      el('span', { class: 'paragone-titolo' }, ind.titolo),
      el('span', { class: 'paragone-domanda' }, etichettaUfficiale(ind))
    ),
    el('div', { class: 'paragone-traccia', 'aria-hidden': 'true' },
      el('div', { class: 'traccia' }, ...segni),
      el('div', { class: 'traccia-estremi' }, el('span', {}, estremoMin), el('span', {}, estremoMax))
    ),
    el('div', { class: 'paragone-valori' }, ...valori)
  );
  return { riga, piccoli: letture.map((l) => l.piccolo) };
}

/**
 * Fills a ruler container: a header with the entity names, then one row per
 * indicator. On a phone the header is hidden and every value carries its name.
 *
 * @param {HTMLElement} contenitore - Element with class "righe".
 * @param {object[]} indicatori - Indicators from indicatori-chiave.js.
 * @param {EntitaRighello[]} entita - Entities, in marker order.
 * @returns {boolean[][]} For every row, per entity, whether its value rests on a small sample.
 */
function disegnaRighello(contenitore, indicatori, entita) {
  contenitore.style.setProperty('--n-valori', String(entita.length));
  const intestazione = el('div', { class: 'paragone-riga paragone-intestazione', 'aria-hidden': 'true' },
    el('span', {}), el('span', {}),
    el('div', { class: 'paragone-valori' }, ...entita.map((e) =>
      el('span', { class: 'intestazione-valore', title: e.nome }, creaSegno(e.indice), el('span', {}, e.breve))))
  );
  const piccoli = [];
  const righe = indicatori.map((ind) => {
    const { riga, piccoli: p } = creaRigaRighello(ind, entita);
    piccoli.push(p);
    return riga;
  });
  contenitore.replaceChildren(intestazione, ...righe);
  return piccoli;
}

/**
 * Writes the note under the summary: the small-sample asterisk, when some
 * value carries it, and which definition of "employed" the work rows use.
 *
 * @param {boolean} conPiccoli - Whether some value rests on a small sample.
 */
function aggiornaNotaSintesi(conPiccoli) {
  elNotaSintesi.replaceChildren();
  if (conPiccoli) {
    elNotaSintesi.append(
      `* Meno di ${SOGLIA_CAMPIONE_PICCOLO} rispondenti: il valore oscilla molto da un anno all'altro. `
    );
  }
  if (definizioniDisponibili.length < 2) return;
  const cambia = el('button', { type: 'button', class: 'link-pulsante' }, 'si cambia qui');
  cambia.addEventListener('click', () => {
    elRiquadroDefinizione.scrollIntoView({ behavior: 'smooth', block: 'center' });
    elSelDefinizione.focus({ preventScroll: true });
  });
  elNotaSintesi.append(
    `Le domande sul lavoro usano la definizione ${definizioneScelta} di «occupato»: `,
    cambia,
    '.'
  );
}

/**
 * Renders the summary for the current columns.
 *
 * @param {object[]} datiPerColonna - Data of each comparison column, as renderTabella() reads it.
 */
function renderSintesi(datiPerColonna) {
  if (datiPerColonna.length === 0) {
    aggiornaNotaSintesi(false);
    elGrigliaSintesi.replaceChildren(
      el('p', { class: 'sintesi-vuota' }, 'Aggiungi almeno una colonna per vedere la sintesi.')
    );
    return;
  }
  const entita = datiPerColonna.map(({ colonna, indice, mappa, numerosita, inCaricamento }) => {
    const nome = etichettaColonna(colonna);
    let assente = null;
    if (colonna.tipo === 'corso' && colonna.errore) assente = 'non disponibile';
    else if (inCaricamento) assente = 'caricamento…';
    return {
      chiave: colonna.id,
      indice,
      nome: colonna.tipo === 'corso' ? `${nome}, ${etichettaCodice('ateneo', colonna.ateneo)}` : nome,
      breve: nome,
      dati: { mappa, numerosita },
      assente,
    };
  });
  const piccoli = disegnaRighello(elGrigliaSintesi, INDICATORI_CRUSCOTTO, entita);
  aggiornaNotaSintesi(piccoli.some((riga) => riga.some(Boolean)));
}

// --- 5c. The Base view: a 0-10 score per key question (js/voto.js) ---
// Each column is ranked among sheets of its own kind: a university among the
// universities, a group among the groups, a first-level course among the
// first-level courses of the groups in the comparison (js/termini-paragone.js,
// since the browser holds only the universities it has downloaded).

const elGrigliaVoti = document.getElementById('griglia-voti');
const elParagoneVoti = document.getElementById('paragone-voti');
const elVotiSenza = document.getElementById('voti-senza');

// For first-level graduates the employment rate is misleading: most of them
// go on to a second-level degree and count as not working. Their work row is
// "works or still studies", the sum of the three positive answers below,
// computed exactly as tools/genera_termini_paragone.py computes the values it
// is ranked against.
const LAVORA_STUDIA = TERMINI_PARAGONE.lavoraStudia;
const RIGA_LAVORO = 'occupati';

/** How a score sentence names the sheets a column is ranked among. */
const NOME_TERMINI = {
  ateneo: { uno: 'ateneo', molti: 'atenei' },
  gruppo: { uno: 'area', molti: 'aree' },
  corso: { uno: 'corso', molti: 'corsi' },
};

// Values of the aggregate sheets, by kind, indicator and definition. They
// only change with the definition, so they are read once per definition.
const terminiAggregatiInMemoria = new Map();

/**
 * Returns the values of every university, or every group, for an indicator.
 *
 * Only sheets with at least SOGLIA_CAMPIONE_PICCOLO respondents count, as
 * for courses; the national total (no university, no group) never does.
 *
 * @param {'ateneo'|'gruppo'} tipo - Kind of sheet.
 * @param {object} ind - Indicator from indicatori-chiave.js.
 * @returns {number[]} Values.
 */
function terminiAggregati(tipo, ind) {
  const chiaveCache = `${tipo}${SEPARATORE_CHIAVE}${ind.id}${SEPARATORE_CHIAVE}${definizioneScelta}`;
  if (terminiAggregatiInMemoria.has(chiaveCache)) return terminiAggregatiInMemoria.get(chiaveCache);
  const condizione = tipo === 'ateneo' ? "ateneo != '' AND gruppo = ''" : "gruppo != '' AND ateneo = ''";
  const stmt = db.prepare(
    `SELECT valore FROM dati
     WHERE ${condizione}
       AND indagine = :indagine AND categoria = :categoria AND indicatore = :indicatore
       AND definizione IN ('', 'condivisa', :definizione)
       AND valore IS NOT NULL AND numero_compilatori >= :soglia`
  );
  const valori = [];
  try {
    stmt.bind({
      ':indagine': ind.indagine, ':categoria': ind.categoria, ':indicatore': ind.indicatore,
      ':definizione': definizioneScelta, ':soglia': SOGLIA_CAMPIONE_PICCOLO,
    });
    while (stmt.step()) valori.push(stmt.get()[0]);
  } finally {
    stmt.free();
  }
  terminiAggregatiInMemoria.set(chiaveCache, valori);
  return valori;
}

/**
 * Returns the values of the first-level courses of some groups.
 *
 * @param {string} id - Indicator id, or 'lavora-studia'.
 * @param {string} indagine - Survey of the indicator.
 * @param {string[]} gruppi - Group codes.
 * @returns {number[]} Values.
 */
function terminiCorsi(id, indagine, gruppi) {
  const perGruppo = indagine === 'profilo'
    ? TERMINI_PARAGONE.valori.profilo[id]
    : TERMINI_PARAGONE.valori.occupazione[definizioneScelta]?.[id];
  return gruppi.flatMap((g) => perGruppo?.[g] ?? []);
}

/**
 * Returns the "works or still studies" share of a course sheet.
 *
 * @param {Map} mappa - Sheet values.
 * @returns {{valore:(number|null), info:(object|undefined)}} The sum, or null
 *   when every answer is missing or a positive answer is hidden by the source;
 *   info is a row to describe a missing value with.
 */
function lavoraOStudia(mappa) {
  const righe = [];
  for (const [k, info] of mappa) {
    const [indagine, categoria, indicatore] = k.split(SEPARATORE_CHIAVE);
    if (indagine === 'occupazione' && categoria === LAVORA_STUDIA.categoria) righe.push({ indicatore, info });
  }
  if (righe.length === 0) return { valore: null, info: undefined };
  if (righe.every((r) => r.info.valore === null || r.info.valore === undefined)) {
    return { valore: null, info: righe[0].info };
  }
  let somma = 0;
  for (const { indicatore, info } of righe) {
    if (!LAVORA_STUDIA.voci.includes(indicatore)) continue;
    if (info.valore !== null && info.valore !== undefined) somma += info.valore;
    else if (info.nota !== 'zero_casi') return { valore: null, info };
  }
  return { valore: Math.round(somma * 10) / 10, info: undefined };
}

// Discipline group of each course, read once from its university database.
const gruppoDelCorso = new Map();

/**
 * Returns the discipline group of a course column, or null while its
 * university is not loaded.
 *
 * @param {object} colonna - Course column.
 * @returns {string|null} Group code.
 */
function gruppoColonnaCorso(colonna) {
  const k = `${colonna.ateneo}/${colonna.codice}`;
  if (!gruppoDelCorso.has(k)) {
    const dbAteneo = ateneoCaricato(colonna.ateneo);
    if (!dbAteneo) return null;
    gruppoDelCorso.set(k, descriviCorso(dbAteneo, colonna.codice)?.gruppo ?? null);
  }
  return gruppoDelCorso.get(k);
}

/**
 * Creates the ten marks under a score.
 *
 * @param {number} voto - Score from 0 to 10.
 * @returns {HTMLElement} Marks, hidden from assistive technology.
 */
function creaTacche(voto) {
  return el('span', { class: 'tacche', 'aria-hidden': 'true' },
    ...Array.from({ length: 10 }, (_, i) => el('i', { class: i < voto ? 'piena' : null })));
}

/**
 * Formats the spread of a flat set of values in plain words.
 *
 * @param {object} esito - 'tutti-uguali' result of calcolaVoto().
 * @param {number} valore - Value of the column.
 * @param {string} unita - Unit of the indicator.
 * @returns {string} Sentence.
 */
function testoTuttiUguali(esito, valore, unita) {
  if (unita === '%') {
    return `qui sono ${Math.round(valore)} su 100, e quasi tutti stanno fra ` +
      `${Math.round(esito.basso)} e ${Math.round(esito.alto)}`;
  }
  return `quasi tutti fra ${formattaConUnita(esito.basso, unita)} e ${formattaConUnita(esito.alto, unita)}`;
}

/**
 * Creates the cell of one column for one key question.
 *
 * @param {object} ind - Indicator from indicatori-chiave.js.
 * @param {object} dati - Column data, as renderTabella() reads it.
 * @param {string[]} gruppiCorsi - Groups of the course columns in the comparison.
 * @param {boolean} misto - Whether courses and aggregates are compared together.
 * @returns {HTMLElement} Cell.
 */
function creaCellaVoto(ind, dati, gruppiCorsi, misto) {
  const { colonna, indice, mappa, numerosita, inCaricamento } = dati;
  const tipo = colonna.tipo;
  const chi = el('span', { class: 'voto-chi' }, creaSegno(indice),
    el('span', { class: 'nome-colonna' }, etichettaColonna(colonna)));
  const cella = (classe, ...figli) =>
    el('div', { class: `voto ${classe}`, 'data-colonna': colonna.id }, chi, ...figli);
  // In a comparison that mixes courses and aggregates, a course's work row
  // says which question it answers, whatever the outcome below.
  const etichettaLavoro = misto && tipo === 'corso' && ind.id === RIGA_LAVORO
    ? el('small', { class: 'voto-variante' }, 'per un corso: lavorano o studiano ancora')
    : null;
  const senzaVoto = (motivo, titolo, spiegazione) =>
    cella('senza-voto', etichettaLavoro, el('div', { class: 'voto-motivo', 'data-motivo': motivo },
      el('strong', {}, titolo), spiegazione));

  if (tipo === 'corso' && colonna.errore) return senzaVoto('errore', 'Non disponibile', colonna.errore);
  if (inCaricamento) return senzaVoto('caricamento', 'Caricamento…', 'scarico i corsi dell\'ateneo');

  const lavoroDelCorso = tipo === 'corso' && ind.id === RIGA_LAVORO;
  const idTermini = lavoroDelCorso ? 'lavora-studia' : ind.id;
  let valore;
  let info;
  if (lavoroDelCorso) {
    ({ valore, info } = lavoraOStudia(mappa));
  } else {
    info = mappa.get(chiave(ind.indagine, ind.categoria, ind.indicatore));
    valore = info?.valore ?? null;
  }
  const campione = campioneDellaRiga(numerosita, ind.indagine);
  const termini = tipo === 'corso'
    ? terminiCorsi(idTermini, ind.indagine, gruppiCorsi)
    : terminiAggregati(tipo, ind);
  const esito = calcolaVoto({
    valore, rispondenti: campione?.numero, termini, unita: ind.unita, meglioBasso: ind.meglioBasso,
  });

  if (esito.voto !== undefined) {
    const nome = NOME_TERMINI[tipo];
    const conVoto = cella('con-voto',
      etichettaLavoro,
      el('span', {
        class: 'voto-cifra',
        'data-voto': String(esito.voto),
        title: `${etichettaColonna(colonna)}: ${formattaConUnita(valore, ind.unita)}, ` +
          `messo a confronto con ${formattaNumero(esito.termini)} ${nome.molti}`,
      }, String(esito.voto), el('small', {}, '/10')),
      creaTacche(esito.voto),
      el('span', { class: 'voto-frase' }, fraseVoto(esito.voto, nome))
    );
    // The traffic-light colour is computed by the stylesheet from this number.
    conVoto.style.setProperty('--voto', String(esito.voto));
    return conVoto;
  }
  switch (esito.motivo) {
    case 'pochi-dati': {
      // Too few respondents is a fact about the column, not the question, so
      // renderVoti() says it once above the grid; the cell keeps only a dash,
      // with the reason in its tooltip, and a phone hides it.
      const spiegazione = `solo ${formattaNumero(esito.rispondenti)} ${campione?.nome ?? 'rispondenti'}: non basta per un voto`;
      return cella('senza-voto voto-pochi', el('span', {
        class: 'voto-trattino', 'data-motivo': 'pochi-dati', 'data-indagine': ind.indagine,
        'data-rispondenti': String(esito.rispondenti), title: spiegazione, 'aria-label': spiegazione,
      }, '—'));
    }
    case 'pochi-termini':
      return senzaVoto('pochi-termini', 'Niente voto', 'troppo pochi termini di paragone');
    case 'tutti-uguali':
      return senzaVoto('tutti-uguali', 'Quasi tutti uguali', testoTuttiUguali(esito, valore, ind.unita));
    default:
      return senzaVoto('assente', 'Dato non pubblicato',
        info ? `AlmaLaurea: ${processData(info)}` : 'AlmaLaurea non lo pubblica');
  }
}

/**
 * Writes which sheets the scores were ranked against.
 *
 * @param {object[]} datiPerColonna - Data of each comparison column.
 * @param {string[]} gruppiCorsi - Groups of the course columns in the comparison.
 */
function aggiornaParagoneVoti(datiPerColonna, gruppiCorsi) {
  const parti = [];
  const tipi = new Set(datiPerColonna.map((d) => d.colonna.tipo));
  const corsi = datiPerColonna.filter((d) => d.colonna.tipo === 'corso').length;
  if (gruppiCorsi.length > 0) {
    const nLavoro = terminiCorsi('retribuzione', 'occupazione', gruppiCorsi).length;
    const nStudio = terminiCorsi('rifarebbero', 'profilo', gruppiCorsi).length;
    parti.push(
      `I corsi sono messi a confronto con i corsi triennali di ` +
      `${gruppiCorsi.map((g) => etichettaCodice('gruppo', g)).join(' e di ')} con almeno ` +
      `${SOGLIA_CAMPIONE_PICCOLO} risposte: ${formattaNumero(nLavoro)} sulle domande di lavoro, ` +
      `${formattaNumero(nStudio)} su quelle di studio.` +
      (corsi > 1 ? ' Lo stesso insieme per tutti i corsi, così i loro voti si possono confrontare.' : '')
    );
  }
  if (tipi.has('ateneo')) parti.push(`Gli atenei sono messi a confronto con tutti i ${codiciAteneo.length} atenei.`);
  if (tipi.has('gruppo')) parti.push(`Le aree sono messe a confronto con tutte le ${codiciGruppo.length} aree disciplinari, in tutta Italia.`);
  if (definizioniDisponibili.length >= 2) parti.push(`Lavoro con la definizione ${definizioneScelta} di «occupato».`);
  elParagoneVoti.textContent = parti.join(' ');
}

/**
 * Renders the Base view's scores for the current columns.
 *
 * @param {object[]} datiPerColonna - Data of each comparison column, as renderTabella() reads it.
 */
function renderVoti(datiPerColonna) {
  elVotiSenza.classList.add('nascosto');
  if (datiPerColonna.length === 0) {
    elParagoneVoti.textContent = '';
    elGrigliaVoti.replaceChildren(
      el('p', { class: 'sintesi-vuota' }, TELEFONO.matches
        // On a phone the page never says "colonna": the columns are tokens.
        ? 'Scegli un\'università per vedere i voti.'
        : 'Aggiungi almeno una colonna per vedere i voti.'));
    return;
  }
  const gruppiCorsi = [...new Set(datiPerColonna
    .filter((d) => d.colonna.tipo === 'corso')
    .map((d) => gruppoColonnaCorso(d.colonna))
    .filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  const tipi = new Set(datiPerColonna.map((d) => d.colonna.tipo));
  const soloCorsi = tipi.size === 1 && tipi.has('corso');
  const misto = tipi.has('corso') && tipi.size > 1;

  elGrigliaVoti.style.setProperty('--n-colonne', String(datiPerColonna.length));
  const testa = el('div', { class: 'voti-riga voti-testa', 'aria-hidden': 'true' },
    el('span', {}),
    ...datiPerColonna.map(({ colonna, indice }) =>
      el('span', { title: etichettaColonna(colonna) }, creaSegno(indice),
        el('span', { class: 'nome-colonna' }, etichettaColonna(colonna)))));
  const righe = INDICATORI_CRUSCOTTO.map((ind) => {
    const lavoroCorsi = soloCorsi && ind.id === RIGA_LAVORO;
    return el('div', { class: 'voti-riga', 'data-indicatore': ind.id },
      el('div', { class: 'voti-domanda' },
        el('strong', {}, lavoroCorsi ? 'Quanti lavorano o studiano ancora' : ind.titolo),
        el('small', {}, lavoroCorsi
          ? `${LAVORA_STUDIA.categoria} › lavorano o sono iscritti a una laurea di secondo livello`
          : etichettaUfficiale(ind))),
      ...datiPerColonna.map((dati) => creaCellaVoto(ind, dati, gruppiCorsi, misto)));
  });
  // A question where every column lacks data has nothing to show on a phone.
  for (const riga of righe) {
    if ([...riga.querySelectorAll('.voto')].every((v) => v.classList.contains('voto-pochi'))) {
      riga.classList.add('voti-riga-vuota');
    }
  }
  elGrigliaVoti.replaceChildren(testa, ...righe);
  renderSenzaVoti(datiPerColonna, righe);
  aggiornaParagoneVoti(datiPerColonna, gruppiCorsi);
}

// Which questions a survey answers, for the line of a column with too few
// respondents: "sulle domande di lavoro", and "24 sul lavoro" in a list.
const DOMANDE_INDAGINE = {
  occupazione: { tema: 'lavoro', breve: 'sul lavoro' },
  profilo: { tema: 'studio', breve: 'sullo studio' },
};

/**
 * Writes one line per column whose scores are missing for too few
 * respondents, above the grid, instead of the same reason in every row.
 *
 * Respondents are counted per survey, so a column lacks either every score of
 * a survey or none: the line names the surveys, with their respondents.
 *
 * @param {object[]} datiPerColonna - Data of each comparison column.
 * @param {HTMLElement[]} righe - Rows of the grid, one per key question.
 */
function renderSenzaVoti(datiPerColonna, righe) {
  const indagini = [...new Set(INDICATORI_CRUSCOTTO.map((ind) => ind.indagine))];
  const righeTesto = [];
  for (const { colonna, indice } of datiPerColonna) {
    const pochi = new Map();
    for (const riga of righe) {
      const segno = riga.querySelector(`.voto[data-colonna="${colonna.id}"] .voto-trattino`);
      if (segno) pochi.set(segno.dataset.indagine, Number(segno.dataset.rispondenti));
    }
    if (pochi.size === 0) continue;
    const quali = indagini.filter((i) => pochi.has(i));
    const testo = quali.length === indagini.length
      ? `niente voti, troppo poche risposte (${quali.map((i) =>
        `${formattaNumero(pochi.get(i))} ${DOMANDE_INDAGINE[i].breve}`).join(', ')}; ne servono ${SOGLIA_CAMPIONE_PICCOLO}).`
      : `niente voti sulle domande di ${quali.map((i) => DOMANDE_INDAGINE[i].tema).join(' e ')}: troppo poche risposte ` +
        `(${quali.map((i) => formattaNumero(pochi.get(i))).join(', ')}; ne servono ${SOGLIA_CAMPIONE_PICCOLO}).`;
    const nome = etichettaColonna(colonna);
    righeTesto.push(el('p', { class: 'voti-senza-riga', 'data-colonna': colonna.id },
      creaSegno(indice),
      el('span', {}, el('strong', {}, `${nome.charAt(0).toUpperCase()}${nome.slice(1)}:`), ` ${testo}`)));
  }
  elVotiSenza.replaceChildren(...righeTesto);
  elVotiSenza.classList.toggle('nascosto', righeTesto.length === 0);
}

// --- 5d. Excel download of the full table ---
// The file is the table on screen: the same columns and questions, values as
// AlmaLaurea publishes them. Numbers stay numbers, so the file can be sorted
// and charted; notes stay text. Small samples are in italics, explained on a
// second sheet together with the sample sizes behind every column.

const elBtnExcel = document.getElementById('btn-excel');

const NOME_TIPO_COLONNA = { ateneo: 'Ateneo', gruppo: 'Area disciplinare', corso: 'Corso di laurea' };

/**
 * Returns a column name for the file. Course names are lower case in the
 * source, so the first letter is capitalized here as the page does in CSS,
 * and a course carries its university, as in the table header.
 *
 * @param {object} colonna - Column of the comparison.
 * @returns {string} Column name.
 */
function nomeColonnaFile(colonna) {
  const nome = etichettaColonna(colonna);
  const maiuscolo = nome.charAt(0).toUpperCase() + nome.slice(1);
  return colonna.tipo === 'corso'
    ? `${maiuscolo} (${etichettaCodice('ateneo', colonna.ateneo)})`
    : maiuscolo;
}

/**
 * Builds the two sheets of the download from the table model.
 *
 * @param {NonNullable<typeof tabellaMostrata>} modello - Table on screen.
 * @param {Date} adesso - Download time.
 * @returns {import('./esporta-xlsx.js').FoglioXlsx[]} Sheets.
 */
function fogliExcel(modello, adesso) {
  const g = (v) => ({ v, stile: 'grassetto' });
  const confronto = [
    [g('Macro-categoria'), g('Domanda'), g('Opzione'), ...modello.colonne.map((c) => g(nomeColonnaFile(c.colonna)))],
    ...modello.righe.map((r) => [r.macro, r.domanda, r.opzione, ...r.celle.map((c) => {
      if (c.valore === null) return { v: c.testo, stile: 'corsivo' };
      return c.piccolo ? { v: c.valore, stile: 'corsivo' } : c.valore;
    })]),
  ];
  const n = (numerosita, indagine, campo) => numerosita.get(indagine)?.[campo] ?? null;
  const note = [
    [g('Fonte'), 'Dati ufficiali AlmaLaurea 2025, schede pubblicate su almalaurea.it'],
    [g('Scaricato il'), adesso.toLocaleDateString('it-IT')],
    [g('Definizione di «occupato»'), `${definizioneScelta}: ${TESTO_DEFINIZIONE[definizioneScelta] ?? ''}`],
    [g('Numeri in corsivo'), `Meno di ${SOGLIA_CAMPIONE_PICCOLO} rispondenti: il valore cambia molto da un anno all'altro.`],
    [g('Testi al posto dei numeri'), 'Note di AlmaLaurea: per esempio «Campione piccolo» quando il dato è nascosto perché i casi sono meno di 5.'],
    [g('Pagina'), location.href.split('#')[0]],
    [],
    [g('Colonna'), g('Tipo'), g('Laureati'), g('Hanno compilato il questionario'),
      g('Laureati (indagine sul lavoro)'), g('Intervistati sul lavoro')],
    ...modello.colonne.map(({ colonna, numerosita }) => [
      nomeColonnaFile(colonna), NOME_TIPO_COLONNA[colonna.tipo] ?? colonna.tipo,
      n(numerosita, 'profilo', 'laureati'), n(numerosita, 'profilo', 'compilatori'),
      n(numerosita, 'occupazione', 'laureati'), n(numerosita, 'occupazione', 'compilatori'),
    ]),
  ];
  return [
    { nome: 'Confronto', righe: confronto, larghezze: [24, 46, 40, ...modello.colonne.map(() => 22)], bloccaPrima: true },
    { nome: 'Note', righe: note, larghezze: [34, 60, 14, 18, 18, 18] },
  ];
}

/** Downloads the full table on screen as an .xlsx file. */
function scaricaExcel() {
  if (!tabellaMostrata) return;
  const adesso = new Date();
  const dati = creaXlsx(fogliExcel(tabellaMostrata, adesso));
  const giorno = [adesso.getFullYear(), adesso.getMonth() + 1, adesso.getDate()]
    .map((x) => String(x).padStart(2, '0')).join('-');
  const url = URL.createObjectURL(new Blob([dati], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const link = el('a', { href: url, download: `confronto-almalaurea-${giorno}.xlsx` });
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked later, not at once: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
elBtnExcel.addEventListener('click', scaricaExcel);

// --- Base or Completa, light or dark ---

const elModo = document.getElementById('modo');
const elTema = document.getElementById('tema');

/**
 * Switches between the Base view (scores) and the Completa view (published
 * values, question filters, full table). Both are always up to date: the
 * switch only shows one or the other (style.css, data-modo).
 *
 * @param {boolean} completa - Show the Completa view.
 */
function impostaModo(completa) {
  document.documentElement.dataset.modo = completa ? 'completa' : 'base';
  elModo.setAttribute('aria-checked', String(completa));
  document.getElementById('etichetta-base').dataset.attiva = String(!completa);
  document.getElementById('etichetta-completa').dataset.attiva = String(completa);
  scriviIndirizzo();
}
elModo.addEventListener('click', () => impostaModo(elModo.getAttribute('aria-checked') !== 'true'));
document.getElementById('etichetta-base').addEventListener('click', () => impostaModo(false));
document.getElementById('etichetta-completa').addEventListener('click', () => impostaModo(true));

// The theme follows the system until the user picks one with the header
// button; the pick is remembered (the inline script in index.html applies it
// before the first paint).
const CHIAVE_TEMA = 'almalaurea-tema';
const scuroDiSistema = matchMedia('(prefers-color-scheme: dark)');
const temaAttivo = () => document.documentElement.dataset.tema || (scuroDiSistema.matches ? 'scuro' : 'chiaro');

/**
 * Writes the theme in use where the stylesheet and the button read it, and
 * gives the phone's browser bar the page background.
 */
function mostraTema() {
  const attivo = temaAttivo();
  document.documentElement.dataset.temaAttivo = attivo;
  elTema.setAttribute('aria-label', attivo === 'scuro' ? 'Passa al tema chiaro' : 'Passa al tema scuro');
  // The two theme-color tags in index.html follow the system; a theme picked
  // with the button wins over both.
  const sfondo = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = sfondo;
}
elTema.addEventListener('click', () => {
  const nuovo = temaAttivo() === 'scuro' ? 'chiaro' : 'scuro';
  document.documentElement.dataset.tema = nuovo;
  try { localStorage.setItem(CHIAVE_TEMA, nuovo); } catch { /* Storage is optional. */ }
  mostraTema();
});
scuroDiSistema.addEventListener('change', mostraTema);
mostraTema();

// --- The comparison in the address ---
// The address carries the columns and the view, so a comparison can be shared
// as a link and the static pages can open one: ?c=ateneo:<code>,
// ?c=gruppo:<code>, ?c=corso:<university>:<code>, repeated per column, and
// vista=completa. A link is read once, at startup; afterwards the page writes
// the address on every change, with replaceState so that Back still leaves
// the site instead of stepping through every pick.

/** Most columns a link may open, so a crafted link cannot overload the page. */
const MAX_COLONNE_LINK = 8;

/**
 * Reads the columns of a link. Every code is checked against the real
 * universities, groups and courses; anything else is ignored, so text from
 * the address never reaches the page as it is.
 *
 * @param {URLSearchParams} parametri - Query of the address.
 * @returns {{tipo:string, codice:string, ateneo?:string}[]} Valid columns, in link order.
 */
function colonneDaIndirizzo(parametri) {
  const valide = [];
  for (const voce of parametri.getAll('c')) {
    if (valide.length >= MAX_COLONNE_LINK) break;
    const [tipo, primo, secondo] = voce.split(':');
    if (tipo === 'ateneo' && codiciAteneo.includes(primo)) {
      valide.push({ tipo, codice: primo });
    } else if (tipo === 'gruppo' && codiciGruppo.includes(primo)) {
      valide.push({ tipo, codice: primo });
    } else if (tipo === 'corso' && codiciAteneo.includes(primo) && Object.hasOwn(NOMI_CORSO[primo] ?? {}, secondo)) {
      valide.push({ tipo, codice: secondo, ateneo: primo });
    }
  }
  return valide;
}

/** Writes the current columns and view in the address, keeping the hash. */
function scriviIndirizzo() {
  if (!db) return;
  // Built by hand rather than with URLSearchParams, which would write every
  // colon as %3A; the codes are digits, so nothing needs escaping.
  const parti = colonne
    .filter((c) => c.codice)
    .map((c) => (c.tipo === 'corso' ? `c=corso:${c.ateneo}:${c.codice}` : `c=${c.tipo}:${c.codice}`));
  if (document.documentElement.dataset.modo === 'completa') parti.push('vista=completa');
  const indirizzo = `${location.pathname}${parti.length ? `?${parti.join('&')}` : ''}${location.hash}`;
  if (indirizzo !== `${location.pathname}${location.search}${location.hash}`) {
    history.replaceState(history.state, '', indirizzo);
  }
}

// --- 6. Startup ---

/** Loads the dataset and initializes the comparison UI. */
async function avvia() {
  attivaSuggerimenti();
  try {
    db = await caricaDatabase();
    leggiCodici(db);

    if (codiciAteneo.length === 0 && codiciGruppo.length === 0) {
      throw new Error('Il database è stato caricato ma non contiene codici ateneo/gruppo. Controlla il file.');
    }

    // A link opens its own comparison; otherwise a wide screen starts with
    // two columns so the user immediately sees a populated one. A phone
    // starts empty: there two example universities disorient more than they
    // show, and the page opens on "Scegli uni da confrontare".
    const daLink = new URLSearchParams(location.search);
    const iniziali = colonneDaIndirizzo(daLink);
    if (iniziali.length > 0) {
      for (const c of iniziali) creaColonna(c.tipo, c.codice, c.ateneo);
    } else if (!TELEFONO.matches) {
      creaColonna('ateneo', codiciAteneo[0]);
      creaColonna('ateneo', codiciAteneo[1] ?? codiciAteneo[0]);
    }
    if (daLink.get('vista') === 'completa') impostaModo(true);

    renderFiltri();
    renderSelettoreDefinizione();
    aggiornaVisibilitaVoci();
    renderTabella();
    // Course columns from a link download their university, as a pick would.
    for (const c of colonne) if (c.tipo === 'corso') preparaColonnaCorso(c);

    elStatoCaricamento.classList.add('nascosto');
    elAreaApp.classList.remove('nascosto');

  } catch (errore) {
    mostraErrore(
      'Non sono riuscito a caricare i dati. Controlla che almalaurea.sqlite sia nella stessa cartella di questa pagina e che tu la stia aprendo da un server locale (non con doppio click).',
      errore
    );
  }
}


// --- 7. AI layer: natural-language request -> validated query ---
// The UI uses only chiediConfronto(), which returns a query already filtered by
// the validator; this layer therefore receives only real columns and questions.

const CHIAVE_CONFIG_AI = 'almalaurea-ai-config';

const PRESET_AI = {
  ollama:    { forma: 'openai',    baseUrl: 'http://localhost:11434/v1', model: '' },
  lmstudio:  { forma: 'openai',    baseUrl: 'http://localhost:1234/v1',  model: '' },
  openai:    { forma: 'openai',    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { forma: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5' },
};

const elAiFrase = document.getElementById('ai-frase');
const elAiInvia = document.getElementById('ai-invia');
const elAiStato = document.getElementById('ai-stato');
const elAiPreset = document.getElementById('ai-preset');
const elAiForma = document.getElementById('ai-forma');
const elAiBaseUrl = document.getElementById('ai-baseurl');
const elAiModel = document.getElementById('ai-model');
const elAiKey = document.getElementById('ai-key');
const elAiDimentica = document.getElementById('ai-dimentica');
const elAiAiuto = document.getElementById('ai-aiuto');
const elDlgAi = document.getElementById('dlg-ai');
const elAiEsito = document.getElementById('ai-esito');

// An address on the user's machine usually means a network error indicates a
// missing permission rather than an unavailable server.
const RE_INDIRIZZO_LOCALE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;

// When fetch fails because of CORS, the browser returns the same generic
// TypeError as for a disconnected network rather than identifying CORS.
// The message cannot distinguish the cases, but a local address makes missing
// permission the most likely cause and is more useful than "Failed to fetch".
/**
 * Determines whether an error resembles a network failure.
 *
 * @param {unknown} errore - Error to inspect.
 * @returns {boolean} Whether the error resembles a network failure.
 */
function eErroreDiRete(errore) {
  return (
    errore instanceof TypeError ||
    /failed to fetch|networkerror|load failed/i.test(errore?.message ?? '')
  );
}

/**
 * Diagnoses a connection error for display to the user.
 *
 * @param {unknown} errore - Error to inspect.
 * @param {string} baseUrl - Configured service URL.
 * @returns {object|null} User-facing diagnosis.
 */
function diagnosticaConnessione(errore, baseUrl) {
  if (!eErroreDiRete(errore)) return null;
  if (RE_INDIRIZZO_LOCALE.test(baseUrl)) {
    return {
      messaggio:
        'Non riesco a raggiungere il modello sul tuo computer. Di solito manca il permesso: ' +
        'il programma che lo esegue deve autorizzare questa pagina. Ho aperto le istruzioni qui sopra.',
      apriAiuto: true,
    };
  }
  if (location.protocol === 'https:' && baseUrl.startsWith('http://')) {
    return {
      messaggio:
        'Il browser blocca le chiamate in http da una pagina https, tranne verso localhost. ' +
        'Usa un indirizzo https, oppure un modello locale.',
      apriAiuto: false,
    };
  }
  return {
    messaggio:
      "Non riesco a raggiungere l'indirizzo configurato. Controlla l'URL di base e la connessione.",
    apriAiuto: false,
  };
}

/** @returns {object} Current AI connection configuration. */
function leggiConfigAi() {
  return {
    forma: elAiForma.value,
    baseUrl: elAiBaseUrl.value.trim(),
    model: elAiModel.value.trim(),
    apiKey: elAiKey.value.trim() || undefined,
  };
}

function salvaConfigAi() {
  // localStorage may be unavailable in private windows or due to permissions;
  // the configuration remains valid for this page without surfacing an error.
  try {
    localStorage.setItem(CHIAVE_CONFIG_AI, JSON.stringify(leggiConfigAi()));
  } catch { /* Storage is optional; keep the in-memory configuration. */ }
}

/** Restores the saved AI connection configuration when storage is available. */
function caricaConfigAi() {
  let cfg = null;
  try {
    const grezzo = localStorage.getItem(CHIAVE_CONFIG_AI);
    if (grezzo) cfg = JSON.parse(grezzo);
  } catch { cfg = null; }
  if (!cfg) return;
  if (cfg.forma) elAiForma.value = cfg.forma;
  if (cfg.baseUrl) elAiBaseUrl.value = cfg.baseUrl;
  if (cfg.model) elAiModel.value = cfg.model;
  if (cfg.apiKey) elAiKey.value = cfg.apiKey;
}

/**
 * Displays an AI request status.
 *
 * @param {string} testo - Status text.
 * @param {string} tipo - Status category.
 */
function mostraStatoAi(testo, tipo) {
  elAiStato.textContent = testo;
  elAiStato.className = 'ai-stato' + (tipo ? ` ai-stato-${tipo}` : '');
}

// Apply a VALIDATED query to the comparison UI state, then redraw. If one part is
// empty because the AI produced nothing valid for it, preserve that UI section.
/** @param {{colonne:object[],domande:string[]}} query - Validated UI selections. */
function applicaQuery({ colonne: colonneQuery, domande }) {
  if (colonneQuery.length > 0) {
    elColonneSchede.innerHTML = '';
    colonne = [];
    for (const c of colonneQuery) creaColonna(c.tipo, c.codice);
  }
  if (domande.length > 0) {
    const insieme = new Set(domande);
    for (const macro of ORDINE_MACRO) {
      for (const voce of CONFIG_FILTRI[macro]) {
        const chk = document.getElementById(`chk-${voce.id}`);
        if (chk) chk.checked = insieme.has(voce.id);
      }
    }
    aggiornaTuttiIConteggi();
  }
  // A request to the AI is a request to compare: the table opens.
  mostraRisultato(false);
  renderTabella();
}

/** Sends the current natural-language request to the configured AI provider. */
async function inviaFraseAi() {
  const frase = elAiFrase.value.trim();
  if (!frase) { mostraStatoAi('Scrivi cosa vuoi confrontare.', 'errore'); return; }
  const config = leggiConfigAi();
  if (!config.baseUrl || !config.model) {
    mostraStatoAi("Collega prima un'AI: servono URL di base e nome del modello.", 'errore');
    return;
  }
  salvaConfigAi();
  elAiInvia.disabled = true;
  mostraStatoAi('Sto interpretando la richiesta…', 'attesa');
  try {
    const query = await chiediConfronto(config, frase);
    if (query.colonne.length === 0 && query.domande.length === 0) {
      mostraStatoAi('Non sono riuscito a ricavare un confronto valido. Prova a essere piu\' specifico, o usa i filtri a mano.', 'errore');
      return;
    }
    applicaQuery(query);
    const scartati = query.scartati.colonne.length + query.scartati.domande.length;
    let msg = query.nota || 'Confronto impostato.';
    if (scartati > 0) msg += ` (${scartati} scelte non valide sono state ignorate.)`;
    mostraStatoAi(msg, 'ok');
    // The dialog closes on the result; the AI's note stays on the page, next
    // to the columns it chose.
    elAiEsito.textContent = `Impostato dall'AI: ${msg}`;
    elAiEsito.classList.remove('nascosto');
    elDlgAi.close();
  } catch (errore) {
    const diagnosi = diagnosticaConnessione(errore, config.baseUrl);
    if (diagnosi) {
      if (diagnosi.apriAiuto && elAiAiuto) elAiAiuto.open = true;
      mostraStatoAi(diagnosi.messaggio, 'errore');
    } else {
      mostraStatoAi(`Errore nel contattare l'AI: ${errore.message}`, 'errore');
    }
    console.error(errore);
  } finally {
    elAiInvia.disabled = false;
  }
}

// Attach events only when the AI markup exists; without the panel, the comparison
// UI continues to work unchanged.
if (elAiInvia) {
  // CORS instructions must contain this page's EXACT address. It differs
  // locally (http://localhost:8000) and online (https://...github.io), and a
  // wrong origin authorizes nothing, so write it at runtime rather than in HTML.
  for (const el of document.querySelectorAll('.ai-origine')) {
    el.textContent = location.origin;
  }

  document.getElementById('apri-ai').addEventListener('click', () => {
    elDlgAi.showModal();
    elAiFrase.focus();
  });
  // A suggestion fills the request instead of sending it: the user still
  // chooses the AI and can edit the sentence first.
  for (const pulsante of document.querySelectorAll('.ai-suggerimento')) {
    pulsante.addEventListener('click', () => {
      elAiFrase.value = pulsante.textContent;
      elAiFrase.focus();
    });
  }
  elDlgAi.addEventListener('click', (evento) => {
    if (evento.target === elDlgAi) elDlgAi.close();
  });
  for (const id of ['chiudi-ai', 'annulla-ai']) {
    document.getElementById(id).addEventListener('click', () => elDlgAi.close());
  }

  elAiPreset.addEventListener('change', () => {
    const preset = PRESET_AI[elAiPreset.value];
    if (!preset) return;
    elAiForma.value = preset.forma;
    elAiBaseUrl.value = preset.baseUrl;
    if (preset.model) elAiModel.value = preset.model;
    salvaConfigAi();
  });
  elAiInvia.addEventListener('click', inviaFraseAi);
  elAiFrase.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) inviaFraseAi();
  });
  for (const el of [elAiForma, elAiBaseUrl, elAiModel, elAiKey]) {
    el.addEventListener('change', salvaConfigAi);
  }
  elAiDimentica.addEventListener('click', () => {
    try { localStorage.removeItem(CHIAVE_CONFIG_AI); } catch { /* Storage is optional. */ }
    elAiKey.value = '';
    mostraStatoAi('Configurazione AI dimenticata da questo browser.', 'ok');
  });
  caricaConfigAi();
  // Drawn after the saved configuration is restored, so they open on it.
  const tendinePreset = potenziaSelect(elAiPreset, { etichetta: 'Preset' });
  const tendinaForma = potenziaSelect(elAiForma, { etichetta: 'Forma API' });
  // A preset sets the API shape without a "change" event on its select.
  elAiPreset.addEventListener('change', () => { tendinePreset.aggiorna(); tendinaForma.aggiorna(); });
}

// --- 8. Welcome note ---
// Shown once, on a first visit to the plain page: a link to one comparison
// skips it, since whoever follows it came for that number. It counts as seen
// the moment it opens, so a reload never brings it back. Without storage it
// is not shown at all: a note that cannot be remembered would come back on
// every visit.

const CHIAVE_BENVENUTO = 'matchuni-benvenuto-visto';
const elDlgBenvenuto = document.getElementById('dlg-benvenuto');

/** Opens the welcome note unless it was seen or the page came from a link. */
function mostraBenvenuto() {
  if (new URLSearchParams(location.search).has('c')) return;
  try {
    if (localStorage.getItem(CHIAVE_BENVENUTO)) return;
    localStorage.setItem(CHIAVE_BENVENUTO, '1');
  } catch {
    return;
  }
  elDlgBenvenuto.addEventListener('click', (evento) => {
    if (evento.target === elDlgBenvenuto) elDlgBenvenuto.close();
  });
  document.getElementById('inizia').addEventListener('click', () => elDlgBenvenuto.close());
  elDlgBenvenuto.showModal();
}

mostraBenvenuto();
avvia();
