export const config = {
  maxDuration: 60,
};

const keepAliveAgent = new fetchAgent({ keepAlive: true, timeout: 55000 });

async function fetchAgent(options = {}) {
  return globalThis.fetch.bind(globalThis);
}

function createOptimizedFetch() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);

  return async (url, options = {}) => {
    try {
      const response = await globalThis.fetch(url, {
        ...options,
        signal: controller.signal,
        keepalive: true,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

const optimizedFetch = createOptimizedFetch();

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
    const response = await optimizedFetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Connection': 'keep-alive',
      },
      body: JSON.stringify({
        model: 'nvidia/nemotron-3-ultra-550b-a55b',
        messages: [{ role: 'user', content: systemPrompt }],
        max_tokens: 4096,
        stream: false,
      }),
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
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request timeout - Nvidia API took too long to respond' });
    }
    res.status(500).json({ error: 'Proxy server error' });
  }
}