#!/usr/bin/env node
// unpixel as an MCP server (stdio): an AI assistant optimises local images and videos with the site's settings.
// Files are read and written on this computer only. Nothing is uploaded.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { PRESETS } from '../src/videoPresets.js'
import { IMAGE_FORMATS, optimizeImage, compressVideo, gainText } from './tools.mjs'

const server = new McpServer({ name: 'unpixel', version: '1.0.0' })
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError })
// Both tools create new files, never overwrite, and stay on this computer
const annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const output_dir = z.string().optional().describe('Dossier de sortie, créé si besoin. Par défaut : à côté du fichier d’origine.')

server.registerTool(
  'optimize_images',
  {
    title: 'Optimiser des images',
    description:
      'Compresse et convertit des images du disque (PNG, JPG, WebP, GIF, AVIF, TIFF) en WebP, JPG ou PNG. Sans « quality », choisit pour chaque image le réglage le plus léger sans différence visible. Crée de nouveaux fichiers et ne modifie jamais les originaux. Tout se passe sur cet ordinateur, rien n’est envoyé en ligne.',
    inputSchema: {
      paths: z.array(z.string()).min(1).describe('Chemins absolus des images à optimiser'),
      format: z.enum(Object.keys(IMAGE_FORMATS)).default('webp').describe('Format de sortie. WebP est le plus léger à qualité égale et garde la transparence. PNG est sans perte.'),
      quality: z.number().int().min(10).max(100).optional().describe('Qualité imposée, de 10 à 100. À omettre pour le réglage automatique. Ignorée en PNG.'),
      width: z.number().int().min(1).optional().describe('Largeur maximale en pixels, proportions gardées. Une image plus étroite n’est jamais agrandie.'),
      output_dir,
    },
    annotations,
  },
  async ({ paths, ...options }) => {
    const lines = []
    let failed = 0
    for (const p of paths) {
      try {
        const r = await optimizeImage(p, options)
        lines.push(`${r.output} : ${gainText(r.before, r.after)}, ${r.width} × ${r.height} px${r.quality ? `, qualité ${r.quality}` : ''}`)
      } catch (e) {
        failed++
        lines.push(`${p} : échec, ${e.message}`)
      }
    }
    return text(lines.join('\n'), failed === paths.length)
  },
)

server.registerTool(
  'compress_video',
  {
    title: 'Compresser une vidéo',
    description:
      'Compresse une vidéo du disque (MP4, MOV, MKV, WebM, AVI, FLV, WMV) en MP4 H.264 + AAC, lisible partout, et peut en garder seulement un passage. Crée un nouveau fichier et ne modifie jamais l’original. Tout se passe sur cet ordinateur, rien n’est envoyé en ligne. Une longue vidéo peut prendre plusieurs minutes.',
    inputSchema: {
      path: z.string().describe('Chemin absolu de la vidéo'),
      preset: z
        .enum(PRESETS.map((p) => p.id))
        .default('standard')
        .describe(PRESETS.map((p) => `${p.id} : ${p.label}, ${p.desc.toLowerCase()}`).join('. ')),
      start: z.number().min(0).optional().describe('Début du passage à garder, en secondes'),
      end: z.number().positive().optional().describe('Fin du passage à garder, en secondes'),
      mute: z.boolean().optional().describe('Supprimer le son'),
      output_dir,
    },
    annotations,
  },
  async ({ path, ...options }) => {
    try {
      const r = await compressVideo(path, options)
      return text(`${r.output} : ${gainText(r.before, r.after)}`)
    } catch (e) {
      return text(`${path} : échec, ${e.message}`, true)
    }
  },
)

await server.connect(new StdioServerTransport())
