# -*- coding: utf-8 -*-
"""Regenerate frontend/public/js/config-filtri.js from the database.

WHY IT EXISTS: config-filtri.js is not written by hand. It is produced by a
DISTINCT (sezione, categoria, indicatore) query on almalaurea.sqlite. Keeping
the generator with the generated file avoids maintaining 997 lines by hand or
rewriting the grouping logic from scratch after an annual data update.

WHAT IT DOES:
  - The filter unit is the QUESTION, not the raw indicator:
      categoria != ''  -> the question is (sezione, categoria); its
                          indicators are the response options.
      categoria == ''  -> the indicator is already complete on its own: it is
                          its own question, a one-element group.
  - The macro-category is derived mechanically from the official AlmaLaurea
    section (the SEZIONE_A_MACRO table below), not entry by entry.
  - The id is a label slug: lowercase, accents removed, every non-letter or
    non-number becomes '_', truncated to 80 characters (with disambiguation
    if two labels collide).

USAGE:
    python3 tools/genera_config_filtri.py            # writes the file
    python3 tools/genera_config_filtri.py --check    # does not write; reports
                                                     # whether the file matches

FUTURE MAINTENANCE: if a data update changes the labels, the ids also change
because they are derived from the labels. The ids are included in the
vocabulary exposed to the model by the AI layer, so they must be regenerated
together and must not be left out of sync. See the data update section in the
README.
"""

import argparse
import glob
import json
import re
import sqlite3
import sys
import unicodedata
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
DB = RADICE / "frontend" / "public" / "almalaurea.sqlite"
# Course databases, one per university (Phase 4), in two folders: first-level
# and single-cycle courses, and second-level ones. They contain questions that
# the aggregate database lacks; see leggi_combinazioni_corsi().
CARTELLE_CORSI = (RADICE / "frontend" / "public" / "corsi",
                  RADICE / "frontend" / "public" / "corsi-magistrali")
USCITA = RADICE / "frontend" / "public" / "js" / "config-filtri.js"

# Official sections from AlmaLaurea sheets grouped into macro-categories
# intended for people choosing a degree programme.
#
# There are TWO surveys, distinguishable by inspection: the graduate profile
# survey uses uppercase titles, whereas the employment outcomes survey does
# not. All 8 employment outcomes survey sections belong to the single
# "Dopo la Laurea" macro-category for a substantive rather than aesthetic
# reason: "Lavoro e Futuro" in the graduate profile survey records a new
# graduate's EXPECTATIONS, while the employment outcomes survey records
# what actually happened at 1/3/5 years. Mixing them would make one number
# appear to describe the other. There are 22 questions (108 raw indicators,
# reduced to 22 by grouping on (sezione, categoria)).
SEZIONE_A_MACRO = {
    # graduate profile survey
    "1. CARATTERISTICHE ANAGRAFICHE": "Profilo Studente",
    "2. ORIGINE SOCIALE": "Profilo Studente",
    "3. STUDI SECONDARI DI SECONDO GRADO": "Profilo Studente",
    "4. RIUSCITA NEGLI STUDI UNIVERSITARI": "Successo e Percorso",
    "5. CONDIZIONI DI STUDIO": "Competenze e Ambiente",
    "6. LAVORO DURANTE GLI STUDI UNIVERSITARI": "Lavoro e Futuro",
    "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA": "Esperienza Universitaria",
    "8. CONOSCENZE LINGUISTICHE E INFORMATICHE": "Competenze e Ambiente",
    "9. PROSPETTIVE DI STUDIO": "Successo e Percorso",
    "10. PROSPETTIVE DI LAVORO": "Lavoro e Futuro",
    # employment outcomes survey
    "2a. Formazione di secondo livello": "Dopo la Laurea",
    "2b. Formazione post-laurea": "Dopo la Laurea",
    "3. Condizione occupazionale": "Dopo la Laurea",
    "4. Ingresso nel mercato del lavoro": "Dopo la Laurea",
    "5. Caratteristiche dell´attuale lavoro": "Dopo la Laurea",
    "6. Caratteristiche dell´impresa": "Dopo la Laurea",
    "7. Retribuzione": "Dopo la Laurea",
    "8. Utilizzo e richiesta della laurea nell´attuale lavoro": "Dopo la Laurea",
    "9. Efficacia della laurea e soddisfazione per l´attuale lavoro": "Dopo la Laurea",
}

