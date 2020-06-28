/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */
// Web software host implementation of the runtime back end

"use strict";

let spritesheetArray = [];
let fontArray = [];

if (window.location.toString().startsWith("file://")) {
    alert('quadplay cannot run from a local filesystem. It requires a web server (which may be local...see the manual)');
    throw new Error();
}

// The gif recording object, if in a recording
let gifRecording = null;

let _ch_audioContext;

// Table mapping controller IDs that we've seen to what non-keyboard
// device was set on them 
const controllerTypeTable = JSON.parse(localStorage.getItem('controllerTypeTable') || '{}');

function defaultControlType(playerIndex) {
    if (playerIndex === 0) {
        if (isMobile) {
            return 'Quadplay';
        } else {
            return 'Kbd_Alt';
        }
    } else if (playerIndex === 1) {
        return 'Kbd_P2';
    } else {
        return 'Quadplay';
    }
}


// See also controllerTypeTable and setPadType()
function detectControllerType(id) {
    let type = controllerTypeTable[id];
    
    if (type === undefined) {
        // Not previously on this machine observed. Apply heuristics
        if (/ps3|playstation(r)3/i.test(id)) {
            type = 'PlayStation3';
        } else if (/ps4|playstation/i.test(id)) {
            type = 'PlayStation4';
        } else if (/joy-con (r)/i.test(id)) {
            type = 'JoyCon_R';
        } else if (/joy-con (l)/i.test(id)) {
            type = 'JoyCon_L';
        } else if (/joy-con/i.test(id)) {
            type = 'JoyCon_R';
        } else if (/stadia/i.test(id)) {
            type = 'Stadia';
        } else if (/xbox 360/i.test(id)) {
            type = 'Xbox360';
        } else if (/xbox|xinput/i.test(id)) {
            type = 'Xbox';
        } else if (/snes/i.test(id)) {
            type = 'SNES';
        } else if (/8bitdo +s[fn]30/i.test(id)) {
            type = 'SNES';
        } else if (/8bitdo +zero/i.test(id)) {
            type = 'Zero';
        } else if (/hotas/i.test(id)) {
            type = 'HOTAS';
        } else {
            type = 'Quadplay';
        }
    }
    
    return type;
}


function setPadType(p, type) {
    const prompt = controlSchemeTable[type];
    if (p === undefined || p < 0 || p > 3) { throw new Error('"setPadType" must be used with an index from 0 to 3'); }
    if (! prompt) { throw new Error('"setPadType" must be used with one of the legal types, such as "Quadplay" or "PS4" (received "' + type + '")'); }

    const control = QRuntime.gamepad_array[p]
    control.type = type;
    control.prompt = prompt;

    const id = control._id;
    if (id && id !== '' && !/^keyboard|^kbd_/i.test(type)) {
        // Update the autodetection table based on what we just learned from this user
        controllerTypeTable[id] = type;
        localStorage.setItem('controllerTypeTable', JSON.stringify(controllerTypeTable));
    }
    
    // Update the stored binding for this controller
    localStorage.setItem('pad0' + p, JSON.stringify({id: id, type: type}));
}


function device_control(cmd) {
    switch (cmd) {
    case "start_GIF_recording":     startGIFRecording(); break;
    case "stop_GIF_recording":      stopGIFRecording(); break;
    case "take_screenshot":         downloadScreenshot(); break;
    case "take_label_image":        if (editableProject) { takeLabelImage(); } break;
    case "start_preview_recording": if (editableProject) { startPreviewRecording(); } break;
    case "set_debug_flag":
        {
            let value = (arguments[2] ? true : false);
            switch (arguments[1]) {
            case "entity_bounds":
                QRuntime._showEntityBoundsEnabled = document.getElementById('showEntityBoundsEnabled').checked = value;
                break;
            case "physics":
                QRuntime._showPhysicsEnabled = document.getElementById('showPhysicsEnabled').checked = value;
                break;
            case "debug_print":
                QRuntime._debugPrintEnabled = document.getElementById('debugPrintEnabled').checked = value;
                break;
            case "assert":
                QRuntime._assertEnabled = document.getElementById('assertEnabled').checked = value;
                break;
            case "debug_watch":
                QRuntime._debugWatchEnabled = document.getElementById('debugWatchEnabled').checked = value;
                break;
            default:
                throw new Error('Unsupported flagname passed to device_control("setDebugFlag", flagname, value): "' + arguments[1] + '"');
            }
        }
        break;
        
    case "get_debug_flag":
        {
            switch (arguments[1]) {
            case "entity_bounds":
                return QRuntime._showEntityBoundsEnabled;
                break;
            case "physics":
                return QRuntime._showPhysicsEnabled;
                break;
            case "debug_print":
                return QRuntime._debugPrintEnabled;
                break;
            case "assert":
                return QRuntime._assertEnabled;
                break;
            case "debug_watch":
                return QRuntime._debugWatchEnabled;
                break;
            default:
                throw new Error('Unsupported flagname passed to device_control("get_debug_flag", flagname): "' + arguments[1] + '"');
            }
        }
        break;
        
    case "get_analog_axes":
        {
            const i = clamp(parseInt(arguments[1]), 0, 3);
            const pad = QRuntime.gamepad_array[i];
            return Object.freeze({x: pad._analogX * QRuntime._scaleX, y: pad._analogY * QRuntime._scaleY});
            break;
        }

    case "get_mouse_state":
        {
            const mask = mouse.buttons;
            const xy = Object.freeze({
                x: mouse.screen_x * QRuntime._scaleX + QRuntime._offsetX,
                y: mouse.screen_y * QRuntime._scaleY + QRuntime._offsetY});

            const dxy = Object.freeze({
                x: (mouse.screen_x - mouse.screen_x_prev) * QRuntime._scaleX,
                y: (mouse.screen_x - mouse.screen_y_prev) * QRuntime._scaleY});
            
            return Object.freeze({
                x: xy.x,
                y: xy.y,
                dx: dxy.x,
                dy: dxy.y,
                xy: xy,
                dxy: dxy,
                button_array: Object.freeze([
                    (mask & 1),
                    (mask & 2) >> 1,
                    (mask & 4) >> 2,
                    (mask & 8) >> 3,
                    (mask & 16) >> 4,
                    (mask & 32) >> 5])});
            break;
        }

    case "set_pad_type":
        {
            const i = arguments[1];
            const type = arguments[2];
            setPadType(i, type);
            break;
        }
    }
}


