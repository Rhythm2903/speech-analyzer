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

// Orchestrate a specialized agent call to Groq
async function runAgent(apiKey: string, roleSystemPrompt: string, transcript: string, fallbackText: string): Promise<string> {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: roleSystemPrompt },
          { role: 'user', content: `Analyze the following transcript: "${transcript}"` }
        ],
        temperature: 0.1,
        max_tokens: 300
      }),
    });

    if (!response.ok) {
      console.warn(`Agent pipeline execution warning: Status ${response.status}`);
      return fallbackText;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || fallbackText;
  } catch (err) {
    console.error(`Agent execution threw an exception:`, err);
    return fallbackText;
  }
}

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

    // Step 1: Speech-To-Text Transcription via Whisper v3
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

    // Step 2: System Prompts for Specialized Agents (Modified prompts to enforce clean, easy-to-understand descriptions)
    const rhetoricAgentPrompt = `You are an elite, world-class speech and rhetoric coach.
    Analyze the delivery patterns, vocabulary, tone, structure, and pacing of the provided transcript.
    Avoid overly academic or complex terms. Speak directly, in highly simple, actionable advice.
    Write exactly 2 short paragraphs (maximum 100 words total) explaining how the user can improve their communication style.`;

    const macroeconomicAgentPrompt = `You are a legendary global financial strategist.
    Evaluate the stock and market impact of this speech if delivered on a world stage by a world leader.
    Avoid complex financial jargon. Predict the simple, direct effects on everyday things like stock market trends, currency value, local business confidence, gas prices, or interest rates in plain terms.
    Write exactly 2 short paragraphs (maximum 100 words total).`;

    const geopoliticalAgentPrompt = `You are a sociological researcher and policy analyst.
    Analyze how everyday people, the general public, families, and media channels will feel or react to this speech.
    Will they feel inspired, nervous, unified, or skeptical? Explain their social reactions using plain, everyday terms.
    Write exactly 2 short paragraphs (maximum 100 words total).`;

    // Step 3: Run Specialized Agents in Parallel to Avoid Latency Stack
    const [rhetoricReport, marketReport, societalReport] = await Promise.all([
      runAgent(apiKey, rhetoricAgentPrompt, transcript, "Speaking style feedback processing encountered an error."),
      runAgent(apiKey, macroeconomicAgentPrompt, transcript, "Market impact analysis processing encountered an error."),
      runAgent(apiKey, geopoliticalAgentPrompt, transcript, "Social impact evaluation processing encountered an error.")
    ]);

    // Step 4: Run the Executive Compiler Agent to synthesize the reports
    const compilerSystemPrompt = `You are the Executive Compiler Agent. You take specialized analyst reports from three separate specialized agents (Speaking Style Analyst, Market Strategist, Social Reaction Analyst) and compile them into a beautifully integrated, synthesized presentation dashboard package in strict JSON format.
    
    Synthesize the reports, resolve any inconsistencies, refine the vocabulary, and format the output.
    Explain things in extremely clear, simple, and direct terms (no heavy academic or corporate jargon).
    Do not wrap the output in markdown notation blocks. Return raw JSON text only.
    Keep your descriptions highly practical, accessible, and punchy.
    
    Required JSON keys:
    1. "speaking_style_feedback": Synthesized vocal delivery, pacing, and style report.
    2. "public_speaking_tips": A JSON array of exactly 3 short, actionable, plain-English bullet points to improve delivery.
    3. "market_impact": Simple, direct assessment of market, commodity, or business implications.
    4. "social_impact": Simple, clear evaluation of social reactions and public sentiment.
    5. "executive_summary": A brilliant master summary (2-3 sentences) consolidating all agent reports into a high-level briefing.`;

    const compilePayload = {
      transcript: transcript,
      rhetoric_report: rhetoricReport,
      market_report: marketReport,
      societal_report: societalReport
    };

    const llmResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: compilerSystemPrompt },
          { role: 'user', content: `Compile this analyst payload: ${JSON.stringify(compilePayload)}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      return NextResponse.json({ error: `Compiler Agent pipeline exception: ${errText}` }, { status: 500 });
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

    // Defensive normalizer flattens structured fields to prevent React crashes
    const normalized = {
      speaking_style_feedback: ensureString(structuredAnalysis.speaking_style_feedback, "Analysis unavailable."),
      public_speaking_tips: ensureTipsArray(structuredAnalysis.public_speaking_tips),
      market_impact: ensureString(structuredAnalysis.market_impact, "Market impact analysis unavailable."),
      social_impact: ensureString(structuredAnalysis.social_impact, "Social impact analysis unavailable."),
      executive_summary: ensureString(structuredAnalysis.executive_summary, "Executive summary compilation unavailable.")
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
