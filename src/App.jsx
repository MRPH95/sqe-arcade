import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RefreshCw, Check, X, Volume2, VolumeX, Zap, Trophy, Award, Hexagon, Briefcase, Gavel, Home, ScrollText, AlertTriangle, Tag, FastForward, Eye, BrainCircuit, MessageSquare, Clock, ShieldAlert, ArrowRight, Activity, Scale, Landmark, BookOpen, Shield } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db, auth } from './firebase';

// --- AUDIO ENGINE v22.0 (Lazy Load Fix) ---
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
    this.tempo = 128; 
    this.density = 1; 
    this.nextNoteTime = 0;
    this.timerID = null;
    this.beatCount = 0;
    this.distortionNode = null;
  }

  // Initialize only on user interaction
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.createDistortion();
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  createDistortion() {
    this.distortionNode = this.ctx.createWaveShaper();
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const steps = 8; 
    for (let i = 0; i < n_samples; ++i) {
       const x = i * 2 / n_samples - 1;
       curve[i] = Math.round(x * steps) / steps; 
    }
    this.distortionNode.curve = curve;
    this.distortionNode.oversample = 'none'; 
  }

  setDensity(level) {
    this.density = Math.min(12, Math.max(1, level));
  }

  playOsc(time, freq, type, duration, vol, filterFreq, useGlitch = false) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);

    if (useGlitch) {
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(8000, time);
        vol = vol * 0.02; 
    } else {
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(filterFreq || 1500, time);
    }
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(filter);
    
    if (useGlitch && this.distortionNode) {
       filter.connect(gain); 
    } else {
       filter.connect(gain);
    }
    
    gain.connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + duration + 0.5);
  }

  playCinematicStack(time, freq, duration) {
      if (!this.ctx) return;
      const gain = this.ctx.createGain();
      gain.connect(this.ctx.destination);
      
      const harmonics = [1, 1.5, 2];
      harmonics.forEach((h, i) => {
          const osc = this.ctx.createOscillator();
          osc.type = 'sawtooth'; 
          osc.frequency.setValueAtTime(freq * h, time);
          
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(200, time);
          filter.frequency.linearRampToValueAtTime(600, time + duration); 

          osc.connect(filter);
          filter.connect(gain);
          osc.start(time);
          osc.stop(time + duration + 2.0); 
      });

      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.05, time + 2.0); 
      gain.gain.linearRampToValueAtTime(0, time + duration + 1.0);
  }

  playPad(time, freq, duration, detune = 0) {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      
      osc.type = 'triangle'; 
      osc.frequency.setValueAtTime(freq, time);
      osc.detune.value = detune;

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(200, time);
      filter.frequency.linearRampToValueAtTime(800, time + duration/2);
      
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.15, time + 1.5); 
      gain.gain.linearRampToValueAtTime(0, time + duration); 
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + duration);
  }

  playOrgan(time, freq, duration) {
    if (!this.ctx) return;
    const gain = this.ctx.createGain();
    gain.connect(this.ctx.destination);
    
    const harmonics = [1, 2, 3, 4];
    const vols = [0.02, 0.015, 0.01, 0.005]; 

    harmonics.forEach((h, i) => {
        const osc = this.ctx.createOscillator();
        osc.type = i % 2 === 0 ? 'square' : 'sawtooth'; 
        osc.frequency.setValueAtTime(freq * h, time);
        osc.connect(gain);
        osc.start(time);
        osc.stop(time + duration);
    });

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.02, time + 0.1); 
    gain.gain.setValueAtTime(0.02, time + duration - 0.1);
    gain.gain.linearRampToValueAtTime(0, time + duration);
  }

  playDrum(time, type) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const noiseNode = this.ctx.createBufferSource();

    if (type === 'kick') {
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
      gain.gain.setValueAtTime(1.0, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
      osc.connect(gain);
    } else if (type === 'hat') {
      const bufferSize = this.ctx.sampleRate * 0.1; 
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      noiseNode.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 8000;
      const hatVol = 0.01 + (this.density * 0.002); 
      gain.gain.setValueAtTime(hatVol, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
      noiseNode.connect(filter);
      filter.connect(gain);
      noiseNode.start(time);
    } else if (type === 'snare') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, time);
      gain.gain.setValueAtTime(0.4, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
      osc.connect(gain);
    }
    gain.connect(this.ctx.destination);
    if (type !== 'hat') { osc.start(time); osc.stop(time + 0.5); }
  }

  scheduler() {
    while (this.nextNoteTime < this.ctx.currentTime + 0.1) {
      this.schedulePattern(this.nextNoteTime);
      const secondsPerBeat = 60.0 / this.tempo;
      this.nextNoteTime += secondsPerBeat / 4; 
      this.beatCount++;
    }
    this.timerID = window.setTimeout(this.scheduler.bind(this), 25.0);
  }

  schedulePattern(time) {
    const step = this.beatCount % 16;
    const root = (Math.floor(this.beatCount / 32) % 2 === 0) ? 41.20 : 49.00; 
    
    // Stage 1 (Menu/Base)
    if (step % 4 === 0) this.playDrum(time, 'kick');
    if (step % 4 === 2 || step % 4 === 3) this.playOsc(time, root, 'sawtooth', 0.15, 0.5, 600);

    // Stage 2
    if (this.density >= 2 && (step === 4 || step === 12)) this.playDrum(time, 'snare');
    
    // Stage 3
    if (this.density >= 3) {
        if (step % 4 === 0) this.playOsc(time, root * 1.5, 'triangle', 0.2, 0.1, 1000); 
    }

    // Stage 4-5
    if (this.density >= 5 && step % 2 === 0) {
       const arp = [root*4, root*6, root*8, root*5];
       this.playOsc(time, arp[(step/2)%4], 'square', 0.1, 0.05, 2000);
    }

    // Stage 6
    if (this.density >= 6 && step === 0 && this.beatCount % 32 === 0) {
        this.playPad(time, root * 4, 4, -5); 
        this.playPad(time, root * 6, 4, 5); 
    }

    // Stage 7
    if (this.density >= 7 && step % 2 === 0) this.playDrum(time, 'hat'); 
    
    // Stage 8
    if (this.density >= 8) {
        const soloNotes = [root*8, root*12, root*10, root*15, root*8, root*6, root*12, root*16];
        this.playOsc(time, soloNotes[step % 8], 'sawtooth', 0.12, 0.1, 4000);
    }

    // Stage 9
    if (this.density >= 9) {
        if (step === 0 && this.beatCount % 32 === 0) {
             this.playOsc(time, root * 2, 'sawtooth', 0.08, 0.15, 800);  
             this.playOsc(time, root * 3, 'sawtooth', 0.08, 0.15, 800); 
        }
    }
    
    // Stage 10
    if (this.density >= 10 && Math.random() > 0.90) {
        this.playOsc(time, Math.random()*4000 + 200, 'sine', 0.1, 0.05, 8000, true); 
    }

    // Stage 11
    if (this.density >= 11 && step === 0 && this.beatCount % 64 === 0) {
        this.playCinematicStack(time, root, 8); 
    }
  }

  start() {
    this.init();
    if (this.isPlaying) return;
    this.resume(); 
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.beatCount = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.isPlaying = true;
    this.scheduler();
  }

  stop() {
    this.isPlaying = false;
    window.clearTimeout(this.timerID);
  }
}