window.AudioContext = window.AudioContext || window.webkitAudioContext;
console.assert(window.AudioContext);
try {
    _ch_audioContext = new AudioContext();
    _ch_audioContext.gainNode = _ch_audioContext.createGain();
    _ch_audioContext.gainNode.gain.value = 0.2;
    _ch_audioContext.gainNode.connect(_ch_audioContext.destination);
} catch(e) {
    console.log(e);
}


/************** Emulator event handling ******************************/
let emulatorKeyState = {};
let emulatorKeyJustPressed = {};
let emulatorKeyJustReleased = {};

const screenshotKey = 117; // F6
const gifCaptureKey = 119; // F8

function makeFilename(s) {
    return s.replace(/\s|:/g, '_').replace(/[^A-Za-z0-9_\.\(\)=\-\+]/g, '').replace(/_+/g, '_');
}

function onEmulatorKeyDown(event) {
    event.stopPropagation();
    event.preventDefault();

    // On browsers that support it, ignore
    // synthetic repeat events
    if (event.repeat) { return; }

    const key = event.code;
    if ((key === 'KeyP') && (event.ctrlKey || event.metaKey)) {
        // Ctrl+P
        onPauseButton();
        return;
    }

    emulatorKeyState[key] = true;
    emulatorKeyJustPressed[key] = true;

    // Pass event to the main IDE
    onDocumentKeyDown(event);
}


function makeDateFilename() {
    const now = new Date();
    const dateString = now.getFullYear() + '-' + twoDigit(now.getMonth() + 1) + '-' + twoDigit(now.getDate()) + '_' + twoDigit(now.getHours()) + 'h' + twoDigit(now.getMinutes());
    return makeFilename(gameSource.CREDITS.title + '_' + dateString);
}


function twoDigit(num) {
    return ((num < 10) ? '0' : '') + num;
}

function downloadScreenshot() {
    // Screenshot
    download(emulatorScreen.toDataURL(), makeDateFilename() + '.png');
}

function takeLabelImage() {
    // Don't capture labels at tiny resolutions
    if (SCREEN_WIDTH < 128) {
        console.log('Cannot take label images below 128 width');
        return;
    }

    // Copy the center 128x128
    const label = document.createElement('canvas');
    label.width = 128; label.height = 128;
    const ctx = label.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(emulatorScreen, (SCREEN_WIDTH - 128) >> 1, (SCREEN_HEIGHT - 128) >> 1, 128, 128, 0, 0, 128, 128);
    download(label.toDataURL(), 'label128.png');

    label.width = 64; label.height = 64;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(emulatorScreen, (SCREEN_WIDTH - 128) >> 1, (SCREEN_HEIGHT - 128) >> 1, 128, 128, 0, 0, 64, 64);
    download(label.toDataURL(), 'label64.png');
}


const PREVIEW_FRAMES_X = 6;
const PREVIEW_FRAMES_Y = 10;

function startPreviewRecording() {
    if (! previewRecording) {
        // Force 20 fps
        QRuntime._graphicsPeriod = 3;
        previewRecording = new Uint32Array(192 * 112 * PREVIEW_FRAMES_X * PREVIEW_FRAMES_Y);
        previewRecordingFrame = 0;
    }
}


function processPreviewRecording() {
    const targetX = (previewRecordingFrame % PREVIEW_FRAMES_X) * 192;
    const targetY = Math.floor(previewRecordingFrame / PREVIEW_FRAMES_X) * 112;

    // Process differently depending on the screen resolution
    if (SCREEN_WIDTH === 384 && SCREEN_HEIGHT === 224) {
        // Full resolution. Average pixels down.
        for (let y = 0; y < 112; ++y) {
            let dstOffset = (y + targetY) * 192 * PREVIEW_FRAMES_X + targetX;
            for (let x = 0; x < 192; ++dstOffset, ++x) {
                // Average four pixels
                let r = 0, g = 0, b = 0;

                for (let dy = 0; dy <= 1; ++dy) {
                    for (let dx = 0; dx <= 1; ++dx) {
                        const src = QRuntime._screen[(x*2 + dx) + (y*2 + dy) * 384];
                        r += (src >>> 8) & 0xf;
                        g += (src >>> 4) & 0xf;
                        b += src & 0xf;
                    } // dx
                } // dy

                // 16->32
                r |= r << 4;
                g |= g << 4;
                b |= b << 4;
                previewRecording[dstOffset] = (((r >> 2) & 0xff) << 16) + (((g >> 2) & 0xff) << 8) + ((b >> 2) & 0xff);
            } // x
        } // y
    } else if (SCREEN_WIDTH === 192 && SCREEN_HEIGHT === 112) {
        // Half-resolution. Copy lines directly
        for (let y = 0; y < 112; ++y) {
            previewRecording.set(updateImageData32.slice(y * 192, (y + 1) * 192), targetX + (targetY + y) * 192 * PREVIEW_FRAMES_X);
        }
    } else if (SCREEN_WIDTH === 128 && SCREEN_HEIGHT === 128) {
        // 128x128. Crop
        for (let y = 0; y < 112; ++y) {
            previewRecording.set(updateImageData32.slice((y + 8) * 128, (y + 9) * 128), (targetX + 32) + (targetY + y) * 192 * PREVIEW_FRAMES_X);
        }
    } else if (SCREEN_WIDTH === 128 && SCREEN_HEIGHT === 128) {
        // 64x64. Copy
        for (let y = 0; y < 64; ++y) {
            previewRecording.set(updateImageData32.slice(y * 64, (y + 1) * 64), (targetX + 64) + (targetY + y + 64) * 192 * PREVIEW_FRAMES_X);
        }
    } else {
        alert('Preview recording not supported at this resolution');
        throw new Error('Preview recording not supported at this resolution');
    }
    
    ++previewRecordingFrame;
    if (previewRecordingFrame >= PREVIEW_FRAMES_X * PREVIEW_FRAMES_Y) {
        // Set the alpha channel and reduce to 4:4:4
        for (let i = 0; i < previewRecording.length; ++i) {
            const c = previewRecording[i];
            const r = (c >>> 20) & 0xf;
            const g = (c >>> 12) & 0xf;
            const b = (c >>> 4)  & 0xf;
            previewRecording[i] = 0xff000000 | (r << 20) | (r << 16) | (g << 12) | (g << 8) | (b << 4) | b;
        }
        
        // Copy over data to a canvas
        const img = document.createElement('canvas');
        img.width = 192 * PREVIEW_FRAMES_X; img.height = 112 * PREVIEW_FRAMES_Y;
        const ctx = img.getContext('2d');
        const data = ctx.createImageData(img.width, img.height);
        new Uint32Array(data.data.buffer).set(previewRecording);
        ctx.putImageData(data, 0, 0);

        // Display the result
        // Download the result
        download(img.toDataURL(), 'preview.png');
        previewRecordingFrame = 0;
        previewRecording = null;
    }
}


