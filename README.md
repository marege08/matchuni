# lafuori — confronto dei dati sui laureati

Web app gratuita per orientarsi nella scelta del corso di laurea in Italia.
Confronta i dati ufficiali di [AlmaLaurea](https://www.almalaurea.it/) — le
indagini *Profilo dei laureati* e *Condizione occupazionale* — fra **atenei** e
**gruppi disciplinari**.

**Sito pubblico:** <https://marege08.github.io/lafuori/>

## Cosa fa

- Metti a confronto due o più atenei / gruppi disciplinari / corsi, colonna per
  colonna.
- **In sintesi**: sopra la tabella, sei schede con le domande che contano di più
  per scegliere (quanti lavorano, quanto guadagnano, quanto aspettano il primo
  lavoro, quanto la laurea serve nel lavoro, quanti si laureano in corso, quanti
  rifarebbero la stessa scelta). Sotto ogni titolo c'è il nome esatto della
  domanda AlmaLaurea.
- **Scheda del corso**: cerchi un corso di primo livello e lo vedi accanto al suo
  ateneo e alla sua area disciplinare, con la numerosità del campione e un
  avviso quando è troppo piccolo. Ogni scheda ha un indirizzo proprio
  (`#scheda/<ateneo>/<corso>`) che si può condividere.
- Scegli quali delle 101 domande vedere (regolarità negli studi, voto di laurea,
  conoscenze linguistiche, profilo dello studente…) più la categoria **Dopo la
  Laurea**, che è l'indagine sull'occupazione a 1/3/5 anni: tasso di
  occupazione, retribuzione, tipo di contratto, dove si finisce a lavorare.
- Per l'occupazione scegli anche **quale definizione di «occupato»** usare —
  ampia o restrittiva. Sono le due definizioni ufficiali di AlmaLaurea, danno
  numeri diversi sulla stessa domanda, e il sito dice in chiaro cosa cambia.
- Facoltativo: descrivi il confronto **a parole** e un'AI a tua scelta imposta
  colonne e domande al posto tuo.

## I tre vincoli che decidono tutto

1. **Costo zero strutturale.** Nessun server acceso a runtime. Il sito è statico
   e il database viene interrogato **dentro il browser**. Non è "gratis se il
   traffico resta basso": è gratis per come è costruito.
2. **Fedeltà al dato.** Ogni numero mostrato viene dal dataset ufficiale. Non si
   ricalcola, non si stima, e soprattutto **non lo genera un modello** — vedi
   *Come funziona l'AI* più sotto.
3. **Citazione della fonte.** I dati sono di AlmaLaurea, licenza CC BY-NC: uso
   non commerciale con attribuzione visibile.

## Architettura reale

```
menu a tendina del sito AlmaLaurea          schede statistiche pubbliche
  backend/dati-sorgente/ateneo-numero.txt     (scaricate da tools/esegui_harvest.py)
            |                                            |
            | tools/genera_nomi.py                       | backend/src/{harvest,pulizia}.py
            v                                            v
  js/nomi-ateneo.js, js/nomi-gruppo.js        frontend/public/almalaurea.sqlite
                          \                    /        (29.760 righe, tidy/long)
                           \                  / tools/genera_config_filtri.py
                            v                v
                        frontend/public/js/config-filtri.js
                                       |
                                       v
             index.html + style.css + js/app.js   <-- sito statico
                                       |
                                       +-- sql.js (da CDN) esegue le query nel browser
                                       +-- js/ai/  strato AI opzionale (BYOK)
```

**Niente bundler, niente framework.** Sono moduli ES nativi serviti come file:
si apre il sorgente e si legge quello che gira. `sql.js` arriva da CDN a
versione fissata.

## Struttura del progetto

```
.github/workflows/deploy.yml   pubblica frontend/public su GitHub Pages a ogni push su main
backend/
  dati-sorgente/               le tendine del sito AlmaLaurea da cui nascono i nomi
  src/harvest.py               le 93 selezioni da scaricare (78 atenei + 15 gruppi)
  src/pulizia.py               interpreta una cella: numero, oppure simbolo (* - /)
  tests/                       test del validatore AI, prova di sql.js, test nel browser
frontend/public/               TUTTO ciò che viene pubblicato
  almalaurea.sqlite            il dataset (unica fonte di verità)
  index.html  style.css
  js/app.js                    carica il DB, disegna filtri e tabella
  js/config-filtri.js          le 101 domande       (GENERATO)
  js/nomi-ateneo.js            codice -> nome       (GENERATO)
  js/nomi-gruppo.js            codice -> nome       (GENERATO)
  js/processData.js            valore/simbolo -> testo di cella
  js/indicatori-chiave.js      le domande del cruscotto e della scheda del corso (scritto a mano)
  js/ai/                       strato AI opzionale (vedi sotto)
tools/
  esegui_harvest.py            scarica le schede e riempie il database
  scarica.py  salva.py         download di una scheda / scrittura su SQLite
  genera_config_filtri.py      rigenera config-filtri.js dal database
  genera_nomi.py               rigenera nomi-ateneo.js e nomi-gruppo.js
  serve.sh                     server statico locale
```

I tre file marcati **GENERATO** non si modificano a mano: si rigenerano.

## Farla girare in locale

```bash
./tools/serve.sh          # poi apri http://localhost:8000
./tools/serve.sh 8080     # su un'altra porta
```

Non aprire `index.html` con un doppio click: la pagina usa moduli ES e scarica
il database via `fetch`, quindi serve un server HTTP vero, anche solo locale.

## Come funziona l'AI (Fase 2, opzionale)

L'AI è **BYOK**: la colleghi tu, dal pannello "Collega la tua AI", e parla
direttamente dal tuo browser al provider che scegli. Il progetto non ha chiavi,
non fa da tramite e non paga nulla. Due forme di API coprono quasi tutto:

- **OpenAI-compatibile** — OpenAI, la maggior parte dei provider cloud, e i
  runner locali: Ollama (`http://localhost:11434/v1`), LM Studio
  (`http://localhost:1234/v1`), llama.cpp, vLLM.
- **Anthropic** — `https://api.anthropic.com`.

**L'AI non tocca mai un numero.** Ha un solo strumento a disposizione,
`imposta_confronto`, e nel suo schema non esiste un campo "valore": può scegliere
quali colonne e quali domande mostrare, e nient'altro. Poi
`js/ai/validatore.js` ricontrolla ogni codice e ogni id contro il vocabolario
reale e **scarta quello che non esiste**, prima che tocchi la pagina. È questo
secondo controllo a rendere sicura la promessa "collega qualsiasi AI, anche un
modellino locale traballante": non ci si fida del modello, ci si fida della
validazione. Il caso peggiore è "ha scelto male, correggi a mano", mai "un numero
sbagliato in tabella".

Senza AI collegata il sito funziona al 100% con i filtri manuali.

**Modello locale e permessi (CORS).** Un runner locale rifiuta di default le
richieste che arrivano da un sito web e va autorizzato una volta sola. Le
istruzioni sono **dentro la pagina**, nel pannello AI, sotto *"L'AI locale non
risponde? Apri qui"*, e riportano l'indirizzo esatto da autorizzare. Se la
chiamata fallisce, la pagina apre quel blocco da sola invece di lasciare un
errore muto.

## Come si aggiornano i dati

I dati AlmaLaurea escono circa una volta l'anno. L'aggiornamento è questa
catena, in quest'ordine:

```bash
# 1. scarica le 93 schede e riscrive il database, UNA INDAGINE PER VOLTA
#    (fa da sola una copia di sicurezza in backend/backup-db/)
python3 tools/esegui_harvest.py              # profilo (predefinito)
python3 tools/esegui_harvest.py occupazione  # esiti occupazionali

# 2. rigenera i file derivati dal database: SEMPRE tutti e due
python3 tools/genera_config_filtri.py
python3 tools/genera_nomi.py

# 3. guarda il risultato prima di pubblicare
./tools/serve.sh
node backend/tests/test-browser.mjs

# 4. pubblica: il push su main fa partire il deploy da solo
git add -A && git commit -m "Dati aggiornati" && git push
```

Le due indagini convivono nello stesso database, tenute separate dalla colonna
`indagine`: scaricarne una non tocca le righe dell'altra.

Gli script calcolano i percorsi dalla radice del progetto: si lanciano da
qualunque cartella e colpiscono sempre il database giusto, quello che il sito
pubblica davvero.

`genera_config_filtri.py` e `genera_nomi.py` accettano `--check`: non scrivono
nulla ed escono con codice 1 se i file sul disco non corrispondono più al
database. Serve ad accorgersi di un disallineamento senza sovrascrivere niente.

**Da sapere prima di un aggiornamento annuale.** Gli id delle domande in
`config-filtri.js` sono derivati dalle etichette di AlmaLaurea (minuscolo,
accenti tolti, troncato a 80 caratteri). Se AlmaLaurea cambia il testo di una
domanda, **cambia anche il suo id**. Non rompe nulla di per sé — la UI e lo
strato AI leggono gli id dallo stesso file — ma i tre file generati vanno
rigenerati *insieme* al database, mai uno sì e uno no.

E un avvertimento pratico: se l'harvest si interrompe a metà, il database resta
un misto di schede nuove e vecchie. La copia in `backend/backup-db/` è lì per
tornare indietro.

**La trappola dell'indagine `occupazione`.** La sua scheda contiene *due volte*
le stesse sezioni, una per ciascuna definizione ufficiale di «occupato», con
sezione, categoria e indicatore identici. A distinguerle è solo la classe CSS
del blocco: il secondo è lo stesso indice **+100** (`datiprofilo4` contro
`datiprofilo104`). Senza la colonna `definizione` una sovrascriverebbe l'altra
in silenzio, e a Bari «Non hanno mai lavorato dopo la laurea» vale 29,4 con una
e 35,7 con l'altra. Attenzione al caso limite: **un blocco senza gemello è
condiviso, non restrittivo** — è quello che succede a `datiprofilo3`
("2b. Formazione post-laurea"), che il JavaScript di AlmaLaurea non nasconde in
nessuna delle due modalità. Quelle righe prendono `definizione = 'condivisa'` e
vanno mostrate sempre, qualunque definizione l'utente scelga. Presumere che
"non è ≥100" volesse dire "restrittiva" aveva marchiato male 837 righe.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) pubblica `frontend/public/` su
GitHub Pages a ogni push su `main`. Non c'è niente da fare a mano: **il push è
la pubblicazione.**

