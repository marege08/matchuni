# -*- coding: utf-8 -*-
"""Harvest aggregate selections into a tidy SQLite dataset.

Each selection is downloaded, parsed into tidy rows, and saved to SQLite.
The process is resilient and can be rerun. Paths are resolved from the
repository root, so the script can be launched from any working directory.
"""

import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent

# Project modules live in tools/ and backend/src/ and import one another by
# name. Add both directories so imports work from any launch directory.
for _cartella in (RADICE / "tools", RADICE / "backend" / "src"):
    if str(_cartella) not in sys.path:
        sys.path.insert(0, str(_cartella))

from salva import apri_db, salva_righe  # noqa: E402 (after sys.path setup)
from scarica import raccogli_scheda, scarica_scheda  # noqa: E402

PAUSA_SECONDI = 1.0

# This is the database loaded by the frontend and published by the deployment,
# not a copy. Resolving it from the repository root prevents a run from
# writing an unused file while the site continues serving stale data.
DB_PATH = RADICE / "frontend" / "public" / "almalaurea.sqlite"

# Backups stay outside frontend/public because that directory is published in
# its entirety.
CARTELLA_BACKUP = RADICE / "backend" / "backup-db"


def fai_copia_di_sicurezza(db_path):
    """Back up the database before rewriting it.

    An interrupted harvest can leave a mixture of new and old sheets; the
    backup permits restoring the previous state. Return the backup path, or
    ``None`` when there was no database to copy.

    Args:
        db_path: Database path to copy.

    Returns:
        The backup path, or ``None`` when the database does not exist.
    """
    db_path = Path(db_path)
    if not db_path.exists():
        return None
    CARTELLA_BACKUP.mkdir(parents=True, exist_ok=True)
    marca = datetime.now().strftime("%Y%m%d-%H%M%S")
    destinazione = CARTELLA_BACKUP / f"{db_path.stem}-{marca}{db_path.suffix}"
    shutil.copy2(db_path, destinazione)
    return destinazione


def percorso_leggibile(percorso):
    """Return a repository-relative path when possible, otherwise the original.

    The ``--db`` option intentionally accepts absolute paths outside the
    repository; ``relative_to()`` raises ``ValueError`` for those paths, which
    must not terminate the harvest while formatting a log message.

    Args:
        percorso: Path to format.

    Returns:
        A repository-relative or original path.
    """
    percorso = Path(percorso)
    try:
        return percorso.relative_to(RADICE)
    except ValueError:
        return percorso


def etichetta_di(combo):
    """Return a readable log label for a selection from harvest.py.

    Include the survey because both surveys share one database and otherwise
    the log would not identify which one is being downloaded.

    Args:
        combo: Selection dictionary produced by a harvest generator.

    Returns:
        A survey, level, and code label.
    """
    indagine = combo["params"].get("CONFIG", "?")
    return f"{indagine}/{combo['livello']}={combo['codice']}"


