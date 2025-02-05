/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */
"use strict";

// Set to false when working on quadplay itself.
const deployed = true;

// If true, use a WebWorker thread for the virtual GPU. This variable
// appears in the CPU runtime as well.
const $THREADED_GPU = true;

/* The containing web page that quadplay is embedded within, or
   quadplay's iframe if running cross-origin */
const page = (function () {
    try {
        // These will fail with a cross-origin exception when quadplay is embedded
        // in a page that is loaded from a different server, for example, when
        // deployed to itch.io where the game is loaded from a CDN.
        window.top.document.title;
        window.top.document.body.innerHTML;
        
        // Same origin
        return window.top;
    } catch (err) {
        
        // Cross origin
        return window;
    }
})();

// Set to true to allow editing of quad://example/ files when developing quadplay
const ALLOW_EDITING_EXAMPLES = ! deployed;

// Set to true to automatically reload on switching
// to the browser when the game is stopped.
const AUTO_RELOAD_ON_FOCUS = deployed;

const launcherURL = 'quad://console/launcher';

// Token that must be passed to the server to make POST calls
// for security purposes
const postToken = getQueryString('token');
      
// This will be filled in by a special call on a quadplay server at
// the bottom of this script with a list of available applications on
// this machine.
let serverConfig = {};

// Chrome and Safari both have a bug that drops nearest neighbor
// interpolation when transform: scale() is used, but preserve it
// for the nonstandard zoom(). Firefox and Edge (even though it uses
// Chromium!) do not have this bug. Safari fixed this bug after 16.3
// but it may still be present in older versions.
const hasBrowserScaleBug = isSafari;

// Can the game sleep when idle to save power?
let autoSleepEnabled =
    ((getQueryString('kiosk') === '1') ||
     (localStorage.getItem('autoSleepEnabled') !== 'false')) &&
    (getQueryString('nosleep') !== '1');


const noop = ()=>{};

let keyboardMappingMode = 'Normal';

// Disabled by the profiler if not making frame rate, reset
// on game start.
let allow_bloom = true;

// Output the version to help with debugging
{
    function clerp(a, b, t) { return a + (b - a) * t; }
    
    // Safari doesn't have a monospace font for console output, so only
    // show the ASCII-art banner on other platforms
    const banner = isSafari ? [''] : `
                                  ╷       ╷                                   
            ╭───╮ ╷   ╷  ───╮ ╭── │ ╭───╮ │   ───╮ ╷   ╷   ▒▒                 
            │   │ │   │ ╭── │ │   │ │   │ │  ╭── │ │   │ ▒▒  ▒▒               
            ╰── │ ╰───┘ ╰───╯ ╰───╯ │ ──╯ ╰─ ╰───╯ ╰── │   ▒▒                 
                ╵                   ╵                ──╯                      `.split('\n');
    const style = [];
    for (let i = 0; i < banner.length; ++i) {
        banner[i] = '%c' + banner[i];
        const a = Math.min(1, Math.max(0, (i - 1) / (banner.length - 2)));
        style.push(`color: rgb(${clerp(255, 0, a)}, ${clerp(64, 169, a)}, ${clerp(158, 227, a)}); text-shadow: 0px 2px 3px rgba(0, 0, 0, 20%)`);
    }
    console.log('\n\n\n' + banner.join('\n') + '\n\nquadplay✜ version ' + version + '\n©2019-2025 Morgan McGuire\nLicensed as GPL 3.0\nhttps://www.gnu.org/licenses/gpl-3.0.en.html\n' +
                '\nSecure Context: ' + window.isSecureContext +
                '\nQuadplay Server: ' + isQuadserver +
                '\nBrowser: ' + browserName +
                '\nNative App: ' + nativeapp +
                '\nIDE: ' + useIDE,
                ...style);
}


function enterKioskMode() {
    inPageReload = true;
    location = location.origin + location.pathname + '?kiosk=1';
}


function setIDEEnable(value) {
    inPageReload = true;
    location = location.href.replace(/([&?])IDE=./g, '$1') + '&IDE=' + (value ? 1 : 0);
}


/* Returns the path to the game's root, relative to location.origin. Ends in a slash. */
function getGamePath() {
    let gamePath = gameSource.jsonURL.replace(/\\/g, '/').replace(/\/[^/]+\.game\.json$/g, '/');
    if (gamePath.startsWith(location.origin)) {
        gamePath = gamePath.substring(location.origin.length);
    } 
   
    // On Windows this must still return a leading slash in front of absolute paths
    // because that is the "webpath" format that the server expects.
    console.assert(gamePath[1] !== ':', 'Absolute windows webpath without a leading slash')
   
    return gamePath;
}


function makeURLRelativeToGame(filename) {
    return getGamePath() + filename;
}

//////////////////////////////////////////////////////////////////////////////////
// UI setup

{
    const c = document.getElementsByClassName(isMobile ? 'noMobile' : 'mobileOnly');
    for (let i = 0; i < c.length; ++i) {
        c[i].style.display = 'none';
    }
}

const fastReload = getQueryString('fastReload') === '1';
const isOffline = (getQueryString('offline') === '1') || false;
{
    const c = document.getElementsByClassName(useIDE ? 'noIDE' : 'IDEOnly');
    for (let i = 0; i < c.length; ++i) {
        c[i].style.display = 'none';
    }
}

// Set on game load
let editableProject = false;

// Hide quadplay framerate debugging info
if (! profiler.debuggingProfiler) { document.getElementById('debugIntervalTimeRow').style.display = 'none'; }

// If not multithreaded, hide the virtual GPU info
if (! $THREADED_GPU) { document.getElementById('debugGPUTimeRow').style.display = 'none'; }
////////////////////////////////////////////////////////////////////////////////

// 'WideIDE', 'IDE', 'Test', 'Emulator', 'Editor', 'Windowed',
// 'Maximal', 'Ghost'. See also setUIMode().
let uiMode = 'IDE';
const BOOT_ANIMATION = Object.freeze({
    NONE:      0,
    SHORT:    32 + 13 + 8, // = 32 frames animation + 13 frames fade in + 8 frames hold black
    REGULAR: 220 + 13 + 47
});

/* Date.now() for the last time user input was seen. This is used to
   automatically pause quadplay when inactive to reduce
   processor load on systems that do not suspend themselves such as
   Raspberry Pi. */
let lastInteractionTime = Date.now();

/* 2 min delay before sleeping in non-IDE mode */
const IDLE_PAUSE_TIME_MILLISECONDS = 1000 * 60 * 2;

/* We have to poll relatively quickly while sleeping because there
   is no way to detect a button that was quickly pressed and released
   within the interval. I could not press and release faster than 1/20s,
   so this is my compromise between shutting down as much as possible and
   being responsive.  */
const SLEEP_POLL_INTERVAL_MILLISECONDS = 1000 / 20;
function updateLastInteractionTime() { lastInteractionTime = Date.now(); }

/* These can change due to launching different games, the in-game
   set_screen_size() function, or temporarily due to streaming. */ 
let SCREEN_WIDTH = 384, SCREEN_HEIGHT = 224, PRIVATE_VIEW = false;

let gameSource;

// The image being written during preview recording
let previewRecording = null;
let previewRecordingFrame = 0;

function clamp(x, lo, hi) { return Math.min(Math.max(x, lo), hi); }
function makeEuroSmoothValue(minCutoff, speedCoefficient) {  return new EuroFilter(minCutoff, speedCoefficient); }

/* True if a URL is to a path that is a built-in dir for the current server */
function isBuiltIn(url) {
    if (ALLOW_EDITING_EXAMPLES) { return false; }
    
    if (url.startsWith('quad://examples/') ||
        url.startsWith('quad://games/') ||
        url.startsWith('quad://sprites/') ||
        url.startsWith('quad://fonts/') ||
        url.startsWith('quad://scripts/') ||
        url.startsWith('quad://console/') ||
        url.startsWith('quad://doc/')) {
        return true;
    }
    
    if (! url.startsWith('http://') || url.startsWith('https://')) {
        url = location.origin + url;
    }
    
    const quadPath = location.href.replace(/\/console\/quadplay\.html.*$/, '/');

    return url.startsWith(quadPath) && // Early out
        ((! ALLOW_EDITING_EXAMPLES && url.startsWith(quadPath + 'examples/')) ||
         url.startsWith(quadPath + 'sprites/') ||
         url.startsWith(quadPath + 'fonts/') ||
         url.startsWith(quadPath + 'sounds/') ||
         url.startsWith(quadPath + 'scripts/') ||
         url.startsWith(quadPath + 'games/') ||
         url.startsWith(quadPath + 'console/') ||
         url.startsWith(quadPath + 'doc/'));
}


function debugOptionClick(event) {
    const element = event.target;
    event.stopPropagation();
    if (element.id === 'wordWrapEnabled') {
        const outputDisplayPane = document.getElementById('outputDisplayPane');
        outputDisplayPane.style.whiteSpace = element.checked ? 'pre-wrap' : 'pre';
    } else if (element.id !== 'automathEnabled' && element.id !== 'restartOnFocusEnabled') {
        QRuntime['$' + element.id] = element.checked;
    }
    saveIDEState();
}


let codeEditorFontSize = 14;
function setCodeEditorFontSize(f) {
    codeEditorFontSize = Math.max(6, Math.min(32, f));
    localStorage.setItem('codeEditorFontSize', '' + codeEditorFontSize)

    if (useIDE) {
        aceEditor.setOption('fontSize', codeEditorFontSize + 'px');
    }
}


// Controls the mapping order used by quadplay-host for gamepads. Can be
// changed from the IDE or the in-game system menu.
//
// gamepad_array[i] = real_pad[gamepadOrderMap[i]].  Set to
// DISABLED_GAMEPAD for 'skip'. Each element must be a single-digit
// number for the serialization code to work correctly.
const DISABLED_GAMEPAD = 9;
let gamepadOrderMap = [0, 1, 2, 3];
function setGamepadOrderMap(map) {
    const pane = document.getElementById('gamepadIndexPane');

    if (map[0] === DISABLED_GAMEPAD &&
        map[1] === DISABLED_GAMEPAD &&
        map[2] === DISABLED_GAMEPAD &&
        map[3] === DISABLED_GAMEPAD) {
        // Unmapping all gamepads is pointless and will
        // leave no way back without a keyboard, so if
        // all are unmapped, force the default mapping.
        map = [0, 1, 2, 3];
    }

    let s = '';
    if (map[0] === 0 && map[1] === 1 && map[2] === 2 && map[3] === 3) {
        // Default configuration
        s = 'Your gamepads are in default order.';
    } else {
        s = 'Your gamepads are in custom order:<br>';
        for (let i = 0; i < 4; ++i) {
            const m = map[i];
            s += `P${i + 1}&nbsp;=&nbsp;${(m === DISABLED_GAMEPAD) ? '∅' : 'controller' + (m + 1)}${i < 3 ? ', ' : '.<br/>'}`;
        }
    }
    pane.innerHTML = s + ' <a title="Change gamepad order" onclick="showReorderGamepadsDialog(); return false" href="#">Click to change</a>';
    gamepadOrderMap = map.slice();
    localStorage.setItem('gamepadOrderMap', gamepadOrderMap.join(''));
}


let colorScheme = 'dots';
function setColorScheme(scheme) {
    colorScheme = scheme;
    document.getElementById(scheme + 'ColorScheme').checked = 1;
    // Find the nano style sheet
    let stylesheet;
    for (let s of document.styleSheets) {
        if (s.href && s.href.indexOf('quadplay.css') !== -1) {
            stylesheet = s;
            break;
        }
    }
    if (! stylesheet) { return; }

    // Default to dots scheme
    let hrefColor = '#e61b9d';
    let emulatorColor = "url('wrap-dots.png') 50% 50% / cover";

    switch (scheme) {
    case 'pink':
        hrefColor = '#e61b9d';
        emulatorColor = '#ff4488';
        break;

    case 'black':
        hrefColor = '#0af';
        emulatorColor = '#090909';
        break;
        
    case 'white':
        hrefColor = '#0af';
        emulatorColor = '#D2C4D2';
        break;

    case 'orange':
        hrefColor = '#ff7030';
        emulatorColor = '#f04C12';
        break;
        
    case 'gold':
        hrefColor = '#dca112';
        emulatorColor = '#b68216';
        break;
        
    case 'green':
        hrefColor = '#47b52e';
        emulatorColor = '#139613';
        break;
        
    case 'blue':
        hrefColor = '#0af';
        emulatorColor = '#1074b6';
        break;

    case 'dots':
        hrefColor = '#e61b9d';
        emulatorColor = "url('wraps/dots.png') 50% 50% / cover";
        break;
        
    case 'stripes':
        hrefColor = '#da0200';
        emulatorColor = "url('wraps/stripes.png') 50% 50% / cover";
        break;

    case 'wood':
        hrefColor = '#cb7f49';
        emulatorColor = "url('wraps/oak.jpg') 50% 50% / cover";
        break;

    case 'walnut_burl':
        hrefColor = '#cb7f49';
        emulatorColor = "url('wraps/walnut_burl.jpg') 50% 50% / cover";
        break;

    case 'carbon':
        hrefColor = '#0af';
        emulatorColor = "url('wraps/carbon.png') 50% 50% / cover";
        break;
    }
    
    // Find the relevant rules and remove them
    for (let i = 0; i < stylesheet.cssRules.length; ++i) {
        const rule = stylesheet.cssRules[i];
        if ((rule.selectorText === 'a, #header a, .menu a') ||
            (rule.selectorText === '.emulator .emulatorBackground' && rule.style.background !== '')) {
            stylesheet.deleteRule(i);
            --i;
        }
    }
    // Replacement rules
    stylesheet.insertRule(`a, #header a, .menu a { color: ${hrefColor} !important; text-decoration: none; }`, 0);
    stylesheet.insertRule(`.emulator .emulatorBackground { background: ${emulatorColor}; ! important}`, 0);
    localStorage.setItem('colorScheme', colorScheme);
}

/* Used for the welcome element's event handlers to efficiently know
   whether to trigger onWelcomeTouch() */
let onWelcomeScreen = ! useIDE;

/* 
   Force users in auto-play modes to interact in order to enable the
   audio engine and full-screen on mobile (where it is harder to hit
   the small full-screen button).
 */
function onWelcomeTouch(hasTouchScreen) {
    hasTouchScreen = hasTouchScreen || isMobile;
   
    onWelcomeScreen = false;
    const welcome = document.getElementById('welcome');
    welcome.style.zIndex = -100;
    welcome.style.visibility = 'hidden';
    welcome.style.display = 'none';

    unlockAudio();
    
    if ((uiMode === 'Maximal' || uiMode === 'Windowed') && ! useIDE && hasTouchScreen) {
        // This device probably requires on-screen controls.
        // Setting the UI mode forces fullscreen as well.
        setUIMode('Emulator');
    } else if ((! useIDE && uiMode !== 'Windowed') || hasTouchScreen) {
        if (deployed && (isMobile || getQueryString('mode') !== 'DefaultWindow')) { requestFullScreen(); }
    }

    let url = getQueryString('game');
    let other_host_code = getQueryString('host');
    
    const showPause = (url || other_host_code) && ! useIDE;
    
    url = url || launcherURL;
    // If the url doesn't have a prefix and doesn't begin with a slash,
    // assume that it is relative to the quadplay script in the parent dir.
    if (! (/^(.{3,}:\/\/|[\\/])/).test(url)) {
        url = '../' + url;
    }

    // For loading into a game directly
    const callback = (other_host_code ?
                      function () {
                          const otherNetID = wordsToNetID(other_host_code.split(/[_,]/));
                          startGuesting(otherNetID);
                      } : undefined);      
    
    if (showPause) {
        // Show the pause message before loading when running a
        // standalone game (not in IDE, not loading the launcher)
        const pauseMessage = document.getElementById('pauseMessage');
        pauseMessage.style.zIndex = 120;
        pauseMessage.style.visibility = 'visible';
        pauseMessage.style.opacity = 1;
        setTimeout(function () {
            pauseMessage.style.opacity = 0;
            setTimeout(function() {
                pauseMessage.style.visibility = 'hidden';
                pauseMessage.style.zIndex = 0;
                onPlayButton(undefined, undefined, undefined, callback);
            }, 200);
        }, 3000);
    } else {
        onPlayButton(undefined, undefined, undefined, callback);
    }

    /* Make sure the keyboard focus sticks */
    emulatorKeyboardInput.focus({preventScroll:true});
    setTimeout(function () {
        emulatorKeyboardInput.focus({preventScroll:true});
    });
}


function unlockAudio() {
    // Play a silent sound in order to unlock audio on platforms
    // that require audio to first initiate on a click.
    //
    // https://paulbakaus.com/tutorials/html5/web-audio-on-ios/
    
    // create empty buffer
    var buffer = audioContext.createBuffer(1, 1, 22050);
    var source = audioContext.createBufferSource();
    source.buffer = buffer;
    
    // connect to output (your speakers)
    source.connect(audioContext.destination);
    
    // play the file
    if (source.noteOn) {
        source.noteOn(0);
    } else {
        source.start(0);
    }
}

//document.addEventListener('fullscreenchange', function (event) {
//});

function requestFullScreen() {
    // Full-screen the UI. This can fail if not triggered by a user interaction.
    try { 
        const body = document.getElementsByTagName('body')[0];
        if (body.requestFullscreen) {
            body.requestFullscreen().catch(function(){});
        } else if (body.webkitRequestFullscreen) {
            body.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
        } else if (body.mozRequestFullScreen) {
            body.mozRequestFullScreen();
        } else if (body.msRequestFullscreen) {
            body.msRequestFullscreen();
        }
    } catch (e) {}

    try {
        // Capture the escape key (https://web.dev/keyboard-lock/)
        window.top.navigator.keyboard.lock();
    } catch (e) {}
}

let backgroundPauseEnabled = true;

function onBackgroundPauseClick(event) {
    event.stopPropagation();
    backgroundPauseEnabled = document.getElementById('backgroundPauseCheckbox').checked;
    saveIDEState();
}

function onAutoSleepClick(event) {
    event.stopPropagation();
    autoSleepEnabled = document.getElementById('autoSleepCheckbox').checked;
    localStorage.setItem('autoSleepEnabled', autoSleepEnabled);
}

function setKeyboardMappingMode(type) {
    keyboardMappingMode = type;
    document.getElementById(type + 'KeyboardRadio').checked = '1';
    localStorage.setItem('keyboardMappingMode', type);
}


function setUIMode(d, noFullscreen) {
    if (! useIDE && (d === 'IDE' || d === 'WideIDE' || d === 'Ghost' || d === 'Editor' || d === 'Test')) {
        // When in dedicated play, no-IDE mode and the UI was
        // previously set to UI, fall back to the emulator.
        d = 'Emulator';
    }

    uiMode = d;
    const body = document.getElementsByTagName('body')[0];

    // Set the CSS class
    body.classList.remove('MaximalUI');
    body.classList.remove('EmulatorUI');
    body.classList.remove('IDEUI');
    body.classList.remove('WideIDEUI');
    body.classList.remove('EditorUI');
    body.classList.remove('GhostUI');
    body.classList.remove('TestUI');
    body.classList.add((uiMode === 'Windowed' ? 'Maximal' : uiMode) + 'UI');

    // Check the appropriate radio button
    document.getElementById({'IDE'      : 'IDEUIButton',
                             'WideIDE'  : 'wideIDEUIButton',
                             'Emulator' : 'emulatorUIButton',
                             'Test'     : 'testUIButton',
                             'Maximal'  : 'maximalUIButton',
                             'Windowed' : 'windowedUIButton',
                             'Editor'   : 'editorUIButton',
                             'Ghost'    : 'ghostUIButton'}[uiMode] || 'maximalUIButton').checked = 1;

    if (((uiMode === 'Maximal') || ((uiMode === 'Emulator') && ! useIDE)) && ! noFullscreen && ! document.fullscreenElement) {
        requestFullScreen();
    }

    if (uiMode === 'Windowed' && document.fullscreenElement) {
        // Undo fullscreen
        try {
            document.exitFullscreen();
        } catch {
        }
    }

    // Need to wait for layout to update before the onResize handler
    // has correct layout sizes.
    setTimeout(onResize, 100);

    // Reset keyboard focus
    emulatorKeyboardInput.focus({preventScroll:true});

    // Ace doesn't notice CSS changes. This explicit resize is needed
    // to ensure that the editor can fully scroll horizontally
    // in 'wide' mode
    if (useIDE) { setTimeout(function() { aceEditor.resize(); }); }

    // Force a debugger update so that the stats are correct
    // when switching back to it
    updateDebugger();
}


