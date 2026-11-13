#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prende i database della raccolta corsi e ne fa la versione da servire al sito.

PERCHE' ESISTE
--------------
`raccogli_corsi.py` produce un database per ateneo che serve a LUI: dentro ci
sono i dati, ma anche il registro di cosa e' gia' fatto (`_corsi`, `_fatte`,
`_scoperta`, `_inesistenti`) e l'indice della chiave primaria, che tiene in
piedi l'INSERT OR REPLACE di una raccolta ripartibile.

Il sito non ha bisogno di niente di tutto questo. Lui scarica il file intero
dentro il browser e lo legge con sql.js, quindi ogni byte che manda giu' e'
banda e RAM dell'utente. Misurato su Bari (`70002`, 148 schede):

    17,4 MB   com'esce dalla raccolta
    15,9 MB   senza le tabelle di servizio
     8,3 MB   senza anche l'indice della chiave primaria   <- questo file

L'indice pesa quasi meta' del file perche' la chiave primaria e' fatta di
undici colonne di testo: e' quasi una seconda copia della tabella. Toglierlo
costa una scansione completa a ogni interrogazione, che su qualche decina di
migliaia di righe in memoria non si sente; tenerlo costa il doppio del file a
ogni apertura della pagina, che si sente eccome.

COSA NON FA, DI PROPOSITO
-------------------------
Non tocca i database di partenza: li apre in sola lettura e scrive altrove.
Puo' quindi girare mentre la raccolta e' in corso.

Non butta via nessuna colonna. Ce ne sono che oggi il sito non interroga
(`anno`, `tipo_corso`, `classe`, `sezione`), ma servono ai generatori offline e
buttarle e' una decisione sui dati, non una compattazione: se un giorno si
decide, si decide a parte e per scritto.

Non salta gli atenei a meta': li SALTA sul serio, perche' un ateneo con meta'
delle schede pubblicato sul sito e' un dato sbagliato che sembra giusto. Con
`--anche-parziali` si forza, e il riepilogo lo scrive a chiare lettere.

USO
---
    python3 tools/prepara_db_sito.py --da ~/Documents/AlmaLaurea-raccolta-corsi
    python3 tools/prepara_db_sito.py --da ~/Documents/AlmaLaurea-raccolta-corsi \
        --da ~/Documents/AlmaLaurea-raccolta-ciclo-unico --out frontend/public/corsi

`--da` si puo' ripetere, una volta per raccolta (triennali, ciclo unico...):
la copia di ogni ateneo mette insieme le righe di tutte le raccolte, che
restano distinte per codice del corso e per `tipo_corso`. Il sito scarica
comunque un file solo per ateneo.
    python3 tools/prepara_db_sito.py --solo 70002,70048 --out /tmp/prova
    python3 tools/prepara_db_sito.py --check        # verifica senza riscrivere

LE MAGISTRALI (`--magistrali`)
------------------------------
Le magistrali biennali stanno in file A PARTE, `frontend/public/corsi-magistrali/`,
scaricati solo quando si sceglie una magistrale: dentro `corsi/` raddoppierebbero
il peso per chi guarda le triennali.

    python3 tools/prepara_db_sito.py --magistrali \
        --da ~/Documents/AlmaLaurea-raccolta-magistrali --out frontend/public/corsi-magistrali

Con `--magistrali` la copia cambia l'ETICHETTA di 15 voci (mai un numero): le
schede delle magistrali fanno alcune domande con parole proprie («Si
iscriverebbero di nuovo al corso di laurea magistrale?») che vogliono dire la
stessa cosa della domanda di triennali e aggregati («...all'universita'?»).
Con l'etichetta comune la magistrale sta sulla stessa riga dell'ateneo e del
voto. La tabella e' ETICHETTE_MAGISTRALI qui sotto (deciso da Mare il 13 nov
2026); la copia si ferma se una voce della tabella non compare piu' nei dati
o se un'etichetta d'arrivo non esiste negli aggregati, cosi' un cambio di
parole di AlmaLaurea non passa in silenzio.