def esegui(combinazioni, db_path=DB_PATH, pausa=PAUSA_SECONDI):
    """Download and save all selections.

    Each selection has the ``livello``, ``codice``, and flat ``params`` wrapper
    produced by ``genera_combinazioni()``. Return failed ``(selection, error)``
    pairs so they can be rerun independently.

    Args:
        combinazioni: Iterable of selection dictionaries.
        db_path: Destination SQLite database path.
        pausa: Delay between requests in seconds.

    Returns:
        A list of failed ``(selection, error)`` pairs.
    """
    copia = fai_copia_di_sicurezza(db_path)
    if copia:
        print(f"Copia di sicurezza del database: {percorso_leggibile(copia)}")
    print(f"Scrivo su: {percorso_leggibile(db_path)}\n")

    conn = apri_db(db_path)
    falliti = []
    combinazioni = list(combinazioni)
    totale = len(combinazioni)

    try:
        for n, combo in enumerate(combinazioni, start=1):
            params = combo["params"]  # Flat parameters for visualizza.php.
            etichetta = etichetta_di(combo)
            try:
                html = scarica_scheda(params)
                righe = raccogli_scheda(html, params)
                n_salvate = salva_righe(conn, righe)
                print(f"[{n}/{totale}] OK  {etichetta}  ({n_salvate} righe)")
            except (
                Exception
            ) as e:  # Isolate network, latency, and unexpected-structure failures.
                print(f"[{n}/{totale}] FALLITO  {etichetta}  -> {e}")
                falliti.append((combo, str(e)))
            time.sleep(pausa)  # Keep request frequency moderate.

        # Inspect the whole dataset for unexpected cell formats. This provides
        # coverage across 93 sheets without requiring manual inspection.
        rossi = conn.execute(
            "SELECT sezione, indicatore, valore_raw FROM dati "
            "WHERE nota = 'non_riconosciuto' LIMIT 10"
        ).fetchall()
        n_rossi = conn.execute(
            "SELECT COUNT(*) FROM dati WHERE nota = 'non_riconosciuto'"
        ).fetchone()[0]
    finally:
        conn.close()  # Close even on interruption; committed data remains.

    print(f"\nFatto. {totale - len(falliti)}/{totale} schede salvate.")
    print(f"Valori non riconosciuti su tutto il dataset (attesi 0): {n_rossi}")
    for sez, ind, raw in rossi:
        print(f"  - {sez} / {ind} = {raw!r}")
    if falliti:
        print(f"Falliti ({len(falliti)}): ", [etichetta_di(c) for c, _ in falliti])
        print(
            "Rilancia l'harvester (o solo questi) quando vuoi: la riscrittura e' sicura."
        )
    return falliti


def scopri_corsi(atenei, gruppi, filtro, config="profilo", pausa=PAUSA_SECONDI):
    """Discover courses containing ``filtro`` at each university and group.

    Return ``{university: [(group, code, name), ...]}``, ready for
    ``genera_corsi()``. An empty dropdown or HTTP error means that the
    university has no course in that group; both cases are skipped without
    stopping discovery. A course may appear in two groups with the same code;
    for example, Bologna lists "ingegneria e scienze informatiche" in both
    groups 10 and 12. Only its first occurrence is retained to avoid
    downloading one sheet twice under different labels.

    Args:
        atenei: University codes to inspect.
        gruppi: Disciplinary-group codes to inspect.
        filtro: Case-insensitive substring required in a course name.
        config: Survey identifier.
        pausa: Delay between requests in seconds.

    Returns:
        A mapping from university codes to course tuples.
    """
    from harvest import params_tendine
    from scarica import leggi_tendine

    trovati = {}
    for ateneo in atenei:
        visti = set()
        for gruppo in gruppi:
            try:
                tendine = leggi_tendine(params_tendine(ateneo, gruppo, config=config))
            except Exception as e:  # HTTP 400/500 means the combination is absent.
                print(f"  {ateneo}/gr.{gruppo}: tendine non disponibili ({e.__class__.__name__})")
                time.sleep(pausa)
                continue
            for codice, nome in tendine.get("postcorso", []):
                if filtro.lower() in nome.lower() and codice not in visti:
                    visti.add(codice)
                    trovati.setdefault(ateneo, []).append((gruppo, codice, nome))
                    print(f"  {ateneo}/gr.{gruppo}: {nome}  [{codice}]")
            time.sleep(pausa)
    return trovati


