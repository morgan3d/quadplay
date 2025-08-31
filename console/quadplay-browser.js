/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */

// Web software host implementation of the runtime back end for quadplay. This
// contains all of the routines that are browser specific for the runtime and
// could be replaced with a node.js or native version.

'use strict';

const MAX_DEBUG_OUTPUT_LENGTH = 800;

/**
   Global arrays for abstracting hardware memory copies of spritesheet
   and font data. Indices into these are is used as "pointers" when
   communicating with the virtual GPU. These are mapped to
   QRuntime.$spritesheetArray and QRuntime.$fontArray. Each asset has
   a _index[0] field describing its index in this array.
*/
let spritesheetArray = [];
let fontArray = [];

let runtime_cursor = 'crosshair';

if (window.location.toString().startsWith("file://")) {
    alert('quadplay cannot run from a local filesystem. It requires a web server (which may be local...see the manual)');
    throw new Error();
}

// The gif recording object, if in a recording
let gifRecording = null;

let audioContext;

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
        // Not previously observed on this machine. Apply heuristics
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
        } else if (/xbox 360/i.test(id) || /45e-28e-Controller/i.test(id) || /Vendor: 045e Product: 028e/i.test(id)) {
            type = 'Xbox360';
        } else if (/x-box 360 pad/i.test(id)) {
            type = 'SteamDeck';
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
        } else if (id === 'DB9 to USB v2.0 (Vendor: 289b Product: 004a)') {
            type = 'Genesis';
        } else {
            type = 'Quadplay';
        }
    }
    
    return type;
}


