// app/page.tsx
'use html'
'use client';

import { useState, useRef } from 'react';

export default function Home() {
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Start video preview and audio recording
  const startRecording = async () => {
    try {
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Record audio only to respect Vercel payload limits and maximize speed
      const audioTrack = stream.getAudioTracks()[0];
      const audioStream = new MediaStream([audioTrack]);
      
      const mediaRecorder = new MediaRecorder(audioStream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await sendToAnalyzer(audioBlob);
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      console.error("Error accessing media devices:", err);
      alert("Please allow camera and microphone access.");
    }
  };

  // Stop recording and shut down camera/mic streams
  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    }
  };

  // Ship audio data to the backend Next.js API route
  const sendToAnalyzer = async (audioBlob: Blob) => {
    setLoading(true);
    setAnalysis(null);
    const formData = new FormData();
    formData.append('audio', audioBlob, 'speech.webm');

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      setAnalysis(data);
    } catch (error) {
      console.error("Analysis failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 p-6 md:p-12">
      <header className="max-w-7xl mx-auto mb-8 border-b border-slate-800 pb-4">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          AI Speech & Global Impact Analyzer
        </h1>
      </header>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Left Side: Live Feed & Controls */}
        <div className="flex flex-col gap-4 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h2 className="text-xl font-bold">Live Presentation Feed</h2>
          <div className="aspect-video w-full bg-slate-950 rounded-lg overflow-hidden border border-slate-800 flex items-center justify-center relative">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            {!recording && !loading && (
              <p className="absolute text-sm text-slate-500">Camera Preview Offline</p>
            )}
          </div>
          <div className="flex gap-4 mt-2">
            {!recording ? (
              <button onClick={startRecording} disabled={loading} className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-lg transition-all">
                {loading ? 'Processing Analysis...' : 'Start Presentation'}
              </button>
            ) : (
              <button onClick={stopRecording} className="w-full py-3 px-4 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition-all animate-pulse">
                Stop & Run AI Diagnostics
              </button>
            )}
          </div>
        </div>

        {/* Right Side: Real-Time AI Metrics */}
        <div className="flex flex-col gap-6">
          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
              <div className="w-12 h-12 border-4 border-t-blue-500 border-slate-800 rounded-full animate-spin mb-4"></div>
              <p className="text-slate-400 font-medium">Whisper transcribing & Llama 3 calculating global market impacts...</p>
            </div>
          )}

          {!loading && !analysis && (
            <div className="flex-1 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-xl p-12 text-slate-500 text-center border-dashed">
              Click "Start Presentation" to capture your speech metrics.
            </div>
          )}

          {analysis && (
            <div className="flex flex-col gap-6 animate-fade-in">
              {/* Transcript */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Transcribed Speech</h3>
                <p className="text-slate-300 italic">"{analysis.transcript}"</p>
              </div>

              {/* Rhetoric & Speaking Skills */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-bold text-blue-400 mb-3">🎙️ Public Speaking & Rhetoric Feedback</h3>
                <p className="text-slate-300 mb-4">{analysis.rhetoric_analysis}</p>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Actionable Improvements:</h4>
                <ul className="list-disc pl-5 space-y-1 text-slate-300">
                  {analysis.public_speaking_tips?.map((tip: string, idx: number) => (
                    <li key={idx}>{tip}</li>
                  ))}
                </ul>
              </div>

              {/* Market Impact Analytics */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 border-l-4 border-l-emerald-500">
                <h3 className="text-sm font-bold text-emerald-400 mb-2">📊 Macroeconomic & Market Impact</h3>
                <p className="text-slate-300">{analysis.market_impact}</p>
              </div>

              {/* Societal Impact Analytics */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 border-l-4 border-l-purple-500">
                <h3 className="text-sm font-bold text-purple-400 mb-2">🌍 Societal & Public Behavior Impact</h3>
                <p className="text-slate-300">{analysis.societal_impact}</p>
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}