const audio = new AudioEngine();

// --- VISUAL EFFECT v12.0 ---
const WormholeEffect = ({ streak, isChronos, isGameOver, failCount }) => {
  const canvasRef = useRef(null);
  const streakRef = useRef(streak); 

  useEffect(() => {
      streakRef.current = streak;
  }, [streak]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    let stars = [];
    const numStars = 300; 

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    for (let i = 0; i < numStars; i++) {
      stars.push({
        x: Math.random() * canvas.width - canvas.width / 2,
        y: Math.random() * canvas.height - canvas.height / 2,
        z: Math.random() * 2000,
        angle: Math.random() * Math.PI * 2,
        hueOffset: Math.random() * 360 
      });
    }

    const render = () => {
      const currentStreak = streakRef.current;
      
      let baseHue = 210; 
      let sat = '80%'; 
      let light = '70%'; 
      let speedMult = 1.0;
      let warpFactor = 0; 
      let isNegative = false;

      if (currentStreak >= 60) { isNegative = true; speedMult = 6.0; warpFactor = 50; } 
      else if (currentStreak >= 50) { baseHue = 'nebula'; speedMult = 5.5; warpFactor = 45; } 
      else if (currentStreak >= 45) { baseHue = 'rainbow'; speedMult = 5.0; warpFactor = 40; } 
      else if (currentStreak >= 40) { baseHue = 270; sat = '100%'; speedMult = 4.5; warpFactor = 30; } 
      else if (currentStreak >= 35) { baseHue = 300; sat = '100%'; speedMult = 4.0; warpFactor = 25; } 
      else if (currentStreak >= 30) { baseHue = 0; sat = '100%'; speedMult = 3.5; warpFactor = 20; } 
      else if (currentStreak >= 25) { baseHue = 30; sat = '100%'; speedMult = 3.0; warpFactor = 15; } 
      else if (currentStreak >= 20) { baseHue = 60; sat = '100%'; speedMult = 2.5; warpFactor = 10; } 
      else if (currentStreak >= 15) { baseHue = 90; sat = '90%'; speedMult = 2.2; warpFactor = 5; } 
      else if (currentStreak >= 10) { baseHue = 150; sat = '90%'; speedMult = 2.0; warpFactor = 2; } 
      else if (currentStreak >= 5) { baseHue = 180; sat = '90%'; speedMult = 1.5; warpFactor = 0; } 
      
      if (isChronos && currentStreak < 5) { baseHue = 150; sat = '100%'; }
      
      let bgStyle = `rgba(10, 15, 30, 0.4)`; 
      if (isNegative) {
         const fade = Math.min(1, (currentStreak - 60) / 10);
         const r = Math.floor(220 * (1-fade) + 10 * fade);
         const g = Math.floor(240 * (1-fade) + 15 * fade);
         const b = Math.floor(255 * (1-fade) + 30 * fade);
         bgStyle = `rgba(${r}, ${g}, ${b}, 0.2)`; 
      }

      const failIntensity = failCount / 10; 
      if (failCount > 0) {
          let alpha = 0;
          if (failCount > 5) {
              alpha = 0.1 + ((failCount - 5) * 0.15); 
              bgStyle = `rgba(50, 0, 0, ${alpha})`;
          }
      }
      
      if (isGameOver) { bgStyle = `rgba(50, 0, 0, 0.2)`; baseHue = 0; speedMult = 0.1; }

      ctx.fillStyle = bgStyle; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (currentStreak > 20 && !isNegative) {
          const grad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 50, canvas.width/2, canvas.height/2, canvas.width);
          grad.addColorStop(0, "rgba(0,0,0,0)");
          grad.addColorStop(1, "rgba(0,0,0,0.5)");
          ctx.fillStyle = grad;
          ctx.fillRect(0,0,canvas.width, canvas.height);
      }

      if (baseHue === 'nebula') {
          const grad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 100, canvas.width/2, canvas.height/2, canvas.width * 0.8);
          grad.addColorStop(0, "rgba(100, 0, 100, 0)");
          grad.addColorStop(0.5, "rgba(80, 20, 120, 0.1)");
          grad.addColorStop(1, "rgba(0, 0, 0, 0)");
          ctx.fillStyle = grad;
          ctx.fillRect(0,0,canvas.width, canvas.height);
      }

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const speed = 2 + (currentStreak * 0.5) * speedMult; 
      const rotationSpeed = (currentStreak >= 50 && currentStreak < 60) ? 0.05 : 0.0005 + (currentStreak * 0.0002); 

      stars.forEach(star => {
        star.z -= speed;
        star.angle += rotationSpeed;

        if (star.z <= 0) {
          star.z = 2000;
          star.x = Math.random() * canvas.width - cx;
          star.y = Math.random() * canvas.height - cy;
        }

        const scale = 500 / star.z;
        const x = cx + star.x * scale * Math.cos(star.angle) - star.y * scale * Math.sin(star.angle);
        const y = cy + star.x * scale * Math.sin(star.angle) + star.y * scale * Math.cos(star.angle);
        
        const size = (1 - star.z / 2000) * 4; 

        let starColor;
        if (isNegative) {
             const fade = Math.min(1, (currentStreak - 60) / 10);
             if (fade < 0.5) starColor = `rgba(0, 0, 0, 0.8)`; 
             else starColor = `hsl(210, 80%, 70%)`; 
        } else if (baseHue === 'rainbow') {
            starColor = `hsl(${(star.hueOffset + Date.now() * 0.2) % 360}, 100%, 70%)`;
        } else if (baseHue === 'nebula') {
             starColor = `hsl(280, 80%, 80%)`;
        } else {
            starColor = `hsl(${baseHue}, ${sat}, ${light})`;
        }
        
        ctx.strokeStyle = starColor;
        ctx.fillStyle = starColor;
        ctx.lineWidth = size;

        if (x > 0 && x < canvas.width && y > 0 && y < canvas.height) {
           ctx.beginPath();
           if (warpFactor > 0 && speed > 10) {
               const tailX = x - (x - cx) * (warpFactor * 0.005);
               const tailY = y - (y - cy) * (warpFactor * 0.005);
               ctx.moveTo(tailX, tailY);
               ctx.lineTo(x, y);
               ctx.stroke();
           } else {
               ctx.arc(x, y, size, 0, Math.PI * 2);
               ctx.fill();
           }
        }
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isChronos, isGameOver, failCount]); 

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0 opacity-100" />;
};

