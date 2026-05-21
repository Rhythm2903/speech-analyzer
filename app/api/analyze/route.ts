import { NextRequest, NextResponse } from 'next/server';

// Extend Vercel serverless function timeout to 60 seconds
export const maxDuration = 60;

// Helper function to safely ensure a value is returned as a flat string to prevent React rendering crashes
const ensureString = (val: any, fallback: string): string => {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    return val.map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(' ');
  }
  if (val && typeof val === 'object') {
    return val.analysis || val.text || val.description || val.impact || JSON.stringify(val);
  }
  return val ? String(val) : fallback;
};

// Helper function to safely ensure public speaking tips are returned strictly as an array of plain strings
const ensureTipsArray = (val: any): string[] => {
  if (Array.isArray(val)) {
    return val.map((item: any) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        return item.tip || item.text || item.bullet || item.description || JSON.stringify(item);
      }
      return String(item);
    });
  }
  if (typeof val === 'string') {
    return [val];
  }
  if (val && typeof val === 'object') {
    const extracted = val.tip || val.text || val.bullet || val.description || JSON.stringify(val);
    return [extracted];
  }
  return ["Practice clear pacing and focus on key structural transitions."];
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio binary stream received by the API route.' }, { status: 400 });
    }

    // Guard: reject files over 8MB before processing
    if (audioFile.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'Audio file too large. Please use a shorter recording (under ~3 minutes).' }, { status: 413 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Internal setup failed: Server GROQ_API_KEY variable is not initialized.' }, { status: 500 });
    }

    const whisperFormData = new FormData();
    whisperFormData.append('file', audioFile, 'speech.wav');
    whisperFormData.append('model', 'whisper-large-v3');

    const transcriptionResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: whisperFormData,
    });

    if (!transcriptionResponse.ok) {
      const errText = await transcriptionResponse.text();
      return NextResponse.json({ error: `Groq Whisper API processing exception: ${errText}` }, { status: 500 });
    }

    const transcriptionData = await transcriptionResponse.json();
    const transcript = transcriptionData.text;

    if (!transcript || transcript.trim().length === 0) {
      return NextResponse.json({ error: "The audio was received, but no words could be transcribed." }, { status: 422 });
    }

    const systemPrompt = `You are an expert speech coach and a global macroeconomic analyst.
    Analyze the following transcript of a speech. Provide your analysis in a clean JSON format. 
    Do not wrap the output in markdown notation blocks. Return raw JSON text only.
    Keep your analytical descriptions highly concise and punchy (maximum 120 words per key) 
    to guarantee fast generation speeds and avoid timeouts. Ensure public_speaking_tips is returned 
    as a strict JSON array of strings containing exactly 3 bullet points.
    
    Required JSON keys:
    1. "rhetoric_analysis": Evaluate pacing, tone, clarity, and structural impact.
    2. "public_speaking_tips": Array of 3 short, actionable bullet points to improve delivery.
    3. "market_impact": Predict how this speech would influence global financial markets.
    4. "societal_impact": Explain how the mainstream public will react.`;

    const llmResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Transcript to analyze: "${transcript}"` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      return NextResponse.json({ error: `Llama 3 generation pipeline exception: ${errText}` }, { status: 500 });
    }

    const llmData = await llmResponse.json();
    let rawContent = llmData.choices[0].message.content.trim();

    // Markdown sanitization block
    if (rawContent.startsWith("```json")) {
      rawContent = rawContent.replace(/^```json/, "").replace(/```$/, "");
    } else if (rawContent.startsWith("```")) {
      rawContent = rawContent.replace(/^```/, "").replace(/```$/, "");
    }

    const structuredAnalysis = JSON.parse(rawContent.trim());

    // Defensive normalizer guarantees that fields always exist as primitives and prevent rendering errors
    const normalized = {
      rhetoric_analysis: ensureString(structuredAnalysis.rhetoric_analysis, "Analysis unavailable."),
      public_speaking_tips: ensureTipsArray(structuredAnalysis.public_speaking_tips),
      market_impact: ensureString(structuredAnalysis.market_impact, "Market impact analysis unavailable."),
      societal_impact: ensureString(structuredAnalysis.societal_impact, "Societal impact analysis unavailable.")
    };

    return NextResponse.json({
      transcript,
      ...normalized
    });

  } catch (error: any) {
    console.error('API execution loop failure:', error);
    return NextResponse.json({ error: error.message || 'Critical server processing error encountered.' }, { status: 500 });
  }
}
