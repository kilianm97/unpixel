# unpixel

Optimiser des images, vectoriser des logos et compresser des vidéos, sans rien envoyer en ligne : tout est traité sur votre ordinateur.

Le site : https://kilianm97.github.io/unpixel/

## Serveur MCP

Le serveur MCP donne les réglages d'unpixel à un assistant IA (Claude Code, Claude Desktop, Cursor…). Vous lui demandez « optimise les images de ce dossier » ou « compresse cette vidéo en 720p », et il crée les fichiers allégés à côté des originaux.

- Rien n'est envoyé en ligne : le serveur tourne sur votre ordinateur et lit les fichiers du disque.
- Les originaux ne sont jamais modifiés, et un fichier existant n'est jamais écrasé (`photo.webp`, puis `photo-2.webp`).

### Installation

Il faut [Node.js](https://nodejs.org) 20.9 ou plus récent, et git.

```sh
git clone https://github.com/kilianm97/unpixel.git
cd unpixel
npm install
```

`npm install` télécharge aussi ffmpeg (environ 30 Mo), qui sert à compresser les vidéos.

### Connexion

Remplacez `/chemin/vers/unpixel` par le dossier où vous avez cloné le projet.

Claude Code :

```sh
claude mcp add --scope user unpixel -- node /chemin/vers/unpixel/mcp/server.mjs
```

Claude Desktop, Cursor et les autres clients MCP, dans leur fichier de configuration :

```json
{
  "mcpServers": {
    "unpixel": { "command": "node", "args": ["/chemin/vers/unpixel/mcp/server.mjs"] }
  }
}
```

### Outils

**`optimize_images`** compresse et convertit des images (PNG, JPG, WebP, GIF, AVIF, TIFF).

| Réglage | Défaut | Rôle |
| --- | --- | --- |
| `paths` | obligatoire | Les images à optimiser |
| `format` | `webp` | `webp`, `jpeg` ou `png` |
| `quality` | automatique | De 10 à 100. Sans ce réglage, unpixel choisit pour chaque image la qualité la plus légère sans différence visible, comme le mode « Optimale » du site |
| `width` | taille d'origine | Largeur maximale en pixels. Une image plus étroite n'est jamais agrandie |
| `output_dir` | à côté de l'original | Dossier de sortie |

**`compress_video`** compresse une vidéo (MP4, MOV, MKV, WebM, AVI, FLV, WMV) en MP4 H.264 + AAC.

| Réglage | Défaut | Rôle |
| --- | --- | --- |
| `path` | obligatoire | La vidéo à compresser |
| `preset` | `standard` | `light` (720p), `standard` (1080p) ou `high` (taille d'origine). Une vidéo n'est jamais agrandie |
| `start`, `end` | vidéo entière | Passage à garder, en secondes |
| `mute` | non | Supprimer le son |
| `output_dir` | à côté de l'original | Dossier de sortie |

Les préréglages sont ceux du site. Les fichiers produits ne sont pas identiques au bit près à ceux du site : le serveur encode avec sharp et ffmpeg, le site avec le navigateur.

## Développement

```sh
npm run dev     # le site en local
npm test        # tests, dont un aller-retour réel avec le serveur MCP
npm run build   # le site, dans dist/
```
