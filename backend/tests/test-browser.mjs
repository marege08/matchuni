// test-browser.mjs
//
// Prova l'app COME LA VEDE UN BROWSER: avvia un server statico, apre Chrome
// headless, aspetta che la tabella si popoli e interroga il DOM vero.
//
// PERCHE' ESISTE: le prove piu' importanti di questo progetto (la tabella si
// popola? la console e' pulita? cambiare definizione cambia davvero i numeri?)
// non si possono fare senza un browser, perche' i dati li carica sql.js a
// runtime. Questo file era stato riscritto a mano tre volte in altrettante
// sessioni: adesso e' del progetto.
//
// ZERO DIPENDENZE, di proposito. Chrome e' gia' sulla macchina e Node 22 ha
// WebSocket globale, quindi si pilota Chrome via DevTools Protocol senza
// installare niente: --headless=new --remote-debugging-port=N, poi
// PUT /json/new per aprire una scheda, WebSocket, Runtime.evaluate.
//
// USO:  node backend/tests/test-browser.mjs
//       node backend/tests/test-browser.mjs --porta 8123 --vedi
//       node backend/tests/test-browser.mjs --url https://marege08.github.io/almalaurea/
//         --vedi  lascia il browser visibile (utile per guardare cosa succede)
//         --url   prova un sito gia' pubblicato invece della copia locale: le
//                 stesse verifiche valgono in produzione, ed e' il modo di
//                 sapere che il deploy e' andato davvero, non "dovrebbe".

import { spawn } from 'node:child_process';
import { setTimeout as attendi } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBBLICA = path.join(RADICE, 'frontend', 'public');

const argomenti = process.argv.slice(2);
const valoreDi = (nome, predefinito) => {
  const i = argomenti.indexOf(nome);
  return i >= 0 && argomenti[i + 1] ? argomenti[i + 1] : predefinito;
};
const PORTA_HTTP = Number(valoreDi('--porta', '8765'));
const PORTA_CDP = PORTA_HTTP + 1;
const HEADLESS = !argomenti.includes('--vedi');
// Con --url non si avvia nessun server: si prova il sito indicato.
const URL_ESTERNO = valoreDi('--url', null);
const INDIRIZZO = URL_ESTERNO ?? `http://localhost:${PORTA_HTTP}/index.html`;

const CHROME = ['google-chrome', 'google-chrome-stable', 'chromium'];

let passati = 0;
let falliti = 0;
function verifica(descrizione, condizione, dettaglio) {
  if (condizione) {
    passati++;
    console.log(`PASS ${descrizione}`);
  } else {
    falliti++;
    console.log(`FAIL ${descrizione}${dettaglio ? `  -> ${dettaglio}` : ''}`);
  }
}

// Aspetta che una porta risponda, invece di dormire a caso: un `sleep 2` e'
// tanto lento quanto fragile.
async function aspettaPorta(url, tentativi = 100) {
  for (let i = 0; i < tentativi; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json().catch(() => ({}));
    } catch { /* non ancora in piedi */ }
    await attendi(100);
  }
  throw new Error(`Nessuna risposta da ${url} dopo ${tentativi / 10}s`);
}

// --- Connessione DevTools: una scheda nuova, poi WebSocket su di essa. ---
async function apriScheda(indirizzo) {
  const scheda = await (
    await fetch(`http://127.0.0.1:${PORTA_CDP}/json/new?${encodeURIComponent(indirizzo)}`,
                { method: 'PUT' })
  ).json();
  const ws = new WebSocket(scheda.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });

  let contatore = 0;
  const inAttesa = new Map();
  const erroriConsole = [];
  ws.onmessage = (evento) => {
    const m = JSON.parse(evento.data);
    if (m.id && inAttesa.has(m.id)) {
      const { ok, ko } = inAttesa.get(m.id);
      inAttesa.delete(m.id);
      m.error ? ko(new Error(m.error.message)) : ok(m.result);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      erroriConsole.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      erroriConsole.push(m.params.exceptionDetails.text ?? 'eccezione');
    }
  };

  const invia = (method, params = {}) =>
    new Promise((ok, ko) => {
      const id = ++contatore;
      inAttesa.set(id, { ok, ko });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await invia('Runtime.enable');

  // Valuta espressioni nella pagina. `await` supportato: molte verifiche
  // devono aspettare che sql.js abbia finito.
  const valuta = async (espressione) => {
    const r = await invia('Runtime.evaluate', {
      expression: espressione,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? 'errore in pagina');
    }
    return r.result.value;
  };

  return { valuta, invia, erroriConsole, chiudi: () => ws.close() };
}

// Aspetta una condizione NELLA pagina (il caricamento del DB non e' istantaneo).
// L'espressione viene incapsulata in un try: nei primi millisecondi il
// documento puo' non esistere ancora, e un null non e' un fallimento, e'
// semplicemente "non ancora". Senza questo il test muore sulla prima
// valutazione invece di aspettare.
async function aspettaInPagina(valuta, espressione, descrizione, tentativi = 200) {
  let ultimoErrore = '';
  for (let i = 0; i < tentativi; i++) {
    try {
      if (await valuta(`(() => { try { return !!(${espressione}); } catch { return false; } })()`)) {
        return true;
      }
    } catch (e) {
      ultimoErrore = e.message;
    }
    await attendi(100);
  }
  throw new Error(`Timeout aspettando: ${descrizione}${ultimoErrore ? ` (${ultimoErrore})` : ''}`);
}

// Legge un .xlsx scritto da js/esporta-xlsx.js: uno zip senza compressione.
// Controlla il CRC di ogni file con zlib (codice di Node, non quello del
// sito) e restituisce le celle del primo foglio come { "B2": valore }.
function leggiXlsx(byte) {
  const file = {};
  const dv = new DataView(byte.buffer, byte.byteOffset, byte.byteLength);
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const metodo = dv.getUint16(p + 8, true);
    const crc = dv.getUint32(p + 14, true);
    const dimensione = dv.getUint32(p + 18, true);
    const lungNome = dv.getUint16(p + 26, true);
    const lungExtra = dv.getUint16(p + 28, true);
    const nome = new TextDecoder().decode(byte.subarray(p + 30, p + 30 + lungNome));
    const dati = byte.subarray(p + 30 + lungNome + lungExtra, p + 30 + lungNome + lungExtra + dimensione);
    if (metodo !== 0) throw new Error(`${nome}: compresso, atteso senza compressione`);
    if (crc32(dati) !== crc) throw new Error(`${nome}: CRC sbagliato`);
    file[nome] = new TextDecoder().decode(dati);
    p += 30 + lungNome + lungExtra + dimensione;
  }
  const foglio = file['xl/worksheets/sheet1.xml'] ?? '';
  const celle = {};
  const testo = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  for (const m of foglio.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?: t="inlineStr")?[^>]*>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)<\/c>/g)) {
    celle[m[1]] = m[2] !== undefined ? Number(m[2]) : testo(m[3]);
  }
  return { file: Object.keys(file), celle, fogli: [...(file['xl/workbook.xml'] ?? '').matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]) };
}