# Order in which macro-categories appear in the UI: from the degree path to
# post-graduation, then surrounding context. It is intentionally not
# alphabetical; it is a reading choice.
ORDINE_MACRO = [
    "Successo e Percorso",
    "Esperienza Universitaria",
    "Lavoro e Futuro",
    "Dopo la Laurea",
    "Competenze e Ambiente",
    "Profilo Studente",
]

# 80 rather than 60: two "Dopo la Laurea" questions start with the same
# 60 letters and diverge at character 61, so a limit of 60 produced the same
# id for both. With duplicate ids, getElementById returns only the first and
# the second question would have an unresponsive control.
LUNGHEZZA_MASSIMA_ID = 80

INTESTAZIONE = """/**
 * config-filtri.js
 *
 * Mappatura reale indicatori AlmaLaurea -> macro-categorie, generata
 * direttamente da almalaurea.sqlite (query DISTINCT sezione, categoria,
 * indicatore), non scritta a mano: se il dataset cambia, questo file si
 * rigenera con lo stesso script, non si modifica a mano riga per riga.
 *
 * UNITA' DI FILTRO = "domanda", non il singolo indicatore grezzo:
 *  - se `categoria` non e' vuota, la domanda e' (sezione, categoria) e
 *    `indicatori` elenca le opzioni di risposta da mostrare come
 *    sotto-colonne (es. "Decisamente si'/no" hanno senso solo insieme
 *    alla domanda a cui appartengono — da soli sono ambigui: la stessa
 *    coppia di risposte compare in 24 domande diverse nel dataset).
 *  - se `categoria` e' vuota (''), l'indicatore e' gia' completo da solo
 *    (es. "Dottorato di ricerca"): e' la sua stessa "domanda", un
 *    gruppo da un solo elemento.
 *
 * La macro-categoria si ricava dalla sezione ufficiale AlmaLaurea
 * (fase1-resoconto.md, §3.2) — non e' un giudizio indicatore per
 * indicatore, e' una semplice tabella sezione -> macro-categoria.
 *
 * OGNI VOCE DICHIARA LA SUA INDAGINE (`indagine`: "profilo" oppure
 * "occupazione") E LE SUE DEFINIZIONI (`definizioni`). Non e' decorazione: il
 * database contiene due indagini, e dentro `occupazione` quasi tutte le
 * domande esistono in DUE definizioni ufficiali di "occupato" (ampia e
 * restrittiva) con numeri diversi. Chi interroga il database DEVE filtrare su
 * `indagine` e su `definizione`, altrimenti 69 coppie (categoria, indicatore)
 * collidono e l'ultima riga letta sovrascrive la prima in silenzio.
 *
 * Valori possibili in `definizioni`:
 *   [""]              -> indagine profilo: la doppia definizione non esiste
 *   ["ampia", "restrittiva"] -> la domanda esiste in entrambe, con numeri diversi
 *   ["ampia"] / ["restrittiva"] -> esiste SOLO con quella definizione
 *   ["condivisa"]     -> blocco non doppiato nella pagina AlmaLaurea: vale
 *                        per entrambe le definizioni, va mostrato sempre
 *
 * Regola per la UI, data la definizione scelta dall'utente:
 *   mostra la voce se definizioni contiene "", "condivisa", o la scelta.
 *
 * Per il rendering: dato un elemento di CONFIG_FILTRI,
 *  - sempre: WHERE indagine = elemento.indagine
 *  - se categoria != '' -> query: WHERE categoria = elemento.categoria
 *  - se categoria == '' -> query: WHERE categoria = '' AND indicatore = elemento.indicatori[0]
 * (la categoria, quando presente, e' di per se' univoca nel dataset:
 * verificato che nessuna categoria si ripete in sezioni diverse).
 *
 * DOMANDE SOLO-CORSO (`soloCorso: true`): esistono nelle schede dei singoli
 * corsi e non in quelle di atenei e gruppi. Gli aggregati mettono insieme
 * tutti i tipi di laurea (tipo_corso = ''), ogni corso e' di un tipo solo, e
 * certe domande hanno senso solo li': cosa succede DOPO la triennale
 * (iscrizione alla magistrale, lavora/studia) e, per le magistrali, la laurea
 * di provenienza (ateneo, gruppo, voto, regolarita'). La UI le
 * mostra solo quando il confronto contiene almeno una colonna corso; la
 * proprieta' manca, invece di valere false, su tutte le altre voci.
 *
 * VOCI SOLO-CORSO DENTRO UNA DOMANDA DEGLI AGGREGATI (`indicatoriSoloCorso`):
 * le opzioni di una domanda che atenei e gruppi non pubblicano, perche' poste
 * a un tipo di laurea solo (per esempio dottorato e master di II livello, o
 * l'estero «riconosciuto solo nel precedente corso» delle magistrali). La UI
 * le tratta come le domande solo-corso, opzione per opzione.
 *
 * Nota su una stranezza ereditata dai dati originali, NON corretta a
 * mano: nella sezione 1 la categoria "Eta' alla laurea (%)" include
 * anche "Cittadini stranieri (%)" come indicatore. E' cosi' nella
 * struttura ufficiale della scheda AlmaLaurea (non e' un bug del
 * parser di Fase 0): si lascia com'e', per fedelta' alla fonte. Lo
 * stesso nelle magistrali: «Regolarita' negli studi del precedente titolo
 * universitario» ha fra le opzioni anche il voto medio della laurea
 * precedente (in 110-mi), accanto alle percentuali.
 */
"""


