// POST /api/explain
// Body: { language, today, text?, image?: { mediaType, data } }
// Returns: { result }  (a normalised explanation object)

const W = require('../shared/whisper.js');
const { callClaude, rateLimited, send } = require('./_anthropic.js');

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (rateLimited(req)) return send(res, 429, { error: 'rate_limited' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};
  const language = String(body.language || 'English').slice(0, 30);
  const today = String(body.today || '').slice(0, 60);
  const text = String(body.text || '').slice(0, 12000);
  const image = body.image && typeof body.image === 'object' ? body.image : null;

  if (!image && text.trim().length < 20) return send(res, 400, { error: 'no_document' });
  if (image) {
    if (!ALLOWED_IMAGE_TYPES.includes(image.mediaType)) return send(res, 400, { error: 'bad_image_type' });
    // base64 length ~ 4/3 of bytes. Keep under about 3.5 MB of image data.
    if (typeof image.data !== 'string' || image.data.length > 4800000) return send(res, 413, { error: 'image_too_large' });
  }

  const prompt = W.buildExplainPrompt({ language, today, hasImage: !!image, text });
  const content = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: prompt }
      ]
    : prompt;

  try {
    const reply = await callClaude({ content, maxTokens: 1800 });
    const result = W.normalizeResult(W.extractJSON(reply));
    return send(res, 200, { result });
  } catch (err) {
    const status = err.status || (err.message === 'invalid_json' || err.message === 'invalid_result' ? 502 : 500);
    return send(res, status, { error: 'explain_failed' });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}
