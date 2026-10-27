# Jarvis Parlement

Application Mac complète pour parlementaires : de la **veille** à la **question ou interpellation déposée**, avec un **cerveau** qui apprend vos préférences au fil de l'usage.

## Installer (une commande)

Dans le Terminal :

```bash
curl -fsSL https://raw.githubusercontent.com/renaud-bxl/jarvis-parlement-Claude/main/install.sh | bash
```

Ou manuellement : télécharger le `.dmg` dans l'onglet **Releases** (`arm64` pour les Mac Apple Silicon, `x64` pour les Mac Intel), glisser l'app dans *Applications*, puis clic droit › Ouvrir la première fois (l'app n'est pas notarisée par Apple).

## Ce que fait Jarvis

| | Fonction |
|---|---|
| 1 | Recherche web et projet parlementaire (antécédents, compétence, angles) |
| 2 | Analyse d'un document local — sans recherche web, 100 % local possible |
| 3 | Briefing du jour (agenda, dossiers, veille, courrier) |
| 4 | Lire et résumer une boîte mail, en lecture seule |
| 5 | Envoyer un `.eml` par SMTP après validation explicite |
| 6 | Configuration (profil, moteur IA, comptes) |
| 7 | Indexer les documents (PDF, DOCX, TXT, MD, EML, HTML) |
| 8 | Chercher dans l'index documentaire (BM25, hors-ligne) |
| 9 | Diagnostic complet |
| 10 | Connexion native Google Agenda + Gmail (lecture seule) |
| 11 | Veille automatique, activable et **retirable** |
| 12 | Modèles d'interpellation **par parlement** |
| + | Dossiers (veille → recherche → rédaction → relecture → dépôt → suivi), voix, cerveau |

### Plusieurs parlements
Parlement bruxellois, francophone bruxellois, Chambre, Sénat, Wallonie, Fédération Wallonie-Bruxelles, Benelux, Parlement européen — et des parlements personnalisés. Changer ou cumuler les mandats change les **modèles**, tout le reste fonctionne pareil.
Chaque parlement actif reçoit automatiquement son dossier :

```
~/Documents/Jarvis-Parlement/
├── Parlement-Bruxelles/
│   ├── 01-Veille/  02-Recherches/  03-Interpellations-et-Questions/
│   └── 04-Documents/  05-Courriers/  06-Archives/
└── Parlement-Benelux/   (créé dès que vous l'ajoutez)
```

### Le cerveau
Jarvis retient vos préférences (style, ton, thèmes, procédure, sources, ce qu'il faut éviter) à partir de vos demandes, de **vos corrections de brouillons** et de vos 👍/👎. Page *Cerveau* : tout est visible, modifiable, épinglable, exportable, effaçable. Les contenus de documents et de courriels n'y sont jamais transmis.

### Voix
- **Parler** : [Piper](https://github.com/rhasspy/piper) (open source, gratuit, hors-ligne), voix françaises femme/homme téléchargées à la demande (Réglages › Voix). Repli : voix macOS.
- **Écouter** : micro → Whisper (API OpenAI ou serveur local compatible). Sans cela : dictée macOS (Fn Fn).

## Moteur IA
- **Claude (Anthropic)** — recherche web intégrée (clé API : console.anthropic.com).
- **Ollama / serveur compatible OpenAI** — 100 % local ; la recherche web utilise alors un mode de secours moins fiable.

Les clés et mots de passe sont chiffrés par le trousseau macOS. Aucune télémétrie.

## Garde-fous
Jarvis **prépare, il ne dépose et n'envoie rien tout seul**. L'envoi d'un courriel passe par une fenêtre de confirmation (compte, tous les destinataires, texte). Les modèles de parlement sont des trames de travail : longueurs, délais et formes de dépôt sont à vérifier au règlement en vigueur (rappel automatique en fin de chaque texte).

## Développement

```bash
npm install
npm start          # lancer l'app
npm test           # tests backend (sans réseau)
npm run dist       # construire le .dmg dans dist/
```

Publier une version : `git tag v1.0.0 && git push --tags` — GitHub Actions construit les `.dmg` (arm64 + x64) et les publie dans *Releases*.

Licence MIT.
