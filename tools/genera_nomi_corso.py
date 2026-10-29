# -*- coding: utf-8 -*-
"""Regenerate nomi-corso.js from the course names collected from AlmaLaurea.

WHY IT EXISTS: course databases identify courses by opaque codes such as
0580106203100003. Their names come from the real AlmaLaurea dropdowns, read
by tools/raccogli_corsi.py into the `_corsi` table of each collection
database. Those databases live OUTSIDE the repository, and the site copies
made by tools/prepara_db_sito.py drop `_corsi`. The names are therefore saved
in backend/dati-sorgente/nomi-corso.tsv, so any project clone can regenerate
the module without the collection, as with ateneo-numero.txt.

WHAT IT DOES:
  - with --da, refreshes nomi-corso.tsv from the `_corsi` tables;
  - CHECKS coverage against frontend/public/corsi/*.sqlite: every course in
    the site databases must have a name under its own university, and every
    name must belong to a course in the site databases;
  - rewrites frontend/public/js/nomi-corso.js.

Names are copied exactly as AlmaLaurea writes them. Capitalization is a
presentation choice and belongs to the stylesheet, not to the data.

USAGE:
    python3 tools/genera_nomi_corso.py --da ~/Documents/AlmaLaurea-raccolta-corsi \
        --da ~/Documents/AlmaLaurea-raccolta-ciclo-unico   # --da once per collection
    python3 tools/genera_nomi_corso.py            # writes the module from the TSV
    python3 tools/genera_nomi_corso.py --check    # does not write; only checks
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
SORGENTE = RADICE / "backend" / "dati-sorgente" / "nomi-corso.tsv"
CORSI_SITO = RADICE / "frontend" / "public" / "corsi"
USCITA = RADICE / "frontend" / "public" / "js" / "nomi-corso.js"

COLONNE_TSV = ("ateneo", "gruppo", "codice", "nome")

INTESTAZIONE = """/**
 * nomi-corso.js
 *
 * Corrispondenza codice corso -> nome, raggruppata per ateneo:
 * NOMI_CORSO[ateneo][codice] = nome. I nomi sono quelli dei menu a tendina
 * reali del sito AlmaLaurea, raccolti da tools/raccogli_corsi.py e salvati in
 * backend/dati-sorgente/nomi-corso.tsv, non scritti a mano ne' ritoccati.
 *
 * {corsi} corsi su {atenei} atenei, verificati 1:1 contro i database in
 * frontend/public/corsi/ (0 mancanti, 0 estranei). Dentro ogni ateneo i
 * corsi sono in ordine alfabetico: un menu li puo' mostrare direttamente,
 * senza scaricare il database dell'ateneo.
 *
 * CICLO_UNICO contiene i codici dei corsi di laurea magistrale a ciclo
 * unico (tipo_corso 'LSE' nei database del sito); un corso che non c'e' e'
 * una laurea di primo livello.
 *
 * Rigenerato da tools/genera_nomi_corso.py, non modificato a mano.
 */
