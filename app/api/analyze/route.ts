import { NextRequest, NextResponse } from 'next/server';

// Extend Vercel serverless function timeout to 60 seconds
export const maxDuration = 60;

// Helper function to safely ensure a value is returned as a flat string to prevent React rendering crashes
const ensureString = (val: any, fallback: string): string => {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    // If the LLM returned a nested JSON string, parse it to extract and format cleanly
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return ensureString(parsed, fallback);
      } catch (e) {
        // Continue as standard string if parsing fails
      }
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(item => (typeof item === 'object' ? ensureString(item, fallback) : String(item))).join('\n');
  }
  if (val && typeof val === 'object') {
    // Look for standard flat text keys
    const flatKeys = ['analysis', 'text', 'description', 'impact', 'summary', 'feedback', 'result'];
    for (const k of flatKeys) {
      if (val[k] && typeof val[k] === 'string') {
        return val[k];
      }
    }
    
    // Convert generic key-value maps into beautiful human-readable lines instead of showing raw JSON brackets
    return Object.entries(val)
      .map(([key, value]) => {
        const formattedKey = key
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
        
        if (value && typeof value === 'object') {
          return `${formattedKey}:\n${ensureString(value, fallback)}`;
        }
        return `${formattedKey}: ${value}`;
      })
      .join('\n');
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
        max_tokens: 400
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

    // Step 2: UPGRADED System Prompts for Specialized Agents
    const rhetoricAgentPrompt = `You are an elite, world-class speech and presidential rhetoric coach.
    Analyze the delivery patterns, vocabulary, estimated tone, structure, and pacing of the provided transcript.
    Provide an advanced communication critique focusing on:
    1. Narrative Structure & Coherence (is there an engaging opening hook, logical thematic progression, and inspiring close?).
    2. Persuasive Language (effective use of metaphors, contrasting statements, rhythm, or triadic patterns).
    3. Speaking Flow (pacing indicators, presence of complex sentence structures, or structural filler traps).
    Write in plain, simple, and highly readable prose paragraphs. Do NOT return JSON, nested lists, maps, or code-like keys.
    Write exactly 2 structured, insightful paragraphs (maximum 120 words total).`;

    const macroeconomicAgentPrompt = `You are a legendary global macroeconomic strategist and financial analyst.
    Evaluate the stock and market impact of this speech if delivered on a world stage by an influential leader or policymaker.
    Analyze the economic chain reaction, explaining:
    1. Core Asset Movements (major indices like S&P 500, tech vs. commodity sectors, energy markets, and crypto).
    2. Financial Stability metrics (Forex currency fluctuations, interest rate expectations, inflation projections).
    3. Mainstreet impact (local business confidence, borrow rates, retail prices, and overall consumer spending power).
    Explain these complex financial market movements using extremely simple, clear, everyday analogies.
    Do NOT return JSON, nested maps, or code-like keys. Write in plain, standard prose paragraphs only.
    Write exactly 2 structured, insightful paragraphs (maximum 120 words total).`;

    const geopoliticalAgentPrompt = `You are a senior geopolitical risk advisor and behavioral sociologist.
    Analyze how the general public, mainstream media, and global communities will feel, react, and respond to this speech.
    Detail a clear public response projection mapping:
    1. Public Emotion Vectors (levels of inspiration, skepticism, trust adjustments, or anxiety spikes).
    2. Demographic Segments (how working-class communities, youth, and observers respond differently).
    3. Media Cycle Framings (how news outlets will spin the narrative, social trends, and polarization risks).
    Write in plain, simple, standard prose paragraphs. Do NOT return JSON objects, brackets, or code-like maps.
    Write exactly 2 structured, insightful paragraphs (maximum 120 words total).`;

    // Step 3: Run Upgraded Specialized Agents in Parallel
    const [rhetoricReport, marketReport, societalReport] = await Promise.all([
      runAgent(apiKey, rhetoricAgentPrompt, transcript, "Speaking style feedback processing encountered an error."),
      runAgent(apiKey, macroeconomicAgentPrompt, transcript, "Market impact analysis processing encountered an error."),
      runAgent(apiKey, geopoliticalAgentPrompt, transcript, "Social impact evaluation processing encountered an error.")
    ]);

    // Step 4: Run the Executive Compiler Agent to synthesize the reports with high-fidelity
    const compilerSystemPrompt = `You are the Executive Compiler Agent. You take specialized intelligence reports from three separate specialized agents (Speaking Style Analyst, Market Strategist, Social Reaction Analyst) and compile them into a beautifully integrated, synthesized presentation dashboard package in strict JSON format.
    
    Synthesize the reports, resolve any structural inconsistencies, refine the vocabulary, and format the output.
    Ensure that the high-fidelity depth, professional precision, and logical sequence of the individual reports are preserved, but always explain them in extremely clear, simple, and direct terms (no heavy academic, corporate, or financial jargon).
    Each key ("speaking_style_feedback", "market_impact", "social_impact", "executive_summary") MUST be a flat plain-text string (prose paragraphs). 
    Do NOT return nested objects, maps, lists, brackets, or JSON blocks inside these keys.
    Do not wrap the overall output in markdown notation blocks. Return raw JSON text only.
    Keep your descriptions highly practical, accessible, and punchy.
    
    Required JSON keys:
    1. "speaking_style_feedback": Synthesized vocal delivery, structural coherence, pacing, and rhetoric report (flat string).
    2. "public_speaking_tips": A JSON array of exactly 3 short, actionable, plain-English bullet points to improve delivery.
    3. "market_impact": Simple, direct, high-fidelity assessment of stock, currency, energy, and business implications (flat string).
    4. "social_impact": Simple, clear evaluation of demographic responses, news narratives, and public sentiment shifts (flat string).
    5. "executive_summary": A brilliant master summary (2-3 sentences) consolidating all agent reports into a high-level briefing (flat string).`;

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
