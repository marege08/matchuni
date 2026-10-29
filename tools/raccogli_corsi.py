#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Raccoglie le schede a livello di CORSO, un ateneo per volta e in modo ripartibile.

PERCHE' ESISTE, visto che c'e' gia' esegui_harvest.py
---------------------------------------------------
`esegui_harvest.py` scarica gli aggregati: 93 selezioni, una manciata di minuti,
tutto in un file solo. I corsi sono un altro ordine di grandezza — ~4.000 corsi
per 2 indagini, cioe' ~8.000 richieste, misurate a ~2,3 s l'una: sei o sette ore.
Due conseguenze, e da entrambe nasce questo file:

  1. NON ENTRA IN UNA SESSIONE SOLA. Serve poter fermare e riprendere senza
     ricominciare. `esegui()` e' idempotente ma non salta niente: rilanciarlo
     riscarica tutto. Qui invece cosa e' gia' in cassaforte sta scritto NEL
     database stesso (tabelle `_corsi` e `_fatte`), quindi una ripartenza
     riprende da dove eravamo anche a distanza di giorni, e anche se nel
     frattempo la macchina si e' spenta.

  2. UN DATABASE PER ATENEO. Tutti i corsi in un file solo pesano ~483 MB, e il
     sito carica il database DENTRO IL BROWSER: sarebbe la morte dell'architettura
     a costo zero. Spezzando per ateneo si scende a ~8 MB l'uno, scaricati solo
     quando quell'ateneo entra davvero in una colonna. Non e' una forzatura: e'
     gia' la forma del codice (`interrogaScheda()` interroga un ateneo per
     colonna) e della fonte (AlmaLaurea vuole `pa`=<ateneo> per elencare i corsi).

EDUCAZIONE VERSO LA FONTE
-------------------------
Sono migliaia di richieste da un IP solo. La pausa predefinita qui e' **2 secondi**,
non 1 come nell'harvest degli aggregati, e c'e' `--max-minuti` per fermarsi da
solo. Il `User-Agent` dichiara il progetto (vedi scarica.py). Non togliere la
pausa per fare prima: il sito e' di qualcun altro.

USO
---
    python3 tools/raccogli_corsi.py --atenei 70003,70055 --out /tmp/corsi
    python3 tools/raccogli_corsi.py --primi 5 --max-minuti 90
    python3 tools/raccogli_corsi.py --atenei 70003 --solo-scoperta
    python3 tools/raccogli_corsi.py --primi 78 --corstipo LSE --out ~/Documents/AlmaLaurea-raccolta-ciclo-unico

Si lancia da qualunque cartella: i percorsi partono dalla radice del repository.

TIPI DI CORSO
-------------
`--corstipo` sceglie quali corsi: `L` triennali (il default, quelli del sito),
`LSE` magistrali a ciclo unico, `LS` magistrali biennali. Ogni tipo vuole la
SUA cartella (`--out` obbligatorio fuori da `L`): il registro `_scoperta` non
sa di che tipo era una scoperta, quindi nei database delle triennali tutti i
gruppi risulterebbero gia' interrogati e il ciclo unico verrebbe saltato in
silenzio.
"""

import argparse
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

RADICE = Path(__file__).resolve().parent.parent

# Stessa acrobazia di esegui_harvest.py: i moduli del progetto vivono in due
# cartelle e si importano per nome.
for _cartella in (RADICE / "tools", RADICE / "backend" / "src"):
    if str(_cartella) not in sys.path:
        sys.path.insert(0, str(_cartella))

from harvest import ATENEI, GRUPPI, INDAGINI, genera_corsi, params_tendine  # noqa: E402
from salva import apri_db, salva_righe  # noqa: E402
from scarica import leggi_tendine, raccogli_scheda, scarica_scheda  # noqa: E402

PAUSA_PREDEFINITA = 2.0
CARTELLA_PREDEFINITA = RADICE / "backend" / "backup-db" / "corsi"
TIPI_CORSO = ("L", "LSE", "LS")  # i valori della tendina `corstipo` di AlmaLaurea

# Il registro di cosa e' gia' fatto vive DENTRO il database dell'ateneo, non in
# un file di stato a fianco: cosi' il database e' autosufficiente e non puo'
# desincronizzarsi da un registro esterno che qualcuno sposta o cancella.
SCHEMA_REGISTRO = """
CREATE TABLE IF NOT EXISTS _corsi (
    ateneo TEXT NOT NULL,
    gruppo TEXT NOT NULL,
    codice TEXT NOT NULL,
    nome   TEXT NOT NULL,
    PRIMARY KEY (ateneo, codice)   -- lo stesso corso puo' comparire in due
);                                 -- gruppi: si tiene la prima occorrenza

