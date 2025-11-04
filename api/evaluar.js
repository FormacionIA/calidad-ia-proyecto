import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const keysRaw = process.env.OPENAI_API_KEYS || '[]';
let OPENAI_KEYS = [];
try { OPENAI_KEYS = JSON.parse(keysRaw); }
catch { OPENAI_KEYS = keysRaw.split(',').map(k => k.trim()).filter(Boolean); }

function pickKeyRandom() {
  if (!OPENAI_KEYS.length) throw new Error('No OpenAI keys configured');
  return OPENAI_KEYS[Math.floor(Math.random() * OPENAI_KEYS.length)];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const { id, texto } = req.body;
  if (!id || !texto) return res.status(400).send('Missing id or texto');
  try {
    const openaiKey = pickKeyRandom();
    const prompt = `Evalúa el siguiente diálogo y devuelve JSON {"puntaje":0-100,"comentario":"texto"}:\n${texto}`;
    const oaRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{
        'Authorization':`Bearer ${openaiKey}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        model:'gpt-4o-mini',
        messages:[{role:'user',content:prompt}],
        max_tokens:400
      })
    });
    const oaJson = await oaRes.json();
    const content = oaJson.choices?.[0]?.message?.content || '';
    let result = { puntaje:null, comentario:content };
    try {
      const s = content.indexOf('{'), e = content.lastIndexOf('}');
      if (s !== -1 && e !== -1) result = JSON.parse(content.slice(s, e + 1));
    } catch {}
    await supabase.from('evaluaciones').update({
      puntaje_total: result.puntaje,
      feedback: result.comentario,
      estado:'evaluado'
    }).eq('id', id);
    res.status(200).json({ success:true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error:err.message });
  }
}