// --- COMPONENTS ---

const DifficultySelector = ({ current, onSelect }) => (
  <div className="flex gap-2 justify-center mb-6 flex-wrap">
    {[
      { id: 'relaxed', label: 'RELAXED (10s)', time: 10.0, multi: 0.8, color: 'hover:bg-blue-600' },
      { id: 'standard', label: 'STANDARD (5s)', time: 5.0, multi: 1.0, color: 'hover:bg-emerald-600' },
      { id: 'fast', label: 'FAST (3s)', time: 3.0, multi: 1.5, color: 'hover:bg-rose-600' }
    ].map((diff) => (
      <button
        key={diff.id}
        onClick={() => onSelect(diff.id)}
        className={`px-4 py-2 rounded-lg font-mono text-sm font-bold border transition-all ${
          current === diff.id 
            ? 'bg-slate-100 text-slate-900 border-white' 
            : `bg-slate-800 text-slate-400 border-slate-700 ${diff.color}`
        }`}
      >
        {diff.label}
      </button>
    ))}
  </div>
);

const LevelSelector = ({ current, onSelect }) => (
  <div className="flex gap-2 justify-center mb-6 flex-wrap">
    {[
      { id: 1, label: 'FOUNDATION', color: 'hover:bg-cyan-600' },
      { id: 2, label: 'MERIT', color: 'hover:bg-indigo-600' },
      { id: 3, label: 'DISTINCTION', color: 'hover:bg-fuchsia-600' }
    ].map((lvl) => (
      <button
        key={lvl.id}
        onClick={() => onSelect(lvl.id)}
        className={`px-4 py-2 rounded-lg font-mono text-sm font-bold border transition-all ${
          current === lvl.id 
            ? 'bg-slate-100 text-slate-900 border-white' 
            : `bg-slate-800 text-slate-400 border-slate-700 ${lvl.color}`
        }`}
      >
        {lvl.label} LEVEL
      </button>
    ))}
  </div>
);

const CategoryCard = ({ id, label, icon: Icon, count, onClick, isSpecial }) => (
  <button 
    onClick={onClick}
    className={`relative group border p-6 rounded-xl transition-all duration-200 hover:-translate-y-1 text-left w-full overflow-hidden ${isSpecial ? 'bg-slate-900 border-emerald-500 hover:bg-emerald-950/30' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 hover:border-emerald-400'}`}
  >
    <div className={`absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 rounded-full blur-xl transition-all ${isSpecial ? 'bg-emerald-500/30 group-hover:bg-emerald-400/50' : 'bg-gradient-to-br from-emerald-500/20 to-transparent group-hover:bg-emerald-500/30'}`}></div>
    <Icon className={`w-8 h-8 mb-3 group-hover:scale-110 transition-transform ${isSpecial ? 'text-emerald-300' : 'text-emerald-400'}`} />
    <h3 className={`text-xl font-bold mb-1 ${isSpecial ? 'text-emerald-200' : 'text-white'}`}>{label}</h3>
    <p className="text-sm text-slate-400 font-mono">{count} Questions</p>
  </button>
);

const CategoryGrid = ({ onSelect, data }) => {
  const getCount = (key) => {
      if (!data) return "0";
      if (key === 'mixed') return Object.values(data).flat().length;
      if (key === 'timing') return Object.values(data).flat().filter(q => q.isTiming).length;
      return data[key]?.length || 0;
  };

  return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <CategoryCard id="business" label="Business Law" icon={Briefcase} count={getCount('business')} onClick={() => onSelect('business')} />
          <CategoryCard id="dispute" label="Dispute Resolution" icon={Gavel} count={getCount('dispute')} onClick={() => onSelect('dispute')} />
          <CategoryCard id="contract" label="Contract Law" icon={ScrollText} count={getCount('contract')} onClick={() => onSelect('contract')} />
          <CategoryCard id="tort" label="Tort Law" icon={AlertTriangle} count={getCount('tort')} onClick={() => onSelect('tort')} />
          <CategoryCard id="public_law_1" label="Public Law I" icon={Landmark} count={getCount('public_law_1')} onClick={() => onSelect('public_law_1')} />
          <CategoryCard id="public_law_2" label="Public Law II" icon={Landmark} count={getCount('public_law_2')} onClick={() => onSelect('public_law_2')} />
          <CategoryCard id="criminalLaw" label="Criminal Law" icon={Scale} count={getCount('criminalLaw')} onClick={() => onSelect('criminalLaw')} />
          <CategoryCard id="criminalPractice" label="Criminal Practice" icon={AlertTriangle} count={getCount('criminalPractice')} onClick={() => onSelect('criminalPractice')} />
          <CategoryCard id="landLaw" label="Land Law" icon={Home} count={getCount('landLaw')} onClick={() => onSelect('landLaw')} />
          <CategoryCard id="propertyPractice" label="Property Practice" icon={Briefcase} count={getCount('propertyPractice')} onClick={() => onSelect('propertyPractice')} />
          <CategoryCard id="willsAdmin" label="Wills & Admin" icon={ScrollText} count={getCount('willsAdmin')} onClick={() => onSelect('willsAdmin')} />
          <CategoryCard id="trusts" label="Trusts & Equity" icon={BrainCircuit} count={getCount('trusts')} onClick={() => onSelect('trusts')} />
          
          <div className="col-span-full grid grid-cols-2 gap-4 mt-4">
              <CategoryCard id="mixed" label="CHAOS MODE (ALL)" icon={Hexagon} count={getCount('mixed')} onClick={() => onSelect('mixed')} isSpecial={true} />
              <CategoryCard id="timing" label="COUNTING TIME" icon={Clock} count={getCount('timing')} onClick={() => onSelect('timing')} isSpecial={true} />
          </div>
      </div>
  );
};