CREATE TABLE IF NOT EXISTS _fatte (
    chiave TEXT PRIMARY KEY,       -- "<ateneo>/<corso>/<indagine>"
    righe  INTEGER NOT NULL,
    quando TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _scoperta (
    ateneo TEXT NOT NULL,
    gruppo TEXT NOT NULL,
    quando TEXT NOT NULL,
    PRIMARY KEY (ateneo, gruppo)   -- un gruppo gia' interrogato non si ripete
);

CREATE TABLE IF NOT EXISTS _inesistenti (
    chiave TEXT PRIMARY KEY,       -- "<ateneo>/<corso>/<indagine>"
    quando TEXT NOT NULL           -- schede che AlmaLaurea dice di non avere
);

CREATE TABLE IF NOT EXISTS _scoperta_dubbia (
    ateneo  TEXT NOT NULL,
    gruppo  TEXT NOT NULL,
    codice  TEXT NOT NULL,         -- il codice HTTP dell'ultimo tentativo
    quando  TEXT NOT NULL,
    PRIMARY KEY (ateneo, gruppo)   -- gruppi chiusi SENZA una risposta buona
);
"""

# visualizza.php risponde HTTP 400 in due casi che col solo codice non si
# distinguono, e che vanno trattati all'opposto:
#   - "Parametri di interrogazione non coerenti": la scheda NON ESISTE (per
#     esempio l'indagine occupazione su un corso senza intervistati). Ritentarla
#     e' inutile, per sempre.
#   - "Impossibile connettersi": un guasto passeggero dei server di AlmaLaurea.
#     Visto il 15 set 2026 su intere colonne di atenei, rientrato dopo pochi
#     minuti. Va ritentato come qualunque altro fallimento.
# Quindi decide il testo della pagina, e solo il primo caso finisce in
# `_inesistenti`: nel dubbio una scheda resta "fallita", cioe' si ritenta.
SEGNO_INESISTENTE = "Parametri di interrogazione non coerenti"

# solotendine.php, invece, NON ha un testo da leggere: quando rifiuta una
# coppia ateneo x gruppo risponde HTTP 500 con il CORPO VUOTO (0 byte,
# verificato il 19 set 2026 su 70117/10). Quindi qui la regola di
# `scheda_inesistente()` non e' applicabile: non c'e' niente da distinguere
# nel testo, e il solo codice HTTP non dice se il gruppo e' vuoto davvero o se
# il sito sta avendo un guasto.
#
# Il discriminante e' la RIPETIZIONE: un vuoto vero e' stabile, un guasto no.
# Misurato il 19 set 2026 — i 98 gruppi che avevano dato 500 nei blocchi 3 e 4,
# ripassati a giorni di distanza, hanno rifatto 500 tutti e 98, e nessuno
# nascondeva corsi veri. Quindi: si riprova sul posto qualche volta, e se
# l'esito non cambia il gruppo si chiude (se no nessun ateneo si chiuderebbe
# mai e ogni blocco sprecherebbe tempo sugli stessi buchi) — ma la chiusura
# viene REGISTRATA in `_scoperta_dubbia`, cosi' quello che prima spariva in
# silenzio diventa una lista che si puo' ripassare con `--verifica-dubbie`.
# Le attese sono corte di proposito. Le ripetizioni servono ad assorbire il
# COLPO DI TOSSE (un 503 di pochi secondi); un guasto vero dura minuti e non
# lo prenderebbe nessuna attesa ragionevole — per quello c'e' `_scoperta_dubbia`.
# Allungarle costerebbe solo tempo: ogni gruppo vuoto le paga tutte, e i gruppi
# vuoti sono circa un quinto del totale.
TENTATIVI_SCOPERTA = 3           # il primo piu' due ripetizioni
ATTESE_SCOPERTA = (3.0, 9.0)     # quanto si aspetta prima di ognuna


def scheda_inesistente(errore):
    """Vero solo se l'errore e' il 400 con cui AlmaLaurea dice che la scheda
    non esiste. Qualunque altra cosa, compresi gli altri 400, e' un fallimento."""
    risposta = getattr(errore, "response", None)
    return (isinstance(errore, requests.HTTPError)
            and risposta is not None
            and risposta.status_code == 400
            and SEGNO_INESISTENTE in risposta.text)


class Budget:
    """Il tetto a orologio. Un turno di notte ha una fascia oraria da rispettare:
    meglio fermarsi puliti a meta' che essere ammazzati a meta' scrittura."""

    def __init__(self, minuti):
        self.scadenza = time.time() + minuti * 60 if minuti else None

    def scaduto(self):
        return self.scadenza is not None and time.time() > self.scadenza

    def restano(self):
        if self.scadenza is None:
            return "senza tetto"
        return f"{max(0, int(self.scadenza - time.time())) // 60} min"


def apri(cartella, ateneo):
    """Il database di UN ateneo: schema dei dati (identico a quello del sito,
    cosi' i file si possono fondere o servire tali e quali) piu' il registro."""
    cartella.mkdir(parents=True, exist_ok=True)
    conn = apri_db(str(cartella / f"{ateneo}.sqlite"))
    conn.executescript(SCHEMA_REGISTRO)
    conn.commit()
    return conn


def chiedi_tendine(ateneo, gruppo, corstipo="L"):
    """Un solo gruppo, con le ripetizioni.

    Ritorna `(corsi, dubbio)`:
      - `(lista, None)`  la risposta e' buona (la lista puo' essere vuota:
                         quella e' una tendina vuota vera, HTTP 200);
      - `([], "500")`    l'errore HTTP si e' ripetuto a ogni tentativo. Il
                         gruppo verra' chiuso, ma da DUBBIO.

    Un guasto di rete (che non e' un HTTPError) viene rilanciato al chiamante:
    quello non chiude niente, ne' certo ne' dubbio, e si ritenta alla
    ripartenza come ha sempre fatto."""
    ultimo = "?"
    for tentativo in range(TENTATIVI_SCOPERTA):
        if tentativo:
            time.sleep(ATTESE_SCOPERTA[min(tentativo - 1, len(ATTESE_SCOPERTA) - 1)])
        try:
            tendine = leggi_tendine(params_tendine(ateneo, gruppo, corstipo=corstipo))
            return tendine.get("postcorso", []), None
        except requests.HTTPError as e:
            ultimo = str(e.response.status_code) if e.response is not None else "?"
    return [], ultimo


def gruppi_con_corsi(ateneo, corstipo):
    """Quali gruppi hanno corsi di questo tipo nell'ateneo, con UNA richiesta.

    Con `gruppo=tutti` solotendine.php non elenca i corsi, ma la sua tendina
    dei gruppi contiene solo quelli che ne hanno. Verificato il 28 ott 2026 sulle
    triennali di 6 atenei (Sapienza, Bologna, Roma Tre, PoliTo, 70141, IULM): la
    lista coincide gruppo per gruppo con quelli dove la raccolta ha trovato
    corsi. Serve soprattutto fuori dalle triennali: il ciclo unico sta in 6
    gruppi su 15, e ogni gruppo vuoto interrogato costa ~15 s di ripetizioni.

    Ritorna `(gruppi, dubbio)` come `chiedi_tendine()`:
      - `(insieme, None)`  risposta buona (vuota = l'ateneo non ne ha nessuno);
      - `(set(), "503")`   l'errore si e' ripetuto a ogni tentativo. Un ateneo
                           SENZA corsi di quel tipo risponde cosi', in modo
                           stabile (28 ott 2026: 10 atenei senza ciclo unico,
                           503 a ogni giro mentre il resto rispondeva).
    Un guasto di rete viene rilanciato: il chiamante allora interroga tutti i
    gruppi, come prima che esistesse questa funzione."""
    params = dict(params_tendine(ateneo, GRUPPI[0], corstipo=corstipo), gruppo="tutti")
    ultimo = "?"
    for tentativo in range(TENTATIVI_SCOPERTA):
        if tentativo:
            time.sleep(ATTESE_SCOPERTA[min(tentativo - 1, len(ATTESE_SCOPERTA) - 1)])
        try:
            tendine = leggi_tendine(params)
            return {g for g, _ in tendine.get("gruppo", []) if g in GRUPPI}, None
        except requests.HTTPError as e:
            ultimo = str(e.response.status_code) if e.response is not None else "?"
    return set(), ultimo


def scopri(conn, ateneo, gruppi, pausa, budget, corstipo="L"):
    """Chiede a solotendine.php quali corsi esistono, gruppo per gruppo.

    Un gruppo gia' interrogato non si ripete: sta in `_scoperta`. Un ateneo che
    non ha corsi in un gruppo risponde con una tendina vuota (HTTP 200): quello
    e' un "non ho niente qui" certo, e si segna come fatto.

    UN ERRORE HTTP NON E' UNA RISPOSTA. solotendine.php rifiuta con 500 e corpo
    vuoto, quindi non si puo' leggere niente per capire se il gruppo e' vuoto
    davvero o se il sito sta avendo un guasto. Si riprova qualche volta
    (`TENTATIVI_SCOPERTA`): se l'esito non cambia il gruppo si chiude lo
    stesso — se no nessun ateneo arriverebbe mai a chiudersi — ma finisce anche
    in `_scoperta_dubbia`, cioe' resta una lista da ripassare con
    `--verifica-dubbie` invece di sparire in silenzio.

    Un guasto di RETE invece (timeout, connessione caduta) non dice niente sui
    corsi: segnarlo come fatto farebbe sparire per sempre, e in silenzio, tutti
    i corsi di quel gruppo. Quello NON si segna, e la ripartenza lo ritenta."""
    gia = {g for (g,) in conn.execute(
        "SELECT gruppo FROM _scoperta WHERE ateneo = ?", (ateneo,))}
    da_fare = [g for g in gruppi if g not in gia]
    if not da_fare:
        return 0, 0, False

    # Prima la lista dei gruppi che hanno corsi di questo tipo: gli altri si
    # chiudono subito, senza interrogarli uno per uno. Se la lista non arriva
    # per un guasto di rete si interrogano tutti, come si e' sempre fatto.
    try:
        presenti, dubbio_ateneo = gruppi_con_corsi(ateneo, corstipo)
    except Exception as e:
        presenti = None
        print(f"    lista dei gruppi non disponibile ({type(e).__name__}): "
              f"interrogo tutti i {len(da_fare)} gruppi")
    time.sleep(pausa)
    if presenti is not None:
        quando = datetime.now().isoformat(timespec="seconds")
        assenti = [g for g in da_fare if g not in presenti]
        for gruppo in assenti:
            conn.execute(
                "INSERT OR REPLACE INTO _scoperta (ateneo, gruppo, quando) VALUES (?,?,?)",
                (ateneo, gruppo, quando))
            if dubbio_ateneo:
                # Stessa regola dei gruppi: chiuso, ma ripassabile con
                # --verifica-dubbie, che li riinterroga uno per uno.
                conn.execute(
                    "INSERT OR REPLACE INTO _scoperta_dubbia (ateneo, gruppo, codice, quando) "
                    "VALUES (?,?,?,?)", (ateneo, gruppo, dubbio_ateneo, quando))
        conn.commit()
        if dubbio_ateneo:
            print(f"    nessun corso {corstipo} (HTTP {dubbio_ateneo} per "
                  f"{TENTATIVI_SCOPERTA} volte) -> {len(assenti)} gruppi chiusi come "
                  f"vuoti, segnati fra i dubbi")
        elif assenti:
            print(f"    {len(assenti)} gruppi senza corsi {corstipo}, chiusi senza interrogarli")
        da_fare = [g for g in da_fare if g in presenti]

    nuovi = falliti = 0
    for gruppo in da_fare:
        if budget.scaduto():
            return nuovi, falliti, True
        try:
            corsi, dubbio = chiedi_tendine(ateneo, gruppo, corstipo)
        except Exception as e:
            falliti += 1
            print(f"    gr.{gruppo}: FALLITA la scoperta, si ritenta alla "
                  f"ripartenza -> {type(e).__name__}: {e}")
            time.sleep(pausa)
            continue
        if dubbio:
            print(f"    gr.{gruppo}: tendine non disponibili (HTTP {dubbio} per "
                  f"{TENTATIVI_SCOPERTA} volte) -> chiuso come vuoto, ma segnato "
                  f"fra le dubbie")
            conn.execute(
                "INSERT OR REPLACE INTO _scoperta_dubbia (ateneo, gruppo, codice, quando) "
                "VALUES (?,?,?,?)",
                (ateneo, gruppo, dubbio, datetime.now().isoformat(timespec="seconds")))
        for codice, nome in corsi:
            cur = conn.execute(
                "INSERT OR IGNORE INTO _corsi (ateneo, gruppo, codice, nome) "
                "VALUES (?,?,?,?)", (ateneo, gruppo, codice, nome))
            nuovi += cur.rowcount
        conn.execute(
            "INSERT OR REPLACE INTO _scoperta (ateneo, gruppo, quando) VALUES (?,?,?)",
            (ateneo, gruppo, datetime.now().isoformat(timespec="seconds")))
        conn.commit()
        time.sleep(pausa)
    return nuovi, falliti, False


def scarica_corsi(conn, ateneo, indagini, pausa, budget, max_corsi=None, corstipo="L"):
    """Scarica le schede dei corsi gia' scoperti. Salta quelle in `_fatte` e
    quelle in `_inesistenti`."""
    corsi = list(conn.execute(
        "SELECT gruppo, codice, nome FROM _corsi WHERE ateneo = ? ORDER BY codice",
        (ateneo,)))
    chiuse = {c for (c,) in conn.execute(
        "SELECT chiave FROM _fatte UNION SELECT chiave FROM _inesistenti")}

    lavoro = []
    for indagine in indagini:
        for gruppo, codice, nome in corsi:
            chiave = f"{ateneo}/{codice}/{indagine}"
            if chiave not in chiuse:
                lavoro.append((chiave, indagine, gruppo, codice, nome))
    if max_corsi:
        lavoro = lavoro[:max_corsi]

    ok = vuote = falliti = inesistenti = 0
    for n, (chiave, indagine, gruppo, codice, nome) in enumerate(lavoro, start=1):
        if budget.scaduto():
            print(f"    tetto raggiunto: mi fermo pulito a {n - 1}/{len(lavoro)}")
            return ok, vuote, falliti, inesistenti, True
        combo = genera_corsi({ateneo: [(gruppo, codice, nome)]}, config=indagine,
                             corstipo=corstipo)[0]
        try:
            righe = raccogli_scheda(scarica_scheda(combo["params"]), combo["params"])
            n_righe = salva_righe(conn, righe)
            if n_righe == 0:
                # HTTP 200 ma nessuna tabella-dato: manutenzione, ondata non
                # ancora pubblicata, pagina cambiata, o un corso senza laureati.
                # Da qui non si distinguono, quindi NON la segno come fatta:
                # un "fatto" a zero righe non si ritenterebbe mai piu'.
                vuote += 1
                print(f"    [{n}/{len(lavoro)}] VUOTA    {indagine} {codice} -> "
                      f"nessuna tabella-dato, si ritenta alla ripartenza")
                time.sleep(pausa)
                continue
            conn.execute(
                "INSERT OR REPLACE INTO _fatte (chiave, righe, quando) VALUES (?,?,?)",
                (chiave, n_righe, datetime.now().isoformat(timespec="seconds")))
            conn.commit()
            ok += 1
            print(f"    [{n}/{len(lavoro)}] {indagine:11s} {nome[:46]:46s} {n_righe:4d} righe")
        except Exception as e:
            if scheda_inesistente(e):
                conn.execute(
                    "INSERT OR REPLACE INTO _inesistenti (chiave, quando) VALUES (?,?)",
                    (chiave, datetime.now().isoformat(timespec="seconds")))
                conn.commit()
                inesistenti += 1
                print(f"    [{n}/{len(lavoro)}] NON C'E' {indagine} {codice} -> "
                      f"AlmaLaurea non ha questa scheda, non si ritenta")
            else:
                # Una scheda che esplode non si porta dietro l'ateneo. Non la
                # segno come fatta, cosi' la ripartenza la ritenta da sola.
                falliti += 1
                print(f"    [{n}/{len(lavoro)}] FALLITA  {indagine} {codice} -> "
                      f"{type(e).__name__}: {e}")
        time.sleep(pausa)
    return ok, vuote, falliti, inesistenti, False


def riepilogo(cartella, ateneo):
    f = cartella / f"{ateneo}.sqlite"
    if not f.exists():
        return None
    # as_uri() codifica i caratteri che in un URI hanno un significato (? # %):
    # incollato a mano, un '?' nel percorso apriva un ALTRO file.
    c = sqlite3.connect(f"{f.resolve().as_uri()}?mode=ro", uri=True)
    try:
        corsi = c.execute("SELECT COUNT(*) FROM _corsi").fetchone()[0]
        fatte = c.execute("SELECT COUNT(*) FROM _fatte").fetchone()[0]
        righe = c.execute("SELECT COUNT(*) FROM dati").fetchone()[0]
        # Un database scritto prima che esistesse `_inesistenti` non ce l'ha
        # finche' questo script non lo riapre in scrittura.
        ha_tabella = c.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='_inesistenti'"
        ).fetchone()
        inesistenti = (c.execute("SELECT COUNT(*) FROM _inesistenti").fetchone()[0]
                       if ha_tabella else 0)
    finally:
        c.close()
    return corsi, fatte, inesistenti, righe, f.stat().st_size