def slug(etichetta):
    """Convert a readable label into a stable, usable HTML id.

    Accents are stripped rather than deleting their letters
    ('Regolarità' -> 'regolarita'), keeping the id readable and independent of
    character encoding.

    Args:
        etichetta: Readable label to convert.

    Returns:
        A normalized, truncated HTML id.
    """
    senza_accenti = "".join(
        c
        for c in unicodedata.normalize("NFD", etichetta)
        if unicodedata.category(c) != "Mn"
    )
    ripulito = re.sub(r"[^a-z0-9]+", "_", senza_accenti.lower()).strip("_")
    return ripulito[:LUNGHEZZA_MASSIMA_ID].rstrip("_")


def leggi_combinazioni(db_path):
    """Read distinct survey, definition, and question combinations.

    This is the only database read; no numeric value enters this function.
    The `definizione` field is needed because the two definitions of
    "occupato" do NOT ask exactly the same questions: 16 are shared, 2 exist
    only for the broad definition ("Ricerca del lavoro", "Ripartizione
    geografica di lavoro"), and 2 only for the restrictive definition
    ("Condizione occupazionale", "Area geografica di lavoro"). Each entry
    therefore carries the definitions under which it exists, allowing the UI
    to hide unavailable questions instead of showing a row of dashes.

    Args:
        db_path: Path to the SQLite database.

    Returns:
        The distinct database rows as tuples.
    """
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(
            "SELECT DISTINCT indagine, definizione, sezione, categoria, indicatore "
            "FROM dati"
        ).fetchall()
    finally:
        conn.close()