if __name__ == "__main__":
    # Aggregate selections are defined in backend/src/harvest.py.
    from harvest import INDAGINI, genera_combinazioni, genera_corsi, genera_incroci
    from harvest import ATENEI_INCROCIO

    # Select a survey. Both share one database, while ``indagine`` keeps their
    # rows separate, so downloading one does not alter the other.
    #
    # --incrocio downloads university-by-group sheets not present in the 93
    # aggregates. It must be paired with --db because these analytical rows
    # belong in a separate database rather than the published one.
    #   python3 tools/esegui_harvest.py occupazione --incrocio \
    #       --db backend/backup-db/incrocio.sqlite
    argomenti = sys.argv[1:]
    incrocio = "--incrocio" in argomenti
    if incrocio:
        argomenti.remove("--incrocio")

    # --corsi discovers course-level options with solotendine.php and downloads
    # only names containing --filtro. Like --incrocio, it requires --db because
    # these are analytical rows rather than a published site product.
    corsi = "--corsi" in argomenti
    if corsi:
        argomenti.remove("--corsi")

    filtro = "informatic"
    gruppi_corsi = ["12"]  # Industrial and Information Engineering.
    for opzione, destinazione in (("--filtro", "filtro"), ("--gruppi", "gruppi")):
        if opzione in argomenti:
            i = argomenti.index(opzione)
            if i + 1 >= len(argomenti):
                sys.exit(f"{opzione} vuole un valore dopo di se'.")
            valore = argomenti[i + 1]
            if destinazione == "filtro":
                filtro = valore
            else:
                gruppi_corsi = [g.strip() for g in valore.split(",") if g.strip()]
            del argomenti[i : i + 2]

    db_path = DB_PATH
    if "--db" in argomenti:
        i = argomenti.index("--db")
        if i + 1 >= len(argomenti):
            sys.exit("--db vuole un percorso di file dopo di se'.")
        scelto = Path(argomenti[i + 1])
        db_path = scelto if scelto.is_absolute() else RADICE / scelto
        db_path.parent.mkdir(parents=True, exist_ok=True)
        del argomenti[i : i + 2]

    # Prevent partial analytical data from overwriting the site's database.
    if (incrocio or corsi) and db_path == DB_PATH:
        quale = "--incrocio" if incrocio else "--corsi"
        sys.exit(
            f"{quale} senza --db riscriverebbe il database pubblicato dal sito.\n"
            "Indica un file separato, es: --db backend/backup-db/incrocio.sqlite"
        )
    if incrocio and corsi:
        sys.exit("--incrocio e --corsi sono due livelli diversi: uno per volta.")

    indagine = argomenti[0] if argomenti else "profilo"
    if indagine not in INDAGINI:
        sys.exit(f"Indagine sconosciuta: {indagine!r}. Attese: {', '.join(INDAGINI)}")

    if corsi:
        print(f"Scoperta dei corsi (gruppi {', '.join(gruppi_corsi)}, filtro {filtro!r}):")
        mappa = scopri_corsi(ATENEI_INCROCIO, gruppi_corsi, filtro, config=indagine)
        quanti = sum(len(v) for v in mappa.values())
        if not quanti:
            sys.exit(f"\nNessun corso trovato col filtro {filtro!r}. Niente da scaricare.")
        print(f"\nTrovati {quanti} corsi in {len(mappa)} atenei.")
        combinazioni = genera_corsi(mappa, config=indagine)
        livello = f"corso (filtro {filtro!r})"
    else:
        genera = genera_incroci if incrocio else genera_combinazioni
        combinazioni = list(genera(config=indagine))
        livello = "ateneo x gruppo" if incrocio else "aggregati (ateneo, gruppo)"

    print(f"Indagine: {indagine}")
    print(f"Livello: {livello}")
    print(f"Combinazioni da scaricare: {len(combinazioni)}\n")
    esegui(combinazioni, db_path=db_path)

    if incrocio or corsi:
        print(
            "\nSalvato in un database a parte: il sito non lo vede e non e' cambiato\n"
            "nulla in frontend/public. Si interroga in SQL."
        )
    else:
        print(
            "\nDati aggiornati. Ora rigenera i file derivati, altrimenti la UI resta\n"
            "disallineata dal database:\n"
            "    python3 tools/genera_config_filtri.py\n"
            "    python3 tools/genera_nomi.py\n"
            "Poi controlla con python3 -m http.server 8000 -d frontend/public\n"
            "e fai commit+push (il push pubblica)."
        )
