// tendina.js
//
// A dropdown drawn by the page instead of the browser. The native <select>
// pop-up cannot be styled, and with up to 133 courses per university a list
// without search is hard to use. The dropdown behaves like a select from the
// keyboard: arrows move, Enter chooses, Escape closes and returns focus, Tab
// leaves. With a search field the focus stays in the field and the active
// option is announced through aria-activedescendant.
//
// Option texts are inserted as text, never as HTML: course names come from an
// external source.
//
// Two ways to use it:
//   creaTendina()    a dropdown whose options and value come from callbacks;
//   potenziaSelect() draws a dropdown over an existing <select>, which stays
//                    in the page, hidden, as the source of truth: choosing an
//                    option sets its value and dispatches "change", so code
//                    that listens to the select keeps working unchanged.

let contatore = 0;
let aperta = null;

/**
 * Lower-cases a string and strips its accents, so "universita" finds
 * "università".
 *
 * @param {string} testo - Text to normalize.
 * @returns {string} Normalized text.
 */
const normalizza = (testo) => testo.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Creates a small stroked icon.
 *
 * @param {string} classe - CSS class.
 * @param {string[]} tracciati - SVG path data.
 * @param {object} [extra] - Extra shapes as [tag, attributes] pairs.
 * @returns {SVGSVGElement} Icon, hidden from assistive technology.
 */
function icona(classe, tracciati, extra = []) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', classe);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of tracciati) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  for (const [tag, attributi] of extra) {
    const forma = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attributi)) forma.setAttribute(k, v);
    svg.append(forma);
  }
  return svg;
}

/**
 * Appends a text to an element, underlining the part that matches a search.
 *
 * @param {HTMLElement} nodo - Element to fill.
 * @param {string} testo - Option text.
 * @param {string} filtro - Normalized search text, possibly empty.
 */
function testoEvidenziato(nodo, testo, filtro) {
  const i = filtro ? normalizza(testo).indexOf(filtro) : -1;
  if (i < 0) {
    nodo.append(testo);
    return;
  }
  // Normalization keeps one character per character for Italian text, so
  // the index found in the normalized string is valid in the original.
  const mark = document.createElement('mark');
  mark.textContent = testo.slice(i, i + filtro.length);
  nodo.append(testo.slice(0, i), mark, testo.slice(i + filtro.length));
}

/** Closes the open dropdown, if any. */
export function chiudiTendina(rimettiFuoco = false) {
  if (!aperta) return;
  const { campo, bottone, pannello } = aperta;
  aperta = null;
  campo.classList.remove('aperta');
  bottone.setAttribute('aria-expanded', 'false');
  pannello.remove();
  if (rimettiFuoco) bottone.focus();
}

document.addEventListener('pointerdown', (evento) => {
  if (aperta && !aperta.campo.contains(evento.target)) chiudiTendina(false);
});

/**
 * @typedef {object} OpzioneTendina
 * @property {string} valore - Value passed to `scegli`.
 * @property {string} testo - Visible text.
 * @property {string} [nota] - Smaller second line.
 * @property {string} [sezione] - Heading shown above this option when it differs from the previous one.
 * @property {boolean} [disattiva] - Shown but not selectable.
 */

/**
 * Creates a dropdown field: a small label, a button with the current value,
 * and on click a panel with the options.
 *
 * @param {object} p - Parameters.
 * @param {string} p.etichetta - Label above the value, also the accessible name.
 * @param {() => OpzioneTendina[]} p.opzioni - Options, read every time the panel opens.
 * @param {() => string} p.valore - Current value.
 * @param {() => string} p.testo - Text of the current value.
 * @param {(valore: string) => void} p.scegli - Called when the user picks a different value.
 * @param {boolean} [p.cerca] - Show a search field.
 * @param {string} [p.segnaposto] - Placeholder of the search field.
 * @param {string} [p.classe] - Extra CSS classes for the field.
 * @returns {{elemento: HTMLElement, aggiorna: () => void, apri: () => void}} The field, a function that
 *   refreshes the shown value, and one that opens the panel.
 */