Si lancia da qualunque cartella: i percorsi partono dalla radice del repository.
"""

import argparse
import hashlib
import sqlite3
import sys
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent

for _cartella in (RADICE / "tools", RADICE / "backend" / "src"):
    if str(_cartella) not in sys.path:
        sys.path.insert(0, str(_cartella))

from salva import COLONNE  # noqa: E402

CARTELLA_DA = Path.home() / "Documents" / "AlmaLaurea-raccolta-corsi"
CARTELLA_OUT = Path.home() / "Documents" / "AlmaLaurea-db-sito"

# Lo stesso schema di `salva.py` SENZA la chiave primaria. I NOT NULL restano:
# non pesano niente e dicono a chi legge il file che quelle colonne ci sono
# sempre. Le colonne sono prese da COLONNE, cosi' se un giorno lo schema
# cambia, questo file non resta indietro in silenzio.
TIPI = {
    "valore": "REAL",
    "nota": "TEXT",
    "valore_raw": "TEXT NOT NULL",
    "numero_laureati": "INTEGER",
    "numero_compilatori": "INTEGER",
}


def schema_senza_indice():
    """Il CREATE TABLE della copia per il sito: stesse colonne, stesso ordine,
    nessuna chiave primaria e quindi nessun indice."""
    righe = [f"    {c:18s} {TIPI.get(c, 'TEXT NOT NULL')}" for c in COLONNE]
    return "CREATE TABLE dati (\n" + ",\n".join(righe) + "\n)"


# L'ordine con cui si scorre la tabella per calcolare l'impronta. Non e' la
# chiave primaria per bellezza: e' l'unico ordine che esiste in entrambi i
# file, e senza un ORDER BY esplicito due database con le stesse righe possono
# restituirle in ordine diverso e sembrare diversi.
ORDINE = ("anno, indagine, definizione, tipo_corso, ateneo, gruppo, classe, "
          "corso, sezione, categoria, indicatore")


def impronta(conn):
    """Lo sha256 di TUTTE le righe della tabella `dati`, in ordine canonico.

    Serve a dire "la copia contiene esattamente gli stessi dati", che contare
    le righe non dice: una copia con lo stesso numero di righe e un valore
    storpiato passerebbe il conteggio e non passa questa.

    `repr()` e non `str()`: su un float str() puo' arrotondare, repr() no, e
    None si distingue dalla stringa 'None'."""
    h = hashlib.sha256()
    sql = f"SELECT {','.join(COLONNE)} FROM dati ORDER BY {ORDINE}"
    n = 0
    for riga in conn.execute(sql):
        h.update(repr(riga).encode("utf-8"))
        n += 1
    return h.hexdigest(), n


AGGREGATI = RADICE / "frontend" / "public" / "almalaurea.sqlite"

# Etichette delle magistrali -> etichette di triennali e aggregati, per le voci
# che vogliono dire la stessa cosa. Chiave: (categoria, indicatore) com'e' nelle
# schede delle magistrali; `None` come indicatore vale per tutte le voci della
# categoria, che tengono il loro nome. Valore: (categoria, indicatore) d'arrivo,
# `None` = indicatore invariato. Gli apostrofi sono quelli di AlmaLaurea, dritti
# o tipografici, copiati dai dati: non vanno «corretti».
_ESTERO = ("Sono soddisfatti dell'esperienza di studio all'estero(per 100 che hanno "
           "svolto esperienze di studio all'estero riconosciute dal corso che stanno "
           "concludendo)")
_RIFAREBBERO = "Si iscriverebbero di nuovo al corso di laurea magistrale? (%)"
_RIFAREBBERO_ARRIVO = "Si iscriverebbero di nuovo all'università? (%)"
ETICHETTE_MAGISTRALI = {
    ("Motivazioni molto importanti nella scelta del corso di laurea magistrale (%)", None):
        ("Motivazioni molto importanti nella scelta del corso di laurea (%)", None),
    ("Sono complessivamente soddisfatti del corso di laurea magistrale (%)", None):
        ("Sono complessivamente soddisfatti del corso di laurea (%)", None),
    (_RIFAREBBERO, "Non si iscriverebbero più a nessun corso di laurea magistrale"):
        (_RIFAREBBERO_ARRIVO, "Non si iscriverebbero più all'università"),
    (_RIFAREBBERO, "Sì, allo stesso corso magistrale dell'Ateneo"):
        (_RIFAREBBERO_ARRIVO, "Sì, allo stesso corso dell'Ateneo"),
    (_RIFAREBBERO, "Sì, allo stesso corso magistrale, ma in un altro Ateneo"):
        (_RIFAREBBERO_ARRIVO, "Sì, allo stesso corso ma in un altro Ateneo"),
    (_RIFAREBBERO, "Sì, ma ad un altro corso magistrale dell'Ateneo"):
        (_RIFAREBBERO_ARRIVO, "Sì, ma ad un altro corso dell'Ateneo"),
    (_RIFAREBBERO, "Sì, ma ad un altro corso magistrale e in un altro Ateneo"):
        (_RIFAREBBERO_ARRIVO, "Sì, ma ad un altro corso e in un altro Ateneo"),
    ("Hanno frequentato regolarmente (%)",
     "Hanno svolto periodi di studio all'estero durante il corso magistrale (%)"):
        ("Hanno frequentato regolarmente (%)",
         "Hanno svolto periodi di studio all’estero durante il corso di studio (%)"),
    (_ESTERO, "Hanno svolto tirocini formativi curriculari o lavoro riconosciuti "
              "dal corso di laurea magistrale (%)"):
        (_ESTERO, "Hanno svolto tirocini formativi curriculari o lavoro riconosciuti "
                  "dal corso di studio (%)"),
}


def _prepara_etichette(conn):
    """Mette ETICHETTE_MAGISTRALI in due tabelle temporanee della connessione,
    lette dalla vista `dati` di unione_sola_lettura()."""
    conn.execute("CREATE TEMP TABLE _r_cat (da TEXT PRIMARY KEY, a TEXT NOT NULL)")
    conn.execute("CREATE TEMP TABLE _r_ind (cat TEXT, da TEXT, a_cat TEXT NOT NULL, "
                 "a TEXT NOT NULL, PRIMARY KEY (cat, da))")
    for (cat, ind), (a_cat, a_ind) in ETICHETTE_MAGISTRALI.items():
        if ind is None:
            conn.execute("INSERT INTO _r_cat VALUES (?, ?)", (cat, a_cat))
        else:
            conn.execute("INSERT INTO _r_ind VALUES (?, ?, ?, ?)",
                         (cat, ind, a_cat, a_ind if a_ind is not None else ind))


def _colonne_rinominate():
    """La lista delle colonne per la vista, con categoria e indicatore passati
    per la tabella delle etichette. Solo le righe `LS` cambiano: una riga di
    un altro tipo con le stesse parole resta com'e'."""
    nuova_cat = ("CASE WHEN tipo_corso = 'LS' THEN COALESCE("
                 "(SELECT a_cat FROM _r_ind WHERE cat = categoria AND da = indicatore), "
                 "(SELECT a FROM _r_cat WHERE da = categoria), categoria) "
                 "ELSE categoria END AS categoria")
    nuovo_ind = ("CASE WHEN tipo_corso = 'LS' THEN COALESCE("
                 "(SELECT a FROM _r_ind WHERE cat = categoria AND da = indicatore), "
                 "indicatore) ELSE indicatore END AS indicatore")
    return [nuova_cat if c == "categoria" else nuovo_ind if c == "indicatore" else c
            for c in COLONNE]


def unione_sola_lettura(percorsi, magistrali=False):
    """Una connessione in memoria con una vista `dati` che e' l'unione delle
    tabelle `dati` di tutti i database dati, aperti in sola lettura.

    Serve a calcolare l'impronta di quello che la copia DEVE contenere quando
    le righe arrivano da piu' raccolte: stesso ORDER BY, stessa funzione.
    Con `magistrali` la vista ha gia' le etichette di ETICHETTE_MAGISTRALI, e
    `grezza` resta l'unione com'e' nelle raccolte."""
    conn = sqlite3.connect(":memory:", uri=True)
    pezzi = []
    for i, percorso in enumerate(percorsi):
        conn.execute(f"ATTACH DATABASE ? AS s{i}",
                     (f"{percorso.resolve().as_uri()}?mode=ro",))
        pezzi.append(f"SELECT {','.join(COLONNE)} FROM s{i}.dati")
    conn.execute(f"CREATE TEMP VIEW grezza AS {' UNION ALL '.join(pezzi)}")
    if magistrali:
        _prepara_etichette(conn)
        conn.execute(f"CREATE TEMP VIEW dati AS SELECT {','.join(_colonne_rinominate())} "
                     f"FROM grezza")
    else:
        conn.execute("CREATE TEMP VIEW dati AS SELECT * FROM grezza")
    return conn


