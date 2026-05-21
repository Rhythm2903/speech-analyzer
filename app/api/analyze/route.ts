// app/api/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file stream received at the server gateway.' }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Configuration Error: Missing GROQ_API_KEY environment variable.' }, { status: 500 });
    }

    // Package and submit standard multipart form payload straight to Groq Whisper v3
    const whisperFormData = new FormData();
    whisperFormData.append('file', audioFile, 'speech.wav');
    whisperFormData.append('model', 'whisper-large-v3');

    const transcriptionResponse = await fetch('[https://api.groq.com/openai/v1/audio/transcriptions](https://api.groq.com/openai/v1/audio/transcriptions)', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: whisperFormData,
    });

    if (!transcriptionResponse.ok) {
      const errText = await transcriptionResponse.text();
      return NextResponse.json({ error: `Whisper Transcription Subsystem Failure: ${errText}` }, { status: 500 });
    }

    const transcriptionData = await transcriptionResponse.json();
    const transcript = transcriptionData.text;

    if (!transcript || transcript.trim().length === 0) {
      return NextResponse.json({ error: "Audio processed smoothly, but no spoken speech structures could be parsed." }, { status: 422 });
    }

    const systemPrompt = `You are an expert speech coach and a global macroeconomic analyst. Analyze the following transcript of a speech. Provide your analysis in a clean JSON format with the exact keys specified below. Do not wrap the output in markdown notation blocks. Return raw JSON text only.
    
    Required JSON keys:
    1. "rhetoric_analysis": Evaluate pacing, tone, clarity, and structural impact.
    2. "public_speaking_tips": Array of 3 short, actionable bullet points to improve delivery.
    3. "market_impact": Predict how this speech would influence global financial markets (e.g., Forex, Crypto, S&P 500 sectors) if declared on a world stage. Be hyper-specific.
    4. "societal_impact": Explain how the mainstream public will react (e.g., public sentiment changes, consumer habits, civil unrest or stabilization).`;

    const llmResponse = await fetch('[https://api.groq.com/openai/v1/chat/completions](https://api.groq.com/openai/v1/chat/completions)', {
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
        temperature: 0.2,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      return NextResponse.json({ error: `Llama 3 Text Analytics Subsystem Failure: ${errText}` }, { status: 500 });
    }

    const llmData = await llmResponse.json();
    let rawContent = llmData.choices[0].message.content.trim();

    // BULLETPROOF CLEANUP PATCH: Strip away markdown backtick code blocks if the LLM leaks them
    if (rawContent.startsWith("```json")) {
      rawContent = rawContent.replace(/^```json/, "").replace(/```$/, "");
    } else if (rawContent.startsWith("```")) {
      rawContent = rawContent.replace(/^```/, "").replace(/```$/, "");
    }

    const structuredAnalysis = JSON.parse(rawContent.trim());

    return NextResponse.json({
      transcript,
      ...structuredAnalysis
    });

  } catch (error: any) {
    console.error('API Exception Loop caught:', error);
    return NextResponse.json({ error: error.message || 'Fatal background sequence execution failure.' }, { status: 500 });
  }
}
