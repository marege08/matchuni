const elenco = document.getElementById('clash-elenco');
const stato = document.getElementById('clash-stato');
const cerca = document.getElementById('clash-cerca');

/** Fold accents too, so a phone keyboard never prevents a match. */
const normalizza = (testo) => testo.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Use DOM text nodes because the catalogue is regenerated outside the app. */
function riquadro(clash) {
  const link = document.createElement('a');
  link.className = 'clash-riquadro';
  link.id = clash.id;
  link.href = `../?c=corso:${encodeURIComponent(clash.a.ateneo)}:${encodeURIComponent(clash.a.corso)}&c=corso:${encodeURIComponent(clash.b.ateneo)}:${encodeURIComponent(clash.b.corso)}&da=clash`;
  for (const [tag, testo] of [['h2', clash.titolo], ['p', `${clash.a.nome} o ${clash.b.nome}`], ['small', clash.tipo]]) {
    const nodo = document.createElement(tag);
    nodo.textContent = testo;
    link.append(nodo);
  }
  link.dataset.ricerca = normalizza(`${clash.titolo} ${clash.a.nome} ${clash.b.nome}`);
  return link;
}

/** Fetch only the catalogue; this page needs neither sql.js nor databases. */
async function avvia() {
  try {
    const risposta = await fetch('elenco.json');
    if (!risposta.ok) throw new Error('catalogue unavailable');
    const dati = await risposta.json();
    const clash = Array.isArray(dati.clash) ? dati.clash : [];
    elenco.replaceChildren(...clash.map(riquadro));
    stato.textContent = clash.length ? '' : 'Non ci sono ancora Clash.';
    cerca.addEventListener('input', () => {
      const termine = normalizza(cerca.value.trim());
      for (const link of elenco.children) link.hidden = !link.dataset.ricerca.includes(termine);
      stato.textContent = [...elenco.children].some((link) => !link.hidden) ? '' : 'Nessun Clash trovato.';
    });
    // The anchor may have been requested before the asynchronous list existed.
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  } catch {
    stato.replaceChildren(document.createTextNode('Non riesco a caricare i Clash. '));
    const home = document.createElement('a');
    home.href = '../';
    home.textContent = 'Vai alla home';
    stato.append(home);
  }
}
avvia();
