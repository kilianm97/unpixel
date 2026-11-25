// Every tool, grouped by the kind of file people start from. Used by the menu, the footer and the home page.
export const TOOL_INFO = {
  image: { label: 'Compresser une image', desc: 'JPG, PNG ou WebP plus légers, sans perte visible' },
  svg: { label: 'Logo en SVG', desc: 'Un logo net à toutes les tailles' },
  video: { label: 'Compresser une vidéo', desc: 'Un MP4 léger, lisible partout' },
  gif: { label: 'Vidéo en GIF', desc: 'Un passage de vidéo en GIF animé léger' },
  pdf: { label: 'Compresser un PDF', desc: 'Images allégées, texte net' },
  'pdf-merge': { label: 'Fusionner des PDF', desc: 'Plusieurs PDF en un seul, dans l’ordre choisi' },
  'pdf-pages': { label: 'Supprimer des pages', desc: 'Retirer les pages en trop d’un PDF' },
  'pdf-rotate': { label: 'Pivoter un PDF', desc: 'Remettre des pages à l’endroit' },
  'pdf-protect': { label: 'Protéger un PDF', desc: 'Un mot de passe pour l’ouvrir' },
}

export const CATEGORIES = [
  { id: 'image', label: 'Image', tools: ['image', 'svg'] },
  { id: 'video', label: 'Vidéo', tools: ['video', 'gif'] },
  { id: 'pdf', label: 'PDF', tools: ['pdf', 'pdf-merge', 'pdf-pages', 'pdf-rotate', 'pdf-protect'] },
]

export const categoryOf = (tool) => CATEGORIES.find((c) => c.tools.includes(tool))
export const toolFromHash = (hash) => (TOOL_INFO[hash.slice(1)] ? hash.slice(1) : 'image')
