/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */
"use strict";

// Set to false when working on quadplay itself.
const deployed = true;

// If true, use a WebWorker thread for the virtual GPU. This variable
// appears in the CPU runtime as well.
const $THREADED_GPU = true;

// Set to true to allow editing of quad://example/ files when developing quadplay
const ALLOW_EDITING_EXAMPLES = ! deployed;

// Set to true to automatically reload on switching
// to the browser when the game is stopped.
const AUTO_RELOAD_ON_FOCUS = true;

const launcherURL = 'quad://console/launcher';

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


// Can the game pause/sleep when idle to save power?
let autoPauseEnabled = (localStorage.getItem('autoPauseEnabled') === 'true');


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
    ╵                   ╵                ──╯       `.split('\n');
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
                '\nIDE: ' + useIDE +
                '\n' + (new Date().toString()),
                ...style);
}


function enterKioskMode() {
    inPageReload = true;
    location = location.origin + location.pathname + '?kiosk=1&game=' + getQueryString('game');
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


/* Print only the filename base when it is the same as the game base */
function shortURL(url) {
    const gamePath = gameSource.jsonURL.replace(/\/[^/]+\.game\.json$/, '/');
    if (url.startsWith(gamePath)) {
        return url.substring(gamePath.length);
    } else {
        return url;
    }
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
const RESET_ANIMATION_LENGTH = Object.freeze({
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

/*
 {
   json, // The original source file after parsing, except with colors upgraded to objects. This is used by the IDE when modifying files
   extendedJSON, // json with injected additional assets. This is used by the runtime
   constants, // The constants object, computed on load from .json
   docs, // The docs object
   assets, // The assets object
   debug, // The debug object for overriding .extendedJSON with the debug layer
  }
*/
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


function onIntegerScalingClick(event) {
    const element = event.target;
    event.stopPropagation();
    localStorage.setItem('integerScalingEnabled', '' + element.checked);
    onResize();
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
    const pane = document.getElementById('gamepadIndexView');

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
    // Needed because QRuntime is not loaded yet when this is first called
    function lerp(x, y, t) {
        return {
            r: x.r * (1 - t) + y.r * t,
            g: x.g * (1 - t) + y.g * t,
            b: x.b * (1 - t) + y.b * t};
    }

    function unparse_hex_color(c) {
        function hex(v) {
            v = Math.min(Math.max(Math.floor(v * 256), 0), 255) | 0;
            return (v < 16 ? '0' : '') + v.toString(16);
        }
        
        return '#' + hex(c.r) + hex(c.g) + hex(c.b) + (c.a !== undefined ? hex(c.a) : '');
    }


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
    let themeColor = '#e61b9d';
    let emulatorColor = "url('wrap-dots.png') 50% 50% / cover";

    switch (scheme) {
    case 'pink':
        themeColor = '#e61b9d';
        emulatorColor = '#ff4488';
        break;

    case 'black':
        themeColor = '#0af';
        emulatorColor = '#090909';
        break;
        
    case 'white':
        themeColor = '#0af';
        emulatorColor = '#D2C4D2';
        break;

    case 'orange':
        themeColor = '#ff7030';
        emulatorColor = '#f04C12';
        break;
        
    case 'gold':
        themeColor = '#dca112';
        emulatorColor = '#b68216';
        break;
        
    case 'green':
        themeColor = '#47b52e';
        emulatorColor = '#139613';
        break;
        
    case 'blue':
        themeColor = '#0af';
        emulatorColor = '#1074b6';
        break;

    case 'dots':
        themeColor = '#e61b9d';
        emulatorColor = "url('wraps/dots.png') 50% 50% / cover";
        break;
        
    case 'stripes':
        themeColor = '#da0200';
        emulatorColor = "url('wraps/stripes.png') 50% 50% / cover";
        break;

    case 'wood':
        themeColor = '#cb7f49';
        emulatorColor = "url('wraps/oak.jpg') 50% 50% / cover";
        break;

    case 'walnut_burl':
        themeColor = '#cb7f49';
        emulatorColor = "url('wraps/walnut_burl.jpg') 50% 50% / cover";
        break;

    case 'carbon':
        themeColor = '#0af';
        emulatorColor = "url('wraps/carbon.png') 50% 50% / cover";
        break;
    }
    
    // Set the theme color CSS variable
    document.documentElement.style.setProperty('--theme-color', themeColor);
    
    // Parse theme color into RGB components
    themeColor = parseHexColor(themeColor.slice(1));
    
    // Compute gradient colors using lerp
    const gradientColor0 = lerp(themeColor, {r: 0.7, g: 0.7, b: 0.7}, 0.0);
    const gradientColor1 = lerp(themeColor, {r: 0.7, g: 0.7, b: 0.7}, 0.25);
    const gradientColor2 = lerp(themeColor, {r: 1.0, g: 1.0, b: 1.0}, 0.75);

    // Convert to hex and set CSS variables
    document.documentElement.style.setProperty('--theme-gradient-0', unparse_hex_color(gradientColor0));
    document.documentElement.style.setProperty('--theme-gradient-1', unparse_hex_color(gradientColor1));
    document.documentElement.style.setProperty('--theme-gradient-2', unparse_hex_color(gradientColor2));
    
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
    stylesheet.insertRule(`a, #header a, .menu a { color: ${themeColor} !important; text-decoration: none; }`, 0);
    stylesheet.insertRule(`.emulator .emulatorBackground { background: ${emulatorColor}; ! important}`, 0);
    localStorage.setItem('colorScheme', colorScheme);
}

/*
   True until the user has passed the welcome screen challenge (waived in the IDE).
   This challenge is required to force the user to perform an interaction (mouse,
   key, or touch event) before proceeding. Many browsers block programmatic
   audio context activation and focus changes until a user gesture occurs.
   By requiring this challenge, we ensure the user triggers an event that allows
   us to enable the audio context and set focus reliably.
*/
let welcomeScreenChallenge = ! useIDE;

/* 
   Force users in auto-play modes to interact in order to enable the
   audio engine and full-screen on mobile (where it is harder to hit
   the small full-screen button).
 */
function onAppWelcomeTouch(hasTouchScreen) {
    hasTouchScreen = hasTouchScreen || isMobile;
    
    welcomeScreenChallenge = false;
    const appWelcomeOverlay = document.getElementById('appWelcomeOverlay');
    appWelcomeOverlay.style.zIndex = -100;
    appWelcomeOverlay.style.visibility = 'hidden';
    appWelcomeOverlay.style.display = 'none';

    unlockAudio();
    
    if ((uiMode === 'Maximal' || uiMode === 'Windowed') && ! useIDE && hasTouchScreen && (gameSource.extendedJSON.mobile_touch_gamepad !== false)) {
        // This device probably requires on-screen controls.
        // Setting the UI mode forces fullscreen as well.
        setUIMode('Emulator');
    } else if ((! useIDE && (uiMode !== 'Windowed')) || hasTouchScreen) {
        if (deployed && (isMobile || getQueryString('mode') !== 'DefaultWindow')) { 
            requestFullScreen(); 
        }
    }

    let url = getQueryString('game');
    let other_host_code = getQueryString('host');
    
    const showPause = (url || other_host_code) && ! useIDE && gameSource.extendedJSON.show_start_animation !== false;
    
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
        const introControlsScreen = document.getElementById('introControlsScreen');
        introControlsScreen.style.zIndex = 120;
        introControlsScreen.style.visibility = 'visible';
        introControlsScreen.style.opacity = 1;

        // Track if we've already handled the skip
        let skipHandled = false;
        const startTime = Date.now();

        // Function to hide message and continue
        const hideMessage = function() {
            if (skipHandled) return;
            skipHandled = true;
            
            // Clean up event listeners
            document.removeEventListener('keydown', keyHandler, {capture: true});
            document.removeEventListener('mousedown', pointerHandler, {capture: true});
            document.removeEventListener('touchstart', pointerHandler, {capture: true});
            
            // Start fade out
            introControlsScreen.style.opacity = 0;
            setTimeout(function() {
                introControlsScreen.style.visibility = 'hidden';
                introControlsScreen.style.zIndex = 0;
                onPlayButton(undefined, ! useIDE && gameSource.extendedJSON.show_start_animation === false ? true : undefined, undefined, callback);
            }, 200);
        };

        // Handle keyboard input
        const keyHandler = function(event) {
            if (Date.now() - startTime < 200) return;
            hideMessage();
            event.stopPropagation();
        };

        // Handle mouse/touch input
        const pointerHandler = function(event) {
            if (Date.now() - startTime < 200) return;
            // Only handle primary button clicks and touches
            if (event.type === 'mousedown' && event.button !== 0) return;
            hideMessage();
            event.stopPropagation();
        };

        // Add event listeners with capture
        const options = {capture: true};
        document.addEventListener('keydown', keyHandler, options);
        document.addEventListener('mousedown', pointerHandler, options);
        document.addEventListener('touchstart', pointerHandler, options);

        // Auto-hide after 3 seconds
        setTimeout(hideMessage, 3000);
    } else {
        onPlayButton(undefined, ! useIDE && gameSource.extendedJSON.show_start_animation === false ? true : undefined, undefined, callback);
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


function requestFullScreen() {
    // Full-screen the UI. This can fail if not triggered by a user interaction.

    function ignoreException(e) {
        console.log('Suppressed browser security exception during requestFullScreen():', e);
    }

    try { 
        const body = document.getElementsByTagName('body')[0];
        if (body.requestFullscreen) {
            body.requestFullscreen().catch(ignoreException);
        } else if (body.webkitRequestFullscreen) {
            // On MacOS Chromium browsers, we need to use ALLOW_KEYBOARD_INPUT to ensure button interactions work
            if (isApple && (isChrome || isEdge)) {
                body.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT).catch(ignoreException);
            } else {
                body.webkitRequestFullscreen().catch(ignoreException);
            }
        } else if (body.mozRequestFullScreen) {
            body.mozRequestFullScreen().catch(ignoreException);
        } else if (body.msRequestFullscreen) {
            body.msRequestFullscreen().catch(ignoreException);
        }
    } catch (e) {
        ignoreException(e);
    }

    try {
        // Capture the escape key (https://web.dev/keyboard-lock/)
        window.top.navigator.keyboard.lock().catch(ignoreException);
    } catch (e) {
        ignoreException(e);
    }
}

