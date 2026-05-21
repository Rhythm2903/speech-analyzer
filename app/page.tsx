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
  const [isAudioOnly, setIsAudioOnly] = useState<boolean>(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Safely clean up video object URLs to avoid browser memory leaks
  useEffect(() => {
    return () => {
      if (videoSrc) {
        URL.revokeObjectURL(videoSrc);
      }
    };
  }, [videoSrc]);

  // Client-Side Audio Extractor & Compressive WAV Encoder
  const processToWav = async (fileOrBlob: Blob): Promise<Blob> => {
    setStatusMessage('Compressing audio structures to high-fidelity 16kHz WAV format...');
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
      console.warn("WAV processing bypassed, submitting the raw backup media stream directly.", e);
      return fileOrBlob;
    }
  };

  // Recording Engine Control Hooks
  const startRecording = async () => {
    try {
      setAnalysis(null);
      setErrorMessage(null);
      setVideoSrc(null);
      setIsAudioOnly(false);
      audioChunksRef.current = [];
      
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.play().catch(err => console.log("Video preview sync paused", err));
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
      alert("Microphone and camera permissions are required to begin live recording.");
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

  // Upload Management: Validates formats, generates object URLs, and triggers extraction pipelines
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalysis(null);
    setErrorMessage(null);
    setLoading(true);

    // Completely reset existing webcam stream bindings
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    const fileType = file.type;
    const isAudioFile = fileType.startsWith('audio/');
    setIsAudioOnly(isAudioFile);

    // Bind media content to our active viewport canvas URL
    const fileUrl = URL.createObjectURL(file);
    setVideoSrc(fileUrl);

    try {
      const cleanWavBlob = await processToWav(file);
      await sendToAnalyzer(cleanWavBlob);
    } catch (error) {
      setErrorMessage("System failed to convert media source file structures.");
      setLoading(false);
    }
  };

  const sendToAnalyzer = async (audioBlob: Blob) => {
    setLoading(true);
    setStatusMessage('Transcribing stream & computing macro-geopolitical impacts...');
    
    const formData = new FormData();
    formData.append('audio', audioBlob, 'speech.wav');

    try {
      const response = await fetch('/api/analyze', { method: 'POST', body: formData });
      const data = await response.json();
      
      if (!response.ok || data.error) {
        setErrorMessage(data.error || `Server gateway returned non-OK code: ${response.status}`);
      } else {
        setAnalysis(data);
      }
    } catch (error) {
      setErrorMessage("The network timed out or the file size exceeded serverless payload limitations.");
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 p-6 md:p-12 font-sans selection:bg-blue-500 selection:text-white">
      <header className="max-w-7xl mx-auto mb-10 border-b border-slate-800/80 pb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight bg-gradient-to-r from-blue-400 via-indigo-400 to-emerald-400 bg-clip-text text-transparent">
            AI Speech & Global Impact Analyzer
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Evaluate presentational delivery, public speaking metrics, and simulate global macroeconomic ripples.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-900 border border-slate-800 rounded-full px-3 py-1.5 w-fit">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
          Groq Powered Pipeline
        </div>
      </header>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Left Interactive Control Column */}
        <div className="flex flex-col gap-6 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl shadow-slate-950/50 backdrop-blur-md">
          <div className="flex bg-slate-950 p-1.5 rounded-xl border border-slate-800/80">
            <button 
              onClick={() => { setActiveTab('live'); setAnalysis(null); setErrorMessage(null); setVideoSrc(null); setIsAudioOnly(false); if(videoRef.current) { videoRef.current.srcObject = null; } }}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'live' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30' : 'text-slate-400 hover:text-slate-200'}`}
            >
              🎙️ Live Recording
            </button>
            <button 
              onClick={() => { setActiveTab('upload'); setAnalysis(null); setErrorMessage(null); setVideoSrc(null); if(videoRef.current) videoRef.current.srcObject = null; }}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'upload' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30' : 'text-slate-400 hover:text-slate-200'}`}
            >
              📁 File Upload
            </button>
          </div>

          {/* Player Sandbox Canvas */}
          <div className="aspect-video w-full bg-slate-950 rounded-xl overflow-hidden border border-slate-800/80 flex items-center justify-center relative group">
            {isAudioOnly ? (
              <div className="flex flex-col items-center justify-center text-center p-6 text-slate-400">
                <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-3xl mb-3 shadow-inner">
                  🔊
                </div>
                <p className="text-sm font-semibold text-slate-200">Audio Track Loaded</p>
                <audio src={videoSrc || undefined} controls className="mt-4 max-w-full" />
              </div>
            ) : (
              <video 
                ref={videoRef} 
                src={videoSrc || undefined} 
                controls={activeTab === 'upload' && !!videoSrc} 
                playsInline 
                className="w-full h-full object-contain" 
              />
            )}
            {!videoSrc && !recording && !loading && (
              <div className="absolute text-center flex flex-col items-center gap-2 pointer-events-none p-4">
                <span className="text-3xl text-slate-600 group-hover:scale-110 transition-transform duration-300">🎥</span>
                <p className="text-xs font-semibold text-slate-600 tracking-wider uppercase">Media player standby</p>
              </div>
            )}
          </div>

          {activeTab === 'live' ? (
            <div className="w-full">
              {!recording ? (
                <button onClick={startRecording} disabled={loading} className="w-full py-4 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all duration-200 transform active:scale-[0.98]">
                  Start Live Presentation
                </button>
              ) : (
                <button onClick={stopRecording} className="w-full py-4 px-4 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition-all duration-200 animate-pulse">
                  Stop & Process Speech Patterns
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-800/80 hover:border-slate-700/80 rounded-xl p-8 bg-slate-950/50 hover:bg-slate-950 transition-all duration-200 relative group cursor-pointer">
              <input type="file" accept="video/*,audio/*" onChange={handleFileUpload} disabled={loading} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" />
              <div className="text-center pointer-events-none flex flex-col items-center gap-2">
                <span className="text-2xl text-slate-500 group-hover:translate-y-[-2px] transition-transform duration-300">📤</span>
                <p className="text-sm font-semibold text-slate-300">Choose or drag a media file here</p>
                <p className="text-xs text-slate-500">Supports standard container sizes (MP4, MOV, MP3, WAV)</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Metric Processing Column */}
        <div className="flex flex-col gap-6">
          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center min-h-[350px]">
              <div className="relative w-16 h-16 mb-6">
                <div className="absolute inset-0 border-4 border-slate-800 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-t-blue-500 rounded-full animate-spin"></div>
              </div>
              <p className="text-slate-300 font-medium text-sm tracking-wide">{statusMessage}</p>
            </div>
          )}

          {errorMessage && (
            <div className="bg-red-950/30 border border-red-800/40 rounded-2xl p-6 text-red-200 shadow-lg animate-fade-in">
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5">⚠️</span>
                <div>
                  <h3 className="font-bold text-sm uppercase tracking-wider mb-1 text-red-400">System pipeline error</h3>
                  <p className="text-sm text-slate-300">{errorMessage}</p>
                </div>
              </div>
            </div>
          )}

          {!loading && !analysis && !errorMessage && (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-900/60 border border-slate-800/80 rounded-2xl p-12 text-slate-500 text-center border-dashed min-h-[350px]">
              <span className="text-4xl mb-4 opacity-50">📊</span>
              <p className="text-sm max-w-sm">Capture a live presentation or drag in a recording to unlock the analytical report cards.</p>
            </div>
          )}

          {analysis && (
            <div className="flex flex-col gap-6 animate-fade-in">
              {/* Transcript Block */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">Speech Transcript</span>
                </div>
                <p className="text-slate-200 italic leading-relaxed text-sm bg-slate-950/50 p-4 border border-slate-800/40 rounded-xl">
                  "{analysis.transcript}"
                </p>
              </div>

              {/* Rhetoric Metric Block */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md">
                <div className="flex items-center gap-2 text-blue-400 mb-4">
                  <span className="text-lg">🎙️</span>
                  <h3 className="text-sm font-bold uppercase tracking-wider">Presentational Delivery Rhetoric</h3>
                </div>
                <p className="text-slate-300 leading-relaxed text-sm mb-5">{analysis.rhetoric_analysis}</p>
                <div className="border-t border-slate-800/80 pt-4">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Delivery Optimizations</h4>
                  <ul className="space-y-2 text-sm">
                    {analysis.public_speaking_tips?.map((tip: string, idx: number) => (
                      <li key={idx} className="flex gap-2 text-slate-300">
                        <span className="text-blue-500 font-bold">•</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Macro Impact Block */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 border-l-4 border-l-emerald-500 shadow-md">
                <div className="flex items-center gap-2 text-emerald-400 mb-3">
                  <span className="text-lg">📈</span>
                  <h3 className="text-sm font-bold uppercase tracking-wider">Macroeconomic Ripple Analysis</h3>
                </div>
                <p className="text-slate-300 leading-relaxed text-sm">{analysis.market_impact}</p>
              </div>

              {/* Societal Impact Block */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 border-l-4 border-l-purple-500 shadow-md">
                <div className="flex items-center gap-2 text-purple-400 mb-3">
                  <span className="text-lg">🌎</span>
                  <h3 className="text-sm font-bold uppercase tracking-wider">Geopolitical & Sentiment Reactions</h3>
                </div>
                <p className="text-slate-300 leading-relaxed text-sm">{analysis.societal_impact}</p>
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
