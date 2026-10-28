# Jarvis Parlement

📄 **Page de présentation (captures d'écran et toutes les fonctions) :** https://renaud-bxl.github.io/jarvis-parlement-Claude/

Application Mac complète pour parlementaires : de la **veille** à la **question ou interpellation déposée**, avec un **cerveau** qui apprend vos préférences au fil de l'usage.

## Installer (une commande)

Dans le Terminal :

```bash
curl -fsSL https://raw.githubusercontent.com/renaud-bxl/jarvis-parlement-Claude/main/install.sh | bash
```

Ou manuellement : télécharger le `.dmg` dans l'onglet **Releases** (`arm64` pour les Mac Apple Silicon, `x64` pour les Mac Intel), glisser l'app dans *Applications*, puis clic droit › Ouvrir la première fois (l'app n'est pas notarisée par Apple).

## Parler à Jarvis

À l'ouverture, Jarvis te salue à voix haute (« Bonjour », ton nom, « Que puis-je faire pour vous aujourd'hui ? ») et énumère ce qu'il sait faire. Touche l'orbe (ou le micro) et parle : « check mes mails », « fais une veille sur la ZBE », « rédige une question sur le tram 10 », « qu'est-ce que j'ai à l'agenda demain ? ». Il comprend, agit, te répond à voix haute et affiche le détail. En mode « conversation continue », il t'écoute à nouveau après chaque réponse ; « merci » met fin à l'échange.

- **Écoute** : reconnaissance vocale de macOS (gratuite, sans clé, autorisation « Reconnaissance vocale » + « Micro » demandée au premier usage). Whisper reste disponible en option.
- **Voix** : voix humaines françaises hors-ligne fournies avec l'application (féminine par défaut, voix d'homme au choix dans les Réglages). La voix du Mac n'est jamais utilisée.
- Jarvis n'envoie jamais un courriel et ne dépose jamais rien sans ta validation ; pour résumer tes courriels avec un moteur en ligne, il te demande d'abord ton accord.

## Fonctions de la version 1.7

- **Jarvis, assistant vocal** : écran d'accueil avec orbe animé, réveil par « Hé Jarvis », écoute hors-ligne sur le Mac, réponses parlées.
- **Boîte mail intelligente** : tous les comptes (Gmail, IMAP/SMTP), classement local en lecture seule (attente de réaction, événements, importants, à lire, newsletters), « Alerte suivi », expéditeurs « Urgent », bouton « Ajouter à mon agenda » (Google Agenda ou Agenda d'Apple), lecture à voix haute, réponse proposée (envoi après confirmation), surveillance en arrière-plan avec notifications macOS.
- **Agenda Google** en lecture seule (heures de Bruxelles, vue par jour, prochain événement, liens visio).
- **Veille sur la presse belge** : 42 sources connues d'avance, cases à cocher et sources personnelles dans les Réglages, liens cités, veille planifiée. Belga est en partie sous abonnement ; certains sites n'ont pas de flux public.
- **Rédiger et modèles Word** : modèles par parlement (8 assemblées + parlements personnalisés), dossier `00-Modeles` pour vos propres modèles, rédaction fidèle au modèle, fichier `.docx` à télécharger, mentions « À vérifier ».
- **Dossiers** (veille, recherche, rédaction, relecture, dépôt, suivi, clos), recherche web sur un projet, analyse de document sans web, index documentaire, **cerveau** lisible, corrigeable, exportable et effaçable.
- **Moteur IA au choix** : Claude (Anthropic), OpenAI (GPT), Ollama (local), autre serveur compatible OpenAI ; liste des modèles du compte affichée dès la clé saisie ; consentement avant tout envoi de courriel ou de document vers un moteur en ligne.
- **Mises à jour automatiques** depuis GitHub (empreinte du fichier contrôlée, retour arrière en cas d'échec), diagnostic en un clic, assistant de mise en route en 4 étapes.

## Les 12 actions de base

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
- **Parler** : voix humaines françaises open source ([Piper](https://github.com/rhasspy/piper)), hors-ligne, fournies avec l'application (Réglages › Voix pour choisir une voix d'homme).
- **Écouter** : micro → Whisper (API OpenAI ou serveur local compatible). Sans cela : dictée macOS (Fn Fn).

## Moteur IA
- **Claude (Anthropic)** — recherche web intégrée (clé API : console.anthropic.com).
- **OpenAI (GPT)** — clé API (platform.openai.com).
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