function onResize() {
    const body         = document.getElementsByTagName('body')[0];
    const background   = document.getElementsByClassName('emulatorBackground')[0];
    const screenBorder = document.getElementById('screenBorder');
    const showPrivateViewsEnabled = document.getElementById('showPrivateViewsEnabled').checked;

    body.classList.remove('landscape-primary');
    body.classList.remove('landscape-secondary');
    body.classList.remove('portrait-primary');
    body.classList.remove('portrait-secondary');
    if (screen.orientation && screen.orientation.type) {
        body.classList.add(screen.orientation.type);
    }
    
    const gbMode = window.matchMedia('(orientation: portrait)').matches;

    let windowWidth = window.innerWidth, windowHeight = window.innerHeight;

    let scale = 1;

    const editorFrame = document.getElementById('editorFrame');
    if (uiMode !== 'Test') {
        // Undo the setting from Test mode
        editorFrame.style.top = '0px';
    }
    
    switch (uiMode) {
    case 'Editor':
        document.getElementById('debugger').removeAttribute('style');
        background.removeAttribute('style');
        break;
        
    case 'WideIDE':
        scale = window.screen.width <= 1600 ? 1.5 : 2.0;
        // Fall through to IDE case
        
    case 'IDE':
        // Revert to defaults. This has to be done during resize
        // instead of setUIMode() to have any effect.
        screenBorder.removeAttribute('style');
        document.getElementById('debugger').removeAttribute('style');
        if (SCREEN_WIDTH <= (384>>1) && SCREEN_HEIGHT <= (224 >> 1)) {
            // Half-resolution games run with pixel doubling
            scale *= 2;
        } else if (SCREEN_WIDTH === 640 && SCREEN_HEIGHT === 360) {
            if (scale === 1.0 || scale === 2.0) {
                scale *= 0.5;
            } else {
                // This fits at a slightly larger size, although it
                // loses any semblance of integer scaling
                scale *= 0.50 * 0.90 / 0.75;
            }
        } else if (SCREEN_WIDTH > 384) {
            // Greater than normal resolution runs at half scale
            scale *= 0.5;
        }

        let zoom = setScreenBorderScale(screenBorder, scale);

        if (hasBrowserScaleBug) {
            if (uiMode === 'WideIDE') {
                screenBorder.style.left = (-5 / zoom) + 'px';
            } else {
                screenBorder.style.left = (8 / zoom) + 'px';
            }
            screenBorder.style.top = (18 / zoom) + 'px';
        } else {
            screenBorder.style.transformOrigin = 'left top';
        }
        background.removeAttribute('style');
        break;
        
    case 'Emulator':
        {
            // If 1, add a thick border of the case around the screen
            // as pre-version 100 quadplay did
            const useScreenBorder = 0;
            
            // What is the largest multiple SCREEN_HEIGHT that is less than windowHeightDevicePixels?
            if (gbMode) {
                scale = Math.max(0, Math.min((window.innerHeight - 70) / SCREEN_HEIGHT, (windowWidth - useScreenBorder * 36) / SCREEN_WIDTH));
            } else {
                scale = Math.max(0, Math.min((window.innerHeight - useScreenBorder * 70) / SCREEN_HEIGHT, (windowWidth - 254) / SCREEN_WIDTH));
            }
            
            if ((scale * window.devicePixelRatio <= 2.5) && (scale * window.devicePixelRatio > 1)) {
                // Round to nearest even multiple of the actual pixel size for small screens to
                // keep per-pixel accuracy
                scale = Math.floor(scale * window.devicePixelRatio) / window.devicePixelRatio;
            }

            // Amount to shift vertically to center the screen
            //const delta = (windowHeight - Math.max(windowHeight + 30, 90 + SCREEN_HEIGHT * scale)) / 2;
            let delta = 0;
            if (! gbMode) {
                // Resize the background to bound the screen more tightly.
                // Only resize vertically because the controls need to
                // stay near the edges of the screen horizontally to make
                // them reachable on mobile. In gbMode, the emulator fills
                // the screen and this is not needed.
                const height = Math.min(windowHeight - 27, Math.round(SCREEN_HEIGHT * scale + 19));
                delta = Math.ceil(height / 2);
                background.style.top = Math.round((windowHeight - height) / 2 - 17) + 'px';
                background.style.height = height + 'px';
            }

            const zoom = setScreenBorderScale(screenBorder, scale);
            
            screenBorder.style.left = Math.round((windowWidth / zoom - screenBorder.offsetWidth - 1 / zoom) / 2) + 'px';
            if (gbMode) {
                screenBorder.style.transformOrigin = 'center top';
                screenBorder.style.top = (15 / zoom) + 'px';
            } else {
                screenBorder.style.transformOrigin = 'center';
                screenBorder.style.top = (Math.round(Math.max(0, -delta / zoom) + (windowHeight / zoom - screenBorder.offsetHeight - 34 / zoom) / 2)) + 'px';
            }

            // Show the controls
            body.classList.add('fullscreenEmulator');
            break;
        }

    case 'Ghost':
    case 'Maximal':
    case 'Windowed':
    case 'Test':
        {
            // Switch to constants view
            
            // What is the largest multiple SCREEN_HEIGHT that is less than windowHeightDevicePixels?
            const isKiosk = getQueryString('kiosk') === '1';
            const headerBar = isKiosk ? 0 : 24;
            scale = Math.max(0, Math.min((windowHeight - headerBar) / SCREEN_HEIGHT, (windowWidth - 2) / SCREEN_WIDTH));
            
            if ((scale * window.devicePixelRatio <= 2.5) && (scale * window.devicePixelRatio > 1)) {
                // Round to nearest even multiple of the actual pixel size for small screens to
                // keep per-pixel accuracy
                scale = Math.floor(scale * window.devicePixelRatio) / window.devicePixelRatio;
            }

            let zoom = setScreenBorderScale(screenBorder, scale);
            
            screenBorder.style.left = Math.round((windowWidth - screenBorder.offsetWidth * zoom - 4) / (2 * zoom)) + 'px';
            if (uiMode === 'Test') {
                // Show the constants
                onProjectSelect(undefined, 'constant', undefined);
                screenBorder.style.top = '0px';
                const S = (PRIVATE_VIEW && ! isGuesting && ! showPrivateViewsEnabled) ? 2 : 1;

                // Put the top of the debugger at the bottom of the emulator
                const top = Math.round(S * scale * screenBorder.offsetHeight) + 'px';
                document.getElementById('debugger').style.top = top;
                editorFrame.style.top = top;
                
                screenBorder.style.transformOrigin = 'center top';
            } else {
                // Fall through from non-Test UIs                
                screenBorder.style.transformOrigin = 'center';
                screenBorder.style.top = Math.round((windowHeight - screenBorder.offsetHeight * zoom - headerBar - 2) / (2 * zoom)) + 'px';
            }
        }
        break;
    }

    const hostCrop = (PRIVATE_VIEW && ! isGuesting && ! showPrivateViewsEnabled) ? 0.5 : 1.0;
    
    screenBorder.style.width = (SCREEN_WIDTH * hostCrop) + 'px';
    screenBorder.style.height = (SCREEN_HEIGHT * hostCrop) + 'px';
    if (uiMode === 'Maximal' || uiMode === 'Windowed') {
        screenBorder.style.borderRadius = '0px';
        screenBorder.style.borderWidth  = '0px';
    } else {
        screenBorder.style.borderRadius = Math.ceil(6 * hostCrop / scale) + 'px';
        screenBorder.style.borderWidth  = Math.ceil(5 * hostCrop / scale) + 'px';
    }
    screenBorder.style.boxShadow = `${1/scale}px ${2/scale}px ${2/scale}px 0px rgba(255,255,255,0.16), ${-1.5/scale}px {-2/scale}px ${2/scale}px 0px rgba(0,0,0,0.19)`;

    if (emulatorMode === 'stop') {
        // Work around a Chromium bug where resizing will fill
        // the canvas with random compositing framebuffer data
        // on Windows and Linux sometimes.
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    }
}


/* Returns the net zoom factor */
function setScreenBorderScale(screenBorder, scale) {
    const showPrivateViewsEnabled = document.getElementById('showPrivateViewsEnabled').checked;

    if (PRIVATE_VIEW && ! isGuesting && ! showPrivateViewsEnabled) {
        scale *= 2;
    }
    
    let zoom = 1;
    if (hasBrowserScaleBug) {
        // On Safari, CSS scaling overrides the crisp image rendering.
        // We have to zoom instead (zoom acts differently on other browsers,
        // so we don't use zoom on all platforms).
        screenBorder.style.zoom = '' + scale;
        zoom = scale;
    } else {
        // Setting the scale transform triggers really slow rendering on Raspberry Pi unless we
        // add the "translate3d" hack to trigger hardware acceleration.
        screenBorder.style.transform = 'scale(' + scale + ') translate3d(0,0,0)';
    }

    return zoom;
}


function onMenuButton(event) {
    closeDropdowns();
    const button = document.getElementById(event.target.id);
    const menu = document.getElementById(event.target.id.replace(/Button$/, ''));

    if (menu.style.visibility === 'visible') {
        menu.style.visibility = 'hidden';
    } else {
        menu.style.visibility = 'visible';
        menu.style.left = button.getBoundingClientRect().left + 'px';
    }

    event.stopPropagation();
}


// Disable context menu popup on touch events for the game screen or virtual
// controller buttons because they should be processed solely by the emulator
emulatorScreen.oncontextmenu = overlayScreen.oncontextmenu = afterglowScreen.oncontextmenu = function (event) { event.preventDefault(); event.stopPropagation(); };
{
    const classes = ['emulator', 'emulatorBackground', 'emulatorButton', 'virtualController', 'screenBorder'];
    for (let c = 0; c < classes.length; ++c) {
        const a = document.getElementsByClassName(classes[c]);
        for (let i = 0; i < a.length; ++i) {
            a[i].oncontextmenu = emulatorScreen.oncontextmenu;
        }
    }
}

// Do not set desynchronized:true. Doing so makes Chrome run about 12% slower as of version 87.
const ctxOptions = {alpha: false, desynchronized: false};
const ctx = emulatorScreen.getContext('2d', ctxOptions);
const afterglowCTX = afterglowScreen.getContext('2d', ctxOptions);
const overlayCTX = overlayScreen.getContext('2d', ctxOptions);

ctx.msImageSmoothingEnabled = ctx.webkitImageSmoothingEnabled = ctx.imageSmoothingEnabled = false;

function download(url, name) {
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
        window.URL.revokeObjectURL(url);  
        document.body.removeChild(a);
    }, 0);
}


/** True if the game is running on the same server as the quadplay console */
function locallyHosted(url) {
    url = url || gameURL;
    return url.startsWith('quad://') || url.startsWith(location.origin) || ! /^([A-Za-z]){3,6}:\/\//.test(url);
}


function hideAllRuntimeDialogs() {
    setRuntimeDialogVisible('hostCodeCopy', false);
    setRuntimeDialogVisible('hostCodePaste', false);
}

    
function onRestartButton() {
    onStopButton();
    onPlayButton();
}


let lastAnimationRequest = 0;
let lastAnimationInterval = undefined;
function onStopButton(inReset, preserveNetwork) {
    hideAllRuntimeDialogs();
    
    if (! preserveNetwork) {
        stopHosting();
        stopGuesting(true);
    }
    
    if (! inReset) {
        document.getElementById('stopButton').checked = 1;
        setControlEnable('pause', false);
        emulatorMode = 'stop';
        saveIDEState();
    }

    // Destroy the virtual GPU
    if (QRuntime.$GPU) { QRuntime.$GPU.terminate(); }
    usePointerLock = false;
    releasePointerLock();
    stopAllSounds();
    coroutine = null;
    clearTimeout(lastAnimationRequest);
    clearInterval(lastAnimationRequest);
    lastAnimationInterval = undefined;
    ctx.fillStyle = '#000000';
    afterglowCTX.fillStyle = '#000000';
    overlayCTX.fillStyle = '#000000';
    ctx.fillRect(0, 0, emulatorScreen.width, emulatorScreen.height);
    overlayCTX.clearRect(0, 0, emulatorScreen.width, emulatorScreen.height);
    afterglowCTX.clearRect(0, 0, emulatorScreen.width, emulatorScreen.height);
    overlayScreen.style.visibility = afterglowScreen.style.visibility = 'hidden';
}


function onSlowButton() {
    onPlayButton(true);
}


function wake() {
    // Wake if asleep (we might be in pause mode because we're a guest, too)
    if (autoSleepEnabled && (emulatorMode === 'pause') && (document.getElementById('sleep').style.visibility === 'visible')) {
        document.getElementById('sleep').style.visibility = 'hidden';
        onPlayButton();
        
        // The set focus doesn't work without this delay for some reason
        setTimeout(function() { emulatorKeyboardInput.focus({preventScroll:true}); });
        
        // sleep.pollHandler will be removed by onPlayButton()

        // Unless told not to, check for update on waking since
        // sleeping disables update checks. This is for the case of
        // someone waking up their console specfically to upgrade it
        if ((getQueryString('update') && getQueryString('update') !== '0') && isQuadserver && getQueryString('kiosk') !== 1) {
            checkForUpdate();
        }
    }
}


/* Invoked via setTimeout to poll for gamepad input while sleeping*/
function sleepPollCallback() {
    if (emulatorMode !== 'play') {
        // Still paused
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : (navigator.webkitGetGamepads ? navigator.webkitGetGamepads : []);
        for (let i = 0; i < gamepads.length; ++i) {
            const gamepad = gamepads[i];
            if (! gamepad || ! gamepad.connected) { continue; }
            for (let b = 0; b < gamepad.buttons.length; ++b) {
                const button = gamepad.buttons[b];
                if (((typeof button === 'object') && button.pressed) ||
                    (button >= 0.5)) {
                    wake();
                    return;
                } // button pressed
            } // for each button
        } // for each gamepad

        // Continue polling
        sleep.pollHandler = setTimeout(sleepPollCallback, SLEEP_POLL_INTERVAL_MILLISECONDS);
    } else {
        sleep.pollHandler = undefined;
    }
}


/* sleep.pollHandler is the gamepad polling event while sleeping */
function sleep() {
    console.log('Sleeping due to inactivity...');
    document.getElementById('sleep').style.visibility = 'visible';
    onPauseButton();
    // Begin gamepad polling
    sleepPollCallback();
}

// Used to detect when we're waiting for a save to complete
let alreadyInPlayButtonAttempt = false;

// Allows a framerate to be specified so that the slow button can re-use the logic.
//
// slow = run at slow framerate (used for *every* slow step as well)
// isLaunchGame = "has this been triggered by QRuntime.launch_game()"
// args = array of arguments to pass to the new program
function onPlayButton(slow, isLaunchGame, args, callback) {
    if (isSafari && ! isMobile) { unlockAudio(); }
    emulatorKeyboardInput.focus({preventScroll:true});

    if (! slow) {
        hideAllRuntimeDialogs();
    }

    // Stop guesting, if currently a guest, but do not stop hosting.
    // This can't come up when single stepping or in slow mode, which
    // are disabled for guests.
    stopGuesting(true);
    
    if (sleep.pollHandler) {
        clearTimeout(sleep.pollHandler);
        sleep.pollHandler = undefined;
    } 
    updateLastInteractionTime();
    
    if (uiMode === 'Editor') {
        // There is nothing useful to see in Editor mode when playing,
        // so switch to IDE mode, which is the closest one that
        // contains an emulator view.
        setUIMode('IDE');
    }
    
    const newTargetFramerate = slow ? SLOW_FRAMERATE : PLAY_FRAMERATE;

    maybeGrabPointerLock();
    if ((emulatorMode === 'play') && (targetFramerate === newTargetFramerate)) {
        // Already in play mode, just refocus input
        emulatorKeyboardInput.focus({preventScroll:true});
        return;
    }

    targetFramerate = newTargetFramerate;
    
    function doPlay() {
        if (slow) {
            document.getElementById('slowButton').checked = 1;
        } else {
            document.getElementById('playButton').checked = 1;
        }
        document.getElementById('playButton').checked = 1;
        setControlEnable('pause', true);
        audioContext.resume();
    
        setErrorStatus('');
        emulatorMode = 'play';
        profiler.reset();
        allow_bloom = true;

        previewRecordingFrame = 0;
        previewRecording = null;
        
        if (! coroutine) {
            // Game has not been compiled yet
            outputDisplayPane.innerHTML = '';
            compiledProgram = '';

            try {
                compiledProgram = compile(gameSource, fileContents, false);
                setErrorStatus('');
            } catch (e) {
                e.message = e.message.replace(/^line \d+: /i, '');
                if (e.message === 'Unexpected token :') {
                    e.message += ', probably due to a missing comma or { nearby';
                }
                if (! e.url) {
                    // This is probably an internal quadplay error
                    console.log(e);
                    return;
                }
                setErrorStatus(shortURL(e.url) + ' line ' + e.lineNumber + ': ' + e.message, {line_number: e.lineNumber, url: e.url});
                editorGotoFileLine(e.url, e.lineNumber, undefined, true);
            }
            
            if (compiledProgram) {
                // Compilation succeeded. Ready to execute. Reload the
                // runtime and compile and launch this code within it.
                programNumLines = compiledProgram.split('\n').length;

                const gameRequiresMidi = /\bmidi\./.test(compiledProgram);
                if (gameRequiresMidi && (! midi.$options.midiAccess ||
                                         (gameSource.json.midi_sysex && !midi.$options.sysex))) {
                
                    // Initialize or re-initialize MIDI, and wipe out MIDI devices while waiting
                    midiReset();
                    try {
                        if (window.top.navigator.requestMIDIAccess) {
                            window.top.navigator.requestMIDIAccess({sysex: gameSource.json.midi_sysex, software: true}).then(onMIDIInitSuccess, onMIDIInitFailure);
                        } else {
                            console.log('MIDI not supported on this device');
                        }
                    } catch (e) {
                        console.log('Ignoring MIDI initialization error', e);
                    }
                }
                
                restartProgram(isLaunchGame ? BOOT_ANIMATION.NONE : useIDE ? BOOT_ANIMATION.SHORT : BOOT_ANIMATION.REGULAR);
            } else {
                programNumLines = 0;
                onStopButton();
            }
            
        } else {
            // The game was already compiled, so just resume the loop
            lastAnimationRequest = setTimeout(mainLoopStep, 0);
            emulatorKeyboardInput.focus({preventScroll:true});
        }
        
        saveIDEState();

        if (callback) { callback(); }
    } // End of the doPlay callback used below
    

    if (emulatorMode === 'stop') {
        // Erase the table
        debugWatchTable = {};
        updateDebugWatchDisplay();

        // Reload the program
        if (loadManager && loadManager.status !== 'complete' && loadManager.status !== 'failure') {
            console.log('Load already in progress...');
        } else if (useIDE && ! isLaunchGame) {
            if (savesPending === 0) {
                // Force a reload of the game
                console.log('Reloading in case of external changes.')
                loadGameIntoIDE(window.gameURL, doPlay, false);
            } else {
                onStopButton();
                if (pendingSaveCallbacks.length > 0 || ! alreadyInPlayButtonAttempt) {
                    // Some saves haven't even been attempted.
                    //
                    // Force the saves to occur right now and then
                    // try running again shortly afterward.
                    runPendingSaveCallbacksImmediately();
                    
                    // Now reschedule pressing this button soon,
                    // after the saves complete. It might fail
                    // again, of course...in that case, we'll end
                    // up in the error message.
                    alreadyInPlayButtonAttempt = true;
                    setTimeout(function () {
                        try {
                            onPlayButton(slow, isLaunchGame, args);
                        } finally {
                            alreadyInPlayButtonAttempt = false;
                        }
                    }, 300);
                } else {
                    setErrorStatus('Cannot reload while saving. Try again in a second.');
                }
            }
        } else { // Not in IDE regular edit mode
            
            // Just play the game, no reload required because
            // we are in user mode.
            doPlay();
        }
    } else {
        console.assert(emulatorMode === 'step' || emulatorMode === 'pause');
        // Was just paused
        resumeAllSounds();
        doPlay();
        emulatorKeyboardInput.focus({preventScroll:true});
    }
}

