// app/api/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file received' }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Groq API Key configuration missing' }, { status: 500 });
    }

    // Forward the optimized WAV file straight to Groq Whisper v3
    const whisperFormData = new FormData();
    whisperFormData.append('file', audioFile);
    whisperFormData.append('model', 'whisper-large-v3');

    const transcriptionResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: whisperFormData,
    });

    if (!transcriptionResponse.ok) {
      const errText = await transcriptionResponse.text();
      throw new Error(`Whisper transcription failed: ${errText}`);
    }

    const transcriptionData = await transcriptionResponse.json();
    const transcript = transcriptionData.text;

    // Run the Llama-3 Analysis Matrix
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

    if (!llmResponse.ok) throw new Error('Llama 3 analysis generation failed');

    const llmData = await llmResponse.json();
    const structuredAnalysis = JSON.parse(llmData.choices[0].message.content);

    return NextResponse.json({
      transcript,
      ...structuredAnalysis
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}