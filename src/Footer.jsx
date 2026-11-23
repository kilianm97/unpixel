import logoUrl from './logo.svg'
import { cookiesEnabled, openCookieSettings } from './CookieBanner.jsx'
import { at } from './base.js'
import { CATEGORIES, TOOL_INFO } from './tools.js'

// onPickTool: on the app page, open the tool in place (and scroll up) instead of only changing the URL hash.
// Elsewhere (privacy page) the plain links load the app on that tool.
export function Footer({ onInstall, onPickTool }) {
  return (
    <footer className="footer">
      <div className="footer-main">
        <div className="footer-brand">
          <a href={at()} aria-label="unpixel, accueil">
            <img src={logoUrl} alt="unpixel" width="132" height="30" />
          </a>
          <p>Des images, des logos, des vidéos, des GIF et des PDF légers, sans que vos fichiers quittent votre ordinateur.</p>
        </div>
        {CATEGORIES.map((c) => (
          <nav key={c.id} aria-label={`Outils ${c.label}`}>
            <h2>{c.label}</h2>
            {c.tools.map((id) => (
              <a key={id} href={at(`#${id}`)} onClick={onPickTool && ((e) => (e.preventDefault(), onPickTool(id)))}>
                {TOOL_INFO[id].label}
              </a>
            ))}
          </nav>
        ))}
        <nav aria-label="unpixel">
          <h2>unpixel</h2>
          {onInstall && (
            <button className="footer-link" onClick={onInstall}>
              Installer l’app
            </button>
          )}
          {/* Privacy page + cookie settings come back as soon as a GTM id is configured */}
          {cookiesEnabled && <a href={at('confidentialite.html')}>Confidentialité</a>}
          {cookiesEnabled && (
            <button className="footer-link" onClick={openCookieSettings}>
              Gérer les cookies
            </button>
          )}
        </nav>
      </div>
      <p className="footer-legal">© {new Date().getFullYear()} unpixel. Traitement 100 % local, dans votre navigateur.</p>
    </footer>
  )
}