def controlla_etichette(cartelle):
    """Controlla ETICHETTE_MAGISTRALI contro i dati prima di copiare.

    Ogni voce della tabella deve comparire in almeno una riga `LS` delle
    raccolte (se AlmaLaurea cambia le parole, la tabella non sta piu' facendo
    niente e nessuno se ne accorgerebbe), e ogni etichetta d'arrivo deve
    esistere negli aggregati del sito (se no la riga non si allinea a niente).
    Ritorna la lista dei problemi, vuota se va tutto bene."""
    problemi = []
    usate = set()
    # Le coppie (categoria, indicatore) che la copia scrivera' davvero: per una
    # categoria rinominata per intero sono le sue voci di OGGI, una per una, cosi'
    # una voce nuova che negli aggregati non esiste non passa col solo nome
    # della categoria.
    arrivi = set()
    for cartella in cartelle:
        for percorso in sorted(cartella.glob("*.sqlite")):
            c = apri_sola_lettura(percorso)
            try:
                for cat, ind in c.execute(
                        "SELECT DISTINCT categoria, indicatore FROM dati WHERE tipo_corso = 'LS'"):
                    if (cat, ind) in ETICHETTE_MAGISTRALI:
                        usate.add((cat, ind))
                        a_cat, a_ind = ETICHETTE_MAGISTRALI[(cat, ind)]
                        arrivi.add((a_cat, a_ind if a_ind is not None else ind))
                    elif (cat, None) in ETICHETTE_MAGISTRALI:
                        usate.add((cat, None))
                        arrivi.add((ETICHETTE_MAGISTRALI[(cat, None)][0], ind))
            finally:
                c.close()
    for voce in ETICHETTE_MAGISTRALI:
        if voce not in usate:
            problemi.append(f"la voce {voce} non compare in nessuna magistrale")
    a = apri_sola_lettura(AGGREGATI)
    try:
        for a_cat, a_ind in sorted(arrivi):
            trovata = a.execute("SELECT 1 FROM dati WHERE categoria = ? AND indicatore = ? "
                                "LIMIT 1", (a_cat, a_ind)).fetchone()
            if not trovata:
                problemi.append(f"l'etichetta d'arrivo {(a_cat, a_ind)} non c'e' negli aggregati")
    finally:
        a.close()
    return problemi