function setPadType(p, type) {
    const prompt = controlSchemeTable[type];
    if (p === undefined || p < 0 || p > 3) { throw new Error('"set_pad_type" must be used with an index from 0 to 3'); }
    if (! prompt) { throw new Error('"set_pad_type" must be used with one of the legal types, such as "Quadplay" or "PS4" (received "' + type + '")'); }

    const gamepad = QRuntime.gamepad_array[p]
    gamepad.type = type;
    gamepad.prompt = Object.freeze(Object.assign({'##': '' + (p + 1)}, prompt));
    const id = gamepad.$id;
    if (id && !/^keyboard|^kbd_/i.test(type)) {
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
                QRuntime.$showEntityBoundsEnabled = document.getElementById('showEntityBoundsEnabled').checked = value;
                break;
            case "physics":
                QRuntime.$showPhysicsEnabled = document.getElementById('showPhysicsEnabled').checked = value;
                break;
            case "debug_print":
                QRuntime.$debugPrintEnabled = document.getElementById('debugPrintEnabled').checked = value;
                break;
            case "assert":
                QRuntime.$assertEnabled = document.getElementById('assertEnabled').checked = value;
                break;
            case "debug_watch":
                QRuntime.$debugWatchEnabled = document.getElementById('debugWatchEnabled').checked = value;
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
                return QRuntime.$showEntityBoundsEnabled;
                break;
            case "physics":
                return QRuntime.$showPhysicsEnabled;
                break;
            case "debug_print":
                return QRuntime.$debugPrintEnabled;
                break;
            case "assert":
                return QRuntime.$assertEnabled;
                break;
            case "debug_watch":
                return QRuntime.$debugWatchEnabled;
                break;
            default:
                throw new Error('Unsupported flagname passed to device_control("get_debug_flag", flagname): "' + arguments[1] + '"');
            }
        }
        break;
        
    case "get_analog_axes":
        {
            const player = clamp(parseInt(arguments[1] || 0), 0, 3);
            const stick = clamp(parseInt(arguments[2] || 0), 0, 1);
            const pad = QRuntime.gamepad_array[player];
            return Object.freeze({x: pad.$analog[2 * stick] * QRuntime.$scaleX, y: pad.$analog[2 * stick + 1] * QRuntime.$scaleY});
            break;
        }
    
    case "get_analog_triggers":
        {
            const player = clamp(parseInt(arguments[1] || 0), 0, 3);
            const pad = QRuntime.gamepad_array[player];
            return Object.freeze([pad.$analog[4], pad.$analog[5]]);
            break;
        }

    case "rumble":
        {
            const player = clamp(parseInt(arguments[1] || 0), 0, 3);
            const frames = arguments[2] === undefined ? 10 : Math.max(parseInt(arguments[2] || 0), 0);
            const strength = arguments[3] === undefined ? 1 : Math.max(Math.min(parseFloat(arguments[3] || 0), 1), 0);
            QRuntime.gamepad_array[player].$rumble(frames, strength);
            return;
            break;
        }

    case "set_mouse_cursor":
        {
            runtime_cursor = QRuntime.unparse(arguments[1]).replace(/[^_a-z]/g, '');
            emulatorScreen.style.cursor = overlayScreen.style.cursor = runtime_cursor;
            break;
        }
        
    case "set_mouse_lock":
        // The state will be remembered and applied by pause and play buttons
        usePointerLock = arguments[1] !== false;
        if (usePointerLock) {
            maybeGrabPointerLock();
        } else {
            releasePointerLock();
        }
        break;
        
    case "get_mouse_state":
        {
            const mask = mouse.buttons;
            const xy = Object.freeze({
                x: (mouse.screen_x - QRuntime.$offsetX) / QRuntime.$scaleX,
                y: (mouse.screen_y - QRuntime.$offsetY) / QRuntime.$scaleY});

            const dxy = Object.freeze({
                x: ((mouse.movement_x === undefined) ? (mouse.screen_x - mouse.screen_x_prev) : mouse.movement_x) * QRuntime.$scaleX,
                y: ((mouse.movement_y === undefined) ? (mouse.screen_y - mouse.screen_y_prev) : mouse.movement_y) * QRuntime.$scaleY});

            const wheel = Object.freeze({
                x: mouse.wheel_dx * QRuntime.$scaleX,
                y: mouse.wheel_dy * QRuntime.$scaleY});

            return Object.freeze({
                x: xy.x,
                y: xy.y,
                dx: dxy.x,
                dy: dxy.y,
                xy: xy,
                dxy: dxy,
                wheel: wheel,
                lock: usePointerLock,
                cursor: overlayScreen.style.cursor,
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

    case "multitouch":
        {
            const xGetter = {
                enumerable: true,
                get: function () {
                    return (this.screen_x - QRuntime.$offsetX) / QRuntime.$scaleX;
                }
            };
            
            const yGetter = {
                enumerable: true,
                get: function () {
                    return (this.screen_y - QRuntime.$offsetY) / QRuntime.$scaleY;
                }
            };
        
            const xyGetter = {
                enumerable: true,
                get: function () {
                    return {x: this.x, y: this.y}
                }
            };
            

            const array = [];
            for (const k in activeTouchTracker) {
                const tracker = activeTouchTracker[k];
                if (tracker.screen_x == undefined) { continue; }
            
                const touch = {id: tracker.identifier,
                               screen_x: tracker.screen_x, screen_y: tracker.screen_y,
                               screen_xy: Object.freeze({x: tracker.screen_x, y: tracker.screen_y})};

                Object.defineProperty(touch, 'x', xGetter);
                Object.defineProperty(touch, 'y', yGetter);
                Object.defineProperty(touch, 'xy', xyGetter);

                array.push(Object.freeze(touch));
            }
            
            return array;
            break;
        }
        
    case "console.dir":
        console.dir(...Array.prototype.slice.call(arguments, 1));
        break;

    case "save":
        if (useIDE && isQuadserver) {
            const filename = arguments[1];
            const value = arguments[2];
            const callback = arguments[3];
            if (typeof filename === 'string' && filename.indexOf('/') === -1 && filename.indexOf('\\') === -1 && filename.endsWith('.json')) {
                try {
                    const jsonString = WorkJSON.stringify(value);
                    serverWriteFile(makeURLRelativeToGame(filename), 'utf8', jsonString, callback ? function() { callback(value, filename); } : undefined);
                } catch (e) {
                    // Fail silently
                    console.log(e);
                }
            }
        }
        break;

    case "load":
        if (useIDE && isQuadserver) {
            const filename = arguments[1];
            const callback = arguments[2];
            if (typeof filename === 'string' && filename.indexOf('/') === -1 && filename.indexOf('\\') === -1 && filename.endsWith('.json') && callback) {
                LoadManager.fetchOne({forceReload: true}, makeURLRelativeToGame(filename), 'json', null, function (json) {
                    try {
                        callback(json, filename);
                    } catch (e) {
                        // Fail silently
                        console.log(e);
                    }
                });
            } // if legal filename
        }
        break;

    case "get_display":
        {
            const emulator_screen = document.getElementById('screen');
            const emulator_bounds = emulator_screen.getBoundingClientRect();
            const toolbar_height = Math.ceil(document.getElementById('header').getBoundingClientRect().height);

            // This is the size of the "OS window", but the "OS window" when running in the IDE is 
            // the emulator window. 
            let window_size;

            switch (uiMode) {
            case 'Editor': // Full-screen editor. 
                // There is no visible game screen in this case, so treat as if it was the normal IDE
            case 'IDE': // Normal emulator + code pane + project pane
            case 'WideIDE': // Wide emulator + code pane
            {
                // The available window is the emulator minus some framing
                const emulator = document.getElementById('emulator');
                const screenBorder = document.getElementById('screenBorder');
                const rect = emulator.getBoundingClientRect();

                const border = parseInt(window.getComputedStyle(screenBorder).borderWidth);
                const padTop = screenBorder.offsetTop + border;
                // All other sides
                const pad = screenBorder.offsetLeft + border;
                
                window_size = Object.freeze({
                    x: rect.width - 2 * pad,
                    y: rect.height - pad - padTop});
                break;
            }

            case 'Emulator': // The touch screen emulator
            {
                // The available window is the emulator minus a lot of framing
                const emulator = document.getElementById('emulator');
                const screenBorder = document.getElementById('screenBorder');
                const rect = emulator.getBoundingClientRect();

                const border = parseInt(window.getComputedStyle(screenBorder).borderWidth);
                const padRight = document.getElementById('minimalDPad').getBoundingClientRect().right + border;

                window_size = Object.freeze({
                    x: Math.floor(document.getElementById('KeyVbutton').getBoundingClientRect().left) - border - padRight,
                    // Take off some pixels for the shaded border of the emulator case
                    y: rect.height - 2 * border - 90});
                break;
            }
            
            case 'Test': // Emulator on top of the debugger
            {
                // This case is arbitrary. Report to quadplay that it gets vertically half of
                // the screen by default, even though the aspect ratio may give it more
                window_size = Object.freeze({x: window.innerWidth, y: Math.floor(window.innerHeight - toolbar_height) / 2});
                break;
            }

            case 'Windowed': // Fill the window
            case 'Maximal': // Fill the screen
            case 'Ghost': // Code behind a translucent 'Editor' ui mode
                // Fall through to using the whole window
            default:
                // The true browser window
                window_size = Object.freeze({x: window.innerWidth, y: window.innerHeight - toolbar_height});
            }


            return Object.freeze({
                // Largest in OS-defined HiDPI pixels the largest the emulator
                // could be with fullscreen if not showing the mobile touch gamepad controls. 
                // This is the display client rect minus the quadplay
                // toolbar size.
                max_size: Object.freeze({x: window.screen.availWidth, y: window.screen.availHeight - toolbar_height}),

                // Largest in OS-defined HiDPI pixels the emulator screen can be without fullscreen mode
                // if not showing the mobile touch gamepad controls, as constrained by the browser
                // window or an iframe if embedded. This is the window client rect minus the quadplay
                // toolbar size.
                window_size: window_size,
                
                // The emulator's current screen in OS-defined HiDPI pixels.
                quadplay_size: Object.freeze({x: Math.floor(emulator_bounds.width), y: Math.floor(emulator_bounds.height)}),

                // CSS scaling factor. Not the physical to HiDPI pixel ratio
                // device_pixel_ratio: window.devicePixelRatio,

                // The display's orientation relative to its preferred orientation. 
                // For a phone, this is 0 when it is in 
                // primary portrait mode and changes clockwise with rotation. For a regular desktop monitor with landscape 
                // orientation, this is 0 always.
                orientation_angle_degrees: window.screen.orientation.angle,

                // Is the emulator currently in fullscreen mode
                fullscreen: document.fullscreenElement !== null
            });
            break;
        }

    case "enable_feature":
        {
            switch (arguments[1]) {
            case '768x448,private_views':
                QRuntime.$feature_768x448 = true;
                break;
                
            case 'steinbach':
            case 'custom_screen_size':
                QRuntime.$feature_custom_resolution = true;
                break;
                
            default:
                throw new Error('Unknown feature to device_control("enable_feature", feature): "' + arguments[1] + '"');
            }
            break;
        } // enable_feature

    default:
        throw new Error('Unknown argument to device_control(): "' + arguments[0] + '"');
        break;
    }
}


window.AudioContext = window.AudioContext || window.webkitAudioContext;
console.assert(window.AudioContext);
let volumeLevel = parseFloat(localStorage.getItem('volumeLevel') || '1');
document.getElementById('volumeSlider').value = Math.round(volumeLevel * 100);
try {
    audioContext = new AudioContext({
        latencyHint: 'interactive',

        // Sounds significantly above 11 kHz are quite unpleasant and
        // are generally not even audible to adults.  Halve memory
        // consumption by dropping the audio rate of the entire audio
        // context. (http://www.noiseaddicts.com/2009/03/can-you-hear-this-hearing-test/)
        sampleRate: 22050
        /*44100*/
    });
    audioContext.gainNode = audioContext.createGain();
    audioContext.gainNode.gain.value = 0.2 * volumeLevel;
    audioContext.gainNode.connect(audioContext.destination);
} catch(e) {
    console.log(e);
}

function onVolumeChange() {
    volumeLevel = parseInt(document.getElementById('volumeSlider').value) / 100;
    localStorage.setItem('volumeLevel', '' + volumeLevel);
    audioContext.gainNode.gain.value = 0.2 * volumeLevel;
}

/************** Emulator event handling ******************************/
let emulatorKeyState = {};
let emulatorKeyJustPressed = {};
let emulatorKeyJustReleased = {};

const screenshotKey = 117; // F6
const gifCaptureKey = 119; // F8

function resetEmulatorKeyState() {
    emulatorKeyState = {};
    emulatorKeyJustPressed = {};
    emulatorKeyJustReleased = {};
}

function makeFilename(s) {
    return s.replace(/\s|:/g, '_').replace(/[^A-Za-z0-9_\.\(\)=\-\+]/g, '').replace(/_+/g, '_');
}

function onEmulatorKeyDown(event) {
    event.stopPropagation();
    event.preventDefault();

    // On browsers that support it, ignore
    // synthetic repeat events
    if (event.repeat) { return; }

    wake();

    const key = event.code;
    if (useIDE && ((key === 'KeyP') && (event.ctrlKey || event.metaKey))) {
        // Ctrl+P is pause the IDE, not in-game pause
        onPauseButton();
        return;
    }

    // This test is needed to work around a bug that appeared on Chromium
    // 97.0.4692.99 (Edge/Chrome/Brave) on Windows, where the browser
    // sends extra repeat down events that are not flagged as `repeat` for
    // keys that are already down at the time that some other key is released.
    if (! emulatorKeyState[key]) {
        emulatorKeyJustPressed[key] = true;
    }
    emulatorKeyState[key] = true;

    // Pass event to the main IDE
    onDocumentKeyDown(event);
}


function makeDateFilename() {
    const now = new Date();
    const dateString = now.getFullYear() + '-' + twoDigit(now.getMonth() + 1) + '-' + twoDigit(now.getDate()) + '_' + twoDigit(now.getHours()) + 'h' + twoDigit(now.getMinutes());
    const tag = ((gameSource.debug && gameSource.debug.json && gameSource.debug.json.screenshot_tag_enabled) ? gameSource.debug.json.screenshot_tag : gameSource.json.screenshot_tag).trim();
    return makeFilename(dateString + (tag === '' ? '' : '_') + tag);
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
        console.log('Cannot capture label images below 128 width');
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

const PREVIEW_FPS      = 15;
const PREVIEW_FRAMES_X = 6;
const PREVIEW_FRAMES_Y = 10;

function startPreviewRecording() {
    if (! previewRecording) {
        // Force low framerate fps
        QRuntime.$graphicsPeriod = 60 / PREVIEW_FPS;
        previewRecording = new Uint32Array(192 * 112 * PREVIEW_FRAMES_X * PREVIEW_FRAMES_Y);
        previewRecordingFrame = 0;
    }
}


function processPreviewRecording() {
    const targetX = (previewRecordingFrame % PREVIEW_FRAMES_X) * 192;
    const targetY = Math.floor(previewRecordingFrame / PREVIEW_FRAMES_X) * 112;

    // Process differently depending on the screen resolution
    if (SCREEN_WIDTH === 384 && SCREEN_HEIGHT === 224) {
        // Full resolution. Average pixels down to half resolution
        for (let y = 0; y < 112; ++y) {
            let dstOffset = (y + targetY) * 192 * PREVIEW_FRAMES_X + targetX;
            for (let x = 0; x < 192; ++dstOffset, ++x) {
                // Average four pixels.
                let r = 0, g = 0, b = 0;

                for (let dy = 0; dy <= 1; ++dy) {
                    for (let dx = 0; dx <= 1; ++dx) {
                        const src = updateImageData32[(x * 2 + dx) + (y * 2 + dy) * 384];
                        r += (src >>> 16) & 0xff;
                        g += (src >>> 8) & 0xff;
                        b += src & 0xff;
                    } // dx
                } // dy

                // Divide each by 4 and store
                previewRecording[dstOffset] = (((r >> 2) & 0xff) << 16) + (((g >> 2) & 0xff) << 8) + ((b >> 2) & 0xff);
            } // x
        } // y
    } else if (SCREEN_WIDTH === 320 && SCREEN_HEIGHT === 180) {
        // Crop
        for (let y = 0; y < 112; ++y) {
            const offset = (y + 22) * 320 + 64;
            previewRecording.set(updateImageData32.slice(offset, offset + 192, targetX + (targetY + y) * 192 * PREVIEW_FRAMES_X));
        }
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
        const imgCTX = img.getContext('2d', {willReadFrequently: true});
        const data = imgCTX.createImageData(img.width, img.height);
        new Uint32Array(data.data.buffer).set(previewRecording);
        imgCTX.putImageData(data, 0, 0);

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

/** Used by $submitFrame() to map axes and buttons to event key codes
    when sampling the keyboard controller. See also
    https://hacks.mozilla.org/2017/03/internationalize-your-keyboard-controls/
    for why we use codes instead of keyCodes in JavaScript.
    
    The code using this data supports up to THREE options for each button/axis
    */
const keyMapTable = {
    Normal: [
        // Keyboard P1
        {'-x':['KeyA', 'ArrowLeft'],
         '+x':['KeyD', 'ArrowRight'],
         '-y':['KeyW', 'ArrowUp'],
         '+y':['KeyS', 'ArrowDown'],
         a:['KeyB', 'Space'],
         b:['KeyH', 'Enter', 'Backspace'],
         c:['KeyV', 'KeyV'],
         d:['KeyG', 'KeyG'],
         e:['ShiftLeft', 'ShiftLeft'],
         f:['KeyC', 'ShiftRight'],
         q:['Digit1', 'KeyQ'],
         p:['Digit4', 'KeyP', 'Escape']},

        // Keyboard P2
        {'-x':['KeyJ', 'KeyJ'],
         '+x':['KeyL', 'KeyL'],
         '-y':['KeyI', 'KeyI'],
         '+y':['KeyK', 'KeyK'],
         a:['Slash', 'Slash'],
         b:['Quote', 'Quote'],
         c:['Period', 'Period'],
         d:['Semicolon', 'Semicolon'],
         e:['KeyN', 'KeyN'],
         f:['AltRight', 'AltLeft'],
         q:['Digit7', 'Digit7'],
         p:['Digit0', 'Digit0']}],

    // https://www.ultimarc.com/Mini-PAC%20Manual1.pdf
    MiniPAC: [
        // MiniPAC P1
        {'-x':['ArrowLeft'],
         '+x':['ArrowRight'],
         '-y':['ArrowUp'],
         '+y':['ArrowDown'],
         a:['ShiftLeft'],
         b:['KeyZ'],
         c:['ControlLeft'],
         d:['AltLeft'],
         e:['Space'],
         f:['KeyX'],
         p:['Digit1'],  // P1 start
         q:['Digit5']}, // P1 coin
        
        // MiniPAC P2
        {'-x':['KeyD'],
         '+x':['KeyG'],
         '-y':['KeyR'],
         '+y':['KeyF'],
         a:['KeyW'],
         b:['KeyI'],
         c:['KeyA'],
         d:['KeyS'],
         e:['KeyQ'],
         f:['KeyK'],
         p:['Digit2'],  // P2 start
         q:['Digit6']}, // P2 coin
 
        // MiniPAC P3
        {'-x':['KeyJ'],
         '+x':['KeyL'],
         '-y':['Numpad9'],
         '+y':['Numpad0'],
         a:['KeyT'],
         b:['Backslash'],
         c:['KeyO'],
         d:['KeyC'],
         e:['Digit3'],
         f:['Enter'],
         p:[],
         q:['Digit7']}, // P3 coin

        // MiniPAC P4
        {'-x':['KeyV'],
         '+x':['KeyU'],
         '-y':['KeyY'],
         '+y':['KeyN'],
         a:['KeyH'],
         b:['KeyM'],
         c:['KeyB'],
         d:['KeyE'],
         e:['KeyP'],
         f:['Digit4'],
         p:[],
         q:['Digit8']} // P4 coin
    ],

    // https://docs.mamedev.org/usingmame/defaultkeys.html#player-1-controls
    MAME: [
        // MAME P1
        {'-x':['ArrowLeft'],
         '+x':['ArrowRight'],
         '-y':['ArrowUp'],
         '+y':['ArrowDown'],
         a:['ControlLeft'],
         b:['AltLeft'],
         c:['Space'],
         d:['ShiftLeft'],
         e:['KeyZ'], // 5
         f:['KeyX'], // 6
         p:['Digit1'], // P1 Start
         q:['Digit5']}, // P1 Coin
        
        // MAME P2
        {'-x':['KeyD'],
         '+x':['KeyG'],
         '-y':['KeyR'],
         '+y':['KeyF'],
         a:['KeyA'],
         b:['KeyS'],
         c:['KeyQ'],
         d:['KeyW'],
         e:['KeyE'],
         f:[],
         p:['Digit2'], // P2 Start
         q:['Digit6']}, // P2 Coin
        
        // MAME P3
        {'-x':['KeyJ'],
         '+x':['KeyL'],
         '-y':['KeyI'],
         '+y':['KeyK'],
         a:['ControlRight'],
         b:['ShiftRight'],
         c:['Enter'],
         e:[],
         f:[],
         p:['Digit3'],
         q:['Digit7']},
        
        // MAME P4
        {'-x':['Numpad4'],
         '+x':['Numpad6'],
         '-y':['Numpad8'],
         '+y':['Numpad2'],
         a:['Numpad0'],
         b:['NumpadDecimal'],
         c:['NumpadEnter'],
         e:[],
         f:[],
         p:['Digit4'],
         q:['Digit8']}]
};


let prevRealGamepadState = [];

// Maps names of gamepads to arrays for mapping standard buttons
// to that gamepad's buttons. gamepadButtonRemap[canonicalButton] = actualButton (what
// html5gamepad.com returns when that button is pressed)
//
// Standard mapping https://www.w3.org/TR/gamepad/standard_gamepad.svg
const gamepadButtonRemap = {
    'identity':                                     [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],

    // Steam Deck
    '28de-11ff-Microsoft X-Box 360 pad 0':          [0, 1, 2, 3, 4, 5, 8, 11, 6, 7, 9, 10, 12, 13, 14, 15, 16],
    
    // Windows SNES30
    'SNES30 Joy     (Vendor: 2dc8 Product: ab20)':  [1, 0, 4, 3, 6, 7, 5, 2,10,11, 8, 9,   12, 13, 14, 15, 16],

    // Linux SNES30
    '8Bitdo SNES30 GamePad (Vendor: 2dc8 Product: 2840)': [1, 0, 4, 3, 6, 7, 5, 2,10,11, 8, 9,   12, 13, 14, 15, 16],

    'T.Flight Hotas X (Vendor: 044f Product: b108)':[0, 1, 3, 2, 4, 5, 6, 7, 10, 11, 8, 9, 12, 13, 14, 15, 16],

    // Nintendo Switch SNES official controller under safari
    '57e-2017-SNES Controller':                     [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 12, 13, 14, 15],
    'SNES Controller (Vendor: 057e Product: 2017)': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 12, 13, 14, 15],

    // Raphnet adapter with the retro bit SEGA Genesis and Mega Drive controllers
    'DB9 to USB v2.0 (Vendor: 289b Product: 004a)': [0, 1, 4, 5, 4, 2, 8, 9, 7, 3, 10, 11, 12, 13, 14, 15, 16]
};

const gamepadAxisRemap = {
    'identity':                                     [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    '28de-11ff-Microsoft X-Box 360 pad 0':          [0, 1, 3, 4, 2, 5, 6, 7],
    'T.Flight Hotas X (Vendor: 044f Product: b108)':[0, 1, 6, 2, 4, 5, 3, 7, 8, 9]
};

const gamepadAxisInvert = {
    'identity': [+1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1],

    // Firefox Xbox 360 as of June 2025 inverts the Y axix
    '45e-28e-Controller': isSafari ? [+1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1] :
                            [+1, -1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1],

    // Chromium Xbox 360 as of June 2025 inverts the Y axix
    'Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)': isSafari ? [+1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1] :
                    [+1, -1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1, +1]
};


/* Calling navigator.getGamepads is surprisingly slow (consistently
   0.6% of 60Hz frame time on Chromium), so we abstract and amortize over
   frames when no gamepad is present. When a gamepad IS present, 
   we poll every frame because Chromium only updates gamepad values
   on the call:

   "Chrome does things differently here. Instead of constantly
   storing the gamepad's latest state in a variable it only stores
   a snapshot, so to do the same thing in Chrome you have to keep
   polling it." https://udn.realityripple.com/docs/Web/API/Gamepad_API/Using_the_Gamepad_API
   (Verified by Morgan 2022-09-27)
 */
function getGamepads() {
    if (getGamepads.counter === 0 || (! getGamepads.gamepads) || getGamepads.gamepads.length === 0) {
        // Update
        getGamepads.gamepads = getGamepads.navigator.getGamepads();
    }

    // Amortize the cost over four frames
    if (getGamepads.gamepads.length > 0 || ++getGamepads.counter >= 4) {
        getGamepads.counter = 0;
    }

    return getGamepads.gamepads;
}
getGamepads.navigator = navigator;
getGamepads.counter = 0;
getGamepads.gamepads = [];
Object.seal(getGamepads);
        
        

function getIdealGamepads() {
    const gamepads = getGamepads();
    const gamepadArray = [];
    // Center of gamepad
    const deadZone = 0.35;
    
    // Compact gamepads array and perform thresholding
    for (let i = 0; i < gamepads.length; ++i) {
        const pad = gamepads[i];
        if (pad && pad.connected) {
            // Construct a simplified web gamepad API
            const mypad = {axes: [0, 0, 0, 0], buttons: [], analogAxes: [0, 0, 0, 0, 0, 0], id: pad.id};

            const axisInvert = gamepadAxisInvert[pad.id] || gamepadAxisInvert.identity;
	        const axisRemap = gamepadAxisRemap[pad.id] || gamepadAxisRemap.identity;
            
            // Stick axes
            for (let a = 0; a < 4; ++a) {
                let axis = pad.axes[axisRemap[a]] * axisInvert[a];
                mypad.axes[a] = (Math.abs(axis) > deadZone) ? Math.sign(axis) : 0;
                mypad.analogAxes[a] = axis;
            }
            
            // Process all 17 buttons as digital buttons first, even if they are analog
	        const buttonRemap = gamepadButtonRemap[pad.id] || gamepadButtonRemap.identity;
            for (let b = 0; b < 17; ++b) {
                const button = pad.buttons[buttonRemap[b]];
                // Different browsers follow different APIs for the value of buttons. It is supposed to
                // be an object with pressed, touched, and value fields
                mypad.buttons[b] = (typeof button === 'object') ? button.pressed : (button >= 0.5);
            }
            {
                // Triggers, which we map to fake axes
                for (let b = 4; b < 6; ++b) {
                    const button = pad.buttons[buttonRemap[b + 2]];
                    mypad.analogAxes[b] = (typeof button === 'object') ? button.value : button;
                }
            }

            // On Steam Deck, the D-pad maps to axes 6 and 7 instead of buttons.
            // But do not override the left stick!
            if (pad.id === '28de-11ff-Microsoft X-Box 360 pad 0') {
                if (pad.axes[6] !== 0) {
                    mypad.axes[0] = pad.axes[6];
                    if (pad.axes[6] > 0) {
                        mypad.buttons[15] = true;
                    } else {
                        mypad.buttons[14] = true;
                    }
                }

                if (pad.axes[7] !== 0) {
                    mypad.axes[1] = pad.axes[7];
                    if (pad.axes[7] > 0) {
                        mypad.buttons[13] = true;
                    } else {
                        mypad.buttons[12] = true;
                    }
                }
                
            } else { // Not steam deck

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
            }

            gamepadArray.push(mypad);
            
            if (gamepadArray.length > prevRealGamepadState.length) {
                prevRealGamepadState.push({axes:[0, 0, 0, 0], 
                    buttons:[false, false, false, false, // 0-3: ABXY buttons
                             false, false, false, false, // 4-7: LB,RB,LT,RT
                             false, false, // 8 & 9: select, start
                             false, false, // 10 & 11: LS, RS
                             false, false, false, false // 12-15: D-pad
                             ]});
            }
        }
    }

    return gamepadArray;
}

let emulatorButtonState = {};


// Allows HTML, forces the system style
function $systemPrint(m, style) {
    $outputAppend('<i' + (style ? ' style="' + style + '">' : '>') + escapeHTMLEntities(m) + '</i>\n');
}


// Allows HTML. location may be undefined
function $outputAppend(m, location, linkAll) {
    if (m !== '' && m !== undefined) {
        // Uncomment to debug mystery output. Also
        // use your browser debugger to 'pause on caught exceptions'
        // console.trace();
        
        // Remove tags and then restore HTML entities
        console.log(m.replace(/<.+?>/g, '').replace(/&quot;/g,'"').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<'));

        if (outputDisplayPane.childNodes.length > MAX_DEBUG_OUTPUT_LENGTH) {
            // Remove a lot, so that we amortize the cost of manipulating the DOM
            while (outputDisplayPane.childNodes.length > MAX_DEBUG_OUTPUT_LENGTH - 20) {
                outputDisplayPane.removeChild(outputDisplayPane.firstChild);
            }
        }

        if (location && location.url) {
            let tooltip = location.url.replace(/^.*\//, '');
            if (/[A-Z]/.test(tooltip[0])) {
                // For modes, remove the extension
                tooltip = tooltip.replace(/\.pyxl$/, '');
            }
            tooltip += ':' + location.line_number;
            
            if (linkAll) {
                m = `<span style="cursor:pointer" title="${tooltip}" onclick="editorGotoFileLine('${location.url}', ${location.line_number}, undefined, false)">${m}</span>`;
            } else {
                m = `<div class="outputLine"><a class="outputLink" onclick="editorGotoFileLine('${location.url}', ${location.line_number}, undefined, false)">${tooltip}</a>${m}</div>`;
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


/* Invoked as QRuntime.$submitFrame(). May not actually be invoked
   every frame if running below framerate due to missed frames or
   graphics framerate scaling.

   Will be called from the onMessage handler for a threaded GPU.

   `gpuThreadTime` will only be defined if $THREADED_GPU is true. It
   is the elapsed time measured on the GPU thread for the draw calls
   executed this frame.
*/
function submitFrame(_updateImageData, _updateImageData32, gpuThreadTime) {
    if (gpuThreadTime !== undefined) {
        profiler.smoothGPUTime.update(gpuThreadTime);
    }
    
    // Force the data back into the variables that were temporarily nulled out if using a web worker
    console.assert(_updateImageData, _updateImageData32);
    updateImageData = _updateImageData;
    updateImageData32 = _updateImageData32;
    
    {
        // Update the image
        const $postFX = QRuntime.$postFX;

        // Ignore bloom and burn_in, which are handled with overlays
        const hasPostFX =
            ($postFX.motion_blur > 0) ||
            ($postFX.color.a > 0) ||
            ($postFX.angle !== 0) ||
            ($postFX.pos.x !== 0) || ($postFX.pos.y !== 0) ||
            ($postFX.scale.x !== 1) || ($postFX.scale.y !== 1) ||
            ($postFX.color_blend !== 'source-over');
        
        if (previewRecording && (QRuntime.game_frames % (60 / PREVIEW_FPS) === 0)) {
            processPreviewRecording();
        }

        if ((! isHosting || isFirefox || isSafari) && ! hasPostFX && ! gifRecording && (emulatorScreen.width === SCREEN_WIDTH && emulatorScreen.height === SCREEN_HEIGHT)) {
            // Directly upload to the screen. Fast path when there are no PostFX.
            //
            // Chromium (Chrome & Edge) have a bug where we can't get a video stream
            // from the direct putImageData, so they are excluded from this path when
            // hosting.
            ctx.putImageData(updateImageData, 0, 0);
        } else {
            // Put on an intermediate image and then stretch. This path is
            // for postFX and supporting Safari and other platforms where
            // context graphics can perform nearest-neighbor interpolation
            // but CSS scaling cannot.
            const updateCTX = updateImage.getContext('2d', {alpha: false});
            updateCTX.putImageData(updateImageData, 0, 0);
            
            if ($postFX.color.a > 0) {
                updateCTX.fillStyle = rgbaToCSSFillStyle($postFX.color);
                updateCTX.globalCompositeOperation = $postFX.color_blend;
                updateCTX.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
            }

            ctx.save();

            if ($postFX.pos.x !== 0 || $postFX.pos.y !== 0 || $postFX.angle !== 0 || $postFX.scale.x !== 1 || $postFX.scale.y !== 1) {
                // Transformed

                const backgroundRevealed = $postFX.pos.x !== 0 || $postFX.pos.y !== 0 || $postFX.angle !== 0 || $postFX.scale.x < 1 || $postFX.scale.y < 1;

                if (backgroundRevealed) {
                    // Fill revealed background areas. Unfortunately,
                    // canvas patterns cannot clamp to border, so we
                    // draw a big polygon

                    const $background = QRuntime.$background;
                    if ($background.spritesheet) {
                        ctx.fillStyle = '#000';
                    } else {
                        const color = QRuntime.$colorToUint16($background);
                        ctx.fillStyle = '#' + (color & 0xf).toString(16) + ((color >> 4) & 0xf).toString(16) + ((color >> 8) & 0xf).toString(16);
                    }
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.lineTo(emulatorScreen.width, 0);
                    ctx.lineTo(emulatorScreen.width, emulatorScreen.height);
                    ctx.lineTo(0, emulatorScreen.height);
                    ctx.lineTo(0, 0);
                }            

                ctx.translate(($postFX.pos.x / SCREEN_WIDTH  + 0.5) * emulatorScreen.width,
                              ($postFX.pos.y / SCREEN_HEIGHT + 0.5) * emulatorScreen.height); 
                ctx.rotate(-$postFX.angle);
                ctx.scale($postFX.scale.x, $postFX.scale.y);
                ctx.translate(-emulatorScreen.width * 0.5, -emulatorScreen.height * 0.5);

                if (backgroundRevealed) {
                    // Cut out
                    ctx.moveTo(0, 0);
                    ctx.lineTo(0, emulatorScreen.height);
                    ctx.lineTo(emulatorScreen.width, emulatorScreen.height);
                    ctx.lineTo(emulatorScreen.width, 0);
                    ctx.lineTo(0, 0);
                    
                    ctx.fill();
                }
            }
            
            if ($postFX.motion_blur > 0) {
                ctx.globalAlpha = 1 - $postFX.motion_blur;
            }
                
            ctx.drawImage(updateImage,
                        0, 0, SCREEN_WIDTH, SCREEN_HEIGHT,
                        0, 0, emulatorScreen.width, emulatorScreen.height);
            ctx.restore();
        }

        applyAfterglow($postFX.afterglow);
        maybeApplyBloom($postFX.bloom, allow_bloom);
    }

    /*
    // Random graphics for debugging
    ctx.fillStyle = '#FF0';
    for (let i = 0; i < 2; ++i) {
        ctx.fillRect(Math.floor(Math.random() * 364), Math.floor(Math.random() * 204), 20, 20);
        ctx.fillStyle = '#04F';
    }
    */
    
    // Send the frame if this machine is an online host
    
    if (isHosting && hostVideoStream) {
        const track = hostVideoStream.getVideoTracks()[0];
        if (track.requestFrame) {
            track.requestFrame();
        }
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

/* Used by guesting as well as local rendering */
function applyAfterglow(burn) {
    const intensity = Math.max(burn.r, burn.g, burn.b);
    if (intensity > 0) {
        afterglowScreen.style.visibility = 'visible';
        afterglowScreen.style.opacity = '' + (Math.pow(intensity, 0.8) * 0.7);
        
        // Falloff
        afterglowCTX.globalAlpha = 1;
        afterglowCTX.globalCompositeOperation = 'multiply';
        const scale = 250 / Math.pow(intensity, 0.99);
        afterglowCTX.fillStyle = `rgb(${burn.r * scale}, ${burn.g * scale}, ${burn.b * scale})`;
        afterglowCTX.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

        // Additive blend
        afterglowCTX.globalCompositeOperation = 'lighten';
        afterglowCTX.globalAlpha = 1;
        afterglowCTX.drawImage(emulatorScreen, 0, 0);

        afterglowCTX.globalCompositeOperation = 'source-over';
        afterglowCTX.fillStyle = '#000';
    } else {
        if (applyAfterglow.prev > 0) {
            // When burn is first turned off, wipe the context so that it
            // does not remain present when turned on again
            afterglowCTX.clearRect(0, 0, emulatorScreen.width, emulatorScreen.height);
        }
        afterglowScreen.style.visibility = 'hidden';
    }
    applyAfterglow.prev = intensity;
}

// Static local variable
applyAfterglow.prev = 0;


/* Used by guesting as well as local rendering */
function maybeApplyBloom(bloom, enable) {
    if (bloom > 0 && enable) {
        overlayScreen.style.visibility = 'visible';
        // Apple devices are gamma corrected and the bloom looks dimmer as a
        // result, so we boost it
        const b = Math.pow(bloom, 1.5) * (isApple ? 1.5 : 1.0);
        const filter = `brightness(${0.45 + b * (1 - 0.45)}) contrast(3) blur(2.5px)` + (bloom > 0.5 ? ` brightness(${0.75 * bloom + 0.5})`: '');
        if (overlayScreen.style.filter !== filter) { overlayScreen.style.filter = filter; }
        overlayCTX.drawImage(emulatorScreen, 0, 0);
    } else {
        overlayScreen.style.visibility = 'hidden';
    }
}


// Called by show() to trigger sampling input
function requestInput() {
    updateKeyboardPending = true;
}


function updateInput() {
    mouse.screen_x_prev = mouse.screen_x;
    mouse.screen_y_prev = mouse.screen_y;

    // Update touch frame count (after the first frame)
    if (QRuntime.touch.a && ! QRuntime.touch.pressed_a) {
        ++QRuntime.touch.a;
    }
    
    const axes = 'xy', AXES = 'XY', buttons = 'abcdefpq';

    // HTML gamepad indices of corresponding elements of the buttons array
    // A, B, C, D, E, F, _P, Q
    const buttonIndex = [0, 1, 2, 3, 4, 5, 9, 8];
    
    // Aliases on console game controller
    const altButtonIndex = [undefined, undefined, undefined, undefined, 6, 7, undefined, undefined];

    // Also processes input
    const gamepadArray = getIdealGamepads();

    const keyMap = keyMapTable[keyboardMappingMode];
    
    // Sample the keys
    let anyInteraction = false;
    for (let player = 0; player < 4; ++player) {
        const reordered_player = gamepadOrderMap[player];
        const map = keyMap[player], pad = QRuntime.gamepad_array[player],
              realGamepad = gamepadArray[reordered_player], prevRealGamepad = prevRealGamepadState[reordered_player];

        // Network player
        if (pad.$status === 'guest') {
            const latest = pad.$guest_latest_state;
            if (! latest) { return; }

            // Digital axes
            for (let i = 0; i < axes.length; ++i) {
                const axis = axes[i];
                const oldv = pad['$' + axis];
                const newv  = latest['$' + axis];
                
                pad['$d' + axis] = newv - oldv;
                pad['$' + axis + axis] = (newv !== oldv) ? newv : 0;
                pad['$' + axis] = newv;
            }

            // Analog axes
            for (let a = 0; a < pad.$analog.length; ++a) {
                pad.$analog[a] = latest.$analog[a];
            }

            // Buttons
            for (let b = 0; b < buttons.length; ++b) {
                const button = buttons[b];
                const prefix = button === 'p' ? '$' : '';
                const BUT = prefix + button;
                
                const oldv = pad[prefix + button];
                const newv = latest[prefix + button];

                pad[prefix + 'pressed_' + button] = (newv >= 0.5) && (oldv < 0.5) ? 1 : 0;
                pad[prefix + 'released_' + button] = (newv < 0.5) && (oldv >= 0.5) ? oldv : 0;
                pad[prefix + button] = newv ? oldv + 1 : 0;
            }

            pad.$id = latest.$id;
            if (latest.type !== pad.type) {
                pad.type = latest.type;
                pad.prompt = Object.freeze(Object.assign({'##' : '' + (player + 1)}, controlSchemeTable[pad.type]));
            }
            
            continue;
        }
        
        // Have player 0 physical alt controls set player 1 virtual buttons only
        // if there is no second controller physically present
	    const altRealGamepad = ((player === 1) && ! realGamepad) ? gamepadArray[gamepadOrderMap[0]] : undefined,
	      altPrevRealGamepad = ((player === 1) && ! realGamepad) ? prevRealGamepadState[gamepadOrderMap[0]] : undefined;

        if (realGamepad && (realGamepad.id !== pad.$id)) {
            // The gamepad just connected or changed. Update the control scheme.
            pad.$id = realGamepad.id;
            pad.type = detectControllerType(realGamepad.id);
            pad.prompt = Object.freeze(Object.assign({'##' : '' + (player + 1)}, controlSchemeTable[pad.type]));
            pad.$rumble = function (frames, strength) {
                // Find this gamepad
                for (let gamepad of getGamepads()) {
                    if (gamepad.id === pad.$id) {
                        const milliseconds = Math.ceil(frames * 1000 / 60);
                        if (gamepad.vibrationActuator) {
                            const args = {
                                startDelay: 0,
                                duration: milliseconds,
                                weakMagnitude: strength,
                                strongMagnitude: strength};
                            gamepad.vibrationActuator.playEffect('dual-rumble', args);
                        } else if (gamepad.hapticActuators) {
                            gamepad.hapticActuators[0].pulse(strength, milliseconds);
                        }
                        return;
                    } // if
                } // for
            };
        } else if (! realGamepad && (pad.$id !== '') && (pad.$id !== 'mobile')) {
            // Gamepad was just disconnected. Update the control scheme.
            pad.$id = isMobile ? 'mobile' : '';
            pad.type = defaultControlType(player);
            pad.prompt = Object.freeze(Object.assign({'##' : '' + (player + 1)}, controlSchemeTable[pad.type]));
            pad.$rumble = function (frames) {};
        }

        // Analog sticks and triggers for device_control() access
        for (let a = 0; a < 6; ++a) {
            pad.$analog[a] = realGamepad ? realGamepad.analogAxes[a] : 0;
        }
        
        // Axes
        for (let a = 0; a < axes.length; ++a) {
            const axis = axes[a];
            const pos = '+' + axis, neg = '-' + axis;
            const old = pad['$' + axis];

            if (map) {
                // Keyboard controls
                const n0 = map[neg][0], n1 = map[neg][1], p0 = map[pos][0], p1 = map[pos][1];

                // Current state
                pad['$' + axis] = (((emulatorKeyState[n0] || emulatorKeyState[n1]) ? -1 : 0) +
                                   ((emulatorKeyState[p0] || emulatorKeyState[p1]) ? +1 : 0));

                // Just pressed
                pad['$' + axis + axis] = (((emulatorKeyJustPressed[n0] || emulatorKeyJustPressed[n1]) ? -1 : 0) +
                                          ((emulatorKeyJustPressed[p0] || emulatorKeyJustPressed[p1]) ? +1 : 0));
            } else {
                // Nothing currently pressed
                pad['$' + axis] = pad['$' + axis + axis] = 0;
            }

            if (realGamepad) {
                pad['$' + axis] = pad['$' + axis] || realGamepad.axes[a];
            }

            if (realGamepad && (prevRealGamepad.axes[a] !== realGamepad.axes[a])) {
                pad['$' + axis + axis] = pad['$' + axis + axis] || realGamepad.axes[a];
            }

            if (gameSource.json.dual_dpad && (player === 1) && gamepadArray[gamepadOrderMap[0]]) {
                const otherPad = gamepadArray[gamepadOrderMap[0]];
                // Alias controller[0] right stick (axes 2 + 3)
                // to controller[1] d-pad (axes 0 + 1) for "dual stick" controls                
                if (otherPad.axes[a + 2] !== 0) {
                    pad['$' + axis] = pad['$' + axis] || otherPad.axes[a + 2];
                }
                if (otherPad.axes[a + 2] !== otherPad.axes[a + 2]) {
                    pad['$' + axis + axis] = pad['$' + axis + axis] || otherPad.axes[a + 2];
                }
            } // dual-stick

            // Derivative
            pad['$d' + axis] = pad['$' + axis] - old;
            const axisChange = (pad['$d' + axis] !== 0);
            anyInteraction = anyInteraction || axisChange;
            if (axisChange && pad.$status === 'absent') {
                pad.$status = 'present';
            }

        } // axes
        
        for (let b = 0; b < buttons.length; ++b) {
            const button = buttons[b];
            const prefix = (button === 'p') ? '$' : '';
            
            const oldv = pad[prefix + button];
            
            if (map) {
                // Keyboard (only P1's P button has three codes)
                const b0 = map[button][0], b1 = map[button][1], b2 = map[button][2];
                pad[prefix + button] = (emulatorKeyState[b0] || emulatorKeyState[b1] || emulatorKeyState[b2]) ? oldv + 1 : 0;
                pad[prefix + 'pressed_' + button] = (emulatorKeyJustPressed[b0] || emulatorKeyJustPressed[b1] || emulatorKeyJustPressed[b2]) ? 1 : 0;
                pad[prefix + 'released_' + button] = (emulatorKeyJustReleased[b0] || emulatorKeyJustReleased[b1] || emulatorKeyJustReleased[b2]) ? oldv : 0;
            } else {
                pad[prefix + button] = pad[prefix + 'released_' + button] = pad[prefix + 'pressed_' + button] = 0;
            }

            const i = buttonIndex[b], j = altButtonIndex[b];
            const isPressed  = realGamepad && (realGamepad.buttons[i] || realGamepad.buttons[j]);
	    
            const wasPressed = prevRealGamepad && (prevRealGamepad.buttons[i] || prevRealGamepad.buttons[j]);
	    
            if (isPressed) { pad[prefix + button] = oldv + 1; }
	    
            if (isPressed && ! wasPressed) {
                pad[prefix + 'pressed_' + button] = 1;
            }

            if (! isPressed && wasPressed) {
                pad[prefix + 'released_' + button] = oldv;
            }

            const buttonChange = (pad[prefix + button] !== 0);
            anyInteraction = anyInteraction || buttonChange;
            if (buttonChange && pad.$status === 'absent') {
                pad.$status = 'present';
            }
        }
    }

    // Update angles for all players (local and remote)
    for (let player = 0; player < 4; ++player) {
        const pad = QRuntime.gamepad_array[player];
        const oldAngle = pad.$angle;
        if ((pad.$y !== 0) || (pad.$x !== 0)) {
            pad.$angle = Math.atan2(-pad.$y, pad.$x);
        }

        if ((pad.$y === pad.$dy && pad.$x === pad.$dx) || (pad.$y === 0 && pad.$x === 0)) {
            pad.$dangle = 0;
        } else {
            // JavaScript operator % is a floating-point operation
            pad.$dangle = ((3 * Math.PI + pad.$angle - oldAngle) % (2 * Math.PI)) - Math.PI;
        }
    }
    
    // Update previous state. This has to be done AFTER the above loop
    // so that any alternative state for player 2 are not immediately
    // overriden during player 1's processing. These do not need to be
    // remapped because they are a straight copy.
    for (let i = 0; i < 4; ++i) {
        if (gamepadArray[i]) {
            prevRealGamepadState[i] = gamepadArray[i];
        }
    }

    // Update x_frames and y_frames counters
    for (let i = 0; i < 4; ++i) {
        const pad = QRuntime.gamepad_array[i];
        for (const axis of 'xy') {
            if (pad['$d' + axis]) {
                pad['$' + axis + '_frames'] = 0
            } else {
                ++pad['$' + axis + '_frames'];
            }
        }
    }

    if (anyInteraction) { updateLastInteractionTime(); }

    // Reset the just-pressed state
    emulatorKeyJustPressed = {};
    emulatorKeyJustReleased = {};
}


/* For runtime API */
function make_http(url, options = {method: "GET"}, data = undefined) {
    const http = {$type: 'http', $data: data, $response: undefined};

    if (getQueryString('kiosk') === '1' || quitAction === 'launcher') {
        // Fail immediately as a security error
        http.$response = {ok: false, status: 418};
    } else {
        fetch(url, options).then(function (response) {
            let count = 0;
            const quadplay_response = {
                status: response.status,
                status_text: response.status_text,
                redirected: response.redirected,
                ok: response.ok,
                type: response.type,
                url: response.url,
                json: undefined,
                text: undefined,
                bytes: undefined,

            };
            
            const types = ['json', 'text', 'bytes'];
            for (const prop of types) {
                response.clone()[prop]().then(function (value) {
                    quadplay_response[prop] = value;
                    ++count;
                    if (count === types.length) { 
                        http.$response = quadplay_response; 
                    }
                });
            }
            
        });
    }

    return http;
}


/* For runtime API */
function http_poll(http, success_handler = undefined, failure_handler = undefined) {
    if (! http.$response) { return http; }

    if (http.$response.ok) {
        success_handler && success_handler(http.$response, http, http.$data);
    } else {
        failure_handler && failure_handler(http.$response, http, http.$data);
    }
    return undefined;
}