## Test

```bash
node backend/tests/test-validatore.mjs   # il "muro" che scarta l'output AI non valido
node backend/tests/test-browser.mjs      # l'app vera, dentro Chrome headless

# le stesse verifiche sul sito gia' pubblicato: e' il modo di sapere che il
# deploy e' andato davvero, invece di dire "dovrebbe essere online"
node backend/tests/test-browser.mjs --url https://marege08.github.io/almalaurea/
```

`test-browser.mjs` avvia da solo un server statico e Chrome headless, aspetta
che `sql.js` abbia caricato il database e poi interroga il DOM vero: la tabella
si popola, il selettore di definizione c'è, cambiare definizione cambia sia le
domande consultabili sia i numeri (a Bari 29,4 con la definizione ampia, 35,7
con la restrittiva), la console è pulita. **Zero dipendenze:** Chrome è già
sulla macchina e Node 22 ha `WebSocket` globale, quindi si pilota Chrome via
DevTools Protocol senza installare niente. `--vedi` lascia il browser visibile.

`backend/tests/test-sqljs.html` è una pagina autonoma che verifica il
caricamento di `sql.js` sul database reale (servila con `serve.sh`).

## Dati e licenza

I dati provengono dalle schede statistiche pubbliche di AlmaLaurea, licenza
CC BY-NC: riproduzione non commerciale con citazione della fonte, che il sito
riporta in fondo a ogni pagina. Sono aggregati e anonimi, quindi non c'è materia
GDPR. L'estrazione gira a frequenza educata (una pausa di 1 secondo fra le
richieste) e con uno User-Agent che si identifica onestamente.

Il codice è rilasciato sotto licenza MIT.

## Stato

| Fase | Cosa | Stato |
|------|------|-------|
| 0 | Harvester + dataset pulito | Completata |
| 1 | UI di confronto statica | Completata, online |
| 2 | Strato AI BYOK (text-to-query) | Completata, online |
