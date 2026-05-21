// app/page.tsx
'use client';

import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'live' | 'upload'>('live');
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up video object URLs to avoid browser memory leaks
  useEffect(() => {
    return () => {
      if (videoSrc) URL.revokeObjectURL(videoSrc);
    };
  }, [videoSrc]);

  // Client-Side Audio Compressor & Extractor
  const processToWav = async (fileOrBlob: Blob): Promise<Blob> => {
    setStatusMessage('Extracting and compressing audio track...');
    try {
      const arrayBuffer = await fileOrBlob.arrayBuffer();
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContext();
      
      const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const offlineCtx = new OfflineAudioContext(1, decodedBuffer.duration * 16000, 16000);
      
      const source = offlineCtx.createBufferSource();
      source.buffer = decodedBuffer;
      source.connect(offlineCtx.destination);
      source.start();
      
      const renderedBuffer = await offlineCtx.startRendering();
      const bufferArr = new ArrayBuffer(renderedBuffer.length * 2 + 44);
      const view = new DataView(bufferArr);
      
      const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      };
      
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + renderedBuffer.length * 2, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true);
      view.setUint32(28, 16000 * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, renderedBuffer.length * 2, true);
      
      const channelData = renderedBuffer.getChannelData(0);
      let offset = 44;
      for (let i = 0; i < channelData.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      
      return new Blob([bufferArr], { type: 'audio/wav' });
    } catch (e) {
      console.warn("WAV processing bypassed, utilizing raw audio tracking backup.", e);
      return fileOrBlob;
    }
  };

  // Live Recording Handlers
  const startRecording = async () => {
    try {
      setAnalysis(null);
      setErrorMessage(null);
      setVideoSrc(null);
      audioChunksRef.current = [];
      
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.play().catch(err => console.log("Video play interrupted", err));
      }

      const audioTrack = stream.getAudioTracks()[0];
      const audioStream = new MediaStream([audioTrack]);
      const mediaRecorder = new MediaRecorder(audioStream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const rawAudioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const cleanWavBlob = await processToWav(rawAudioBlob);
        await sendToAnalyzer(cleanWavBlob);
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      alert("Please ensure microphone and camera permissions are granted.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    }
  };

  // File Upload Handler (Using React State for the Video Source)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalysis(null);
    setErrorMessage(null);
    setLoading(true);

    // Completely clear any previous webcam stream bindings
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Assign the file directly to React State to force safe, reliable UI binding
    const fileUrl = URL.createObjectURL(file);
    setVideoSrc(fileUrl);

    try {
      const cleanWavBlob = await processToWav(file);
      await sendToAnalyzer(cleanWavBlob);
    } catch (error) {
      setErrorMessage("Failed to read processing tracks from file type.");
      setLoading(false);
    }
  };

  const sendToAnalyzer = async (audioBlob: Blob) => {
    setLoading(true);
    setStatusMessage('AI engine running analytical calculations...');
    
    const formData = new FormData();
    formData.append('audio', audioBlob, 'speech.wav');

    try {
      const response = await fetch('/api/analyze', { method: 'POST', body: formData });
      const data = await response.json();
      
      if (!response.ok || data.error) {
        setErrorMessage(data.error || `Server returned status code: ${response.status}`);
      } else {
        setAnalysis(data);
      }
    } catch (error) {
      setErrorMessage("Network connection timed out or Vercel execution threshold limit reached.");
    } finally {
      setLoading(false);
      setStatusMessage('');
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
        
        {/* Left Control Column */}
        <div className="flex flex-col gap-4 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button 
              onClick={() => { setActiveTab('live'); setAnalysis(null); setErrorMessage(null); setVideoSrc(null); if(videoRef.current) videoRef.current.src = ''; }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'live' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Live Presentation
            </button>
            <button 
              onClick={() => { setActiveTab('upload'); setAnalysis(null); setErrorMessage(null); setVideoSrc(null); if(videoRef.current) videoRef.current.srcObject = null; }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'upload' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Upload Video / Audio
            </button>
          </div>

          {/* Video Preview Canvas */}
          <div className="aspect-video w-full bg-slate-950 rounded-lg overflow-hidden border border-slate-800 flex items-center justify-center relative">
            <video 
              ref={videoRef} 
              src={videoSrc || undefined} 
              controls={activeTab === 'upload'} 
              playsInline 
              className="w-full h-full object-contain" 
            />
            {!videoSrc && !recording && !loading && (
              <p className="absolute text-sm text-slate-500">Media Playback Viewport Offline</p>
            )}
          </div>

          {activeTab === 'live' ? (
            <div className="w-full">
              {!recording ? (
                <button onClick={startRecording} disabled={loading} className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-lg transition-all">
                  Start Live Recording
                </button>
              ) : (
                <button onClick={stopRecording} className="w-full py-3 px-4 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition-all animate-pulse">
                  Stop & Run Diagnostics
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-lg p-6 bg-slate-950 hover:border-slate-700 transition-all relative">
              <input type="file" accept="video/*,audio/*" onChange={handleFileUpload} disabled={loading} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" />
              <div className="text-center pointer-events-none">
                <p className="text-sm font-medium text-slate-300">Select or Drop Speech Media File Here</p>
                <p className="text-xs text-slate-500 mt-1">Supports standard audio/video formats (MP4, MOV, MP3, WAV)</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Output Analytical Display Column */}
        <div className="flex flex-col gap-6">
          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
              <div className="w-12 h-12 border-4 border-t-blue-500 border-slate-800 rounded-full animate-spin mb-4"></div>
              <p className="text-slate-300 font-medium">{statusMessage}</p>
            </div>
          )}

          {errorMessage && (
            <div className="bg-red-950/50 border border-red-800/60 rounded-xl p-6 text-red-200">
              <h3 className="font-bold text-sm uppercase tracking-wider mb-1">System Pipeline Error</h3>
              <p className="text-sm text-red-300/90">{errorMessage}</p>
            </div>
          )}

          {!loading && !analysis && !errorMessage && (
            <div className="flex-1 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-xl p-12 text-slate-500 text-center border-dashed">
              Feed or upload a presentation asset to activate deep learning analytics dashboards.
            </div>
          )}

          {analysis && (
            <div className="flex flex-col gap-6">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Transcribed Speech Text</h3>
                <p className="text-slate-300 italic">"{analysis.transcript}"</p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-bold text-blue-400 mb-3">🎙️ Presentation Rhetoric Metrics</h3>
                <p className="text-slate-300 mb-4">{analysis.rhetoric_analysis}</p>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Actionable Delivery Tasks:</h4>
                <ul className="list-disc pl-5 space-y-1 text-slate-300">
                  {analysis.public_speaking_tips?.map((tip: string, idx: number) => <li key={idx}>{tip}</li>)}
                </ul>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 border-l-4 border-l-emerald-500">
                <h3 className="text-sm font-bold text-emerald-400 mb-2">📊 Macroeconomic Impact Metrics</h3>
                <p className="text-slate-300">{analysis.market_impact}</p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 border-l-4 border-l-purple-500">
                <h3 className="text-sm font-bold text-purple-400 mb-2">🌍 Geopolitical & Public Sentiment Shift</h3>
                <p className="text-slate-300">{analysis.societal_impact}</p>
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