const Leaderboard = ({ entries }) => (
  <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700 w-full max-w-md mx-auto h-48 overflow-y-auto custom-scrollbar backdrop-blur-sm">
    <div className="flex items-center gap-2 mb-3 text-yellow-400 font-bold tracking-widest text-sm uppercase sticky top-0 bg-slate-800/90 p-2 backdrop-blur-sm z-10">
      <Trophy className="w-4 h-4" /> Global Agents
    </div>
    <div className="space-y-2">
      {entries.map((entry, idx) => (
        <div key={idx} className="flex justify-between items-center bg-slate-900/50 p-2 rounded text-xs font-mono border border-slate-800">
          <div className="flex items-center gap-2">
            <span className={`w-5 text-center font-bold ${idx < 3 ? 'text-yellow-400' : 'text-slate-500'}`}>#{idx + 1}</span>
            <div className="flex flex-col">
               <span className="text-white truncate max-w-[100px]">{entry.name}</span>
               <span className="text-[9px] text-slate-400 uppercase">{entry.mode}</span>
            </div>
          </div>
          <span className="text-emerald-400 font-bold">{entry.score.toLocaleString()}</span>
        </div>
      ))}
      {entries.length === 0 && <div className="text-center text-slate-500 py-8 italic">No data.</div>}
    </div>
  </div>
);