def tipi_fuori_posto(per_ateneo, magistrali):
    """I database di partenza che hanno corsi del tipo sbagliato per la copia.

    Con `--magistrali` le sorgenti devono avere solo righe `LS`; senza, nessuna
    riga `LS`. Le guardie su `--out` guardano il flag; questa guarda il
    contenuto, cosi' una raccolta passata alla cartella sbagliata (le
    magistrali in `corsi/`, le triennali insieme alle magistrali) si ferma
    prima di scrivere. Ritorna la lista dei problemi."""
    problemi = []
    for sorgenti in per_ateneo.values():
        for s in sorgenti:
            c = apri_sola_lettura(s)
            try:
                tipi = {t for (t,) in c.execute("SELECT DISTINCT tipo_corso FROM dati")}
            finally:
                c.close()
            fuori = (tipi - {"LS"}) if magistrali else (tipi & {"LS"})
            if fuori:
                problemi.append(f"{s}: tipo_corso {sorted(fuori)} non va "
                                f"{'con' if magistrali else 'senza'} --magistrali")
    return problemi


def chiavi_doppie(conn):
    """Quante righe dell'unione ripetono la chiave primaria di un'altra.

    In ogni raccolta la chiave primaria lo impedisce; fra due raccolte no, e la
    copia per il sito non ha chiave primaria: due righe con la stessa chiave
    passerebbero e il sito ne leggerebbe una a caso."""
    tutte = conn.execute("SELECT COUNT(*) FROM dati").fetchone()[0]
    distinte = conn.execute(
        f"SELECT COUNT(*) FROM (SELECT DISTINCT {ORDINE} FROM dati)").fetchone()[0]
    return tutte - distinte


