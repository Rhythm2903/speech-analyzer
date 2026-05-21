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

    // Step 2: System Prompts for Specialized Agents
    const rhetoricAgentPrompt = `You are an elite, world-class speech and rhetoric coach.
    Analyze the delivery patterns, vocabulary, estimated tone, structure, and pacing of the provided transcript.
    Pinpoint structural strengths, vocabulary issues, filler usage, and delivery issues.
    Be concise and professional. Write exactly 2 paragraphs (maximum 120 words total).`;

    const macroeconomicAgentPrompt = `You are a legendary global macroeconomic strategist and quantitative hedge fund analyst.
    Evaluate the structural market impact of this speech if delivered on a world stage by a key policymaker or world leader.
    Predict specific effects on major equity indices (S&P 500), currency pairs (Forex), energy, gold, and decentralized digital currencies (Crypto).
    Be hyper-focused on macroeconomic variables. Write exactly 2 paragraphs (maximum 120 words total).`;

    const geopoliticalAgentPrompt = `You are a geopolitical risk advisor and behavioral sociologist.
    Analyze how the general public, mainstream media, and political adversaries will react to this speech.
    Detail shifts in public confidence, trust indices, legislative changes, policy pressure, and social stability.
    Write exactly 2 paragraphs (maximum 120 words total).`;

    // Step 3: Run Specialized Agents in Parallel to Avoid Latency Stack
    const [rhetoricReport, marketReport, societalReport] = await Promise.all([
      runAgent(apiKey, rhetoricAgentPrompt, transcript, "Rhetoric analysis processing failed."),
      runAgent(apiKey, macroeconomicAgentPrompt, transcript, "Macroeconomic impact processing failed."),
      runAgent(apiKey, geopoliticalAgentPrompt, transcript, "Geopolitical impact processing failed.")
    ]);

    // Step 4: Run the Executive Compiler Agent to synthesize the reports
    const compilerSystemPrompt = `You are the Executive compiler AI. You take specialized intelligence reports from three separate analyst agents (Rhetoric Analyst, Macroeconomic Strategist, Geopolitical Risk Analyst) and compile them into a synthesized, final presentation dashboard package in strict JSON format.
    
    Synthesize the reports, resolve any inconsistencies, refine the vocabulary, and format the output.
    Do not wrap the output in markdown notation blocks. Return raw JSON text only.
    Keep your descriptions highly professional, concise, and punchy.
    
    Required JSON keys:
    1. "rhetoric_analysis": Synthesized structural delivery and coaching analysis.
    2. "public_speaking_tips": A JSON array of exactly 3 short, actionable bullet points to improve delivery.
    3. "market_impact": Synthesized global financial market predictions.
    4. "societal_impact": Synthesized public, sociological, and legislative impact predictions.`;

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