let gifCtx = null;

function startGIFRecording() {
    if (! gifRecording) {
        document.getElementById('recording').innerHTML = 'RECORDING';
        document.getElementById('recording').classList.remove('hidden');
        const baseScale = 1;
        const scale = ((updateImage.width <= 384/2) ? (updateImage.width <= 64 ? 4 : 2) : 1) * baseScale;
        gifRecording = new GIF({workers:4, quality:3, dither:false, width: scale * updateImage.width, height: scale * updateImage.height});
        gifRecording.frameNum = 0;

        gifRecording.scale = scale;
        if (gifRecording.scale > 1) {
            const gifImage = document.createElement('canvas');
            gifImage.width = gifRecording.scale * updateImage.width;
            gifImage.height = gifRecording.scale * updateImage.height;
            gifCtx = gifImage.getContext("2d");
            gifCtx.msImageSmoothingEnabled = gifCtx.webkitImageSmoothingEnabled = gifCtx.imageSmoothingEnabled = false;
        }
        
        gifRecording.on('finished', function (blob) {
            //window.open(URL.createObjectURL(blob));
            download(URL.createObjectURL(blob), makeDateFilename() + '.gif');

            document.getElementById('recording').innerHTML = '';
            document.getElementById('recording').classList.add('hidden');
            gifCtx = null;
        });
    }
}


function stopGIFRecording() {
    if (gifRecording) {
        // Save
        document.getElementById('recording').innerHTML = 'Encoding GIF…';
        gifRecording.render();
        gifRecording = null;
    }
}


function toggleGIFRecording() {
    if (gifRecording) {
        stopGIFRecording();
    } else {
        startGIFRecording();
    }
}


function onEmulatorKeyUp(event) {
    const key = event.code;
    emulatorKeyState[key] = false;
    emulatorKeyJustReleased[key] = true;
    event.stopPropagation();
    event.preventDefault();
}

const emulatorKeyboardInput = document.getElementById('emulatorKeyboardInput');
emulatorKeyboardInput.addEventListener('keydown', onEmulatorKeyDown, false);
emulatorKeyboardInput.addEventListener('keyup', onEmulatorKeyUp, false);

/** Returns the ascii code of this character */
function ascii(x) { return x.charCodeAt(0); }

/** Used by _submitFrame() to map axes and buttons to event key codes when sampling the keyboard controller */
const keyMap = [{'-x':['KeyA', 'ArrowLeft'], '+x':['KeyD', 'ArrowRight'], '-y':['KeyW', 'ArrowUp'], '+y':['KeyS', 'ArrowDown'], a:['KeyB', 'Space'],  b:['KeyH', 'Enter'],  c:['KeyV', 'KeyV'],     d:['KeyG', 'KeyG'],          e:['ShiftLeft', 'ShiftLeft'], f:['KeyC', 'ShiftRight'],  q:['Digit1', 'KeyQ'],   p:['Digit4', 'KeyP']},
                {'-x':['KeyJ', 'KeyJ'],      '+x':['KeyL', 'KeyL'],       '-y':['KeyI', 'KeyI'],    '+y':['KeyK', 'KeyK'],     a:['Slash', 'Slash'], b:['Quote', 'Quote'], c:['Period', 'Period'], d:['Semicolon', 'Semicolon'], e:['KeyN','KeyN'],            f:['AltRight', 'AltLeft'], q:['Digit7', 'Digit7'], p:['Digit0', 'Digit0']}];
      
let prevRealGamepadState = [];

// Maps names of gamepads to arrays for mapping standard buttons
// to that gamepad's buttons. gamepadButtonRemap[canonicalButton] = actualButton
//
// Standard mapping https://www.w3.org/TR/gamepad/standard_gamepad.svg
const gamepadButtonRemap = {
    'identity':                                    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    
    // Windows SNES30
    'SNES30 Joy     (Vendor: 2dc8 Product: ab20)': [1, 0, 4, 3, 6, 7, 5, 2,10,11, 8, 9,   12, 13, 14, 15, 16],

    // Linux SNES30
    '8Bitdo SNES30 GamePad (Vendor: 2dc8 Product: 2840)': [1, 0, 4, 3, 6, 7, 5, 2,10,11, 8, 9,   12, 13, 14, 15, 16],

    'T.Flight Hotas X (Vendor: 044f Product: b108)':[0, 1, 3, 2, 4, 5, 6, 7, 10, 11, 8, 9, 12, 13, 14, 15, 16],

    // Nintendo Switch SNES official controller under safari
    '57e-2017-SNES Controller': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 12, 13, 14, 15],
    'SNES Controller (Vendor: 057e Product: 2017)': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 12, 13, 14, 15]
};

const gamepadAxisRemap = {
    'identity':                                      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    'T.Flight Hotas X (Vendor: 044f Product: b108)': [0, 1, 6, 2, 4, 5, 3, 7, 8, 9]
};