def apri_sola_lettura(percorso):
    # as_uri() codifica ? # % nel percorso: la stessa trappola gia' pagata in
    # raccogli_corsi.py, dove un '?' apriva un ALTRO file.
    return sqlite3.connect(f"{percorso.resolve().as_uri()}?mode=ro", uri=True)


def stato_ateneo(conn):
    """Quanto e' completo un ateneo: schede attese, fatte, inesistenti.

    Attese = corsi x indagini. Le indagini si contano dai dati veri invece di
    darle per due: un database raccolto con `--indagini profilo` ne ha una
    sola, e darlo per meta' vuoto sarebbe un falso allarme."""
    corsi = conn.execute("SELECT COUNT(*) FROM _corsi").fetchone()[0]
    fatte = conn.execute("SELECT COUNT(*) FROM _fatte").fetchone()[0]
    ha = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' "
                      "AND name='_inesistenti'").fetchone()
    inesistenti = (conn.execute("SELECT COUNT(*) FROM _inesistenti").fetchone()[0]
                   if ha else 0)
    indagini = conn.execute("SELECT COUNT(DISTINCT indagine) FROM dati").fetchone()[0]
    attese = corsi * max(1, indagini)
    return corsi, fatte, inesistenti, attese


def copia(sorgenti, destinazione, magistrali=False):
    """Scrive la copia compatta di uno o piu' database dello stesso ateneo e ne
    verifica il contenuto. Ritorna (righe, peso_prima, peso_dopo).

    Scrive su un file temporaneo e rinomina solo alla fine: un'interruzione a
    meta' lascia un `.parziale` evidente invece di un database mutilato col
    nome giusto, che il sito servirebbe senza accorgersi di niente."""
    temp = destinazione.with_suffix(".sqlite.parziale")
    temp.unlink(missing_ok=True)

    letto = unione_sola_lettura(sorgenti, magistrali)
    scritto = sqlite3.connect(str(temp))
    try:
        doppie = chiavi_doppie(letto)
        if doppie:
            raise RuntimeError(f"{doppie} righe con la stessa chiave in raccolte diverse")
        scritto.execute(schema_senza_indice())
        segnaposto = ",".join("?" * len(COLONNE))
        sql = f"INSERT INTO dati ({','.join(COLONNE)}) VALUES ({segnaposto})"
        # A blocchi invece che tutto in memoria: i database grossi (Bologna,
        # Sapienza) sono centinaia di migliaia di righe.
        cur = letto.execute(f"SELECT {','.join(COLONNE)} FROM dati")
        while True:
            blocco = cur.fetchmany(20000)
            if not blocco:
                break
            scritto.executemany(sql, blocco)
        scritto.commit()
        # VACUUM ricompatta: senza, il file resta grande quanto le pagine
        # allocate durante l'inserimento.
        scritto.execute("VACUUM")
        scritto.commit()

        atteso, n_atteso = impronta(letto)
        ottenuto, n_ottenuto = impronta(scritto)
    finally:
        letto.close()
        scritto.close()

    if n_atteso != n_ottenuto or atteso != ottenuto:
        temp.unlink(missing_ok=True)
        raise RuntimeError(
            f"la copia non corrisponde all'originale "
            f"({n_ottenuto} righe contro {n_atteso}; "
            f"impronta {ottenuto[:12]} contro {atteso[:12]})")

    peso_prima = sum(s.stat().st_size for s in sorgenti)
    peso_dopo = temp.stat().st_size
    temp.replace(destinazione)
    return n_atteso, peso_prima, peso_dopo