let backgroundPauseEnabled = true;


function setKeyboardMappingMode(type) {
    keyboardMappingMode = type;
    document.getElementById(type + 'KeyboardRadio').checked = '1';
    localStorage.setItem('keyboardMappingMode', type);
}


function setUIMode(d, noFullscreen) {

    const uiModeTable = {
        'IDE'      : { button: 'IDEUIButton',      ide: true  },
        'WideIDE'  : { button: 'wideIDEUIButton',  ide: true  },
        'Emulator' : { button: 'emulatorUIButton', ide: false },
        'Test'     : { button: 'testUIButton',     ide: true  },
        'Maximal'  : { button: 'maximalUIButton',  ide: false },
        'Windowed' : { button: 'windowedUIButton', ide: false, bodyClass: 'MaximalUI' },
        'Editor'   : { button: 'editorUIButton',   ide: true  },
        'Ghost'    : { button: 'ghostUIButton',    ide: true  }};

    if (! useIDE && uiModeTable[d].ide) {
        // When in dedicated play, no-IDE mode and the UI was
        // previously set to UI, fall back to the emulator.
        d = 'Emulator';
    }

    const previousUIMode = uiMode;
    uiMode = d;
    
    // Reset divider positions when UI mode actually changes
    if (previousUIMode !== uiMode && useIDE) {
        const emulatorBottomDivider = document.getElementById('emulatorBottomDivider');
        const debuggerPane = document.getElementById('debuggerPane');
        const editorPane = document.getElementById('editorPane');
        const emulator = document.getElementById('emulator');
        
        if (emulatorBottomDivider) {
            emulatorBottomDivider.style.top = '';
        }
        if (debuggerPane) {
            debuggerPane.style.top = '';
        }
        if (editorPane) {
            editorPane.style.top = '';
        }
        if (emulator) {
            emulator.style.maxHeight = '';
            emulator.style.overflow = '';
        }
        
        let dividerTop = 256; // Ghost, Editor
        // Initialize emulator size for IDE modes using CSS default position
        if (uiMode !== 'Emulator' && uiMode !== 'Maximal' && uiMode !== 'Windowed') {
            // Use CSS default divider positions based on UI mode
            if (uiMode === 'WideIDE' || uiMode === 'Test') {
                // Calculate divider position based on CSS variable height + offset
                const emulatorHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--wide-ide-emulator-height'));
                const headerHeight = document.getElementById('header').offsetHeight;
                dividerTop = emulatorHeight + 33 - headerHeight; 
            } else if (uiMode === 'IDE') {
                // Use the default CSS position for IDE mode (265px)
                const headerHeight = document.getElementById('header').offsetHeight;
                dividerTop = 265 - headerHeight;
            }
        } else {
            dividerTop = parseInt(emulatorBottomDivider.style.top);
        }
        updateEmulatorBottomDividerLayout(dividerTop);
    }
    const body = document.getElementsByTagName('body')[0];

    if (! uiModeTable[uiMode]) {
        console.log(`setUIMode() called with illegal ui mode: '${uiMode}'`);        
    }

    // Remove all UI mode classes
    for (const key of Object.keys(uiModeTable)) {
        if (key !== 'Windowed') {
            body.classList.remove(key + 'UI');
        }
    }

    // Set the CSS class, using any specific overrides from the table
    body.classList.add(uiModeTable[uiMode].bodyClass || (uiMode + 'UI'));

    // Check the appropriate radio button, defaulting to maximalUI if some illegal value was passed.
    // This should do nothing if the GUI invoked the function and should update the UI if it was programmatically invoked.
    document.getElementById(uiModeTable[uiMode].button || 'maximalUIButton').checked = 1;

    if (((uiMode === 'Maximal') || ((uiMode === 'Emulator') && ! useIDE)) && ! noFullscreen && ! document.fullscreenElement) {
        requestFullScreen();
    }

    if (uiMode === 'Windowed' && document.fullscreenElement) {
        // Undo fullscreen
        try {
            document.exitFullscreen();
        } catch { }
    }

    // Need to wait for layout to update before the onResize handler
    // has correct layout sizes.
    setTimeout(onResize, 100);

    // Reset keyboard focus
    emulatorKeyboardInput.focus({preventScroll: true});

    if (useIDE) { 
        // Ace doesn't notice CSS changes. This explicit resize is needed
        // to ensure that the editor can fully scroll horizontally
        // in 'wide' mode
        setTimeout(function() { aceEditor.resize(); });

        // Force a debugger update so that the stats are correct
        // when switching back to it
        updateDebugger();
    }
}


/* Compute snapped integer scaling from available dimensions */
function computeSnappedIntegerScaling(availableWidth, availableHeight) {
    // Find largest screen size that fits within available rectangle
    const widthScale = availableWidth / SCREEN_WIDTH;
    const heightScale = availableHeight / SCREEN_HEIGHT;
    const rawScale = Math.min(widthScale, heightScale);

    // Skip integer scaling if in IDE mode and integerScalingEnabled is false
    if (useIDE && ! document.getElementById('integerScalingEnabled').checked) {
        return rawScale;
    }
    
    // Apply integer scaling logic between 1/4x and 3x sizes, and clamp
    // to no smaller than 1/4
    if (rawScale < 1) {
        // For scales < 1, round to nearest integer fraction (1/2, 1/3, 1/4). Enforce a minimum 1/4 size
        return Math.max(1/4, 1 / Math.ceil(1 / rawScale));
    } else if (rawScale < 1.6) {
        // Chosen so that games that have 224 as the min dimension can fill the screen on iPhone 12 and later
        return Math.max(1, Math.floor(rawScale));
    } else {
        // For large scales, use exact scaling to fill screens better
        return rawScale;
    }
}

function getAvailableEmulatorScreenSize() {
    const emulatorDiv = document.getElementById('emulator');
    let availableWidth = emulatorDiv.clientWidth;
    let availableHeight = emulatorDiv.clientHeight;
    
    switch (uiMode) {
    case 'Editor':
        // No visible game screen in this case, so persist the current screen size.
        const screenBorder = document.getElementById('screenBorder');
        availableWidth = screenBorder.clientWidth;
        availableHeight = screenBorder.clientHeight;
        break;
        
    case 'Emulator':
        {
            // Compute smaller bounding area constrained by on-screen controls
            const gbMode = window.matchMedia('(orientation: portrait)').matches;
            if (gbMode) {
                // In portrait mode, calculate control space from KeyQbutton position
                const keyQButton = document.getElementById('KeyQbutton');
                const keyQButtonRect = keyQButton.getBoundingClientRect();
                const emulatorRect = emulatorDiv.getBoundingClientRect();
                availableHeight = keyQButtonRect.top - emulatorRect.top;
            } else {
                // In landscape mode, calculate control space from minimalButtons position
                const minimalButtons = document.getElementById('minimalButtons');
                const minimalButtonsRect = minimalButtons.getBoundingClientRect();
                const emulatorRect = emulatorDiv.getBoundingClientRect();
                const controlMargin = emulatorRect.right - minimalButtonsRect.left + 20;
                availableWidth -= 2 * controlMargin;
            }
        }
        break;
        
    case 'WideIDE':
    case 'IDE':
    case 'Ghost':
    case 'Maximal':
    case 'Windowed':
    case 'Test':
        // Use full emulator div bounds
        break;
    }
    
    return {x: availableWidth, y: availableHeight};
}