function getIdealGamepads() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : (navigator.webkitGetGamepads ? navigator.webkitGetGamepads : []);
    const gamepadArray = [];
    // Center of gamepad
    const deadZone = 0.35;
    
    // Compact gamepads array and perform thresholding
    for (let i = 0; i < gamepads.length; ++i) {
        const pad = gamepads[i];
        if (pad && pad.connected) {
            // Construct a simplified web gamepad API
            const mypad = {axes: [0, 0, 0, 0], buttons: [], analogAxes: [0, 0, 0, 0], id: pad.id};

	    const axisRemap = gamepadAxisRemap[pad.id] || gamepadAxisRemap.identity;
            
            for (let a = 0; a < Math.min(4, pad.axes.length); ++a) {
                const axis = pad.axes[axisRemap[a]];
                mypad.axes[a] = (Math.abs(axis) > deadZone) ? Math.sign(axis) : 0;
                mypad.analogAxes[a] = axis;
            }
            
            // Process all 17 buttons/axes as digital buttons first
	    const buttonRemap = gamepadButtonRemap[pad.id] || gamepadButtonRemap.identity;
            for (let b = 0; b < 17; ++b) {
                const button = pad.buttons[buttonRemap[b]];
                // Different browsers follow different APIs for the value of buttons
                mypad.buttons[b] = (typeof button === 'object') ? button.pressed : (button >= 0.5);
            }

            // D-pad is buttons U = 12, D = 13, L = 14, R = 15.
            // Use it to override the axes right here.
            if (mypad.buttons[15]) {
                mypad.axes[0] = +1;
            } else if (mypad.buttons[14]) {
                mypad.axes[0] = -1;
            }

            if (mypad.buttons[12]) {
                mypad.axes[1] = -1;
            } else if (mypad.buttons[13]) {
                mypad.axes[1] = +1;
            }

            gamepadArray.push(mypad);
            
            if (gamepadArray.length > prevRealGamepadState.length) {
                prevRealGamepadState.push({axes:[0, 0, 0, 0], 
                    buttons:[false, false, false, false, // 0-3: ABXY buttons
                             false, false, false, false, // 4-7: LB,RB,LT,RT
                             false, false, // 8 & 9: start + select
                             false, false, // 10 & 11: LS, RS
                             false, false, false, false // 12-15: D-pad
                             ]});
            }
        }
    }

    return gamepadArray;
}

let emulatorButtonState = {};

////////////////////////////////////////////////////////////////////////////////////
//
// Sounds

/** All sound sources that are playing */
const activeSoundHandleMap = new Map();
const pausedSoundHandleArray = [];

function soundSourceOnEnded() {
    this.state = 'ENDED';
    this.resumePositionMs = Date.now() - this.startTimeMs;
    activeSoundHandleMap.delete(this.handle);
}


function internalSoundSourcePlay(handle, audioClip, startPositionMs, loop, volume, pitch, pan) {
    pan = Math.min(1, Math.max(-1, pan))
    
    // A new source must be created every time that the sound is played
    const source = _ch_audioContext.createBufferSource();
    source.buffer = audioClip.buffer;
    source.state = 'PLAYING';

    if (_ch_audioContext.createStereoPanner) {
        source.panNode = _ch_audioContext.createStereoPanner();
        source.panNode.pan.setValueAtTime(pan, _ch_audioContext.currentTime);
    } else {
        source.panNode = _ch_audioContext.createPanner();
        source.panNode.panningModel = 'equalpower';
        source.panNode.setPosition(pan, 0, 1 - Math.abs(pan));
    }
    source.gainNode = _ch_audioContext.createGain();
    source.gainNode.gain.setValueAtTime(volume, _ch_audioContext.currentTime);

    source.connect(source.panNode);
    source.panNode.connect(source.gainNode);
    source.gainNode.connect(_ch_audioContext.gainNode);
    
    source.onended = soundSourceOnEnded;
    source.state = 'PLAYING';
    
    if (! source.start) {
        // Backwards compatibility
        source.start = source.noteOn;
        source.stop  = source.noteOff;
    }
    
    source.handle = handle;
    source.audioClip = audioClip;
    source.loop = loop;
    source.pitch = pitch;
    source.volume = volume;
    source.pan = pan;
    source.startTimeMs = Date.now() - startPositionMs;

    if (source.detune) {
        // Doesn't work on Safari
        source.detune.setValueAtTime((pitch - 1) * 1200, _ch_audioContext.currentTime);
    }

    activeSoundHandleMap.set(handle, true);
    handle._ = source;
    handle.audioClip = audioClip;

    source.start(0, (startPositionMs % (source.buffer.duration * 1000)) / 1000);

    return handle;
}

// In seconds
const audioRampTime = 1 / 60;

function set_volume(handle, volume) {
    if (! (handle && handle._)) {
        throw new Error("Must call set_volume() on a sound returned from play_sound()");
    }
    handle._.volume = volume;
    handle._.gainNode.gain.linearRampToValueAtTime(volume, _ch_audioContext.currentTime + audioRampTime);
}


function set_pan(handle, pan) {
    if (! (handle && handle._)) {
        throw new Error("Must call set_pan() on a sound returned from play_sound()");
    }
    pan = Math.min(1, Math.max(-1, pan))

    handle._.pan = pan;
    if (handle._.panNode.pan) {
        handle._.panNode.pan.linearRampToValueAtTime(pan, _ch_audioContext.currentTime + audioRampTime);
    } else {
        // Safari fallback
        handle._.panNode.setPosition(pan, 0, 1 - Math.abs(pan));
    }
}


function set_pitch(handle, pitch) {
    if (! (handle && handle._)) {
        throw new Error("Must call set_pitch() on a sound returned from play_sound()");
    }
    handle._.pitch = pitch;
    if (handle._.detune) {
        // Doesn't work on Safari
        handle._.detune.linearRampToValueAtTime((pitch - 1) * 1200, _ch_audioContext.currentTime + audioRampTime);
    }
}


function get_audio_status(handle) {
    if (! (handle && handle._)) {
        throw new Error("Must call get_sound_status() on a sound returned from play_sound()");
    }

    const source = handle._;
    
    return {
        pitch:    source.pitch,
        volume:   source.volume,
        pan:      source.pan,
        loop:     source.loop,
        state:    source.state
    }
}