const controlSchemeTable = {
    Quadplay: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓒ',
        '(d)': 'ⓓ',
        '(e)': 'ⓔ',
        '(f)': 'ⓕ',
        '(p)': 'ⓟ',
        '(q)': 'ⓠ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },
                          
    Zero: {
        '(a)': 'ⓑ',
        '(b)': 'ⓐ',
        '(c)': 'ⓨ',
        '(d)': 'ⓧ',
        '(e)': '⒧',
        '(f)': '⒭',
        '(p)': 'ﯼ',
        '(q)': 'ҕ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    PS3: {
        '(a)': 'ⓧ',
        '(b)': 'Ⓞ',
        '(c)': '▣',
        '(d)': '⍍',
        '(e)': '⒧',
        '(f)': '⒭',
        '(q)': 'ҕ',
        '(p)': 'ﯼ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    PS4: {
        '(a)': 'ⓧ',
        '(b)': 'Ⓞ',
        '(c)': '▣',
        '(d)': '⍍',
        '(e)': '⒧',
        '(f)': '⒭',
        '(p)': 'Ơ',
        '(q)': 'ડ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    PS5: {
        '(a)': 'ⓧ',
        '(b)': 'Ⓞ',
        '(c)': '▣',
        '(d)': '⍍',
        '(e)': '⒧',
        '(f)': '⒭',
        '(p)': '☰',
        '(q)': 'ડ',// Ⅲ
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },
    
    Xbox: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓧ',
        '(d)': 'ⓨ',
        '(e)': '⒧',
        '(f)': '⒭',
        '(p)': '☰',
        '(q)': '⧉',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    Xbox360: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓧ',
        '(d)': 'ⓨ',
        '(e)': '⒧',
        '(f)': '⒭',
        '(q)': '⊲',
        '(p)': '⊳',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    SteamDeck: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓧ',
        '(d)': 'ⓨ',
        '(e)': '⒧',
        '(f)': '⒭',
        '(p)': '☰',
        '(q)': '⧉',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    Genesis: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓧ',
        '(d)': 'ⓨ',
        '(e)': 'ⓒ',
        '(f)': 'ⓩ',
        '(q)': 'ҕ',
        '(p)': 'ﯼ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    Arcade: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓒ',
        '(d)': 'ⓓ',
        '(e)': 'ⓔ',
        '(f)': 'ⓕ',
        '(p)': 'ⓟ',
        '(q)': 'ⓠ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    X_Arcade: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓒ',
        '(d)': 'ⓓ',
        '(e)': 'ⓔ',
        '(f)': 'ⓕ',
        '(p)': 'ⓟ',
        '(q)': 'ⓠ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },
    
    Arcade_X: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓧ',
        '(d)': 'ⓨ',
        '(e)': '⒧',
        '(f)': '⒭',
        '(p)': 'ﯼ',
        '(q)': 'ҕ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },
    
    Arcade_PS: {
        '(a)': 'ⓧ',
        '(b)': 'Ⓞ',
        '(c)': '▣',
        '(d)': '⍍',
        '(e)': '⒧',
        '(f)': '⒭',
        '(p)': 'Ơ',
        '(q)': 'ડ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },
    
    Stadia: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓧ',
        '(d)': 'ⓨ',
        '(e)': '⒧',
        '(f)': '⒭',
        '(q)': '…',
        '(p)': '☰',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    SNES: {
        '(a)': 'ⓑ',
        '(b)': 'ⓐ',
        '(c)': 'ⓨ',
        '(d)': 'ⓧ',
        '(e)': '⒧',
        '(f)': '⒭',
        '(p)': 'ﯼ',
        '(q)': 'ҕ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    SN30_Pro: {
        '(a)': 'ⓑ',
        '(b)': 'ⓐ',
        '(c)': 'ⓨ',
        '(d)': 'ⓧ',
        '(e)': '⒧',
        '(f)': '⒭',
        '(p)': 'ﯼ',
        '(q)': 'ҕ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },
    
    SwitchPro: {
        '(a)': 'ⓑ',
        '(b)': 'ⓐ',
        '(c)': 'ⓨ',
        '(d)': 'ⓧ',
        '(e)': 'ⓛ',
        '(f)': '⒭',
        '(q)': '⊖',
        '(p)': '⊕',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    JoyCon_R: {
        '(a)': 'ⓐ',
        '(b)': 'ⓧ',
        '(c)': 'ⓑ',
        '(d)': 'ⓨ',
        '(e)': 'ⓛ',
        '(f)': 'ⓡ',
        '(q)': '⒭',
        '(p)': '⊕',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    JoyCon_L: {
        '(a)': '▼',
        '(b)': '▶',
        '(c)': '◀',
        '(d)': '▲',
        '(e)': 'ⓛ',
        '(f)': 'ⓡ',
        '(q)': '⒧',
        '(p)': '⊖',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    // Use "return" on Apple platforms and "enter" on PCs
    Keyboard: {
        '(a)': '␣',
        '(b)': isApple ? '⏎' : 'Ɛ',
        '(c)': 'ⓥ',
        '(d)': 'ⓖ',
        '(e)': '⬁',
        '(f)': '⬀',
        '(p)': 'ⓟ',
        '(q)': 'ⓠ',
        '[^]': 'Ⓦ',
        '[<]': 'Ⓐ',
        '[v]': 'Ⓢ',
        '[>]': 'Ⓓ'
    },

    Azerty: {
        '(a)': '␣',
        '(b)': isApple ? '⏎' : 'Ɛ',
        '(c)': 'ⓥ',
        '(d)': 'ⓖ',
        '(e)': '⬁',
        '(f)': '⬀',
        '(p)': 'ⓟ',
        '(q)': 'ⓐ',
        '[^]': 'Ⓩ',
        '[<]': 'Ⓠ',
        '[v]': 'Ⓢ',
        '[>]': 'Ⓓ'
    },

    Colemak: {
        '(a)': '␣',
        '(b)': isApple ? '⏎' : 'Ɛ',
        '(c)': 'ⓥ',
        '(d)': 'ⓓ',
        '(e)': '⬁',
        '(f)': '⬀',
        '(p)': '⬘',
        '(q)': 'ⓠ',
        '[^]': 'Ⓦ',
        '[<]': 'Ⓐ',
        '[v]': 'Ⓡ',
        '[>]': 'Ⓢ'
    },
    
    Kbd_Alt: {
        '(a)': '␣',
        '(b)': isApple ? '⏎' : 'Ɛ',
        '(c)': 'ⓥ',
        '(d)': 'ⓖ',
        '(e)': '⬁',
        '(f)': '⬀',
        '(p)': 'ⓟ',
        '(q)': 'ⓠ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    Kbd_P1: {
        '(a)': 'ⓑ',
        '(b)': 'ⓗ',
        '(c)': 'ⓥ',
        '(d)': 'ⓖ',
        '(e)': '⬁',
        '(f)': 'ⓒ',
        '(p)': '④',
        '(q)': '①',
        '[^]': 'Ⓦ',
        '[<]': 'Ⓐ',
        '[v]': 'Ⓢ',
        '[>]': 'Ⓓ'
    },

    Kbd_P2: {
        '(a)': '⬙',
        '(b)': '⬗',
        '(c)': '⬖',
        '(d)': '⬘',
        '(e)': 'ⓝ',
        '(f)': isApple ? 'Ơ' : '⌥',
        '(p)': '⓪',
        '(q)': '⑦',
        '[^]': 'Ⓘ',
        '[<]': 'Ⓙ',
        '[v]': 'Ⓚ',
        '[>]': 'Ⓛ'
    },

    Azerty_P2: {
        '(a)': '⓵',
        '(b)': 'ⓤ',
        '(c)': '⬙',
        '(d)': 'ⓜ',
        '(e)': 'ⓝ',
        '(f)': isApple ? 'Ơ' : '⌥',
        '(p)': '⒜',
        '(q)': '⓷',
        '[^]': 'Ⓘ',
        '[<]': 'Ⓙ',
        '[v]': 'Ⓚ',
        '[>]': 'Ⓛ'
    },

    HOTAS: {
        '(a)': '①',
        '(b)': '②',
        '(c)': '④',
        '(d)': '③',
        '(e)': '⒧',
        '(f)': '⒭',
        '(p)': 'ﯼ',
        '(q)': 'ҕ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    GPD_Win: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓧ',
        '(d)': 'ⓨ',
        '(e)': '⒧',
        '(f)': '⒭',
        '(p)': 'ﯼ',
        '(q)': 'ҕ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    PiBoy_DMG: {
        '(a)': 'ⓑ',
        '(b)': 'ⓐ',
        '(c)': 'ⓨ',
        '(d)': 'ⓧ',
        '(e)': 'ⓛ',
        '(f)': '⒭',
        '(p)': 'ﯼ',
        '(q)': 'ҕ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },
    
};

// Create aliases and freeze all
for (const name in controlSchemeTable) {
    const scheme = controlSchemeTable[name];
    scheme['ⓐ'] = scheme['(a)'];
    scheme['ⓑ'] = scheme['(b)'];
    scheme['ⓒ'] = scheme['(c)'];
    scheme['ⓓ'] = scheme['(d)'];
    scheme['ⓔ'] = scheme['(e)'];
    scheme['ⓕ'] = scheme['(f)'];
    scheme['ⓟ'] = scheme['(p)'];
    scheme['ⓠ'] = scheme['(q)'];
    scheme['⍐'] = scheme['[^]'];
    scheme['⍗'] = scheme['[v]'];
    scheme['⍇'] = scheme['[<]'];
    scheme['⍈'] = scheme['[>]'];
    Object.freeze(scheme);
}


/** Called by reset_game() as well as the play and reload buttons to
    reset all game state and load the game.  */
function restartProgram(numBootAnimationFrames) {
    resetEmulatorKeyState();

    reloadRuntime(function () {
        try {
            // Inject the constants into the runtime space. Define
            // assets first so that references can point to them.
            makeAssets(QRuntime, gameSource.assets);
            makeConstants(QRuntime, gameSource.constants, gameSource.CREDITS);
        } catch (e) {
            // Compile-time error
            onStopButton();
            setErrorStatus(e);
        }

        // Create the main loop function in the QRuntime environment so
        // that it sees those variables.
        try {
            coroutine = QRuntime.$makeCoroutine(compiledProgram);
            QRuntime.$numBootAnimationFrames = numBootAnimationFrames; 
            lastAnimationRequest = setTimeout(mainLoopStep, 0);
            emulatorKeyboardInput.focus({preventScroll: true});
            updateDebugger(true);
            firstPrintOrWatch = true;            
        } catch (e) {
            // "Link"-time or run-time on a script error
            onError(e);
            return;
        }
    });
}


function onError(e) {
    onStopButton();
    if (useIDE && (uiMode === 'Emulator' || uiMode === 'Maximal' || uiMode === 'Windowed')) {
        // Go to a mode where the error will be visible.
        setUIMode('IDE');
    }

    if (useIDE && QRuntime.$debugWatchEnabled) {
        // Flush the debug data to display so that errors can be
        // debugged from it
        updateDebugWatchDisplay();
    }
    
    e = jsToPSError(e);

    // Try to compute a short URL
    setErrorStatus(e.message, {url: e.url, line_number: e.lineNumber, fcn: e.fcn});
    if (e.stack && e.stack.length > 0) {
        for (let i = 0; i < e.stack.length; ++i) {
            const entry = e.stack[i];

            let fcn = entry.fcn;
            
            if (entry.url) {
                $outputAppend(`<span style="color:#f55">  called from ${fcn} at <a style="font-family:Arial; cursor: pointer" onclick="editorGotoFileLine('${entry.url}', ${entry.lineNumber})">${shortURL(entry.url)}:${entry.lineNumber}</a><span>\n`);
            } else {
                // Safari case, no line numbers
                $outputAppend(`<span style="color:#f55">  called from ${fcn}<span>\n`);
            }
        }
    }
    editorGotoFileLine(e.url, e.lineNumber, undefined, true);
}


function showReorderGamepadsDialog() {
    const dialog = document.getElementById('reorderGamepadsDialog');
    dialog.classList.remove('hidden');

    // Store the state on this function

    // Start with a mapping that is useless, so that we can use indexOf on
    // real indices to see if they have been consumed.
    showReorderGamepadsDialog.map = [9, 9, 9, 9];

    // Gamepad we are currently testing for
    showReorderGamepadsDialog.index = 0;

    // Set the initial message
    showReorderGamepadsDialog.assign(undefined);

    const poll = function() {
        const gamepads = navigator.getGamepads();

        if (gamepads) {
            let g = -1;
            for (let i = 0; i < gamepads.length; ++i) {
                const gamepad = gamepads[i];

                // Chrome may have null gamepads in the list
                if (! gamepad) { continue; } else { ++g; }

                // Ignore buttons on gamepads that have been assigned already
                if (showReorderGamepadsDialog.map.indexOf(g) === -1) {
                    for (let b = 0; b < gamepad.buttons.length; ++b) {
                        if (gamepad.buttons[b].pressed) {
                            // A button is pressed on this gamepad. Assign it and advance
                            // to the next one.
                            showReorderGamepadsDialog.assign(g);
                            break;
                        }
                    } // for b
                } // if
            } // for i/g
        } // if gamepads exist

        if (showReorderGamepadsDialog.index > 3) {
            // Done!
            onReorderGamepadsDone();
        } else if (! dialog.classList.contains('hidden')) {
            // Poll repeatedly until the dialog closes
            setTimeout(poll, 15);
        }
    };
    
    poll();
}


showReorderGamepadsDialog.assign = function (value) {
    if (value !== undefined) {
        // On the first call, just set the message
        showReorderGamepadsDialog.map[showReorderGamepadsDialog.index] = value;
        ++showReorderGamepadsDialog.index;
    }
    const index = showReorderGamepadsDialog.index;
    const messagePane = document.getElementById('reorderGamepadsMessage');
    messagePane.innerHTML = `<div style="text-align:center; font-size:400%; font-weight:bold; color:#FFF">P${index+1}</div>Press a button on player ${index + 1}'s controller (<code>gamepad_array[${index}]</code>) or <button onclick="showReorderGamepadsDialog.assign(DISABLED_GAMEPAD)">Disable</button> the P${index + 1} physical gamepad support.`;
    
    // The polling test will automatically save when done, so no need
    // to test for the last assignment here.    
}


function hideReorderGamepadsDialog() {
    document.getElementById('reorderGamepadsDialog').classList.add('hidden');
}


function onReorderGamepadsReset() {
    setGamepadOrderMap([0, 1, 2, 3])
    hideReorderGamepadsDialog();
}


function onReorderGamepadsDone() {
    hideReorderGamepadsDialog();
    
    // Set the unassigned values
    for (let i = showReorderGamepadsDialog.index; i <= 3; ++i) {
        // These are the unset ones. Temporarily make them values that
        // won't match existing values so that we can use indexOf
        showReorderGamepadsDialog.map[i] = 9;
    }

    // Iterate again, setting gamepad i
    for (; showReorderGamepadsDialog.index <= 3; ++showReorderGamepadsDialog.index) {
        // Choose the first unused value
        for (let g = 0; g < i; ++g) {
            // Is g in use?
            if (showReorderGamepadsDialog.map.indexOf(g) === -1) {
                // This one is free
                showReorderGamepadsDialog.map[showReorderGamepadsDialog.index] = g;
                break;
            }
        }
    }
    
    setGamepadOrderMap(showReorderGamepadsDialog.map);
}


function showWaitDialog() {
    document.getElementById('waitDialog').classList.remove('hidden');
}


function hideWaitDialog() {
    document.getElementById('waitDialog').classList.add('hidden');
}


function closeDropdowns() {
    const list = document.getElementsByClassName('dropdown');
    for (let i = 0; i < list.length; ++i) {
        list[i].style.visibility = 'hidden';
    }
}


window.onclick = function(event) {
    /*
    // Hide modal dialogs
    if (event.target.classList.contains('modal') && (event.target !== document.getElementById('waitDialog'))) {
        event.target.classList.add('hidden');
    }
    */
    
    // Hide dropdown menus
    closeDropdowns();
} 


function onStepButton() {
    switch (emulatorMode) {
    case 'play':
        onPauseButton();
        break;

    case 'stop':
    case 'pause':
        onPlayButton();
        if (emulatorMode === 'play') {
            emulatorMode = 'step';
        }
        break;
    }
}


function onPauseButton() {
    if (emulatorMode === 'play' || emulatorMode === 'step') {
        document.getElementById('pauseButton').checked = 1;
        emulatorMode = 'pause';
        releasePointerLock();
        pauseAllSounds();
        clearInterval(lastAnimationRequest);
        lastAnimationInterval = undefined;
    }
}

// Changed by device_control, always resets on program start
let usePointerLock = false;

/** Use pointer lock if indicated */
function maybeGrabPointerLock() {
    if (usePointerLock && emulatorScreen.requestPointerLock) {
        emulatorScreen.requestPointerLock();
    }
    emulatorScreen.style.cursor = runtime_cursor;
    overlayScreen.style.cursor = runtime_cursor;
    afterglowScreen.style.cursor = runtime_cursor;
}

/** Release pointer lock if it is held, without changing usePointerLock */
function releasePointerLock() {
    if (document.exitPointerLock) { document.exitPointerLock(); }
    emulatorScreen.style.cursor = 'crosshair';
    overlayScreen.style.cursor = 'crosshair';
    afterglowScreen.style.cursor = 'crosshair';
}

function inModal() { return false; }

function onDocumentKeyUp(event) {
    if (((event.which || event.keyCode) === 82) && (event.ctrlKey || event.metaKey)) { // Ctrl+R
        // Intercept from browser to prevent page reload
        event.stopPropagation();
        event.preventDefault();
        return false;
    }
}


function onDocumentKeyDown(event) {
    if (onWelcomeScreen) {
        onWelcomeTouch();
        event.preventDefault();
        return;
    }

    wake();

    switch (event.which || event.keyCode) {
    case 187: // ^= ("^+") = zoom in
        if (! (event.ctrlKey || event.metaKey)) { break; }
        if (useIDE) {
            event.preventDefault();
            onIncreaseFontSizeButton();
        }
        break;
        
    case 189: // ^- = zoom out
        if (! (event.ctrlKey || event.metaKey)) { break; }
        if (useIDE) {
            event.preventDefault();
            onDecreaseFontSizeButton();
        }
        break;
        
    case 121: // F10 = single step
        event.preventDefault();
        if (! inModal() && useIDE) {
            onStepButton();
        }
        break;

    case screenshotKey: // F6
        if (event.shiftKey) {
            if (editableProject) {
                takeLabelImage();
            } else {
                $systemPrint('Cannot create a label image because this project is not editable.');
            }
        } else {
            downloadScreenshot();
        }
        break;

    case gifCaptureKey: // F8
        if (event.shiftKey) {
            if (! previewRecording) {
                if (editableProject) {
                    startPreviewRecording();
                } else {
                    $systemPrint('Cannot create a preview sequence because this project is not editable.');
                }
            }
        } else {
            toggleGIFRecording();
        }
        break;        
        
    case 116: // F5
        event.preventDefault();
        if (! inModal() && useIDE) {
            if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
                onRestartButton();
            } else if (event.shiftKey) {
                onStopButton();
            } else {
                onPlayButton();
            }
        }
        break;

    case 82: // R
        if (useIDE && (event.ctrlKey || event.metaKey)) { // Ctrl+R
            // Intercept from browser
            event.preventDefault();
            event.stopPropagation();
            if (! inModal()) { onRestartButton(); }
        }
        break;

    case 83: // S
        if (event.ctrlKey || event.metaKey) { // Ctrl+S; "save" is never needed
            // Intercept from browser
            event.preventDefault();
            event.stopPropagation();
        }
        break;

    case 219: // [
    case 221: // ]
    case 72: // H
        if (useIDE && (event.ctrlKey || event.metaKey)) {
            // Browser navigation keys...disable when in the IDE!
            event.preventDefault();
            event.stopPropagation();
        }
        break;
        
    case 71: // Ctrl+G = go to line
        if (useIDE && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.stopPropagation();
            onCodeEditorGoToLineButton();
        }
        break;
        
    case 80: // Ctrl+P = pause
        if (! event.ctrlKey && ! event.metaKey) { 
            return;
        }
        // Don't print or handle a P in game!
        // Intercept from browser
        event.preventDefault();
        event.stopPropagation();
        
    case 19: // [Ctrl+] Break
        if (useIDE) { onPauseButton(); }
        break;

    case 27: // Esc
        if (useIDE) {
            if (customContextMenu.style.visibility === 'visible') {
                customContextMenu.style.visibility = 'hidden';
                event.stopPropagation();
                event.preventDefault();
            }
        } else {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
        break;
    }
}


if (useIDE) { ace.config.set('basePath', 'ace/'); }
const jsCode = document.getElementById('jsCode') && useIDE && ace.edit(document.getElementById('jsCode'));
const editorStatusBar = document.getElementById('editorStatusBar');
const aceEditor = useIDE ? ace.edit('ace') : null;

if (useIDE) {

    aceEditor.setTheme('ace/theme/quadplay');
    
    // Stop auto-completion of parentheses
    aceEditor.setBehavioursEnabled(false);

    // https://ajaxorg.github.io/ace-api-docs/interfaces/ace.Ace.EditorOptions.html
    aceEditor.setOptions({
        showPrintMargin: false,
        displayIndentGuides: true}); // true is the default
    
    // Save when losing focus
    aceEditor.on('blur', runPendingSaveCallbacksImmediately);

    // Ace's default "go to line" dialog is confusing, so
    // we replace it with our friendlier one.
    aceEditor.commands.addCommand({
        name: "go to line",
        bindKey: {win: "Ctrl-G", linux: "Ctrl-G", mac: "Command-G"},
        exec: onCodeEditorGoToLineButton});
}


function saveIDEState() {
    // Never save in kiosk mode
    if (getQueryString('kiosk') === '1') { return; }

    const options = {
        'uiMode': uiMode,
        'backgroundPauseEnabled': backgroundPauseEnabled,
        'autoSleepEnabled': autoSleepEnabled,
        'colorScheme': colorScheme,
        'volumeLevel': '' + volumeLevel,
        'gamepadOrderMap': gamepadOrderMap.join(''),
        'showPhysicsEnabled': document.getElementById('showPhysicsEnabled').checked,
        'showEntityBoundsEnabled': document.getElementById('showEntityBoundsEnabled').checked,
        'showPrivateViewsEnabled': document.getElementById('showPrivateViewsEnabled').checked,
        'assertEnabled': document.getElementById('assertEnabled').checked,
        'todoEnabled': document.getElementById('todoEnabled').checked,
        'automathEnabled': document.getElementById('automathEnabled').checked,
        'debugWatchEnabled': document.getElementById('debugWatchEnabled').checked,
        'debugPrintEnabled': document.getElementById('debugPrintEnabled').checked,
        'prettyPrintEnabled': document.getElementById('prettyPrintEnabled').checked,
        'printTouchEnabled': document.getElementById('printTouchEnabled').checked,
        'restartOnFocusEnabled': document.getElementById('restartOnFocusEnabled').checked,
        'codeEditorFontSize': '' + codeEditorFontSize,
        'autoplayOnLoad': document.getElementById('autoplayOnLoad').checked,
        'onScreenHUDEnabled': document.getElementById('onScreenHUDEnabled').checked,
        'keyboardMappingMode': keyboardMappingMode
    };

    // Find the selected debugger tab
    {
        const array = document.getElementById('debugger').children;
        for (let i = 0; i < array.length; ++i) {
            if (array[i].tagName === 'INPUT' && array[i].checked) {
                options.activeDebuggerTab = array[i].id;
                break;
            }
        }
    }

    for (let name in options) {
        localStorage.setItem(name, options[name]);
    }
}


function showGamepads() {
    let s = 'Gamepads = [\n';
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : (navigator.webkitGetGamepads ? navigator.webkitGetGamepads : []);
    for (let i = 0; i < gamepads.length; ++i) {
        let pad = gamepads[i];
        if (pad && pad.connected) {
            s += '  "' + pad.id + '",\n';
        }
    }

    s += ']';
    s = s.replace('",\n]', '"\n]');

    s += '\n\n';
    s += 'MIDI = {\n  input_port_array: [\n';
    for (let i = 0; i < midi.input_port_array.length; ++i) {
        s += '     "' + midi.input_port_array[i].name + '",\n';
    }
    s += '  ]';
    s = s.replace(',\n  ]', '\n  ]');

    s += ',\n  output_port_array: [\n';
    for (let i = 0; i < midi.output_port_array.length; ++i) {
        s += '     "' + midi.output_port_array[i].name + '",\n';
    }
    s += '  ]';
    s = s.replace(',\n  ]', '\n  ]');
    s += '\n}';
    
    console.log(s);

    window.open('controls.html?devices=' + encodeURIComponent(s), '', 'width=400,height=500');
}


let soundEditorCurrentSound = null;

/** Called when a project tree control element is clicked.

    For the overview Mode and Constants page, the object is undefined.

    - `target` is the project hierarchy element that links. 
      It can often be obtained from the name, for example: 
      document.getElementById('projectAsset_${assetName}')
      defined by the caller, it will be discovered
    - `type` is one of: 'asset', 'constant', 'mode', 'script', 'doc'
    - `object` is the underlying gameSource child to modify
 */
function onProjectSelect(target, type, object) {
    // Don't do anything if the game hasn't loaded yet. Any
    // editor is likely to crash at this point with undefined
    // children.
    if (! gameSource || ! gameSource.json) { return; }
    
    // Hide all editors
    const editorFrame = document.getElementById('editorFrame');
    for (let i = 0; i < editorFrame.children.length; ++i) {
        editorFrame.children[i].style.visibility = 'hidden';
    }
    
    const gameEditor    = document.getElementById('gameEditor');
    const modeEditor    = document.getElementById('modeEditor');
    const codePlusFrame = document.getElementById('codePlusFrame');

    // Hide the viewers within the content pane for the code editor
    const editorContentFrame = document.getElementById('editorContentFrame');
    for (let i = 0; i < editorContentFrame.children.length; ++i) {
        editorContentFrame.children[i].style.visibility = 'hidden';
    }

    const codeEditor     = document.getElementById('codeEditor');
    const spriteEditor   = document.getElementById('spriteEditor');
    const soundEditor    = document.getElementById('soundEditor');
    const mapEditor      = document.getElementById('mapEditor');
    const docEditor      = document.getElementById('docEditor');

    document.getElementById('spriteEditorHighlight').style.visibility =
        document.getElementById('spriteEditorPivot').style.visibility = 'hidden';
    
    let list = document.getElementsByClassName('selectedProjectElement');
    for (let i = 0; i < list.length; ++i) {
        list[i].classList.remove('selectedProjectElement');
    }

    if ((type === 'mode') && (object === undefined)) {
        // Select the mode diagram itself
        target.classList.add('selectedProjectElement');
        visualizeModes(modeEditor);
        modeEditor.style.visibility = 'visible';
        return;
    }

    document.getElementById('codeEditorDivider').style.visibility = 'unset';    
    if (type === 'doc') {
        // Documents
        target.classList.add('selectedProjectElement');
        showGameDoc(object);
        docEditor.style.visibility = 'visible';
        codePlusFrame.style.visibility = 'visible';

        codePlusFrame.style.gridTemplateRows = `auto 0px 0px 1fr`;
        
        if (object.endsWith('.md') ||
            object.endsWith('.html') ||
            object.endsWith('.txt')) {

            // Show the editor after loading the content
            if (fileContents[object] !== undefined) {
                setCodeEditorDividerFromLocalStorage();
                setCodeEditorSession(object);
            } else {
                // Load and set the contents
                LoadManager.fetchOne({forceReload: true}, object, 'text', null, function (doc) {
                    fileContents[object] = doc;
                    setCodeEditorDividerFromLocalStorage();
                    setCodeEditorSession(object);
                });
            }
        }
        return;
    }

    if (type === 'game') {
        if (target) { target.classList.add('selectedProjectElement'); }
        visualizeGame(gameEditor, gameSource.jsonURL, gameSource.json);
        gameEditor.style.visibility = 'visible';
        codePlusFrame.style.visibility = 'visible';
        setCodeEditorDividerFromLocalStorage();
        setCodeEditorSession(gameSource.jsonURL);
        return;
    }

    // Find the parent .li
    while (target && (target.tagName !== 'LI')) {
        target = target.parentNode;
    }

    if (target) {
        target.classList.add('selectedProjectElement');
    }

    switch (type) {
    case 'constant':
        // object may be undefined
        showConstantEditor(object);
        break;
        
    case 'mode':
    case 'script':
        {
            // See if there is already an open editor session, and create one if it
            // doesn't exist
            const url = (type === 'mode') ? object.url : object;
            setCodeEditorSession(url);
            // Show the code editor and hide the content pane
            codePlusFrame.style.visibility = 'visible';
            codePlusFrame.style.gridTemplateRows = '0px 0px auto 1fr';
            document.getElementById('codeEditorDivider').style.visibility = 'hidden';
        }
        break;
        
    case 'asset':
        console.assert(object);
        const url = object.$url || object.src;
        // Find the underlying gameSource.asset key for this asset so
        // that we can fetch it again if needed
        let assetName;
        for (const k in gameSource.assets) {
            const asset = gameSource.assets[k];
            if (asset === object) {
                assetName = k;
                break;
            } else if (asset.spritesheet && asset.spritesheet === object) {
                // Spritesheet on a map
                assetName = asset.$name + '.spritesheet';
                break;
            }
        }
        console.assert(assetName, 'Could not find asset name for ' + object);
        setCodeEditorSession(object.$jsonURL, assetName);

        // Show the code editor and the content pane
        codePlusFrame.style.visibility = 'visible';
        setCodeEditorDividerFromLocalStorage();
        const spriteEditorCanvas = document.getElementById('spriteEditorCanvas');
        const spriteEditorHighlight = document.getElementById('spriteEditorHighlight');
        const spriteEditorPivot = document.getElementById('spriteEditorPivot');
        const spriteEditorInfo = document.getElementById('spriteEditorInfo');
        spriteEditorHighlight.style.visibility = 'hidden';
        spriteEditorPivot.style.visibility = 'hidden';
        spriteEditorCanvas.onmousemove = spriteEditorCanvas.onmousedown = undefined;
        
        if (/\.png$/i.test(url)) {
            showPNGEditor(object, assetName);
        } else if (/\.mp3$/i.test(url)) {
            soundEditor.style.visibility = 'visible';
            soundEditorCurrentSound = object;
            document.querySelector('#soundEditor audio').src = object.$url;
        } else if (/\.tmx$/i.test(url)) {
            visualizeMap(object);
            mapEditor.style.visibility = 'visible';
        }
        break;
    }
}


// Callback for iframe reloading
function setIFrameScroll(iframe, x, y) {
    const html = iframe.contentWindow.document.getElementsByTagName('html')[0];
    html.scrollLeft = x;
    html.scrollTop = y;
}


function setEditorTitle(url) {
    const editorTitle = document.getElementById('editorTitle');
    editorTitle.innerHTML = url.replace(/^.*\//, '').replace(/[<>&]/g, '');
    editorTitle.title = url;
}


/* Updates the preview pane of the doc editor. If useFileContents is true,
   use fileContents[url] when not undefined instead of actually reloading. */
function showGameDoc(url, useFileContents) {
    const docEditor = document.getElementById('docEditor');
    setEditorTitle(url);

    const preserveScroll = (docEditor.lastURL === url);
    docEditor.lastURL = url;

    const srcdoc = useFileContents ? fileContents[url] : undefined;

    // Store old scroll position
    let oldScrollX = 0, oldScrollY = 0;
    {
        const element = document.getElementById('doc');
        if (element) {
            if (element.contentWindow) {
                // Only works when the document is on the same domain
                const doc = element.contentWindow.document;
                const html = doc.getElementsByTagName('html')[0];
                oldScrollX = Math.max(html.scrollLeft, doc.body.scrollLeft);
                oldScrollY = Math.max(html.scrollTop, doc.body.scrollTop);
            } else {
                oldScrollX = element.scrollLeft;
                oldScrollY = element.scrollTop;
            }
        }
    }
    
    // Strip anything sketchy that looks like an HTML attack from the URL
    console.assert(url !== undefined);
    url = url.replace(/['" ><]/g, '');

    docEditor.innerHTML = `<iframe id="doc" onload="setIFrameScroll(this, ${oldScrollX}, ${oldScrollY})" border=0 width=125% height=125%></iframe>`;
    if (url.endsWith('.html')) {
        // Includes the .md.html case
        
        if (srcdoc !== undefined && false) {
            // TODO: Why would we want this case? It causes problems with reloads
            
            // Already loaded content.
            // Add a base tag to HTML documents so that relative URLs are parsed correctly
            const baseTag = `<base href="${urlDir(url)}">`;
            document.getElementById('doc').srcdoc = (baseTag + srcdoc).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        } else {
            // Load from the file
            document.getElementById('doc').src = url;
        }
    } else if (url.endsWith('.md')) {
        const baseTag = `<base href="${urlDir(url)}">`;

        // Trick out .md files using Markdeep
        
        function markdeepify(text) {
            const markdeepURL = makeURLAbsolute('', 'quad://doc/markdeep.min.js');
            text = baseTag + text;
            // Escape quotes to avoid ending the srcdoc prematurely
            return `${text.replace(/"/g, '&quot;')}
                <style>
body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif}

.md a, .md div.title, contents, .md .tocHeader, 
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6, .md .nonumberh1, .md .nonumberh2, .md .nonumberh3, .md .nonumberh4, .md .nonumberh5, .md .nonumberh6, 
.md .shortTOC, .md .mediumTOC, .md .longTOC {
    color: inherit;
    font-family: inherit;
}
.md .title, .md h1, .md h2, .md h3, .md h4, .md h5, .md h6, .md .nonumberh1, .md .nonumberh2, .md .nonumberh3, .md .nonumberh4, .md .nonumberh5, .md .nonumberh6 {
margin-top: 0; padding-top: 0
}
.md h2 { border-bottom: 2px solid }
.md div.title { font-size: 40px }
.md .afterTitles { height: 0; padding-top: 0; padding-bottom: 0 }
</style>\n

<!-- Markdeep: --><script src='${markdeepURL}'></script>\n`;            
        }

        if (srcdoc !== undefined && false) {
            document.getElementById('doc').srcdoc = markdeepify(srcdoc);
        } else {
            LoadManager.fetchOne({
                errorCallback: function () { console.log('Error while loading', url); },
                forceReload: true}, url, 'text', null,  function (text) {
                    document.getElementById('doc').srcdoc = markdeepify(srcdoc);
                });
        }
    } else {
        // Treat as text file
        docEditor.innerHTML = `<object id="doc" width="125%" height="125%" type="text/plain" data="${url}?" border="0"> </object>`;
    }
}

function escapeHTMLEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


function visualizeConstant(value, indent) {
    let s = '';
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; ++i) {
        let k = keys[i];
        let v = Array.isArray(value) ? value[i] : value[k];
        k = escapeHTMLEntities(k);
        if (Array.isArray(v) || typeof v === 'object') {
            s += `<tr valign=top><td>${indent}${k}:</td><td></td><td><i>${Array.isArray(v) ? 'array' : 'object'}</i></td></tr>\n` + visualizeConstant(v, indent + '&nbsp;&nbsp;&nbsp;&nbsp;');
        } else {
            v = QRuntime.unparse(v);
            s += `<tr valign=top><td>${indent}${k}:</td><td></td><td>`;

            if (v.indexOf('\n') !== -1 && v[0] === '"' && v[v.length - 1] === '"') {
                // Multiline string. Remove the quotes and format multiline
                v = escapeHTMLEntities(v.substring(1, v.length - 1));
                s += `<table style="border-collapse:collapse; margin: -2px 0"><tr><td style="vertical-align:top"><code>&quot;</code></td><td><pre style="margin: 0 0">${v}</pre></td><td style="vertical-align:bottom"><code>&quot;</code></td></tr></table>`;
            } else {
                v = escapeHTMLEntities(v);
                s += `<code>${v}</code>`
            }
            s += '</td></tr>\n';

        }
    }
    
    return s;
}

function onOpenFolder(filename) {
    postToServer({command: 'open', app: '<finder>', file: filename});
}


function visualizeGame(gameEditor, url, game) {
    console.assert(url, 'undefined url');

    const disabled = editableProject ? '' : 'disabled';
    let s = '';

    if (! editableProject) {
        // Why isn't this project editable?
        const reasons = [];

        if (! locallyHosted()) {
            reasons.push('is hosted on a remote server');
        } else if (! isQuadserver) {
            reasons.push('is not running locally with the <code>quadplay</code> script');
        }

        if (! useIDE) {
            reasons.push('was launched without the IDE');
        }

        // Is built-in
        if (isBuiltIn(gameURL)) {
            reasons.push('is a built-in example');
        }
        
        s += '<i>This project is locked because it';
        if (reasons.length > 1) {
            // Many reasons
            s += '<ol>\n';
            for (let i = 0; i < reasons.length; ++i) {
                s += '<li>' + reasons[i] + '</li>\n';
            }
            s += '<ol>\n';
        } else {
            // One reason
            s += ' ' + reasons[0] + '.';
        }
        s += '</i><br><br>\n';
    }

    s += '<table>\n';
    s += '<tr valign="top"><td>Path</td><td colspan=3>' + url + '</td></tr>\n';

    if (editableProject) {
        const filename = serverConfig.rootPath + urlToLocalWebPath(url);
        // The second regexp removes the leading slash on windows
        let path = filename.replace(/\/[^.\/\\]+?\.game\.json$/, '').replace(/^\/([a-zA-Z]:\/)/, '$1');
        if (path.length > 0 && path[path.length - 1] !== '/') { path += '/'; }
        s += `<tr valign="top"><td>Folder</td><td colspan=3><a onclick="onOpenFolder('${path}')" style="cursor:pointer">${path}</a></td></tr>\n`;
    }
    
    s += `<tr valign="top"><td width="110px">Title</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} onchange="onProjectMetadataChanged()" id="projectTitle" value="${(game.title || '').replace(/"/g, '\\"')}"></td></tr>\n`;
    s += `<tr valign="top"><td>Developer</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} onchange="onProjectMetadataChanged()" id="projectDeveloper" value="${(game.developer || '').replace(/"/g, '\\"')}"></td></tr>\n`;
    s += `<tr valign="top"><td>Copyright</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} onchange="onProjectMetadataChanged()" id="projectCopyright" value="${(game.copyright || '').replace(/"/g, '\\"')}"></td></tr>\n`;
    s += `<tr valign="top"><td>License</td><td colspan=3><textarea ${disabled} style="width:384px; padding: 3px; margin-bottom:-3px; font-family: Helvetica, Arial; font-size:12px" rows=2 id="projectLicense" onchange="onProjectMetadataChanged(this)">${game.license}</textarea>`;
    if (editableProject) {
        // License defaults
        s += '<br><button class="license" onclick="onProjectLicensePreset(\'All\')">All Rights Reserved</button><button class="license" onclick="onProjectLicensePreset(\'GPL\')">GPL 3</button><button onclick="onProjectLicensePreset(\'BSD\')" class="license">BSD</button><button class="license" onclick="onProjectLicensePreset(\'MIT\')">MIT</button><button onclick="onProjectLicensePreset(\'CC0\')" class="license">Public Domain</button>';
    }
    s += '</td></tr>\n';

    s+= '<tr><td>&nbsp;</td></tr>\n';
    if (editableProject) {
        s += '<tr valign="top"><td>Start&nbsp;Mode</td><td colspan=3><select id="projectstartmodedropdown" style="width:390px" onchange="onProjectInitialModeChange(this.value)">\n';
        for (let i = 0; i < gameSource.modes.length; ++i) {
            const mode = gameSource.modes[i];
            if (! mode.name.startsWith('quad://console/os/_') && ! mode.name.startsWith('$')) {
                s += `<option value=${mode.name} ${mode.name === gameSource.json.start_mode ? 'selected' : ''}>${mode.name}</option>\n`;
            }
        }
        s += '</select></td></tr>\n';

        const overrideInitialMode = gameSource.debug && gameSource.debug.json && gameSource.debug.json.start_mode_enabled && gameSource.debug.json.start_mode;
        s += `<tr valign="top"><td></td><td><label><input id="projectdebugstartmodeoverridecheckbox" type="checkbox" autocomplete="false" style="margin-left:0" ${overrideInitialMode ? 'checked' : ''} onchange="onDebugInitialModeOverrideChange(this)">Debug&nbsp;Override</label></td><td colspan=2"><select id="debugOverrideInitialMode" style="width:205px; top:-2px" ${overrideInitialMode ? '' : 'disabled'} onchange="onProjectDebugInitialModeChange(this.value)">\n`;
        for (let i = 0; i < gameSource.modes.length; ++i) {
            const mode = gameSource.modes[i];
            if (! mode.name.startsWith('quad://console/os/_') && ! mode.name.startsWith('$')) {
                s += `<option value=${mode.name} ${(gameSource.debug.json && (mode.name === gameSource.debug.json.start_mode)) ? 'selected' : ''}>${mode.name}</option>\n`;
            }
        }
        s += '</select></td></tr>\n';
        
        s += `<tr valign="top"><td>Screen&nbsp;Size</td><td colspan=3><select id="projectscreensizedropdown" style="width:390px" onchange="onProjectScreenSizeChange(this)">`;
        for (let i = 0; i < allowedScreenSizes.length; ++i) {
            const W = allowedScreenSizes[i].x, H = allowedScreenSizes[i].y;
            s += `<option value='{"x":${W},"y":${H}}' ${W === gameSource.extendedJSON.screen_size.x && H === gameSource.extendedJSON.screen_size.y ? "selected" : ""}>${W} × ${H}${W === 384 && H === 224 ? ' ✜' : ''}</option>`;
        }
        s += `</select></td></tr>\n`;
    } else {
        // The disabled select box is too hard to read, so revert to a text box when not editable
        for (let i = 0; i < gameSource.modes.length; ++i) {
            const mode = gameSource.modes[i];
            if (! mode.name.startsWith('quad://console/os/_') && (mode.name === gameSource.json.start_mode)) {
                s += `<tr valign="top"><td>Initial&nbsp;Mode</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} value="${mode.name.replace(/\*/g, '')}"></td></tr>\n`;
                break;
            }
        }
        s += `<tr valign="top"><td>Screen&nbsp;Size</td><td colspan=3><input id="projectscreensizetextbox" type="text" autocomplete="false" style="width:384px" ${disabled} value="${gameSource.extendedJSON.screen_size.x} × ${gameSource.extendedJSON.screen_size.y}"></td></tr>\n`;
    }
    s += `<tr valign="top"><td></td><td colspan=3><label><input id="projectyupcheckbox" type="checkbox" autocomplete="false" style="margin-left:0" ${disabled} ${game.y_up ? 'checked' : ''} onchange="onProjectYUpChange(this)">Y-Axis = Up</label></td></tr>\n`;

    s += '<tr><td>&nbsp;</td></tr>\n';
    s += `<tr valign="top"><td>I/O</td><td colspan=4><label><input id="projectdualdpadcheckbox" type="checkbox" autocomplete="false" style="margin-left:0" ${disabled} ${game.dual_dpad ? 'checked' : ''} onchange="onProjectDualDPadChange(this)">Dual D-Pad</label>  <label><input id="projectmidicheckbox" type="checkbox" autocomplete=false ${disabled} ${game.midi_sysex ? 'checked' : ''} onchange="onProjectMIDISysexChange(this)" style="margin-left: 50px" tooltip="Does this game send MIDI sysex messages?">MIDI Sysex Output</label></td></tr>\n`;
    s += '<tr><td>&nbsp;</td></tr>\n';
    
    s += `<tr valign="top"><td>Description<br><span id="projectDescriptionLength">(${(game.description || '').length}/100 chars)</span> </td><td colspan=3><textarea ${disabled} style="width:384px; padding: 3px; margin-bottom:-3px; font-family: Helvetica, Arial; font-size:12px" rows=2 id="projectDescription" onchange="onProjectMetadataChanged(this)" oninput="document.getElementById('projectDescriptionLength').innerHTML = '(' + this.value.length + '/100 chars)'">${game.description || ''}</textarea>`;
    s += '<tr valign="top"><td>Features</td><td colspan=3>';
    const boolFields = ['Cooperative', 'Competitive', 'High Scores', 'Achievements'];
    for (let f = 0; f < boolFields.length; ++f) {
        const name = boolFields[f];
        const field = name.replace(/ /g,'').toLowerCase();
        s += `<label><input ${disabled} type="checkbox" id="project${capitalize(field)}" onchange="onProjectMetadataChanged(this)" ${game[field] ? 'checked' : ''}>${name}</label> `;
    }
    s += '</td></tr>\n';
    s += `<tr><td></td><td><input type="number" min="1" max="8" ${disabled} onchange="onProjectMetadataChanged(this)" id="projectMinPlayers" value="${game.min_players || 1}"></input> - <input type="number" min="1" max="8" ${disabled} onchange="onProjectMetadataChanged(this)" id="projectMaxPlayers" value=${game.max_players || 1}></input> Players</td></tr>\n`;
    s += '<tr><td>&nbsp;</td></tr>\n';

    s += `<tr valign="top"><td>Screenshot&nbsp;Tag</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} onchange="onProjectMetadataChanged()" id="screenshotTag" value="${game.screenshot_tag.replace(/"/g, '\\"')}"></td></tr>\n`;
    if (editableProject) {
        const overrideTag = gameSource.debug.json && gameSource.debug.json.screenshot_tag_enabled;
        s += `<tr><td></td><td><label><input id="projectscreenshottag" type="checkbox" autocomplete="false" style="margin-left:0" ${overrideTag ? 'checked' : ''} onchange="onDebugScreenshotTagOverrideChange(this)">Debug&nbsp;Override</label></td><td colspan=2><input type="text" autocomplete="false" style="width:198px" ${overrideTag ? '' : 'disabled'} ${disabled} onchange="onProjectMetadataChanged()" id="debugScreenshotTag" value="${(game.debug && game.debug.json && game.debug.json.screenshot_tag !== undefined) ? game.debug.json.screenshot_tag.replace(/"/g, '\\"') : ''}"></td></tr>`;
    }
    s += '<tr><td>&nbsp;</td></tr>\n';
        
    
    const baseURL = url.replace(/\/[^\/]*$/, '');
    s += '<tr valign="top">';
    s += '<td>Label&nbsp;Icons</td><td style="text-align:left">128px&nbsp;&times;&nbsp;128px<br><img alt="label128.png" src="' + baseURL + '/label128.png?" style="border:1px solid #fff; image-rendering: crisp-edges; image-rendering: pixelated; width:128px; height:128px"></td>';
    s += '<td></td><td style="text-align:left">64px&nbsp;&times;&nbsp;64px<br><img alt="label64.png" src="' + baseURL + '/label64.png?" style="border:1px solid #fff; image-rendering: crisp-edges; image-rendering: pixelated; width:64px; height:64px"></td>';
    s += '</tr>\n<tr><td></td><td colspan=3><i>Press Shift+F6 in game to capture <code>label64.png</code> and <code>label128.png</code> templates. Press shift+f8 to capture the <code>preview.png</code> animation.</i></td></tr><tr><td><br/><br/></td></tr>\n';
    s += '</table>';
    gameEditor.innerHTML = s;
}


function visualizeMap(map) {
    const width  = map.length;
    const height = map[0].length;
    const depth  = map.layer.length;

    // Scale to fit on screen
    const maxDim = Math.max(width * map.sprite_size.x, height * map.sprite_size.y);
    const reduce = (maxDim > 4096) ? 4 : (maxDim > 2048) ? 3 : (maxDim > 1024) ? 2 : 1;

    // Size of destination tiles
    const dstTileX = Math.max(1, Math.floor(map.sprite_size.x / reduce));
    const dstTileY = Math.max(1, Math.floor(map.sprite_size.y / reduce));

    const canvas  = document.getElementById('mapDisplayCanvas');
    canvas.width  = width  * dstTileX;
    canvas.height = height * dstTileY;
    const mapCtx  = canvas.getContext('2d');

    const dstImageData = mapCtx.createImageData(width * dstTileX, height * dstTileY);
    const dstData = new Uint32Array(dstImageData.data.buffer);
    for (let mapZ = 0; mapZ < depth; ++mapZ) {
        const z = map.zScale < 0 ? depth - mapZ - 1 : mapZ;
        for (let mapY = 0; mapY < height; ++mapY) {
            const y = map.$flipYOnLoad ? height - mapY - 1 : mapY;
            for (let mapX = 0; mapX < width; ++mapX) {
                const sprite = map.layer[z][mapX][y];
                if (sprite) {
                    const srcData = sprite.$spritesheet.$uint16Data;
                    const xShift = (sprite.scale.x === -1) ? (sprite.size.x - 1) : 0;
                    const yShift = (sprite.scale.y === -1) ? (sprite.size.y - 1) : 0;
                    const xReduce = reduce * sprite.scale.x;
                    const yReduce = reduce * sprite.scale.y;
                    for (let y = 0; y < dstTileY; ++y) {
                        for (let x = 0; x < dstTileX; ++x) {
                            const srcOffset = (sprite.$x + x * xReduce + xShift) + (sprite.$y + y * yReduce + yShift) * srcData.width;
                            const dstOffset = (x + mapX * dstTileX) + (y + mapY * dstTileY) * dstImageData.width;
                            const srcValue = srcData[srcOffset];
                            if ((srcValue >>> 12) > 7) { // Alpha test
                                dstData[dstOffset] =
                                    0xff000000 +
                                    (((srcValue & 0xf00) + ((srcValue & 0xf00) << 4)) << 8) +
                                    (((srcValue & 0xf0) + ((srcValue & 0xf0) << 4)) << 4) +
                                    (srcValue & 0xf) + ((srcValue & 0xf) << 4);
                            }
                        } // x
                    } // y
                } // sprite
            } // x
        } // y
    } // z

    // Draw dotted grid lines
    for (let mapX = 0; mapX < width; ++mapX) {
        const x = mapX * dstTileX;
        for (let y = 0; y < dstImageData.height; ++y) {
            dstData[x + y * dstImageData.width] = (y & 1) ? 0xffcccccc : 0xff777777
        }
    }

    for (let mapY = 0; mapY < height; ++mapY) {
        const y = mapY * dstTileY;
        for (let x = 0; x < dstImageData.width; ++x) {
            dstData[x + y * dstImageData.width] = (x & 1) ? 0xffcccccc : 0xff777777
        }
    }

    mapCtx.putImageData(dstImageData, 0, 0);
}

{
    const text = document.getElementById('newModeName');
    text.onkeydown = function (event) {
        if (event.keyCode === 13) {
            onNewModeCreate();
        } else if (event.keyCode === 27) {
            hideNewModeDialog();
        }
    }
}



/** Creates the left-hand project listing from the gameSource */
function createProjectWindow(gameSource) {
    let s = '';
    {
        const badge = isBuiltIn(gameSource.jsonURL) ? 'builtin' : (isRemote(gameSource.jsonURL) ? 'remote' : '');
        s += `<b title="${gameSource.extendedJSON.title} (${gameSource.jsonURL})" onclick="onProjectSelect(event.target, 'game', null)" class="clickable projectTitle ${badge}">${gameSource.extendedJSON.title}</b>`;
    }

    s += '<div style="border-left: 1px solid #ccc; margin-left: 4px; padding-top: 5px; padding-bottom: 9px; margin-bottom: -7px"><div style="margin:0; margin-left: -2px; padding:0">';

    s += '— <i>Scripts</i>\n';
    s += '<ul class="scripts">';
    for (let i = 0; i < gameSource.scripts.length; ++i) {
        const script = gameSource.scripts[i];
        if (! /\/console\/(os|launcher)\/_[A-Za-z0-9_]+\.pyxl$/.test(script)) {
            const badge = isBuiltIn(script) ? 'builtin' : (isRemote(script) ? 'remote' : '');
            const contextMenu = editableProject ? `oncontextmenu="showScriptContextMenu('${script}')" ` : '';
            s += `<li class="clickable ${badge}" ${contextMenu} onclick="onProjectSelect(event.target, 'script', '${script}')" title="${script}" id="ScriptItem_${script}">${urlFilename(script).replace('.pyxl', '')}</li>\n`;
        }
    }
    if (editableProject) {
        s += '<li class="clickable import" onclick="showImportScriptDialog()"><i>Import existing script…</i></li>';
        s += '<li class="clickable new" onclick="showNewScriptDialog()"><i>Create new script…</i></li>';
    }
    s += '</ul>';
    
    s += '— <i class="clickable" onclick="onProjectSelect(event.target, \'mode\', undefined)" title="View mode diagram">Modes</i>\n';
    s += '<ul class="modes">';
    for (let i = 0; i < gameSource.modes.length; ++i) {
        const mode = gameSource.modes[i];
        // Hide system modes
        if (/^.*\/_|^_|^\$/.test(mode.name)) { continue; }
        const badge = isBuiltIn(mode.url) ? 'builtin' : (isRemote(mode.url) ? 'remote' : '');
        const contextMenu = editableProject ? `oncontextmenu="showModeContextMenu(gameSource.modes[${i}])"` : '';
        s += `<li ${contextMenu} class="clickable ${badge}" onclick="onProjectSelect(event.target, 'mode', gameSource.modes[${i}])" title="${mode.url}" id="ModeItem_${mode.name}"><code>${mode.name}${mode.name === gameSource.json.start_mode ? '*' : ''}</code></li>\n`;
    }
    if (editableProject) {
        s += '<li class="clickable import" onclick="showImportModeDialog()"><i>Import existing mode…</i></li>';
        s += '<li class="clickable new" onclick="showNewModeDialog()"><i>Create new mode…</i></li>';
    }
    s += '</ul>';

    s += '— <i>Docs</i>\n';
    s += '<ul class="docs">';
    {
        for (let i = 0; i < gameSource.docs.length; ++i) {
            const doc = gameSource.docs[i];
            const badge = isBuiltIn(doc) ? 'builtin' : (isRemote(doc) ? 'remote' : '');
            const contextMenu = editableProject ? `oncontextmenu="showDocContextMenu('${doc}')" ` : '';
            s += `<li class="clickable ${badge}" ${contextMenu} id="DocItem_${doc}" onclick="onProjectSelect(event.target, 'doc', '${doc}')" title="${doc}"><code>${doc.replace(/^.*\//, '')}</code></li>\n`;
        }
    }
    if (editableProject) {
        s += '<li class="clickable import" onclick="showImportDocDialog()"><i>Import existing doc…</i></li>';
        s += '<li class="clickable new" onclick="showNewDocDialog()"><i>Create new doc…</i></li>';
    }
    s += '</ul>';
    
    s += '— <i class="clickable" onclick="onProjectSelect(event.target, \'constant\', undefined)" title="View all constants">Constants</i>\n';
    s += '<ul class="constants">';
    {
        const keys = Object.keys(gameSource.extendedJSON.constants || {});
        keys.sort();
        const badge = isBuiltIn(gameSource.jsonURL) ? 'builtin' : (isRemote(gameSource.jsonURL) ? 'remote' : '');
        for (let i = 0; i < keys.length; ++i) {
            const c = keys[i];
            const v = gameSource.constants[c];
            const json = gameSource.extendedJSON.constants[c];
            let tooltip = (json.description || '').replace(/"/g, '\\"');
            if (tooltip.length > 0) { tooltip = ': ' + tooltip; }
            
            const cssclass =
                  (v === undefined || v === null) ? 'nil' :
                  (json.type === 'table') ? 'table' :
                  (json.type === 'xy' || json.type === 'xz') ? 'vec2D' :
                  (json.type === 'xyz') ? 'vec3D' :
                  (json.type === 'rgba' || json.type === 'rgb' || json.type === 'hsva' || json.type === 'hsv') ? 'color' :
                  (json.type === 'reference') ? 'reference' :
                  (json.type === 'distribution') ? 'distribution' :
                  Array.isArray(v) ? 'array' :
                  (typeof v);

            const contextMenu = editableProject ? `oncontextmenu="showConstantContextMenu('${c}')"` : '';

            // Add and then pad with enough space to extend into the hidden scrollbar area
            s += `<li ${contextMenu} class="clickable ${badge} ${cssclass}" title="${c}${tooltip}" id="projectConstant_${c}" onclick="onProjectSelect(event.target, 'constant', '${c}')"><code>${c}</code>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</li>\n`;
        }
    }
    if (editableProject) {
        s += '<li class="clickable new" onclick="showNewConstantDialog()"><i>New constant…</i></li>';
    }
    s += '</ul>';

    s += '</div></div>';

    s += '<div style="margin-left: 3px; position: relative; top: -2px">— <i>Assets</i>\n';

    // Leave a lot of space at the bottom for the git buttons
    s += '<ul class="assets" style="margin-bottom: 36px">';
    {
        const keys = Object.keys(gameSource.assets);
        keys.sort();
        for (let i = 0; i < keys.length; ++i) {
            const assetName = keys[i];

            // Hide system assets
            if (assetName[0] === '$') { continue; }

            const asset = gameSource.assets[assetName];
            let type = asset.$jsonURL.match(/\.([^.]+)\.json$/i);
            if (type) { type = type[1].toLowerCase(); }

            const badge = isBuiltIn(asset.$jsonURL) ? 'builtin' : (isRemote(asset.$jsonURL) ? 'remote' : '');
                
            const contextMenu = editableProject ? `oncontextmenu="showAssetContextMenu('${assetName}')"` : '';
            s += `<li id="projectAsset_${assetName}" ${contextMenu} onclick="onProjectSelect(event.target, 'asset', gameSource.assets['${assetName}'])" class="clickable ${type} ${badge}" title="${assetName} (${asset.$jsonURL})"><code>${assetName}</code>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</li>`;

            if (type === 'map') {
                for (let k in asset.spritesheet_table) {
                    const badge = isBuiltIn(asset.spritesheet_table[k].$jsonURL) ? 'builtin' : (isRemote(asset.spritesheet_table[k].$jsonURL) ? 'remote' : '');
                    s += `<ul><li id="projectAsset_${assetName}.${k}" onclick="onProjectSelect(event.target, 'asset', gameSource.assets['${assetName}'].spritesheet_table['${k}'])" class="clickable sprite ${badge}" title="${k} (${asset.spritesheet_table[k].$jsonURL})"><code>${k}</code></li></ul>\n`;
                }
            }
        } // for each asset
    }
    
    if (editableProject) {
        s += '<li class="clickable import" onclick="showImportAssetDialog()"><i>Import existing asset…</i></li>';
        s += '<li class="clickable new" onclick="showNewAssetDialog()"><i>Create new asset…</i></li>';
    }
    s += '</ul>';
    s += '</div>'

    let versionControl = '';
    if (editableProject && serverConfig.hasGit) {
        // Will be hidden and shown elsewhere
        versionControl += `<div id="versionControl" style="visibility: hidden"><button style="width: 100%" title="Sync your local files with the git server" onclick="runPendingSaveCallbacksImmediately(); setTimeout(onGitSync);">Sync Git</button></div>`;
    }
    
    // Build the project list for the IDE
    const projectElement = document.getElementById('project');

    // Hide the scrollbars
    projectElement.innerHTML = `<div class="hideScrollBars" style="top: 0px; bottom: 40px; position: absolute; ${versionControl !== '' ? 'bottom: 40px' : ''}">` + s + '</div>' + versionControl;
}


function makeGoodFilename(text) {
    let filename = text.replace(/[ \n\t]/g, '_').replace(/[^A-Za-z0-9_+-]/g, '');

    const MAX_FILENAME_LENGTH = 50;
    if (filename.length > MAX_FILENAME_LENGTH) {
        // Break after an underscore
        let i = filename.indexOf('_', MAX_FILENAME_LENGTH * 0.85);
        if (i === -1) { i = MAX_FILENAME_LENGTH; }
        filename = filename.substring(0, i);
    }
    return filename.toLowerCase();
}

window.gameURL = '';

if (jsCode) {
    jsCode.getSession().setUseWorker(false);
    jsCode.getSession().setMode('ace/mode/javascript');
    jsCode.setReadOnly(true);
    jsCode.getSession().setUseWrapMode(true);
}

/* This image is only used for compositing and GIF recording. In the normal
   fast path, we draw directly to the screen Canvas and do not use this one. */
let updateImage = document.createElement('canvas');

// updateImageData.data is a Uint8Clamped RGBA buffer
let updateImageData;
let updateImageData32;

let error = document.getElementById('error');

function setFramebufferSize(w, h, privateScreen) {
    if (privateScreen === undefined) {
        privateScreen = PRIVATE_VIEW;
    }
    
    SCREEN_WIDTH = w;
    SCREEN_HEIGHT = h;
    PRIVATE_VIEW = privateScreen;
    emulatorScreen.width = w;
    emulatorScreen.height = h;
    overlayScreen.width = afterglowScreen.width = w;
    overlayScreen.height = afterglowScreen.height = h;
    /*
    // Performance test:
    overlayScreen.width = afterglowScreen.width = w / 2;
    overlayScreen.height = afterglowScreen.height = h / 2;
    overlayScreen.width = afterglowScreen.style.width = '384px';
    overlayScreen.height = afterglowScreen.style.height = '224px';
    */

    updateImage.width  = w;
    updateImage.height = h;
    updateImageData = ctx.createImageData(w, h);
    updateImageData32 = new Uint32Array(updateImageData.data.buffer);
    QRuntime.$updateImageData = updateImageData;
    QRuntime.$updateImageData32 = updateImageData32;

    bootScreen.style.fontSize = '' + Math.max(10 * SCREEN_WIDTH / 384, 4) + 'px';
    
    // The layout may need updating as well
    setTimeout(onResize, 0);
    setTimeout(onResize, 250);
    setTimeout(onResize, 1250);

    if (QRuntime && gameSource && gameSource.constants && (emulatorMode !== 'stop')) {
        QRuntime.$resize_framebuffer(SCREEN_WIDTH, SCREEN_HEIGHT);
    
        // Rebind the constants
        redefineScreenConstants();
    }

    if (isHosting) {
        notifyGuestsOfFramebufferSize();
    }

    onResize();
}


// Set by compilation
let programNumLines = 0;
let compiledProgram = '';

// 'stop', 'step', 'pause', 'play'. Slow mode = 'play' with targetFramerate slow
let emulatorMode = 'stop';

const PLAY_FRAMERATE = 60;
const SLOW_FRAMERATE = 8;
let targetFramerate = PLAY_FRAMERATE;

/** Returns non-false if the button whose name starts with ctrl is currently down. */
function pressed(ctrl) {
    const element = document.getElementById(ctrl + 'Button');
    console.assert(element, ctrl + 'Button element does not exist');
    return element.checked;
}

/** Sets the visible enabled state of the button whose name starts with ctrl to e */
function setControlEnable(ctrl, e) {
    var b = document.getElementById(ctrl + 'Button');
    if (b) { b.disabled = ! e; }

    var container = document.getElementById(ctrl + 'ButtonContainer');
    if (e) {
        container.classList.remove('disabled');
    } else {
        container.classList.add('disabled');
    }
}

/** Called by the IDE toggle buttons */
function onToggle(button) {
    const win = document.getElementById(button.id.replace('Button', 'Window'));
    if (win) {
        if (button.checked) { win.classList.remove('hidden'); }
        else                { win.classList.add('hidden'); }
    }
}


/** Called by the IDE radio buttons */
function onRadio() {
    // Controls
    if (pressed('play')) {
        onPlayButton();
    } else if (pressed('slow') && ((emulatorMode !== 'play') || (targetFramerate !== SLOW_FRAMERATE))) {
        onSlowButton();
    } else if (pressed('pause') && (emulatorMode === 'play')) {
        onPauseButton();
    } else if (pressed('stop') && (emulatorMode !== 'stop')) {
        onStopButton();
    } else if (pressed('step') && (emulatorMode !== 'step')) {
        onStepButton();
    }

    // UI Layout
    if (pressed('emulatorUI') && (uiMode !== 'Emulator')) {
        setUIMode('Emulator');
    } else if (pressed('testUI') && (uiMode !== 'Test')) {
        setUIMode('Test');
    } else if (pressed('IDEUI') && (uiMode !== 'IDE')) {
        setUIMode('IDE');
    } else if (pressed('wideIDEUI') && (uiMode !== 'WideIDE')) {
        setUIMode('WideIDE');
    } else if (pressed('maximalUI') && (uiMode !== 'Maximal')) {
        setUIMode('Maximal');
    } else if (! isMobile && pressed('windowedUI') && (uiMode !== 'Windowed')) {
        setUIMode('Windowed');
    } else if (pressed('editorUI') && (uiMode !== 'Editor')) {
        setUIMode('Editor');
    } else if (pressed('ghostUI') && (uiMode !== 'Ghost')) {
        setUIMode('Ghost');
    }

    saveIDEState();
}


///////////////////////////////////////////////////////////////////////////////////////////

let openGameFiles = null;
function showOpenGameDialog() {
    document.getElementById('openGameDialog').classList.remove('hidden');
    document.getElementById('openGameOpenButton').disabled = true;

    const gameListURL = location.origin + getQuadPath() + 'console/games.json';

    // Fetch the asset list
    LoadManager.fetchOne({forceReload: true}, gameListURL, 'json', null, function (json) {
        openGameFiles = json;
        if (! json.tests) {
            // Remove the alpha tester options
            let a = document.getElementById('openTestsOption');
            if (a) { a.remove(); }
            a = document.getElementById('openAlphaOption');
            if (a) { a.remove(); }
            if (json.mine && json.mine.length === 0) {
                // Select built-ins if I don't have any games
                document.getElementById('openGameType').value = 'builtins';
            }
        }

        // Sort by title
        for (const key in openGameFiles) {
            const array = openGameFiles[key];
            array.sort(titleComparator);
        }
        
        // Show/hide the mine option depending on whether it is populated
        document.getElementById('openMineOption').style.display = (json.mine && json.mine.length > 0) ? '' : 'none';
        onOpenGameTypeChange();
    });
}


/* Sort comparator appropriate for game titles */
function titleComparator(A, B) {
    const a = A.title.toLowerCase().replace(/^(a|the) /, '');
    const b = B.title.toLowerCase().replace(/^(a|the) /, '');
    return a.localeCompare(b);
}


function onOpenGameFilterChange() {
    const filter = document.getElementById('openGameFilter').value.trim().toLowerCase();
    const list = document.querySelectorAll('#openGameListOL li');
    for (let i = 0; i < list.length; ++i) {
        const element = list[i];
        element.style.display = (filter === '') || (element.innerText.toLowerCase().indexOf(filter) !== -1) ? '' : 'none';
    }

    openGameFiles.selected = null;
}

/* Called to regenerate the openGameList display for the add asset dialog
   when the type of game to be loaded is changed by the user. Also called
   for generating the initial list.*/
function onOpenGameTypeChange() {
    const t = document.getElementById('openGameType').value;
    let s = '<ol id="openGameListOL" class="select-list" style="font-family: Helvetica, Arial; font-size: 120%; white-space: normal">\n';
    if (openGameFiles) {
        const fileArray = openGameFiles[t];
        for (let i = 0; i < fileArray.length; ++i) {
            const game = fileArray[i];

            // Replace quad:// with a proper URL for HTML
            let label_path = game.url.replace('quad://', location.origin + getQuadPath());

            // Remove the game.json file
            label_path = label_path.replace(/\/[^/]+\.game\.json$/, '/');
            label_path += 'label64.png';
            
            s += `<li ondblclick="onOpenGameOpen()" onclick="onOpenGameListSelect(this, '${game.url}')" class="unselectable" title="${game.url}">
<table><tr><td><img src="${label_path}" width=48 height=48 style="margin-right: 10px"></td><td>${game.title}<br/><span style="font-size:70%; font-style:italic">${game.description}</span></td></tr></table></li>\n`;
        }
    }
    s += '</ol>';

    const list = document.getElementById('openGameList');
    list.innerHTML = s;

    openGameFiles.selected = null;

    onOpenGameFilterChange();
    
    // Recreating the list destroys any selection
    document.getElementById('openGameOpenButton').disabled = true;
}


/* Called from the "Open" button */
function onOpenGameOpen() {
    onStopButton();
    saveIDEState();
    const autoplay = document.getElementById('autoplayOnLoad').checked;
    const newWindow = document.getElementById('newWindowOnLoad').checked;

    const game_url = openGameFiles.selected;
    
    let url = page.location.href.replace(/(\?(?:.+&)?)game=[^&]+(?=&|$)/, '$1');
    if (url.indexOf('?') === -1) { url += '?'; }
    if (url[url.length - 1] !== '&') { url += '&'; }
    url = url.replace(/autoplay=./g, '');
    url = url.replace(/&&/g, '&');
    url += 'game=' + game_url;
    
    if (autoplay) { url += '&autoplay=1'; }
    
    if (newWindow) {
        hideOpenGameDialog();
        window.open(url, '_blank');
    } else {
        // Update the URL so that reload and bookmarking work
        page.history.replaceState({}, 'quadplay', url);
        if (window !== page) {
            // Also replace the internal window URL so that updating reloads correctly
            history.replaceState({}, 'quadplay', url.replace('app.html', 'quadplay.html'));
        }
            
        loadGameIntoIDE(game_url, function () {
            hideOpenGameDialog();
            onProjectSelect(document.getElementsByClassName('projectTitle')[0], 'game');

            if (autoplay) {
                onPlayButton(false, true);
            }
        });
    } // if new window
}


function onOpenGameListSelect(target, url) {
    const list = document.getElementById('openGameListOL');
    for (let i = 0; i < list.children.length; ++i) {
        list.children[i].classList.remove('selected');
    }
    target.classList.add('selected');
    openGameFiles.selected = url; 
    document.getElementById('openGameOpenButton').disabled = false;
}


function hideOpenGameDialog() {
    saveIDEState();
    document.getElementById('openGameDialog').classList.add('hidden');
    openGameFiles = null;
}

/**********************************************************************************/

/* Optional location = { line_number, url, fcn } used for creating hyperlinks and displaying output */
function setErrorStatus(e, location) {
    e = escapeHTMLEntities(e);

    if (location) {
        if (location.line_number !== undefined) {
            e = `${location.fcn ? location.fcn + ' at ' : ''}<a style="font-family: Arial; cursor:pointer">${shortURL(location.url)}:${location.line_number}</a>: ${e}`;
        } else if (location.url) {
            e = `${location.fcn ? location.fcn + ' at ' : ''}${shortURL(location.url)}: ${e}`;
        } else if (location.fcn) {
            e = location.fcn + ': ' + e;
        }
    }
    
    error.innerHTML = e;
    if (e !== '') {
        $outputAppend(`\n<span style="color:#f55">${e}<span>\n`, location, location !== undefined);
        document.getElementById('outputTab').checked = true;
    }
}


setControlEnable('pause', false);
let coroutine = null;
let emwaFrameTime = 0;
const debugFrameRateDisplay = document.getElementById('debugFrameRateDisplay');
const debugGraphicsFPS = document.getElementById('debugGraphicsFPS');
const debugActualFrameRateDisplay = document.getElementById('debugActualFrameRateDisplay');
const debugFramePeriodDisplay = document.getElementById('debugFramePeriodDisplay');
const debugDrawCallsDisplay = document.getElementById('debugDrawCallsDisplay');
const debugModeDisplay = document.getElementById('debugModeDisplay');
const debugPreviousModeDisplay = document.getElementById('debugPreviousModeDisplay');
const debugModeFramesDisplay = document.getElementById('debugModeFramesDisplay');
const debugGameFramesDisplay = document.getElementById('debugGameFramesDisplay');
const outputPane = document.getElementById('outputPane');
const outputDisplayPane = document.getElementById('outputDisplayPane');


/** 
    Given a JavaScript runtime error, compute the corresponding PyxlScript error by
    parsing the @ pragmas in the compiledProgram code.
 */
function jsToPSError(error) {
    function functionName(str) {
        
        // Remove @ suffixes from post-2021 Safari
        if (str.endsWith('@')) { str = str.substring(0, str.length - 1); }

        str = str.trim();

        if (str === 'anonymous' || str === 'eval') { str = '?'; }
        if (str !== '' && str !== '?') { str += '()'; }
        
        return str;
    }

    let lineNumber = error.lineNumber;
    let resultFcn = '?';
    let resultStack = [];

    const lineArray = compiledProgram.split('\n');
    
    // Find the first place in the user program that the problem
    // occurred.
    if (error.stack) {
        const stack = error.stack.split('\n');
        if (stack.length > 0) {
            if (isSafari) {
                // Safari doesn't give line numbers inside generated
                // code except for the top of the stack.
                for (let i = 0; i < stack.length; ++i) {
                    if (stack[i].indexOf('quadplay-runtime-') === -1) {
                        // This is the beginning of the user call stack
                        lineNumber = QRuntime.$currentLineNumber + 2;

                        let first = true;
                        while ((i < stack.length) &&
                               stack[i] !== '' &&
                               stack[i] !== 'anonymous' &&
                               stack[i].indexOf('[native') === -1) {

                            if (stack[i].indexOf('quadplay_main_loop') !== -1) {
                                resultStack.push({fcn: 'frame event'});
                                break; // while
                            } else if (first) {
                                resultFcn = functionName(stack[i]);
                                first = false;
                            } else {
                                resultStack.push({fcn: functionName(stack[i])});
                            }
                            ++i;
                        }
                        break;
                    }
                }
            } else { // not Safari

                // Entry 0 in the "stack" is actually the error message on Chromium
                // browsers, so remove it
                if (isEdge || isChrome) { stack.shift(); }

                // Search for the first user-space error
                for (let i = 0; i < stack.length; ++i) {
                    const match = stack[i].match(/(?:Function|<anonymous>):(\d+):/);

                    if (match) {
                        // Found a user-space error
                        lineNumber = parseInt(match[1]);

                        // Parse the function name
                        resultFcn = stack[i].match(/^(?:[ \t]*(?:at[ \t]+)?)([^\.\n \n\(\):@\/]+)/);
                        resultFcn = resultFcn ? functionName(resultFcn[1]) : '?';

                        // Read from here until the bottom of the user stack
                        ++i;
                        while (i < stack.length) {
                            const match = stack[i].match(/(?:Function|<anonymous>):(\d+):/);
                            if (! match) { break; }

                            // Parse the function name
                            let fcn = stack[i].match(/^(?:[ \t]*(?:at[ \t]+)?)([^\.\n \n\(\):@\/]+)/);
                            fcn = fcn ? fcn[1] : '?';
                            let done = false;

                            if (fcn === 'anonymous') {
                                fcn = '?';
                                done = true;
                            } else if (stack[i].indexOf('quadplay_main_loop') !== -1) {
                                fcn = 'frame event';
                                done = true;
                            } else if (fcn === 'eval') {
                                break;
                            } else {
                                fcn = functionName(fcn);
                            }

                            // Convert line numbers
                            const stackEntry = jsToPyxlLineNumber(parseInt(match[1]), lineArray);

                            resultStack.push({url: stackEntry.url, lineNumber: stackEntry.lineNumber, fcn: fcn});
                            if (done) { break; }
                            ++i;
                        }
                        
                        break;
                    }
                } // for stack frame
            } // if Safari
        } // if the stack trace is non-empty
    } // if there is a stack trace

    if (! lineNumber && error.lineNumber) {
        // Safari
        lineNumber = error.lineNumber + 1;
    }
    
    if (! lineNumber && error.stack) {
        // Chrome
        const match = error.stack.match(/Function|<anonymous>:(\d+)/);
        if (match) {
            lineNumber = clamp(1, parseInt(match[1]), programNumLines);
        }
    }

    if ((error.stack &&
        (error.stack.indexOf('<anonymous>') === -1) &&
         (error.stack.indexOf('Function') === -1) &&
         (error.stack.indexOf('quadplay-runtime-') !== -1)) ||
        ! lineNumber) {
        return {url:'(?)', lineNumber: '(?)', message: '' + error, stack: resultStack, fcn: resultFcn};
    }

    const result = jsToPyxlLineNumber(lineNumber, lineArray);

    
    // Modify event names to include the mode
    if (resultFcn[0] === '$') {
        resultFcn = shortURL(result.url).replace(/\..*/, '.') + resultFcn.substring(1);
    }

    return {
        url: result.url,
        lineNumber: result.lineNumber,
        fcn: resultFcn,
        message: error.message.replace(/\bundefined\b/g, 'nil').replace(/&&/g, 'and').replace(/\|\|/g, 'or').replace(/===/g, '==').replace(/!==/g, '!='),
        stack: resultStack
    };
}


/* Returns {url: string, lineNumber: number}. Used for translating error messages. */
function jsToPyxlLineNumber(lineNumber, lineArray) {
    // If the line array was not precomputed
    lineArray = lineArray || compiledProgram.split('\n');

    // Look backwards from error.lineNumber for '/*@"'
    let urlLineIndex, urlCharIndex = -1;

    for (urlLineIndex = Math.min(Math.max(0, lineNumber - 1), lineArray.length - 1); (urlLineIndex >= 0) && (urlCharIndex === -1); --urlLineIndex) {
        urlCharIndex = lineArray[urlLineIndex].indexOf('/*ට"');
    }

    // Always overshoots by one
    ++urlLineIndex;

    const result = parseCompilerLineDirective(lineArray[urlLineIndex]);

    return {url: result.url, lineNumber: lineNumber - urlLineIndex - 3 + result.lineNumber};
}


function updateTimeDisplay(time, name) {
    const td = document.getElementById('debug' + name + 'TimeDisplay');
    const tp = document.getElementById('debug' + name + 'PercentDisplay');

    if (time >= 16.667) {
        // Overtime
        td.style.color = tp.style.color = '#f30';
    } else if (time >= 15.5) {
        // Warning
        td.style.color = tp.style.color = '#fe4';
    } else {
        td.style.color = tp.style.color = 'unset';
    }

    td.innerHTML = '' + time.toFixed(1) + '&#8239;ms';
    tp.innerHTML = '(' + Math.round(time * 6) + '%)';
}


function goToLauncher() {
    onStopButton(false, true);
    console.log('Loading to go to the launcher.');
    loadGameIntoIDE(launcherURL, function () {
        onResize();
        // Prevent the boot animation
        onPlayButton(false, true);
    }, true);
}


function onCopyPerformanceSummary() {
    let summary = `Framerate ${debugFrameRateDisplay.textContent} ${debugFramePeriodDisplay.textContent}; `;
    summary += `${debugFrameTimeDisplay.textContent} Total = ${debugCPUTimeDisplay.textContent} CPU + ${debugGPUTimeDisplay.textContent} GPU + ${debugPPUTimeDisplay.textContent} Phys + ${debugBrowserTimeDisplay.textContent} ${browserName}`;
    navigator.clipboard.writeText(summary);
}


// Reset the touch input state for next frame
function resetTouchInput() {
    if (mouse.movement_x !== undefined) {
        mouse.movement_x = mouse.movement_y = 0;
    }
    QRuntime.touch.pressed_a = QRuntime.touch.released_a = QRuntime.touch.aa = 0;
}

// Invoked by requestAnimationFrame() or setTimeout. 
function mainLoopStep() {
    // Keep the callback chain going
    if (emulatorMode === 'play') {
        if (autoSleepEnabled && (Date.now() - lastInteractionTime > IDLE_PAUSE_TIME_MILLISECONDS)) {
            sleep();
            return;
        }
        
        // We intentionally don't use requestAnimationFrame. It can go
        // above 60 Hz and require explicit throttling on high-refresh
        // displays. And when the game is falling below frame rate, we
        // don't trust requestAnimationFrame to reliably hit our
        // fractions of 60 Hz. Schedule the next step at the *start* of this
        // one, so that the time for processing the step does not create a
        // delay.
        //
        // Do not account for QRuntime.$graphicsPeriod here. Always
        // try to run at 60 Hz for input processing and game
        // execution, and drop graphics processing in QRuntime.$show()
        // some of the time.
        //
        // setInterval seems to be slightly faster than setTimeout on
        // Chromium, which costs >5% of the total frame time in call
        // according to the browser profiler.
        
        const interval = Math.floor(1000 / targetFramerate - 1);
        if (interval !== lastAnimationInterval) {
            // New interval
            clearInterval(lastAnimationRequest);
            lastAnimationRequest = setInterval(mainLoopStep, interval);
            lastAnimationInterval = interval;
        }
    }

    // Physics time may be spread over multiple QRuntime.physics_simulate() calls,
    // but graphics is always a single QRuntime.$show() call. Graphics time may
    // be zero on any individual call.
    QRuntime.$physicsTimeTotal = 0;
    QRuntime.$graphicsTime = 0;
    QRuntime.$missedFrames = 0;
    QRuntime.$logicToGraphicsTimeShift = 0;

    // Run the "infinite" loop for a while, maxing out at just under 1/60 of a second or when
    // the program explicitly requests a refresh or keyboard update via $show(). Note that
    // refreshPending may already be false if running with $graphicsPeriod > 1, but it does
    // no harm to set it back to false in that case.
    refreshPending = false;
    updateKeyboardPending = false;
    midiBeforeFrame();

    profiler.startFrame();
    // Run until the end of the game's natural main loop excution, the
    // game invokes QRuntime.$show(), or the user ends the
    // program. The game may suppress its own graphics computation
    // inside QRuntime.$show() if it is running too slowly.
    try {
        const frameStart = profiler.now();
        
        // 10 fps failsafe for code that is returning but not invoking
        // $submitFrame() somehow.
        const endTime = frameStart + 100;

        while (! updateKeyboardPending && ! refreshPending && (performance.now() < endTime) && (emulatorMode === 'play' || emulatorMode === 'step') && coroutine) {
            // Time interval at which to check for new **gamepad**
            // input; won't be able to process keyboard input since
            // that requires events, which requires going out to the
            // main JavaScript loop.
            const gamepadSampleTime = performance.now() + 1000 / 60;
            updateInput();
            while (! updateKeyboardPending && ! refreshPending && (performance.now() < gamepadSampleTime) && (emulatorMode === 'play' || emulatorMode === 'step') && coroutine) {
                coroutine();
            }
        }

        // Based on events, so has to happen outside of the loop. 
        if (refreshPending || updateKeyboardPending) {
            resetTouchInput();
        }

    } catch (e) {
        if (e.reset_game === 1) {
            // Automatic
            onStopButton(true);
            restartProgram(BOOT_ANIMATION.NONE);
            return;
        } else if (e.quit_game === 1) {
            if (useIDE) {
                // Ignore the quit setting and always stop when in the IDE
                onStopButton();
            } else switch (quitAction) {
                case 'none': {
                    console.log('Ignoring quit_game() received when quit=none');
                    return;
                }
                
                case 'close': {
                    // JavaScript can't close a tab unless JavaScript opened it
                    // to begin with, so this is the best that we can do outside
                    // of a standalone binary.
                    try { page.close(); } catch (ignore) {}
                    try { window.close(); } catch (ignore) {}
                    try { document.exitFullscreen(); } catch (ignore) {}
                    window.location = 'about:blank';
                    return;
                }
                
                case 'reload': {
                    inPageReload = true;
                    try { document.exitFullscreen(); } catch (ignore) {}
                    location = location;
                    return;
                }
                
                default:// 'launcher'
                    goToLauncher();
            }
        } else if (e.launch_game !== undefined) {
            console.log('Loading because launch_game() was called.');
            loadGameIntoIDE(e.launch_game, function () {
                onResize();
                onPlayButton(false, true, e.args);
            });
        } else {
            // Runtime error
            onError(e);
        }
    }

    // The frame has ended
    if (! previewRecording) {
        // Only adjust framerate if not preview recording
        profiler.endFrame(QRuntime.$physicsTimeTotal, QRuntime.$graphicsTime, QRuntime.$logicToGraphicsTimeShift, QRuntime.$missedFrames);
    }
    midiAfterFrame();
   
    // Only update the profiler display periodically, because doing so
    // takes about 2ms of frame time on a midrange modern computer.
    if (useIDE && (((QRuntime.mode_frames - 1) % (8 * QRuntime.$graphicsPeriod) === 0) ||
         (targetFramerate < PLAY_FRAMERATE) ||
         (emulatorMode === 'step'))) {

        const showHTML = (uiMode === 'Test') || (uiMode === 'IDE') || (uiMode === 'WideIDE');
        updateDebugger(showHTML);
    }
    
    if (targetFramerate < PLAY_FRAMERATE || emulatorMode === 'step') {
        // Force the profiler to avoid resetting the
        // graphics rate when in slow mode.
        profiler.reset();
    }

    // Update to the profiler's new model of the graphics period
    QRuntime.$graphicsPeriod = profiler.graphicsPeriod;
    QRuntime.$skipGraphics = (QRuntime.mode_frames % QRuntime.$graphicsPeriod) !== 0;
    
    if (emulatorMode === 'step') {
        onPauseButton();
    }
}


// Used when the on-screen profiler is enabled
const onScreenHUDDisplay = {time: {frame:0, logic:0, physics:0, graphics:0, gpu: 0, browser:0, refresh:0}};

function updateDebugger(showHTML) {
    const frame = profiler.smoothFrameTime.get();
    const logic = profiler.smoothLogicTime.get();
    const physics = profiler.smoothPhysicsTime.get();

    // Show the time that GPU graphics is actually taking
    // per frame it processes, with no scaling.
    const gpu = profiler.smoothGPUTime.get();
    
    // Show the time that CPU graphics *would* be taking if
    // it wasn't for the frame rate scaler
    const graphics = profiler.smoothGraphicsTime.get() * QRuntime.$graphicsPeriod;
    const compute = logic + physics + graphics;
    const browser = Math.max(0, frame - compute);
    
    // Use 18 instead of 16.67 ms as the cutoff for displaying
    // overhead because there are sometimes very slight roundoffs
    // due to the timer callback being inexact.
    
    onScreenHUDDisplay.time.frame = (frame > 18) ? frame : compute;
    onScreenHUDDisplay.time.browser = (frame > 17.2) ? browser : 0;
    onScreenHUDDisplay.time.logic = logic;
    onScreenHUDDisplay.time.physics = physics;
    onScreenHUDDisplay.time.graphics = graphics;
    onScreenHUDDisplay.time.gpu = gpu;
    onScreenHUDDisplay.time.refresh = Math.round(60 / QRuntime.$graphicsPeriod);

    if (! showHTML) {
        // Only update the on-screen profiler values
        return;
    }
    
    updateTimeDisplay(onScreenHUDDisplay.time.frame, 'Frame');
    updateTimeDisplay(onScreenHUDDisplay.time.browser, 'Browser');
    updateTimeDisplay(logic, 'Logic');
    updateTimeDisplay(physics, 'Physics');
    updateTimeDisplay(graphics, 'Gfx');

    if ($THREADED_GPU) { updateTimeDisplay(gpu, 'GPU'); }

    if (profiler.debuggingProfiler) { updateTimeDisplay(frame, 'Interval'); }

    let color = 'unset';
    if (QRuntime.$graphicsPeriod === 2) {
        color = '#fe4';
    } else if (QRuntime.$graphicsPeriod > 2) {
        color = '#f30';
    }

    debugFrameRateDisplay.style.color = debugFramePeriodDisplay.style.color = color;
    const fps = '' + Math.round(60 / QRuntime.$graphicsPeriod);
    debugFrameRateDisplay.innerHTML = fps + '&#8239;Hz';
    debugGraphicsFPS.innerHTML = fps;
    debugFramePeriodDisplay.innerHTML = '(' + ('1½⅓¼⅕⅙'[QRuntime.$graphicsPeriod - 1]) + '×)';
    
    // Only display if the graphics period has just ended, otherwise the display would
    // be zero most of the time
    if (window.QRuntime && QRuntime.$previousGraphicsCommandList) {
        debugDrawCallsDisplay.innerHTML = '' + QRuntime.$previousGraphicsCommandList.length;
    }
    
    // console.log(QRuntime.game_frames, debugWatchEnabled.checked, emulatorMode, debugWatchTable.changed);
    if ((QRuntime.game_frames === 0 || debugWatchEnabled.checked) && ((emulatorMode === 'play') || debugWatchTable.changed)) {
        updateDebugWatchDisplay();
    }

    if (QRuntime.$gameMode) {
        if (QRuntime.$modeStack.length) {
            let s = '';
            for (let i = 0; i < QRuntime.$modeStack.length; ++i) {
                s += QRuntime.$modeStack[i].$name + ' → ';
            }
            debugModeDisplay.innerHTML = s + QRuntime.$gameMode.$name;
        } else {
            debugModeDisplay.innerHTML = QRuntime.$gameMode.$name;
        }
    } else {
        debugModeDisplay.innerHTML = '∅';
    }
    
    if (QRuntime.$prevMode) {
        debugPreviousModeDisplay.innerHTML = QRuntime.$prevMode.$name;
    } else {
        debugPreviousModeDisplay.innerHTML = '∅';
    }
    
    debugModeFramesDisplay.innerHTML = '' + QRuntime.mode_frames;
    debugGameFramesDisplay.innerHTML = '' + QRuntime.game_frames;
}


/* Print only the filename base when it is the same as the game base */
function shortURL(url) {
    const gamePath = gameSource.jsonURL.replace(/\/[^/]+\.game\.json$/, '/');
    if (url.startsWith(gamePath)) {
        return url.substring(gamePath.length);
    } else {
        return url;
    }
}


/** When true, the system is waiting for a refresh to occur and mainLoopStep should yield
    as soon as possible. */
let refreshPending = false;
let updateKeyboardPending = false;

function reloadRuntime(oncomplete) {
    runtime_cursor = 'crosshair';
    QRuntime.document.open();
    
    let src = `<!DOCTYPE html><script>var $THREADED_GPU = ${$THREADED_GPU};</script>\n`;
    for (const script of ['cpu', $THREADED_GPU ? false : 'gpu', 'physics', 'ai', 'common']) {
        if (script) {
            src += `<script src='quadplay-runtime-${script}.js'></script>\n`;
        }
    }
    QRuntime.document.write(src);
    
    QRuntime.onload = function () {
        QRuntime.$resize_framebuffer(SCREEN_WIDTH, SCREEN_HEIGHT);
        QRuntime.reset_clip();

        // Initialize the virtual GPU memory
        QRuntime.$set_texture(spritesheetArray, fontArray);
        QRuntime.$quit_action = quitAction;

        // Remove any base URL that appears to include the quadplay URL
        QRuntime.$window = window;
        QRuntime.$gameURL = gameSource ? (gameSource.jsonURL || '').replace(location.href.replace(/\?.*/, ''), '') : '';
        QRuntime.$debugPrintEnabled  = document.getElementById('debugPrintEnabled').checked && useIDE;
        QRuntime.$assertEnabled      = document.getElementById('assertEnabled').checked && useIDE;
        QRuntime.$todoEnabled        = document.getElementById('todoEnabled').checked && useIDE;
        QRuntime.$debugWatchEnabled  = document.getElementById('debugWatchEnabled').checked && useIDE;
        QRuntime.$showEntityBoundsEnabled = document.getElementById('showEntityBoundsEnabled').checked && useIDE;
        QRuntime.$showPhysicsEnabled = document.getElementById('showPhysicsEnabled').checked && useIDE;
        QRuntime.$onScreenHUDEnabled = document.getElementById('onScreenHUDEnabled').checked && useIDE;
        QRuntime.$debug_watch        = debug_watch;
        QRuntime.$debug_print        = debug_print;
        QRuntime.assert              = assert;
        QRuntime.$parse              = $parse;
        QRuntime.$submitFrame        = submitFrame;
        QRuntime.$requestInput       = requestInput;
        QRuntime.$updateInput        = updateInput;
        QRuntime.$resetTouchInput    = resetTouchInput;
        QRuntime.$systemPrint        = $systemPrint;
        QRuntime.$parseHexColor      = parseHexColor;
        QRuntime.$Physics            = Matter;
        QRuntime.$updateHostCodeCopyRuntimeDialogVisiblity = updateHostCodeCopyRuntimeDialogVisiblity;
        QRuntime.$fontMap            = fontMap;
        QRuntime.$onScreenHUDDisplay = onScreenHUDDisplay;

        QRuntime.$pauseAllSounds     = pauseAllSounds;
        QRuntime.$resumeAllSounds    = resumeAllSounds;
        QRuntime.makeEuroSmoothValue = makeEuroSmoothValue;
        QRuntime.$navigator          = navigator;
        QRuntime.$version            = version;
        QRuntime.$prompt             = prompt;
        QRuntime.$setFramebufferSize = setFramebufferSize;
        QRuntime.$escapeHTMLEntities = escapeHTMLEntities;
        QRuntime.$sleep              = useIDE ? null : sleep;
        QRuntime.disconnect_guest    = disconnectGuest;
        QRuntime.$notifyGuestsOfPostEffects = notifyGuestsOfPostEffects;
        QRuntime.$resetEmulatorKeyState = resetEmulatorKeyState;
        QRuntime.$computeQRCode = computeQRCode;
        QRuntime.$Object.prototype.toString = function () {
            return (this && this.$name) || QRuntime.unparse(this);
        };

        if (isQuadserver) {
            // Persist to disk
            // TODO: implement persistence
            QRuntime.$getLocalStorage    = function (key) { return localStorage.getItem(key); };
            QRuntime.$setLocalStorage    = function (key, value) { return localStorage.setItem(key, value); };
        } else {
            QRuntime.$getLocalStorage    = function (key) { return localStorage.getItem(key); };
            QRuntime.$setLocalStorage    = function (key, value) { return localStorage.setItem(key, value); };
        }

        // For use by the online component
        QRuntime.$wordsToNetID       = wordsToNetID;
        QRuntime.$netIDToWords       = netIDToWords;
        QRuntime.$netIDToSentence    = netIDToSentence;
        QRuntime.$netIDToString      = netIDToString;
        QRuntime.$changeMyHostNetID  = changeMyHostNetID;
        QRuntime.$setMyOnlineName    = setMyOnlineName;
        QRuntime.start_hosting       = $start_hosting;
        QRuntime.stop_hosting        = stopHosting;
        QRuntime.$startGuesting      = startGuesting;
        QRuntime.$getIsOffline       = getIsOffline;
        QRuntime.$NET_ID_WORD_TABLE  = NET_ID_WORD_TABLE;
        QRuntime.$showPopupMessage   = showPopupMessage;
        QRuntime.$setRuntimeDialogVisible   = setRuntimeDialogVisible;

        // Map the global midi object as read-only
        Object.defineProperty(QRuntime, 'midi', {value: midi, writable: false});

        // For use by the controller remapping
        QRuntime.$localStorage       = localStorage;
        QRuntime.$getIdealGamepads   = getIdealGamepads;
        QRuntime.$setGamepadOrderMap = setGamepadOrderMap;

        // Accessors for touch and gamepads
        const padXGetter = {
            enumerable: true,
            get: function () {
                return this.$x * QRuntime.$scaleX;
            }
        };

        const dxGetter = {
            enumerable: true,
            get: function () {
                return this.$dx * QRuntime.$scaleX;
            }
        };
        
        const padXXGetter = {
            enumerable: true,
            get: function () {
                return this.$xx * QRuntime.$scaleX;
            }
        };
        
        const padYGetter = {
            enumerable: true,
            get: function () {
                return this.$y * QRuntime.$scaleY;
            }
        };
        
        const dyGetter = {
            enumerable: true,
            get: function () {
                return this.$dy * QRuntime.$scaleY;
            }
        };
        
        const padYYGetter = {
            enumerable: true,
            get: function () {
                return this.$yy * QRuntime.$scaleY;
            }
        };
        
        const xyGetter = {
            enumerable: true,
            get: function () {
                return {x: this.x, y: this.y}
            }
        };
        
        const hoverGetter = {
            enumerable: true,
            get: function () {
                if (mouse.movement_x || (mouse.screen_x !== mouse.screen_x_prev) ||
                    mouse.movement_y || (mouse.screen_y !== mouse.screen_y_prev)) {
                    return {
                        x: (mouse.screen_x - QRuntime.$offsetX) / QRuntime.$scaleX,
                        y: (mouse.screen_y - QRuntime.$offsetY) / QRuntime.$scaleY
                    };
                } else {
                    return undefined;
                }
            }
        };

        const dxyGetter = {
            enumerable: true,
            get: function () {
                return {x: this.dx, y: this.dy}
            }
        };

        const angleGetter = {
            enumerable: true,
            get: function () {
                let a = (this.$angle * QRuntime.$scaleY + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
                if (Math.abs(a + Math.PI) < 1e-10) { a = Math.PI; }
                return a;
            }
        };

        const dangleGetter = {
            enumerable: true,
            get: function () {
                let a = (this.$dangle * QRuntime.$scaleY + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
                if (Math.abs(a + Math.PI) < 1e-10) { a = Math.PI; }
                return a;
            }
        };

        const statusGetter = {
            enumerable: true,
            get: function() { return this.$status; }
        };


        function $bind_gamepad_getters(pad) {
            Object.defineProperty(pad, 'x', padXGetter);
            Object.defineProperty(pad, 'dx', dxGetter);
            Object.defineProperty(pad, 'xx', padXXGetter);
            Object.defineProperty(pad, 'y', padYGetter);
            Object.defineProperty(pad, 'dy', dyGetter);
            Object.defineProperty(pad, 'yy', padYYGetter);
            Object.defineProperty(pad, 'xy', xyGetter);
            Object.defineProperty(pad, 'dxy', dxyGetter);
            Object.defineProperty(pad, 'angle', angleGetter);
            Object.defineProperty(pad, 'dangle', dangleGetter);
            Object.defineProperty(pad, 'status', statusGetter);
        }

        QRuntime.touch = {
            screen_x: 0,
            screen_y: 0,
            screen_dx: 0,
            screen_dy: 0,
            a: 0,
            pressed_a: 0,
            aa: 0,
            released_a: 0
        };

        // Intentional error property to avoid typos
        Object.defineProperty(QRuntime.touch, 'a_pressed', {get: function () { throw 'No touch.a_pressed property exists. Use touch.pressed_a'; }});
        Object.defineProperty(QRuntime.touch, 'a_released', {get: function () { throw 'No touch.a_released property exists. Use touch.released_a'; }});
        Object.defineProperty(QRuntime.touch, 'xy', xyGetter);
        Object.defineProperty(QRuntime.touch, 'dxy', dxyGetter);
        Object.defineProperty(QRuntime.touch, 'x', {
            enumerable: true,
            get: function () {
                return (this.screen_x - QRuntime.$offsetX) / QRuntime.$scaleX;
            }
        });
        Object.defineProperty(QRuntime.touch, 'y', {
            enumerable: true,
            get: function () {
                return (this.screen_y - QRuntime.$offsetY) / QRuntime.$scaleY;
            }
        });
        Object.defineProperty(QRuntime.touch, 'dx', {
            enumerable: true,
            get: function () {
                return this.screen_dx / QRuntime.$scaleX;
            }
        });
        Object.defineProperty(QRuntime.touch, 'dy', {
            enumerable: true,
            get: function () {
                return this.screen_dy / QRuntime.$scaleY;
            }
        });
        Object.defineProperty(QRuntime.touch, 'screen_xy', {
            enumerable: true,
            get: function () {
                return {x: this.screen_x, y: this.screen_y}
            }
        });
        Object.defineProperty(QRuntime.touch, 'screen_dxy', {
            enumerable: true,
            get: function () {
                return {x: this.screen_dx, y: this.screen_dy}
            }
        });
        Object.defineProperty(QRuntime.touch, 'hover', hoverGetter);
        Object.seal(QRuntime.touch);
        
        QRuntime.gamepad_array = Object.seal([0,0,0,0]);
        const COLOR_ARRAY = ['f5a', '0af', 'ed3', '4e4'];

        for (let p = 0; p < 4; ++p) {
            const type = 'Quadplay';

            // These will be overridden immediately on the first call to updateInput()
            // if the id of the underlying device has changed.
            let controlBindings = JSON.parse(localStorage.getItem('pad0' + p) || 'null');
            if (! controlBindings) {
                controlBindings = {id: isMobile ? 'mobile' : '', type: defaultControlType(p)};
            }

            const player_color = parseHexColor(COLOR_ARRAY[p]);
            const pad = {
                // Set on connection
                $guest_name: '',

                $status: 'absent',

                // Set from network updates
                $guest_latest_state: null,
                
                $x: 0, $dx: 0, $xx: 0,
                $y: 0, $dy: 0, $yy: 0,
                $angle:0, $dangle:0,
                a:0, b:0, c:0, d:0, e:0, f:0, $p:0, q:0,
                aa:0, bb:0, cc:0, dd:0, ee:0, ff:0, $pp:0, qq:0,
                pressed_a:0, pressed_b:0, pressed_c:0, pressed_d:0, pressed_e: 0, pressed_f:0, $pressed_p:0, pressed_q:0,
                released_a:0, released_b:0, released_c:0, released_d:0, released_e:0, released_f:0, $released_p:0, released_q:0,
                index: p,
                player_color: Object.freeze({r:player_color.r, g:player_color.g, b:player_color.b}),
                type: controlBindings.type,
                prompt: Object.freeze(Object.assign({'##': '' + (p + 1)}, controlSchemeTable[controlBindings.type])),

                // May be the empty string
                $id: controlBindings.id,
                $analog: [0, 0, 0, 0, 0, 0],
                $rumble: function (frames) {},
                $name: `gamepad_array[${p}]`
            };

            $bind_gamepad_getters(pad);
            QRuntime.$controlSchemeTable = controlSchemeTable;

            for (let b of "abcdefq") {
                Object.defineProperty(pad, b + '_pressed', {get: function () { throw 'No gamepad.' + b + '_pressed property exists. Use gamepad.pressed_' + b; }});
                Object.defineProperty(pad, b + '_released', {get: function () { throw 'No gamepad.' + b + '_released property exists. Use gamepad.released_' + b; }});
            }

            Object.defineProperty(pad, 'online_name', {
                enumerable: true,
                get: function () {
                    if (! isHosting || this.index === 0) {
                        return myOnlineName;
                    } else {
                        return this.$guest_name;
                    }
                }
            });
            QRuntime.gamepad_array[p] = Object.seal(pad);
        }
        QRuntime.joy = QRuntime.gamepad_array[0];
        QRuntime.$bind_gamepad_getters = $bind_gamepad_getters;
        QRuntime.device_control  = device_control;
        QRuntime.$play_sound     = play_sound;
        QRuntime.stop_audio      = stop_audio;
        QRuntime.resume_audio    = resume_audio;
        QRuntime.set_volume      = set_volume;
        QRuntime.set_playback_rate = set_playback_rate;
        QRuntime.set_pitch       = set_pitch;
        
        // set_pan is different because it has a standard library stub that processes the
        // transformation before calling the browser version
        QRuntime.$set_pan        = set_pan;
        QRuntime.get_audio_status= get_audio_status;
        QRuntime.debug_pause     = onPauseButton;
        
        if (oncomplete) { oncomplete(); }
    };

    QRuntime.document.close();
}


///////////////////////////////////////////////////////////////////////
function capitalize(s) {
    return s.length === 0 ? "" : s.charAt(0).toUpperCase() + s.slice(1);
}


/* Used to clone constants. Assets do not need to be cloned.
   Freezes if the src was frozen. */
function deep_clone(src, alreadySeen) {
    alreadySeen = alreadySeen || new Map();
    if ((src === null) || (src === undefined)) {
        return undefined;
    } else if (src && src.$type && (src.$type !== 'map')) {
        // Immutable asset types, so no need to clone
        return src;
    } else if (alreadySeen.has(src)) {
        return alreadySeen.get(src);
    } else if (Array.isArray(src)) {
        const v = [];
        alreadySeen.set(src, v);
        // We sometimes add extra properties to arrays. Catch these as well
        // as the numeric indices.
        for (let k in src) {
            const i = parseInt(k);
            if (isNaN(i)) {
                // Object key
                v[k] = deep_clone(src[k], alreadySeen);
            } else {
                // Normal array element
                v[i] = deep_clone(src[i], alreadySeen);
            }
        }
        
        if (Object.isFrozen(src)) {
            Object.freeze(v);
        } else if (Object.isSealed(src)) {
            Object.seal(v);
        }
        
        return v;
    } else if (typeof src === 'object' && (! src.constructor || (src.constructor === Object.prototype.constructor))) {
        // Some generic object that is safe to clone
        const clone = Object.create(null);
        alreadySeen.set(src, clone);
        for (let key in src) {
            clone[key] = deep_clone(src[key], alreadySeen);
        }
        
        if (Object.isFrozen(src)) {
            Object.freeze(clone);
        } else if (Object.isSealed(src)) {
            Object.seal(clone);
        }
        
        return clone;
    } else {
        // Some other built-in type
        return src;
    }
}


/** Called by makeConstants as part of loading a game. Maps null to undefined
    for consistency with the rest of pyxlscript. */
function frozenDeepClone(src, alreadySeen) {
    if (src === null || src === undefined) {
        return undefined;
    } else if (alreadySeen.has(src)) {
        return alreadySeen.get(src);
    } else if (Array.isArray(src)) {
        const v = [];
        alreadySeen.set(src, v);
        for (let i = 0; i < src.length; ++i) {
            v[i] = frozenDeepClone(src[i], alreadySeen);
        }
        return Object.freeze(v);
    } else switch (typeof src) {
        case 'string':
        case 'number':
        case 'undefined':
        case 'boolean':
        return src;

        case 'object': {
            let clone = Object.create(null);
            alreadySeen.set(src, clone);
            for (let key in src) {
                if (key === '$name') { clone.$name = src.$name; continue; }
                if (key[0] === '$') {
                    throw 'Illegal constant field name: "' + key + '"';
                }
                clone[key] = frozenDeepClone(src[key], alreadySeen);
            }
            return Object.freeze(clone);
        }

        default: throw 'Cannot clone an object of type ' + (typeof src);
    } // switch
}


/* Sets the QRuntime public and hidden resolution properties */
function redefineScreenConstants(environment, alreadySeen) {
    environment = environment || QRuntime;
    alreadySeen = alreadySeen || new Map();

    const VIEW_ARRAY = [];
    VIEW_ARRAY.$name = 'VIEW_ARRAY';
    
    if (PRIVATE_VIEW) {
        const VIEW_SIZE = {x: SCREEN_WIDTH >> 1, y: SCREEN_HEIGHT >> 1};
        for (let view_index = 0; view_index < 4; ++view_index) {
            VIEW_ARRAY.push({
                $name: 'VIEW_ARRAY[' + view_index + ']',
                corner: {
                    x: (view_index & 1)  ? VIEW_SIZE.x : 0,
                    y: (view_index >> 1) ? VIEW_SIZE.y : 0
                },
                size: VIEW_SIZE,
                shape: 'rect',
                angle: 0,
                scale: {x: 1, y: 1}
            });
        }
    } else {
        VIEW_ARRAY.push({
            $name: 'VIEW_ARRAY[0]',
            corner: {x: 0, y: 0},
            size: {x: SCREEN_WIDTH, y: SCREEN_HEIGHT},
            shape: 'rect',
            angle: 0,
            scale: {x: 1, y: 1}
        });
    }
    redefineConstant(environment, 'SCREEN_SIZE', {x: SCREEN_WIDTH, y: SCREEN_HEIGHT}, alreadySeen);
    redefineConstant(environment, 'VIEW_ARRAY', VIEW_ARRAY, alreadySeen);
}


/** Environment is the object to create the constants on (the QRuntime
    iFrame, or the object at that is a package). */
function makeConstants(environment, constants, CREDITS) {
    const alreadySeen = new Map();

    // Create the CONSTANTS object on the environment
    const CONSTANTS = Object.create({});
    defineImmutableProperty(environment, 'CONSTANTS', CONSTANTS);

    // Now redefine all constants appropriately
    redefineScreenConstants(environment, alreadySeen);
    redefineConstant(environment, 'CREDITS', CREDITS, alreadySeen);
    const IDE_USER = (isQuadserver && useIDE && serverConfig && serverConfig.IDE_USER) || 'anonymous';
    redefineConstant(environment, 'IDE_USER', IDE_USER, alreadySeen);

    const REFERENCE_PASS = true;

    for (const key in constants) {
        if (key[0] === '$') { throw 'Illegal constant field name: "' + key + '"'; }
        redefineConstantByName(environment, key, alreadySeen, ! REFERENCE_PASS);
    }
    CONSTANTS.$name = 'CONSTANTS';

    // Process references second so that they can point to named sprites
    // after the spritesheets have been resolved
    for (const key in constants) {
        redefineConstantByName(environment, key, alreadySeen, REFERENCE_PASS);
    }

    // Cannot seal CONSTANTS because that would make the properties non-configurable,
    // which would prevent redefining them during debugging.
    Object.preventExtensions(CONSTANTS);
}

/* Types that can be overriden in the debug layer */
const ALLOWED_TO_DEBUG_OVERRIDE = {
    'number': true,
    'string': true,
    'reference': true,
    'boolean': true,
    'rgb': true,
    'rgba': true,
    'hsv': true,
    'hsva': true,
    'xy': true,
    'xz': true,
    'xyz': true
};


/** Used by editors as well as when building the runtime to redefine
    constants whose value is not known to the caller.

    alreadySeenMap is used for cloning. It can be undefined. 

    referencePass can be true (only process references), false (only
    process nonreferences), or undefined (process all).

    Initally,
      constants = gameSource.constants 
      debugConstants = gameSource.debug.constants
      debugConstantsJSON = gameSource.debug.json.constants

    For an object or array, these are then recursively descended by
    further calls.
*/
function redefineConstantByName
(environment,
 key,
 alreadySeenMap,
 referencePass = undefined,
 constants = gameSource.constants,
 debugConstants = gameSource.debug && gameSource.debug.constants ? gameSource.debug.constants : {},
 debugConstantsJSON = gameSource.debug && gameSource.debug.json ? gameSource.debug.json.constants : {}) {

    const gameValue   = nestedGet(constants, key);
    const debugLookup = nestedGetObject(debugConstants, key, true);
    const debugJSON   = debugConstantsJSON ? nestedGet(debugConstantsJSON, key, true, true) : undefined;

    const value =
          (debugLookup && debugJSON && 
           debugLookup.key in debugLookup.parent &&
           debugJSON.enabled &&
           ALLOWED_TO_DEBUG_OVERRIDE[debugJSON.type]) ?
          debugLookup.object :
          gameValue;

    // referencePass is not strictly boolean, so we have to test against
    // true and false explicitly
    if (value instanceof GlobalReferenceDefinition) {
        if (referencePass !== false) {
            redefineReference(environment, key, value.resolve());
        }
    } else if (referencePass !== true) {
        redefineConstant(environment, key, value, alreadySeenMap);
    }
}


/** Redefines an existing constant on the give environment and its CONSTANTS object
    when the value is known to the caller. This is used for the initial setting
    of constants.
    
    The map is used for cloning and can be undefined.

    See also redefineConstantByName()
*/
function redefineConstant(environment, key, value, alreadySeenMap) {
    console.assert(! (value instanceof GlobalReference));

    // When looking for the gameJSON, some constants such as
    // SCREEN_SIZE will not be present, so allow this to fail to
    // undefined. Also allow support for games that have NO constants defined
    // at all in the JSON.
    const gameJSON = gameSource.json.constants ? nestedGet(gameSource.json.constants, key, true, true) : undefined;
    
    if (gameJSON && (gameJSON.type === 'object' || (gameJSON.type === 'array' && gameJSON.url === undefined))) {
        // Recursive case (note that arrays loaded from urls are
        // excluded). Define the leaves as immutable properties, and
        // everything else as a frozen clone. This path is only used
        // for the initial definition.
        const debugJSON  = gameSource.debug && gameSource.debug.json && nestedGet(gameSource.debug.json.constants, key, true, true);
        const debugValue = gameSource.debug && gameSource.debug.constants && nestedGet(gameSource.debug.constants, key, true, false);
        value = recursiveDefineConstantChain(gameJSON, value, debugJSON, debugValue, alreadySeenMap);
    } else {
        value = frozenDeepClone(value, alreadySeenMap || new Map());
    }
    
    defineImmutableProperty(environment, key, value);
    defineImmutableProperty(environment.CONSTANTS, key, value);
}


/** Define leaves within `value` (non-Array/Object) as immutable
    properties and everything else as a frozen deep clone. */
function recursiveDefineConstantChain(json, value, debugJson, debugValue, alreadySeenMap) {
    console.assert(json.type === 'array' || json.type === 'object');
    
    const newObj = json.type === 'array' ? [] : {};
    for (let k in value) {
        const j = json.value[k];
        const v = value[k];

        const dj = debugJson && debugJson.value[k];
        const dv = debugValue && debugValue[k];

        let newValue;

        if (j.type === 'array' || j.type === 'object') {
            newValue = recursiveDefineConstantChain(j, v, dj, dv, alreadySeenMap);
        } else {
            newValue = frozenDeepClone(dj && dj.enabled ? dv : v, alreadySeenMap);
        }
        
        defineImmutableProperty(newObj, k, newValue);
    }

    return Object.preventExtensions(newObj);
}


/* Takes a key such as 'foo', 'foo.bar', 'foo.3.bar', etc. and evaluates nested
   indexing. Returns {parent, child, childKey}

   If `undefinedOnMissing` is true, return undefined instead of failing if
   the path does not exist.

   If `valueProperty` is true, recursion is through parent.value[k]
   instead of parent[k] after the first iteration.  This is used for
   constants JSON parsing.
*/
function nestedGetObject(root, key, undefinedOnMissing = false, valueProperty = false) {
    console.assert(root);

    // Recursively finds the object to be modified and the child
    let parent = root;
    let i = key.indexOf('.');

    while (i !== -1) {
        parent = parent[key.substring(0, i)];
        if (parent === undefined && undefinedOnMissing) { return undefined; }
        if (valueProperty) { parent = parent.value; }
        key = key.substring(i + 1);
        i = key.indexOf('.');
    }

    if (undefinedOnMissing && (parent === undefined || parent[key] === undefined)) { return undefined; }
    
    return {parent: parent, object: parent[key], key: key};
}


/* Returns nested key evaluation `root[key]` */
function nestedGet(root, key, undefinedOnMissing, valueProperty) {
    console.assert(root);
    const k = nestedGetObject(root, key, undefinedOnMissing, valueProperty);
    if (undefinedOnMissing && k === undefined) { return undefined; }
    return k.object;
}


/* Performs a array or table assignment of `root[key] = value` */
function nestedSet(root, key, value, valueProperty) {
    const k = nestedGetObject(root, key, false, valueProperty);
    k.parent[k.key] = value;
}


/** Called by constants and assets to extend the QRuntime environment or redefine
    values within it. Supports keys with '.' in the name for nested setting */
function defineImmutableProperty(object, key, value) {
    const i = key.indexOf('.');

    if (i === -1) {
        // Base case.
        // Set `configurable` to true so that we can later redefine
        Object.defineProperty(object, key, {configurable: true, enumerable: true, writable: false, value: value});
    } else {
        const rest = key.substring(i + 1);
        let first = key.substring(0, i);
        {
            const n = parseInt(first);
            if (! isNaN(n)) { first = n; }
        }
        let parent = object[first];
        
        if (parent === undefined) {
            if (typeof first === 'string') {
                // Object
                parent = {};
            } else {
                // Array
                parent = [];
            }
            // Define parent object
            defineImmutableProperty(object, first, parent);
        }

        // Recurse to approach the actual leaf object
        defineImmutableProperty(parent, rest, value);
    }
}


/** Called by makeConstant to extend the QRuntime environment or redefine values
    within it that are pointers. */
function redefineReference(environment, key, globalReference) {
    console.assert(key.indexOf('.') === -1);

    const descriptor = {
        enumerable: true,
        configurable: true,
        get: globalReference.property !== '' ?
            function () {
                return environment[globalReference.identifier][globalReference.property];
            } :
            function () {
                return environment[globalReference.identifier];
            }
    };
    console.assert(key !== globalReference.identifier);
    //console.log('binding ' + key + ' → ' + globalReference.identifier);
    //console.dir(identifier);
    Object.defineProperty(environment, key, descriptor);
    Object.defineProperty(environment.CONSTANTS, key, descriptor);
}


/** Bind assets in the environment */
function makeAssets(environment, assets) {
    if ((assets === undefined) || (Object.keys(assets).length === 0)) { return; }

    // Check the spritesheet array for consistency
    for (let i = 0; i < spritesheetArray.length; ++i) {
        console.assert(spritesheetArray[i].$index[0] === i,
                       'spritesheetArray[' + i + '] has the wrong index'); 
    }
    
    // Clone the assets, as some of them (like the map) can be mutated
    // at runtime. For speed, do not clone sprites and fonts
    const alreadySeen = new Map();
    const ASSET = {};
    for (const assetName in assets) {
        let assetValue = assets[assetName];

        if (assetValue.$type === 'data') {
            // Data assets have a level of indirection that
            // we must unroll here
            assetValue = assetValue.value;
        }

        if (assetValue.$type === 'spritesheet') {
            console.assert(spritesheetArray[assetValue.$index[0]] === assetValue,
                           'spritesheet ' + assetName + ' is at the wrong index.');
        }

        /*
        // Expensive assertions for debugging
        if (assetValue.$type === 'map') {
            console.assert(spritesheetArray[assetValue.spritesheet.$index[0]] === assetValue.spritesheet,
                           'map ' + assetName + ' spritesheet has the wrong index ' + assetValue.spritesheet.$index[0] +
                           ', should be ' + spritesheetArray.indexOf(assetValue.spritesheet));
            // Test all map sprites
            for (let x = 0; x < assetValue.length; ++x) {
                for (let y = 0; y < assetValue[x].length; ++y) {
                    const sprite = assetValue[x][y];
                    if (sprite) {
                        console.assert(sprite.rotated_270.$spritesheet.$index[0] < spritesheetArray.length,
                                      '$spritesheet.$index[0] out of bounds');
                    }
                }
            }
        }
        */
        // Clone maps because if not in forceReload mode they are
        // shared between runs when the program resets. Everything
        // else is immutable so it doesn't matter.
        const assetCopy = (assetValue.$type === 'map') ? deep_clone(assetValue, alreadySeen) : assetValue;
        ASSET[assetName] = assetCopy;
        defineImmutableProperty(environment, assetName, assetCopy);
    }
    defineImmutableProperty(environment, 'ASSETS', Object.freeze(ASSET));
}


// See also updateMidiControllerIcons
function updateControllerIcons() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : (navigator.webkitGetGamepads ? navigator.webkitGetGamepads : []);
    let num = 0;
    for (let i = 0; i < gamepads.length; ++i) {
        const pad = gamepads[i];
        if (pad && pad.connected) {
            // Enable this icon
            const element = document.getElementById('controllerIcon' + num);
            element.className = 'controllerPresent';
            element.title = pad.id + '\n\nClick for details';
            ++num;
        }
    }

    // Disable the remaining icons
    while (num < 4) {
        const element = document.getElementById('controllerIcon' + num);
        element.className = 'controllerAbsent';
        element.title = 'Connect a game controller and press a button on it';
        ++num;
    }
}


/* Returns an array of array of booleans that are the pixels. The size varies
   with the length of the URL */
function computeQRCode(url) {
    if (! computeQRCode.cache[url]) {
        computeQRCode.qrcode.makeCode(url);
        computeQRCode.cache[url] = Object.freeze(computeQRCode.qrcode._oQRCode.modules);
    }
    return computeQRCode.cache[url];
}
computeQRCode.cache = {};
computeQRCode.qrcode = new QRCode('hiddenQRCode', {correctLevel: QRCode.CorrectLevel.H, width:128, height:128});
// computeQRCode('http://192.168.1.69:8000/Projects/quadplay-dev/console/quadplay.html?game=/Projects/quadplay-dev/examples/private_view/');

setTimeout(updateControllerIcons, 100);

const qrcode = useIDE && new QRCode('serverQRCode',
                                    {width:  256,
                                     height: 256,
                                     colorDark: "rgba(0,0,0,0)",
                                     colorLight: "#eee",
                                     correctLevel: QRCode.CorrectLevel.H
                                    });

const BOOT_INFO = `<span style="color:#ec5588">quadplay✜ ${version}</span>
<span style="color:#937ab7">© 2019-2024 Morgan McGuire</span>
<span style="color:#5ea9d8">Licensed under LGPL 3.0</span>
<span style="color:#859ca6">https://casual-effects.com</span>

`;

function showBootScreen() {
    bootScreen.innerHTML = BOOT_INFO;
    bootScreen.style.zIndex = 100;
    bootScreen.style.visibility = 'visible';
    bootScreen.style.fontSize = '' + Math.max(10 * SCREEN_WIDTH / 384, 4) + 'px';
}


function hideBootScreen() {
    bootScreen.innerHTML = '';
    bootScreen.style.zIndex = -100;
    bootScreen.style.visibility = 'hidden';
}


function appendToBootScreen(msg) {
    bootScreen.innerHTML += msg + '\n';
    bootScreen.scrollTop = bootScreen.scrollHeight;
}

/** If loadFast is true, do not make any cosmetic delays. This is typically
    set for hot reloads or after configuration changes.

    If noUpdateCode is true, do not update code editors. This is used to
    prevent cursor jump when that file is itself being further updated
    by typing in the editor.
*/
function loadGameIntoIDE(url, callback, loadFast, noUpdateCode) {
    const oldVersionControl = gameSource && gameSource.versionControl;
    
    if (url !== gameURL) {
        // A new game is being loaded. Throw away the editor sessions.
        removeAllCodeEditorSessions();
    }
    
    if (emulatorMode !== 'stop') { onStopButton(false, true); }

    const isLauncher = /(^quad:\/\/console\/|\/launcher\.game\.json$)/.test(url);
    if (! isLauncher && ! loadFast) {
        showBootScreen();
    }
    gameURL = url;

    // See if the game is on the same server and not in the
    // games/ or examples/ directory
    editableProject = locallyHosted() && useIDE && isQuadserver && ! isBuiltIn(gameURL);
    // Disable the play, slow, and step buttons
    document.getElementById('slowButton').enabled =
        document.getElementById('stepButton').enabled =
        document.getElementById('playButton').enabled = false;

    const copyMenu = document.getElementById('copyMenu');
    copyMenu.style.display = (isQuadserver && locallyHosted(gameURL)) ? 'block' : 'none';
    
    // Let the boot screen show before appending in the following code
    const loadFunction = function() {
        {
            let serverURL = location.origin + location.pathname;
            // Remove common subexpression for shorter URLs
            if (url.substring(0, serverURL.length) === serverURL) {
                url = url.substring(serverURL.length);
            }
            
            // Remove redundant filename for shorterURLs
            url = url.replace(/([^\/:=&]+)\/([^\/:=&]+?)\.game\.json$/, function (match, path, filename) {
                return (path === filename) ? path + '/' : match;
            });
            
            serverURL += '?game=' + url;

            if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(serverURL)) {
                document.getElementById('serverURL').innerHTML =
                    '<p>Your quadplay✜ is in secure mode and has disabled mobile serving.</p><p>Restart the command-line program using <code style="white-space:nowrap">quadplay --serve</code> to allow serving games for mobile devices from this machine for development.</p>';
                document.getElementById('serverQRCode').style.visibility = 'hidden';
                document.getElementById('serverQRMessage').style.visibility = 'hidden';
            } else {
                if (useIDE) { qrcode.makeCode(serverURL); }
                document.getElementById('serverURL').innerHTML =
                    `<a href="${serverURL}" target="_blank">${serverURL}</a>`;
                document.getElementById('serverQRCode').style.visibility = 'visible';
            }
        }

        const startTime = performance.now();
        onLoadFileStart(url);

        afterLoadGame(url, function () {
            onLoadFileComplete(url);
            hideBootScreen();
            if (useIDE) {
                updateTodoList();
                updateProgramDocumentation();
            }
            page.document.title = gameSource.extendedJSON.title;
            console.log(`Loading complete (${Math.round(performance.now() - startTime)} ms)`);

            setFramebufferSize(gameSource.extendedJSON.screen_size.x, gameSource.extendedJSON.screen_size.y, false);
            createProjectWindow(gameSource);
            const resourcePane = document.getElementById('resourcePane');

            let s = `
<br/><center><b style="color:#888; font-family:quadplay; font-size: 125%">Resource Limits</b></center>
<hr>
<br/>
<table style="margin-left: -2px; width: 100%">
<tr><td width=180>Code Statements</td><td class="right">${resourceStats.sourceStatements}</td><td>/</td><td class="right">2048</td><td class="right">(${Math.round(resourceStats.sourceStatements*100/2048)}%)</td></tr>
<tr><td>Sounds</td><td class="right">${resourceStats.sounds}</td><td>/</td><td class="right">128</td><td class="right">(${Math.round(resourceStats.sounds*100/128)}%)</td></tr>
<!--<tr><td>Sound Bytes</td><td class="right">${resourceStats.soundKilobytes}</td><td>/</td><td class="right">256 MB</td><td class="right">(${Math.round(resourceStats.soundKilobytes*100/(1024*256))}%)</td></tr>-->
<tr><td>Sprite Pixels</td><td class="right">${Math.round(resourceStats.spritePixels / 1000)}k</td><td>/</td><td class="right" width=40>5505k</td><td class="right" width=45>(${Math.round(resourceStats.spritePixels*100/5505024)}%)</td></tr>
<tr><td>Spritesheets</td><td class="right">${resourceStats.spritesheets}</td><td>/</td><td class="right">128</td><td class="right">(${Math.round(resourceStats.spritesheets*100/128)}%)</td></tr>
<tr><td>Spritesheet Width</td><td class="right">${resourceStats.maxSpritesheetWidth}</td><td>/</td><td class="right">1024</td><td class="right">(${resourceStats.maxSpritesheetWidth <= 1024 ? 'OK' : Math.round(resourceStats.maxSpritesheetWidth*100/1024) + '%'})</td></tr>
<tr><td>Spritesheet Height</td><td class="right">${resourceStats.maxSpritesheetHeight}</td><td>/</td><td class="right">1024</td><td class="right">(${resourceStats.maxSpritesheetHeight <= 1024 ? 'OK' : Math.round(resourceStats.maxSpritesheetHeight*100/1024) + '%'})</td></tr>
</table>`;

            {
                const summary = `${resourceStats.sourceStatements} statements, ${resourceStats.sounds} sounds, ${Math.round(resourceStats.spritePixels / 1000)}k pixels`;
                s += `<button style="margin-top: 5px; font-size: 80%" onclick="window.top.navigator.clipboard.writeText('${summary}')">Copy Summary</button>`;
            }

            const resourceArray = [
                {name: 'Code Memory',   prop: 'sourceStatements', units: 'Statements', scale:1, suffix:''},
                {name: 'Sprite Memory', prop: 'spritePixels',     units: 'Pixels', scale: 1/1024, suffix: 'k'}//,
                // {name: 'Sound Memory',  prop: 'soundKilobytes',       units: 'Bytes', scale: 1, suffix:'kB'}
            ];

            for (const resource of resourceArray) {
                s += `<br/><center><b style="color:#888; font-family:quadplay; font-size: 125%">${resource.name}</b></center><hr><br/>`;
                const entryArray = Object.entries(resourceStats[resource.prop + 'ByURL']);
                
                // Sort by length
                entryArray.sort(function (a, b) { return b[1] - a[1]; });
                
                s += `<table width=100%><tr><th style="text-align:left">File</th><th width=120 colspan=2>${resource.units}</th></tr>\n`;
                for (const entry of entryArray) {
                    s += `<tr><td>${entry[0].replace(/^.*\//, '')}</td><td style="text-align:right">${Math.ceil(entry[1] * resource.scale)}${resource.suffix}</td><td width=30px></td></tr>\n`;
                }
                s += '</table>';
            }

            resourcePane.innerHTML = s;
            
            document.getElementById('restartButtonContainer').enabled =
                document.getElementById('slowButton').enabled =
                document.getElementById('stepButton').enabled =
                document.getElementById('playButton').enabled = true;
            
            const modeEditor = document.getElementById('modeEditor');
            const spriteEditor = document.getElementById('spriteEditor');

            if (modeEditor.style.visibility === 'visible') {
                // Update the mode diagram if it is visible
                visualizeModes(modeEditor);
            } else if (spriteEditor.style.visibility === 'visible') {
                // Update the sprite editor
                const assetName = spriteEditor.selectedAssetName;
                onProjectSelect(document.getElementById(`projectAsset_${assetName}`), 'asset', gameSource.assets[assetName]);
            }
            
            if (! noUpdateCode) {
                updateAllCodeEditorSessions();
            }
            hideWaitDialog();

            if (callback) { callback(); }

            if (! loadFast && editableProject && serverConfig.hasGit) {                          
                // See if this project is in git
                serverGitCommand('status .', function (text, code) {
                    if (code === 0) {
                        gameSource.versionControl = 'git';
                        document.getElementById('versionControl').style.visibility = 'visible';
                    }
                });
            } else {
                gameSource.versionControl = oldVersionControl;
                if (oldVersionControl === 'git') {
                    document.getElementById('versionControl').style.visibility = 'visible';
                }
            }

        }, function (e) {
            updateAllCodeEditorSessions();
            document.getElementById('restartButtonContainer').enabled =
                document.getElementById('slowButton').enabled =
                document.getElementById('stepButton').enabled =
                document.getElementById('playButton').enabled = true;
            hideBootScreen();
            setErrorStatus('Loading ' + url + ' failed: ' + e);
            onStopButton();
            hideWaitDialog();
        });
    };

    if (loadFast) {
        loadFunction();
    } else {
        setTimeout(loadFunction, 0);
    }
}


//////////////////////////////////////////////////////////////////////////////////////////////////////////////
// See also more event handlers for the emulator in quadplay-host.js

let gamepadButtonPressedWhilePageLoading = false;
window.addEventListener("gamepadconnected", function(e) {
    // Runs when the first gamepad button is pressed or when a
    // second gamepad connects.
    if (onWelcomeScreen) {
        if (document.getElementById('pageLoadingScreen')) {
            // Delay starting until load completes
            gamepadButtonPressedWhilePageLoading = true;
        } else {
            onWelcomeTouch();
        }
    }
    updateControllerIcons();
    console.log("Gamepad connected at index %d: %s. %d buttons, %d axes.", e.gamepad.index, e.gamepad.id, e.gamepad.buttons.length, e.gamepad.axes.length);
});

window.addEventListener("gamepaddisconnected", function(e) {
    updateControllerIcons();
    console.log("Gamepad disconnected from index %d: %s", e.gamepad.index, e.gamepad.id);
});

window.addEventListener('resize', onResize, false);

document.getElementById('maximalUIButton').addEventListener('click', requestFullScreen);

document.addEventListener('keydown', onDocumentKeyDown);
document.addEventListener('keyup', onDocumentKeyUp);

const customContextMenu = document.getElementById('customContextMenu');
document.addEventListener('contextmenu', function (event) {
    if (event.target.type !== 'textarea' && event.target.type !== 'text' && event.target.type !== 'a') {
        // Not a text box or link, so no reason to provide a context menu.
        // Prevent it:
        event.preventDefault();
    }
}, {capture: true});


/*
 Shows and hides popup dialogs over the quadplay screen

 string dialog: element name without 'RuntimeDialog'
 bool v: true if visible
*/
function setRuntimeDialogVisible(dialog, v) {
    const element = document.getElementById(dialog + 'RuntimeDialog');
    if (v) {
        element.classList.add('show');
    } else {
        element.classList.remove('show');
    }
}


function showPopupMessage(msgHTML) {
    const element = document.getElementById('popupMessage');
    element.innerHTML = msgHTML;
    element.classList.add('show');

    setTimeout(
        function () { element.classList.remove('show'); },
        
        // This timeout value has to be slightly less than the sum of the times
        // in the quadplay.css #popupMessage.show animation
        // property
        4000);
}

/* When calling from quadplay, note that the callback can happen at any point,
   even if the mode has changed.  */
async function copyToClipboard(text, successCallback, failureCallback) {
    try {
        await navigator.clipboard.writeText(text);
        if (successCallback) { successCallback(); }
    } catch (err) {
        if (failureCallback) { failureCallback(); }
        console.error('Failed to copy: ', err);
    }
}


/* When calling from quadplay, note that the callback can happen at any point,
   even if the mode has changed. */
async function pasteFromClipboard(successCallback, failureCallback) {
    console.assert(successCallback);
    try {
        const text = await navigator.clipboard.readText();
        successCallback(text);
    } catch (err) {
        if (failureCallback) { failureCallback(); }
        console.warn('Failed to read clipboard contents: ', err);
    }
}


// parent is an element or the id of one that is the control keeping the context
// menu open. This is used to make rollouts sticky while menus are live
function showContextMenu(parent) {
    if (typeof parent === 'string') {
        parent = document.getElementById(parent);
    }

    if (! parent) {
        parent = document.getElementsByTagName('body')[0];
    }

    parent.appendChild(customContextMenu);
    
    customContextMenu.style.left = event.pageX + 'px';
    customContextMenu.style.top = Math.min(event.pageY, window.innerHeight - 200) + 'px';
    customContextMenu.style.visibility = 'visible';
}

document.addEventListener('mousedown', function (event) {
    if (customContextMenu.style.visibility === 'visible') {
        customContextMenu.style.visibility = 'hidden';
    }
});


// Pause when losing focus if currently playing...prevents quadplay from
// eating resources in the background during development.
window.addEventListener('blur', function () {
    if (backgroundPauseEnabled && useIDE && ! isHosting && ! isGuesting) {
        onPauseButton();
    }
}, false);


window.addEventListener('focus', function() {
    // Reset the bloom state; it might have disabled
    // while defocused due to browser throttling.
    allow_bloom = true;
    
    // Quadplay development; avoid autoreloading because it makes
    // debugging the compiler and IDE difficult.  Also if loaded in an
    // iframe there is an immediate focus event while still loading
    // the game.
    if (! AUTO_RELOAD_ON_FOCUS || isHosting || isGuesting || ! firstLoadComplete) { return; }

    if (inGameLoad) {
        console.log('Suppressed re-entrant game load triggered by focus event');
        return;
    }

    if (editableProject && useIDE && isQuadserver) {
        if (document.getElementById('restartOnFocusEnabled').checked) {
            onRestartButton();
        } else if (emulatorMode === 'stop') {
            // Regained focus while stopped and in the IDE. Reload in case
            // anything changed on disk
            console.log('Reloading because the browser regained focus in the IDE.');
            loadGameIntoIDE(window.gameURL, null, true);
        }
    }
}, false);

//////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Callback for editable dropdown box (combobox). See the quadplay-edit-constant.js reference
// constant editor in makeConstantEditorControlHTML() for an example.

// Happens on loss of focus
function combobox_textbox_onchange(textbox) {
    const dropdown = textbox.previousElementSibling;

    for (let i = 1; i < dropdown.options.length; ++i) {
        if (dropdown.options[i].value === textbox.value) {
            dropdown.selectedIndex = i;
            // Erase the old custom value
            dropdown.options[0].value = dropdown.options[0].innerHTML = '';
            return;
        }
    }

    // Set the custom value
    dropdown.selectedIndex = 0;
    dropdown.options[0].value = dropdown.options[0].innerHTML = textbox.value;
}


function showAlertDialog(title, html, callback = noop, okLabel = 'OK') {
    showConfirmDialog(title, html, callback, noop, okLabel, '');
}


/* Shows a modal dialog with the provided html as a message. When the
   user presses the OK button, runs the callback. If cancelLabel is '', show
   only an alert. */
function showConfirmDialog(title, html, callback = noop, cancelCallback = noop, okLabel = 'OK', cancelLabel = 'Cancel') {
    onConfirmButtonClick.okCallback = callback;
    onConfirmButtonClick.cancelCallback = cancelCallback;

    document.getElementById('confirmTitle').innerHTML = title;
    document.getElementById('confirmMessage').innerHTML = html;
    document.getElementById('confirmOKButton').innerHTML = okLabel;

    const cancelButton = document.getElementById('confirmCancelButton');
    cancelButton.style.display = cancelLabel === '' ? 'none' : 'inline-block';
    cancelButton.innerHTML = cancelLabel;
    
    document.getElementById('confirmDialog').classList.remove('hidden');
}


function onConfirmButtonClick(ok) {
    document.getElementById('confirmDialog').classList.add('hidden');

    if (ok) {
        onConfirmButtonClick.okCallback();
    } else {
        onConfirmButtonClick.cancelCallback();
    }
}


function onUpdateClick(installedVersionText, latestVersionText) {
    onStopButton();

    showConfirmDialog(
        'Update',
        'Update from quadplay✜ version ' + installedVersionText + ' to version ' + latestVersionText + '?',
        doUpdate);
}


function doUpdate() {
    onStopButton();
    // Display a downloading window
    document.getElementById('updateDialog').classList.remove('hidden');

    // Tell the server to update (it will choose the right mechanism)
    postToServer({command: 'update'})

    // Start polling for when the server finishes updating
    const checker = setInterval(function () {
        const progressURL = location.origin + getQuadPath() + 'console/_update_progress.json';

        fetch(progressURL).
            then(response => response.json()).
            then(json => {
                if (json.done) {
                    clearInterval(checker);
                    if (json.restartServer) {
                        postToServer({command: 'quit'});

                        showAlertDialog(
                            'Update',
                            'Update complete. quadplay✜ needs to be restarted after this update.',
                            function () {
                                window.close();
                                location = 'about:blank';
                            },
                            noop,
                            'Restart');
                    } else {
                        showAlertDialog('Update', 'Update complete!', function () {
                            // Refresh, also forcing clean reload on Firefox
                            location.reload(true);
                        });
                    }
                }
            });
    }, 1000);
}


/* Checks for an update. Called on startup and once an hour (if not sleeping) when 
   update= is set */
function checkForUpdate() {
    if (getQueryString('update') === 'dev') {
        return;
    }
    
    // Parses a version.js file with an embedded 'version = yyyy.mm.dd.hh'
    // string and returns it as a single integer for version comparisons,
    // as well as the human-readable version string.
    function parseVersionJS(text) {
        try {
            text = text.match(/^ *const *version *= *['"]([0-9.]+)['"] *;/)[1];
            const match = text.split('.').map(x => parseInt(x, 10));

            // Months and years have varying length. That doesn't matter.  We
            // don't need a linear time number. We need one that monotonically
            // increases. Think of this as parsing a number with an irregular
            // base per digit.
            return {value: ((match[0] * 12 + match[1]) * 32 + match[2]) * 24 + match[3],
                    text: text};
        } catch {
            return {value: 0, text: text};
        }
    }

    fetch('https://raw.githubusercontent.com/morgan3d/quadplay/main/console/version.js').then(response => response.text()).then(function (text) {
        const latestVersion = parseVersionJS(text);
        const installedVersion = parseVersionJS(`const version = '${version}';\n`);

        if (latestVersion.value > installedVersion.value) {
            console.log(`There is a newer version of quadplay✜ available online:\n  installed = ${installedVersion.text}\n  newest    = ${latestVersion.text}`);
            
            // Replace the recording controls with an update button
            const menuElement = document.getElementById('recordingControls');
            menuElement.innerHTML =
                '&nbsp;&nbsp; &middot; &nbsp;&nbsp;' +
                `<a style="cursor:pointer; padding-right:4px; padding-left:4px; border-radius: 3px; border: 1px solid" title="Update quadplay✜ to version ${latestVersion.text}" onclick="onUpdateClick('${installedVersion.text}', '${latestVersion.text}')">` +
                'Update <span style="font-size: 140%; vertical-align: top; position: relative; top: -4px">⚙</span></a>';
            
        } else if (latestVersion.value === installedVersion.value) {
            console.log('You are running the latest version of quadplay✜');
        } else if (latestVersion.text.indexOf('404') !== -1) {
            console.log(`You are running a prerelease version of quadplay✜:\n  installed      = ${installedVersion.text}\n  latest release = ${latestVersion.text}`);
        }
    });
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Load state

// Default to true
backgroundPauseEnabled = (localStorage.getItem('backgroundPauseEnabled') !== 'false');

if (! localStorage.getItem('debugPrintEnabled')) {
    // Default to true
    localStorage.setItem('debugPrintEnabled', 'true')
}

if (! localStorage.getItem('prettyPrintEnabled')) {
    // Default to true
    localStorage.setItem('prettyPrintEnabled', 'true')
}

if (! localStorage.getItem('assertEnabled')) {
    // Default to true
    localStorage.setItem('assertEnabled', 'true')
}

if (! localStorage.getItem('todoEnabled')) {
    // Default to false
    localStorage.setItem('todoEnabled', 'false')
}

if (! localStorage.getItem('automathEnabled')) {
    // Default to true
    localStorage.setItem('automathEnabled', 'true')
}

if (localStorage.getItem('restartOnFocusEnabled') === null) {
    // Default to false
    localStorage.setItem('restartOnFocusEnabled', 'false')
}

if (localStorage.getItem('onScreenHUDEnabled') === null) {
    // Default to false
    localStorage.setItem('onScreenHUDEnabled', 'false')
}

if (! localStorage.getItem('debugWatchEnabled')) {
    // Default to true
    localStorage.setItem('debugWatchEnabled', 'true')
}

if (! localStorage.getItem('autoplayOnLoad')) {
    // Default to true
    localStorage.setItem('autoplayOnLoad', 'true')
}

document.getElementById(localStorage.getItem('activeDebuggerTab') || 'performanceTab').checked = true;

setKeyboardMappingMode(localStorage.getItem('keyboardMappingMode') || 'Normal');

{
    const optionNames = ['showPhysicsEnabled', 'showPrivateViewsEnabled', 'showEntityBoundsEnabled', 'assertEnabled', 'todoEnabled', 'automathEnabled', 'prettyPrintEnabled', 'debugPrintEnabled', 'debugWatchEnabled', 'restartOnFocusEnabled', 'autoplayOnLoad', 'onScreenHUDEnabled', 'printTouchEnabled'];
    for (let i = 0; i < optionNames.length; ++i) {
        const name = optionNames[i];
        const value = JSON.parse(localStorage.getItem(name) || 'false');
        const element = document.getElementById(name);
        if (! element) {
            console.error(name + " not found");
        }
        element.checked = value;
    }
}



{
    let url = getQueryString('game');

    if (! url) {
        if (useIDE) {
            // Default game in IDE
            url = 'quad://examples/animation';
        } else {
            // Load the launcher if no game is specified outside of the IDE
            url = launcherURL;
        }
    }

    // If the url doesn't have a prefix and doesn't begin with a slash or 
    // drive letter, assume that it is relative to the quadplay script in the parent dir.
    if (! (/^(.{3,}:\/\/|[\\/]|[a-zA-Z]:[\/\\])/).test(url)) {
        url = '../' + url;
    }

    console.log('Loading because of initial page load.');
    loadGameIntoIDE(url, function () {
        const pageLoadingScreen = document.getElementById('pageLoadingScreen');
        if (pageLoadingScreen) {
            if (! useIDE) {
                // Done loading outside of the IDE.  Now show the
                // welcome screen. The pageLoadingScreen prevented
                // players from launching the game before loading
                // completed. The welcome screen forces an interaction
                // to lift browser restrictions.
                document.getElementById('welcome').style.visibility = 'visible';
                
                if (gamepadButtonPressedWhilePageLoading) {
                    // Immediately push the welcome button if the player already
                    // pressed a gamepad button
                    onWelcomeTouch();
                }
            }
            
            // Remove the loading screen permanently now that page loading has completed
            pageLoadingScreen.remove();
        }

        if (useIDE) {
            onProjectSelect(null, 'game', gameSource.jsonURL);
            
            // Used for the open dialog's autoplay checkbox
            if (getQueryString('autoplay') === '1') {
                onPlayButton(false, true);
            }
        } // use IDE
    });
}


document.getElementById('backgroundPauseCheckbox').checked = backgroundPauseEnabled || false;
document.getElementById('autoSleepCheckbox').checked = autoSleepEnabled || false;

if (getQueryString('kiosk') === '1') {
    // Hide the console menu and mode buttons
    document.getElementById('body').classList.add('kiosk');
    document.getElementById('body').classList.remove('noKiosk');
    setUIMode('Maximal');
} else {
    document.getElementById('body').classList.remove('kiosk');
    document.getElementById('body').classList.add('noKiosk');
    let newMode = getQueryString('mode');
    if (! newMode || newMode === 'DefaultWindow') {
        if (useIDE) {
            newMode = localStorage.getItem('uiMode') || 'IDE';
        } else {
            newMode = isMobile ? 'Emulator' : 'Windowed';
        }
    }


    // Embedded games that reload on quit start without fullscreen
    // so that the first touch launches them.
    const noFullscreen = ((getQueryString('quit') === 'reload') ||
                          (newMode === 'Windowed'));
    
    setUIMode(newMode, noFullscreen);
}


// Assign the action for QRuntime.quit_game() used by the in-game
// pause menu quit option
const quitAction = (function() {
    if (useIDE) {
        // When the IDE is on, always quit to the IDE
        return 'launcher';
    }
    
    const q = getQueryString('quit');
    
    // Explicit value
    if (q) {
        if (/^(close|none|reload|launcher)$/.test(q)) {
            return q;
        } else {
            alert('Illegal setting for HTML query parameter: quit=' + q);
            // Fall through to a default
        }
    }

    const kiosk = getQueryString('kiosk') || '0';
    
    if (getQueryString('game')) {
        if (kiosk === '0') {
            // Running a single game in the browser
            return 'close';
        } else {
            // Running a single game as a kiosk
            return 'none';
        }
    } else {
        // Running the launcher in a browser
        return 'launcher';
    }
})();


initializeBrowserEmulator();
setErrorStatus('');
setCodeEditorFontSize(parseFloat(localStorage.getItem('codeEditorFontSize') || '14'));
setColorScheme(localStorage.getItem('colorScheme') || 'dots');
{
    let tmp = gamepadOrderMap = (localStorage.getItem('gamepadOrderMap') || '0123').split('');
    for (let i = 0; i < tmp.length; ++i) {
        tmp[i] = parseInt(tmp[i]);
    }
    setGamepadOrderMap(tmp);
}

// Set the initial size
setFramebufferSize(SCREEN_WIDTH, SCREEN_HEIGHT, false);
reloadRuntime();

// Get the configuration if running on a quadplay server
LoadManager.fetchOne({}, location.origin + getQuadPath() + 'console/_config.json', 'json', null, function (json) {
    serverConfig = json;
});

// As early as possible, make the browser aware that we want gamepads
navigator.getGamepads();

/* Called from the quit menu item. Forces closing the server for a nativeapp,
   which macOS can't detect because the Chromium browser doesn't close on that
   platform when the last tab closes. */
function closeClient() {
    if (nativeapp && isQuadserver) {
        postToServer({command: 'quit'});
        setTimeout(function () { window.close(); }, 500);
    } else {
        window.close();
    }
}

// Set to true when intentionally loading a new game to keep nativeapp
// from closing the server when it loads a new game
let inPageReload = false;
if (nativeapp && isQuadserver) {
    // Tell the server to quit when the browser does
    window.addEventListener('beforeunload', function () {
        if (! inPageReload) {
            postToServer({command: 'quit'});
        }
    })
}



if ((getQueryString('update') && getQueryString('update') !== '0') && isQuadserver && getQueryString('kiosk') !== 1) {
    // Check for updates a few seconds after start, and then every
    // two hours when not sleeping.
    const INITIAL_DELAY  = 4000;
    const REGULAR_PERIOD = 2 * 60 * 60 * 1000;
    setTimeout(function () {
        checkForUpdate();
        setInterval(function () {
            if (document.getElementById('sleep').style.visibility !== 'visible') {
                checkForUpdate();
            }
        }, REGULAR_PERIOD);
    }, INITIAL_DELAY);
}