export function creaTendina({ etichetta, opzioni, valore, testo, scegli, cerca = false, segnaposto = 'Cerca…', classe = '' }) {
  const id = `tendina-${++contatore}`;
  const campo = document.createElement('div');
  campo.className = `campo tendina-campo ${classe}`.trim();

  const nomeCampo = document.createElement('span');
  nomeCampo.className = 'campo-etichetta';
  nomeCampo.id = `${id}-etichetta`;
  nomeCampo.textContent = etichetta;

  const bottone = document.createElement('button');
  bottone.type = 'button';
  bottone.className = 'tendina-bottone';
  bottone.setAttribute('role', 'combobox');
  bottone.setAttribute('aria-haspopup', 'listbox');
  bottone.setAttribute('aria-expanded', 'false');
  bottone.setAttribute('aria-controls', `${id}-lista`);
  const valoreVisibile = document.createElement('span');
  valoreVisibile.className = 'tendina-valore';
  valoreVisibile.id = `${id}-valore`;
  bottone.setAttribute('aria-labelledby', `${nomeCampo.id} ${valoreVisibile.id}`);
  bottone.append(valoreVisibile, icona('tendina-freccia', ['m6 9 6 6 6-6']));
  campo.append(nomeCampo, bottone);

  const aggiorna = () => { valoreVisibile.textContent = testo(); };

  function apri() {
    chiudiTendina(false);
    const tutte = opzioni();
    const attuale = valore();

    const pannello = document.createElement('div');
    pannello.className = 'tendina';
    const lista = document.createElement('ul');
    lista.className = 'tendina-lista';
    lista.id = `${id}-lista`;
    lista.setAttribute('role', 'listbox');
    lista.setAttribute('aria-labelledby', nomeCampo.id);
    const vuota = document.createElement('p');
    vuota.className = 'tendina-vuota';
    vuota.textContent = 'Nessun risultato';
    vuota.hidden = true;

    let input = null;
    if (cerca) {
      const riga = document.createElement('div');
      riga.className = 'tendina-cerca';
      input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-controls', lista.id);
      // The ellipsis belongs to the visible hint, not to the spoken name.
      input.setAttribute('aria-label', segnaposto.replace(/…$/, ''));
      input.placeholder = segnaposto;
      input.autocomplete = 'off';
      input.spellcheck = false;
      riga.append(icona('tendina-lente', ['m20 20-3.5-3.5'], [['circle', { cx: 11, cy: 11, r: 7 }]]), input);
      pannello.append(riga);
    }
    pannello.append(lista, vuota);
    const conFuoco = input ?? lista;

    let visibili = [];
    let attiva = -1;
    let nodi = [];

    function segnaAttiva() {
      nodi.forEach((li, k) => li.classList.toggle('attiva', k === attiva));
      const li = nodi[attiva];
      if (li) {
        conFuoco.setAttribute('aria-activedescendant', li.id);
        li.scrollIntoView({ block: 'nearest' });
      } else {
        conFuoco.removeAttribute('aria-activedescendant');
      }
    }

    function disegna(filtroGrezzo) {
      const filtro = normalizza(filtroGrezzo.trim());
      visibili = tutte.filter((o) => !filtro || normalizza(o.testo).includes(filtro));
      nodi = [];
      const elementi = [];
      let sezione = null;
      visibili.forEach((o, k) => {
        if (o.sezione && o.sezione !== sezione) {
          sezione = o.sezione;
          const titolo = document.createElement('li');
          titolo.className = 'tendina-sezione';
          titolo.setAttribute('role', 'presentation');
          titolo.textContent = o.sezione;
          elementi.push(titolo);
        }
        const li = document.createElement('li');
        li.id = `${id}-opzione-${k}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(o.valore === attuale));
        if (o.disattiva) li.setAttribute('aria-disabled', 'true');
        li.dataset.indice = String(k);
        const nome = document.createElement('span');
        nome.className = 'tendina-testo';
        testoEvidenziato(nome, o.testo, filtro);
        li.append(nome);
        if (o.valore === attuale) li.append(icona('tendina-spunta', ['m5 12 5 5 9-10']));
        if (o.nota) {
          const nota = document.createElement('small');
          nota.textContent = o.nota;
          li.append(nota);
        }
        nodi.push(li);
        elementi.push(li);
      });
      lista.replaceChildren(...elementi);
      vuota.hidden = visibili.length > 0;
      attiva = visibili.findIndex((o) => o.valore === attuale && !o.disattiva);
      if (attiva < 0) attiva = visibili.findIndex((o) => !o.disattiva);
      segnaAttiva();
    }

    function muovi(passo) {
      for (let k = attiva, n = 0; n < visibili.length; n++) {
        k = (k + passo + visibili.length) % visibili.length;
        if (!visibili[k].disattiva) { attiva = k; break; }
      }
      segnaAttiva();
    }

    function conferma(k) {
      const o = visibili[k];
      if (!o || o.disattiva) return;
      chiudiTendina(true);
      if (o.valore !== attuale) scegli(o.valore);
      aggiorna();
    }

    // Keep the focus in the search field while clicking an option.
    lista.addEventListener('pointerdown', (e) => e.preventDefault());
    lista.addEventListener('click', (e) => {
      const li = e.target.closest('li[role="option"]');
      if (li) conferma(Number(li.dataset.indice));
    });
    lista.addEventListener('pointermove', (e) => {
      const li = e.target.closest('li[role="option"]');
      const k = li ? Number(li.dataset.indice) : -1;
      if (k >= 0 && k !== attiva && !visibili[k].disattiva) { attiva = k; segnaAttiva(); }
    });
    conFuoco.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); muovi(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); muovi(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); conferma(attiva); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); chiudiTendina(true); }
      else if (e.key === 'Tab') chiudiTendina(false);
    });
    if (input) input.addEventListener('input', () => disegna(input.value));
    else lista.tabIndex = -1;

    campo.classList.add('aperta');
    bottone.setAttribute('aria-expanded', 'true');
    campo.append(pannello);
    aperta = { campo, bottone, pannello };
    // A field near the right edge opens its panel leftwards instead of
    // pushing past the window, or past the pop-up it sits in: there it would
    // make the pop-up scroll sideways. Measured before the options are drawn,
    // because showing the chosen one scrolls the pop-up to it.
    const bordo = campo.closest('dialog')?.getBoundingClientRect().right ?? document.documentElement.clientWidth;
    if (pannello.getBoundingClientRect().right > bordo - 8) {
      pannello.classList.add('a-destra');
    }
    disegna('');
    // On a touch screen focusing the search field would pop up the keyboard
    // over the list: the field gets the focus only when it is tapped.
    if (!(input && matchMedia('(pointer: coarse)').matches)) conFuoco.focus();
  }

  bottone.addEventListener('click', () => (campo.classList.contains('aperta') ? chiudiTendina(true) : apri()));
  bottone.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); apri(); }
  });
  aggiorna();
  return { elemento: campo, aggiorna, apri };
}

/**
 * Draws a dropdown over an existing <select>, which stays as the source of
 * truth: hidden, but still holding the value and dispatching "change".
 *
 * The shown value follows the select when its options are replaced and when
 * a "change" event is dispatched on it. Code that sets `select.value` without
 * dispatching an event must call the returned `aggiorna`.
 *
 * @param {HTMLSelectElement} select - Select to draw over.
 * @param {object} p - Parameters.
 * @param {string} p.etichetta - Label of the field.
 * @param {boolean} [p.cerca] - Show a search field.
 * @param {string} [p.segnaposto] - Placeholder of the search field.
 * @param {string} [p.classe] - Extra CSS classes for the field.
 * @returns {{elemento: HTMLElement, aggiorna: () => void}} The field and its refresh function.
 */
export function potenziaSelect(select, { etichetta, cerca = false, segnaposto, classe }) {
  const tendina = creaTendina({
    etichetta,
    cerca,
    segnaposto,
    classe,
    opzioni: () => [...select.options].map((o) => ({ valore: o.value, testo: o.textContent, disattiva: o.disabled })),
    valore: () => select.value,
    testo: () => select.selectedOptions[0]?.textContent ?? '',
    scegli: (v) => {
      select.value = v;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
  });
  select.hidden = true;
  select.tabIndex = -1;
  select.after(tendina.elemento);
  select.addEventListener('change', tendina.aggiorna);
  new MutationObserver(tendina.aggiorna).observe(select, { childList: true, subtree: true });
  return tendina;
}
