// Cookie consent for Google Tag Manager, used for audience measurement only (nLPD / GDPR):
// GTM is only loaded after an explicit "yes". Advertising signals are always denied.
// Before any choice nothing is sent to Google; the choice itself stays in this browser (localStorage).

export const GTM_ID = import.meta.env?.VITE_GTM_ID ?? ''
export const CONSENT_KEY = 'unpixel-consent'
export const CONSENT_VERSION = 1 // bump when the trackers change: everyone is asked again
export const MAX_AGE_DAYS = 365 // the choice is asked again after a year
export const isGtmId = (id) => /^GTM-[A-Z0-9]{4,12}$/.test(id ?? '')

export function parseConsent(raw, now = Date.now()) {
  try {
    const c = JSON.parse(raw)
    if (c?.v !== CONSENT_VERSION || typeof c.date !== 'number' || now - c.date > MAX_AGE_DAYS * 864e5 || c.date > now) return null
    return { audience: c.audience === true, date: c.date }
  } catch {
    return null
  }
}

export const serializeConsent = (choice, now = Date.now()) =>
  JSON.stringify({ v: CONSENT_VERSION, date: now, audience: !!choice.audience })

// Google Consent Mode v2 signals
export const consentMode = (c) => {
  const g = (on) => (on ? 'granted' : 'denied')
  return { analytics_storage: g(c.audience), ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' } // no advertising use
}

export const wantsGtm = (c) => !!c?.audience

// Cookies set by Google tags; removed when consent is withdrawn
export const isTrackingCookie = (name) => /^(_ga|_gid|_gat|_gcl_|_gac_|__utm|_dc_gtm_)/.test(name)

// Every domain a cookie may have been set on: www.example.ch, .www.example.ch, .example.ch
export function cookieDomains(host) {
  const parts = host.split('.')
  const out = [host]
  for (let i = 0; i < parts.length - 1; i++) out.push('.' + parts.slice(i).join('.'))
  return out
}

/* ---------- browser side ---------- */

function gtag() {
  // Google's snippet requires the `arguments` object, not an array
  window.dataLayer.push(arguments)
}

let started = false
export function startGtm(id, choice) {
  if (started || !isGtmId(id)) return
  started = true
  window.dataLayer = window.dataLayer || []
  gtag('consent', 'default', { ...consentMode({}), functionality_storage: 'denied', personalization_storage: 'denied', security_storage: 'granted' })
  gtag('consent', 'update', consentMode(choice))
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`
  document.head.append(s)
}
export const gtmStarted = () => started

export function updateGtm(choice) {
  if (started) gtag('consent', 'update', consentMode(choice))
}

export function clearTrackingCookies() {
  const names = document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(isTrackingCookie)
  for (const n of names) {
    document.cookie = `${n}=; Max-Age=0; path=/`
    for (const d of cookieDomains(location.hostname)) document.cookie = `${n}=; Max-Age=0; path=/; domain=${d}`
  }
}

export function readConsent() {
  try {
    return parseConsent(localStorage.getItem(CONSENT_KEY))
  } catch {
    return null // storage blocked: treated as "no choice yet", nothing is loaded
  }
}

export function writeConsent(choice) {
  try {
    localStorage.setItem(CONSENT_KEY, serializeConsent(choice))
  } catch {
    // storage blocked: the choice applies to this visit only
  }
}
