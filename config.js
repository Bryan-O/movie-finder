// Site settings.
//
// proxy: path to the server-side TMDB proxy (api/tmdb.js). When the site is
// deployed on Vercel with a TMDB_API_KEY environment variable, every visitor
// can use the site and the key never reaches the browser.
//
// If the proxy isn't available (e.g. opening the files locally), the site falls
// back to asking the visitor to paste their own TMDB key, stored in their browser.
window.STREAMSCOUT_CONFIG = {
  proxy: "/api/tmdb",
};