def verifica(sorgenti, destinazione, magistrali=False):
    """Il `--check`: la copia esiste e contiene gli stessi dati? Non riscrive
    niente. Ritorna (esito, messaggio)."""
    if not destinazione.exists():
        return False, "manca"
    a = unione_sola_lettura(sorgenti, magistrali)
    b = apri_sola_lettura(destinazione)
    try:
        indici = b.execute("SELECT COUNT(*) FROM sqlite_master "
                           "WHERE type='index'").fetchone()[0]
        servizio = b.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
                             "AND name LIKE '\\_%' ESCAPE '\\'").fetchone()[0]
        atteso, n_atteso = impronta(a)
        ottenuto, n_ottenuto = impronta(b)
    finally:
        a.close()
        b.close()
    if n_atteso != n_ottenuto:
        return False, f"{n_ottenuto} righe invece di {n_atteso}"
    if atteso != ottenuto:
        return False, "stesse righe ma contenuto diverso"
    if indici:
        return False, f"ha ancora {indici} indici"
    if servizio:
        return False, f"ha ancora {servizio} tabelle di servizio"
    return True, f"{n_ottenuto} righe, pulito"


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--da", action="append",
                   help="cartella dei database di una raccolta; si puo' ripetere "
                        f"(default: {CARTELLA_DA})")
    p.add_argument("--out", default=str(CARTELLA_OUT),
                   help=f"cartella delle copie per il sito (default: {CARTELLA_OUT})")
    p.add_argument("--solo", help="codici separati da virgola, es. 70002,70048")
    p.add_argument("--anche-parziali", action="store_true",
                   help="copia anche gli atenei con schede ancora da raccogliere")
    p.add_argument("--check", action="store_true",
                   help="verifica le copie gia' fatte senza riscriverle")
    p.add_argument("--magistrali", action="store_true",
                   help="raccolta delle magistrali: etichette di ETICHETTE_MAGISTRALI, "
                        "--da e --out obbligatori")
    a = p.parse_args()
    # Percorsi confrontati risolti, non come stringhe: «~/...» o una barra
    # finale non devono bastare a passare la guardia.
    if a.magistrali and (not a.da or Path(a.out).expanduser().resolve() == CARTELLA_OUT.resolve()):
        # Il default di --out e' la cartella delle triennali: una copia delle
        # magistrali li' finirebbe mescolata a un'altra raccolta.
        print(f"--magistrali vuole --da e un --out diverso da {CARTELLA_OUT}", file=sys.stderr)
        return 2

    # Relativo = dalla radice del repository, come --out in raccogli_corsi.py.
    cartelle = [Path(x).expanduser() for x in (a.da or [str(CARTELLA_DA)])]
    cartelle = [d if d.is_absolute() else RADICE / d for d in cartelle]
    out = Path(a.out).expanduser()
    out = out if out.is_absolute() else RADICE / out

    # Il database che il sito pubblica oggi e' `frontend/public/almalaurea.sqlite`,
    # e un `--out frontend/public` con un ateneo chiamato "almalaurea" o una
    # distrazione futura lo sovrascriverebbe con dati di un altro livello.
    # Stessa guardia di `--incrocio senza --db` in esegui_harvest.py.
    # Le uniche eccezioni sono `frontend/public/corsi` e `corsi-magistrali`, le
    # cartelle da cui il sito scarica i corsi un ateneo alla volta
    # (js/db-corsi.js): li' non c'e' nient'altro da sovrascrivere. Devono essere
    # ESATTAMENTE quelle, non una sottocartella, perche' il sito cerca
    # `corsi/<ateneo>.sqlite` e `corsi-magistrali/<ateneo>.sqlite` e nient'altro.
    # E ognuna col suo tipo: le magistrali solo in `corsi-magistrali`, e li'
    # solo le magistrali.
    pubblico = (RADICE / "frontend" / "public").resolve()
    corsi_sito = pubblico / "corsi"
    magistrali_sito = pubblico / "corsi-magistrali"
    if out.resolve() not in (corsi_sito, magistrali_sito) and (
            out.resolve() == pubblico or pubblico in out.resolve().parents):
        print(f"--out non puo' stare dentro {pubblico}: li' c'e' il database "
              f"che il sito pubblica. Le uniche cartelle ammesse sono {corsi_sito} "
              f"e {magistrali_sito}.", file=sys.stderr)
        return 2
    if out.resolve() in (corsi_sito, magistrali_sito) and (
            (out.resolve() == magistrali_sito) != a.magistrali):
        print(f"{magistrali_sito} e --magistrali vanno insieme: li' solo le "
              f"magistrali, e le magistrali solo li'.", file=sys.stderr)
        return 2

    for da in cartelle:
        if not da.is_dir():
            print(f"La cartella di partenza non esiste: {da}", file=sys.stderr)
            return 2

    # ateneo -> i suoi database, uno per raccolta che lo contiene.
    per_ateneo = {}
    for da in cartelle:
        for s in sorted(da.glob("*.sqlite")):
            per_ateneo.setdefault(s.stem, []).append(s)
    if a.solo:
        voluti = {x.strip() for x in a.solo.split(",") if x.strip()}
        mancanti = voluti - set(per_ateneo)
        if mancanti:
            print(f"Database non trovati: {sorted(mancanti)}", file=sys.stderr)
            return 2
        per_ateneo = {k: v for k, v in per_ateneo.items() if k in voluti}
    if not per_ateneo:
        print("Nessun database nelle cartelle di partenza", file=sys.stderr)
        return 2

    problemi = tipi_fuori_posto(per_ateneo, a.magistrali)
    for problema in problemi:
        print(f"TIPO: {problema}", file=sys.stderr)
    if problemi:
        return 2

    if a.magistrali:
        problemi = controlla_etichette(cartelle)
        for problema in problemi:
            print(f"ETICHETTE: {problema}", file=sys.stderr)
        if problemi:
            return 2
        print(f"Etichette delle magistrali: {len(ETICHETTE_MAGISTRALI)} righe della "
              f"tabella, tutte presenti nelle raccolte e negli aggregati")

    print(f"{'Verifica' if a.check else 'Preparazione'} — {len(per_ateneo)} atenei")
    for da in cartelle:
        print(f"  da:  {da}")
    print(f"  a:   {out}\n")

    if not a.check:
        out.mkdir(parents=True, exist_ok=True)

    fatti = saltati = rotti = 0
    tot_prima = tot_dopo = tot_righe = 0
    for codice, sorgenti in sorted(per_ateneo.items()):
        destinazione = out / f"{codice}.sqlite"
        if a.check:
            ok, messaggio = verifica(sorgenti, destinazione, a.magistrali)
            print(f"  {codice}: {'ok' if ok else 'ROTTO'} — {messaggio}")
            fatti += ok
            rotti += not ok
            continue

        residue = attese = 0
        for s in sorgenti:
            c = apri_sola_lettura(s)
            try:
                corsi, schede, inesistenti, attese_s = stato_ateneo(c)
            finally:
                c.close()
            residue += attese_s - schede - inesistenti
            attese += attese_s
        if residue > 0 and not a.anche_parziali:
            print(f"  {codice}: SALTATO — {residue} schede ancora da raccogliere "
                  f"su {attese} (--anche-parziali per forzare)")
            saltati += 1
            continue

        try:
            righe, prima, dopo = copia(sorgenti, destinazione, a.magistrali)
        except Exception as e:
            print(f"  {codice}: FALLITO — {type(e).__name__}: {e}")
            rotti += 1
            continue
        avviso = f"  [PARZIALE: {residue} schede mancanti]" if residue > 0 else ""
        print(f"  {codice}: {righe:6d} righe · {prima / 1e6:5.1f} MB -> "
              f"{dopo / 1e6:5.1f} MB  (-{100 * (prima - dopo) / prima:4.1f}%)"
              f"{avviso}")
        fatti += 1
        tot_prima += prima
        tot_dopo += dopo
        tot_righe += righe

    print(f"\n{'=' * 62}")
    if a.check:
        print(f"Verificati: {fatti} ok, {rotti} da rifare")
    else:
        print(f"Preparati: {fatti}   saltati: {saltati}   falliti: {rotti}")
        if tot_prima:
            print(f"Peso: {tot_prima / 1e6:.1f} MB -> {tot_dopo / 1e6:.1f} MB "
                  f"(-{100 * (tot_prima - tot_dopo) / tot_prima:.1f}%), "
                  f"{tot_righe} righe")
    print(f"{'=' * 62}")
    return 1 if rotti else 0


if __name__ == "__main__":
    sys.exit(main())
