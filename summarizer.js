const { GoogleGenerativeAI } = require('@google/generative-ai');

async function summarize(captions) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'paste-your-gemini-key-here') {
    throw new Error('GEMINI_API_KEY not set in .env file');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const transcript = captions.map(c =>
    `[${c.speaker}]: ${c.text}`
  ).join('\n');

  const prompt = `Analyze this meeting transcript and respond ONLY with valid JSON (no markdown):

{
  "summary": "2-4 paragraph summary of the meeting",
  "keyPoints": ["point 1", "point 2", "...up to 10 points"],
  "actionItems": ["action 1", "action 2", "..."]
}

Transcript:
${transcript}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(text);
  } catch {
    return { summary: text, keyPoints: [], actionItems: [] };
  }
}

module.exports = { summarize };
