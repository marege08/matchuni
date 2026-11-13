// Test del voto da 0 a 10 (js/voto.js). Eseguibile con: node backend/tests/test-voto.mjs
// Prima i casi costruiti a mano (rango, pari, soglie), poi i voti veri del
// confronto ACSAI (Sapienza) contro Ingegneria informatica e dell'IA (Roma
// Tre), calcolati sui termini di paragone generati (js/termini-paragone.js).

import {
  calcolaVoto,
  fraseVoto,
  quantile,
  SOGLIA_RISPONDENTI,
  MIN_TERMINI,
} from '../../frontend/public/js/voto.js';
import { TERMINI_PARAGONE } from '../../frontend/public/js/termini-paragone.js';
import { INDICATORI_CRUSCOTTO } from '../../frontend/public/js/indicatori-chiave.js';

let falliti = 0;
function ok(cond, msg, dettaglio) {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg + (cond || dettaglio === undefined ? '' : `  -> ${JSON.stringify(dettaglio)}`));
  if (!cond) falliti++;
}

// --- Casi costruiti: venti valori da 1 a 20 ---
const venti = Array.from({ length: 20 }, (_, i) => i + 1);
const base = { rispondenti: 100, termini: venti, unita: '%' };

ok(calcolaVoto({ ...base, valore: 20 }).voto === 10, 'il valore piu\' alto prende 10');
ok(calcolaVoto({ ...base, valore: 1 }).voto === 0, 'il valore piu\' basso prende 0');
// 15 batte 14 valori e pareggia con se stesso: (14 + 0,5) / 20 = 0,725 -> 7.
ok(calcolaVoto({ ...base, valore: 15 }).voto === 7, 'rango medio: 15 su 1..20 fa 7');
ok(calcolaVoto({ ...base, valore: 15, meglioBasso: true }).voto === 3,
  'quando conta il piu\' basso il voto si rovescia: 15 su 1..20 fa 3');
ok(calcolaVoto({ ...base, valore: 15 }).termini === 20, 'dice su quanti termini ha contato');
ok(calcolaVoto({ ...base, termini: [...venti].reverse(), valore: 15 }).voto === 7,
  'l\'ordine dei termini non conta');

ok(calcolaVoto({ ...base, valore: null }).motivo === 'assente', 'valore assente: niente voto');
const pochi = calcolaVoto({ ...base, valore: 15, rispondenti: SOGLIA_RISPONDENTI - 1 });
ok(calcolaVoto({ ...base, valore: 15, rispondenti: 20 }).motivo === 'pochi-dati',
  'senza soglia, 20 rispondenti non bastano');
ok(calcolaVoto({ ...base, valore: 15, rispondenti: 20, soglia: 15 }).voto === 7,
  'con la soglia delle magistrali (15), 20 rispondenti bastano');
ok(calcolaVoto({ ...base, valore: 15, rispondenti: 14, soglia: 15 }).motivo === 'pochi-dati',
  'con la soglia a 15, 14 rispondenti non bastano');
ok(pochi.motivo === 'pochi-dati' && pochi.rispondenti === 39, 'sotto i 40 rispondenti: niente voto', pochi);
ok(calcolaVoto({ ...base, valore: 15, rispondenti: SOGLIA_RISPONDENTI }).voto === 7,
  'a 40 rispondenti esatti il voto c\'e\'');
ok(calcolaVoto({ ...base, valore: 15, rispondenti: undefined }).motivo === 'pochi-dati',
  'rispondenti sconosciuti: niente voto');
const pochiTermini = calcolaVoto({ ...base, valore: 5, termini: venti.slice(0, MIN_TERMINI - 1) });
ok(pochiTermini.motivo === 'pochi-termini' && pochiTermini.termini === 14,
  'con 14 termini di paragone niente voto', pochiTermini);
ok(calcolaVoto({ ...base, valore: 5, termini: venti.slice(0, MIN_TERMINI) }).voto !== undefined,
  'con 15 termini (i gruppi sono 15) il voto c\'e\'');

// Quasi tutti uguali: fra il 10° e il 90° percentile meno di 10 punti.
const piatti = Array.from({ length: 20 }, (_, i) => 90 + i * 0.4);
const uguali = calcolaVoto({ valore: 95, rispondenti: 100, termini: piatti, unita: '%' });
ok(uguali.motivo === 'tutti-uguali' && uguali.basso === quantile(piatti, 0.1) && uguali.alto === quantile(piatti, 0.9),
  'percentuali tutte fra 90 e 98: niente voto, con gli estremi', uguali);
ok(calcolaVoto({ valore: 95, rispondenti: 100, termini: piatti, unita: 'voto' }).voto !== undefined,
  'un\'unita\' senza soglia di differenza non e\' mai piatta');
