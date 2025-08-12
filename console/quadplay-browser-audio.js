/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */

'use strict';

/** All sound sources that are playing */
const activeSoundHandleMap = new Map();

/** Called for both hitting the end naturally and stop_audio() */
function soundSourceOnEnded() {
    if (this.state === 'PLAYING') {
        this.state = 'ENDED';
        this.resumePositionMs = this.audioContext.currentTime * 1000 - this.startTimeMs;
    }
    activeSoundHandleMap.delete(this.handle);

    // The specification is unclear on whether we must disconnect
    // the nodes or not when the sound ends.
    this.gainNode.disconnect();
    this.panNode.disconnect();
    this.disconnect();
}


function internalSoundSourcePlay(handle, sound, startPositionMs, loop, volume, pitch, pan, rate, stopped) {
    if (stopped === undefined) { stopped = false; }
    pan = Math.min(1, Math.max(-1, pan))
    
    const source = audioContext.createBufferSource();
    source.sound = sound;
    source.buffer = sound.$buffer;
    // Needed because AudioNode.context is undefined in the onEnded callback
    source.audioContext = audioContext;

    if (audioContext.createStereoPanner) {
        source.panNode = audioContext.createStereoPanner();
        source.panNode.pan.setValueAtTime(pan, audioContext.currentTime);
    } else {
        source.panNode = audioContext.createPanner();
        source.panNode.panningModel = 'equalpower';
        source.panNode.setPosition(pan, 0, 1 - Math.abs(pan));
    }
    source.gainNode = audioContext.createGain();
    source.gainNode.gain.setValueAtTime(volume, audioContext.currentTime);

    source.connect(source.panNode);
    source.panNode.connect(source.gainNode);
    source.gainNode.connect(audioContext.gainNode);
    
    source.onended = soundSourceOnEnded;
    source.state = 'PLAYING';
    
    if (! source.start) {
        // Backwards compatibility, needed on Safari
        source.start = source.noteOn;
        source.stop  = source.noteOff;
    }
    
    source.handle = handle;
    source.sound = sound;
    source.startTimeMs = audioContext.currentTime * 1000 - startPositionMs;
    source.loop = loop;
   
    activeSoundHandleMap.set(handle, true);
    handle.$source = source;
    handle.sound = sound;

    set_playback_rate(handle, rate);
    set_pitch(handle, pitch);
    set_volume(handle, volume);
    set_pan(handle, pan);

    source.start(0, (startPositionMs % (source.buffer.duration * 1000)) / 1000);
    if (stopped) {
        source.stop();
        source.resumePositionMs = source.startTimeMs;
        source.state = 'STOPPED';
    }

    return handle;
}


// In seconds; lerp all parameter changes over 1 frame to seem
// smoother and support continuous variation.
const audioRampTime = 1 / 60;

function set_volume(handle, volume) {
    if (! (handle && handle.$source)) {
        throw new Error("Must call set_volume() on a sound returned from play_sound()");
    }
    if (typeof volume !== 'number' || isNaN(volume) || ! isFinite(volume)) {
        throw new Error("The volume must be a finite number (got " + volume + ")");
    }
    handle.$source.volume = volume;
    volume *= handle.$source.sound.$base_volume;
    handle.$source.gainNode.gain.linearRampToValueAtTime(volume, handle.$source.context.currentTime + audioRampTime);
}


function set_playback_rate(handle, rate) {
    if (! (handle && handle.$source)) {
        throw new Error("Must call set_volume() on a sound returned from play_sound()");
    }
    handle.$source.rate = rate;
    rate *= handle.$source.sound.$base_rate;
    handle.$source.playbackRate.value = rate;
}


function set_pan(handle, pan) {
    if (! (handle && handle.$source)) {
        throw new Error("Must call set_pan() on a sound returned from play_sound()");
    }
    if (typeof pan !== 'number' || isNaN(pan) || ! isFinite(pan)) {
        throw new Error("The pan must be a finite number (got " + pan + ")");
    }
    pan = Math.min(1, Math.max(-1, pan))

    handle.$source.pan = pan;
    
    pan += handle.$source.sound.$base_pan;
    pan = Math.min(1, Math.max(-1, pan))
    if (handle.$source.panNode.pan) {
        handle.$source.panNode.pan.linearRampToValueAtTime(pan, handle.$source.context.currentTime + audioRampTime);
    } else {
        // Safari fallback
        handle.$source.panNode.setPosition(pan, 0, 1 - Math.abs(pan));
    }
}


