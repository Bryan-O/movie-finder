# StreamScout

A free, simple movie and TV finder: search every streaming service at once and see where a movie or show is streaming **right now** in your country.

- **Movies or TV Shows**: flip the switch at the top; search, moods, filters and Buddy Mode all follow it. Search a show while on Movies and it offers to switch.
- **Search**: results update as you type, and only titles you can stream now show up (subscription, free, or free with ads).
- **Browse**: finish the sentence "I'm in the mood for…" (a good laugh, a proper scare, a mind-bender…), then narrow by genre and sort order.
- **Your list**: tap the bookmark on any poster to save it for later. "Your list" shows everything you saved, with where each one is streaming right now. Saved in your browser, no account needed.
- **I've got**: tap the services you pay for to see only what's on them (remembered in your browser).
- **Buddy Mode**: you and a friend each answer 6 quick questions, and StreamScout picks a movie or show you'll both like, with a match score for each of you.
  Tap **Share this pick** to send the pick as a link; it opens with your match scores and where to stream it in their country.
- Works in any country. Pick yours in the top-right.

Movie data comes from [TMDB](https://www.themoviedb.org/), and streaming availability from [JustWatch](https://www.justwatch.com/) (via TMDB).

## Look and feel

Designed like a neighborhood video shop or a printed cinema program: warm paper, ink-black type (Fraunces for headlines, Instrument Sans for text, DM Mono for labels), one marquee red, and a few hand-drawn marks. Buddy Mode picks come out as an "admit two" ticket. A darker "lights down" version follows your device's dark mode.

## How it's built

Plain HTML/CSS/JS with no build step, plus one small serverless function (`api/tmdb.js`) that calls TMDB on the server. The API key stays private, and visitors don't need an account or a key.

```
index.html      page layout
styles.css      styling
app.js          search, browse, moods, Buddy Mode
config.js       site settings (proxy path)
api/tmdb.js     server-side TMDB proxy (only allows the read-only endpoints the site uses)
```

## Put it online (free)

1. **Get a TMDB key**: create a free account at [themoviedb.org](https://www.themoviedb.org/signup), then go to [Settings → API](https://www.themoviedb.org/settings/api) and request a Developer key. Copy the **API Read Access Token** (or the API Key).
2. **Deploy on Vercel**: sign in at [vercel.com](https://vercel.com) with GitHub (Hobby plan, free) → **Add New → Project** → import this repo → leave all build settings at their defaults.
3. Before clicking Deploy, open **Environment Variables** and add `TMDB_API_KEY` = your token. (If you already deployed, add it under Project → Settings → Environment Variables and then redeploy.)
4. Done. Share your `https://<project>.vercel.app` link. Every push to the main branch redeploys automatically.

## Run it locally

Any static server works, for example `npx serve .` or `python3 -m http.server`. Without the Vercel function, the site asks you to paste your own TMDB key once (it's stored only in your browser). To test the real proxy locally, use `npx vercel dev` with `TMDB_API_KEY` set.

This product uses the TMDB API but is not endorsed or certified by TMDB.
