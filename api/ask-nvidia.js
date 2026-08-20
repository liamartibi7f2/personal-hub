// api/ask-nvidia.js

// 1. Tận dụng tối đa 60 giây của Vercel Hobby
export const config = {
  maxDuration: 60,
};

// 2. CORS headers cơ bản nhất
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS, POST',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  // Gắn CORS cho mọi phản hồi
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // Chặn cửa OPTIONS (Preflight) - rất quan trọng để không bị lỗi Failed to fetch
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
    // Gọi API của Nvidia, để nó tự chạy tới khi xong (hoặc tới khi Vercel chém ở giây 60)
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
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
    const aiText = data.choices?.[0]?.message?.content || 'Không có phản hồi từ AI.';
    res.status(200).json({ response: aiText });
    
  } catch (err) {
    console.error('Backend proxy error:', err);
    res.status(500).json({ error: 'Proxy server error' });
  }
}