export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { apiKey, systemPrompt } = req.body;

  if (!apiKey || !systemPrompt) {
    return res.status(400).json({ error: 'Missing apiKey or systemPrompt' });
  }

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'nvidia/nemotron-3-ultra-550b-a55b',
        messages: [{ role: 'user', content: systemPrompt }],
        max_tokens: 4096
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: errorData.error || 'Nvidia API error' });
    }

    const data = await response.json();
    const aiText = data.choices?.[0]?.message?.content || 'No response content';
    res.status(200).json({ response: aiText });
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy server error' });
  }
}