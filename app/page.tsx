'use client';

import { useState, useRef, useEffect } from 'react';

// Premium Typewriter Text Component with character-by-character typing
function TypewriterText({ text, speed = 15, onComplete }: { text: string; speed?: number; onComplete?: () => void }) {
  const [displayedText, setDisplayedText] = useState('');
  const textRef = useRef(text);
  const onCompleteRef = useRef(onComplete);
  
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    textRef.current = text;
    setDisplayedText('');
    if (!text) return;
    
    let i = 0;
    const interval = setInterval(() => {
      if (i < textRef.current.length) {
        setDisplayedText((prev) => prev + textRef.current.charAt(i));
        i++;
      } else {
        clearInterval(interval);
        if (onCompleteRef.current) onCompleteRef.current();
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed]);

  return <p className="text-slate-300 leading-relaxed text-sm whitespace-pre-line">{displayedText}</p>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'live' | 'upload'>('live');
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [isAudioOnly, setIsAudioOnly] = useState<boolean>(false);
  
  // Sequential step state tracker (0 = empty, 1 = transcript, 2 = style, 3 = market, 4 = social, 5 = summary)
  const [activeStep, setActiveStep] = useState<number>(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up Object URLs to prevent browser memory leaks
  useEffect(() => {
    return () => {
      if (videoSrc) {
        URL.revokeObjectURL(videoSrc);
      }
    };
  }, [videoSrc]);

  // Orchestrates the streamlined sequential 4-second reveal process
  useEffect(() => {
    if (!analysis) {
      setActiveStep(0);
      return;
    }

    // Step 1: Reveal Transcript immediately
    setActiveStep(1);

    // Step 2: Reveal Speaking Style after 4 seconds
    const timer1 = setTimeout(() => {
      setActiveStep(2);
    }, 4000);

    // Step 3: Reveal Market Impact after another 4 seconds
    const timer2 = setTimeout(() => {
      setActiveStep(3);
    }, 8000);

    // Step 4: Reveal Social Impact after another 4 seconds
    const timer3 = setTimeout(() => {
      setActiveStep(4);
    }, 12000);

    // Step 5: Reveal Executive Summary synthesis after final 4 seconds
    const timer4 = setTimeout(() => {
      setActiveStep(5);
    }, 16000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
    };
  }, [analysis]);

  // Convert Media Recorder blobs to 8kHz Mono WAV to bypass Vercel limits
  const processToWav = async (fileOrBlob: Blob): Promise<Blob> => {
    setStatusMessage('Compressing and optimizing speech tracks...');
    const SAMPLE_RATE = 8000;
    const MAX_DURATION_SECONDS = 180; // 3-minute limit to prevent browser freezes

    try {
      const arrayBuffer = await fileOrBlob.arrayBuffer();
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContext();

      const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      if (decodedBuffer.duration > MAX_DURATION_SECONDS) {
        throw new Error(`Recording is ${Math.round(decodedBuffer.duration)}s. Keep under 3 minutes to stay within limits.`);
      }

      const numSamples = Math.floor(decodedBuffer.duration * SAMPLE_RATE);
      const offlineCtx = new OfflineAudioContext(1, numSamples, SAMPLE_RATE);

      const source = offlineCtx.createBufferSource();
      source.buffer = decodedBuffer;
      source.connect(offlineCtx.destination);
      source.start();

      const renderedBuffer = await offlineCtx.startRendering();
      const channelData = renderedBuffer.getChannelData(0);

      const pcmData = new Int16Array(channelData.length);
      for (let i = 0; i < channelData.length; i++) {
        const s = Math.max(-1, Math.min(1, channelData[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      const headerBuf = new ArrayBuffer(44);
      const view = new DataView(headerBuf);
      const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
      };
      
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + pcmData.byteLength, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM format
      view.setUint16(22, 1, true); // Mono channel
      view.setUint32(24, SAMPLE_RATE, true);
      view.setUint32(28, SAMPLE_RATE * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, pcmData.byteLength, true);

      return new Blob([headerBuf, pcmData.buffer], { type: 'audio/wav' });
    } catch (e: any) {
      if (e?.message?.includes('Recording is')) {
        throw e;
      }
      console.warn("WAV processing bypassed, utilizing standard upload stream fallback.", e);
      return fileOrBlob;
    }
  };

  const startRecording = async () => {
    try {
      setAnalysis(null);
      setErrorMessage(null);
      setVideoSrc(null);
      setIsAudioOnly(false);
      setActiveStep(0);
      audioChunksRef.current = [];
      
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.play().catch(err => console.log("Video preview synchronized", err));
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
        try {
          const cleanWavBlob = await processToWav(rawAudioBlob);
          await sendToAnalyzer(cleanWavBlob);
        } catch (err: any) {
          setErrorMessage(err?.message || "Failed to process target speech track.");
          setLoading(false);
        }
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      alert("Camera and microphone access permissions are required to record.");
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalysis(null);
    setErrorMessage(null);
    setLoading(true);
    setActiveStep(0);

    if (file.size > 12 * 1024 * 1024) {
      setErrorMessage("File exceeds 12MB limit. Please compress your clip or upload a shorter file.");
      setLoading(false);
      return;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    const fileType = file.type;
    const isAudioFile = fileType.startsWith('audio/');
    setIsAudioOnly(isAudioFile);

    const fileUrl = URL.createObjectURL(file);
    setVideoSrc(fileUrl);

    try {
      const cleanWavBlob = await processToWav(file);
      await sendToAnalyzer(cleanWavBlob);
    } catch (error: any) {
      setErrorMessage(error?.message || "Internal failure converting media track container.");
      setLoading(false);
    }
  };

  const sendToAnalyzer = async (audioBlob: Blob) => {
    setLoading(true);
    setStatusMessage('Analyzing audio tracks via Agentic AI models...');
    
    const formData = new FormData();
    formData.append('audio', audioBlob, 'speech.wav');

    try {
      const response = await fetch('/api/analyze', { method: 'POST', body: formData });
      const data = await response.json();
      
      if (!response.ok || data.error) {
        setErrorMessage(data.error || `Processing gateway returned status: ${response.status}`);
      } else {
        setAnalysis(data);
      }
    } catch (error) {
      setErrorMessage("The network timed out or the Vercel execution limit was reached.");
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  };

  const tips = Array.isArray(analysis?.public_speaking_tips)
    ? analysis.public_speaking_tips
    : typeof analysis?.public_speaking_tips === 'string'
      ? [analysis.public_speaking_tips]
      : [];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 p-6 md:p-12 font-sans selection:bg-indigo-500 selection:text-white">
      <header className="max-w-7xl mx-auto mb-10 border-b border-slate-800/80 pb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight bg-gradient-to-r from-blue-400 via-indigo-400 to-emerald-400 bg-clip-text text-transparent">
            AI Speech & Global Impact Analyzer
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Evaluate speaking patterns, deliver diagnostics, and simulate world reactions in simple terms.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-900 border border-slate-800 rounded-full px-4 py-2 w-fit shadow-lg shadow-black/30">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          Parallel Agent Grid Enabled
        </div>
      </header>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Left Interactive Control Column */}
        <div className="flex flex-col gap-6 bg-slate-900/95 border border-slate-800 rounded-2xl p-6 shadow-2xl shadow-slate-950/60 backdrop-blur-md">
          <div className="flex bg-slate-950 p-1.5 rounded-xl border border-slate-800/80">
            <button 
              onClick={() => { setActiveTab('live'); setAnalysis(null); setErrorMessage(null); setVideoSrc(null); setIsAudioOnly(false); if(videoRef.current) { videoRef.current.srcObject = null; } }}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'live' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30' : 'text-slate-400 hover:text-slate-200'}`}
            >
              🎙️ Live Recording
            </button>
            <button 
              onClick={() => { setActiveTab('upload'); setAnalysis(null); setErrorMessage(null); setVideoSrc(null); if(videoRef.current) videoRef.current.srcObject = null; }}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'upload' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30' : 'text-slate-400 hover:text-slate-200'}`}
            >
              📁 File Upload
            </button>
          </div>

          {/* Media Player Component */}
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
                <p className="text-xs font-semibold text-slate-600 tracking-wider uppercase">Media standby</p>
              </div>
            )}
          </div>

          {activeTab === 'live' ? (
            <div className="w-full">
              {!recording ? (
                <button onClick={startRecording} disabled={loading} className="w-full py-4 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all duration-200 transform active:scale-[0.98] shadow-lg shadow-indigo-950/50">
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
                <p className="text-xs text-slate-500">Supports normal HD video/audio formats (MP4, MOV, MP3, WAV)</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Dashboard Results Column */}
        <div className="flex flex-col gap-6">
          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center min-h-[400px]">
              <div className="relative w-16 h-16 mb-6">
                <div className="absolute inset-0 border-4 border-slate-800 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-t-indigo-500 rounded-full animate-spin"></div>
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
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-900/60 border border-slate-800/80 rounded-2xl p-12 text-slate-500 text-center border-dashed min-h-[400px]">
              <span className="text-4xl mb-4 opacity-50">📊</span>
              <p className="text-sm max-w-sm leading-relaxed">Capture live speech or upload your file to start the sequential Multi-Agent diagnostic reveal.</p>
            </div>
          )}

          {/* Sequential Reveal UI Elements */}
          {analysis && !loading && (
            <div className="flex flex-col gap-6">
              
              {/* Timeline Indicator Progress Bar */}
              <div className="bg-slate-900 border border-slate-800/70 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-400 shadow-md">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping"></span>
                  Sequential Diagnostic Sequence:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <span className={`px-2 py-0.5 rounded transition-all ${activeStep >= 1 ? 'bg-blue-500/20 text-blue-400 font-bold border border-blue-500/30' : 'bg-slate-950 text-slate-600 border border-transparent'}`}>1. Transcript</span>
                  <span className={`px-2 py-0.5 rounded transition-all ${activeStep >= 2 ? 'bg-indigo-500/20 text-indigo-400 font-bold border border-indigo-500/30' : 'bg-slate-950 text-slate-600 border border-transparent'}`}>2. Style</span>
                  <span className={`px-2 py-0.5 rounded transition-all ${activeStep >= 3 ? 'bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30' : 'bg-slate-950 text-slate-600 border border-transparent'}`}>3. Market</span>
                  <span className={`px-2 py-0.5 rounded transition-all ${activeStep >= 4 ? 'bg-purple-500/20 text-purple-400 font-bold border border-purple-500/30' : 'bg-slate-950 text-slate-600 border border-transparent'}`}>4. Social</span>
                  <span className={`px-2 py-0.5 rounded transition-all ${activeStep >= 5 ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30' : 'bg-slate-950 text-slate-600 border border-transparent'}`}>5. Summary</span>
                </div>
              </div>

              {/* Step 1: Speech Transcript Block (Immediate) */}
              {activeStep >= 1 && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md transition-all duration-500 animate-fade-in">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-slate-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                      Speech Transcript
                    </span>
                    <span className="text-[10px] text-blue-500 font-semibold uppercase bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">Active</span>
                  </div>
                  <div className="bg-slate-950/50 p-4 border border-slate-800/40 rounded-xl">
                    <TypewriterText text={`"${analysis.transcript}"`} speed={10} />
                  </div>
                </div>
              )}

              {/* Step 2: Speaking Style Feedback (4-Second Gap) */}
              {activeStep >= 2 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md transition-all duration-500 animate-fade-in">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-indigo-400">
                      <span className="text-lg">🎙️</span>
                      <h3 className="text-sm font-bold uppercase tracking-wider">Speaking Style Feedback</h3>
                    </div>
                    <span className="text-[10px] text-indigo-500 font-semibold uppercase bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">Synthesized</span>
                  </div>
                  <TypewriterText text={analysis.speaking_style_feedback} speed={15} />
                  
                  {tips.length > 0 && (
                    <div className="border-t border-slate-800/80 pt-4 mt-4">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Key Improvement Tips</h4>
                      <ul className="space-y-2 text-sm text-slate-300">
                        {tips.map((tip: string, idx: number) => (
                          <li key={idx} className="flex gap-2">
                            <span className="text-indigo-500 font-bold">•</span>
                            <span>{tip}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                analysis && (
                  <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-6 text-slate-600 flex items-center justify-center h-28 border-dashed">
                    <p className="text-xs font-mono uppercase tracking-wider animate-pulse flex items-center gap-2">
                      <span>🔓</span> Waiting for Speaking Style diagnostic sequence...
                    </p>
                  </div>
                )
              )}

              {/* Step 3: Market Impact (Revealed at 8 seconds) */}
              {activeStep >= 3 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 border-l-4 border-l-emerald-500 shadow-md transition-all duration-500 animate-fade-in">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-emerald-400">
                      <span className="text-lg">📈</span>
                      <h3 className="text-sm font-bold uppercase tracking-wider">Market Impact</h3>
                    </div>
                    <span className="text-[10px] text-emerald-500 font-semibold uppercase bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Simulated</span>
                  </div>
                  <TypewriterText text={analysis.market_impact} speed={15} />
                </div>
              ) : (
                activeStep >= 2 && (
                  <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-6 text-slate-600 flex items-center justify-center h-20 border-dashed">
                    <p className="text-xs font-mono uppercase tracking-wider animate-pulse flex items-center gap-2">
                      <span>🔓</span> Waiting for Market Impact diagnostic simulation...
                    </p>
                  </div>
                )
              )}

              {/* Step 4: Social Impact (Revealed at 12 seconds) */}
              {activeStep >= 4 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 border-l-4 border-l-purple-500 shadow-md transition-all duration-500 animate-fade-in">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-purple-400">
                      <span className="text-lg">🌎</span>
                      <h3 className="text-sm font-bold uppercase tracking-wider">Social Impact</h3>
                    </div>
                    <span className="text-[10px] text-purple-500 font-semibold uppercase bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">Sentiment Mapped</span>
                  </div>
                  <TypewriterText text={analysis.social_impact} speed={15} />
                </div>
              ) : (
                activeStep >= 3 && (
                  <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-6 text-slate-600 flex items-center justify-center h-20 border-dashed">
                    <p className="text-xs font-mono uppercase tracking-wider animate-pulse flex items-center gap-2">
                      <span>🔓</span> Waiting for Social Impact sentiment mapping...
                    </p>
                  </div>
                )
              )}

              {/* Step 5: Executive Summary (Revealed at 16 seconds) */}
              {activeStep >= 5 ? (
                <div className="bg-slate-900 border-2 border-amber-500/30 rounded-2xl p-6 shadow-xl shadow-amber-950/10 transition-all duration-500 animate-fade-in bg-gradient-to-br from-slate-900 to-amber-950/20">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-amber-400">
                      <span className="text-lg">👑</span>
                      <h3 className="text-sm font-bold uppercase tracking-wider">Executive Summary</h3>
                    </div>
                    <span className="text-[10px] text-amber-500 font-semibold uppercase bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">Synthesized</span>
                  </div>
                  <TypewriterText text={analysis.executive_summary} speed={20} />
                </div>
              ) : (
                activeStep >= 4 && (
                  <div className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-6 text-slate-600 flex items-center justify-center h-20 border-dashed">
                    <p className="text-xs font-mono uppercase tracking-wider animate-pulse flex items-center gap-2">
                      <span>👑</span> Waiting for Master Compilation synthesis...
                    </p>
                  </div>
                )
              )}

            </div>
          )}
        </div>

      </div>
    </main>
  );
}