def leggi_combinazioni_corsi(cartella):
    """Read the distinct combinations of every course database.

    A course sheet holds one degree type, and AlmaLaurea asks its graduates
    questions that mixed-degree aggregates cannot carry: first-level graduates
    whether they enrolled in a master's degree or work and study,
    second-level graduates about their previous degree. Those questions exist
    nowhere else, so the course databases must be read too.

    Args:
        cartella: Directory holding one ``<university>.sqlite`` per university.

    Returns:
        The union of the distinct rows of all course databases, as a set.
    """
    combinazioni = set()
    for percorso in sorted(glob.glob(str(cartella / "*.sqlite"))):
        conn = sqlite3.connect(f"{Path(percorso).as_uri()}?mode=ro", uri=True)
        try:
            combinazioni.update(
                conn.execute(
                    "SELECT DISTINCT indagine, definizione, sezione, categoria, "
                    "indicatore FROM dati"
                ).fetchall()
            )
        finally:
            conn.close()
    return combinazioni


def costruisci_config(combinazioni, combinazioni_corsi=()):
    """Group combinations into questions and assign macro-categories.

    Return ``(config, problemi)``. Problems do not stop generation; they are
    printed because a new dataset may contain surprises that should be seen,
    not hidden.

    Args:
        combinazioni: Distinct survey, definition, section, category, and
            indicator tuples.
        combinazioni_corsi: The same tuples read from the course databases.
            Those absent from ``combinazioni`` form course-only questions,
            marked ``soloCorso``.

    Returns:
        A configuration mapping and a list of detected problems.
    """
    problemi = []
    domande = {}  # (sezione, categoria, standalone indicator) -> entry
    # Each section must belong to ONE survey. This lets each entry carry its
    # survey and lets app.js filter on it without deriving it. If a future
    # dataset violates this assumption, it must be reported immediately
    # rather than discovered through an incorrect number.
    indagine_di_sezione = {}
    # Report each unmapped section once with a count. One warning per entry
    # would produce a hundred identical lines that nobody reads. Employment
    # sections remain here until they are assigned to a macro-category.
    non_mappate = {}

    aggregate = set(combinazioni)
    solo_corso = set(combinazioni_corsi) - aggregate
    # Question key -> (combinations seen in aggregates, in courses only).
    # A question that is entirely course-only is marked ``soloCorso``; a mixed
    # one (a few options asked only of one degree type, such as a master's
    # graduate's internship "recognised only in the previous degree") lists
    # those options in ``indicatoriSoloCorso``, so the page can say "solo per
    # i corsi" in university and group columns instead of showing a hole that
    # looks like missing data.
    provenienza = {}
    indicatori_aggregati = {}  # question key -> options seen in aggregates

    for tupla in sorted(aggregate | solo_corso):
        indagine, definizione, sezione, categoria, indicatore = tupla
        vista = indagine_di_sezione.setdefault(sezione, indagine)
        if vista != indagine:
            problemi.append(
                f"la sezione {sezione!r} compare in due indagini ({vista!r} e "
                f"{indagine!r}): la voce generata ne puo' dichiarare una sola"
            )
        if sezione not in SEZIONE_A_MACRO:
            non_mappate[sezione] = non_mappate.get(sezione, 0) + 1
            continue
        # Standalone: each indicator is its own question. With a category, all
        # indicators belong to the same question.
        chiave = (sezione, categoria, indicatore if categoria == "" else "")
        etichetta = categoria if categoria else indicatore
        voce = domande.setdefault(
            chiave,
            {
                "id": None,  # assigned after sorting; see below
                "label": etichetta,
                "indagine": indagine,
                "definizioni": set(),
                "sezione": sezione,
                "categoria": categoria,
                "indicatori": set(),
            },
        )
        voce["indicatori"].add(indicatore)
        voce["definizioni"].add(definizione)
        conta = provenienza.setdefault(chiave, [0, 0])
        conta[1 if tupla in solo_corso else 0] += 1
        if tupla not in solo_corso:
            indicatori_aggregati.setdefault(chiave, set()).add(indicatore)

    for chiave, (in_aggregati, in_corsi) in provenienza.items():
        if in_aggregati == 0:
            domande[chiave]["soloCorso"] = True
        elif in_corsi:
            # Options never seen in the aggregates, under any definition.
            solo = domande[chiave]["indicatori"] - indicatori_aggregati[chiave]
            if solo:
                domande[chiave]["indicatoriSoloCorso"] = solo

    config = {macro: [] for macro in ORDINE_MACRO}
    for voce in domande.values():
        voce["indicatori"] = sorted(voce["indicatori"])
        if "indicatoriSoloCorso" in voce:
            voce["indicatoriSoloCorso"] = sorted(voce["indicatoriSoloCorso"])
        voce["definizioni"] = sorted(voce["definizioni"])
        config[SEZIONE_A_MACRO[voce["sezione"]]].append(voce)

    for macro in ORDINE_MACRO:
        # Stable, reproducible order: section, then category, then label.
        config[macro].sort(key=lambda v: (v["sezione"], v["categoria"], v["label"]))

    # Assign ids HERE, after sorting rather than when creating entries, so the
    # assignment order is reproducible and a collision always receives the
    # suffix on the same label from one run to the next. Reporting duplicates
    # while still writing a broken file would leave two entries with the same
    # HTML id and the second control unresponsive, so duplicates are prevented.
    visti = {}
    for macro in ORDINE_MACRO:
        for voce in config[macro]:
            radice = slug(voce["label"])
            id_finale = radice
            n = 1
            while id_finale in visti:
                n += 1
                id_finale = f"{radice}_{n}"
            if n > 1:
                problemi.append(
                    f"id {radice!r} era gia' di {visti[radice]!r}: "
                    f"{voce['label']!r} prende {id_finale!r} (il troncamento a "
                    f"{LUNGHEZZA_MASSIMA_ID} caratteri le ha fatte collidere)"
                )
            voce["id"] = id_finale
            visti[id_finale] = voce["label"]

    for sezione in sorted(non_mappate):
        problemi.append(
            f"sezione non mappata in SEZIONE_A_MACRO, {non_mappate[sezione]} voci "
            f"ignorate: {sezione!r}"
        )

    return config, problemi