"""


def apri_sola_lettura(percorso):
    """Open a SQLite database read-only.

    Args:
        percorso: Database path.

    Returns:
        A read-only SQLite connection.
    """
    # as_uri() encodes characters such as '?' that would otherwise be read as
    # URI parameters and silently open a different file.
    return sqlite3.connect(f"{percorso.resolve().as_uri()}?mode=ro", uri=True)


def leggi_raccolta(cartella):
    """Read course names from the `_corsi` tables of the collection databases.

    Args:
        cartella: Folder containing the collection databases.

    Returns:
        A list of (ateneo, gruppo, codice, nome) tuples.
    """
    righe = []
    for percorso in sorted(cartella.glob("*.sqlite")):
        conn = apri_sola_lettura(percorso)
        try:
            righe += conn.execute(
                "SELECT ateneo, gruppo, codice, nome FROM _corsi"
            ).fetchall()
        finally:
            conn.close()
    return righe


def scrivi_tsv(righe):
    """Write the versioned TSV source, sorted by university and name.

    Tabs or line breaks inside a field would silently shift columns, so they
    stop the run instead of being escaped.

    Args:
        righe: (ateneo, gruppo, codice, nome) tuples.
    """
    for riga in righe:
        if any(c in campo for campo in riga for c in "\t\r\n"):
            sys.exit(f"Campo con tabulazione o a capo, TSV impossibile: {riga}")
    ordinate = sorted(righe, key=lambda r: (r[0], r[3].casefold(), r[2]))
    testo = "\t".join(COLONNE_TSV) + "\n"
    testo += "".join("\t".join(r) + "\n" for r in ordinate)
    SORGENTE.write_text(testo, encoding="utf-8")
    print(f"Scritto {SORGENTE.relative_to(RADICE)}: {len(ordinate)} corsi")


def leggi_tsv():
    """Read the versioned TSV source.

    Returns:
        A list of (ateneo, gruppo, codice, nome) tuples.
    """
    linee = SORGENTE.read_text(encoding="utf-8").splitlines()
    if not linee or tuple(linee[0].split("\t")) != COLONNE_TSV:
        sys.exit(f"Intestazione inattesa in {SORGENTE}: servono {COLONNE_TSV}")
    righe = []
    for numero, linea in enumerate(linee[1:], start=2):
        campi = tuple(linea.split("\t"))
        if len(campi) != len(COLONNE_TSV):
            sys.exit(f"{SORGENTE.name}, riga {numero}: {len(campi)} campi invece di 4")
        righe.append(campi)
    return righe


def costruisci_mappa(righe):
    """Group names as {ateneo: {codice: nome}}.

    Universities follow code order; courses follow name order within each
    university.

    Args:
        righe: (ateneo, gruppo, codice, nome) tuples.

    Returns:
        A nested code-to-name mapping, and a list of problems found.
    """
    problemi = []
    per_ateneo = {}
    visti = {}
    for ateneo, _gruppo, codice, nome in righe:
        if codice in visti:
            problemi.append(f"codice {codice} ripetuto (atenei {visti[codice]} e {ateneo})")
            continue
        visti[codice] = ateneo
        per_ateneo.setdefault(ateneo, []).append((codice, nome))
    mappa = {}
    for ateneo in sorted(per_ateneo):
        corsi = sorted(per_ateneo[ateneo], key=lambda c: (c[1].casefold(), c[0]))
        mappa[ateneo] = dict(corsi)
    return mappa, problemi


def verifica_copertura(mappa):
    """Compare named courses with those in the site databases.

    Args:
        mappa: {ateneo: {codice: nome}} mapping.

    Returns:
        A list of coverage problems, empty when coverage is complete, and the
        set of single-cycle course codes ('LSE') read from the same databases.
    """
    file_sito = sorted(CORSI_SITO.glob("*.sqlite"))
    if not file_sito:
        return [f"nessun database in {CORSI_SITO}: copertura non verificata"], set()
    nel_sito = set()
    ciclo_unico = set()
    for percorso in file_sito:
        conn = apri_sola_lettura(percorso)
        try:
            for ateneo, corso, tipo in conn.execute(
                "SELECT DISTINCT ateneo, corso, tipo_corso FROM dati WHERE corso != ''"
            ):
                nel_sito.add((ateneo, corso))
                if tipo == "LSE":
                    ciclo_unico.add(corso)
        finally:
            conn.close()
    con_nome = {(a, c) for a, corsi in mappa.items() for c in corsi}
    problemi = []
    mancanti = sorted(nel_sito - con_nome)
    estranei = sorted(con_nome - nel_sito)
    if mancanti:
        problemi.append(f"{len(mancanti)} corsi nei database senza nome: {mancanti[:10]}")
    if estranei:
        problemi.append(f"{len(estranei)} nomi senza corso nei database: {estranei[:10]}")
    if not problemi:
        print(f"Copertura {len(nel_sito)}/{len(nel_sito)} su {len(file_sito)} database "
              f"(0 mancanti, 0 estranei), {len(ciclo_unico)} a ciclo unico")
    return problemi, ciclo_unico


def rendi(mappa, ciclo_unico):
    """Render nomi-corso.js.

    Args:
        mappa: {ateneo: {codice: nome}} mapping.
        ciclo_unico: Codes of the single-cycle courses.

    Returns:
        The generated JavaScript module text.
    """
    corsi = sum(len(v) for v in mappa.values())
    intestazione = INTESTAZIONE.replace("{corsi}", f"{corsi:,}".replace(",", "."))
    intestazione = intestazione.replace("{atenei}", str(len(mappa)))
    corpo = json.dumps(mappa, indent=2, ensure_ascii=False)
    codici = json.dumps(sorted(ciclo_unico), indent=2)
    return (f"{intestazione}\nexport const NOMI_CORSO = {corpo};\n"
            f"\nexport const CICLO_UNICO = new Set({codici});\n")


def scrivi(testo, solo_controllo):
    """Write the module unless check-only mode detects a mismatch.

    Args:
        testo: Generated file contents.
        solo_controllo: Whether to report differences without writing.

    Returns:
        True when the destination matches or is written successfully.
    """
    attuale = USCITA.read_text(encoding="utf-8") if USCITA.exists() else None
    nome = USCITA.relative_to(RADICE)
    if attuale == testo:
        print(f"OK: {nome} e' allineato alla sorgente.")
        return True
    if solo_controllo:
        print(f"DIVERSO: {nome} non corrisponde alla sorgente.")
        return False
    USCITA.write_text(testo, encoding="utf-8")
    print(f"Scritto {nome}")
    return True


def main():
    """Parse arguments, refresh the source if asked, and generate the module."""
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--da", action="append",
                        help="cartella dei database di una raccolta: rinfresca il TSV; "
                             "si ripete una volta per raccolta")
    parser.add_argument("--check", action="store_true",
                        help="non scrive nulla: esce con codice 1 se qualcosa non torna")
    argomenti = parser.parse_args()

    if argomenti.da:
        if argomenti.check:
            sys.exit("--da e --check insieme non hanno senso: --check non scrive niente")
        righe = []
        for voce in argomenti.da:
            cartella = Path(voce).expanduser()
            if not cartella.is_dir():
                sys.exit(f"Cartella della raccolta non trovata: {cartella}")
            righe += leggi_raccolta(cartella)
        scrivi_tsv(righe)

    if not SORGENTE.exists():
        sys.exit(f"Sorgente non trovata: {SORGENTE} (generala con --da)")

    mappa, problemi = costruisci_mappa(leggi_tsv())
    print(f"Sorgente letta: {sum(len(v) for v in mappa.values())} corsi su {len(mappa)} atenei.")
    problemi_copertura, ciclo_unico = verifica_copertura(mappa)
    problemi += problemi_copertura
    for p in problemi:
        print(f"ATTENZIONE: {p}")
    if problemi:
        # The module header states full coverage, so a module generated from
        # incomplete names would claim something false. Nothing is written.
        print(f"Niente scritto: {USCITA.relative_to(RADICE)} resta com'era.")
        return 1

    return 0 if scrivi(rendi(mappa, ciclo_unico), argomenti.check) else 1


if __name__ == "__main__":
    sys.exit(main())