/* Choose the most appropriate layout for the aspect ratio and scaling factor. */
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
    
    // Portrait orientation: prefer gameboy layout
    const gbMode = window.matchMedia('(orientation: portrait)').matches;

    let windowWidth = window.innerWidth, windowHeight = window.innerHeight;

    // The size of the quadplay screen (HTML element id = 'screenBorder') is 
    // set to scale * SCREEN_SIZE. The size in pixels is thus controlled
    // by the scale, not by explicitly setting dimensions. 
    let scale = 1;

    const editorPane = document.getElementById('editorPane');
    if (uiMode !== 'Test') {
        // Undo the setting from Test mode only
        if (editorPane.style.top && editorPane.style.top !== '0px') {
            editorPane.style.top = '0px';
        }
    }
    
    switch (uiMode) {
    case 'Editor':
        background.removeAttribute('style');
        break;
        
    case 'Emulator':
        {
            const availableSize = getAvailableEmulatorScreenSize();
            const scale = computeSnappedIntegerScaling(availableSize.x, availableSize.y);
            
            const zoom = setScreenBorderScale(screenBorder, scale);
            
            // Center horizontally within the full emulator width
            const emulatorDiv = document.getElementById('emulator');
            const fullEmulatorWidth = emulatorDiv.clientWidth;
            screenBorder.style.left = Math.round((fullEmulatorWidth / zoom - screenBorder.offsetWidth) / 2) + 'px';
            
            // Center vertically and handle background sizing
            let delta = 0;
            if (! gbMode) {
                // Resize the background to bound the screen more tightly
                const MIN_LANDSCAPE_HEIGHT = 300;
                // Account for border width: Emulator mode has 5px border on each side (10px total) plus some padding
                const borderWidth = 5;
                const height = Math.min(windowHeight - 27, Math.max(MIN_LANDSCAPE_HEIGHT, Math.round((SCREEN_HEIGHT + 2 * borderWidth + 9) * scale)));
                delta = Math.ceil(height / 2);
                background.style.top = Math.round((windowHeight - height) / 2 - 17) + 'px';
                background.style.height = height + 'px';
                
                screenBorder.style.transformOrigin = 'center';
                screenBorder.style.top = (Math.round(Math.max(0, -delta / zoom) + (windowHeight / zoom - screenBorder.offsetHeight - 34 / zoom) / 2)) + 'px';
            } else {
                screenBorder.style.transformOrigin = 'center top';
                screenBorder.style.top = (15 / zoom) + 'px';
            }

            // Show the controls
            body.classList.add('fullscreenEmulator');
            break;
        }

    case 'WideIDE':
    case 'IDE':
    case 'Ghost':
    case 'Maximal':
    case 'Windowed':
    case 'Test':
        {
            const availableSize = getAvailableEmulatorScreenSize();
            const scale = computeSnappedIntegerScaling(availableSize.x, availableSize.y);
            const zoom = setScreenBorderScale(screenBorder, scale);
            
            // Center the screen horizontally for all modes
            screenBorder.style.left = Math.round((availableSize.x / zoom - screenBorder.offsetWidth) / 2) + 'px';            
            screenBorder.style.transformOrigin = 'center';

            // Handle vertical positioning and transform origin based on UI mode
            if (uiMode === 'IDE' || uiMode === 'WideIDE') {
                // IDE modes: center vertically (don't remove style attribute as it contains the transform)
                screenBorder.style.top = Math.round((availableSize.y / zoom - screenBorder.offsetHeight) / 2) + 'px';
                background.removeAttribute('style');
            } else if (uiMode === 'Test') {
                // Show the constants
                onProjectSelect(undefined, 'constant', undefined);
                screenBorder.style.top = Math.round((availableSize.y / zoom - screenBorder.offsetHeight) / 2) + 'px';
                
                // Put the top of the editor to match debuggerPane position (only if not manually positioned)
                if (editorPane.style.top && editorPane.style.top.startsWith('calc(')) {
                    // Don't override manual drag positioning
                } else {
                    // Match the debuggerPane position from CSS
                    editorPane.style.top = '';
                }
            } else {
                // Ghost, Maximal, Windowed modes: center vertically
                const isKiosk = getQueryString('kiosk') === '1';
                const headerBar = isKiosk ? 0 : document.getElementById('header').offsetHeight;
                screenBorder.style.top = Math.round((windowHeight - screenBorder.offsetHeight * zoom - headerBar - 2) / (2 * zoom)) + 'px';
            }
        }
        break;
    }

    const hostCrop = (PRIVATE_VIEW && ! isGuesting && ! showPrivateViewsEnabled) ? 0.5 : 1.0;
    
    screenBorder.style.width = (SCREEN_WIDTH * hostCrop) + 'px';
    screenBorder.style.height = (SCREEN_HEIGHT * hostCrop) + 'px';
    if (uiMode === 'Maximal' || uiMode === 'Windowed' || uiMode === 'Test') {
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
    
    // Ensure dividers don't go off-screen when window is resized shorter
    const realBody = document.getElementById('realBody');
    if (realBody && useIDE) {
        const maxDividerTop = realBody.clientHeight - document.getElementById('error').offsetHeight + 9;
        
        // Check emulator bottom divider
        const emulatorBottomDivider = document.getElementById('emulatorBottomDivider');
        if (emulatorBottomDivider && emulatorBottomDivider.style.top) {
            const currentTop = parseInt(emulatorBottomDivider.style.top);
            if (currentTop > maxDividerTop) {
                updateEmulatorBottomDividerLayout(maxDividerTop);
            }
        }
        
        // Check code editor divider - use same coordinate system as emulator divider
        const codeEditorDivider = document.getElementById('codeEditorDivider');
        const codePlusFrame = document.getElementById('codePlusFrame');
        if (codeEditorDivider && codePlusFrame) {
            const codePlusFrameRect = codePlusFrame.getBoundingClientRect();
            const realBodyRect = realBody.getBoundingClientRect();
            const dividerRect = codeEditorDivider.getBoundingClientRect();
            
            // Convert divider position to realBody coordinate system
            const dividerTopInRealBody = dividerRect.top - realBodyRect.top;
            
            if (dividerTopInRealBody > maxDividerTop) {
                // Calculate how much to reduce the top height to bring divider above status bar
                const currentTopHeight = parseInt(codePlusFrame.style.gridTemplateRows?.split('px')[0] || '0');
                const reduction = dividerTopInRealBody - maxDividerTop;
                const newTopHeight = Math.max(0, currentTopHeight - reduction);
                codePlusFrame.style.gridTemplateRows = `${newTopHeight}px auto auto 1fr`;
                localStorage.setItem('codeDividerTop', Math.round(newTopHeight));
            }
        }
    }
}


