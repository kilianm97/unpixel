// Page-level PDF operations: merge, rotate, remove pages, protect with a password. Everything runs in the browser.
import { PDFDocument, degrees } from '@cantoo/pdf-lib'

const SAVE = { useObjectStreams: true, updateFieldAppearances: false }

// Opens a PDF for editing, with messages the user can act on
export async function openPdf(bytes) {
  let doc
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  } catch {
    throw new Error('Impossible de lire ce PDF. Il est peut-être endommagé.')
  }
  if (doc.isEncrypted) throw new Error('Ce PDF est protégé par un mot de passe. Enregistrez-en une copie sans protection, puis déposez-la.')
  if (!doc.getPageCount()) throw new Error('Ce PDF ne contient aucune page.')
  return doc
}

export async function mergePdfs(list) {
  const out = await PDFDocument.create()
  for (const [i, bytes] of list.entries()) {
    let src
    try {
      src = await openPdf(bytes)
    } catch (e) {
      throw new Error(`Fichier ${i + 1} : ${e.message}`)
    }
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page)
  }
  return out.save(SAVE)
}

// turns[i]: quarter turns clockwise to add to page i (negative: counter-clockwise)
export async function rotatePages(bytes, turns) {
  const doc = await openPdf(bytes)
  doc.getPages().forEach((page, i) => {
    const t = turns[i] ?? 0
    if (t % 4) page.setRotation(degrees((((page.getRotation().angle + 90 * t) % 360) + 360) % 360))
  })
  return doc.save(SAVE)
}

// remove: indices of the pages to take out. At least one page must stay.
export async function removePages(bytes, remove) {
  const doc = await openPdf(bytes)
  const gone = [...new Set(remove)].filter((i) => i >= 0 && i < doc.getPageCount())
  if (gone.length >= doc.getPageCount()) throw new Error('Gardez au moins une page.')
  gone.sort((a, b) => b - a).forEach((i) => doc.removePage(i)) // from the end, so the indices stay right
  return doc.save(SAVE)
}

// AES-256. The password opens the file and gives every right: there is one password, no hidden owner password.
export async function protectPdf(bytes, password) {
  if (!password) throw new Error('Choisissez un mot de passe.')
  const doc = await openPdf(bytes)
  doc.encrypt({
    userPassword: password,
    ownerPassword: password,
    permissions: { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true },
  })
  return doc.save({ ...SAVE, useObjectStreams: false })
}

export const pdfStem = (name) => name.replace(/\.pdf$/i, '') || 'document'
