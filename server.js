const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.post('/api/ask-nvidia', async (req, res) => {
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
        max_tokens: 1500
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: errorData.error || 'Nvidia API error' });
    }

    const data = await response.json();
    const aiText = data.choices?.[0]?.message?.content || 'No response content';
    res.json({ response: aiText });
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});