/* Returns the net zoom factor, factoring in the PRIVATE_VIEW consideration 
   that may cause the rendered screen to be twice as large in each dimension 
   as the viewable screen. */
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
    const button = document.getElementById(event.target.id);
    const menu = document.getElementById(event.target.id.replace(/Button$/, ''));
    let prevVisibility = menu.style.visibility;

    closeDropdowns();

    if (prevVisibility === 'visible') {
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
    conduitNetwork.reset_conduits();
    
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

    // Remove highlight from all nodes in the mode diagram
    const modeGraph = document.querySelector('.modeGraph');
    if (modeGraph) {
        modeGraph.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
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


function onAutoPauseCheckbox(event) {
    event.stopPropagation();
    autoPauseEnabled = document.getElementById('autoPauseCheckbox').checked;
    localStorage.setItem('autoPauseEnabled', autoPauseEnabled.toString());
    saveIDEState();
}

function wake() {
    // Wake if asleep (we might be in pause mode because we're a guest, too)
    if (autoPauseEnabled && (emulatorMode === 'pause') && (document.getElementById('sleepOverlay').style.visibility === 'visible')) {
        document.getElementById('sleepOverlay').style.visibility = 'hidden';
        onPlayButton();
        
        // The set focus doesn't work without this delay for some reason
        setTimeout(function() { emulatorKeyboardInput.focus({preventScroll:true}); });
        
        // sleep.pollHandler will be removed by onPlayButton()

        // Unless told not to, check for update on waking since
        // sleeping disables update checks. This is for the case of
        // someone waking up their console specfically to upgrade it
        if ((getQueryString('update') && getQueryString('update') !== '0') && useIDE && isQuadserver && getQueryString('kiosk') !== 1) {
            checkForUpdate();
        }
    }
}


/* Invoked via setTimeout to poll for gamepad input while sleeping.
   Triggers the next sleepPollCallback if there has been no input
   and still not in play mode.*/
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
    document.getElementById('sleepOverlay').style.visibility = 'visible';
    onPauseButton();
    // Begin gamepad polling
    sleepPollCallback();
}

// Used to detect when we're waiting for a save to complete
let alreadyInPlayButtonAttempt = false;

// Allows a framerate to be specified so that the slow button can re-use the logic.
//
// slow = run at slow framerate (used for *every* slow step as well)
// skipStartAnimation = Used when the game was exported with no sizzle or has been triggered by QRuntime.launch_game()
// args = array of arguments to pass to the new program
function onPlayButton(slow, skipStartAnimation, args, callback) {
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
                if (useIDE) { setErrorStatus(''); }
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
                if (useIDE) {
                    setErrorStatus(shortURL(e.url) + ' line ' + e.lineNumber + ': ' + e.message, {line_number: e.lineNumber, url: e.url});
                    editorGotoFileLine(e.url, e.lineNumber, undefined, true);
                } else {
                    alert('Error in game at ' + e.url + ':' + e.lineNumber + ':  ' + e.message);
                }
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
                
                // Force mode graph tab to be generated if useIDE is true
                if (useIDE) {
                    visualizeModes(document.getElementById('modeEditor'));
                }
                
                restartProgram(skipStartAnimation ? RESET_ANIMATION_LENGTH.NONE : useIDE ? RESET_ANIMATION_LENGTH.SHORT : RESET_ANIMATION_LENGTH.REGULAR);
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
        if (useIDE) {
            // Erase the table
            debugWatchTable = {};
            updateDebugWatchDisplay();
        }

        // Reload the program
        if (loadManager && loadManager.status !== 'complete' && loadManager.status !== 'failure') {
            console.log('Load already in progress...');
        } else if (useIDE && ! skipStartAnimation) {
            if (savesPending === 0) {
                // Force a reload of the game
                console.log('Reloading in case of external changes.')
                loadGameAndConfigureUI(window.gameURL, doPlay, false);
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
                            onPlayButton(slow, skipStartAnimation, args);
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


/* Optional loc = { line_number, url, fcn } used for creating hyperlinks and displaying output */
function setErrorStatus(e, loc) {
    if (e instanceof Error) {
        // Internal quadplay error
        console.log(e.stack);
    }

    e = escapeHTMLEntities(e);

    if (loc) {
        if (loc.line_number !== undefined) {
            e = `${loc.fcn ? loc.fcn + ' at ' : ''}<a style="font-family: Arial; cursor:pointer">${shortURL(loc.url)}:${loc.line_number}</a>: ${e}`;
        } else if (loc.url) {
            e = `${loc.fcn ? loc.fcn + ' at ' : ''}${shortURL(loc.url)}: ${e}`;
        } else if (loc.fcn) {
            e = loc.fcn + ': ' + e;
        }
    }

    if (useIDE) {
        error.innerHTML = e;
        if (e !== '') {
            $outputAppend(`\n<span style="color:#f55">${e}<span>\n`, loc, loc !== undefined);
            document.getElementById('outputTab').checked = true;
        }
    } else if (e !== '') {
        e = e.replace(/<.+?>/g, '').replace(/&quot;/g,'"').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<');
        alert(e);
        console.log(e);
    }
}


/** Called by reset_game() as well as the play and reload buttons to
    reset all game state and load the game.  */
function restartProgram(numStartAnimationFrames) {
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
            QRuntime.$numStartAnimationFrames = numStartAnimationFrames;
            lastAnimationRequest = setTimeout(mainLoopStep, 0);
            emulatorKeyboardInput.focus({preventScroll: true});
            if (useIDE) {
                updateDebugger(true);
                firstPrintOrWatch = true;
            }            
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
    if (useIDE) {
        editorGotoFileLine(e.url, e.lineNumber, undefined, true);
    } else {
        alert('Error in game at ' + e.url + ':' + e.lineNumber + ':  ' + e.message);
    }
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


function handleDropdownClose(event) {
    /*
    // Hide modal dialogs
    if (event.target.classList.contains('modal') && (event.target !== document.getElementById('waitDialog'))) {
        event.target.classList.add('hidden');
    }
    */

    // Don't close dropdowns if clicking on the console menu button or within a dropdown menu
    const target = event.target;
    const isConsoleMenuButton = target.id === 'consoleMenuButton' || target.parentElement?.id === 'consoleMenuButton';
    const isWithinDropdown = target.closest('.dropdown');
    
    if (!isConsoleMenuButton && !isWithinDropdown) {
        // Hide dropdown menus if this isn't the menu button or within a dropdown
        closeDropdowns();
    }
}

// On click doesn't seem to reliably happen on mobile
window.onclick = handleDropdownClose;
window.ontouchend = handleDropdownClose; 


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

/**Shows the system menu or controls menu.
  -  `why`:
    - 'system': Shows the main system menu with options like resume, credits, controllers, etc.
    - 'controls': Shows the system menu and immediately pushes to the controls menu */
function onSystemMenuButton(why) {
    assert(!useIDE);
    if (QRuntime) {

        if (why === 'system') {
            // Fake a keyboard event (could also set QRuntime.$goToSystemMenu = 'system')
            const buttonCode = 'KeyP';
            const fakeEvent = {code: buttonCode, stopPropagation:Math.abs, preventDefault:Math.abs}
            
            onEmulatorKeyDown(fakeEvent);
            emulatorButtonState[buttonCode] = 1;
            setTimeout(function() {
                onEmulatorKeyUp(fakeEvent);
                emulatorButtonState[buttonCode] = 0;
            });

        } else {
            {
            /*
            if (QRuntime.$gameMode.$name[0] === '$') {
                // Already in a system menu. Treat as pressing P
                // to exit that menu
                QRuntime.$goToSystemMenu = 'cancel';
            } else {
                */
                QRuntime.$goToSystemMenu = why;
            }
        }
    }

    // Put the focus back on the emulator
    emulatorKeyboardInput.focus({preventScroll:true});
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
    if (welcomeScreenChallenge) {
        onAppWelcomeTouch();
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
        
    case 70: // F
        if (useIDE && (event.ctrlKey || event.metaKey)) {
            if (event.shiftKey) {
                // Ctrl+Shift+F = find in files
                event.preventDefault();
                event.stopPropagation();
                showFindInFilesDialog();
            }
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
        useSoftTabs: true,
        tabSize: 4,
        fixedWidthGutter: true,
        navigateWithinSoftTabs: true,
        cursorStyle: 'smooth',
        vScrollBarAlwaysVisible: true,
        displayIndentGuides: true}); // true is the default
    
    // Save when losing focus
    aceEditor.on('blur', runPendingSaveCallbacksImmediately);

    // Ace's default "go to line" dialog is confusing, so
    // we replace it with our friendlier one.
    aceEditor.commands.addCommand({
        name: "go to line",
        bindKey: {win: "Ctrl-G", linux: "Ctrl-G", mac: "Command-G"},
        exec: onCodeEditorGoToLineButton});

    // Add custom undo/redo commands to ensure they work properly
    aceEditor.commands.addCommand({
        name: "undo",
        bindKey: {win: "Ctrl-Z", linux: "Ctrl-Z", mac: "Command-Z"},
        exec: function(editor) { editor.undo(); }});
        
    aceEditor.commands.addCommand({
        name: "redo",
        bindKey: {win: "Ctrl-Y", linux: "Ctrl-Y", mac: "Command-Shift-Z"},
        exec: function(editor) { editor.redo(); }});

    // Add custom context menu for ace editor
    aceEditor.container.addEventListener('contextmenu', function(event) {
        event.preventDefault();
        showEditorContextMenu(event);
        return false;
    });
}


function saveIDEState() {
    // Never save in kiosk mode
    if (getQueryString('kiosk') === '1') { return; }

    const options = {
        'uiMode': uiMode,
        'autoPauseEnabled': autoPauseEnabled,
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
        'keyboardMappingMode': keyboardMappingMode,
        'integerScalingEnabled': document.getElementById('integerScalingEnabled').checked        
    };

    // Find the selected debugger tab
    {
        const array = document.getElementById('debuggerPane').children;
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



// Callback for iframe reloading
function setIFrameScroll(iframe, x, y) {
    const html = iframe.contentWindow.document.getElementsByTagName('html')[0];
    html.scrollLeft = x;
    html.scrollTop = y;
}



function escapeHTMLEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

/* ImageData from context.createImageData. updateImageData.data is a Uint8Clamped RGBA buffer */
let updateImageData;

/* Uint32 view of updateImageData buffer */
let updateImageData32;

let error = document.getElementById('error');

/* If preserveImage is true, avoid flicker by saving the old framebuffer contents.
   Used when the framebuffer is resized by a game instead of on start. */
function setFramebufferSize(w, h, privateScreen, preserveImage) {
    if (privateScreen === undefined) {
        // Keep the same state as before by default
        privateScreen = PRIVATE_VIEW;
    }

    // Preserve the image during scaling to prevent flicker.
    // This happens rarely (during resizes), no reason to force willReadFrequently and CPU
    // canvas storage
    const oldImage = preserveImage ? ctx.getImageData(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT) : undefined;
    
    // Trigger the actual resize
    emulatorScreen.width = w;
    emulatorScreen.height = h;

    if (preserveImage) {
        // Restore old image
        ctx.putImageData(oldImage, 0, 0);
    }

    SCREEN_WIDTH = w;
    SCREEN_HEIGHT = h;
    PRIVATE_VIEW = privateScreen;

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

    // Check that there are no extra padding bytes in the allocated framebuffer
    console.assert(updateImageData.data.byteOffset === 0 && updateImageData.data.byteLength === updateImageData.data.buffer.byteLength);

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
    const b = document.getElementById(ctrl + 'Button');
    if (b) { b.disabled = ! e; }

    const container = document.getElementById(ctrl + 'ButtonContainer');
    if (e) {
        container.classList.remove('disabled');
    } else {
        container.classList.add('disabled');
    }
}

/** Called by the ui mode frame toggle buttons */
function onToggle(button) {
    const win = document.getElementById(button.id.replace('Button', 'Window'));
    if (win) {
        if (button.checked) { win.classList.remove('hidden'); }
        else                { win.classList.add('hidden'); }
    }
}



/** Called by the ui mode frame radio buttons */
function onRadio(id) {
    // Controls
    if ((id === 'playButton')) {
        onPlayButton();
    } else if ((id === 'slowButton') && ((emulatorMode !== 'play') || (targetFramerate !== SLOW_FRAMERATE))) {
        onSlowButton();
    } else if ((id === 'pauseButton') && (emulatorMode === 'play')) {
        onPauseButton();
    } else if ((id === 'stopButton') && (emulatorMode !== 'stop')) {
        onStopButton();
    } else if ((id === 'stepButton') && (emulatorMode !== 'step')) {
        onStepButton();
    }

    // UI Layout
    if ((id === 'emulatorUIButton') && (uiMode !== 'Emulator')) {
        setUIMode('Emulator');
    } else if ((id === 'testUIButton') && (uiMode !== 'Test')) {
        setUIMode('Test');
        // Test mode works better with the rollout unpinned
        localStorage.setItem('projectPinButtonEnabled', false);
        document.body.classList.remove('projectPinned');
        if (document.getElementById('projectPinButton')) {
            document.getElementById('projectPinButton').checked = false;
        }
    } else if ((id === 'IDEUIButton') && (uiMode !== 'IDE')) {
        setUIMode('IDE');
    } else if ((id === 'wideIDEUIButton') && (uiMode !== 'WideIDE')) {
        setUIMode('WideIDE');
    } else if ((id === 'maximalUIButton') && (uiMode !== 'Maximal')) {
        setUIMode('Maximal');
    } else if (! isMobile && (id === 'windowedUIButton') && (uiMode !== 'Windowed')) {
        setUIMode('Windowed');
    } else if ((id === 'editorUIButton') && (uiMode !== 'Editor')) {
        setUIMode('Editor');
    } else if ((id === 'ghostUIButton') && (uiMode !== 'Ghost')) {
        setUIMode('Ghost');
        // Ghost mode doesn't work well without the rollout pinned
        localStorage.setItem('projectPinButtonEnabled', true);
        document.body.classList.add('projectPinned');
        if (document.getElementById('projectPinButton')) {
            document.getElementById('projectPinButton').checked = true;
        }
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
            
        loadGameAndConfigureUI(game_url, function () {
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

setControlEnable('pause', false);
let coroutine = null;
let emwaFrameTime = 0;

/* Load the quadplay "OS" */
function goToLauncher() {
    onStopButton(false, true);
    loadGameAndConfigureUI(launcherURL, function () {
        onResize();
        // Prevent the boot animation
        onPlayButton(false, true);
    }, true);
}


// Reset the touch input state for next frame
function resetTouchInput() {
    if (mouse.movement_x !== undefined) {
        mouse.movement_x = mouse.movement_y = 0;
    }
    mouse.wheel_dx = mouse.wheel_dy = 0;
    QRuntime.touch.pressed_a = QRuntime.touch.released_a = 0;
}

// Invoked by requestAnimationFrame() or setTimeout. 
function mainLoopStep() {
    // Keep the callback chain going
    if (emulatorMode === 'play') {
        if (autoPauseEnabled && (Date.now() - lastInteractionTime > IDLE_PAUSE_TIME_MILLISECONDS)) {
            onInactive();
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
            //console.log(`setInterval(..., ${interval}), targetFramerate = ${targetFramerate}`);
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
            restartProgram(RESET_ANIMATION_LENGTH.NONE);
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
                
                default:// 'launcher', 'ide'
                    goToLauncher();
            }
        } else if (e.launch_game !== undefined) {
            console.log('Loading because launch_game() was called.');
            loadGameAndConfigureUI(e.launch_game, function () {
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


// Injected as assert in QRuntime
function assert(x, m) {
    if (! x) {
        throw new Error(m || "Assertion failed");
    }
}

/* The URL that will be used inside of the runtime */
function getRuntimeGameURL() {
    return gameSource ? (gameSource.jsonURL || '').replace(location.href.replace(/\?.*/, ''), '') : '';
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
        conduitNetwork.reset_conduits();
        QRuntime.$resize_framebuffer(SCREEN_WIDTH, SCREEN_HEIGHT);
        QRuntime.reset_clip();

        // Initialize the virtual GPU memory
        QRuntime.$set_texture(spritesheetArray, fontArray);
        QRuntime.$quit_action = quitAction;

        // Don't bother updating the mode graph if the IDE isn't loaded. That is, in exported
        // more
        QRuntime.$updateIDEModeGraph = useIDE ? $updateIDEModeGraph : function () {};
        
        QRuntime.$window             = window;
        // Remove any base URL that appears to include the quadplay URL
        QRuntime.$gameURL            = getRuntimeGameURL();
        QRuntime.$debugPrintEnabled  = document.getElementById('debugPrintEnabled').checked && useIDE;
        QRuntime.$assertEnabled      = document.getElementById('assertEnabled').checked && useIDE;
        QRuntime.$todoEnabled        = document.getElementById('todoEnabled').checked && useIDE;
        QRuntime.$debugWatchEnabled  = document.getElementById('debugWatchEnabled').checked && useIDE;
        QRuntime.$showEntityBoundsEnabled = document.getElementById('showEntityBoundsEnabled').checked && useIDE;
        QRuntime.$showPhysicsEnabled = document.getElementById('showPhysicsEnabled').checked && useIDE;
        QRuntime.$onScreenHUDEnabled = document.getElementById('onScreenHUDEnabled').checked && useIDE;
        QRuntime.$debug_watch        = useIDE ? debug_watch : function () {};
        QRuntime.$debug_print        = useIDE ? debug_print : function () {};
        QRuntime.assert              = assert;
        QRuntime.$parse              = $parse;
        QRuntime.$submitFrame        = submitFrame;
        QRuntime.$requestInput       = requestInput;
        QRuntime.$updateInput        = updateInput;
        QRuntime.$resetTouchInput    = resetTouchInput;
        QRuntime.$systemPrint        = $systemPrint;
        QRuntime.$outputAppend       = $outputAppend;
        QRuntime.$parseHexColor      = parseHexColor;
        QRuntime.$Physics            = Matter;
        QRuntime.$updateHostCodeCopyRuntimeDialogVisiblity = updateHostCodeCopyRuntimeDialogVisiblity;
        QRuntime.$fontMap            = fontMap;
        QRuntime.$onScreenHUDDisplay = useIDE ? onScreenHUDDisplay : undefined;

        QRuntime.$pauseAllSounds     = pauseAllSounds;
        QRuntime.$resumeAllSounds    = resumeAllSounds;
        QRuntime.makeEuroSmoothValue = makeEuroSmoothValue;
        QRuntime.$navigator          = navigator;
        QRuntime.$version            = version;
        QRuntime.$prompt             = prompt;
        QRuntime.evaluate_constant_expression = evaluate_constant_expression;

        QRuntime.$LZString           = LZString;

        // Conduit API is entirely implemented outside of the runtime files
        QRuntime.make_conduit        = conduitNetwork.make_conduit;
        QRuntime.conduit_iterate     = conduitNetwork.conduit_iterate;
        QRuntime.conduit_send        = conduitNetwork.conduit_send;
        QRuntime.conduit_close       = conduitNetwork.conduit_close;
        QRuntime.set_node_netid      = conduitNetwork.set_node_netid;
        QRuntime.get_node_netid      = conduitNetwork.get_node_netid;
        QRuntime.get_conduit_online_status = conduitNetwork.get_conduit_online_status;
        QRuntime.reset_conduits      = conduitNetwork.reset_conduits;
        QRuntime.conduit_listen      = conduitNetwork.conduit_listen;

        QRuntime.make_http           = make_http;
        QRuntime.http_poll           = http_poll;

        // When the game forces a framebuffer change, preserve the background to prevent flicker
        QRuntime.$setFramebufferSize = function (w, h, p) { setFramebufferSize(w, h, p, true); };
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
        QRuntime.$hideOnlineMenu     = hideOnlineMenu;
        QRuntime.$isOffline          = isOffline;
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

        const padXFramesGetter = {
            enumerable: true,
            get: function () {
                return this.$x_frames;
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

        const padYFramesGetter = {
            enumerable: true,
            get: function () {
                return this.$y_frames;
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
                    const ss = {x: mouse.screen_x, y: mouse.screen_y};
                    return QRuntime.transform_ss_to_ws(ss);
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
            Object.defineProperty(pad, 'x_frames', padXFramesGetter);
            Object.defineProperty(pad, 'y', padYGetter);
            Object.defineProperty(pad, 'dy', dyGetter);
            Object.defineProperty(pad, 'yy', padYYGetter);
            Object.defineProperty(pad, 'y_frames', padYFramesGetter);
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
            released_a: 0
        };

        // Intentional error property to avoid typos
        Object.defineProperty(QRuntime.touch, 'a_pressed', {get: function () { throw 'No touch.a_pressed property exists. Use touch.pressed_a'; }});
        Object.defineProperty(QRuntime.touch, 'a_released', {get: function () { throw 'No touch.a_released property exists. Use touch.released_a'; }});
        Object.defineProperty(QRuntime.touch, 'xy', {
            enumerable: true,
            get: function () {
                return QRuntime.transform_ss_to_ws(this.screen_xy);
            }
        });
    
        Object.defineProperty(QRuntime.touch, 'dxy', {
            enumerable: true,
            get: function () {
                // Transform both ends of the vector and then subtract
                const delta  = QRuntime.transform_ss_to_ws(this.screen_dxy);
                const origin = QRuntime.transform_ss_to_ws({x: 0, y: 0});

                return {
                    x: delta.x - origin.x,
                    y: delta.y - origin.y
                };
            }
        });
        Object.defineProperty(QRuntime.touch, 'x', {
            enumerable: true,
            get: function () {
                return this.xy.x;
            }
        });
        Object.defineProperty(QRuntime.touch, 'y', {
            enumerable: true,
            get: function () {
                return this.xy.y;
            }
        });
        Object.defineProperty(QRuntime.touch, 'dx', {
            enumerable: true,
            get: function () {
                return this.dxy.x;
            }
        });
        Object.defineProperty(QRuntime.touch, 'dy', {
            enumerable: true,
            get: function () {
                return this.dxy.y;
            }
        });
        Object.defineProperty(QRuntime.touch, 'screen_xy', {
            enumerable: true,
            get: function () {
                return {x: this.screen_x, y: this.screen_y};
            }
        });
        Object.defineProperty(QRuntime.touch, 'screen_dxy', {
            enumerable: true,
            get: function () {
                return {x: this.screen_dx, y: this.screen_dy};
            }
        });
        Object.defineProperty(QRuntime.touch, 'hover', hoverGetter);
        Object.seal(QRuntime.touch);
        
        QRuntime.gamepad_array = Object.seal([0, 0, 0, 0]);
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
                
                $x: 0, $dx: 0, $xx: 0, $x_frames: 0,
                $y: 0, $dy: 0, $yy: 0, $y_frames: 0,
                $angle:0, $dangle:0,
                a:0, b:0, c:0, d:0, e:0, f:0, $p:0, q:0,
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
    redefineConstant(environment, 'QUADPLAY_INFO', {version: version}, alreadySeen);
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
    // SCREEN_SIZE will not be present, so allow the following expression to fail to
    // undefined. Also allow support for games that have NO constants defined
    // at all in the JSON.
    const gameJSON = gameSource.json.constants ? nestedGet(gameSource.json.constants, key, true, true) : undefined;
    
    if (gameJSON && (gameJSON.type === 'object' || gameJSON.type === 'array') && gameJSON.url === undefined) {
        // Recursive case (note that values loaded from urls are
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
    console.assert(json.url === undefined);

    const newObj = json.type === 'array' ? [] : {};
    for (let k in value) {
        const j = json.value[k];
        const v = value[k];

        const dj = debugJson && debugJson.value[k];
        const dv = debugValue && debugValue[k];

        let newValue;

        if ((j.type === 'array' || j.type === 'object') && j.url === undefined) {
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


/**
   Parses identifier expressions such as "foo.bar[0]" or 'foo["bar"].baz'.
   Returns {base, modifiers} where modifiers is [{op, expr}].
   op is '[' or '.', expr is a string, integer, or identifier (string).
 */
function parseIdentifierExpression(input) {
    const baseMatch = input.match(/^\s*([^\s\[\]"\()\.]+)/);
    if (! baseMatch) { throw "Cannot parse"; }
    
    const base = baseMatch[1];
    const modifier_array = [];
    let remaining = input.slice(baseMatch[0].length);
    
    while (remaining.length > 0) {
        const modMatch = remaining.match(/^\s*(\[("([^"]*)"|(\d+))\]|\.([^\s\[\]"\()\.]+))/);
        if (! modMatch) { break; }

        modifier_array.push({
            op: modMatch[1][0] === '[' ? '[' : '.',
            expr: modMatch[3] ? modMatch[3] : 
                        modMatch[4] ? parseInt(modMatch[4]) : modMatch[5]
        });
        remaining = remaining.slice(modMatch[0].length);
    }
    
    return {base, modifier_array};
}


/* 
   Handles:
   
   - simple constant literals
   - literal object or array definitions (that do not reference ASSET or CONSTANT values)
   - identifier expressions from ASSET or CONSTANT that use only strings, identifiers, and integers

For example, these are legal inputs:
``````````````````````````````````````
   "nil" 
   "foo.bar[\"hello\"]"
   "#E1B"
   "32"
   "true"
   "spritesheet[1][7]"
``````````````````````````````````````
 */
function evaluate_constant_expression(expr) {
    console.assert(QRuntime.ASSETS);
    expr = expr.trim();

    // Color literals
    if (expr[0] === '#') {
        return parseHexColor(json.value.substring(1));
    }

    // Try to parse as a simple constant
    const {result, next, isError} = $parse(expr);

    // Trivial case of a simple constant
    if (! isError) {
        return result;
    }

    // Constant or asset. Parse the expression
    const {base, modifier_array} = parseIdentifierExpression(expr);

    let value;
    if (QRuntime.ASSETS.hasOwnProperty(base)) {
        value = QRuntime.ASSETS[base];
    } else if (QRuntime.CONSTANTS.hasOwnProperty(base)) {
        value = QRuntime.CONSTANTS[base];
    } else {
        throw `Illegal expression in evaluate_constant_expression(): "${expr}"`;
    }

    for (const modifier of modifier_array) {
        if (value === undefined) {
            throw "Cannot evaluate proprties of a nil asset or constant in evaluate_constant_expression()";
        } else {
            value = value[modifier.expr];
        }
    }
    return value;
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

let qrcode;

// Delay until after load to prevent a race condition of loading the QR code library script
setTimeout(function () {
    computeQRCode.qrcode = new QRCode('hiddenQRCode', {correctLevel: QRCode.CorrectLevel.H, width:128, height:128});
    // computeQRCode('http://192.168.1.69:8000/Projects/quadplay-dev/console/quadplay.html?game=/Projects/quadplay-dev/examples/private_view/');

    qrcode = 
        useIDE &&
        new QRCode('serverQRCode',
            {width:  256,
            height: 256,
            colorDark: "rgba(0,0,0,0)",
            colorLight: "#eee",
            correctLevel: QRCode.CorrectLevel.H
            });});

setTimeout(updateControllerIcons, 100);


const BOOT_INFO = `<span style="color:#ec5588">quadplay✜ ${version}</span>
<span style="color:#937ab7">© 2019-2025 Morgan McGuire</span>
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


/* Used for importSaveGame() and exportSaveGame() */
function getSaveGameMetadata() {
    const url = getRuntimeGameURL();

    return {
        type: 'savegame',
        save_format_version: '2025.08.05.10',
        quadplay_version: version,
        game_version: gameSource.extendedJSON.version,
        // Date of the data inside the save
        save_date: QRuntime.load_local('$modified_date') || 'Thu, 01 Jan 1970 00:00:00 GMT',
        // Date of this save / now
        export_date: new Date().toString(),
        game_title: gameSource.json.title,
        game_name: url.match(/\/([^\/]+)\.game\.json/)[1],
        game_url: url,
    };
}


/* This could be called from a timer or in-game, but since import requires an input event
   in practice we made both into explicit menu items. This is outside of the quadplay abstraction,
   so it can require a mouse and not be solely gamepad based. */
function exportSaveGame() {
   // This forms the header for the downloaded file
   const metadata = getSaveGameMetadata();
   const metadataString = JSON.stringify(metadata);

    // Extract all game state from localStorage
    const gameState = localStorage.getItem('GAME_STATE_' + metadata.game_url);

    // Create a binary blob consisting of:
    //
    //  - 32-bit integer of the size of the metadataString in bytes
    //  - The metadataString
    //  - A binary zipfile of the gameState

    // Create the blob with metadata header and zipped gameState
    const metadataBytes = new TextEncoder().encode(metadataString);
    const metadataSizeBytes = new ArrayBuffer(4);
    // Store the little-endian size in the first four bytes
    new DataView(metadataSizeBytes).setUint32(0, metadataBytes.length, true); 
    
    // Compress the gameState using JSZip
    const zip = new JSZip();
    zip.file('gamestate.json', gameState || '{}');
    
    // Generate the zip file as a blob (async)
    zip.generateAsync({type: 'arraybuffer'}).then(function(zipBlob) {
        // Combine metadata size, metadata, and zip data into final blob
        const blob = new Blob([metadataSizeBytes, metadataBytes, zipBlob], {type: 'application/octet-stream'});
        
        // Download the blob as a file with timestamp
        const now = new Date();
        const dateStr = now.getFullYear() + '-' + 
            String(now.getMonth() + 1).padStart(2, '0') + '-' + 
            String(now.getDate()).padStart(2, '0') + '_' + 
            String(now.getHours()).padStart(2, '0') + '-' + 
            String(now.getMinutes()).padStart(2, '0');
        const filename = metadata.game_name + '_' + dateStr + '.savegame';

        // Download the blob as a file
        download(URL.createObjectURL(blob), filename);
    });
}


/* This must be called from an input event to satisfy browser security */
function importSaveGame(event) {
    console.log(event);
    const file = event.target.files[0];
    if (! file) { return; }

    const destMetadata = getSaveGameMetadata();

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const arrayBuffer = e.target.result;
            const dataView = new DataView(arrayBuffer);
            
            // Read the 32-bit metadata size (little-endian)
            const metadataSize = dataView.getUint32(0, true);
            
            // Extract the metadata string
            const metadataBytes = new Uint8Array(arrayBuffer, 4, metadataSize);
            const metadataString = new TextDecoder().decode(metadataBytes);
            const sourceMetadata = JSON.parse(metadataString);
            
            // Extract the zip data (everything after metadata)
            const zipData = arrayBuffer.slice(4 + metadataSize);
            
            // Decompress the game state using JSZip
            JSZip.loadAsync(zipData).then(function(zip) {
                return zip.file('gamestate.json').async('string');
            }).then(function(gameStateString) {
                const gameState = gameStateString;
                
                // General validation - check type
                if (sourceMetadata.type !== 'savegame') {
                    alert(`This is not a valid ${destMetadata.game_title} savegame file.`);
                    return;
                }
                
                // Game name validation
                if (sourceMetadata.game_title !== destMetadata.game_title || 
                    sourceMetadata.game_name !== destMetadata.game_name ||
                    sourceMetadata.game_url !== destMetadata.game_url) {
                    
                    const message = `This savegame appears to be from a different game:\n\n` +
                        `File: ${sourceMetadata.game_title} v${sourceMetadata.game_version} (${sourceMetadata.game_url})\n` +
                        `Current: ${destMetadata.game_title} v${destMetadata.game_version} (${destMetadata.game_url})\n\n` +
                        `It could destroy ` +
                        `your local save for the current game, which cannot be recovered.\n\n` +
                        `Do you still want to proceed?`;
                    
                    if (! confirm(message)) {
                        return;
                    }
                }
                
                // Date validation
                const sourceDate = new Date(sourceMetadata.save_date);
                const currentDate = new Date(destMetadata.export_date);
                const localSaveDate = new Date(destMetadata.save_date);
                
                if (sourceDate > currentDate) {
                    const message = `The import savegame has a date newer than today's date. At least one of the computers has a corrupt clock and so it is impossible to know if this file is newer than your local save. Do you still want to overwrite?`;
                    if (! confirm(message)) {
                        return;
                    }
                }
                
                // Final confirmation
                const newerOlder = sourceDate > localSaveDate ? 'newer' : '!!! OLDER !!!';
                const finalMessage = `Overwrite current local save\n\n` +
                    `  ${destMetadata.game_title} from ${localSaveDate.toLocaleString()}\n\n` +
                    `with ${newerOlder} save\n\n` +
                    `  ${sourceMetadata.game_title} from ${sourceDate.toLocaleString()}?`;
                
                if (! confirm(finalMessage)) {
                    return;
                }
                
                // Write to localStorage
                localStorage.setItem('GAME_STATE_' + destMetadata.game_url, gameState);
                
                // Restart the game to force reload
                alert('Save game successfully imported.');

                restartProgram(0);
            }).catch(function(error) {
                console.error('Error decompressing save game:', error);
                alert('Error reading save game file. The file may be corrupted.');
            });
            
        } catch (error) {
            console.error('Error importing save game:', error);
            alert('Error loading save game file. Please check the file format.');
        }
    };
    reader.readAsArrayBuffer(file);

    // Force the game to restart immediately so that it loads fresh data
    onRestartButton();
}


/** If loadFast is true, do not make any cosmetic delays. This is typically
    set for hot reloads or after configuration changes.

    If noUpdateCode is true, do not update code editors. This is used to
    prevent cursor jump when that file is itself being further updated
    by typing in the editor. */
function loadGameAndConfigureUI(url, callback, loadFast, noUpdateCode) {
    const oldVersionControl = gameSource && gameSource.versionControl;
    
    // Hide these menu items until we know if they are needed
    document.getElementById('saveGameMenuSection').style.display = 'none';

    if ((url !== gameURL) && useIDE) {
        // A new game is being loaded. Throw away the editor sessions.
        removeAllCodeEditorSessions();
        setErrorStatus('');
    }
    
    // Stop the old game
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
    
    // Update checkbox state
    const checkbox = document.getElementById('autoPauseCheckbox');
    if (checkbox) {
        checkbox.checked = autoPauseEnabled || false;
        document.getElementById('autoPauseLabel').textContent = useIDE ? 'Pause when inactive' : 'Sleep when inactive';
    }
    
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

        loadGame(url, function () {
            onLoadFileComplete(url);
            hideBootScreen();
            page.document.title = gameSource.extendedJSON.title;

            // This is the IDE's export game menu, not the user export SAVE GAME menu
            const exportMenu = document.getElementById('exportMenu');
            if (isQuadserver && editableProject) {
                exportMenu.removeAttribute('disabled');
            } else {
                exportMenu.setAttribute('disabled', '');
            }

            // Only show the savegame menu item for regular games (not the launcher/OS), when in non-kiosk mode and
            // the game uses load_local or save_local (technically only one should be required, but
            // a game might do something wierd like save a key solely for the IDE to read.)
            // This DOES intentionally show these menu items when in the IDE.
            const showImportExport = (url !== launcherURL) && (getQueryString('kiosk') || '0') == '0' && (resourceStats.usesAPI['save_local'] || resourceStats.usesAPI['load_local']);
            document.getElementById('saveGameMenuSection').style.display = showImportExport ? 'block' : 'none';

            // Show arcade keyboard options based on game setting and IDE status
            const showArcadeKeyboard = useIDE || gameSource.json.show_arcade_keyboard_options;
            document.getElementById('arcadeKeyboardMenuSection').style.display = showArcadeKeyboard ? 'block' : 'none';

            console.log(`Loading complete (${Math.round(performance.now() - startTime)} ms)`);

            setFramebufferSize(gameSource.extendedJSON.screen_size.x, gameSource.extendedJSON.screen_size.y, false);
            if (useIDE) {
                updateTodoList();
                updateProgramDocumentation();
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
                    
                    const isSprite = resource.prop === 'spritePixels';
                    const sizeColumn = isSprite ? '<th width=80>Size</th>' : '';
                    s += `<table width=100%><tr><th style="text-align:left">File</th>${sizeColumn}<th width=120 colspan=2 style="text-align:right">${resource.units}</th></tr>\n`;
                    
                    for (const entry of entryArray) {
                        const fileName = entry[0].replace(/^.*\//, '');
                        const fullURL = entry[0];
                        
                        // Determine the appropriate onProjectSelect call based on resource type
                        let clickHandler = '';
                        if (resource.prop === 'spritePixels') {
                            // For sprites, find the corresponding asset
                            const assetName = Object.keys(gameSource.assets).find(name => {
                                const asset = gameSource.assets[name];
                                return asset.$url === fullURL || 
                                       (asset.spritesheet_table && Object.values(asset.spritesheet_table).some(sheet => sheet.$url === fullURL));
                            });
                            if (assetName) {
                                clickHandler = `onclick="onProjectSelect(document.getElementById('projectAsset_${assetName}'), 'asset', gameSource.assets['${assetName}'])"`;
                            }
                        } else if (resource.prop === 'sourceStatements') {
                            // For code files, use the script URL directly
                            clickHandler = `onclick="onProjectSelect(document.getElementById('ScriptItem_${fullURL}'), 'script', '${fullURL}')"`;
                        }
                        
                        const fileNameCell = clickHandler ? 
                            `<a style="cursor:pointer" ${clickHandler}>${fileName}</a>` : 
                            fileName;
                        
                        const dimensionsCell = isSprite ? `<td style="text-align:center">${resourceStats.spriteSizeByURL[entry[0]] || ''}</td>` : '';
                        s += `<tr><td>${fileNameCell}</td>${dimensionsCell}<td style="text-align:right">${Math.ceil(entry[1] * resource.scale)}${resource.suffix}</td><td width=0.5em></td></tr>\n`;
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
            }
            hideWaitDialog();

            if (callback) { callback(); }

            if (editableProject && serverConfig.hasGit) {
                if (! loadFast) {                          
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
            }

        }, function (e) {
            if (useIDE) {
                updateAllCodeEditorSessions();
            }
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

let gamepadButtonPressedWhileAppLoading = false;
window.addEventListener("gamepadconnected", function(e) {
    // Runs when the first gamepad button is pressed or when a
    // second gamepad connects.
    if (welcomeScreenChallenge) {
        if (document.getElementById('appLoadingOverlay')) {
            // Delay starting the welcome until load completes
            gamepadButtonPressedWhileAppLoading = true;
        } else {
            onAppWelcomeTouch();
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
        // in the quadplay.css #popupMessage.show animation property
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
window.addEventListener('blur', onInactive, false);

function onInactive() {
    // Block auto-pause while the welcome screen challenge is active
    if (welcomeScreenChallenge) {
        return;
    }

    // Don't do anything if already sleeping/paused or if auto-pause is disabled
    if (!autoPauseEnabled || isHosting || isGuesting || 
        (emulatorMode === 'pause') || 
        (document.getElementById('sleepOverlay').style.visibility === 'visible')) {
        return;
    }
    
    // Don't sleep while the intro controls screen is visible to avoid interfering with its animation
    // or during the first 60 frames of gameplay
    if ((document.getElementById('introControlsScreen').style.visibility === 'visible') || 
        ((QRuntime !== undefined) && (QRuntime.game_frames < 60))) {
        // Update last interaction time to prevent sleep.
        // This is necessary because the browser's sleep detection is based on a timeout since
        // user interaction. We need to re-set the timer when it expires during this lockout
        // period, otherwise it will immediately trigger when the game starts...on a black screen,
        // which will look like a crash to the user.
        updateLastInteractionTime();
        return;
    }
    
    if (useIDE) {
        onPauseButton();
    } else {
        sleep();
    }
}

    
function onActivatePage() {

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
            loadGameAndConfigureUI(window.gameURL, null, true);
        }
    }
}

window.addEventListener('focus', onActivatePage, false);

// Chromium memory saver/sleeping tabs seem to get 'resume' instead of 'focus'
document.addEventListener('resume', onActivatePage, false);

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


//////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Load state

backgroundPauseEnabled = (localStorage.getItem('backgroundPauseEnabled') !== 'false');

for (const option of [
    { name: 'showPhysicsEnabled', defaultValueString: 'false', isDOMElement: true  },
    { name: 'showPrivateViewsEnabled', defaultValueString: 'false', isDOMElement: true },
    { name: 'showEntityBoundsEnabled', defaultValueString: 'false', isDOMElement: true },
    { name: 'assertEnabled', defaultValueString: 'true', isDOMElement: true },
    { name: 'todoEnabled', defaultValueString: 'false', isDOMElement: true },
    { name: 'automathEnabled', defaultValueString: 'true', isDOMElement: true },
    { name: 'prettyPrintEnabled', defaultValueString: 'true', isDOMElement: true },
    { name: 'debugPrintEnabled', defaultValueString: 'true', isDOMElement: true },
    { name: 'debugWatchEnabled', defaultValueString: 'true', isDOMElement: true },
    { name: 'restartOnFocusEnabled', defaultValueString: 'false', isDOMElement: true },
    { name: 'autoplayOnLoad', defaultValueString: 'true', isDOMElement: true },
    { name: 'onScreenHUDEnabled', defaultValueString: 'false', isDOMElement: true },
    { name: 'printTouchEnabled', defaultValueString: 'false', isDOMElement: true },
    { name: 'integerScalingEnabled', defaultValueString: 'true', isDOMElement: true },
    { name: 'projectPinButtonEnabled', defaultValueString: 'true' }]) {
    
    if (option.isDOMElement) {
        const element = document.getElementById(option.name);
        if (element) {
            element.checked = JSON.parse(localStorage.getItem(option.name) ?? option.defaultValueString);
        } else {
            console.error(option.name + " HTML element not found");
        }
    } else if (localStorage.getItem(option.name) === null) {
        localStorage.setItem(option.name, option.defaultValueString);
    }
}



document.getElementById(localStorage.getItem('activeDebuggerTab') || 'performanceTab').checked = true;

setKeyboardMappingMode(localStorage.getItem('keyboardMappingMode') || 'Normal');




// Assign the action for QRuntime.quit_game() used by the in-game
// pause menu quit option
const quitAction = (function() {
    if (useIDE) {
        // When the IDE is on, always quit to the IDE
        return 'ide';
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



/* Checks for an update. Called on startup and once an hour (if not sleeping) when 
   update= is set. Used for IDE and standalone kiosk mode */
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



//////////////////////////////////////////////////////////////////////////////////////

// Load state
autoPauseEnabled = (localStorage.getItem('autoPauseEnabled') !== 'false');

if (getQueryString('kiosk') === '1') {
    // Hide the console menu and mode buttons
    document.getElementById('body').classList.add('kiosk');
    document.getElementById('body').classList.remove('noKiosk');
} else {
    document.getElementById('body').classList.remove('kiosk');
    document.getElementById('body').classList.add('noKiosk');
}

// Perform initial page and game load in maximal mode rather than showing the ununitialized
// layout. If not in IDE mode this will be overriden with a new mode when the game
// loads and we know if we need emulator controls.
if (! useIDE) {
    setUIMode('Maximal');
} else {
    localStorage.getItem('uiMode') || 'IDE';
}


initializeBrowserEmulator();
setErrorStatus('');
setCodeEditorFontSize(parseFloat(localStorage.getItem('codeEditorFontSize') || '14'));

// When not in the IDE, force the dots color scheme
setColorScheme(useIDE ? (localStorage.getItem('colorScheme') || 'dots') : 'dots');
{
    let tmp = gamepadOrderMap = (localStorage.getItem('gamepadOrderMap') || '0123').split('');
    for (let i = 0; i < tmp.length; ++i) {
        tmp[i] = parseInt(tmp[i]);
    }
    setGamepadOrderMap(tmp);
}

// Get the configuration if running on a quadplay server
if (isQuadserver) {
    LoadManager.fetchOne({}, location.origin + getQuadPath() + 'console/_config.json', 'json', null, function (json) {
        serverConfig = json;
    });
}

// As early as possible, make the browser aware that we want gamepads
navigator.getGamepads();


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
    const INITIAL_DELAY  = 5000;
    const REGULAR_PERIOD = 2 * 60 * 60 * 1000;
    setTimeout(function () {
        checkForUpdate();
        setInterval(function () {
            if (document.getElementById('sleepOverlay').style.visibility !== 'visible') {
                checkForUpdate();
            }
        }, REGULAR_PERIOD);
    }, INITIAL_DELAY);
}

// Set the initial size
setFramebufferSize(SCREEN_WIDTH, SCREEN_HEIGHT, false);

// Load the runtime FIRST, so that we know QRuntime is defined 
// (some game loading functions depend on it), and then trigger
// the game load second.
reloadRuntime(function () {
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
    loadGameAndConfigureUI(url, function () {
        
        // Set screen mode after checking for mobile_touch_gamepad in the game
        if (getQueryString('kiosk') !== '1') {
            let newMode = getQueryString('mode');
            if (! newMode || newMode === 'DefaultWindow') {
                if (useIDE) {
                    newMode = localStorage.getItem('uiMode') || 'IDE';
                } else {
                    newMode = 
                        isMobile ? 
                        ((gameSource.extendedJSON.mobile_touch_gamepad !== false) ? 
                            'Emulator' : 
                            'Maximal') :
                        'Windowed';
                }
            }
        
            // Embedded games that reload on quit start without fullscreen
            // so that the first touch launches them.
            const noFullscreen = ((getQueryString('quit') === 'reload') ||
                                  (newMode === 'Windowed'));
            
            setUIMode(newMode, noFullscreen);
        }

        const appLoadingOverlay = document.getElementById('appLoadingOverlay');
        if (appLoadingOverlay) {
            if (! useIDE) {
                // Done loading outside of the IDE.  Now show the
                // welcome screen. The appLoadingOverlay prevented
                // players from launching the game before loading
                // completed. The welcome screen forces an interaction
                // to lift browser restrictions.
                document.getElementById('appWelcomeOverlay').style.visibility = 'visible';
                
                if (gamepadButtonPressedWhileAppLoading) {
                    // Immediately push the welcome button if the player already
                    // pressed a gamepad button
                    onAppWelcomeTouch();
                }
            }
            
            // Remove the loading screen permanently now that page loading has completed
            appLoadingOverlay.remove();
        }

        if (useIDE) {
            onProjectSelect(null, 'game', gameSource.jsonURL);
            
            // Used for the open dialog's autoplay checkbox
            if (getQueryString('autoplay') === '1') {
                onPlayButton(false, true);
            }
        } // use IDE
    });
});