def verifica_dubbie(cartella, atenei, pausa, corstipo="L"):
    """Ripassa i gruppi chiusi da dubbio e recupera quelli che ora rispondono.

    E' la sonda che il 19 set 2026 e' stata fatta a mano su 98 casi (esito:
    98 su 98 vuoti veri, zero corsi persi), qui resa un comando. Un gruppo che
    adesso elenca dei corsi era un guasto travestito da vuoto: si cancella la
    sua riga da `_scoperta` e la raccolta successiva lo riprende da capo."""
    tot_dubbie = recuperati = confermati = falliti = 0
    for ateneo in atenei:
        f = cartella / f"{ateneo}.sqlite"
        if not f.exists():
            continue
        conn = apri(cartella, ateneo)
        try:
            dubbie = list(conn.execute(
                "SELECT gruppo, codice, quando FROM _scoperta_dubbia "
                "WHERE ateneo = ? ORDER BY CAST(gruppo AS INT)", (ateneo,)))
            if not dubbie:
                continue
            tot_dubbie += len(dubbie)
            print(f"  ateneo {ateneo}: {len(dubbie)} gruppi da ripassare")
            for gruppo, codice, quando in dubbie:
                try:
                    corsi, dubbio = chiedi_tendine(ateneo, gruppo, corstipo)
                except Exception as e:
                    falliti += 1
                    print(f"    gr.{gruppo}: non raggiungibile ora "
                          f"({type(e).__name__}), lasciato come dubbio")
                    time.sleep(pausa)
                    continue
                if corsi:
                    recuperati += 1
                    conn.execute("DELETE FROM _scoperta WHERE ateneo = ? AND gruppo = ?",
                                 (ateneo, gruppo))
                    conn.execute("DELETE FROM _scoperta_dubbia WHERE ateneo = ? AND gruppo = ?",
                                 (ateneo, gruppo))
                    conn.commit()
                    print(f"    gr.{gruppo}: RECUPERATO — ora elenca {len(corsi)} corsi. "
                          f"Riaperto: la prossima raccolta lo rifa'.")
                else:
                    confermati += 1
                    esito = f"HTTP {dubbio}" if dubbio else "tendina vuota"
                    print(f"    gr.{gruppo}: confermato vuoto ({esito}), era {codice} il {quando}")
                time.sleep(pausa)
        finally:
            conn.close()

    print(f"\n{'=' * 62}")
    print(f"Dubbie ripassate: {tot_dubbie}   confermate vuote: {confermati}   "
          f"RECUPERATE: {recuperati}   non raggiungibili: {falliti}")
    print(f"{'=' * 62}")
    if recuperati:
        print("Rilancia la raccolta per riprendere i gruppi riaperti.")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--atenei", help="codici separati da virgola, es. 70003,70055")
    g.add_argument("--primi", type=int, help="i primi N atenei della lista ufficiale")
    p.add_argument("--out",
                   help=f"cartella dei database (default per le triennali: "
                        f"{CARTELLA_PREDEFINITA}; obbligatoria per gli altri tipi)")
    p.add_argument("--corstipo", choices=TIPI_CORSO, default="L",
                   help="L triennali (default), LSE ciclo unico, LS magistrali biennali")
    p.add_argument("--pausa", type=float, default=PAUSA_PREDEFINITA,
                   help=f"secondi fra richieste (default: {PAUSA_PREDEFINITA})")
    p.add_argument("--gruppi", help="gruppi da interrogare (default: tutti e 15)")
    p.add_argument("--indagini", default=",".join(INDAGINI),
                   help=f"default: {','.join(INDAGINI)}")
    p.add_argument("--max-corsi", type=int,
                   help="tetto di schede per ateneo, per una raccolta pacata")
    p.add_argument("--max-minuti", type=float,
                   help="tetto a orologio: oltre, si ferma pulito")
    p.add_argument("--solo-scoperta", action="store_true",
                   help="elenca i corsi senza scaricarne le schede")
    p.add_argument("--verifica-dubbie", action="store_true",
                   help="non raccoglie: ripassa i gruppi chiusi da dubbio "
                        "(_scoperta_dubbia) e riapre quelli che ora rispondono")
    a = p.parse_args()

    # `is not None`, non la verita' della stringa: `--atenei ""` (una variabile
    # vuota in un cron) cadeva nel ramo di --primi con primi=None, cioe' TUTTI i
    # 78 atenei — giorni di raccolta partiti per sbaglio.
    if a.atenei is not None:
        atenei = [x.strip() for x in a.atenei.split(",") if x.strip()]
        if not atenei:
            print("--atenei e' vuoto: nessun ateneo indicato.", file=sys.stderr)
            return 2
    else:
        # Un N negativo taglierebbe dalla FINE: --primi -3 prendeva 75 atenei.
        if a.primi < 1:
            print(f"--primi vuole un numero da 1 in su, non {a.primi}.", file=sys.stderr)
            return 2
        atenei = ATENEI[:a.primi]
    ignoti = [x for x in atenei if x not in ATENEI]
    if ignoti:
        print(f"Codici ateneo non nella lista ufficiale: {ignoti}", file=sys.stderr)
        return 2

    # Controllato qui come le indagini: un gruppo sbagliato altrimenti esplodeva
    # dentro scopri() e finiva segnato come "fatto" senza dire del refuso.
    gruppi = ([x.strip() for x in a.gruppi.split(",") if x.strip()]
              if a.gruppi else list(GRUPPI))
    ignoti = [g for g in gruppi if g not in GRUPPI]
    if ignoti:
        print(f"Gruppi non nella lista ufficiale: {ignoti} (attesi: {GRUPPI})",
              file=sys.stderr)
        return 2
    indagini = [x.strip() for x in a.indagini.split(",")]
    sconosciute = [i for i in indagini if i not in INDAGINI]
    if sconosciute:
        print(f"Indagini sconosciute: {sconosciute} (attese: {INDAGINI})", file=sys.stderr)
        return 2

    # Relativo = dalla radice del repository, come --db in esegui_harvest.py.
    # Dalla cartella corrente, una ripartenza lanciata da un altro posto non
    # trovava i database gia' fatti e riscaricava tutto.
    if a.out is None:
        if a.corstipo != "L":
            print(f"--corstipo {a.corstipo} vuole una sua cartella con --out: nei "
                  f"database delle triennali i gruppi risultano gia' interrogati e "
                  f"i corsi {a.corstipo} verrebbero saltati.", file=sys.stderr)
            return 2
        a.out = str(CARTELLA_PREDEFINITA)
    cartella = Path(a.out).expanduser()
    if not cartella.is_absolute():
        cartella = RADICE / cartella
    if a.verifica_dubbie:
        print(f"Verifica dei gruppi chiusi da dubbio — {len(atenei)} atenei, "
              f"corsi {a.corstipo}, pausa {a.pausa}s")
        print(f"Cartella: {cartella}\n")
        return verifica_dubbie(cartella, atenei, a.pausa, a.corstipo)

    budget = Budget(a.max_minuti)
    print(f"Raccolta corsi {a.corstipo} — {len(atenei)} atenei, pausa {a.pausa}s, "
          f"tetto {budget.restano()}")
    print(f"Cartella: {cartella}\n")

    tot_ok = tot_vuote = tot_falliti = tot_inesistenti = tot_scoperta_fallita = 0
    interrotto = False
    for ateneo in atenei:
        if budget.scaduto():
            interrotto = True
            print(f"\nTetto a orologio raggiunto: {ateneo} e i successivi non partono.")
            break
        print(f"  ateneo {ateneo}  ({budget.restano()} residui)")
        conn = apri(cartella, ateneo)
        try:
            nuovi, falliti_scoperta, stop = scopri(conn, ateneo, gruppi, a.pausa, budget,
                                                   a.corstipo)
            tot_scoperta_fallita += falliti_scoperta
            print(f"    scoperta: {nuovi} corsi nuovi"
                  f"{f', {falliti_scoperta} gruppi da ritentare' if falliti_scoperta else ''}")
            if stop:
                interrotto = True
                break
            if not a.solo_scoperta:
                ok, vuote, falliti, inesistenti, stop = scarica_corsi(
                    conn, ateneo, indagini, a.pausa, budget, a.max_corsi, a.corstipo)
                tot_ok += ok
                tot_vuote += vuote
                tot_falliti += falliti
                tot_inesistenti += inesistenti
                if stop:
                    interrotto = True
                    break
        finally:
            conn.close()

    print(f"\n{'=' * 62}")
    print(f"Schede salvate: {tot_ok}   vuote: {tot_vuote}   fallite: {tot_falliti}"
          f"   inesistenti: {tot_inesistenti}"
          f"{'   (INTERROTTO dal tetto)' if interrotto else ''}")
    if tot_scoperta_fallita:
        print(f"Gruppi con la scoperta fallita: {tot_scoperta_fallita} "
              f"(si ritentano alla ripartenza)")
    dubbie = 0
    for ateneo in atenei:
        f = cartella / f"{ateneo}.sqlite"
        if not f.exists():
            continue
        # as_uri() come in riepilogo(): un '?', '#' o '%' nel percorso
        # aprirebbe un altro file.
        c = sqlite3.connect(f"{f.resolve().as_uri()}?mode=ro", uri=True)
        try:
            righe = c.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
                "AND name='_scoperta_dubbia'").fetchone()[0]
            if righe:
                dubbie += c.execute("SELECT COUNT(*) FROM _scoperta_dubbia").fetchone()[0]
        finally:
            c.close()
    if dubbie:
        print(f"Gruppi chiusi da DUBBIO: {dubbie} — ripassali con --verifica-dubbie")
    print(f"{'=' * 62}")
    for ateneo in atenei:
        r = riepilogo(cartella, ateneo)
        if r:
            corsi, fatte, inesistenti, righe, peso = r
            print(f"  {ateneo}: {corsi:4d} corsi scoperti · {fatte:4d} schede · "
                  f"{inesistenti:3d} inesistenti · {righe:6d} righe · {peso / 1e6:.1f} MB")

    # Fermarsi per il tetto NON e' un errore: e' il comportamento voluto, e un
    # codice diverso da zero farebbe suonare l'allarme del turno di notte per
    # una raccolta andata benissimo. Le schede inesistenti non sono fallimenti.
    return 1 if (tot_falliti or tot_scoperta_fallita) and not tot_ok else 0


if __name__ == "__main__":
    sys.exit(main())
