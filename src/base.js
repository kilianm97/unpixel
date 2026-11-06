// URL of a file in public/, wherever the site is served from ("/" locally, "/unpixel/" on GitHub Pages)
export const at = (path = '') => import.meta.env.BASE_URL + path