const shuffleArray = (array) => {
  if (!array) return [];
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export default function SQEArcade() {
  const [gameState, setGameState] = useState('menu'); 
  const [activeQuestions, setActiveQuestions] = useState([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [consecutivePasses, setConsecutivePasses] = useState(0);
  const [consecutiveWrongs, setConsecutiveWrongs] = useState(0); 
  const [timeLeft, setTimeLeft] = useState(5.0);
  const [feedback, setFeedback] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [difficulty, setDifficulty] = useState('standard');
  const [level, setLevel] = useState(2); 
  const [leaderboard, setLeaderboard] = useState([]);
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState('');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [density, setDensity] = useState(1);
  const [gameStats, setGameStats] = useState({ correct: 0, wrong: 0 });
  const [batchReview, setBatchReview] = useState([]); 
  const [commentary, setCommentary] = useState('');
  const [isChronosMode, setIsChronosMode] = useState(false);
  const [currentCategory, setCurrentCategory] = useState('');
  const [rawQuestions, setRawQuestions] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const timerRef = useRef(null);
  const MAX_FAILS = 10;
  const PASS_RESET_COUNT = 10;

  const CONFIG = {
    relaxed: { time: 10.0, multi: 0.8 },
    standard: { time: 5.0, multi: 1.0 },
    fast: { time: 3.0, multi: 1.5 }
  };

  const getLimit = () => CONFIG[difficulty].time;
  const getMultiplier = () => CONFIG[difficulty].multi;

  // LOAD DATA with CATEGORY INJECTION
  useEffect(() => {
    fetch('/questions.json')
      .then(res => res.json())
      .then(data => {
          const processedData = {};
          Object.keys(data).forEach(key => {
            const categoryLabel = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
            processedData[key] = data[key].map(q => ({
              ...q,
              category: categoryLabel 
            }));
          });
          setRawQuestions(processedData);
          setIsLoading(false);
      })
      .catch(e => {
          console.error("Failed to load questions", e);
          setIsLoading(false); 
      });
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) { console.error("Auth", e); }
    };
    initAuth();
    onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'scores'), orderBy('score', 'desc'), limit(50));
    return onSnapshot(q, (snapshot) => {
      setLeaderboard(snapshot.docs.map(doc => doc.data()));
    });
  }, [user]);

  const submitScore = async () => {
    if (!userName.trim() || !user || hasSubmitted) return;
    setHasSubmitted(true);
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'scores'), {
        name: userName.trim().slice(0, 15),
        score: score,
        difficulty: difficulty,
        level: level, 
        timestamp: serverTimestamp(),
        userId: user.uid,
        mode: isChronosMode ? 'CHRONOS' : (currentCategory || 'STANDARD')
      });
    } catch (e) { console.error(e); }
  };

  const unlockAudio = () => {
      if (!isMuted) {
        audio.resume();
        if (!audio.isPlaying) audio.start();
      }
  };

  useEffect(() => {
      const unlock = () => {
          audio.resume();
          window.removeEventListener('click', unlock);
          window.removeEventListener('touchstart', unlock);
      };
      window.addEventListener('click', unlock);
      window.addEventListener('touchstart', unlock);
      return () => {
          window.removeEventListener('click', unlock);
          window.removeEventListener('touchstart', unlock);
      };
  }, []);

  const selectCategory = (categoryKey) => {
    unlockAudio();
    selectCategoryWithState(categoryKey, false); 
  };

  const selectCategoryWithState = (categoryKey, keepState) => {
    const sourceData = rawQuestions || PREPARED_BANKS;
    
    let questions = [];
    setIsChronosMode(false);
    setCurrentCategory(categoryKey.toUpperCase());

    const allQs = Object.values(sourceData).flat();

    if (categoryKey === 'mixed') {
      questions = allQs;
    } else if (categoryKey === 'timing') {
      setIsChronosMode(true);
      questions = allQs.filter(q => q.isTiming);
    } else {
      questions = sourceData[categoryKey] || [];
    }

    const filteredQuestions = questions.filter(q => {
        const qDiff = parseInt(q.difficulty || "1");
        return qDiff <= level;
    });
    
    if (filteredQuestions.length === 0) {
        setActiveQuestions(shuffleArray(questions)); 
    } else {
        setActiveQuestions(shuffleArray(filteredQuestions));
    }
    
    startSector(keepState); 
  };

  const startSector = (keepState = false) => {
    // FORCE AUDIO UNLOCK
    audio.resume();
    audio.start();

    if (!keepState) {
        setScore(0);
        setStreak(0);
        setConsecutiveWrongs(0);
        setConsecutivePasses(0);
        setDensity(1);
        audio.setDensity(1);
    }
    setCurrentQIndex(0);
    setGameStats({ correct: 0, wrong: 0 });
    setBatchReview([]);
    setCommentary(isChronosMode ? "SYNC CHRONOMETER" : "GOOD LUCK AGENT");
    setGameState('playing');
    setTimeLeft(getLimit());
    setHasSubmitted(false);
  };

  const togglePause = useCallback(() => {
    if (gameState === 'playing') {
      setGameState('paused');
    } else if (gameState === 'paused') {
      setGameState('playing');
      audio.start();
    }
  }, [gameState, isMuted]);

  useEffect(() => {
    if (gameState === 'playing') {
      let newDensity = 1;
      if (streak >= 60) newDensity = 12; 
      else if (streak >= 50) newDensity = 11;
      else if (streak >= 45) newDensity = 10;
      else if (streak >= 40) newDensity = 9;
      else if (streak >= 35) newDensity = 8;
      else if (streak >= 30) newDensity = 7;
      else if (streak >= 25) newDensity = 6;
      else if (streak >= 20) newDensity = 5;
      else if (streak >= 15) newDensity = 4;
      else if (streak >= 10) newDensity = 3;
      else if (streak >= 5) newDensity = 2;

      if (newDensity !== density) {
        setDensity(newDensity);
        audio.setDensity(newDensity);
      }
    }
  }, [streak, gameState, density]);

  useEffect(() => {
      if ((gameState === 'menu' || gameState === 'end' || gameState === 'game_over') && !isMuted) {
          if (gameState === 'menu' || gameState === 'game_over') {
             audio.setDensity(1);
          }
          audio.resume();
          if (!audio.isPlaying) audio.start();
      }
  }, [gameState, isMuted]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.code === 'Space') {
         e.preventDefault(); 
         togglePause();
      }
      if (gameState === 'playing') {
        if (e.key.toLowerCase() === 't') handleAnswer(true);
        if (e.key.toLowerCase() === 'f') handleAnswer(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [gameState, togglePause]);

  const handleAnswer = (userAnswer) => {
    if (gameState !== 'playing') return;
    if (timerRef.current) clearInterval(timerRef.current);
    
    const currentQ = activeQuestions[currentQIndex];
    const isCorrect = userAnswer === currentQ.a;
    let points = 0;
    let timeBonus = 0;
    
    setGameStats(prev => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      wrong: prev.wrong + (!isCorrect ? 1 : 0)
    }));

    setBatchReview(prev => [...prev, {
      q: currentQ.q,
      isCorrect,
      exp: currentQ.exp
    }]);

    let newConsecutiveWrongs = consecutiveWrongs;
    let newConsecutivePasses = consecutivePasses;

    if (isCorrect) {
      timeBonus = Math.floor(timeLeft * 1000); 
      const streakBonus = streak * 100;
      const rawScore = 1000 + (timeBonus / 10) + streakBonus;
      
      const qDiff = parseInt(currentQ.difficulty || "1");
      const diffBonus = (qDiff - 1) * 500; 
      
      points = Math.floor((rawScore + diffBonus) * getMultiplier());
      
      setScore(s => s + points);
      setStreak(s => s + 1);
      
      newConsecutivePasses += 1;
      
      if (newConsecutivePasses >= PASS_RESET_COUNT && consecutiveWrongs > 0) {
          setConsecutiveWrongs(0);
          setCommentary("SYSTEM RESTORED 🔰");
          newConsecutiveWrongs = 0;
      }
      setConsecutivePasses(newConsecutivePasses);

      const newStreak = streak + 1;
      if (newStreak === 60) setCommentary("EVENT HORIZON 🌑");
      else if (newStreak === 50) setCommentary("NEBULA SURF 🌠");
      else if (newStreak === 45) setCommentary("SINGULARITY 🌌");
      else if (newStreak === 40) setCommentary("DIMENSION BREACH 🔮");
      else if (newStreak === 30) setCommentary("VOID WALKER 🚀");
      else if (newStreak === 20) setCommentary("GODLIKE ⚡");
      else if (newStreak === 10) setCommentary("UNSTOPPABLE 🔥");
      else if (timeLeft > getLimit() * 0.7) setCommentary("LIGHTNING FAST ⚡");
      else if (timeLeft < 1.0) setCommentary("CLUTCH SAVE 😅");
      else setCommentary(["NICE WORK", "TARGET DOWN", "KEEP GOING", "SOLID"][Math.floor(Math.random()*4)]);

    } else {
      newConsecutiveWrongs = consecutiveWrongs + 1;
      setConsecutiveWrongs(newConsecutiveWrongs);
      setConsecutivePasses(0); 
      
      if (newConsecutiveWrongs >= 2) {
          setStreak(s => Math.max(0, s - 5));
          setCommentary("CRITICAL HIT ⚠️");
      } else {
          setCommentary("SHIELD HIT 🛡️");
      }
    }

    setFeedback({
      correct: isCorrect,
      explanation: currentQ.exp,
      pointsEarned: points,
      msBonus: isCorrect ? timeBonus : 0,
      wasStreak: streak > 0,
      failCount: newConsecutiveWrongs
    });
    
    if (newConsecutiveWrongs >= MAX_FAILS) {
        setGameState('game_over_anim'); 
        setTimeout(() => {
            setGameState('game_over');
            audio.setDensity(1); 
        }, 2000);
    } else {
        setGameState('feedback');
        setTimeout(() => checkForReviewOrNext(), isCorrect ? 1500 : 4000);
    }
  };

  const checkForReviewOrNext = () => {
    if ((currentQIndex + 1) % 10 === 0 && currentQIndex + 1 < activeQuestions.length) {
      setGameState('review');
    } else {
      nextQuestion();
    }
  };

  const nextQuestion = () => {
    if (currentQIndex + 1 >= activeQuestions.length) {
      setGameState('end'); 
    } else {
      setCurrentQIndex(prev => prev + 1);
      setGameState('playing');
      setTimeLeft(getLimit());
      setFeedback(null);
      if (!isMuted) {
          audio.resume();
          if (!audio.isPlaying) audio.start();
      }
    }
  };

  const continueFromReview = () => {
    setBatchReview([]); 
    nextQuestion();
  };

  const hyperJump = () => {
      const sourceData = rawQuestions || PREPARED_BANKS;
      const cats = Object.keys(sourceData);
      let randomCat = cats[Math.floor(Math.random() * cats.length)];
      selectCategoryWithState(randomCat);
  };

  useEffect(() => {
    if (gameState === 'playing') {
      const startTime = Date.now();
      const initialTimeLeft = timeLeft;
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = Math.max(0, initialTimeLeft - elapsed);
        setTimeLeft(remaining);
        if (remaining <= 0) {
          clearInterval(timerRef.current);
          handleAnswer(null); 
        }
      }, 30);
    }
    return () => clearInterval(timerRef.current);
  }, [gameState, currentQIndex]);

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      audio.resume();
      audio.start();
    } else {
      setIsMuted(true);
      audio.stop();
    }
  };

  const getTimerColor = () => {
    const ratio = timeLeft / getLimit();
    if (ratio > 0.6) return 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]';
    if (ratio > 0.3) return 'bg-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.5)]';
    return 'bg-rose-600 animate-pulse shadow-[0_0_20px_rgba(225,29,72,0.8)]';
  };

  return (
    <div className={`min-h-screen bg-slate-950 text-white font-sans flex flex-col items-center justify-center relative overflow-hidden selection:bg-rose-500 transition-all duration-300 ${timeLeft < 1.5 && gameState === 'playing' ? 'shadow-[inset_0_0_100px_rgba(220,38,38,0.5)]' : ''}`}>
      
      <WormholeEffect streak={gameState === 'playing' ? streak : 0} isChronos={isChronosMode} isGameOver={gameState === 'game_over'} failCount={consecutiveWrongs} />
      
      {/* HUD */}
      <div className="fixed top-0 left-0 right-0 p-4 flex justify-between items-center z-30 bg-slate-900/80 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center gap-2">
          <Zap className={`w-6 h-6 ${gameState === 'playing' ? 'text-yellow-400 animate-pulse' : 'text-slate-500'}`} />
          <span className="font-mono font-bold text-xl tracking-tighter italic bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent hidden sm:inline">
            SQE ARCADE
          </span>
        </div>
        <div className="flex items-center gap-4 md:gap-8">
           {gameState === 'playing' && (
             <div className="flex flex-col items-end">
                <div className="flex gap-4">
                    <div className="hidden sm:flex flex-col items-end">
                        <span className="text-[10px] text-slate-400 uppercase tracking-widest">Streak</span>
                        <div className={`text-xl font-black ${streak > 4 ? 'text-cyan-400 animate-pulse' : 'text-slate-500'}`}>{streak}x</div>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-slate-400 uppercase tracking-widest">Integrity</span>
                        <div className="flex gap-0.5 mt-1 bg-slate-800 p-1 rounded">
                            {Array.from({ length: 10 }).map((_, i) => (
                                <div key={i} className={`w-1.5 h-3 rounded-sm transition-all duration-300 ${i < (10 - consecutiveWrongs) ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]' : 'bg-red-900/50'}`} />
                            ))}
                        </div>
                    </div>
                </div>
             </div>
           )}
          <div className="font-mono text-xl font-black text-white tabular-nums tracking-widest">
            {score.toLocaleString()}
          </div>
          <button onClick={toggleMute} className="hover:text-white text-slate-400 transition-colors">
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} className="text-cyan-400" />}
          </button>
        </div>
      </div>

      <div className="w-full max-w-5xl px-6 z-20 mt-16 pb-10">
        
        {/* MENU */}
        {gameState === 'menu' && (
          <div className="space-y-8 animate-in fade-in zoom-in duration-500 pt-8">
            <div className="text-center mb-8">
              <h1 className="text-6xl md:text-8xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-400 drop-shadow-2xl">
                SQE ARCADE
              </h1>
              <p className="text-slate-400 text-lg mt-4 font-mono">SELECT PROTOCOL</p>
            </div>
            {isLoading ? (
                <div className="text-center text-emerald-400 animate-pulse font-mono">INITIALIZING MAINFRAME...</div>
            ) : (
                <>
                    <DifficultySelector current={difficulty} onSelect={setDifficulty} />
                    <LevelSelector current={level} onSelect={setLevel} />
                    {/* PASS THE DATA PROP HERE */}
                    <CategoryGrid 
                    onSelect={selectCategory} 
                    data={rawQuestions || PREPARED_BANKS} 
                    />
                </>
            )}
            <div className="pt-8">
               <Leaderboard entries={leaderboard} />
            </div>
          </div>
        )}

        {/* PAUSE */}
        {gameState === 'paused' && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-xl animate-in fade-in">
            <h2 className="text-5xl font-black text-white mb-8 tracking-widest">MISSION PAUSED</h2>
            <div className="grid grid-cols-3 gap-4 mb-8 w-full max-w-md">
              <div className="bg-emerald-900/50 p-4 rounded-lg border border-emerald-500/30 text-center">
                <Check className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <div className="text-2xl font-bold">{gameStats.correct}</div>
              </div>
              <div className="bg-rose-900/50 p-4 rounded-lg border border-rose-500/30 text-center">
                <X className="w-8 h-8 text-rose-400 mx-auto mb-2" />
                <div className="text-2xl font-bold">{gameStats.wrong}</div>
              </div>
              <div className="bg-slate-800 p-4 rounded-lg border border-slate-600 text-center">
                <Eye className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
                <div className="text-2xl font-bold">{activeQuestions.length - currentQIndex}</div>
              </div>
            </div>
            <button onClick={togglePause} className="px-12 py-4 bg-white text-slate-900 font-bold rounded hover:bg-slate-200 text-xl tracking-widest">RESUME</button>
            <button onClick={() => setGameState('menu')} className="mt-6 text-slate-400 hover:text-white text-sm">ABORT MISSION</button>
          </div>
        )}

        {/* REVIEW */}
        {gameState === 'review' && (
          <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-slate-950 pt-24 pb-10 px-6 animate-in slide-in-from-bottom">
            <div className="w-full max-w-2xl h-full flex flex-col">
              <div className="text-center mb-6 shrink-0">
                <BrainCircuit className="w-12 h-12 text-cyan-400 mx-auto mb-2" />
                <h2 className="text-3xl font-black text-white uppercase tracking-widest">Tactical Review</h2>
                <p className="text-slate-400">Consolidate knowledge before proceeding.</p>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-900/50 rounded-xl border border-slate-700 p-4 space-y-3 mb-6">
                {batchReview.map((item, idx) => (
                  <div 
                    key={idx} 
                    className={`p-4 rounded-lg border-l-4 transition-all duration-700 ${item.isCorrect ? 'bg-emerald-950/30 border-emerald-500' : 'bg-rose-950/30 border-rose-500'}`}
                    style={{ 
                        opacity: 0, 
                        transform: 'translateY(20px)', 
                        animation: `fadeInUp 0.5s ease-out forwards ${idx * 0.1}s`
                    }}
                  >
                    <div className="flex justify-between items-start gap-4">
                      <p className="font-medium text-slate-200 text-sm">{item.q}</p>
                      {item.isCorrect ? <Check size={16} className="text-emerald-500 shrink-0" /> : <X size={16} className="text-rose-500 shrink-0" />}
                    </div>
                    {!item.isCorrect && (
                      <p className="text-xs text-rose-200 mt-2 font-mono bg-rose-900/20 p-2 rounded">{item.exp}</p>
                    )}
                  </div>
                ))}
                <style>{`
                    @keyframes fadeInUp {
                        from { opacity: 0; transform: translateY(20px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                `}</style>
              </div>
              <button onClick={continueFromReview} className="w-full py-4 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xl rounded-lg flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] shrink-0 shadow-lg shadow-cyan-500/20">
                CONTINUE RUN <FastForward fill="currentColor" />
              </button>
            </div>
          </div>
        )}

        {/* GAMEPLAY */}
        {(gameState === 'playing' || gameState === 'feedback' || gameState === 'game_over_anim') && (
          <div className="w-full relative max-w-3xl mx-auto pt-10">
            <div className="flex flex-col items-center mb-6">
               <div className={`flex items-center gap-3 px-6 py-3 rounded-full border shadow-[0_0_20px_rgba(16,185,129,0.2)] backdrop-blur-md transform hover:scale-105 transition-transform ${isChronosMode ? 'bg-emerald-900/90 border-emerald-400' : 'bg-slate-900/90 border-emerald-500/50'}`}>
                  {isChronosMode ? <Clock className="text-white w-5 h-5 animate-pulse" /> : <Tag className="text-emerald-400 w-5 h-5" />}
                  <span className="text-lg font-black text-white uppercase tracking-widest">
                    {isChronosMode ? 'COUNTING TIME' : activeQuestions[currentQIndex]?.category}
                  </span>
               </div>
               <div className="mt-2 h-6 flex items-center justify-center">
                  {commentary && (
                    <span className="text-sm font-mono font-bold text-cyan-400 tracking-widest animate-pulse flex items-center gap-2">
                       <MessageSquare size={12} /> {commentary}
                    </span>
                  )}
               </div>
            </div>

            <div className="w-full h-4 bg-slate-800 mb-8 overflow-hidden relative border border-slate-700 shadow-inner rounded-full">
               <div className="absolute left-1/3 top-0 bottom-0 w-0.5 bg-slate-900/50 z-10"></div>
               <div className="absolute left-2/3 top-0 bottom-0 w-0.5 bg-slate-900/50 z-10"></div>
              <div className={`h-full transition-all duration-75 ease-linear ${getTimerColor()}`} style={{ width: `${(timeLeft / getLimit()) * 100}%` }} />
            </div>

            <div className="absolute -top-12 right-0">
               <button onClick={togglePause} className="text-slate-500 hover:text-white transition-colors flex items-center gap-1 text-xs font-mono uppercase tracking-wider">
                 <Pause size={14} /> Pause
               </button>
            </div>

            <div className={`relative min-h-[400px] flex items-center justify-center transition-all duration-300 ${gameState === 'paused' ? 'blur-xl opacity-50' : ''}`}>
              
              {/* FEEDBACK */}
              {gameState === 'feedback' && (
                <div className={`absolute inset-0 z-40 flex flex-col items-center justify-center rounded-2xl backdrop-blur-xl border-4 shadow-2xl animate-in zoom-in-95 duration-200 ${feedback.correct ? 'bg-emerald-950/90 border-emerald-500' : 'bg-rose-950/90 border-rose-500'}`}>
                  {feedback.correct ? (
                    <div className="text-center">
                      <div className="text-emerald-400 font-black text-7xl mb-1 animate-bounce">+{feedback.pointsEarned}</div>
                      <div className="flex gap-4 justify-center text-xs font-mono uppercase tracking-widest mb-6">
                        <span className="text-emerald-200 bg-emerald-900/50 px-2 py-1 rounded">Time: +{feedback.msBonus}ms</span>
                        <span className="text-cyan-200 bg-cyan-900/50 px-2 py-1 rounded">Streak: {streak}x</span>
                      </div>
                    </div>
                  ) : (
                     <div className="text-center mb-6">
                      <div className="text-rose-500 font-black text-7xl mb-2">DAMAGE</div>
                      {/* Show Health Remaining */}
                      <div className="flex justify-center gap-1 mt-2">
                         {Array.from({length: 10}).map((_, i) => (
                             <div key={i} className={`w-3 h-3 rounded-full ${i < (10 - feedback.failCount) ? 'bg-emerald-500' : 'bg-rose-900'}`} />
                         ))}
                      </div>
                      <div className="text-rose-300 text-sm font-mono uppercase tracking-widest mt-4">Integrity: {Math.max(0, 10 - feedback.failCount)} / 10</div>
                    </div>
                  )}
                  
                  <div className="px-8 py-6 bg-black/60 rounded-xl max-w-xl mx-4 border border-white/10 backdrop-blur-md">
                    <h3 className="text-white/50 text-xs font-bold uppercase mb-2 tracking-widest">Legal Authority</h3>
                    <p className="text-white text-xl font-medium leading-relaxed drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)]">{feedback.explanation}</p>
                  </div>
                </div>
              )}

              {/* GAME OVER ANIM */}
              {gameState === 'game_over_anim' && (
                  <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-rose-950/90 backdrop-blur-xl animate-in fade-in zoom-in duration-300 border-4 border-rose-600 rounded-2xl">
                      <ShieldAlert className="w-32 h-32 text-rose-500 animate-pulse mb-6" />
                      <h2 className="text-6xl font-black text-white tracking-tighter mb-2">SYSTEM FAILURE</h2>
                      <p className="text-rose-300 font-mono tracking-widest uppercase">Integrity Critical</p>
                  </div>
              )}

              {/* Question */}
              <div className="text-center space-y-8 w-full">
                 <div className="flex justify-between items-center border-b border-cyan-500/20 pb-2">
                   <div className="text-xs font-mono text-cyan-500 tracking-widest uppercase">
                      Q {currentQIndex + 1} / {activeQuestions.length}
                   </div>
                   <div className="text-xs font-mono text-slate-400 uppercase tracking-widest">
                      Batch: {(currentQIndex % 10) + 1} / 10
                   </div>
                 </div>
                 
                 <div className="relative min-h-[200px] flex items-center justify-center py-6 px-4">
                    {/* FROSTED GLASS CONTAINER - LIGHTER */}
                    <div className="absolute inset-0 bg-slate-950/30 backdrop-blur-xl rounded-2xl border border-white/10 -z-10 shadow-2xl"></div>
                    <h2 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] select-none">
                      {activeQuestions[currentQIndex]?.q}
                    </h2>
                 </div>
                
                {gameState === 'playing' && (
                  <div className="grid grid-cols-2 gap-6 pt-4">
                    <button 
                      onClick={() => handleAnswer(true)}
                      className="group relative bg-slate-800/80 hover:bg-emerald-600 transition-all duration-200 border-b-4 border-slate-950 hover:border-emerald-800 active:border-b-0 active:translate-y-1 p-8 rounded-xl overflow-hidden backdrop-blur-sm"
                    >
                      <span className="block text-4xl font-black mb-1 text-slate-300 group-hover:text-white italic drop-shadow-md">TRUE</span>
                    </button>
                    
                    <button 
                      onClick={() => handleAnswer(false)}
                      className="group relative bg-slate-800/80 hover:bg-rose-600 transition-all duration-200 border-b-4 border-slate-950 hover:border-rose-800 active:border-b-0 active:translate-y-1 p-8 rounded-xl overflow-hidden backdrop-blur-sm"
                    >
                      <span className="block text-4xl font-black mb-1 text-slate-300 group-hover:text-white italic drop-shadow-md">FALSE</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* END (Success or Fail) */}
        {(gameState === 'end' || gameState === 'game_over') && (
          <div className={`text-center space-y-8 animate-in slide-in-from-bottom duration-500 max-w-6xl mx-auto p-8 rounded-2xl border backdrop-blur-xl ${gameState === 'game_over' ? 'bg-rose-950/50 border-rose-500/50' : 'bg-slate-900/90 border-white/10'}`}>
             {gameState === 'game_over' ? <ShieldAlert className="w-20 h-20 text-rose-500 mx-auto" /> : <Trophy className="w-20 h-20 text-yellow-400 mx-auto drop-shadow-glow" />}
            
            <div>
              <h2 className="text-4xl font-black text-white italic tracking-tighter mb-2">{gameState === 'end' ? 'SECTOR CLEARED' : 'MISSION FAILED'}</h2>
              <p className="text-slate-400">Final Audit Report</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto mb-8">
               <div className="bg-slate-800 p-4 rounded-lg">
                  <div className="text-slate-400 text-xs uppercase">Score</div>
                  <div className="text-3xl font-black text-emerald-400">{score.toLocaleString()}</div>
               </div>
               <div className="bg-slate-800 p-4 rounded-lg">
                  <div className="text-slate-400 text-xs uppercase">Max Streak</div>
                  <div className="text-3xl font-black text-cyan-400">{streak}</div>
               </div>
            </div>

            {/* SECTOR COMPLETE OPTIONS */}
            {gameState === 'end' && (
                <div className="flex flex-col gap-6 animate-in fade-in zoom-in duration-500">
                    <div className="flex items-center justify-center gap-2 text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400">
                        <Activity className="animate-pulse text-fuchsia-400" /> 
                        INITIATE HYPERJUMP: SELECT DESTINATION
                    </div>
                    <CategoryGrid onSelect={(cat) => selectCategoryWithState(cat, true)} data={rawQuestions || PREPARED_BANKS} />
                </div>
            )}

            {!hasSubmitted ? (
               <div className="flex gap-2 max-w-md mx-auto mt-8">
                 <input 
                   type="text" 
                   placeholder="CODENAME" 
                   maxLength={15}
                   value={userName}
                   onChange={(e) => setUserName(e.target.value.toUpperCase())}
                   className="flex-1 bg-black/30 border border-slate-600 rounded-lg px-4 py-3 text-white font-mono focus:border-emerald-500 focus:outline-none"
                 />
                 <button onClick={submitScore} disabled={!userName.trim()} className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold px-6 rounded-lg transition-colors">SAVE</button>
               </div>
            ) : (
               <div className="text-emerald-400 font-mono text-sm mt-8">UPLOAD COMPLETE</div>
            )}

            <div className="flex justify-center gap-4 mt-8">
              <button onClick={() => { startSector(false); }} className="px-8 py-3 bg-white text-slate-900 font-bold rounded-lg hover:bg-slate-200">RETRY SECTOR</button>
              <button onClick={() => setGameState('menu')} className="px-8 py-3 bg-slate-800 text-slate-300 font-bold rounded-lg hover:bg-slate-700">MENU</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
