// Serverless proxy for the TMDB API (Vercel Node function).
// Keeps the TMDB key on the server: set TMDB_API_KEY in the Vercel project's
// environment variables. Only the read-only endpoints the site uses are allowed,
// so this can't be used as an open proxy to the rest of TMDB.

const ALLOWED = /^\/(search\/movie|discover\/movie|genre\/movie\/list|watch\/providers\/(regions|movie)|movie\/\d+(\/watch\/providers)?)$/;

module.exports = async (req, res) => {
  const key = (process.env.TMDB_API_KEY || "").trim();
  if (!key) {
    res.status(500).json({ error: "TMDB_API_KEY is not configured" });
    return;
  }

  const incoming = new URL(req.url, "http://localhost");
  const path = incoming.searchParams.get("path") || "";
  if (!ALLOWED.test(path)) {
    res.status(400).json({ error: "Unsupported path" });
    return;
  }

  const target = new URL("https://api.themoviedb.org/3" + path);
  for (const [k, v] of incoming.searchParams) {
    if (k !== "path" && k !== "api_key") target.searchParams.set(k, v);
  }
  const headers = { accept: "application/json" };
  // v4 read-access tokens are JWTs; v3 keys go in the query string.
  if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
  else target.searchParams.set("api_key", key);

  try {
    const upstream = await fetch(target, { headers });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (upstream.ok) {
      // Let Vercel's CDN cache responses so repeat lookups are fast and cheap.
      res.setHeader("cache-control", "public, s-maxage=21600, stale-while-revalidate=86400");
    }
    res.send(body);
  } catch {
    res.status(502).json({ error: "Could not reach TMDB" });
  }
};
