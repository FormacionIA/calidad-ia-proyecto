// /api/evaluar.js  (Node 18+ compatible con Vercel)
// Por esto:
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Leer keys (espera un JSON string como: ["sk-AAA","sk-BBB"])
const keysRaw = process.env.OPENAI_API_KEYS || '[]';
let OPENAI_KEYS = [];
try { OPENAI_KEYS = JSON.parse(keysRaw); }
catch(e) {
  // si no es JSON, intentar coma-separado
  OPENAI_KEYS = keysRaw.split(',').map(k => k.trim()).filter(Boolean);
}

function pickKeyRandom() {
  if (!OPENAI_KEYS || OPENAI_KEYS.length === 0) throw new Error('No OpenAI keys configured');
  const idx = Math.floor(Math.random() * OPENAI_KEYS.length);
  return OPENAI_KEYS[idx];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const { id, texto } = req.body;
  if (!id || !texto) return res.status(400).send('Missing id or texto');

  try {
    const openaiKey = pickKeyRandom();

    // Ejemplo de prompt: ajusta según tu sistema de evaluación
    const prompt = `Eres un evaluador de calidad. Evalúa el siguiente diálogo y devuelve JSON con "puntaje" (0-100) y "comentario".\n\nDIALOGO:\n${texto}\n\nRESPONDE sólo JSON: {"puntaje": 85, "comentario": "Texto..."}`;

    // Llamada a la API de OpenAI (ChatCompletion v1)
    const oaRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',      // o 'gpt-4' según tu suscripción
        messages: [{ role: 'system', content: 'Eres un evaluador de calidad.' },
                   { role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.0
      })
    });

    if (!oaRes.ok) {
      const txt = await oaRes.text();
      console.error('OpenAI error', oaRes.status, txt);
      return res.status(500).json({ error: 'OpenAI API error', detail: txt });
    }
    const oaJson = await oaRes.json();
    const content = oaJson.choices?.[0]?.message?.content || '';

    // Intentar parsear JSON de la respuesta
    let resultado = { puntaje: null, comentario: content };
    try {
      // buscar JSON dentro del texto
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        const jsonText = content.slice(start, end + 1);
        resultado = JSON.parse(jsonText);
      }
    } catch (e) {
      console.warn('No se pudo parsear JSON, guardamos texto completo', e);
    }

    // Guardar resultado en Supabase (tabla 'evaluaciones' o 'conversaciones' según tu esquema)
    const { data, error } = await supabase
      .from('evaluaciones')
      .update({
        puntaje_total: resultado.puntaje || null,
        feedback: resultado.comentario || content,
        estado: 'evaluado'
      })
      .eq('id', id);

    if (error) {
      console.error('Supabase update error', error);
      return res.status(500).json({ error: 'Supabase update error', detail: error.message });
    }

    return res.status(200).json({ success: true, result: resultado, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