// Exported to QRuntime
function play_sound(audioClip, loop, volume, pan, pitch, time) {
    if (audioClip.sound && (arguments.length === 1)) {
        // Object version
        loop      = audioClip.loop;
        volume    = audioClip.volume;
        pan       = audioClip.pan;
        pitch     = audioClip.pitch;
        time      = audioClip.time;
        audioClip = audioClip.sound;
    }

    if (! audioClip || ! audioClip.source) {
        console.log(audioClip);
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

    if (audioClip.loaded) {
        return internalSoundSourcePlay({_:null}, audioClip, time * 1000, loop, volume, pitch, pan);
    } else {
        return undefined;
    }
}


// Exported to QRuntime
function resume_audio(handle) {
    if (! (handle && handle._ && handle._.stop)) {
        throw new Error("resume_audio() takes one argument that is the handle returned from play_sound()");
    }
    if (handle._.resumePositionMs) {
        // Actually paused
        internalSoundSourcePlay(handle, handle._.audioClip, handle._.resumePositionMs, handle._.loop, handle._.volume, handle._.pitch, handle._.pan);
    }
}


// Exported to QRuntime
function stop_audio(handle) {
    if (! (handle && handle._ && handle._.stop)) {
        throw new Error("stop_audio() takes one argument that is the handle returned from play_sound()");
    }
    
    try {
        handle._.state = 'STOPPED';
        handle._.stop();
    } catch (e) {
        // Ignore invalid state error if loading has not succeeded yet
    }
}


function pauseAllSounds() {
    // We can't save the iterator itself because that doesn't keep the
    // sounds alive, so we store a duplicate array.
    pausedSoundHandleArray.length = 0;
    for (const handle of activeSoundHandleMap.keys()) {
        pausedSoundHandleArray.push(handle);
        try { handle._.stop(); } catch (e) {}
    }
}


function stopAllSounds() {
    pausedSoundHandleArray.length = 0;
    for (const handle of activeSoundHandleMap.keys()) {
        try { handle._.stop(); } catch (e) {}
    }
    activeSoundHandleMap.clear();
}


function resumeAllSounds() {
    for (const handle of pausedSoundHandleArray) {
        // Have to recreate, since no way to restart 
        internalSoundSourcePlay(handle, handle._.audioClip, handle._.resumePositionMs, handle._.loop, handle._.volume, handle._.pitch, handle._.pan);
    }
    pausedSoundHandleArray.length = 0;
}

////////////////////////////////////////////////////////////////////////////////////

// Escapes HTML
// Injected as debug_print in QRuntime
function debug_print(...args) {
    let s = '';
    for (let i = 0; i < args.length; ++i) {
        let m = args[i]
        if (typeof m !== 'string') { m = QRuntime.unparse(m); }
        s += m;
        if (i < args.length - 1) {
            s += ' ';
        }
    }
    
    _outputAppend(escapeHTMLEntities(s) + '\n');
}


// Injected as assert in QRuntime
function assert(x, m) {
    if (! x) {
        throw new Error(m || "Assertion failed");
    }
}

// Allows HTML, forces the system style
function _systemPrint(m, style) {
    _outputAppend('<i' + (style ? ' style="' + style + '">' : '>') + escapeHTMLEntities(m) + '</i>\n');
}


// Allows HTML
function _outputAppend(m) {    
    if (m !== '') {
        // Remove tags and then restore HTML entities
        console.log(m.replace(/<.+?>/g, '').replace(/&quot;/g,'"').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<'));

        const MAX_LENGTH = 300;
        if (outputDisplayPane.childNodes.length > MAX_LENGTH) {
            // Remove a lot, so that we amortize the cost of manipulating the DOM
            while (outputDisplayPane.childNodes.length > MAX_LENGTH - 10) {
                outputDisplayPane.removeChild(outputDisplayPane.firstChild);
            }
        }
        outputDisplayPane.insertAdjacentHTML('beforeend', m);
        
        // Scroll to bottom
        outputDisplayPane.scrollTop = outputDisplayPane.scrollHeight - outputDisplayPane.clientHeight;
    }
}


function rgbaToCSSFillStyle(color) {
    return `rgba(${color.r*255}, ${color.g*255}, ${color.b*255}, ${color.a})`;
}

// Invoked from QRuntime._show(). May not actually be invoked every
// frame if running below framerate.
function submitFrame() {
    // Update the image
    ctx.msImageSmoothingEnabled = ctx.webkitImageSmoothingEnabled = ctx.imageSmoothingEnabled = false;

    const _postFX = QRuntime._postFX;
    const hasPostFX = (_postFX.opacity < 1) || (_postFX.color.a > 0) || (_postFX.angle !== 0) ||
          (_postFX.pos.x !== 0) || (_postFX.pos.y !== 0) ||
          (_postFX.scale.x !== 1) || (_postFX.scale.y !== 1) ||
          (_postFX.blendMode !== 'source-over');

    {
        // Convert 16-bit to 32-bit
        const dst32 = updateImageData32;
        const src32 = QRuntime._screen32;
        const N = src32.length;
        for (let s = 0, d = 0; s < N; ++s) {
            // Read two 16-bit pixels at once
            let src = src32[s];
            
            // Turn into two 32-bit pixels. Only process RGB, as the alpha channel is
            // overwritten
            let A = ((src & 0x0f00) << 8) | ((src & 0x00f0) << 4) | (src & 0x000f);
            dst32[d] = 0xff000000 | A | (A << 4); ++d; src = src >> 16;
            
            A = ((src & 0x0f00) << 8) | ((src & 0x00f0) << 4) | (src & 0x000f);
            dst32[d] = 0xff000000 | A | (A << 4); ++d;
        }
    }
    
    if (previewRecording) {
        processPreviewRecording();
    }
    
    if (! hasPostFX && ! gifRecording && (emulatorScreen.width === SCREEN_WIDTH && emulatorScreen.height === SCREEN_HEIGHT)) {
        // Directly upload to the screen. Fast path when there are no PostFX
        ctx.putImageData(updateImageData, 0, 0);
    } else {
        // Put on an intermediate image and then stretch. This path is for postFX and supporting Safari
        // and other platforms where context graphics can perform nearest-neighbor interpolation but CSS scaling cannot.
        const updateCTX = updateImage.getContext('2d', {alpha: false});
        updateCTX.putImageData(updateImageData, 0, 0);
        if (_postFX.color.a > 0) {
            updateCTX.fillStyle = rgbaToCSSFillStyle(_postFX.color);
            updateCTX.globalCompositeOperation = _postFX.blendMode;
            updateCTX.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        }

        ctx.save();
        if (_postFX.background.a > 0) {
            if ((_postFX.background.r === 0) && (_postFX.background.g === 0) && (_postFX.background.b === 0) && (_postFX.background.a === 0)) {
                ctx.clearRect(0, 0, emulatorScreen.width, emulatorScreen.height);
            } else {
                ctx.fillStyle = rgbaToCSSFillStyle(_postFX.background);
                ctx.fillRect(0, 0, emulatorScreen.width, emulatorScreen.height);
            }
        }
        ctx.globalAlpha = _postFX.opacity;
        ctx.translate((_postFX.pos.x / SCREEN_WIDTH + 0.5) * emulatorScreen.width,
                      (_postFX.pos.y / SCREEN_HEIGHT + 0.5) * emulatorScreen.height); 
        ctx.rotate(-_postFX.angle);
        ctx.scale(_postFX.scale.x, _postFX.scale.y);
        ctx.translate(-emulatorScreen.width / 2, -emulatorScreen.height / 2); 
        ctx.drawImage(updateImage,
                      0, 0, SCREEN_WIDTH, SCREEN_HEIGHT,
                      0, 0, emulatorScreen.width, emulatorScreen.height);
        ctx.restore();
    }

    if (gifRecording) {
        // Only record alternating frames to reduce file size
        if (gifRecording.frameNum & 1) {
            if (gifRecording.scale > 1) {
                // Repeat pixels
                gifCtx.imageSmoothingEnabled = false;
                gifCtx.drawImage(emulatorScreen,
                                 0, 0, emulatorScreen.width, emulatorScreen.height,
                                 0, 0, SCREEN_WIDTH * gifRecording.scale, SCREEN_HEIGHT * gifRecording.scale);
                gifRecording.addFrame(gifCtx, {delay: 1000/30, copy: true});
            } else {
                gifRecording.addFrame(updateImage.getContext('2d'), {delay: 1000/30, copy: true});
            }
        }
        ++gifRecording.frameNum;
        if (gifRecording.frameNum > 60 * 12) {
            // Stop after 12 seconds
            document.getElementById('recording').classList.add('hidden');
            gifRecording.render();
            gifRecording = null;
        }
    }
    
    refreshPending = true;
}


// Called by show() to trigger sampling input
function requestInput() {
    updateKeyboardPending = true;
}


function updateInput() {
    mouse.screen_x_prev = mouse.screen_x;
    mouse.screen_y_prev = mouse.screen_y;
    
    const axes = 'xy', AXES = 'XY', buttons = 'abcdefpq';

    // HTML gamepad indices of corresponding elements of the buttons array
    // A, B, C, D, E, F, _P, Q
    const buttonIndex = [0, 1, 2, 3, 4, 5, 9, 8];
    
    // Aliases on console game controller using stick buttons
    // and trigger + shoulder buttons. These are read from 
    // gamepad_array[2] and applied to gamepad_array[0]
    const altButtonIndex = [7, 6, undefined, undefined, undefined, undefined, undefined, undefined];

    // Also processes input
    const gamepadArray = getIdealGamepads();

    // Sample the keys
    for (let player = 0; player < 4; ++player) {
        const map = keyMap[player], pad = QRuntime.gamepad_array[player],
              realGamepad = gamepadArray[player], prevRealGamepad = prevRealGamepadState[player];

        // Have player 0 physical alt controls set player 1 virtual buttons only
        // if there is no second controller physically present
	    const altRealGamepad = ((player === 1) && ! realGamepad) ? gamepadArray[0] : undefined,
	        altPrevRealGamepad = ((player === 1) && ! realGamepad) ? prevRealGamepadState[0] : undefined;

        if (realGamepad && (realGamepad.id !== pad._id)) {
            // The gamepad just connected or changed. Update the control scheme.
            pad._id = realGamepad.id;
            pad.type = detectControllerType(realGamepad.id);
            pad.prompt = controlSchemeTable[pad.type];
        } else if (! realGamepad && (pad._id !== '') && (pad._id !== 'mobile')) {
            // Gamepad was just disconnected. Update the control scheme.
            pad._id = isMobile ? 'mobile' : '';
            pad.type = defaultControlType(player);
            pad.prompt = controlSchemeTable[pad.type];
        }
        
        // Axes
        for (let a = 0; a < axes.length; ++a) {
            const axis = axes[a];
            const analogAxis = '_analog' + AXES[a];
            const pos = '+' + axis, neg = '-' + axis;
            const old = pad['_' + axis];
            const scale = 1;

            if (map) {
                // Keyboard controls
                const n0 = map[neg][0], n1 = map[neg][1], p0 = map[pos][0], p1 = map[pos][1];

                // Current state
                pad['_' + axis] = (((emulatorKeyState[n0] || emulatorKeyState[n1]) ? -1 : 0) +
                                   ((emulatorKeyState[p0] || emulatorKeyState[p1]) ? +1 : 0)) * scale;

                // Just pressed
                pad['_' + axis + axis] = (((emulatorKeyJustPressed[n0] || emulatorKeyJustPressed[n1]) ? -1 : 0) +
                                          ((emulatorKeyJustPressed[p0] || emulatorKeyJustPressed[p1]) ? +1 : 0)) * scale;
            } else {
                // Nothing currently pressed
                pad['_' + axis] = pad['_' + axis + axis] = 0;
            }

            // Reset both digital and analog axes
            pad[analogAxis] = pad['_' + axis];

            if (realGamepad && (realGamepad.axes[a] !== 0)) {
                pad['_' + axis] = realGamepad.axes[a] * scale;
                pad[analogAxis] = realGamepad.analogAxes[a] * scale;
            }

            if (realGamepad && (prevRealGamepad.axes[a] !== realGamepad.axes[a])) {
                pad['_' + axis + axis] = realGamepad.axes[a] * scale;
            }

            if ((player === 1) && ! realGamepad && gamepadArray[0]) {
                const otherPad = gamepadArray[0];
                // Alias controller[0] right stick (axes 2 + 3) 
                // to controller[1] d-pad (axes 0 + 1) for "dual stick" controls                
                if (otherPad.axes[a + 2] !== 0) {
                    pad['_' + axis] = otherPad.axes[a + 2] * scale;
                    pad[analogAxis] = otherPad.analogAxes[a + 2] * scale;
                }
                if (otherPad.axes[a + 2] !== otherPad.axes[a + 2]) {
                    pad['_' + axis + axis] = otherPad.axes[a + 2] * scale;
                }
            } // dual-stick

            pad['_d' + axis] = pad['_' + axis] - old;
        }

        for (let b = 0; b < buttons.length; ++b) {
            const button = buttons[b];
            const prefix = button === 'p' ? '_' : '';
            
            if (map) {
                // Keyboard
                const b0 = map[button][0], b1 = map[button][1];
                pad[prefix + button] = (emulatorKeyState[b0] || emulatorKeyState[b1]) ? 1 : 0;
                pad[prefix + button + button] = pad[prefix + 'pressed_' + button] = (emulatorKeyJustPressed[b0] || emulatorKeyJustPressed[b1]) ? 1 : 0;
                pad[prefix + 'released_' + button] = (emulatorKeyJustReleased[b0] || emulatorKeyJustReleased[b1]) ? 1 : 0;
            } else {
                pad[prefix + button] = pad[prefix + button + button] = pad[prefix + 'released_' + button] = pad[prefix + 'pressed_' + button] = 0;
            }

            const i = buttonIndex[b], j = altButtonIndex[b];
            const isPressed  = (realGamepad && realGamepad.buttons[i]) || (altRealGamepad && altRealGamepad.buttons[j]);
	    
	        const wasPressed = (prevRealGamepad && prevRealGamepad.buttons[i]) ||
		               (altPrevRealGamepad && altPrevRealGamepad.buttons[j]);
	    
            if (isPressed) { pad[prefix + button] = 1; }
	    
            if (isPressed && ! wasPressed) {
                pad[prefix + button + button] = 1;
                pad[prefix + 'pressed_' + button] = 1;
            }

            if (! isPressed && wasPressed) {
                pad[prefix + 'released_' + button] = 1;
            }
        }

        let oldAngle = pad._angle;
        if ((pad._y !== 0) || (pad._x !== 0)) {
            pad._angle = Math.atan2(-pad._y, pad._x);
        }

        if ((pad._y === pad._dy && pad._x === pad._dx) || (pad._y === 0 && pad._x === 0)) {
            pad._dangle = 0;
        } else {
            // JavaScript operator % is a floating-point operation
            pad._dangle = ((3 * Math.PI + pad._angle - oldAngle) % (2 * Math.PI)) - Math.PI;
        }
    }
    
    // Update previous state. This has to be done AFTER the above
    // loop so that the alternative buttons for player 2 are not
    // immediately overrident during player 1's processing.
    for (let player = 0; player < 4; ++player) {
        if (gamepadArray[player]) {
            prevRealGamepadState[player] = gamepadArray[player];
        }
    }

    // Reset the just-pressed state
    emulatorKeyJustPressed = {};
    emulatorKeyJustReleased = {};
}

////////////////////////////////////////////////////////////////////////////////////////////
//
// Mobile button support
//
// Because a touch end for *one* finger could occur for an element
// that still has another finger holding it down, we have to track
// all active touches and synthesize events for them rather than
// simply execute the mouse handlers directly. We also can't allow
// the mouse handers to *automatically* fire, since they run at a
// 300 ms delay on mobile.

// For use when processing buttons
const emulatorButtonArray = Array.from(document.getElementsByClassName('emulatorButton'));
const deadZoneArray = Array.from(document.getElementsByClassName('deadZone'));

// Maps touch.identifiers to objects with x and y members
const activeTouchTracker = {};

/* event must have clientX and clientY */
function inElement(event, element) {
    const rect = element.getBoundingClientRect();
    if (element.style.transform === 'rotate(45deg)') {
        // Assume symmetrical
        const centerX = rect.left + rect.width * 0.5;
        const centerY = rect.top + rect.height * 0.5;
        return Math.abs(centerX - event.clientX) + Math.abs(centerY - event.clientY) < rect.width * 0.5;
    } else {
        return (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    }
}

function onTouchStartOrMove(event) {
    for (let i = 0; i < event.changedTouches.length; ++i) {
        const touch = event.changedTouches[i];
        let tracker = activeTouchTracker[touch.identifier];

        if (event.target === emulatorScreen) {
            const screen_coord = emulatorScreenEventCoordToQuadplayScreenCoord(touch);

            if (! tracker || tracker.lastTarget !== emulatorScreen) {
                // New touch
                QRuntime.touch.aa = true;
                QRuntime.touch.pressed_a = true;
                QRuntime.touch.a = true;
                QRuntime.touch.screen_dx = 0;
                QRuntime.touch.screen_dy = 0;
            } else {
                // Continued touch
                QRuntime.touch.screen_dx = screen_coord.x - QRuntime.touch.screen_x;
                QRuntime.touch.screen_dy = screen_coord.y - QRuntime.touch.screen_y;
            }
            
            QRuntime.touch.screen_x = screen_coord.x;
            QRuntime.touch.screen_y = screen_coord.y;
        }

        if (tracker && (tracker.lastTarget === emulatorScreen) && (event.target !== emulatorScreen)) {
            // Lost contact with screen
            QRuntime.touch.a = false;
            QRuntime.touch.released_a = true;
        }

        if (! tracker) {
            tracker = activeTouchTracker[touch.identifier] = {identifier: touch.identifier};
        }
        
        tracker.clientX = touch.clientX;
        tracker.clientY = touch.clientY;
        tracker.lastTarget = event.target;
    }

    onTouchesChanged(event);

    if ((event.target === emulatorScreen) || (event.target.className === 'emulatorButton')) {
        // Prevent default browser handling on virtual controller buttons
        event.preventDefault();
        event.stopPropagation();
        event.cancelBubble = true;
    }

    return false;
}


function onTouchEndOrCancel(event) {
    // Add the new touches
    for (let i = 0; i < event.changedTouches.length; ++i) {
        const touch = event.changedTouches[i];
        const tracker = activeTouchTracker[touch.identifier];
        
        // The tracker *should* be found, but check defensively
        // against weird event delivery
        if (tracker) {
            if (tracker.lastTarget === emulatorScreen) {
                // Lost contact with screen
                QRuntime.touch.a = false;
                QRuntime.touch.released_a = true;
            }
            
            // Delete is relatively slow (https://jsperf.com/delete-vs-undefined-vs-null/16),
            // but there are far more move events than end events and the table is more
            // convenient and faster for processing move events than an array.
            delete activeTouchTracker[touch.identifier];            
        }
    }
    
    onTouchesChanged(event);
    return false;
}

/* Processes all emulatorButtons against the activeTouchTracker. If
   any *changed* touch was currently over a button, cancels the event. */
function onTouchesChanged(event) {
    // Do not process buttons when they aren't visible
    if (uiMode !== 'Emulator') { return; }
    
    // Latch state
    for (let j = 0; j < emulatorButtonArray.length; ++j) {
        const button = emulatorButtonArray[j];
        button.wasPressed = button.currentlyPressed || false;
        button.currentlyPressed = false;
    }
    
    // Processes all touches to see what is currently pressed
    for (let t in activeTouchTracker) {
        const touch = activeTouchTracker[t];
        let touchPressed = true;

        // Test against dead zone
        for (let j = 0; j < deadZoneArray.length; ++j) {
            if (inElement(touch, deadZoneArray[j])) {
                touchPressed = false;
                break;
            }
        }

        // Process all buttons
        for (let j = 0; j < emulatorButtonArray.length; ++j) {
            const button = emulatorButtonArray[j];
            button.currentlyPressed = button.currentlyPressed ||
                (inElement(touch, button) && touchPressed);
        }
    }

    // Now see which buttons differ from their previous state
    for (let j = 0; j < emulatorButtonArray.length; ++j) {
        const button = emulatorButtonArray[j];
        if (button.wasPressed !== button.currentlyPressed) {
            // This button's state changed
            const buttonCode = button.id.substring(0, button.id.length - 'button'.length);

            // Fake a keyboard event
            const fakeEvent = {code: buttonCode, stopPropagation:Math.abs, preventDefault:Math.abs}
            
            if (button.currentlyPressed) {
                onEmulatorKeyDown(fakeEvent);
                emulatorButtonState[buttonCode] = 1;
            } else {
                onEmulatorKeyUp(fakeEvent);
                emulatorButtonState[buttonCode] = 0;
            }
        }
    }

    // See if this event was in any of the buttons (including on and
    // end event, where it will not be in the touch list) and then
    // prevent/stop that event so that we don't get a synthetic mouse event
    // or scroll.
    for (let i = 0; i < event.changedTouches.length; ++i) {
        let touch = event.changedTouches[i];
        for (let j = 0; j < emulatorButtonArray.length; ++j) {
            if (inElement(touch, emulatorButtonArray[j])) {
                event.preventDefault();
                event.stopPropagation();
                break;
            }
        }
    }
}

const fakeMouseEvent = {
    changedTouches: [{identifier:-1, clientX: 0, clientY:0}],
    realEvent: null,
    preventDefault: function() { this.realEvent.preventDefault(); },
    stopPropagation: function() { this.realEvent.stopPropagation(); this.realEvent.cancelBubble = true; },
};

function emulatorScreenEventCoordToQuadplayScreenCoord(event) {
    const rect = emulatorScreen.getBoundingClientRect();
    
    let zoom = 1;
    if (isSafari) {
        zoom = parseFloat(document.getElementById('screenBorder').style.zoom || '1');
    }

    return {x: clamp(Math.round(emulatorScreen.width  * (event.clientX - rect.left * zoom) / (rect.width  * zoom)), 0, emulatorScreen.width  - 1) + 0.5,
            y: clamp(Math.round(emulatorScreen.height * (event.clientY - rect.top  * zoom) / (rect.height * zoom)), 0, emulatorScreen.height - 1) + 0.5};
}

const mouse = {screen_x: 0, screen_y: 0, screen_x_prev: 0, screen_y_prev: 0, buttons: 0};

function updateMouseDevice(event) {
    if (event.target === emulatorScreen) {
        const coord = emulatorScreenEventCoordToQuadplayScreenCoord(event);
        mouse.screen_x = coord.x;
        mouse.screen_y = coord.y;
    }
    mouse.buttons = event.buttons;
}
        
function onMouseDownOrMove(event) {
    updateMouseDevice(event);
    if (event.buttons !== 0) {
        // Synthesize a fake touch event (which will then get turned
        // into a fake key event!)
        fakeMouseEvent.changedTouches[0].clientX = event.clientX;
        fakeMouseEvent.changedTouches[0].clientY = event.clientY;
        fakeMouseEvent.realEvent = event;
        fakeMouseEvent.target = event.target;
        return onTouchStartOrMove(fakeMouseEvent);
    }
}


function onMouseUpOrMove(event) {
    updateMouseDevice(event);
    // Synthesize a fake touch event (which will then get turned
    // into a fake key event!)
    fakeMouseEvent.changedTouches[0].clientX = event.clientX;
    fakeMouseEvent.changedTouches[0].clientY = event.clientY;
    fakeMouseEvent.realEvent = event;
    fakeMouseEvent.target = event.target;
    return onTouchEndOrCancel(fakeMouseEvent);
}

{
    // Prevent hitches for touch event handling on Android Chrome
    // https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#Improving_scrolling_performance_with_passive_listeners
    const options = {passive: false, capture: true};
    document.addEventListener('mousedown',   onMouseDownOrMove, options);
    document.addEventListener('mousemove',   onMouseDownOrMove, options);
    document.addEventListener('mouseup',     onMouseUpOrMove, options);
    document.addEventListener('touchstart',  onTouchStartOrMove, options);
    document.addEventListener('touchmove',   onTouchStartOrMove, options);
    document.addEventListener('touchend',    onTouchEndOrCancel, options);
    document.addEventListener('touchcancel', onTouchEndOrCancel, options);
}
