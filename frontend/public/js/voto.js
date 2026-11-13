// voto.js
//
// The 0-10 score of the Base view. Some readers give up in front of a
// percentage, so the Base view says where a value stands instead of what it
// is: "better than 7 out of 10 comparable courses". The score is exactly that
// sentence, with no hidden weights: the share of comparable sheets the value
// beats, in tenths.
//
// A score is shown only when it can be honest. It is withheld when the sheet
// has too few respondents (its own value is unstable), when there are too few
// comparable sheets to rank against, and when the comparable sheets are
// almost all equal, where ranking would turn differences of a point into
// differences of several tenths. The Complete view always shows the
// published values.
//
// This module touches neither the DOM nor the databases: the caller passes
// the value and the list it is ranked against.

/** Respondents below which a value is too unstable to score, as in app.js. */
export const SOGLIA_RISPONDENTI = 40;

// Master's degrees (Mare, 13 nov 2026): they have fewer graduates and some are
// very niche, so a master's course gets a score from this many respondents;
// between this and SOGLIA_RISPONDENTI the page warns above the scores that
// the sample is small.
export const SOGLIA_MAGISTRALI = 15;

/** Comparable sheets needed for a rank to mean something: all 15 groups qualify. */
export const MIN_TERMINI = 15;

/**
 * Spread between the 10th and 90th percentile of the comparable values below
 * which they count as almost all equal, by unit. A unit not listed is never
 * treated as flat.
 */
export const DIFFERENZA_MINIMA = { '%': 10, euro: 150, mesi: 1 };

/**
 * Returns the value at a fraction of a sorted list (nearest rank).
 *
 * @param {number[]} ordinati - Values in ascending order, not empty.
 * @param {number} frazione - Between 0 and 1.
 * @returns {number} Value at that position.
 */
export function quantile(ordinati, frazione) {
  return ordinati[Math.round(frazione * (ordinati.length - 1))];
}

/**
 * @typedef {object} EsitoVoto
 * @property {number} [voto] - Score from 0 to 10, when there is one.
 * @property {'assente'|'pochi-dati'|'pochi-termini'|'tutti-uguali'} [motivo] - Why there is no score.
 * @property {number} [termini] - How many values the score was ranked against.
 * @property {number} [rispondenti] - Respondents, for 'pochi-dati'.
 * @property {number} [basso] - 10th percentile of the comparable values, for 'tutti-uguali'.
 * @property {number} [alto] - 90th percentile of the comparable values, for 'tutti-uguali'.
 */

/**
 * Scores a value against the values of comparable sheets.
 *
 * The rank is the mid-rank: values beaten count one, ties count half. The
 * list may include the scored sheet itself, as it does when the sheet is
 * among the comparable ones; it is then a tie with itself and counts half.
 *
 * @param {object} p - Parameters.
 * @param {number|null|undefined} p.valore - Value of the sheet.
 * @param {number|null|undefined} p.rispondenti - Respondents behind the value.
 * @param {number[]} p.termini - Values of the comparable sheets.
 * @param {string} p.unita - Unit of the indicator ('%', 'euro', 'mesi', ...).
 * @param {boolean} [p.meglioBasso] - Whether a lower value is better (waiting times).
 * @param {number} [p.soglia] - Respondents needed for a score (default SOGLIA_RISPONDENTI).
 * @returns {EsitoVoto} Score, or the reason there is none.
 */
export function calcolaVoto({
  valore, rispondenti, termini, unita, meglioBasso = false, soglia = SOGLIA_RISPONDENTI,
}) {
  if (valore === null || valore === undefined) return { motivo: 'assente' };
  if (rispondenti === null || rispondenti === undefined || rispondenti < soglia) {
    return { motivo: 'pochi-dati', rispondenti: rispondenti ?? 0 };
  }
  const ordinati = [...termini].sort((a, b) => a - b);
  if (ordinati.length < MIN_TERMINI) return { motivo: 'pochi-termini', termini: ordinati.length };
  const basso = quantile(ordinati, 0.1);
  const alto = quantile(ordinati, 0.9);
  if (alto - basso < (DIFFERENZA_MINIMA[unita] ?? 0)) {
    return { motivo: 'tutti-uguali', basso, alto, termini: ordinati.length };
  }
  let battuti = 0;
  let pari = 0;
  for (const t of ordinati) {
    if (t === valore) pari++;
    else if (meglioBasso ? t > valore : t < valore) battuti++;
  }
  return {
    voto: Math.round((10 * (battuti + pari / 2)) / ordinati.length),
    termini: ordinati.length,
  };
}

/**
 * Returns the sentence a score stands for.
 *
 * @param {number} voto - Score from 0 to 10.
 * @param {{uno:string, molti:string}} nome - What is compared, e.g. { uno: 'corso', molti: 'corsi' }.
 * @returns {string} Sentence, e.g. "meglio di 7 corsi su 10".
 */
export function fraseVoto(voto, nome) {
  if (voto >= 10) return `tra i migliori ${nome.molti}`;
  if (voto <= 0) return `tra gli ultimi ${nome.molti}`;
  return `meglio di ${voto} ${voto === 1 ? nome.uno : nome.molti} su 10`;
}
