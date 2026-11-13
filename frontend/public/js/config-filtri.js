/**
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

export const CONFIG_FILTRI = {
  "Successo e Percorso": [
    {
      "id": "hanno_precedenti_esperienze_universitarie",
      "label": "Hanno precedenti esperienze universitarie (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "",
      "indicatori": [
        "Hanno precedenti esperienze universitarie (%)"
      ]
    },
    {
      "id": "nessuna_precedente_esperienza_universitaria",
      "label": "Nessuna precedente esperienza universitaria",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "",
      "indicatori": [
        "Nessuna precedente esperienza universitaria"
      ]
    },
    {
      "id": "non_portate_a_termine",
      "label": "Non portate a termine",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "",
      "indicatori": [
        "Non portate a termine"
      ]
    },
    {
      "id": "portate_a_termine",
      "label": "Portate a termine",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "",
      "indicatori": [
        "Portate a termine"
      ]
    },
    {
      "id": "ateneo_di_conseguimento_del_precedente_titolo_universitario_per_100_che_hanno_un",
      "label": "Ateneo di conseguimento del precedente titolo universitario(per 100 che hanno un precedente titolo di primo livello italiano)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "Ateneo di conseguimento del precedente titolo universitario(per 100 che hanno un precedente titolo di primo livello italiano)",
      "indicatori": [
        "Altro Ateneo del Centro",
        "Altro Ateneo del Nord",
        "Altro Ateneo del Sud-Isole",
        "Altro Ateneo italiano telematico",
        "Stesso Ateneo della laurea magistrale"
      ],
      "soloCorso": true
    },
    {
      "id": "eta_all_immatricolazione",
      "label": "Età all'immatricolazione (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "Età all'immatricolazione (%)",
      "indicatori": [
        "2 o più anni di ritardo",
        "Punteggio degli esami (medie, in 30-mi)",
        "Regolare o 1 anno di ritardo"
      ]
    },
    {
      "id": "gruppo_disciplinare_del_precedente_titolo_universitario_per_100_che_hanno_un_pre",
      "label": "Gruppo disciplinare del precedente titolo universitario(per 100 che hanno un precedente titolo di primo livello italiano)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "Gruppo disciplinare del precedente titolo universitario(per 100 che hanno un precedente titolo di primo livello italiano)",
      "indicatori": [
        "Altra area disciplinare",
        "Altro gruppo della laurea magistrale ma stessa area disciplinare",
        "Stesso gruppo disciplinare della laurea magistrale"
      ],
      "soloCorso": true
    },
    {
      "id": "motivazione_principale_nella_scelta_di_un_corso_completamente_in_teledidattica_p",
      "label": "Motivazione principale nella scelta di un corso completamente in teledidattica(per 100 con titolo in Atenei telematici)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "Motivazione principale nella scelta di un corso completamente in teledidattica(per 100 con titolo in Atenei telematici)",
      "indicatori": [
        "Disponibilità, in qualsiasi momento, del materiale didattico online",
        "Possibilità di mettersi in contatto con i docenti più facilmente",
        "Possibilità di organizzare meglio il proprio tempo",
        "Possibilità di seguire le lezioni online senza la necessità di raggiungere la sede"
      ]
    },
    {
      "id": "motivazioni_molto_importanti_nella_scelta_del_corso_di_laurea",
      "label": "Motivazioni molto importanti nella scelta del corso di laurea (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "Motivazioni molto importanti nella scelta del corso di laurea (%)",
      "indicatori": [
        "Fattori prevalentemente culturali",
        "Fattori prevalentemente professionalizzanti",
        "Fattori sia culturali sia professionalizzanti",
        "Né gli uni né gli altri"
      ]
    },
    {
      "id": "regolarita_negli_studi",
      "label": "Regolarità negli studi",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "Regolarità negli studi",
      "indicatori": [
        "1° anno fuori corso",
        "2° anno fuori corso",
        "3° anno fuori corso",
        "4° anno fuori corso",
        "5° anno fuori corso e oltre",
        "Durata degli studi (medie, in anni)",
        "In corso",
        "Indice di ritardo (rapporto fra ritardo e durata normale del corso)",
        "Ritardo alla laurea (medie, in anni)"
      ]
    },
    {
      "id": "regolarita_negli_studi_del_precedente_titolo_universitario_per_100_che_hanno_un",
      "label": "Regolarità negli studi del precedente titolo universitario(per 100 che hanno un precedente titolo di primo livello italiano in Atenei non telematici)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "Regolarità negli studi del precedente titolo universitario(per 100 che hanno un precedente titolo di primo livello italiano in Atenei non telematici)",
      "indicatori": [
        "1° anno fuori corso",
        "2° anno fuori corso e oltre",
        "In corso",
        "Voto di laurea del precedente titolo universitario(medie, in 110-mi; per 100 che hanno un precedente titolo di primo livello italiano)"
      ],
      "soloCorso": true
    },
    {
      "id": "titolo_universitario_precedente_all_iscrizione_alla_laurea_magistrale",
      "label": "Titolo universitario precedente all'iscrizione alla laurea magistrale (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "Titolo universitario precedente all'iscrizione alla laurea magistrale (%)",
      "indicatori": [
        "Altro titolo italiano",
        "Titolo di primo livello italiano",
        "Titolo estero"
      ],
      "soloCorso": true
    },
    {
      "id": "voto_di_laurea",
      "label": "Voto di laurea (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "4. RIUSCITA NEGLI STUDI UNIVERSITARI",
      "categoria": "Voto di laurea (%)",
      "indicatori": [
        "110 e lode",
        "Voto di laurea (medie, in 110-mi)",
        "da 100 a 104",
        "da 105 a 110",
        "meno di 100"
      ]
    },
    {
      "id": "altra_laurea_di_primo_livello",
      "label": "Altra laurea di primo livello",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Altra laurea di primo livello"
      ],
      "soloCorso": true
    },
    {
      "id": "altra_laurea_magistrale_a_ciclo_unico",
      "label": "Altra laurea magistrale a ciclo unico",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Altra laurea magistrale a ciclo unico"
      ],
      "soloCorso": true
    },
    {
      "id": "altra_laurea_magistrale_biennale",
      "label": "Altra laurea magistrale biennale",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Altra laurea magistrale biennale"
      ],
      "soloCorso": true
    },
    {
      "id": "altre_attivita_di_qualificazione_professionale",
      "label": "Altre attività di qualificazione professionale",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Altre attività di qualificazione professionale"
      ]
    },
    {
      "id": "altro_tipo_di_master_o_corso_di_perfezionamento",
      "label": "Altro tipo di master o corso di perfezionamento",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Altro tipo di master o corso di perfezionamento"
      ]
    },
    {
      "id": "altro_titolo_equiparato_alla_laurea",
      "label": "Altro titolo equiparato alla laurea",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Altro titolo equiparato alla laurea"
      ]
    },
    {
      "id": "attivita_sostenuta_da_borsa_o_assegno_di_studio",
      "label": "Attività sostenuta da borsa o assegno di studio",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Attività sostenuta da borsa o assegno di studio"
      ]
    },
    {
      "id": "dottorato_di_ricerca",
      "label": "Dottorato di ricerca",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Dottorato di ricerca"
      ]
    },
    {
      "id": "intendono_proseguire_gli_studi_dopo_il_conseguimento_del_titolo",
      "label": "Intendono proseguire gli studi dopo il conseguimento del titolo (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Intendono proseguire gli studi dopo il conseguimento del titolo (%)"
      ]
    },
    {
      "id": "laurea_di_primo_livello",
      "label": "Laurea di primo livello",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Laurea di primo livello"
      ]
    },
    {
      "id": "laurea_magistrale_a_ciclo_unico",
      "label": "Laurea magistrale a ciclo unico",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Laurea magistrale a ciclo unico"
      ]
    },
    {
      "id": "laurea_magistrale_biennale",
      "label": "Laurea magistrale biennale",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Laurea magistrale biennale"
      ]
    },
    {
      "id": "master_universitario",
      "label": "Master universitario",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Master universitario"
      ]
    },
    {
      "id": "non_intendono_proseguire",
      "label": "Non intendono proseguire",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Non intendono proseguire"
      ]
    },
    {
      "id": "scuola_di_specializzazione_post_laurea",
      "label": "Scuola di specializzazione post-laurea",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Scuola di specializzazione post-laurea"
      ]
    },
    {
      "id": "tirocinio_praticantato",
      "label": "Tirocinio, praticantato",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "",
      "indicatori": [
        "Tirocinio, praticantato"
      ]
    },
    {
      "id": "ateneo_a_cui_intendono_iscriversi_per_100_che_intendono_iscriversi_ad_una_laurea",
      "label": "Ateneo a cui intendono iscriversi(per 100 che intendono iscriversi ad una laurea magistrale biennale)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "Ateneo a cui intendono iscriversi(per 100 che intendono iscriversi ad una laurea magistrale biennale)",
      "indicatori": [
        "Altro Ateneo del Centro",
        "Altro Ateneo del Nord",
        "Altro Ateneo del Sud-Isole",
        "Altro Ateneo italiano telematico",
        "Ateneo estero",
        "Stesso Ateneo della laurea di primo livello"
      ],
      "soloCorso": true
    },
    {
      "id": "motivo_principale_dell_iscrizione_ad_un_corso_di_laurea_magistrale_biennale_per",
      "label": "Motivo principale dell'iscrizione ad un corso di laurea magistrale biennale(per 100 che intendono iscriversi ad una laurea magistrale biennale)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "9. PROSPETTIVE DI STUDIO",
      "categoria": "Motivo principale dell'iscrizione ad un corso di laurea magistrale biennale(per 100 che intendono iscriversi ad una laurea magistrale biennale)",
      "indicatori": [
        "Per completare/arricchire la formazione",
        "Si tratta di una scelta \"quasi obbligata\" per poter accedere al mondo del lavoro"
      ],
      "soloCorso": true
    }
  ],
  "Esperienza Universitaria": [
    {
      "id": "hanno_ritenuto_adeguata_la_supervisione_della_prova_finale_per_100_per_cui_era_p",
      "label": "Hanno ritenuto adeguata la supervisione della prova finale(per 100 per cui era prevista la supervisione della prova finale)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Hanno ritenuto adeguata la supervisione della prova finale(per 100 per cui era prevista la supervisione della prova finale)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "hanno_ritenuto_adeguato_il_materiale_didattico_indicato_o_fornito_per_la_prepara",
      "label": "Hanno ritenuto adeguato il materiale didattico (indicato o fornito) per la preparazione degli esami (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Hanno ritenuto adeguato il materiale didattico (indicato o fornito) per la preparazione degli esami (%)",
      "indicatori": [
        "Mai o quasi mai",
        "Per meno della metà degli esami",
        "Per più della metà degli esami",
        "Sempre o quasi sempre"
      ]
    },
    {
      "id": "hanno_ritenuto_il_carico_di_studio_degli_insegnamenti_adeguato_alla_durata_del_c",
      "label": "Hanno ritenuto il carico di studio degli insegnamenti adeguato alla durata del corso di studio (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Hanno ritenuto il carico di studio degli insegnamenti adeguato alla durata del corso di studio (%)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Era prevista la supervisione della prova finale (%)",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "hanno_ritenuto_l_organizzazione_degli_esami_appelli_orari_informazioni_prenotazi",
      "label": "Hanno ritenuto l'organizzazione degli esami (appelli, orari, informazioni, prenotazioni, ...) soddisfacente (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Hanno ritenuto l'organizzazione degli esami (appelli, orari, informazioni, prenotazioni, ...) soddisfacente (%)",
      "indicatori": [
        "Mai o quasi mai",
        "Per meno della metà degli esami",
        "Per più della metà degli esami",
        "Sempre o quasi sempre"
      ]
    },
    {
      "id": "i_risultati_degli_esami_hanno_rispecchiato_l_effettiva_preparazione",
      "label": "I risultati degli esami hanno rispecchiato l'effettiva preparazione (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "I risultati degli esami hanno rispecchiato l'effettiva preparazione (%)",
      "indicatori": [
        "Mai o quasi mai",
        "Per meno della metà degli esami",
        "Per più della metà degli esami",
        "Sempre o quasi sempre"
      ]
    },
    {
      "id": "si_iscriverebbero_di_nuovo_all_universita",
      "label": "Si iscriverebbero di nuovo all'università? (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Si iscriverebbero di nuovo all'università? (%)",
      "indicatori": [
        "Non si iscriverebbero più all'università",
        "Sì, allo stesso corso dell'Ateneo",
        "Sì, allo stesso corso ma in un altro Ateneo",
        "Sì, ma ad un altro corso dell'Ateneo",
        "Sì, ma ad un altro corso e in un altro Ateneo"
      ]
    },
    {
      "id": "sono_complessivamente_soddisfatti_del_corso_di_laurea",
      "label": "Sono complessivamente soddisfatti del corso di laurea (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono complessivamente soddisfatti del corso di laurea (%)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_complessivamente_soddisfatti_delle_attivita_didattiche_lezioni_esercitazion",
      "label": "Sono complessivamente soddisfatti delle attività didattiche (lezioni, esercitazioni, simulazioni, ...) (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono complessivamente soddisfatti delle attività didattiche (lezioni, esercitazioni, simulazioni, ...) (%)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_dei_corsi_integrativi_laboratori_online_per_100_fruitori",
      "label": "Sono soddisfatti dei corsi integrativi/laboratori online(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti dei corsi integrativi/laboratori online(per 100 fruitori)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Hanno avuto accesso a software/virtual machine, … (%)",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_dei_rapporti_con_gli_studenti",
      "label": "Sono soddisfatti dei rapporti con gli studenti (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti dei rapporti con gli studenti (%)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Hanno utilizzato le aule (%)",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_dei_rapporti_con_i_collaboratori_dei_docenti",
      "label": "Sono soddisfatti dei rapporti con i collaboratori dei docenti (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti dei rapporti con i collaboratori dei docenti (%)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Più no che sì",
        "Più sì che no",
        "Sono stati seguiti da un tutor durante il corso di laurea (%)"
      ]
    },
    {
      "id": "sono_soddisfatti_dei_rapporti_con_i_docenti_in_generale",
      "label": "Sono soddisfatti dei rapporti con i docenti in generale (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti dei rapporti con i docenti in generale (%)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_dei_servizi_amministrativi_online_per_100_fruitori",
      "label": "Sono soddisfatti dei servizi amministrativi online(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti dei servizi amministrativi online(per 100 fruitori)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_dei_servizi_bibliotecari_online_per_100_fruitori",
      "label": "Sono soddisfatti dei servizi bibliotecari online(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti dei servizi bibliotecari online(per 100 fruitori)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Hanno utilizzato le attrezzature per le altre attività didattiche (laboratori, attività pratiche, ...) (%)",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_dei_servizi_delle_segreterie_studenti_per_100_fruitori",
      "label": "Sono soddisfatti dei servizi delle segreterie studenti(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti dei servizi delle segreterie studenti(per 100 fruitori)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Hanno usufruito dei servizi amministrativi online (modulistica, iscrizioni, tasse, ...) (%)",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_dei_servizi_di_forum_spazi_di_condivisione_on_line_con_i_docent",
      "label": "Sono soddisfatti dei servizi di forum/spazi di condivisione on line con i docenti(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti dei servizi di forum/spazi di condivisione on line con i docenti(per 100 fruitori)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Hanno utilizzato gli spazi dedicati allo studio individuale (%)",
        "Non li hanno utilizzati in quanto non presenti",
        "Non li hanno utilizzati nonostante fossero presenti",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_dei_servizi_di_orientamento_allo_studio_post_laurea_per_100_fru",
      "label": "Sono soddisfatti dei servizi di orientamento allo studio post-laurea(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti dei servizi di orientamento allo studio post-laurea(per 100 fruitori)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Hanno usufruito di iniziative formative di orientamento al lavoro (%)",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_dei_servizi_di_prenotazione_online_di_strutture_fisiche_per_100",
      "label": "Sono soddisfatti dei servizi di prenotazione online di strutture fisiche(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti dei servizi di prenotazione online di strutture fisiche(per 100 fruitori)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Hanno usufruito dei servizi di orientamento allo studio post-laurea (%)",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_dei_servizi_di_sostegno_alla_ricerca_del_lavoro_per_100_fruitor",
      "label": "Sono soddisfatti dei servizi di sostegno alla ricerca del lavoro(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti dei servizi di sostegno alla ricerca del lavoro(per 100 fruitori)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Hanno usufruito dell'ufficio/servizi job placement (%)",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_del_rapporto_con_il_tutor_per_100_che_sono_stati_seguiti_da_un",
      "label": "Sono soddisfatti del rapporto con il tutor(per 100 che sono stati seguiti da un tutor)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti del rapporto con il tutor(per 100 che sono stati seguiti da un tutor)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_dell_organizzazione_dell_ufficio_servizi_job_placement_per_100",
      "label": "Sono soddisfatti dell'organizzazione dell'ufficio/servizi job placement(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti dell'organizzazione dell'ufficio/servizi job placement(per 100 fruitori)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Hanno usufruito dei servizi delle segreterie studenti (%)",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_della_fruizione_dei_software_virtual_machine_per_100_fruitori",
      "label": "Sono soddisfatti della fruizione dei software/virtual machine, ...(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti della fruizione dei software/virtual machine, ...(per 100 fruitori)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Hanno usufruito dei servizi di forum/spazi di condivisione on line con i docenti (%)",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_delle_iniziative_formative_di_orientamento_al_lavoro_per_100_fr",
      "label": "Sono soddisfatti delle iniziative formative di orientamento al lavoro(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Sono soddisfatti delle iniziative formative di orientamento al lavoro(per 100 fruitori)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Hanno usufruito dei servizi di sostegno alla ricerca del lavoro (%)",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "valutazione_degli_spazi_dedicati_allo_studio_individuale_per_100_fruitori",
      "label": "Valutazione degli spazi dedicati allo studio individuale(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Valutazione degli spazi dedicati allo studio individuale(per 100 fruitori)",
      "indicatori": [
        "Adeguati",
        "Hanno utilizzato i servizi di prenotazione online di strutture fisiche (%)",
        "Inadeguati"
      ]
    },
    {
      "id": "valutazione_dei_servizi_di_biblioteca_prestito_consultazione_orari_di_apertura_p",
      "label": "Valutazione dei servizi di biblioteca (prestito/consultazione, orari di apertura, ...)(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Valutazione dei servizi di biblioteca (prestito/consultazione, orari di apertura, ...)(per 100 fruitori)",
      "indicatori": [
        "Abbastanza negativa",
        "Abbastanza positiva",
        "Decisamente negativa",
        "Decisamente positiva",
        "Hanno utilizzato i servizi bibliotecari online (%)"
      ]
    },
    {
      "id": "valutazione_delle_attrezzature_per_le_altre_attivita_didattiche_laboratori_attiv",
      "label": "Valutazione delle attrezzature per le altre attività didattiche (laboratori, attività pratiche, …)(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Valutazione delle attrezzature per le altre attività didattiche (laboratori, attività pratiche, …)(per 100 fruitori)",
      "indicatori": [
        "Hanno usufruito dei corsi integrativi/laboratori online (%)",
        "Mai adeguate",
        "Raramente adeguate",
        "Sempre o quasi sempre adeguate",
        "Spesso adeguate"
      ]
    },
    {
      "id": "valutazione_delle_aule_per_100_fruitori",
      "label": "Valutazione delle aule(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Valutazione delle aule(per 100 fruitori)",
      "indicatori": [
        "Hanno utilizzato le postazioni informatiche (%)",
        "Mai adeguate",
        "Non le hanno utilizzate in quanto non presenti",
        "Non le hanno utilizzate nonostante fossero presenti",
        "Raramente adeguate",
        "Sempre o quasi sempre adeguate",
        "Spesso adeguate"
      ]
    },
    {
      "id": "valutazione_delle_postazioni_informatiche_per_100_fruitori",
      "label": "Valutazione delle postazioni informatiche(per 100 fruitori)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "7. GIUDIZI SULL´ESPERIENZA UNIVERSITARIA",
      "categoria": "Valutazione delle postazioni informatiche(per 100 fruitori)",
      "indicatori": [
        "Hanno utilizzato i servizi di biblioteca (prestito/consultazione, orari di apertura, ...) (%)",
        "In numero adeguato",
        "In numero inadeguato"
      ]
    }
  ],
  "Lavoro e Futuro": [
    {
      "id": "aspetti_ritenuti_rilevanti_nella_ricerca_del_lavoro_decisamente_si",
      "label": "Aspetti ritenuti rilevanti nella ricerca del lavoro: decisamente sì (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "10. PROSPETTIVE DI LAVORO",
      "categoria": "Aspetti ritenuti rilevanti nella ricerca del lavoro: decisamente sì (%)",
      "indicatori": [
        "Acquisizione di professionalità",
        "Coerenza con gli studi",
        "Coinvolgimento e partecipazione all’attività lavorativa e ai processi decisionali",
        "Flessibilità dell’orario di lavoro",
        "Indipendenza o autonomia",
        "Luogo di lavoro (ubicazione, caratteristiche fisiche dell’ambiente di lavoro)",
        "Opportunità di contatti con l'estero",
        "Possibilità di carriera",
        "Possibilità di guadagno",
        "Possibilità di utilizzare al meglio le competenze acquisite",
        "Prestigio ricevuto dal lavoro",
        "Rapporti con i colleghi sul luogo di lavoro",
        "Rispondenza agli interessi culturali",
        "Stabilità/sicurezza del posto di lavoro",
        "Tempo libero",
        "Utilità sociale del lavoro"
      ]
    },
    {
      "id": "contratto",
      "label": "CONTRATTO",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "10. PROSPETTIVE DI LAVORO",
      "categoria": "CONTRATTO",
      "indicatori": [
        "A tempo determinato",
        "Apprendistato",
        "Autonomo/in conto proprio",
        "Somministrazione di lavoro (ex interinale)",
        "Stage",
        "Tempo indeterminato"
      ]
    },
    {
      "id": "disponibilita_a_lavorare_nelle_seguenti_aree_geografiche_decisamente_si",
      "label": "Disponibilità a lavorare nelle seguenti aree geografiche: decisamente sì (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "10. PROSPETTIVE DI LAVORO",
      "categoria": "Disponibilità a lavorare nelle seguenti aree geografiche: decisamente sì (%)",
      "indicatori": [
        "Italia centrale",
        "Italia meridionale",
        "Italia settentrionale",
        "Provincia degli studi",
        "Provincia di residenza",
        "Regione degli studi",
        "Stato europeo",
        "Stato extraeuropeo"
      ]
    },
    {
      "id": "disponibilita_ad_accettare_lavori_non_attinenti_al_proprio_titolo_di_studio",
      "label": "Disponibilità ad accettare lavori non attinenti al proprio titolo di studio (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "10. PROSPETTIVE DI LAVORO",
      "categoria": "Disponibilità ad accettare lavori non attinenti al proprio titolo di studio (%)",
      "indicatori": [
        "No",
        "Sì, come soluzione transitoria",
        "Sì, comunque"
      ]
    },
    {
      "id": "disponibilita_ad_effettuare_trasferte_di_lavoro",
      "label": "Disponibilità ad effettuare trasferte di lavoro (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "10. PROSPETTIVE DI LAVORO",
      "categoria": "Disponibilità ad effettuare trasferte di lavoro (%)",
      "indicatori": [
        "Non disponibili a trasferte",
        "Sì, anche con trasferimenti di residenza",
        "Sì, anche frequenti (senza cambi di residenza)",
        "Sì, ma solo in numero limitato"
      ]
    },
    {
      "id": "orario_modalita_lavorativa",
      "label": "ORARIO/MODALITA' LAVORATIVA",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "10. PROSPETTIVE DI LAVORO",
      "categoria": "ORARIO/MODALITA' LAVORATIVA",
      "indicatori": [
        "Part-time",
        "Telelavoro o smart-working",
        "Tempo pieno"
      ]
    },
    {
      "id": "sono_interessati_a_lavorare_nei_seguenti_settori_decisamente_si",
      "label": "Sono interessati a lavorare nei seguenti settori: decisamente sì (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "10. PROSPETTIVE DI LAVORO",
      "categoria": "Sono interessati a lavorare nei seguenti settori: decisamente sì (%)",
      "indicatori": [
        "Privato (compreso l'avvio di un'attività autonoma/in conto proprio)",
        "Pubblico"
      ]
    },
    {
      "id": "altre_esperienze_di_lavoro_con_continuita_a_tempo_pieno",
      "label": "Altre esperienze di lavoro con continuità a tempo pieno",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "6. LAVORO DURANTE GLI STUDI UNIVERSITARI",
      "categoria": "",
      "indicatori": [
        "Altre esperienze di lavoro con continuità a tempo pieno"
      ]
    },
    {
      "id": "hanno_avuto_esperienze_di_lavoro",
      "label": "Hanno avuto esperienze di lavoro (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "6. LAVORO DURANTE GLI STUDI UNIVERSITARI",
      "categoria": "",
      "indicatori": [
        "Hanno avuto esperienze di lavoro (%)"
      ]
    },
    {
      "id": "lavoratori_studenti",
      "label": "Lavoratori-studenti",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "6. LAVORO DURANTE GLI STUDI UNIVERSITARI",
      "categoria": "",
      "indicatori": [
        "Lavoratori-studenti"
      ]
    },
    {
      "id": "lavoro_a_tempo_parziale",
      "label": "Lavoro a tempo parziale",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "6. LAVORO DURANTE GLI STUDI UNIVERSITARI",
      "categoria": "",
      "indicatori": [
        "Lavoro a tempo parziale"
      ]
    },
    {
      "id": "lavoro_occasionale_saltuario_stagionale",
      "label": "Lavoro occasionale, saltuario, stagionale",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "6. LAVORO DURANTE GLI STUDI UNIVERSITARI",
      "categoria": "",
      "indicatori": [
        "Lavoro occasionale, saltuario, stagionale"
      ]
    },
    {
      "id": "nessuna_esperienza_di_lavoro",
      "label": "Nessuna esperienza di lavoro",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "6. LAVORO DURANTE GLI STUDI UNIVERSITARI",
      "categoria": "",
      "indicatori": [
        "Nessuna esperienza di lavoro"
      ]
    },
    {
      "id": "hanno_ritenuto_difficile_conciliare_studio_e_lavoro_per_100_che_hanno_avuto_espe",
      "label": "Hanno ritenuto difficile conciliare studio e lavoro(per 100 che hanno avuto esperienze di lavoro con continuità a tempo pieno o parziale)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "6. LAVORO DURANTE GLI STUDI UNIVERSITARI",
      "categoria": "Hanno ritenuto difficile conciliare studio e lavoro(per 100 che hanno avuto esperienze di lavoro con continuità a tempo pieno o parziale)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Lavoro coerente con gli studi(per 100 che hanno avuto esperienze di lavoro)",
        "Più no che sì",
        "Più sì che no"
      ]
    }
  ],
  "Dopo la Laurea": [
    {
      "id": "iscrizione_dopo_la_laurea_di_primo_livello_ad_un_altro_corso_di_laurea",
      "label": "Iscrizione, dopo la laurea di primo livello, ad un altro corso di laurea (%)",
      "indagine": "occupazione",
      "definizioni": [
        "condivisa"
      ],
      "sezione": "2a. Formazione di secondo livello",
      "categoria": "Iscrizione, dopo la laurea di primo livello, ad un altro corso di laurea (%)",
      "indicatori": [
        "Mai iscritti ad un corso di laurea di primo o secondo livello",
        "Si sono iscritti ad un corso di laurea di primo livello",
        "Si sono iscritti ad un corso di laurea di secondo livello",
        "Sono attualmente iscritti"
      ],
      "soloCorso": true
    },
    {
      "id": "motivi_dell_iscrizione_ad_un_corso_di_laurea_di_secondo_livello",
      "label": "Motivi dell'iscrizione ad un corso di laurea di secondo livello (%)",
      "indagine": "occupazione",
      "definizioni": [
        "condivisa"
      ],
      "sezione": "2a. Formazione di secondo livello",
      "categoria": "Motivi dell'iscrizione ad un corso di laurea di secondo livello (%)",
      "indicatori": [
        "Per migliorare la propria formazione culturale",
        "Per migliorare le condizioni dell'attuale lavoro",
        "Per migliorare le possibilità di trovare lavoro",
        "Perché hanno cercato lavoro ma non l'hanno trovato",
        "Perché è necessaria per trovare lavoro"
      ],
      "soloCorso": true
    },
    {
      "id": "motivi_della_non_iscrizione_ad_un_altro_corso_di_laurea",
      "label": "Motivi della non iscrizione ad un altro corso di laurea (%)",
      "indagine": "occupazione",
      "definizioni": [
        "condivisa"
      ],
      "sezione": "2a. Formazione di secondo livello",
      "categoria": "Motivi della non iscrizione ad un altro corso di laurea (%)",
      "indicatori": [
        "Altro motivo",
        "Mancanza di un corso nell’area disciplinare di interesse",
        "Motivi economici",
        "Motivi lavorativi",
        "Motivi personali",
        "Non interessati per altri motivi",
        "Non interessati perché intenzionati a frequentare altra formazione post-laurea"
      ],
      "soloCorso": true
    },
    {
      "id": "natura_della_laurea_di_secondo_livello_rispetto_alla_laurea_di_primo_livello",
      "label": "Natura della laurea di secondo livello rispetto alla laurea di primo livello (%)",
      "indagine": "occupazione",
      "definizioni": [
        "condivisa"
      ],
      "sezione": "2a. Formazione di secondo livello",
      "categoria": "Natura della laurea di secondo livello rispetto alla laurea di primo livello (%)",
      "indicatori": [
        "Rappresenta il proseguimento 'naturale'",
        "Rientra in un settore disciplinare diverso",
        "Rientra nel medesimo settore disciplinare pur non rappresentando il proseguimento 'naturale'",
        "Soddisfazione per gli studi di secondo livello intrapresi (medie, scala 1-10)",
        "Stesso ateneo di conseguimento della laurea di primo livello (%)"
      ],
      "soloCorso": true
    },
    {
      "id": "hanno_partecipato_ad_almeno_un_attivita_di_formazione_post_laurea",
      "label": "Hanno partecipato ad almeno un'attività di formazione post-laurea (%)",
      "indagine": "occupazione",
      "definizioni": [
        "condivisa"
      ],
      "sezione": "2b. Formazione post-laurea",
      "categoria": "",
      "indicatori": [
        "Hanno partecipato ad almeno un'attività di formazione post-laurea (%)"
      ]
    },
    {
      "id": "attivita_di_formazione_post_laurea_conclusa_in_corso_per_attivita",
      "label": "Attività di formazione post-laurea: conclusa/in corso (% per attività)",
      "indagine": "occupazione",
      "definizioni": [
        "condivisa"
      ],
      "sezione": "2b. Formazione post-laurea",
      "categoria": "Attività di formazione post-laurea: conclusa/in corso (% per attività)",
      "indicatori": [
        "Altro tipo di master",
        "Attività sostenuta da borsa di studio",
        "Collaborazione volontaria",
        "Corso di formazione professionale",
        "Dottorato di ricerca",
        "Master universitario di primo livello",
        "Master universitario di secondo livello",
        "Scuola di specializzazione",
        "Stage in azienda",
        "Tirocinio/praticantato"
      ],
      "indicatoriSoloCorso": [
        "Dottorato di ricerca",
        "Master universitario di secondo livello"
      ]
    },
    {
      "id": "condizione_occupazionale",
      "label": "Condizione occupazionale (%)",
      "indagine": "occupazione",
      "definizioni": [
        "restrittiva"
      ],
      "sezione": "3. Condizione occupazionale",
      "categoria": "Condizione occupazionale (%)",
      "indicatori": [
        "Lavorano",
        "Non lavorano e non cercano",
        "Non lavorano ma cercano",
        "Quota che non lavora, non cerca ma è impegnata in un corso universitario/praticantato (%)"
      ]
    },
    {
      "id": "condizione_occupazionale_e_formativa",
      "label": "Condizione occupazionale e formativa (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "3. Condizione occupazionale",
      "categoria": "Condizione occupazionale e formativa (%)",
      "indicatori": [
        "Lavorano e non sono iscritti ad una laurea di secondo livello",
        "Lavorano e sono iscritti ad una laurea di secondo livello",
        "Non lavorano e sono iscritti ad una laurea di secondo livello",
        "Non lavorano, non sono iscritti ad una laurea di secondo livello e non cercano",
        "Non lavorano, non sono iscritti ad una laurea di secondo livello ma cercano"
      ],
      "soloCorso": true
    },
    {
      "id": "esperienze_di_lavoro_post_laurea",
      "label": "Esperienze di lavoro post-laurea (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "3. Condizione occupazionale",
      "categoria": "Esperienze di lavoro post-laurea (%)",
      "indicatori": [
        "Non hanno mai lavorato dopo la laurea",
        "Non lavorano ma hanno lavorato dopo la laurea"
      ]
    },
    {
      "id": "ricerca_del_lavoro",
      "label": "Ricerca del lavoro (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia"
      ],
      "sezione": "3. Condizione occupazionale",
      "categoria": "Ricerca del lavoro (%)",
      "indicatori": [
        "Non lavorano e non cercano",
        "Non lavorano ma cercano"
      ]
    },
    {
      "id": "tasso_di_occupazione",
      "label": "Tasso di occupazione",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "3. Condizione occupazionale",
      "categoria": "Tasso di occupazione",
      "indicatori": [
        "Donne",
        "Forze di lavoro (%)",
        "Forze di lavoro: tasso di disoccupazione",
        "Forze di lavoro: tasso di occupazione",
        "Laureati che non lavoravano alla laurea: tasso di occupazione",
        "Quota che non lavora, non cerca ma è impegnata in un corso universitario/praticantato (%)",
        "Tasso di disoccupazione",
        "Totale",
        "Uomini"
      ]
    },
    {
      "id": "numero_di_occupati",
      "label": "Numero di occupati",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "4. Ingresso nel mercato del lavoro",
      "categoria": "",
      "indicatori": [
        "Numero di occupati"
      ]
    },
    {
      "id": "occupati_condizione_occupazionale_alla_laurea",
      "label": "Occupati: condizione occupazionale alla laurea (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "4. Ingresso nel mercato del lavoro",
      "categoria": "Occupati: condizione occupazionale alla laurea (%)",
      "indicatori": [
        "Hanno iniziato a lavorare dopo la laurea",
        "Non proseguono il lavoro iniziato prima della laurea",
        "Proseguono il lavoro iniziato prima della laurea"
      ]
    },
    {
      "id": "occupati_tempi_di_ingresso_nel_mercato_del_lavoro_medie_in_mesi",
      "label": "Occupati: tempi di ingresso nel mercato del lavoro (medie, in mesi)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "4. Ingresso nel mercato del lavoro",
      "categoria": "Occupati: tempi di ingresso nel mercato del lavoro (medie, in mesi)",
      "indicatori": [
        "Tempo dall'inizio della ricerca al reperimento del primo lavoro",
        "Tempo dalla laurea al reperimento del primo lavoro",
        "Tempo dalla laurea all'inizio della ricerca del primo lavoro"
      ]
    },
    {
      "id": "professione_svolta",
      "label": "Professione svolta (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "5. Caratteristiche dell´attuale lavoro",
      "categoria": "Professione svolta (%)",
      "indicatori": [
        "Altre professioni",
        "Imprenditori e alta dirigenza",
        "Imprenditori, legislatori e alta dirigenza",
        "Professioni esecutive nel lavoro d'ufficio",
        "Professioni intellettuali, scientifiche e di elevata specializzazione",
        "Professioni tecniche"
      ]
    },
    {
      "id": "tipologia_dell_attivita_lavorativa",
      "label": "Tipologia dell'attività lavorativa (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "5. Caratteristiche dell´attuale lavoro",
      "categoria": "Tipologia dell'attività lavorativa (%)",
      "indicatori": [
        "Altre forme contrattuali",
        "Assegno di ricerca",
        "Attività in proprio",
        "Borsa o assegno di studio o di ricerca",
        "Contratti formativi",
        "Diffusione del part-time (%)",
        "Diffusione del part-time involontario (%)",
        "Diffusione dello smart working (%)",
        "Numero di ore settimanali di lavoro (medie)",
        "Senza contratto",
        "Tempo determinato",
        "Tempo indeterminato"
      ]
    },
    {
      "id": "area_geografica_di_lavoro",
      "label": "Area geografica di lavoro (%)",
      "indagine": "occupazione",
      "definizioni": [
        "restrittiva"
      ],
      "sezione": "6. Caratteristiche dell´impresa",
      "categoria": "Area geografica di lavoro (%)",
      "indicatori": [
        "Centro",
        "Estero",
        "Isole",
        "Nord-Est",
        "Nord-Ovest",
        "Sud"
      ]
    },
    {
      "id": "ramo_di_attivita_economica",
      "label": "Ramo di attività economica (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "6. Caratteristiche dell´impresa",
      "categoria": "Ramo di attività economica (%)",
      "indicatori": [
        "Agricoltura",
        "Altra industria manifatturiera",
        "Altri servizi",
        "Altri servizi alle imprese",
        "Chimica/Energia",
        "Commercio",
        "Consulenze varie",
        "Credito, assicurazioni",
        "Edilizia",
        "Informatica",
        "Istruzione e ricerca",
        "Metalmeccanica e meccanica di precisione",
        "Pubblica amministrazione, forze armate",
        "Sanità",
        "Totale industria",
        "Totale servizi",
        "Trasporti, pubblicità, comunicazioni"
      ]
    },
    {
      "id": "ripartizione_geografica_di_lavoro",
      "label": "Ripartizione geografica di lavoro (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia"
      ],
      "sezione": "6. Caratteristiche dell´impresa",
      "categoria": "Ripartizione geografica di lavoro (%)",
      "indicatori": [
        "Centro",
        "Estero",
        "Isole",
        "Nord-Est",
        "Nord-Ovest",
        "Sud"
      ]
    },
    {
      "id": "settore_di_attivita",
      "label": "Settore di attività (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "6. Caratteristiche dell´impresa",
      "categoria": "Settore di attività (%)",
      "indicatori": [
        "Non profit",
        "Privato",
        "Pubblico"
      ]
    },
    {
      "id": "retribuzione_mensile_netta_medie_in_euro",
      "label": "Retribuzione mensile netta (medie, in euro)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "7. Retribuzione",
      "categoria": "Retribuzione mensile netta (medie, in euro)",
      "indicatori": [
        "Donne",
        "Laureati che non lavoravano alla laurea: retribuzione mensile netta (medie, in euro)",
        "Totale",
        "Uomini"
      ]
    },
    {
      "id": "laureati_che_proseguono_il_lavoro_iniziato_prima_della_laurea_hanno_notato_un_mi",
      "label": "Laureati che proseguono il lavoro iniziato prima della laurea: hanno notato un miglioramento nel proprio lavoro dovuto alla laurea (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "8. Utilizzo e richiesta della laurea nell´attuale lavoro",
      "categoria": "",
      "indicatori": [
        "Laureati che proseguono il lavoro iniziato prima della laurea: hanno notato un miglioramento nel proprio lavoro dovuto alla laurea (%)"
      ]
    },
    {
      "id": "adeguatezza_della_formazione_professionale_acquisita_all_universita",
      "label": "Adeguatezza della formazione professionale acquisita all'università (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "8. Utilizzo e richiesta della laurea nell´attuale lavoro",
      "categoria": "Adeguatezza della formazione professionale acquisita all'università (%)",
      "indicatori": [
        "Molto adeguata",
        "Per niente adeguata",
        "Poco adeguata"
      ]
    },
    {
      "id": "laureati_che_proseguono_il_lavoro_iniziato_prima_della_laurea_e_che_hanno_notato",
      "label": "Laureati che proseguono il lavoro iniziato prima della laurea e che hanno notato un miglioramento nel lavoro: tipo di miglioramento (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "8. Utilizzo e richiesta della laurea nell´attuale lavoro",
      "categoria": "Laureati che proseguono il lavoro iniziato prima della laurea e che hanno notato un miglioramento nel lavoro: tipo di miglioramento (%)",
      "indicatori": [
        "Dal punto di vista economico",
        "Nella posizione lavorativa",
        "Nelle competenze professionali",
        "Nelle mansioni svolte",
        "Sotto altri punti di vista"
      ]
    },
    {
      "id": "richiesta_della_laurea_per_l_attivita_lavorativa",
      "label": "Richiesta della laurea per l'attività lavorativa (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "8. Utilizzo e richiesta della laurea nell´attuale lavoro",
      "categoria": "Richiesta della laurea per l'attività lavorativa (%)",
      "indicatori": [
        "Non richiesta ma necessaria",
        "Non richiesta ma utile",
        "Non richiesta né utile",
        "Richiesta per legge"
      ]
    },
    {
      "id": "utilizzo_delle_competenze_acquisite_con_la_laurea",
      "label": "Utilizzo delle competenze acquisite con la laurea (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "8. Utilizzo e richiesta della laurea nell´attuale lavoro",
      "categoria": "Utilizzo delle competenze acquisite con la laurea (%)",
      "indicatori": [
        "In misura elevata",
        "In misura ridotta",
        "Per niente"
      ]
    },
    {
      "id": "efficacia_della_laurea_nel_lavoro_svolto",
      "label": "Efficacia della laurea nel lavoro svolto (%)",
      "indagine": "occupazione",
      "definizioni": [
        "ampia",
        "restrittiva"
      ],
      "sezione": "9. Efficacia della laurea e soddisfazione per l´attuale lavoro",
      "categoria": "Efficacia della laurea nel lavoro svolto (%)",
      "indicatori": [
        "Abbastanza efficace",
        "Molto efficace/Efficace",
        "Occupati che cercano lavoro (%)",
        "Poco/Per nulla efficace",
        "Soddisfazione per il lavoro svolto (medie, scala 1-10)"
      ]
    }
  ],
  "Competenze e Ambiente": [
    {
      "id": "hanno_alloggiato_a_meno_di_un_ora_di_viaggio_dalla_sede_degli_studi",
      "label": "Hanno alloggiato a meno di un'ora di viaggio dalla sede degli studi (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "5. CONDIZIONI DI STUDIO",
      "categoria": "Hanno alloggiato a meno di un'ora di viaggio dalla sede degli studi (%)",
      "indicatori": [
        "Meno del 50%",
        "Più del 50% della durata degli studi"
      ]
    },
    {
      "id": "hanno_frequentato_regolarmente",
      "label": "Hanno frequentato regolarmente (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "5. CONDIZIONI DI STUDIO",
      "categoria": "Hanno frequentato regolarmente (%)",
      "indicatori": [
        "1 o più esami all'estero convalidati(per 100 che hanno svolto esperienze di studio all'estero riconosciute dal corso che stanno concludendo)",
        "Altra esperienza riconosciuta dal corso di studio",
        "Con Erasmus o altro programma dell'Unione Europea",
        "Hanno preparato all'estero una parte significativa della tesi(per 100 che hanno svolto esperienze di studio all'estero riconosciute dal corso che stanno concludendo)",
        "Hanno svolto periodi di studio all’estero durante il corso di studio (%)",
        "Hanno svolto periodi di studio all’estero riconosciuti dal corso di studio",
        "Hanno svolto periodi di studio all’estero riconosciuti solo nel precedente corso di studio",
        "Hanno usufruito del servizio di borse di studio offerto dall'organismo per il Diritto allo Studio",
        "Meno del 25%",
        "Più del 75% degli insegnamenti previsti",
        "Tra il 25% e il 50%",
        "Tra il 50% e il 75%"
      ],
      "indicatoriSoloCorso": [
        "Hanno svolto periodi di studio all’estero riconosciuti solo nel precedente corso di studio"
      ]
    },
    {
      "id": "sono_soddisfatti_del_supporto_fornito_dall_universita_per_il_tirocinio_curricula",
      "label": "Sono soddisfatti del supporto fornito dall'Università per il tirocinio curriculare(per 100 che hanno svolto tirocini organizzati dal corso che stanno concludendo)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "5. CONDIZIONI DI STUDIO",
      "categoria": "Sono soddisfatti del supporto fornito dall'Università per il tirocinio curriculare(per 100 che hanno svolto tirocini organizzati dal corso che stanno concludendo)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_del_supporto_fornito_dall_universita_per_l_esperienza_di_studio",
      "label": "Sono soddisfatti del supporto fornito dall'Università per l'esperienza di studio all'estero(per 100 che hanno svolto esperienze di studio all'estero riconosciute dal corso che stanno concludendo)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "5. CONDIZIONI DI STUDIO",
      "categoria": "Sono soddisfatti del supporto fornito dall'Università per l'esperienza di studio all'estero(per 100 che hanno svolto esperienze di studio all'estero riconosciute dal corso che stanno concludendo)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Più no che sì",
        "Più sì che no"
      ]
    },
    {
      "id": "sono_soddisfatti_dell_esperienza_di_studio_all_estero_per_100_che_hanno_svolto_e",
      "label": "Sono soddisfatti dell'esperienza di studio all'estero(per 100 che hanno svolto esperienze di studio all'estero riconosciute dal corso che stanno concludendo)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "5. CONDIZIONI DI STUDIO",
      "categoria": "Sono soddisfatti dell'esperienza di studio all'estero(per 100 che hanno svolto esperienze di studio all'estero riconosciute dal corso che stanno concludendo)",
      "indicatori": [
        "Attività di lavoro successivamente riconosciute dal corso",
        "Decisamente no",
        "Decisamente sì",
        "Hanno svolto tirocini formativi curriculari o lavoro riconosciuti dal corso di studio (%)",
        "Hanno svolto tirocini formativi curriculari o lavoro riconosciuti solo nel precedente corso di studio",
        "Più no che sì",
        "Più sì che no",
        "Tirocini curriculari organizzati dal corso e svolti al di fuori dell'università",
        "Tirocini curriculari organizzati dal corso e svolti presso l'università"
      ],
      "indicatoriSoloCorso": [
        "Hanno svolto tirocini formativi curriculari o lavoro riconosciuti solo nel precedente corso di studio"
      ]
    },
    {
      "id": "sono_soddisfatti_dell_esperienza_di_tirocinio_curriculare_per_100_che_hanno_svol",
      "label": "Sono soddisfatti dell'esperienza di tirocinio curriculare(per 100 che hanno svolto tirocini organizzati dal corso che stanno concludendo)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "5. CONDIZIONI DI STUDIO",
      "categoria": "Sono soddisfatti dell'esperienza di tirocinio curriculare(per 100 che hanno svolto tirocini organizzati dal corso che stanno concludendo)",
      "indicatori": [
        "Decisamente no",
        "Decisamente sì",
        "Più no che sì",
        "Più sì che no",
        "Tempo impiegato per la tesi/prova finale (medie, in mesi)"
      ]
    },
    {
      "id": "lingue_straniere_conoscenza_almeno_b2",
      "label": "Lingue straniere: conoscenza “almeno B2” (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "8. CONOSCENZE LINGUISTICHE E INFORMATICHE",
      "categoria": "Lingue straniere: conoscenza “almeno B2” (%)",
      "indicatori": [
        "Francese parlato",
        "Francese scritto",
        "Inglese parlato",
        "Inglese scritto",
        "Spagnolo parlato",
        "Spagnolo scritto",
        "Tedesco parlato",
        "Tedesco scritto"
      ]
    },
    {
      "id": "strumenti_informatici_livello_di_conoscenza_almeno_buona",
      "label": "Strumenti informatici: livello di conoscenza \"almeno buona\" (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "8. CONOSCENZE LINGUISTICHE E INFORMATICHE",
      "categoria": "Strumenti informatici: livello di conoscenza \"almeno buona\" (%)",
      "indicatori": [
        "Data base",
        "Disegno e progettazione assistita",
        "Elaborazione e pubblicazione in rete di contenuti multimediali",
        "Fogli elettronici",
        "Linguaggi di programmazione",
        "Navigazione in Internet e comunicazione in rete",
        "Realizzazione siti web",
        "Reti di trasmissione dati",
        "Sistemi operativi",
        "Strumenti di presentazione",
        "Word processor"
      ]
    }
  ],
  "Profilo Studente": [
    {
      "id": "eta_alla_laurea",
      "label": "Età alla laurea (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "1. CARATTERISTICHE ANAGRAFICHE",
      "categoria": "Età alla laurea (%)",
      "indicatori": [
        "23-24 anni",
        "25-26 anni",
        "27 anni e oltre",
        "Cittadini stranieri (%)",
        "Età alla laurea (medie, in anni)",
        "Meno di 23 anni"
      ]
    },
    {
      "id": "genere",
      "label": "Genere (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "1. CARATTERISTICHE ANAGRAFICHE",
      "categoria": "Genere (%)",
      "indicatori": [
        "Donne",
        "Uomini"
      ]
    },
    {
      "id": "residenza",
      "label": "Residenza (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "1. CARATTERISTICHE ANAGRAFICHE",
      "categoria": "Residenza (%)",
      "indicatori": [
        "Altra provincia della stessa regione",
        "Altra regione",
        "Estero",
        "Stessa provincia della sede degli studi"
      ]
    },
    {
      "id": "classe_sociale",
      "label": "Classe sociale (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "2. ORIGINE SOCIALE",
      "categoria": "Classe sociale (%)",
      "indicatori": [
        "Classe del lavoro esecutivo",
        "Classe elevata",
        "Classe media autonoma",
        "Classe media impiegatizia"
      ]
    },
    {
      "id": "titolo_di_studio_dei_genitori",
      "label": "Titolo di studio dei genitori (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "2. ORIGINE SOCIALE",
      "categoria": "Titolo di studio dei genitori (%)",
      "indicatori": [
        "Almeno un genitore laureato",
        "Diploma di scuola secondaria di secondo grado",
        "Entrambi con laurea",
        "Nessun genitore laureato",
        "Qualifica professionale, titolo inferiore o nessun titolo",
        "Uno solo con laurea"
      ]
    },
    {
      "id": "diploma",
      "label": "Diploma (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "3. STUDI SECONDARI DI SECONDO GRADO",
      "categoria": "Diploma (%)",
      "indicatori": [
        "Liceale",
        "Liceo artistico e musicale e coreutico",
        "Liceo classico",
        "Liceo delle scienze umane",
        "Liceo linguistico",
        "Liceo scientifico",
        "Professionale",
        "Tecnico",
        "Tecnico economico",
        "Tecnico tecnologico",
        "Titolo estero",
        "Voto di diploma (medie, in 100-mi)"
      ]
    },
    {
      "id": "hanno_conseguito_il_diploma",
      "label": "Hanno conseguito il diploma (%)",
      "indagine": "profilo",
      "definizioni": [
        ""
      ],
      "sezione": "3. STUDI SECONDARI DI SECONDO GRADO",
      "categoria": "Hanno conseguito il diploma (%)",
      "indicatori": [
        "Al Centro, ma si sono laureati al Nord o al Sud-Isole",
        "Al Nord, ma si sono laureati al Centro o al Sud-Isole",
        "Al Sud-Isole, ma si sono laureati al Centro o al Nord",
        "All'estero",
        "In una provincia limitrofa",
        "In una provincia non limitrofa, ma nella stessa ripartizione geografica",
        "Nella stessa provincia della sede degli studi universitari"
      ]
    }
  ]
};