let warnedAboutPitch = false;
function set_pitch(handle, pitch) {
    if (! (handle && handle.$source)) {
        throw new Error("Must call set_pitch() on a sound returned from play_sound()");
    }
    if (typeof pitch !== 'number' || isNaN(pitch) || ! isFinite(pitch) || pitch <= 0) {
        throw new Error("The pitch must be a positive finite number (got " + pitch + ")");
    }
    handle.$source.pitch = pitch;
    pitch *= handle.$source.sound.$base_pitch;
    if (handle.$source.detune) {
        // The detune argument is in cents:
        //
        // c = 1200 * log2 (f2 / f1)
        // c = 1200 * log2(pitch)
        handle.$source.detune.linearRampToValueAtTime(Math.log2(pitch) * 1200, handle.$source.context.currentTime + audioRampTime);
    } else if (! warnedAboutPitch) {
        if (isSafari) {
            showPopupMessage('Safari does not support pitch changes.');
        } else {
            showPopupMessage('This browser does not support pitch changes.');
        }
        warnedAboutPitch = true;
    }
}


function get_audio_status(handle) {
    if (! (handle && handle.$source)) {
        throw new Error("Must call get_sound_status() on a sound returned from play_sound()");
    }

    const source = handle.$source;

    let now = 0;
    if (source.state === 'PLAYING') {
        now = source.context.currentTime * 1000 - source.startTimeMs;
    } else {
        now = source.resumePositionMs;
    }
    now *= 0.001;
        
    return {
        sound:    source.sound,
        pitch:    source.pitch,
        volume:   source.volume,
        playback_rate: source.rate,
        pan:      source.pan,
        loop:     source.loop,
        state:    source.state,
        now:      now
    }
}


// Exported to QRuntime
function play_sound(sound, volume, pan, pitch, time, rate, loop, stopped) {
    if (! sound || ! sound.$source) {
        console.log(sound);
        throw new Error('play_sound() requires a sound asset');
    }

    // Ensure that the value is a boolean
    loop = loop ? true : false;
    time = time || 0;
    if (pan === undefined) { pan = 0; }
    if (pitch === undefined) { pitch = 1; }
    if (volume === undefined) { volume = 1; }

    if (isNaN(pitch)) {
        throw new Error('pitch cannot be NaN for play_sound()');
    }

    if (isNaN(volume)) {
        throw new Error('volume cannot be NaN for play_sound()');
    }

    if (isNaN(pan)) {
        throw new Error('pan cannot be NaN for play_sound()');
    }

    rate = rate || 1;

    if (sound.$loaded) {
        return internalSoundSourcePlay({}, sound, time * 1000, loop, volume, pitch, pan, rate, stopped);
    } else {
        return undefined;
    }
}


// Exported to QRuntime
function resume_audio(handle) {
    if (! (handle && handle.$source && handle.$source.stop)) {
        throw new Error("resume_audio() takes one argument that is the handle returned from play_sound()");
    }
    
    if (handle.$source.state !== 'PLAYING') {
        // A new source must be created every time that the sound is
        // played or resumed. There is no way to pause a source in the
        // current WebAudio API.
        internalSoundSourcePlay(handle, handle.$source.sound, handle.$source.resumePositionMs, handle.$source.loop, handle.$source.volume, handle.$source.pitch, handle.$source.pan, handle.$source.rate);
    }
}


// Exported to QRuntime
function stop_audio(handle) {
    // Intentionally fail silently
    if (handle === undefined) { return; }
    
    if (! (handle && handle.$source && handle.$source.stop)) {
        throw new Error("stop_audio() takes one argument that is the handle returned from play_sound()");
    }
    
    try { 
        handle.$source.state = 'STOPPED';
        handle.$source.resumePositionMs = handle.$source.audioContext.currentTime * 1000 - handle.$source.startTimeMs;
        handle.$source.stop();
    } catch (e) {
        // Ignore invalid state error if loading has not succeeded yet
    }
}


function pauseAllSounds() {
    audioContext.suspend();
}


function stopAllSounds() {
    // Resume in case we were paused
    audioContext.resume();

    for (const handle of activeSoundHandleMap.keys()) {
        try { handle.$source.stop(); } catch (e) {}
    }
    activeSoundHandleMap.clear();
}


function resumeAllSounds() {
    audioContext.resume();
}