def rendi_javascript(config):
    """Render the filter configuration as an ES module.

    Args:
        config: Macro-category to filter-question mapping.

    Returns:
        The generated JavaScript module text.
    """
    corpo = json.dumps(config, indent=2, ensure_ascii=False)
    return f"{INTESTAZIONE}\nexport const CONFIG_FILTRI = {corpo};\n"


def main():
    """Parse command-line arguments and generate or check the filter module."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="non scrive nulla: esce con codice 1 se il file sul disco e' diverso",
    )
    argomenti = parser.parse_args()

    if not DB.exists():
        sys.exit(f"Database non trovato: {DB}")

    combinazioni_corsi = set()
    for cartella in CARTELLE_CORSI:
        if not cartella.is_dir():
            sys.exit(f"Cartella dei corsi non trovata: {cartella}")
        combinazioni_corsi |= leggi_combinazioni_corsi(cartella)

    config, problemi = costruisci_config(leggi_combinazioni(DB), combinazioni_corsi)
    testo = rendi_javascript(config)

    for p in problemi:
        print(f"ATTENZIONE: {p}")

    totale = sum(len(v) for v in config.values())
    riepilogo = ", ".join(f"{m}: {len(config[m])}" for m in ORDINE_MACRO)
    solo = sum(1 for v in config.values() for voce in v if voce.get("soloCorso"))
    print(f"{totale} domande ({riepilogo}); {solo} solo-corso")

    attuale = USCITA.read_text(encoding="utf-8") if USCITA.exists() else None
    if argomenti.check:
        if attuale == testo:
            print(f"OK: {USCITA.relative_to(RADICE)} e' allineato al database.")
            return 0
        print(f"DIVERSO: {USCITA.relative_to(RADICE)} non corrisponde al database.")
        return 1

    if attuale == testo:
        print(f"Nessuna modifica: {USCITA.relative_to(RADICE)} era gia' allineato.")
        return 0
    USCITA.write_text(testo, encoding="utf-8")
    print(f"Scritto {USCITA.relative_to(RADICE)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