ok(calcolaVoto({ valore: 1200, rispondenti: 100, termini: venti.map(v => 1100 + v * 5), unita: 'euro' }).motivo === 'tutti-uguali',
  'stipendi tutti dentro 100 euro: niente voto');

ok(fraseVoto(7, { uno: 'corso', molti: 'corsi' }) === 'meglio di 7 corsi su 10', 'frase: meglio di 7 corsi su 10');
ok(fraseVoto(1, { uno: 'corso', molti: 'corsi' }) === 'meglio di 1 corso su 10', 'frase al singolare per 1');
ok(fraseVoto(10, { uno: 'ateneo', molti: 'atenei' }) === 'tra i migliori atenei', 'frase per 10');
ok(fraseVoto(0, { uno: 'ateneo', molti: 'atenei' }) === 'tra gli ultimi atenei', 'frase per 0');

// --- Il file generato corrisponde agli indicatori chiave ---
const generati = TERMINI_PARAGONE.indicatori.map((i) => `${i.id}|${i.indagine}|${i.categoria}|${i.indicatore}`);
const chiave = INDICATORI_CRUSCOTTO.map((i) => `${i.id}|${i.indagine}|${i.categoria}|${i.indicatore}`);
ok(JSON.stringify(generati) === JSON.stringify(chiave),
  'termini-paragone.js e indicatori-chiave.js parlano degli stessi indicatori');
ok(TERMINI_PARAGONE.soglia === SOGLIA_RISPONDENTI, 'il generatore usa la stessa soglia di 40');

// --- Voti veri: ACSAI contro Roma Tre ing. informatica e IA (definizione ampia) ---
// Valori e rispondenti letti da corsi/70026.sqlite e corsi/70117.sqlite;
// i termini sono i triennali dei gruppi 10 (Informatica e Tecnologie ICT) e
// 12 (Ingegneria industriale e dell'informazione) con almeno 40 risposte.
const terminiDi = (id, indagine) => {
  const sorgente = indagine === 'profilo'
    ? TERMINI_PARAGONE.valori.profilo[id]
    : TERMINI_PARAGONE.valori.occupazione.ampia[id];
  return [...(sorgente['10'] ?? []), ...(sorgente['12'] ?? [])];
};
const unitaDi = Object.fromEntries(INDICATORI_CRUSCOTTO.map((i) => [i.id, i]));
const votoVero = (id, valore, rispondenti) => calcolaVoto({
  valore, rispondenti, termini: terminiDi(id, unitaDi[id]?.indagine ?? 'occupazione'),
  unita: unitaDi[id]?.unita ?? '%', meglioBasso: unitaDi[id]?.meglioBasso,
});

ok(terminiDi('retribuzione', 'occupazione').length === 152 && terminiDi('rifarebbero', 'profilo').length === 192,
  'gruppi 10 e 12: 152 corsi sul lavoro, 192 sullo studio');
ok(votoVero('retribuzione', 1318, 92).voto === 6, 'Roma Tre ing.: retribuzione 1.318 euro fa 6');
ok(votoVero('primo-lavoro', 4.3, 92).voto === 2, 'Roma Tre ing.: 4,3 mesi per il primo lavoro fa 2');
ok(votoVero('efficacia', 66.7, 92).voto === 8, 'Roma Tre ing.: efficacia 66,7% fa 8');
ok(votoVero('in-corso', 40.6, 160).voto === 3, 'Roma Tre ing.: 40,6% in corso fa 3');
ok(votoVero('rifarebbero', 76.3, 160).voto === 6, 'Roma Tre ing.: 76,3% rifarebbero fa 6');
ok(votoVero('in-corso', 65.6, 52).voto === 9, 'ACSAI: 65,6% in corso fa 9');
ok(votoVero('rifarebbero', 63.5, 52).voto === 1, 'ACSAI: 63,5% rifarebbero fa 1');
ok(votoVero('retribuzione', 1291, 22).motivo === 'pochi-dati', 'ACSAI sul lavoro (22 intervistati): pochi dati');
const lavoraStudia = calcolaVoto({ valore: 98.9, rispondenti: 92, termini: terminiDi('lavora-studia', 'occupazione'), unita: '%' });
ok(lavoraStudia.motivo === 'tutti-uguali' && Math.round(lavoraStudia.basso) === 94 && lavoraStudia.alto === 100,
  'lavorano o studiano: quasi tutti fra 94 e 100, niente voto', lavoraStudia);
ok(!TERMINI_PARAGONE.valori.occupazione.restrittiva['lavora-studia'],
  'con la restrittiva AlmaLaurea non pubblica «lavorano o studiano» per i corsi');

console.log(`\n${falliti === 0 ? 'Tutto ok' : falliti + ' falliti'}`);
process.exit(falliti === 0 ? 0 : 1);
