// app/api/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json({ error: 'No usable audio stream file arrived at server.' }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server Environment Configuration Error: missing GROQ_API_KEY.' }, { status: 500 });
    }

    // CRITICAL PATCH: We MUST explicitly attach a file format signature ('speech.wav')
    // inside the backend FormData mapping layer so Groq handles the multipart binary file cleanly.
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
      return NextResponse.json({ error: `Groq Whisper Audio Process Exception: ${errText}` }, { status: 500 });
    }

    const transcriptionData = await transcriptionResponse.json();
    const transcript = transcriptionData.text;

    if (!transcript || transcript.trim().length === 0) {
      return NextResponse.json({ error: "Audio captured cleanly, but Whisper could not parse or resolve spoken words from the file input." }, { status: 422 });
    }

    const systemPrompt = `You are an expert speech coach and a global macroeconomic analyst. Analyze the following transcript of a speech. Provide your analysis in a clean JSON format with the exact keys specified below. Treat the input as a significant address by an influential leader or policymaker.
    
    Required JSON keys:
    1. "rhetoric_analysis": Evaluate pacing, tone, clarity, and structural impact.
    2. "public_speaking_tips": Array of 3 short, actionable bullet points to improve delivery.
    3. "market_impact": Predict how this speech would influence global financial markets (e.g., Forex, Crypto, S&P 500 sectors) if declared on a world stage. Be hyper-specific.
    4. "societal_impact": Explain how the mainstream public will react (e.g., public sentiment changes, consumer habits, civil unrest or stabilization).`;

    const llmResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Transcript to analyze: "${transcript}"` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });

    if (!llmResponse.ok) {
      return NextResponse.json({ error: 'Groq Llama semantic analytics engine processing error.' }, { status: 500 });
    }

    const llmData = await llmResponse.json();
    const structuredAnalysis = JSON.parse(llmData.choices[0].message.content);

    return NextResponse.json({
      transcript,
      ...structuredAnalysis
    });

  } catch (error: any) {
    console.error('API Error Exception:', error);
    return NextResponse.json({ error: error.message || 'Fatal internal processing loop execution failure.' }, { status: 500 });
  }
}
