const fs = require('fs');
const path = require('path');

const IG_ACCOUNT_ID = process.env.IG_ACCOUNT_ID;
const ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
if (!IG_ACCOUNT_ID || !ACCESS_TOKEN) {
  console.error('Mancano IG_ACCOUNT_ID o IG_ACCESS_TOKEN nelle env vars.');
  process.exit(1);
}

const CAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'calendar.json'), 'utf8'));
const PUBLISHED_FILE = path.join(__dirname, 'published.json');

const MAX_LATE_MS = 3 * 60 * 60 * 1000; // se il runner ha saltato un giro, salta comunque il post oltre 3h di ritardo

function loadPublished() {
  if (!fs.existsSync(PUBLISHED_FILE)) return [];
  return JSON.parse(fs.readFileSync(PUBLISHED_FILE, 'utf8'));
}

function savePublished(list) {
  fs.writeFileSync(PUBLISHED_FILE, JSON.stringify(list, null, 2));
}

async function publishPost(post) {
  const createResp = await fetch(`https://graph.facebook.com/v21.0/${IG_ACCOUNT_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      image_url: post.image_url,
      caption: post.caption,
      access_token: ACCESS_TOKEN,
    }),
  });
  const createJson = await createResp.json();
  if (!createJson.id) {
    throw new Error(`media create fallita: ${JSON.stringify(createJson)}`);
  }
  await new Promise((r) => setTimeout(r, 5000));
  const pubResp = await fetch(`https://graph.facebook.com/v21.0/${IG_ACCOUNT_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      creation_id: createJson.id,
      access_token: ACCESS_TOKEN,
    }),
  });
  const pubJson = await pubResp.json();
  if (!pubJson.id) {
    throw new Error(`media_publish fallita: ${JSON.stringify(pubJson)}`);
  }
  return pubJson.id;
}

(async () => {
  const published = loadPublished();
  const now = Date.now();
  let didWork = false;

  for (const post of CAL.posts) {
    if (published.includes(post.n)) continue;
    const scheduled = new Date(post.time_utc).getTime();
    if (scheduled > now) continue;
    didWork = true;

    const lateMs = now - scheduled;
    if (lateMs > MAX_LATE_MS) {
      console.log(`SALTATO post ${post.n}: in ritardo di ${Math.round(lateMs / 60000)} min, richiede pubblicazione manuale.`);
      continue;
    }

    try {
      const igId = await publishPost(post);
      published.push(post.n);
      savePublished(published);
      console.log(`OK post ${post.n} pubblicato, id=${igId} (ritardo ${Math.round(lateMs / 60000)} min)`);
    } catch (e) {
      console.log(`ERRORE post ${post.n}: ${e.message}`);
    }
  }

  if (!didWork) {
    console.log('Nessun post da pubblicare in questo momento.');
  }
})();
