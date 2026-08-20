// api/ask-nvidia.js

export const config = {
  maxDuration: 60,
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS, POST',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { apiKey, systemPrompt } = req.body;
  if (!apiKey || !systemPrompt) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta/llama-3.1-70b-instruct',
        messages: [{ role: 'user', content: systemPrompt }],
        max_tokens: 4096,
        stream: false,
      }),
    });

    const rawText = await response.text();

    let errorDetail;
    try {
      const parsed = JSON.parse(rawText);
      errorDetail = parsed.error || parsed.message || 'Nvidia API error';
    } catch {
      errorDetail = rawText.slice(0, 500) || 'Nvidia API error (non-JSON response)';
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: errorDetail });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return res.status(502).json({ error: 'Invalid JSON from Nvidia API', raw: rawText.slice(0, 500) });
    }

    const aiText = data.choices?.[0]?.message?.content || 'Không có phản hồi từ AI.';
    return res.status(200).json({ response: aiText });

  } catch (err) {
    console.error('Backend proxy error:', err);
    return res.status(500).json({ error: 'Proxy server error', detail: err?.message || String(err) });
  }
}