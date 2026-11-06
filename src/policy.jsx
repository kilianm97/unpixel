import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import '@fontsource-variable/bricolage-grotesque/opsz.css'
import './styles.css'
import logoUrl from './logo.svg'
import { Footer } from './Footer.jsx'
import { CookieBanner, cookiesEnabled, openCookieSettings } from './CookieBanner.jsx'
import { at } from './base.js'

// Information required by the Swiss nLPD (art. 19) and the cookie rule (art. 45c LTC).
// Everything in <Todo> must be filled in by the site owner before going live.
const UPDATED = '6 novembre 2026'
const Todo = ({ children }) => <mark className="todo">[à compléter : {children}]</mark>

function Policy() {
  return (
    <div className="app">
      <header className="bar">
        <a className="brand" href={at()} aria-label="unpixel, retour à l’accueil">
          <img src={logoUrl} alt="unpixel" className="logo" width="132" height="30" />
        </a>
      </header>

      <main className="policy">
        <h1>Politique de confidentialité</h1>
        <p className="policy-lead">
          En bref : vos images, logos et vidéos ne quittent jamais votre ordinateur. Les seules données qui peuvent nous parvenir sont des statistiques de visite, et
          seulement si vous l’acceptez.
        </p>
        <p className="hint">Dernière mise à jour : {UPDATED}</p>

        <h2>1. Qui est responsable</h2>
        <p>
          Le responsable du traitement est <Todo>raison sociale</Todo>, <Todo>adresse postale</Todo>. Pour toute question sur vos données :{' '}
          <Todo>adresse e-mail de contact</Todo>.
        </p>

        <h2>2. Vos fichiers</h2>
        <p>
          unpixel traite vos fichiers directement dans votre navigateur, sur votre appareil. Les images, logos et vidéos que vous ouvrez ne sont ni envoyés, ni copiés,
          ni conservés sur nos serveurs ou chez un tiers. Ils disparaissent quand vous fermez la page.
        </p>

        <h2>3. Hébergement du site</h2>
        <p>
          Le site est hébergé par <Todo>nom et pays de l’hébergeur</Todo>. Comme pour tout site web, l’hébergeur enregistre des données techniques à chaque visite
          (adresse IP, navigateur, page demandée, date et heure) pour assurer la sécurité et le bon fonctionnement du service. Ces journaux sont conservés{' '}
          <Todo>durée de conservation des journaux</Todo>.
        </p>

        <h2>4. Cookies et mesure d’audience</h2>
        <p>
          Avec votre accord uniquement, nous utilisons <strong>Google Tag Manager</strong> pour mesurer la fréquentation du site. Il ne sert à aucune publicité.
          Tant que vous n’avez pas accepté, il n’est pas chargé et rien n’est transmis à Google.
        </p>
        <ul>
          <li>
            <strong>Mesure d’audience</strong> : pages consultées, durée de visite, type d’appareil et de navigateur, pays ou région approximatifs, identifiant
            pseudonyme. But : comprendre l’utilisation d’unpixel pour l’améliorer.
          </li>
        </ul>
        <p>
          Ces données sont traitées par Google Ireland Limited et Google LLC. Les cookies de mesure de Google (par exemple _ga) sont conservés jusqu’à{' '}
          <Todo>durée configurée dans Google Analytics, par exemple 14 mois</Todo>.
        </p>
        <p>
          Vous pouvez accepter, refuser ou modifier votre choix à tout moment
          {cookiesEnabled ? (
            <>
              {' '}
              via{' '}
              <button className="link" onClick={openCookieSettings}>
                Gérer les cookies
              </button>
            </>
          ) : (
            ' via le lien « Gérer les cookies » en bas de page'
          )}
          . Si vous retirez votre accord, les cookies de Google sont supprimés de votre navigateur.
        </p>

        <h2>5. Communication de données à l’étranger</h2>
        <p>
          Google peut traiter ces données aux États-Unis. Google LLC est certifiée selon le Swiss-U.S. Data Privacy Framework, que le Conseil fédéral reconnaît comme
          offrant un niveau de protection adéquat. Google applique également les clauses contractuelles types.
        </p>

        <h2>6. Ce qui reste sur votre appareil</h2>
        <p>
          unpixel enregistre dans votre navigateur votre choix concernant les cookies (pendant 12 mois) et, si vous installez l’application, une copie du site pour
          qu’elle fonctionne hors connexion. Ces informations restent sur votre appareil et ne nous sont pas envoyées.
        </p>

        <h2>7. Vos droits</h2>
        <p>
          Vous pouvez demander l’accès à vos données, leur rectification ou leur effacement, et vous opposer à leur traitement en écrivant à{' '}
          <Todo>adresse e-mail de contact</Todo>. Vous pouvez aussi vous adresser au Préposé fédéral à la protection des données et à la transparence (PFPDT,{' '}
          <a href="https://www.edoeb.admin.ch" rel="noopener">
            www.edoeb.admin.ch
          </a>
          ).
        </p>

        <h2>8. Modifications</h2>
        <p>
          Nous pouvons mettre à jour cette politique. Si les outils utilisés changent, nous vous redemanderons votre accord. La date de dernière mise à jour figure en
          haut de la page.
        </p>
      </main>

      <Footer />
      <CookieBanner />
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Policy />
    </MotionConfig>
  </StrictMode>,
)