async function main() {
  const server = URL_ESTERNO
    ? null
    : spawn('python3', ['-m', 'http.server', String(PORTA_HTTP)], {
        cwd: PUBBLICA, stdio: 'ignore',
      });

  let chrome = null;
  let scheda = null;
  // A fresh Chrome profile on every run, deleted at the end. A profile kept
  // between runs keeps its HTTP cache too, and on 26 Sep 2026 it served a
  // stale config-filtri.js: the test was checking yesterday's code, not
  // today's.
  const PROFILO = mkdtempSync(path.join(tmpdir(), 'almalaurea-test-chrome-'));
  try {
    console.log(`Provo: ${INDIRIZZO}\n`);
    if (server) await aspettaPorta(`http://127.0.0.1:${PORTA_HTTP}/index.html`).catch(() => {});

    for (const binario of CHROME) {
      try {
        chrome = spawn(binario, [
          HEADLESS ? '--headless=new' : '--new-window',
          `--remote-debugging-port=${PORTA_CDP}`,
          '--no-first-run',
          '--no-default-browser-check',
          `--user-data-dir=${PROFILO}`,
          'about:blank',
        ], { stdio: 'ignore' });
        break;
      } catch { /* provo il prossimo */ }
    }
    if (!chrome) throw new Error(`Nessun Chrome trovato fra: ${CHROME.join(', ')}`);

    await aspettaPorta(`http://127.0.0.1:${PORTA_CDP}/json/version`);
    scheda = await apriScheda(INDIRIZZO);
    const { valuta, invia } = scheda;

    // Prima che il documento esista, poi che l'app sia effettivamente accesa.
    await aspettaInPagina(valuta, `document.readyState === 'complete'`, 'pagina caricata');
    await aspettaInPagina(valuta,
      `document.getElementById('area-app') &&
       !document.getElementById('area-app').classList.contains('nascosto')`,
      'app visibile (database caricato)');

    // --- 0a. La vista Base: un voto da 0 a 10 per domanda (js/voto.js) ---
    // All'avvio le colonne sono Marche Politecnica (70001) e Bari (70002),
    // messe a confronto con i 78 atenei. Voti attesi calcolati a parte sul
    // database (definizione ampia), con le stesse regole: rango medio fra gli
    // atenei con almeno 40 rispondenti.
    const votiDi = (griglia) => `(() => {
      const voti = (id) => [...document.querySelectorAll('${griglia} .voti-riga[data-indicatore="' + id + '"] .voto')]
        .map(v => v.querySelector('[data-voto]')?.dataset.voto ?? v.querySelector('[data-motivo]')?.dataset.motivo);
      return Object.fromEntries(['occupati', 'retribuzione', 'primo-lavoro', 'efficacia', 'in-corso', 'rifarebbero']
        .map(id => [id, voti(id)]));
    })()`;
    const visibile = (selettore) =>
      `(() => { const e = document.querySelector(${JSON.stringify(selettore)}); return !!e && e.offsetParent !== null; })()`;
    const base = await valuta(`({
      modo: document.documentElement.dataset.modo,
      voti: ${votiDi('#griglia-voti')},
      votiVisibili: ${visibile('#griglia-voti')},
      sintesiVisibile: ${visibile('#griglia-sintesi')},
      filtriVisibili: ${visibile('#accordion-filtri')},
      paragone: document.getElementById('paragone-voti').textContent,
      frase: document.querySelector('#griglia-voti .voti-riga[data-indicatore="retribuzione"] .voto-frase')?.textContent,
      ultimi: document.querySelectorAll('#griglia-voti .voti-riga[data-indicatore="rifarebbero"] .voto-frase')[1]?.textContent,
    })`);
    verifica('si parte dalla vista Base: voti visibili, sintesi e filtri no',
      base.modo === 'base' && base.votiVisibili && !base.sintesiVisibile && !base.filtriVisibili,
      JSON.stringify({ ...base, voti: undefined }));
    verifica('voti di Marche Politecnica e Bari fra i 78 atenei',
      JSON.stringify(base.voti) === JSON.stringify({
        occupati: ['6', '4'], retribuzione: ['8', '3'], 'primo-lavoro': ['9', '4'],
        efficacia: ['8', '8'], 'in-corso': ['3', '2'], rifarebbero: ['5', '0'],
      }), JSON.stringify(base.voti));
    verifica('il voto e\' la sua frase: «meglio di 8 atenei su 10», e lo 0 «tra gli ultimi atenei»',
      base.frase === 'meglio di 8 atenei su 10' && base.ultimi === 'tra gli ultimi atenei',
      `${base.frase} | ${base.ultimi}`);
    verifica('sotto i voti c\'e\' contro chi sono calcolati, e con quale definizione',
      base.paragone.includes('Gli atenei sono messi a confronto con tutti i 78 atenei.') &&
      base.paragone.includes('definizione ampia'), base.paragone);

    // Il voto ha il colore del semaforo (scelta di Mare, 23 ott 2026): lo 0
    // e' esattamente il rosso del tema, il 9 sta dal lato del verde. Nei due
    // temi, perche' il rosso dello scuro e' un altro.
    const coloriVoto = (tema) => valuta(`(() => {
      document.documentElement.dataset.tema = '${tema}';
      const cifra = (id, i) => document.querySelectorAll(
        '#griglia-voti .voti-riga[data-indicatore="' + id + '"] .voto-cifra')[i];
      // Chrome restituisce i colori di color-mix() in oklab: li si fa disegnare
      // su un pixel e si leggono in sRGB.
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      const rgb = (colore) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = colore; ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
      const nove = cifra('primo-lavoro', 0);
      const tacca = nove.parentElement.querySelector('.tacche i.piena');
      return { zero: rgb(getComputedStyle(cifra('rifarebbero', 1)).color), nove: rgb(getComputedStyle(nove).color),
               tacca: rgb(getComputedStyle(tacca).backgroundColor) };
    })()`);
    const vicino = (a, b) => a.every((x, i) => Math.abs(x - b[i]) <= 2);
    const chiaro = await coloriVoto('chiaro');
    const scuro = await coloriVoto('scuro');
    await valuta(`delete document.documentElement.dataset.tema`);
    verifica('voto a semaforo: lo 0 e\' rosso, il 9 verde, tacche dello stesso colore della cifra (chiaro e scuro)',
      vicino(chiaro.zero, [198, 40, 40]) && vicino(scuro.zero, [242, 102, 95]) &&
      chiaro.nove[1] > chiaro.nove[0] && scuro.nove[1] > scuro.nove[0] &&
      vicino(chiaro.tacca, chiaro.nove) && vicino(scuro.tacca, scuro.nove),
      JSON.stringify({ chiaro, scuro }));

    // --- 0b. Le tendine disegnate (js/tendina.js) ---
    // I tre select di ogni colonna restano nella pagina, nascosti, e tengono
    // lo stato; l'utente vede due campi. Si sceglie come farebbe un utente:
    // si apre il campo, si scrive nella ricerca, Invio.
    const campi = await valuta(`[...document.querySelectorAll('.colonna-scheda')]
      .map(c => [...c.querySelectorAll('.tendina-valore')].map(v => v.textContent))`);
    verifica('ogni colonna mostra il suo ateneo e «Tutto l\'ateneo»',
      JSON.stringify(campi) === JSON.stringify([['Marche Politecnica', "Tutto l'ateneo"], ['Bari', "Tutto l'ateneo"]]),
      JSON.stringify(campi));
    const scegliDaUtente = (colonna, campo, testo) => valuta(`(async () => {
      const col = document.querySelectorAll('.colonna-scheda')[${colonna}];
      col.querySelector('.${campo} .tendina-bottone').click();
      const input = col.querySelector('.tendina-cerca input');
      const fuoco = document.activeElement === input;
      input.value = ${JSON.stringify(testo)};
      input.dispatchEvent(new Event('input'));
      const righe = [...col.querySelectorAll('.tendina-lista li[role=option]')].map(li => li.textContent);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      return { fuoco, righe, aperta: !!col.querySelector('.tendina'),
               tipo: col.querySelector('.sel-tipo').value, codice: col.querySelector('.sel-codice').value,
               corsoNascosto: col.querySelector('.campo-corso').hidden,
               mostrato: col.querySelector('.campo-entita .tendina-valore').textContent };
    })()`);
    const area = await scegliDaUtente(1, 'campo-entita', 'informatica e tec');
    verifica('cercando «informatica e tec» resta solo l\'area Informatica e Tecnologie ICT, col fuoco nella ricerca',
      area.fuoco && area.righe.length === 1 && area.righe[0].startsWith('Informatica e Tecnologie ICT'),
      JSON.stringify(area.righe));
    verifica('Invio la sceglie: la colonna diventa un\'area e il campo del corso sparisce',
      !area.aperta && area.tipo === 'gruppo' && area.codice === '10' && area.corsoNascosto &&
      area.mostrato === 'Informatica e Tecnologie ICT', JSON.stringify(area));
    const votiArea = await valuta(votiDi('#griglia-voti'));
    verifica('l\'area ICT si confronta con le 15 aree: occupati 8, «rifarebbero» quasi tutti uguali',
      votiArea.occupati[1] === '8' && votiArea['primo-lavoro'][1] === '9' &&
      votiArea.rifarebbero[1] === 'tutti-uguali', JSON.stringify(votiArea));
    const bari = await scegliDaUtente(1, 'campo-entita', 'bari');
    verifica('e si torna a Bari dalla stessa tendina',
      bari.righe[0] === 'Bari' && bari.tipo === 'ateneo' && bari.codice === '70002' && !bari.corsoNascosto,
      JSON.stringify(bari));

    // --- 0c. Il pulsante del tema: inverte quello in uso e lo ricorda ---
    const tema = await valuta(`(() => {
      const fondo = () => getComputedStyle(document.body).backgroundColor;
      const prima = { attivo: document.documentElement.dataset.temaAttivo, fondo: fondo() };
      document.getElementById('tema').click();
      const dopo = { attivo: document.documentElement.dataset.temaAttivo, fondo: fondo(),
                     ricordato: localStorage.getItem('almalaurea-tema') };
      document.getElementById('tema').click();
      return { prima, dopo, ritorno: document.documentElement.dataset.temaAttivo };
    })()`);
    verifica('il pulsante del tema passa allo scuro, lo ricorda, e torna al chiaro',
      tema.prima.attivo === 'chiaro' && tema.dopo.attivo === 'scuro' && tema.dopo.ricordato === 'scuro' &&
      tema.prima.fondo !== tema.dopo.fondo && tema.ritorno === 'chiaro', JSON.stringify(tema));

    // --- 0d. Completa: da qui in poi le prove leggono i valori pubblicati ---
    const completa = await valuta(`(() => {
      document.getElementById('modo').click();
      return { modo: document.documentElement.dataset.modo,
               interruttore: document.getElementById('modo').getAttribute('aria-checked'),
               votiVisibili: ${visibile('#griglia-voti')},
               sintesiVisibile: ${visibile('#griglia-sintesi')},
               filtriVisibili: ${visibile('#accordion-filtri')} };
    })()`);
    verifica('l\'interruttore passa a Completa: sintesi e filtri al posto dei voti',
      completa.modo === 'completa' && completa.interruttore === 'true' && !completa.votiVisibili &&
      completa.sintesiVisibile && completa.filtriVisibili, JSON.stringify(completa));

    // --- 0. All'apertura: le principali scelte, la tabella chiusa ---
    // Le domande principali sono quelle degli indicatori chiave (8, da
    // indicatori-chiave.js); la tabella completa compare solo dopo il primo
    // «Confronta», poi segue da sola ogni modifica.
    const apertura = await valuta(`(() => ({
      scelte: [...document.querySelectorAll('#accordion-filtri input[type=checkbox]')]
        .filter(c => c.checked && !c.closest('label').hidden).map(c => c.id),
      conta: document.getElementById('conta-domande').textContent,
      tabellaNascosta: document.getElementById('risultato').classList.contains('nascosto'),
    }))()`);
    verifica('all\'apertura sono scelte le 8 domande principali',
      apertura.scelte.length === 8 && apertura.scelte.includes('chk-tasso_di_occupazione') &&
      apertura.conta === '8 domande scelte', `${apertura.scelte.length}: ${apertura.conta}`);
    verifica('all\'apertura la tabella completa e\' nascosta', apertura.tabellaNascosta);
    await valuta(`(() => { document.getElementById('btn-confronta').click(); return true; })()`);
    const dopoConfronta = await valuta(`({
      visibile: !document.getElementById('risultato').classList.contains('nascosto'),
      pulsante: !!document.getElementById('btn-confronta'),
      righe: document.querySelectorAll('#tabella-body tr').length,
    })`);
    verifica('«Confronta» apre la tabella e lascia il posto all\'aggiornamento dal vivo',
      dopoConfronta.visibile && !dopoConfronta.pulsante && dopoConfronta.righe > 8,
      JSON.stringify(dopoConfronta));

    // --- 1. La tabella si popola (con tutte le domande) ---
    await valuta(`(() => { document.getElementById('btn-tutte').click(); return true; })()`);
    const celle = await valuta(`document.querySelectorAll('#tabella-body td').length`);
    verifica('la tabella di confronto si popola', celle > 500, `${celle} celle`);
    const alti = await valuta(`document.querySelectorAll('#tabella-body td.alto').length`);
    verifica('il valore piu\' alto di ogni riga e\' segnato', alti > 50, `${alti} celle in grassetto`);

    // --- 1a. Il fumetto dei suggerimenti (js/suggerimento.js) ---
    // Passando sopra una cella il title passa nel fumetto (e il browser tace);
    // uscendo il fumetto sparisce e il title torna dov'era, intatto.
    const fumetto = await valuta(`(async () => {
      const td = document.querySelector('#tabella-body td.cella-valore[title]');
      const titolo = td.title;
      const evento = (tipo) => new PointerEvent(tipo, { pointerType: 'mouse', bubbles: true });
      td.dispatchEvent(evento('pointerover'));
      await new Promise(r => setTimeout(r, 400));
      const bolla = document.getElementById('suggerimento');
      const durante = { visibile: !bolla.hidden,
        testo: [...bolla.children].map(c => c.textContent).join('\\n'),
        titolo: td.getAttribute('title'), cursore: getComputedStyle(td).cursor };
      td.dispatchEvent(evento('pointerout'));
      return { titolo, durante, dopo: { visibile: !bolla.hidden, titolo: td.getAttribute('title') } };
    })()`);
    verifica('passando sopra una cella compare il fumetto col suo testo, senza tooltip del browser ne\' cursore a punto interrogativo',
      fumetto.durante.visibile && fumetto.durante.testo === fumetto.titolo && fumetto.titolo !== '' &&
      fumetto.durante.titolo === null && fumetto.durante.cursore !== 'help', JSON.stringify(fumetto.durante));
    verifica('uscendo il fumetto sparisce e il title torna al suo posto',
      !fumetto.dopo.visibile && fumetto.dopo.titolo === fumetto.titolo, JSON.stringify(fumetto.dopo));

    // --- 1b. La sintesi «In sintesi» legge gli stessi dati della tabella ---
    // All'avvio le colonne sono Marche Politecnica (70001) e Bari (70002).
    // «Tasso di occupazione › Totale» vale 64,6 e 59,7; la retribuzione di
    // Bari 1.304 euro (definizione ampia).
    const sintesi = await valuta(`(() => {
      const righe = [...document.querySelectorAll('#griglia-sintesi .paragone-riga[data-indicatore]')];
      const valori = (id) => [...document.querySelectorAll(
        '#griglia-sintesi .paragone-riga[data-indicatore="' + id + '"] .paragone-numero')].map(v => v.textContent);
      return { righe: righe.length,
               occupati: valori('occupati'), retribuzione: valori('retribuzione'),
               domanda: document.querySelector('#griglia-sintesi .paragone-riga[data-indicatore="occupati"] .paragone-domanda')?.textContent };
    })()`);
    verifica('la sintesi mostra 6 righe', sintesi.righe === 6, `${sintesi.righe} righe`);
    verifica('«Quanti lavorano»: 64,6% Marche Politecnica, 59,7% Bari',
      sintesi.occupati[0] === '64,6%' && sintesi.occupati[1] === '59,7%', sintesi.occupati.join(' | '));
    verifica('«Quanto si guadagna»: Bari 1.304 €',
      sintesi.retribuzione[1] === '1.304 €', sintesi.retribuzione.join(' | '));
    verifica('sotto il titolo c\'e\' il nome esatto della domanda AlmaLaurea',
      sintesi.domanda === 'Tasso di occupazione › Totale', String(sintesi.domanda));

    // --- 2. Le macro-categorie sono quelle attese ---
    const macro = await valuta(
      `[...document.querySelectorAll('#accordion-filtri details')]
         .filter(d => !d.hidden)
         .map(d => d.querySelector('summary span').textContent)`);
    verifica('«Dopo la Laurea» compare fra i filtri',
      macro.includes('Dopo la Laurea'), macro.join(' | '));
    // I giudizi sull'universita' (sezione 7 del profilo) hanno un gruppo loro,
    // subito dopo «Successo e Percorso», e non stanno piu' sotto il lavoro.
    verifica('«Esperienza Universitaria» e\' il secondo gruppo dei filtri',
      macro[1] === 'Esperienza Universitaria', macro.join(' | '));

    // --- 3. Il selettore di definizione c'e' ed e' popolato ---
    const sel = await valuta(`(() => {
      const r = document.getElementById('riquadro-definizione');
      const s = document.getElementById('sel-definizione');
      return { visibile: !r.classList.contains('nascosto'),
               opzioni: [...s.options].map(o => o.value),
               scelta: s.value,
               nota: document.getElementById('nota-definizione').textContent };
    })()`);
    verifica('il selettore di definizione e\' visibile', sel.visibile);
    verifica('offre ampia e restrittiva',
      sel.opzioni.includes('ampia') && sel.opzioni.includes('restrittiva'),
      sel.opzioni.join(','));
    verifica('parte dalla definizione ampia, come il sito AlmaLaurea',
      sel.scelta === 'ampia', sel.scelta);
    verifica('la nota spiega la definizione scelta',
      sel.nota.includes('anche di formazione'), sel.nota.slice(0, 60));


    // Le domande solo-corso (soloCorso in config-filtri.js): la casella e le
    // righe della tabella, lette dal DOM. La riga si cerca per etichetta
    // esatta; «Lavorano e sono iscritti...» esiste solo in quella domanda.
    const RIGA_SOLO_CORSO = 'Lavorano e sono iscritti ad una laurea di secondo livello';
    const statoSoloCorso = () => valuta(`(() => {
      const chk = document.getElementById('chk-condizione_occupazionale_e_formativa');
      const riga = [...document.querySelectorAll('#tabella-body tr')]
        .find(tr => tr.cells[0]?.textContent.trim() === ${JSON.stringify(RIGA_SOLO_CORSO)});
      return { casella: !!chk, visibile: !!chk && !chk.closest('label').hidden,
               celle: riga ? [...riga.cells].slice(1).map(td => td.textContent.trim()) : null,
               titolo: riga ? riga.cells[riga.cells.length - 1].title : '',
               nota: document.getElementById('nota-definizione').textContent };
    })()`);

    // --- 3b. Senza colonne corso le domande solo-corso non si vedono ---
    const senzaCorsi = await statoSoloCorso();
    verifica('senza colonne corso le domande solo-corso restano nascoste',
      senzaCorsi.casella && !senzaCorsi.visibile && senzaCorsi.celle === null,
      JSON.stringify(senzaCorsi).slice(0, 120));
    verifica('la nota della definizione non conta le domande solo-corso',
      senzaCorsi.nota.includes('delle 22 domande'), senzaCorsi.nota.slice(-90));

    // --- 4. Cambiare definizione cambia le domande consultabili ---
    const primaDelCambio = await valuta(`(() => {
      const vis = [...document.querySelectorAll('#accordion-filtri .voce-checkbox')]
        .filter(l => !l.hidden).map(l => l.textContent);
      return { quante: vis.length, ha: vis.some(t => t.includes('Ricerca del lavoro')) };
    })()`);
    verifica('con ampia si vede «Ricerca del lavoro»', primaDelCambio.ha);

    await valuta(`(() => {
      const s = document.getElementById('sel-definizione');
      s.value = 'restrittiva';
      s.dispatchEvent(new Event('change'));
      return true;
    })()`);
    await attendi(300);

    const dopoIlCambio = await valuta(`(() => {
      const vis = [...document.querySelectorAll('#accordion-filtri .voce-checkbox')]
        .filter(l => !l.hidden).map(l => l.textContent);
      return { quante: vis.length,
               haRicerca: vis.some(t => t.includes('Ricerca del lavoro')),
               haCondizione: vis.some(t => t.includes('Condizione occupazionale')) };
    })()`);
    verifica('con restrittiva «Ricerca del lavoro» sparisce', !dopoIlCambio.haRicerca);
    verifica('con restrittiva compare «Condizione occupazionale»', dopoIlCambio.haCondizione);
    verifica('il numero di domande consultabili resta lo stesso',
      primaDelCambio.quante === dopoIlCambio.quante,
      `${primaDelCambio.quante} vs ${dopoIlCambio.quante}`);

    // --- 5. E cambia davvero i NUMERI (la ragione di tutto il lavoro) ---
    // "Non hanno mai lavorato dopo la laurea" vale 29,4 con la definizione
    // ampia e 35,7 con la restrittiva: sei punti di differenza. Se le due
    // scelte dessero lo stesso numero, il filtro non starebbe funzionando.
    const testoTabella = async () =>
      valuta(`document.getElementById('tabella-body').textContent`);
    const conRestrittiva = await testoTabella();
    await valuta(`(() => {
      const s = document.getElementById('sel-definizione');
      s.value = 'ampia'; s.dispatchEvent(new Event('change')); return true;
    })()`);
    await attendi(300);
    const conAmpia = await testoTabella();
    verifica('le due definizioni producono tabelle diverse',
      conRestrittiva !== conAmpia);

    // --- 5b. Il numero preciso, non solo "sono diverse" ---
    // A Bari (prima colonna all'avvio) "Non hanno mai lavorato dopo la laurea"
    // vale 29,4 con la definizione ampia e 35,7 con la restrittiva. E' il caso
    // che ha dimostrato che la colonna `definizione` serviva: se la pagina
    // mostrasse lo stesso numero con entrambe, il filtro non funzionerebbe.
    // La prima colonna all'avvio e' il primo ateneo in ordine di codice
    // (70001), non Bari: la si punta esplicitamente, altrimenti il test
    // verificherebbe numeri di un ateneo qualsiasi.
    await valuta(`(() => {
      const sel = document.querySelector('.colonna-scheda').querySelectorAll('select')[1];
      sel.value = '70002';
      sel.dispatchEvent(new Event('change'));
      return sel.value;
    })()`);
    await attendi(300);

    const valoreDellaRiga = (etichetta) => valuta(`(() => {
      const righe = [...document.querySelectorAll('#tabella-body tr')];
      const r = righe.find(tr => tr.cells[0]?.textContent.trim() === ${JSON.stringify(etichetta)});
      return r ? r.cells[1].textContent.trim() : null;
    })()`);
    const ETICHETTA = 'Non hanno mai lavorato dopo la laurea';
    const ampiaValore = await valoreDellaRiga(ETICHETTA);
    verifica('con ampia il valore di Bari e\' 29,4',
      ampiaValore === '29,4', String(ampiaValore));
    await valuta(`(() => {
      const s = document.getElementById('sel-definizione');
      s.value = 'restrittiva'; s.dispatchEvent(new Event('change')); return true;
    })()`);
    await attendi(300);
    const restrittivaValore = await valoreDellaRiga(ETICHETTA);
    verifica('con restrittiva lo stesso valore diventa 35,7',
      restrittivaValore === '35,7', String(restrittivaValore));

    // --- 6. Numerosita' per indagine nell'intestazione ---
    const intestazione = await valuta(
      `document.getElementById('tabella-head').textContent`);
    verifica('l\'intestazione mostra anche gli intervistati di occupazione',
      intestazione.includes('intervistati'), intestazione.slice(0, 90));

    // --- 7. I corsi si caricano un ateneo alla volta (js/db-corsi.js) ---
    // Si importa lo stesso modulo che usa la pagina (stesso URL, quindi stessa
    // istanza e stessa cache), e si contano i download veri dalla lista delle
    // risorse del browser invece di fidarsi di quello che dice il modulo.
    const scaricatiCorsi = () => valuta(
      `performance.getEntriesByType('resource')
         .filter(r => r.name.includes('/corsi/'))
         .map(r => r.name.split('/').pop())`);
    const allAvvio = await scaricatiCorsi();
    verifica('all\'avvio non si scarica nessun database dei corsi',
      allAvvio.length === 0, allAvvio.join(','));

    const corsi = await valuta(`(async () => {
      const m = await import('./js/db-corsi.js');
      const db = await m.caricaAteneoCorsi('70026');
      const [righe, quanti] = db.exec(
        'SELECT COUNT(*), COUNT(DISTINCT corso) FROM dati')[0].values[0];
      const ancora = await m.caricaAteneoCorsi('70026');
      const [a, b] = await Promise.all([
        m.caricaAteneoCorsi('70303'), m.caricaAteneoCorsi('70303')]);
      const rifiutato = await m.caricaAteneoCorsi('../almalaurea')
        .then(() => '', (e) => e.message);
      // Sei atenei in memoria, poi si libera tenendo Sapienza «in uso» anche
      // se e' la meno usata di recente: deve restare aperta.
      for (const c of ['70121', '70145', '70147', '70141']) await m.caricaAteneoCorsi(c);
      m.liberaAteneiNonUsati(['70026']);
      const inMemoria = m.ateneiInMemoria();
      const [ancoraViva] = db.exec('SELECT COUNT(*) FROM dati')[0].values[0];
      return { righe, quanti, stessa: db === ancora, condiviso: a === b,
               rifiutato, inMemoria, ancoraViva, max: m.MAX_ATENEI_APERTI };
    })()`);
    verifica('Sapienza carica 67.544 righe su 133 corsi',
      corsi.righe === 67544 && corsi.quanti === 133, `${corsi.righe} righe, ${corsi.quanti} corsi`);
    const dopo = await scaricatiCorsi();
    verifica('il secondo caricamento dello stesso ateneo non riscarica',
      corsi.stessa && dopo.filter((f) => f === '70026.sqlite').length === 1, dopo.join(','));
    verifica('due richieste contemporanee fanno un solo download',
      corsi.condiviso && dopo.filter((f) => f === '70303.sqlite').length === 1, dopo.join(','));
    verifica('un codice ateneo falso viene rifiutato senza scaricare niente',
      corsi.rifiutato.includes('sconosciuto') && !dopo.some((f) => f.includes('almalaurea')),
      corsi.rifiutato);
    verifica('liberando la memoria restano al massimo 4 atenei, e mai quello in uso',
      corsi.inMemoria.length === corsi.max && corsi.inMemoria.includes('70026') &&
        corsi.ancoraViva === 67544,
      corsi.inMemoria.join(','));

    // --- 8. I nomi dei corsi (js/nomi-corso.js) ---
    // La copertura 1:1 contro i database la verifica il generatore
    // (tools/genera_nomi_corso.py --check); qui si controlla che il modulo
    // pubblicato si carichi nel browser e dica le cose giuste.
    const nomi = await valuta(`(async () => {
      const { NOMI_CORSO } = await import('./js/nomi-corso.js');
      const { NOMI_ATENEO } = await import('./js/nomi-ateneo.js');
      const atenei = Object.keys(NOMI_CORSO);
      return {
        atenei: atenei.length,
        soloAteneiVeri: atenei.every((a) => a in NOMI_ATENEO),
        corsi: atenei.reduce((n, a) => n + Object.keys(NOMI_CORSO[a]).length, 0),
        acsai: NOMI_CORSO['70026']?.['0580106203100003'] ?? null,
      };
    })()`);
    verifica('i nomi coprono 78 atenei, tutti veri',
      nomi.atenei === 78 && nomi.soloAteneiVeri, `${nomi.atenei} atenei`);
    verifica('i nomi coprono 2.607 corsi', nomi.corsi === 2607, `${nomi.corsi} corsi`);
    verifica('ACSAI ha il suo nome sotto Sapienza',
      String(nomi.acsai).startsWith('applied computer science and artificial intelligence'),
      String(nomi.acsai));

    // --- 9. Una colonna di tipo corso, scelta dai menu come farebbe un utente ---
    // La prima colonna diventa ACSAI (Sapienza). E' il caso che giustifica la
    // soglia: profilo su 52 compilatori (sopra 40), occupazione su 22
    // intervistati (sotto). Sapienza e' gia' in memoria dalla sezione 7.
    const scegliNellaPrimaColonna = (classe, valore) => valuta(`(() => {
      const s = document.querySelector('.colonna-scheda .${classe}');
      s.value = ${JSON.stringify(valore)};
      s.dispatchEvent(new Event('change'));
      return s.value;
    })()`);
    const testaPrimaColonna = () =>
      valuta(`document.querySelectorAll('#tabella-head th')[1].textContent`);
    const aspettaTesta = (testo, descrizione) => aspettaInPagina(valuta,
      `document.querySelectorAll('#tabella-head th')[1].textContent.includes(${JSON.stringify(testo)}) &&
       !document.querySelectorAll('#tabella-head th')[1].textContent.includes('caricamento')`,
      descrizione);

    await scegliNellaPrimaColonna('sel-tipo', 'corso');
    await scegliNellaPrimaColonna('sel-codice', '70026');
    await scegliNellaPrimaColonna('sel-corso', '0580106203100003');
    await aspettaTesta('applied computer science', 'colonna ACSAI caricata');
    const testaAcsai = await testaPrimaColonna();
    verifica('la colonna corso porta il nome del corso e il suo ateneo',
      testaAcsai.includes('applied computer science') && testaAcsai.includes('Roma Sapienza'),
      testaAcsai.slice(0, 120));

    // Le celle della prima colonna, divise per indagine leggendo il tooltip,
    // che nomina l'indagine su cui si basa ogni valore.
    const celleAcsai = () => valuta(`(() => {
      const celle = [...document.querySelectorAll('#tabella-body tr')]
        .map(tr => tr.cells[1]).filter(td => td && td.title);
      const di = (indagine) => celle.filter(td => td.title.includes('(indagine ' + indagine + ')'));
      const piccole = (lista) => lista.filter(td => td.classList.contains('cella-campione-piccolo')).length;
      const occ = di('occupazione'), pro = di('profilo');
      const numeri = (lista) => lista.filter(td => td.classList.contains('cella-valore'));
      return { conValore: celle.filter(td => td.classList.contains('cella-valore')).length,
               occ: numeri(occ).length, occPiccole: piccole(numeri(occ)),
               noteSegnate: piccole(occ.filter(td => td.classList.contains('cella-nota'))),
               pro: pro.length, proPiccole: piccole(pro),
               testo: celle.map(td => td.textContent).join('|'),
               legenda: !document.getElementById('legenda-campione').classList.contains('nascosto') };
    })()`);
    const acsai = await celleAcsai();
    verifica('le celle di ACSAI si riempiono di valori', acsai.conValore > 100,
      `${acsai.conValore} celle con valore`);
    // Il segno vale per i numeri: una nota al posto del numero non lo porta.
    verifica('occupazione di ACSAI (22 intervistati): ogni numero segnato come campione piccolo, nessuna nota',
      acsai.occ > 0 && acsai.occPiccole === acsai.occ && acsai.noteSegnate === 0,
      `${acsai.occPiccole}/${acsai.occ} numeri, ${acsai.noteSegnate} note segnate`);
    verifica('profilo di ACSAI (52 compilatori) mai segnato',
      acsai.pro > 0 && acsai.proPiccole === 0, `${acsai.proPiccole}/${acsai.pro}`);
    verifica('la legenda del campione piccolo compare', acsai.legenda);

    // --- 9a. Una colonna corso non rompe l'impaginazione ---
    // Il nome del corso arriva a 187 caratteri. Su una riga sola, nel rilievo
    // del 26 set 2026, spingeva la seconda colonna fuori dal riquadro della
    // tabella (desktop), e i tre menu in fila allargavano la pagina a 816 px
    // su un telefono da 390. Finestra fissata, poi restituita com'era.
    const finestra = async (larghezza, mobile) => {
      await invia('Emulation.setDeviceMetricsOverride',
        { width: larghezza, height: 900, deviceScaleFactor: 1, mobile });
      await attendi(300);
    };
    await finestra(1400, false);
    const larghezze = await valuta(`(() => {
      const sc = document.querySelector('.scroll-tabella');
      return { colonne: document.querySelectorAll('#tabella-head th').length - 1,
               tabella: sc.scrollWidth, riquadro: sc.clientWidth };
    })()`);
    verifica('su desktop le colonne del confronto stanno tutte nel riquadro',
      larghezze.colonne >= 2 && larghezze.tabella <= larghezze.riquadro,
      `${larghezze.colonne} colonne, tabella ${larghezze.tabella} px su ${larghezze.riquadro}`);
    await finestra(390, true);
    const pagina = await valuta(`[document.documentElement.scrollWidth, innerWidth]`);
    verifica('su un telefono da 390 px la pagina non si allarga',
      pagina[0] <= 390 && pagina[1] <= 390, `pagina ${pagina[0]} px, finestra ${pagina[1]}`);
    // Lo stesso in Base, con la tendina del corso aperta (nomi fino a 187
    // caratteri), e la navigazione diventa una pillola in fondo allo schermo.
    const telefonoBase = await valuta(`(() => {
      document.getElementById('etichetta-base').click();
      document.querySelector('.colonna-scheda .campo-corso .tendina-bottone').click();
      const pannello = document.querySelector('.tendina').getBoundingClientRect();
      const nav = document.querySelector('.navigazione');
      const r = nav.getBoundingClientRect();
      const esito = { pagina: document.documentElement.scrollWidth, tendina: [Math.round(pannello.left), Math.round(pannello.right)],
                      navFissa: getComputedStyle(nav).position === 'fixed', navBasso: Math.round(innerHeight - r.bottom),
                      navDentro: r.left >= 0 && r.right <= innerWidth };
      document.querySelector('.tendina-cerca input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.getElementById('etichetta-completa').click();
      return esito;
    })()`);
    verifica('su un telefono, in Base con la tendina aperta, niente si allarga e la navigazione sta in fondo',
      telefonoBase.pagina <= 390 && telefonoBase.tendina[0] >= 0 && telefonoBase.tendina[1] <= 390 &&
      telefonoBase.navFissa && telefonoBase.navBasso >= 8 && telefonoBase.navBasso <= 40 && telefonoBase.navDentro,
      JSON.stringify(telefonoBase));
    await invia('Emulation.clearDeviceMetricsOverride');
    await attendi(300);

    // --- 9a-bis. Con una colonna corso le domande solo-corso compaiono ---
    // La prima colonna e' ACSAI, la seconda un ateneo. ACSAI, definizione
    // ampia: 31,8% lavora ed e' iscritto alla magistrale. L'ateneo non ha la
    // domanda (mescola tutti i tipi di laurea) e lo dice, invece di un «—».
    await valuta(`(() => {
      const s = document.getElementById('sel-definizione');
      s.value = 'ampia'; s.dispatchEvent(new Event('change')); return true;
    })()`);
    await attendi(300);
    const conCorso = await statoSoloCorso();
    verifica('con una colonna corso le domande solo-corso compaiono nei filtri',
      conCorso.visibile, JSON.stringify(conCorso).slice(0, 120));
    verifica('ACSAI: 31,8% lavora ed e\' iscritto alla magistrale; l\'ateneo dice «solo per i corsi»',
      conCorso.celle?.[0] === '31,8' && conCorso.celle?.[1] === 'solo per i corsi' &&
      conCorso.titolo.includes('tutti i tipi di laurea'),
      JSON.stringify(conCorso.celle));
    // Stessa regola sul percorso delle domande a voce singola, che in app.js
    // e' un ramo a parte: «Altra laurea di primo livello», ACSAI 1,9.
    const vocesingola = await valuta(`(() => {
      const riga = [...document.querySelectorAll('#tabella-body tr')]
        .find(tr => tr.cells[0]?.textContent.trim() === 'Altra laurea di primo livello');
      return riga ? [...riga.cells].slice(1).map(td => td.textContent.trim()) : null;
    })()`);
    verifica('anche a voce singola: ACSAI 1,9, l\'ateneo «solo per i corsi»',
      vocesingola?.[0] === '1,9' && vocesingola?.[1] === 'solo per i corsi',
      JSON.stringify(vocesingola));
    verifica('con una colonna corso la nota conta anche la domanda solo-corso',
      conCorso.nota.includes('delle 27 domande'), conCorso.nota.slice(-90));

    // Tolta la colonna corso, spariscono di nuovo; poi ACSAI torna com'era.
    await scegliNellaPrimaColonna('sel-tipo', 'ateneo');
    await attendi(300);
    const tornatoAteneo = await statoSoloCorso();
    verifica('togliendo la colonna corso le domande solo-corso spariscono di nuovo',
      !tornatoAteneo.visibile && tornatoAteneo.celle === null,
      JSON.stringify(tornatoAteneo).slice(0, 120));
    await scegliNellaPrimaColonna('sel-tipo', 'corso');
    await scegliNellaPrimaColonna('sel-codice', '70026');
    await scegliNellaPrimaColonna('sel-corso', '0580106203100003');
    await aspettaTesta('applied computer science', 'colonna ACSAI di nuovo caricata');

    // Il numero preciso, come per Bari nella sezione 5b: un testo di colonna
    // diverso non basta, perche' cambiando definizione cambiano anche le
    // domande visibili, e passerebbe anche con la query dei corsi senza filtro.
    // Per ACSAI la riga vale 31,8 con ampia e 40,9 con restrittiva.
    const valoreAcsaiCon = async (definizione) => {
      await valuta(`(() => {
        const s = document.getElementById('sel-definizione');
        s.value = ${JSON.stringify(definizione)};
        s.dispatchEvent(new Event('change')); return true;
      })()`);
      await attendi(300);
      return valoreDellaRiga(ETICHETTA);
    };
    const acsaiAmpia = await valoreAcsaiCon('ampia');
    const acsaiRestrittiva = await valoreAcsaiCon('restrittiva');
    verifica('per ACSAI «mai lavorato» vale 31,8 con ampia e 40,9 con restrittiva',
      acsaiAmpia === '31,8' && acsaiRestrittiva === '40,9',
      `${acsaiAmpia} / ${acsaiRestrittiva}`);

    // Un ateneo mai aperto prima: Roma Tre, ing. informatica e dell'IA.
    const primaDiRomaTre = (await scaricatiCorsi()).length;
    await scegliNellaPrimaColonna('sel-codice', '70117');
    await scegliNellaPrimaColonna('sel-corso', '0580706200800002');
    await aspettaTesta('ingegneria informatica e dell', 'colonna Roma Tre caricata');
    const dopoRomaTre = await scaricatiCorsi();
    verifica('scegliendo un corso di Roma Tre si scarica solo Roma Tre, una volta',
      dopoRomaTre.length === primaDiRomaTre + 1 && dopoRomaTre.at(-1) === '70117.sqlite',
      dopoRomaTre.slice(primaDiRomaTre).join(','));
    const testaRomaTre = await testaPrimaColonna();
    verifica('la colonna mostra il suo ateneo, Roma Tre',
      testaRomaTre.includes('Roma Tre'), testaRomaTre.slice(0, 120));

    // Lo strato AI non conosce ancora i corsi: una colonna «corso» proposta
    // da un modello deve essere scartata dal validatore, non arrivare alla UI.
    const scartoAi = await valuta(`(async () => {
      const { validaQuery } = await import('./js/ai/validatore.js');
      const q = validaQuery({ colonne: [{ tipo: 'corso', codice: '0580106203100003' }], domande: [] });
      return { tenute: q.colonne.length, scartate: q.scartati.colonne.length };
    })()`);
    verifica('il validatore AI scarta le colonne di tipo corso',
      scartoAi.tenute === 0 && scartoAi.scartate === 1, JSON.stringify(scartoAi));

    // --- 9b. Un download in ritardo non cancella l'errore dell'ateneo scelto ---
    // Il caso trovato dall'ultrareview del 21 set 2026: scegli A, prima che
    // finisca passi a B, B fallisce, poi A finisce. L'errore di B deve restare,
    // anche al ridisegno dopo. Si truccano i download nella pagina: Bologna
    // (70003) lento, Politecnico di Bari (70048) in errore. Nessuno dei due
    // deve essere stato aperto prima in questo giro, altrimenti il download
    // lento non parte e il caso non si crea (Bari non va bene: passando la
    // colonna a «Corso» dalla sezione 5b, Bari si scarica gia' li').
    await valuta(`(() => {
      window.__fetchVero = window.fetch;
      window.fetch = (url, ...resto) => {
        const u = String(url);
        if (u.endsWith('corsi/70003.sqlite')) {
          return new Promise((ok) => setTimeout(ok, 1500)).then(() => window.__fetchVero(url, ...resto));
        }
        if (u.endsWith('corsi/70048.sqlite')) {
          return new Promise((_, ko) => setTimeout(() => ko(new TypeError('rete finta giu')), 100));
        }
        return window.__fetchVero(url, ...resto);
      };
      return true;
    })()`);
    const bolognaGiaAperta = await valuta(`import('./js/db-corsi.js').then((m) => m.ateneiInMemoria().includes('70003'))`);
    verifica('il caso del download in ritardo parte davvero (Bologna non ancora aperta)',
      !bolognaGiaAperta);
    await scegliNellaPrimaColonna('sel-codice', '70003');
    await scegliNellaPrimaColonna('sel-codice', '70048');
    await attendi(2500); // Bologna finisce dopo l'errore del Politecnico.
    // Un ridisegno qualunque: spegne e riaccende la prima domanda.
    await valuta(`(() => {
      const c = document.querySelector('#accordion-filtri input[type=checkbox]');
      c.click(); c.click(); return true;
    })()`);
    const testaDopoErrore = await testaPrimaColonna();
    verifica('l\'errore dell\'ateneo scelto resta dopo un download in ritardo di un altro',
      testaDopoErrore.includes('rete finta giu') && !testaDopoErrore.includes('caricamento'),
      testaDopoErrore.slice(0, 160));

    // Con la rete tornata, riscegliere lo stesso ateneo ritenta davvero.
    await valuta(`(() => { window.fetch = window.__fetchVero; return true; })()`);
    await scegliNellaPrimaColonna('sel-codice', '70048');
    await aspettaTesta('Bari Politecnico', 'Politecnico di Bari caricato al secondo tentativo');
    const testaRitentata = await testaPrimaColonna();
    verifica('riscegliendo l\'ateneo fallito il download si ritenta e l\'errore sparisce',
      !testaRitentata.includes('rete finta'), testaRitentata.slice(0, 160));

    // --- 9c. Un ateneo ancora in download non viene sfrattato dalla memoria ---
    // Sfrattarlo butterebbe il trasferimento e, tornandoci, lo si riscaricherebbe.
    const sfratto = await valuta(`(async () => {
      const m = await import('./js/db-corsi.js');
      const vero = window.fetch;
      let sblocca;
      const cancello = new Promise((ok) => { sblocca = ok; });
      window.fetch = (url, ...resto) => String(url).endsWith('corsi/70220.sqlite')
        ? cancello.then(() => vero(url, ...resto)) : vero(url, ...resto);
      const lento = m.caricaAteneoCorsi('70220');
      for (const c of ['70097', '70099', '70110', '70137', '70153']) await m.caricaAteneoCorsi(c);
      m.liberaAteneiNonUsati([]);
      const tenuto = m.ateneiInMemoria().includes('70220');
      window.fetch = vero;
      sblocca();
      await lento;
      return { tenuto, inMemoria: m.ateneiInMemoria() };
    })()`);
    verifica('liberando la memoria non si sfratta un ateneo ancora in download',
      sfratto.tenuto, sfratto.inMemoria.join(','));

    // --- 9d. Corso, ateneo e area nello stesso confronto ---
    // La pagina si ricarica (colonne di partenza: Marche Politecnica e Bari)
    // e le tre colonne si scelgono dalle tendine come farebbe un utente:
    // ACSAI, l'ateneo Sapienza e l'area Informatica e Tecnologie ICT.
    await valuta(`(() => { setTimeout(() => location.reload(), 0); return true; })()`);
    await attendi(800);
    await aspettaInPagina(valuta,
      `document.readyState === 'complete' && document.getElementById('area-app') &&
       !document.getElementById('area-app').classList.contains('nascosto') &&
       document.querySelectorAll('.colonna-scheda').length === 2`,
      'pagina ricaricata');
    await scegliDaUtente(0, 'campo-entita', 'roma sapienza');
    await scegliDaUtente(0, 'campo-corso', 'applied computer');
    await scegliDaUtente(1, 'campo-entita', 'roma sapienza');
    await valuta(`(() => { document.getElementById('btn-aggiungi-colonna').click(); return true; })()`);
    await scegliDaUtente(2, 'campo-entita', 'informatica e tec');
    await aspettaInPagina(valuta,
      `document.querySelectorAll('#tabella-head th').length === 4 &&
       !document.getElementById('tabella-head').textContent.includes('caricamento')`,
      'confronto corso, ateneo e area');
    const tuttoConfronto = await valuta(`(() => {
      const th = [...document.querySelectorAll('#tabella-head th')].slice(1).map(t => t.textContent);
      return { th, linkScheda: !!document.querySelector('.link-scheda'),
               navScheda: !!document.getElementById('tab-scheda'),
               occupati: [...document.querySelectorAll(
                 '#griglia-sintesi .paragone-riga[data-indicatore="occupati"] .paragone-numero')].map(v => v.textContent),
               avvisi: [...document.querySelectorAll('#avvisi-lista li')].map(li => li.textContent),
               avvisiVisibili: !document.getElementById('avvisi').classList.contains('nascosto') };
    })()`);
    verifica('le tendine portano al confronto con corso, ateneo e area',
      tuttoConfronto.th[0].includes('applied computer science') &&
      tuttoConfronto.th[1].includes('Roma Sapienza') &&
      tuttoConfronto.th[2].includes('Informatica e Tecnologie ICT'),
      JSON.stringify(tuttoConfronto.th).slice(0, 200));
    verifica('la scheda del corso non c\'e\' piu\': ne\' voce di navigazione ne\' link dalla colonna',
      !tuttoConfronto.navScheda && !tuttoConfronto.linkScheda, JSON.stringify(tuttoConfronto).slice(0, 80));
    // I voti dello stesso confronto: ACSAI fra i 38 triennali di Informatica
    // (sul lavoro 22 intervistati: pochi dati), Sapienza fra gli atenei,
    // l'area fra le aree.
    const votiMisti = await valuta(`({ voti: ${votiDi('#griglia-voti')},
      variante: document.querySelector('#griglia-voti .voti-riga[data-indicatore="occupati"] .voto-variante')?.textContent,
      paragone: document.getElementById('paragone-voti').textContent })`);
    verifica('voti di ACSAI, Sapienza e area ICT, ognuno fra i suoi simili',
      JSON.stringify(votiMisti.voti) === JSON.stringify({
        occupati: ['pochi-dati', '6', '8'], retribuzione: ['pochi-dati', '6', '8'],
        'primo-lavoro': ['pochi-dati', '5', '9'], efficacia: ['pochi-dati', '6', '8'],
        'in-corso': ['10', '3', '2'], rifarebbero: ['1', '5', 'tutti-uguali'],
      }), JSON.stringify(votiMisti.voti));
    verifica('per il corso la riga del lavoro dice «lavorano o studiano», e i termini sono i 38 triennali ICT',
      votiMisti.variante === 'per un corso: lavorano o studiano ancora' &&
      votiMisti.paragone.includes('Informatica e Tecnologie ICT') && votiMisti.paragone.includes('38 su quelle di studio'),
      `${votiMisti.variante} | ${votiMisti.paragone}`);
    verifica('la sintesi segue le nuove colonne: ACSAI 50,0%, Sapienza 63,9%, area 71,9%',
      JSON.stringify(tuttoConfronto.occupati) === JSON.stringify(['50,0%', '63,9%', '71,9%']),
      JSON.stringify(tuttoConfronto.occupati));
    // Corso accanto ad ateneo e area: due avvisi, i tipi di laurea mescolati
    // e il campione piccolo di ACSAI sul lavoro (22 intervistati).
    verifica('gli avvisi dicono colonne di tipo diverso e campione piccolo di ACSAI sul lavoro',
      tuttoConfronto.avvisiVisibili && tuttoConfronto.avvisi.length === 2 &&
      tuttoConfronto.avvisi[0].startsWith('Colonne di tipo diverso') &&
      tuttoConfronto.avvisi[1].includes('sul lavoro') && tuttoConfronto.avvisi[1].includes('22 intervistati'),
      JSON.stringify(tuttoConfronto.avvisi).slice(0, 200));

    // --- 9e. Una nota al posto del numero resta nella sua casella ---
    // Il caso visto da Mare l'11 ott 2026: nella sintesi della Completa
    // «Campione piccolo» sbordava sopra il valore della colonna prima. Qui
    // matematica (32) di Bari, dove AlmaLaurea nasconde «in corso» (1 caso).
    await scegliDaUtente(1, 'campo-entita', 'bari');
    await scegliDaUtente(1, 'campo-corso', 'matematica (32)');
    await aspettaInPagina(valuta,
      `document.querySelectorAll('#tabella-head th')[2]?.textContent.includes('matematica') &&
       !document.getElementById('tabella-head').textContent.includes('caricamento')`,
      'colonna matematica (32) di Bari');
    await valuta(`(() => { document.getElementById('modo').click(); return true; })()`);
    const nota = await valuta(`(() => {
      const riga = document.querySelector('#griglia-sintesi .paragone-riga[data-indicatore="in-corso"]');
      const valori = [...riga.querySelectorAll('.paragone-valore')];
      const box = valori.map(v => v.getBoundingClientRect());
      // L'ingombro delle lettere, non della loro casella: una casella stretta
      // con min-width: 0 resta dentro anche quando il testo ne esce.
      const numeri = valori.map(v => {
        const r = document.createRange();
        r.selectNodeContents(v.querySelector('.paragone-numero'));
        return r.getBoundingClientRect();
      });
      const notaEl = valori[1];
      return {
        testo: notaEl.querySelector('.paragone-numero').textContent,
        dentro: numeri.every((n, i) => n.left >= box[i].left - 0.5 && n.right <= box[i].right + 0.5),
        staccati: numeri.every((n, i) => i === 0 || numeri[i - 1].right <= n.left + 0.5),
        asterisco: getComputedStyle(notaEl.querySelector('.paragone-numero'), '::after').content,
        segnata: notaEl.classList.contains('valore-campione-piccolo'),
      };
    })()`);
    verifica('la nota «Campione piccolo» sta dentro la sua casella e non tocca la colonna accanto',
      nota.testo === 'Campione piccolo' && nota.dentro && nota.staccati, JSON.stringify(nota));
    verifica('la nota non porta l\'asterisco del campione piccolo, che vale per i numeri',
      !nota.segnata && (nota.asterisco === 'none' || nota.asterisco === 'normal'), JSON.stringify(nota));

    // --- 9f. «Scarica in Excel»: il file e' la tabella sullo schermo ---
    // Si apre la tabella, si intercetta il file al posto del download e lo si
    // rilegge qui con un lettore indipendente; ogni valore deve coincidere
    // con la cella della tabella.
    const excel = await valuta(`(async () => {
      if (document.getElementById('risultato').classList.contains('nascosto')) {
        document.getElementById('btn-confronta').click();
      }
      const vero = URL.createObjectURL;
      let blob = null, nome = null;
      URL.createObjectURL = (b) => { blob = b; return vero.call(URL, b); };
      const clickVero = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { nome = this.download; };
      const bottone = document.getElementById('btn-excel');
      const visibile = bottone.offsetParent !== null && bottone.getAttribute('aria-label') === 'Scarica in Excel (.xlsx)';
      bottone.click();
      URL.createObjectURL = vero;
      HTMLAnchorElement.prototype.click = clickVero;
      const byte = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (const b of byte) bin += String.fromCharCode(b);
      const righe = [...document.querySelectorAll('#tabella-body tr')]
        .filter(tr => !tr.classList.contains('riga-macro-categoria'))
        .map(tr => [...tr.cells].map(td => td.textContent.trim()))
        .filter(c => c.slice(1).some(x => x !== ''));
      const th = [...document.querySelectorAll('#tabella-head th')].slice(1).map(t => t.textContent);
      return { visibile, nome, tipo: blob.type, base64: btoa(bin), righe, th };
    })()`);
    const xlsx = leggiXlsx(Uint8Array.from(Buffer.from(excel.base64, 'base64')));
    verifica('il pulsante «Scarica in Excel» c\'e\' nella Completa e scarica un .xlsx',
      excel.visibile && /^confronto-almalaurea-\d{4}-\d{2}-\d{2}\.xlsx$/.test(excel.nome) &&
      excel.tipo === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `${excel.visibile} ${excel.nome} ${excel.tipo}`);
    verifica('il file ha i due fogli, Confronto e Note, e i CRC giusti',
      JSON.stringify(xlsx.fogli) === JSON.stringify(['Confronto', 'Note']) && xlsx.file.length === 7,
      JSON.stringify(xlsx));
    const lettere = ['D', 'E', 'F'];
    // L'intestazione della tabella comincia col nome della colonna; nel file
    // il corso porta in piu' il suo ateneo fra parentesi.
    const intestazioniOk = excel.th.every((t, i) => {
      const nome = String(xlsx.celle[`${lettere[i]}1`] ?? '');
      return nome !== '' && t.toLowerCase().startsWith(nome.split(' (')[0].toLowerCase());
    });
    let uguali = 0;
    const diversi = [];
    excel.righe.forEach((celle, r) => {
      celle.slice(1).forEach((testo, c) => {
        const inFile = xlsx.celle[`${lettere[c]}${r + 2}`];
        const numero = /^-?[\d.]+(,\d+)?$/.test(testo) ? Number(testo.replace(/\./g, '').replace(',', '.')) : null;
        // La tabella mostra un decimale; il file il valore pieno pubblicato
        // (0,17 nel file, «0,2» a schermo): si confronta a mezzo decimale.
        const ok = numero !== null
          ? typeof inFile === 'number' && Math.abs(inFile - numero) <= 0.05 + 1e-9
          : inFile === testo;
        if (ok) uguali++; else diversi.push(`${lettere[c]}${r + 2}: tabella «${testo}», file «${inFile}»`);
      });
    });
    verifica(`ogni cella del file coincide con la tabella (${uguali} celle, ${excel.righe.length} righe)`,
      intestazioniOk && diversi.length === 0 && uguali > 100 && xlsx.celle[`A${excel.righe.length + 2}`] === undefined,
      diversi.slice(0, 3).join(' | ') || `intestazioni ${intestazioniOk}`);
    await valuta(`(() => { document.getElementById('modo').click(); return true; })()`);

    // Il pop-up dell'AI si apre dal pulsante in testata e si chiude.
    const dialogo = await valuta(`(() => {
      const d = document.getElementById('dlg-ai');
      document.getElementById('apri-ai').click();
      const aperto = d.open && !!d.querySelector('#ai-frase') && !!d.querySelector('#ai-invia');
      document.getElementById('chiudi-ai').click();
      return { aperto, chiuso: !d.open };
    })()`);
    verifica('il pop-up dell\'AI si apre e si chiude con tutti i suoi comandi',
      dialogo.aperto && dialogo.chiuso, JSON.stringify(dialogo));

    // «Solo le principali» torna alle 8 domande.
    const principali = await valuta(`(() => {
      document.getElementById('btn-principali').click();
      return document.getElementById('conta-domande').textContent;
    })()`);
    verifica('«Solo le principali» torna alle 8 domande', principali === '8 domande scelte', principali);

    // Un vecchio link alla scheda del corso apre il confronto, non una pagina vuota.
    await valuta(`(() => { location.hash = '#scheda/70026/0580106203100003'; return true; })()`);
    await attendi(300);
    const vecchioLink = await valuta(`({
      confronto: document.getElementById('vista-confronto').offsetParent !== null,
      vistaScheda: !!document.getElementById('vista-scheda'),
    })`);
    verifica('un vecchio link #scheda/... mostra il confronto',
      vecchioLink.confronto && !vecchioLink.vistaScheda, JSON.stringify(vecchioLink));
    await valuta(`(() => { location.hash = '#confronto'; return true; })()`);

    // --- 10. Console pulita ---
    await attendi(300);
    verifica('nessun errore nella console del browser',
      scheda.erroriConsole.length === 0, scheda.erroriConsole.join(' / '));

  } finally {
    scheda?.chiudi();
    if (chrome && chrome.exitCode === null) {
      // Wait for Chrome to exit before deleting its profile, or it may still
      // be writing into the directory being removed.
      const uscito = new Promise((ok) => chrome.once('exit', ok));
      chrome.kill();
      await Promise.race([uscito, attendi(5000)]);
    }
    server?.kill();
    rmSync(PROFILO, { recursive: true, force: true });
  }

  console.log(`\n${passati} passati, ${falliti} falliti`);
  process.exit(falliti === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('ERRORE:', e.message);
  process.exit(1);
});
