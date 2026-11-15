/* Original procedural stadium ambience. Audio never supplies simulation entropy. */
(function(root) {
  'use strict';
  class StadiumAudio {
    constructor() { this.enabled=false; this.volume=0.35; this.lastEvent=''; this.lastChant=0; }
    async toggle() {
      const Context=root.AudioContext||root.webkitAudioContext;
      if(!Context) throw new Error('Audio non supportato da questo browser.');
      if(!this.context) {
        this.context=new Context();
        this.master=this.context.createGain();this.master.connect(this.context.destination);
        this.buffer=this.context.createBuffer(1,this.context.sampleRate*2,this.context.sampleRate);
        const samples=this.buffer.getChannelData(0);
        for(let i=0;i<samples.length;i++) samples[i]=Math.random()*2-1;
        const crowd=this.context.createBufferSource();crowd.buffer=this.buffer;crowd.loop=true;
        const filter=this.context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=700;
        this.bed=this.context.createGain();this.bed.gain.value=0.065;
        crowd.connect(filter);filter.connect(this.bed);this.bed.connect(this.master);crowd.start();
      }
      this.enabled=!this.enabled;
      this.master.gain.value=this.volume*0.45;
      try { if(this.enabled) await this.context.resume();else await this.context.suspend(); }
      catch(error) { this.enabled=!this.enabled; throw error; }
      return this.enabled;
    }
    setVolume(value) {
      this.volume=Math.max(0,Math.min(1,value));
      if(this.master) this.master.gain.setTargetAtTime(this.volume*0.45,this.context.currentTime,0.03);
    }
    tone(frequency,duration,gain=0.08,delay=0) {
      const ctx=this.context,osc=ctx.createOscillator(),envelope=ctx.createGain(),start=ctx.currentTime+delay;
      osc.type='sine';osc.frequency.value=frequency;
      envelope.gain.setValueAtTime(0,start);envelope.gain.linearRampToValueAtTime(gain,start+0.04);envelope.gain.exponentialRampToValueAtTime(0.0001,start+duration);
      osc.connect(envelope);envelope.connect(this.master);osc.start(start);osc.stop(start+duration);
      osc.onended=()=>{osc.disconnect();envelope.disconnect();};
    }
    roar() {
      const ctx=this.context,source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
      source.buffer=this.buffer;filter.type='bandpass';filter.frequency.value=950;filter.Q.value=0.5;
      gain.gain.setValueAtTime(0.02,ctx.currentTime);gain.gain.linearRampToValueAtTime(0.3,ctx.currentTime+0.15);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+1.8);
      source.connect(filter);filter.connect(gain);gain.connect(this.master);source.start();source.stop(ctx.currentTime+1.9);
      source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
    }
    update(match,state,elapsed) {
      if(!this.enabled||!this.context||this.context.state!=='running') return;
      const event=state.events[state.events.length-1];
      const id=match.slot+':'+event.at+':'+event.type;
      if(id!==this.lastEvent) {
        this.lastEvent=id;
        // Joining or resuming never plays a backlog of old goals.
        if(elapsed-event.at<850) {
          if(event.type==='goal') this.roar();
          if(['kickoff','halftime','fulltime','red'].includes(event.type)) {
            this.tone(2600,0.24,0.06);if(event.type==='fulltime')this.tone(2850,0.45,0.06,0.32);
          }
        }
      }
      if(!state.finished&&!state.halftime&&this.context.currentTime-this.lastChant>3) {
        this.lastChant=this.context.currentTime;
        for(const [i,f] of [146.8,164.8,146.8].entries()) {
          this.tone(f,0.6,0.045,i*0.45);this.tone(f*1.01,0.65,0.025,i*0.45);this.tone(f*2,0.6,0.012,i*0.45);
        }
      }
    }
    async visibility(hidden) {
      if(!this.enabled||!this.context) return;
      if(hidden) await this.context.suspend();else await this.context.resume();
    }
  }
  root.StadiumAudio=StadiumAudio;
})(globalThis);
