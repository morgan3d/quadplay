/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License*/
"use strict";

const deployed = true;
const version  = '2020.01.18.17'
const launcherURL = 'quad://console/launcher';

//////////////////////////////////////////////////////////////////////////////////
// UI setup

{
    const c = document.getElementsByClassName(isMobile ? 'noMobile' : 'mobileOnly');
    for (let i = 0; i < c.length; ++i) {
        c[i].style.display = 'none';
    }
}

function getQueryString(field) {
    const reg = new RegExp('[?&]' + field + '=([^&#]*)', 'i');
    const string = reg.exec(location.search);
    return string ? string[1] : null;
}

const fastReload = getQueryString('fastReload') === '1';

const useIDE = getQueryString('IDE') || false;
{
    const c = document.getElementsByClassName(useIDE ? 'noIDE' : 'IDEOnly');
    for (let i = 0; i < c.length; ++i) {
        c[i].style.display = 'none';
    }
}

// Hide quadplay framerate debugging info
if (! profiler.debuggingProfiler) {  document.getElementById('debugFrameTimeRow').style.display = 'none'; }

////////////////////////////////////////////////////////////////////////////////

// 'IDE', 'Test', 'Emulator', 'Maximal'. See also setUIMode().
let uiMode = 'IDE';

const BOOT_ANIMATION = Object.freeze({
    NONE:      0,
    SHORT:    32,
    REGULAR: 220
});

let SCREEN_WIDTH = 384, SCREEN_HEIGHT = 224;
let gameSource;

// The image being written during preview recording
let previewRecording = null;
let previewRecordingFrame = 0;

function clamp(x, lo, hi) { return Math.min(Math.max(x, lo), hi); }
function makeEuroSmoothValue(minCutoff, speedCoefficient) {  return new EuroFilter(minCutoff, speedCoefficient); }


function debugOptionClick(event) {
    const element = event.target;
    event.stopPropagation();
    if (element.id === 'wordWrapEnabled') {
        const outputDisplayPane = document.getElementById('outputDisplayPane');
        outputDisplayPane.style.whiteSpace = element.checked ? 'pre-wrap' : 'pre';
    } else {
        QRuntime['_' + element.id] = element.checked;
    }
    saveIDEState();
}


let colorScheme = 'pink';
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

    // Default to pink scheme
    let hrefColor = '#e61b9d';
    let emulatorColor = '#ff4488';

    switch (scheme) {
    case 'black':
        hrefColor = '#0af';
        emulatorColor = '#151515';
        break;
        
    case 'gold':
        hrefColor = '#dcb102';
        emulatorColor = '#b69206';
        break;

    case 'blue':
        hrefColor = '#0af';
        emulatorColor = '#1074b6';
        break;

    case 'green':
        hrefColor = '#47b52e';
        emulatorColor = '#337923';
    }
    
    // Find the relevant rules and remove them
    for (let i = 0; i < stylesheet.cssRules.length; ++i) {
        const rule = stylesheet.cssRules[i];
        if ((rule.selectorText === '#header a, .menu a') ||
            (rule.selectorText === '.emulator .emulatorBackground' && rule.style.background !== '')) {
            stylesheet.deleteRule(i);
            --i;
        }
    }
    // Replacement rules
    stylesheet.insertRule(`#header a, .menu a { color: ${hrefColor} !important; text-decoration: none; }`, 0);
    stylesheet.insertRule(`.emulator .emulatorBackground { background: ${emulatorColor}; ! important}`, 0);
    saveIDEState();
}

/* 
   Force mobile users to interact in order to enable the audio engine and
   full-screen.
 */
function onMobileWelcomeTouch() {
    const welcome = document.getElementById('mobileWelcome');
    welcome.style.zIndex = -100;
    welcome.style.visibility = 'hidden';
    welcome.style.display = 'none';

    unlockAudio();
    
    if (isMobile) {
        requestFullScreen();
    }
}


function unlockAudio() {
    // Play a silent sound in order to unlock audio on platforms
    // that require audio to first initiate on a click.
    //
    // https://paulbakaus.com/tutorials/html5/web-audio-on-ios/
    
    // create empty buffer
    var buffer = _ch_audioContext.createBuffer(1, 1, 22050);
    var source = _ch_audioContext.createBufferSource();
    source.buffer = buffer;
    
    // connect to output (your speakers)
    source.connect(_ch_audioContext.destination);
    
    // play the file
    if (source.noteOn) {
        source.noteOn(0);
    } else {
        source.start(0);
    }
}


function requestFullScreen() {
    // Full-screen the UI. This can fail if not triggered by a user interaction.
    try { 
        const body = document.getElementsByTagName('body')[0];
        if (body.requestFullscreen) {
            body.requestFullscreen();
        } else if (body.webkitRequestFullscreen) {
            body.webkitRequestFullscreen();
        } else if (body.mozRequestFullScreen) {
            body.mozRequestFullScreen();
        } else if (body.msRequestFullscreen) {
            body.msRequestFullscreen();
        }
    } catch (e) {}
}

let backgroundPauseEnabled = true;

function onBackgroundPauseClick(event) {
    event.stopPropagation();
    backgroundPauseEnabled = document.getElementById('backgroundPauseCheckbox').checked;
    saveIDEState();
}


function setUIMode(d, noAutoPlay) {
    if (! useIDE && (d === 'IDE' || d === 'Test')) {
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
    body.classList.remove('TestUI');
    body.classList.add(uiMode + 'UI');

    // Check the appropriate radio button
    document.getElementById({'IDE':'IDEUIButton', 'Emulator':'emulatorUIButton', 'Test':'testUIButton', 'Maximal':'maximalUIButton'}[uiMode]).checked = 1;

    if (((uiMode === 'Maximal') || (uiMode === 'Emulator')) && ! useIDE) {
        requestFullScreen();
    }

    // Need to wait for layout to update before the onResize handler
    // has correct layout sizes.
    setTimeout(onResize, 100);

    // Reset keyboard focus
    emulatorKeyboardInput.focus();
}


function onResize() {
    const body         = document.getElementsByTagName('body')[0];
    const background   = document.getElementsByClassName('emulatorBackground')[0];
    const screenBorder = document.getElementById('screenBorder');

    let scale = 1;
    
    switch (uiMode) {
    case 'IDE':
        // Revert to defaults. This has to be done during resize
        // instead of setUIMode() to have any effect.
        emulatorScreen.removeAttribute('style');
        screenBorder.removeAttribute('style');
        document.getElementById('debugger').removeAttribute('style');
        if (SCREEN_WIDTH <= 384/2 && SCREEN_HEIGHT <= 224/2) {
            // Half-size runs with pixel doubling
            scale = 2;
            screenBorder.style.transform = 'scale(' + scale + ') translate3d(0,0,0)';
            screenBorder.style.transformOrigin = 'left top';
        }
        background.removeAttribute('style');
        break;
        
    case 'Emulator':
        {
            // What is the largest multiple SCREEN_HEIGHT that is less than windowHeightDevicePixels?
            scale = Math.max(0, Math.min((window.innerHeight - 70) / SCREEN_HEIGHT, (window.innerWidth - 254) / SCREEN_WIDTH));
            
            if ((scale * window.devicePixelRatio <= 2.5) && (scale * window.devicePixelRatio > 1)) {
                // Round to nearest even multiple of the actual pixel size for small screens to
                // keep per-pixel accuracy
                scale = Math.floor(scale * window.devicePixelRatio) / window.devicePixelRatio;
            }
            
            // Setting the scale transform triggers really slow rendering on Raspberry Pi unless we
            // add the "translate3d" hack to trigger hardware acceleration.
            screenBorder.style.transformOrigin = 'center';
            screenBorder.style.transform = 'scale(' + scale + ') translate3d(0,0,0)';
            screenBorder.style.left = Math.round((window.innerWidth - screenBorder.offsetWidth) / 2) + 'px';
            screenBorder.style.top  = Math.round((window.innerHeight - screenBorder.offsetHeight - 16) / 2) + 'px';

            // Resize the background to bound the screen more tightly.
            // Only resize vertically because the controls need to
            // stay near the edges of the screen horizontally to make
            // them reachable on mobile.

            background.style.top = Math.round(Math.max(0, (window.innerHeight - Math.max(260, 90 + SCREEN_HEIGHT * scale)) / 2)) + 'px';
            background.style.height = Math.round(Math.max(230, SCREEN_HEIGHT * scale + 53)) + 'px';

            // Show the controls
            body.classList.add('fullscreenEmulator');
            break;
        }

    case 'Maximal':
    case 'Test':
        {
            // What is the largest multiple SCREEN_HEIGHT that is less than windowHeightDevicePixels?
            scale = Math.max(0, Math.min((window.innerHeight - 24) / SCREEN_HEIGHT, (window.innerWidth - 2) / SCREEN_WIDTH));
            
            if ((scale * window.devicePixelRatio <= 2.5) && (scale * window.devicePixelRatio > 1)) {
                // Round to nearest even multiple of the actual pixel size for small screens to
                // keep per-pixel accuracy
                scale = Math.floor(scale * window.devicePixelRatio) / window.devicePixelRatio;
            }
            
            // Setting the scale transform triggers really slow rendering on Raspberry Pi unless we
            // add the "translate3d" hack to trigger hardware acceleration.
            screenBorder.style.transform = 'scale(' + scale + ') translate3d(0,0,0)';
            screenBorder.style.left = Math.round((window.innerWidth - screenBorder.offsetWidth - 4) / 2) + 'px';
            screenBorder.style.transformOrigin = 'center top';
            if (uiMode === 'Test') {
                screenBorder.style.top = '0px';
                document.getElementById('debugger').style.top = Math.round(scale * screenBorder.offsetHeight + 25) + 'px';
            } else {
                const t = Math.round((window.innerHeight - screenBorder.offsetHeight * scale - 26) / 2) + 'px';
                screenBorder.style.top  = t;
            }
        }
        break;
    }

    screenBorder.style.width = SCREEN_WIDTH + 'px';
    screenBorder.style.height = SCREEN_HEIGHT + 'px';
    screenBorder.style.borderRadius = Math.ceil(6 / scale) + 'px';
    screenBorder.style.borderWidth  = Math.ceil(5 / scale) + 'px';
    screenBorder.style.boxShadow = `${1/scale}px ${2/scale}px ${2/scale}px 0px rgba(255,255,255,0.16), ${-1.5/scale}px {-2/scale}px ${2/scale}px 0px rgba(0,0,0,0.19)`;

    if (isSafari) {
        // Safari cannot perform proper CSS image scaling, so we have
        // to resize the underlying canvas and copy to it with nearest
        // neighbor interpolation.
        emulatorScreen.width = Math.round(SCREEN_WIDTH * scale);
        emulatorScreen.height = Math.round(SCREEN_HEIGHT * scale);
        emulatorScreen.style.transformOrigin = 'top left';
        emulatorScreen.style.transform = 'scale(' + (1 / scale) + ') translate3d(0,0,0)';
    }
}

window.addEventListener("resize", onResize, false);

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

const bootScreen = document.getElementById('bootScreen');
let emulatorScreen = document.getElementById("screen");

// Do not set desynchronized:true ...it is about 12% slower on Chrome 75!
let ctx = emulatorScreen.getContext("2d",
                                    {
                                        alpha: false,
                                        desynchronized: false
                                    });

function onHelp(event) { window.open('doc/specification.md.html', '_blank'); }

function download(url, name) {
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
        window.URL.revokeObjectURL(url);  
        document.body.removeChild(a);
    }, 0);
}


function onExportFile(event) {
    var src = codeEditor.getValue();
    var filename = getFilename(getTitle(src));
    if (filename) {
        // Convert unicode to a downloadable binary data URL
        download(window.URL.createObjectURL(new Blob(['\ufeff', src])), filename);
    } else {
        alert('The program must begin with #nanojam and a title before it can be exported');
    }
}


function onOpenButton() {
    const url = window.prompt("Game URL", "");
    if (url) {
        onStopButton();
        loadGameIntoIDE(url, function () {
            onPlayButton();
        });
    }
}

function onHomeButton() {
    onStopButton();
    loadGameIntoIDE(launcherURL, function () {
        onResize();
        // Preven the boot animation
        onPlayButton(false, true);
    });
}

/** True if the game is running on the same server as the quadplay console */
function locallyHosted() {
    return location.href.replace(/(^http.?:\/\/[^/]+\/).*/, '$1') === window.gameURL.replace(/(^http.?:\/\/[^/]+\/).*/, '$1');
}

function testPost() {
    // TODO: Editor
    return; // This function is not currently needed, so it is disabled in the main build
    
    if (! locallyHosted()) {
        // This server can't modify the game files
        return;
    }
    
    const serverAddress = location.href.replace(/(^http.?:\/\/[^/]+\/).*/, '$1');
                          
    const xhr = new XMLHttpRequest();
    xhr.open("POST", serverAddress, true);

    // Send the proper header information along with the request
    xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    
    xhr.onreadystatechange = function() {
        if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
            // Request finished. Do processing here.
        }
    }
    
    xhr.send(JSON.stringify("test post data"));
}

    
function onRestartButton() {
    onStopButton();
    onPlayButton();
}


let lastAnimationRequest = 0;
function onStopButton(inReset) {
    if (! inReset) {
        document.getElementById('stopButton').checked = 1;
        setControlEnable('pause', false);
        emulatorMode = 'stop';
        saveIDEState();
    }

    stopAllSounds();
    coroutine = null;
    clearTimeout(lastAnimationRequest);
    ctx.clearRect(0, 0, emulatorScreen.width, emulatorScreen.height);
}

function onSlowButton() {
    onPlayButton(true);
}

// Allows a framerate to be specified so that the slow button can re-use the logic.
//
// isLaunchGame = "has this been triggered by QRuntime.launchGame()"
// args = array of arguments to pass to the new program
function onPlayButton(slow, isLaunchGame, args) {
    if (isSafari && ! isMobile) { unlockAudio(); }
    
    testPost();
    targetFramerate = slow ? SLOW_FRAMERATE : PLAY_FRAMERATE;
    
    function doPlay() {
        if (slow) {
            document.getElementById('slowButton').checked = 1;
        } else {
            document.getElementById('playButton').checked = 1;
        }
        document.getElementById('playButton').checked = 1;
        setControlEnable('pause', true);
        _ch_audioContext.resume();
    
        setErrorStatus('');
        emulatorMode = 'play';
        profiler.reset();

        previewRecordingFrame = 0;
        previewRecording = null;
        
        if (! coroutine) {
            outputDisplayPane.innerHTML = '';
            compiledProgram = '';
            try {
                compiledProgram = compile(gameSource, fileContents, false);
                setErrorStatus('');
            } catch (e) {
                e.message = e.message.replace(/^line \d+: /i, '');
                if (e.message === 'Unexpected token :') {
                    e.message += ', possible due to a missing { on a previous line';
                }
                
                setErrorStatus('Error: ' + e.url + ', line ' + e.lineNumber + ': ' + e.message);
                if (isSafari) {
                    console.log('_currentLineNumber = ' + QRuntime._currentLineNumber);
                }
                console.log(e);
            }
            
            if (compiledProgram) {
                if (! deployed && useIDE) { console.log(compiledProgram); }
                
                // Ready to execute. Reload the runtime and compile and launch
                // this code within it.
                programNumLines = compiledProgram.split('\n').length;

                restartProgram(isLaunchGame ? BOOT_ANIMATION.NONE : useIDE ? BOOT_ANIMATION.SHORT : BOOT_ANIMATION.REGULAR);
            } else {
                programNumLines = 0;
                onStopButton();
            }
            
        } else {
            lastAnimationRequest = requestAnimationFrame(mainLoopStep);
            emulatorKeyboardInput.focus();
        }
        
        saveIDEState();
    }

    if (emulatorMode === 'play') {
        emulatorKeyboardInput.focus();
        return;
    } else if (emulatorMode === 'stop') {
        // Reload the program
        if (loadManager.status !== 'complete' && loadManager.status !== 'failure') {
            console.log('Load already in progress...');
        } else {
            console.log('\n');
            if (useIDE && ! isLaunchGame) {
                // Force a reload of the game
                loadGameIntoIDE(window.gameURL, doPlay);
            } else {
                // Just play the game, no reload required because
                // we are in user mode.
                doPlay();
            }
        }
    } else {
        console.assert(emulatorMode === 'step' || emulatorMode === 'pause');
        // Was just paused
        resumeAllSounds();
        doPlay();
        emulatorKeyboardInput.focus();
    }

}

const controlSchemeTable = {
    Quadplay: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓒ',
        '(d)': 'ⓓ',
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
        '(p)': 'STR',
        '(q)': 'SEL',
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
        '(q)': 'SEL',
        '(p)': 'STR',
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
        '(p)': 'OPT',
        '(q)': 'SHR',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    XboxOne: {
        '(a)': 'ⓐ',
        '(b)': 'ⓑ',
        '(c)': 'ⓧ',
        '(d)': 'ⓨ',
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
        '(q)': '⊲',
        '(p)': '⊳',
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
        '(p)': 'STR',
        '(q)': 'SEL',
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
        '(q)': 'R',
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
        '(q)': 'L',
        '(p)': '⊖',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    Keyboard: {
        '(a)': '␣',
        '(b)': '⏎',
        '(c)': 'ⓒ',
        '(d)': 'ⓕ',
        '(p)': 'ⓟ',
        '(q)': 'ⓠ',
        '[^]': 'W',
        '[<]': 'A',
        '[v]': 'S',
        '[>]': 'D'
    },

    Kbd_Alt: {
        '(a)': '␣',
        '(b)': '⏎',
        '(c)': 'ⓒ',
        '(d)': 'ⓕ',
        '(p)': 'ⓟ',
        '(q)': 'ⓠ',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },

    Kbd_P1: {
        '(a)': 'V',
        '(b)': 'G',
        '(c)': 'C',
        '(d)': 'F',
        '(p)': '4',
        '(q)': '1',
        '[^]': 'W',
        '[<]': 'A',
        '[v]': 'S',
        '[>]': 'D'
    },

    Kbd_P2: {
        '(a)': '/',
        '(b)': "'",
        '(c)': '.',
        '(d)': ';',
        '(p)': '0',
        '(q)': '7',
        '[^]': 'I',
        '[<]': 'J',
        '[v]': 'K',
        '[>]': 'L'
    },

    HOTAS: {
        '(a)': '1',
        '(b)': '2',
        '(c)': '4',
        '(d)': '3',
        "(p)": 'ST',
        '(q)': 'SE',
        '[^]': '⍐',
        '[<]': '⍇',
        '[v]': '⍗',
        '[>]': '⍈'
    },
};

// Create aliases
for (const name in controlSchemeTable) {
    const scheme = controlSchemeTable[name];
    scheme['ⓐ'] = scheme['(a)'];
    scheme['ⓑ'] = scheme['(b)'];
    scheme['ⓒ'] = scheme['(c)'];
    scheme['ⓓ'] = scheme['(d)'];
    scheme['ⓟ'] = scheme['(p)'];
    scheme['ⓠ'] = scheme['(q)'];
    scheme['⍐'] = scheme['[^]'];
    scheme['⍗'] = scheme['[v]'];
    scheme['⍇'] = scheme['[<]'];
    scheme['⍈'] = scheme['[>]'];
    Object.freeze(scheme);
}


/** Called by resetGame() as well as the play and reload buttons to
    reset all game state and load the game.  */
function restartProgram(numBootAnimationFrames) {
    reloadRuntime(function () {
        try {
            // Inject the constants into the runtime space
            makeConstants(QRuntime, gameSource.constants);
            makeAssets(QRuntime, gameSource.assets);
        } catch (e) {
            // Compile-time error
            onStopButton();
            setErrorStatus(e);
        }
        
        // Create the main loop function in the QRuntime environment so
        // that it sees those variables.
        try {
            coroutine = QRuntime._makeCoroutine(compiledProgram);
            QRuntime._numBootAnimationFrames = numBootAnimationFrames;
            lastAnimationRequest = requestAnimationFrame(mainLoopStep);
            emulatorKeyboardInput.focus();
        } catch (e) {
            // "Link"-time or run-time on a script error
            onStopButton();
            e = jsToNSError(e);
            setErrorStatus('file ' + e.url + ' line ' + clamp(1, e.lineNumber, programNumLines) + ': ' + e.message);
            return;
        }
    });
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
        pauseAllSounds();
    }
}


function inModal() { return false; }

function onDocumentKeyDown(event) {
    switch (event.which || event.keyCode) {
    case 121: // F10
        event.preventDefault();
        if (! inModal() && useIDE) {
            onStepButton();
        }
        break;

    case screenshotKey: // F6
        downloadScreenshot();
        break;

    case 71: // G
        if (! (event.ctrlKey || event.metaKey)) { break; }
        // Otherwise, Ctrl+G was pressed, so fall through
    case gifCaptureKey: // F8
        if (event.shiftKey) {
            if (! previewRecording) {
                startPreviewRecording();
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

    case 80: // P
        if (event.ctrlKey || event.metaKey) { // Ctrl+P
            // Don't print!
            // Intercept from browser
            event.preventDefault();
        }
        break;
        
        
    case 82: // R
        if (event.ctrlKey || event.metaKey) { // Ctrl+R
            // Intercept from browser
            event.preventDefault();
            if (! inModal()) { onRestartButton(); }
        }
        break;

    case 67: // C
        if (! event.ctrlKey && ! event.metaKey) {
            return;
        }
        // Fall through
            
    case 19: // [Ctrl+] Break
        if (useIDE) { onPauseButton(); }
        break;
    }
}

document.addEventListener('keydown', onDocumentKeyDown);

var jsCode = document.getElementById('jsCode') && ace.edit(document.getElementById('jsCode'));
var editorStatusBar = document.getElementById('editorStatusBar');
var aceEditor = ace.edit('codeEditor');

aceEditor.setTheme('ace/theme/tomorrow_night_bright');

// Stop auto-completion of parentheses
aceEditor.setBehavioursEnabled(false);

let aceSession = aceEditor.getSession();
aceSession.setTabSize(3);
aceSession.setUseSoftTabs(true);

// Hide the syntax parsing "errors" from misinterpreting the source as JavaScript
aceEditor.session.setUseWorker(false);
aceEditor.setOptions({fontSize:'13px', showPrintMargin:false});
aceSession.setMode('ace/mode/nano');
aceSession.setUseWrapMode(false);


function saveIDEState() {
    const options = {
        'uiMode': uiMode,
        'backgroundPauseEnabled': backgroundPauseEnabled,
        'colorScheme': colorScheme,
        'showPhysicsEnabled': document.getElementById('showPhysicsEnabled').checked,
        'showEntityBoundsEnabled': document.getElementById('showEntityBoundsEnabled').checked,
        'assertEnabled': document.getElementById('assertEnabled').checked,
        'debugWatchEnabled': document.getElementById('debugWatchEnabled').checked,
        'debugPrintEnabled': document.getElementById('debugPrintEnabled').checked
    };

    for (let name in options) {
        localStorage.setItem(name, options[name]);
    }
}


let soundEditorCurrentSound = null;
function onProjectSelect(target, type, object) {
    
    // Hide all editors
    const editorPane = document.getElementById('editorPane');
    for (let i = 0; i < editorPane.children.length; ++i) {
        editorPane.children[i].style.visibility = 'hidden';
    }

    const gameEditor     = document.getElementById('gameEditor');
    const codeEditor     = document.getElementById('codeEditor');
    const modeEditor     = document.getElementById('modeEditor');
    const spriteEditor   = document.getElementById('spriteEditor');
    const soundEditor    = document.getElementById('soundEditor');
    const constantEditor = document.getElementById('constantEditor');
    const mapEditor      = document.getElementById('mapEditor');
    const docEditor      = document.getElementById('docEditor');
    
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

    if (type === 'doc') {
        // Documents
        target.classList.add('selectedProjectElement');
        showGameDoc(docEditor, object.name, object.url);
        docEditor.style.visibility = 'visible';
        return;
    }

    if (type === 'game') {
        if (target) { target.classList.add('selectedProjectElement'); }
        visualizeGame(gameEditor, gameSource.jsonURL, gameSource.json);
        gameEditor.style.visibility = 'visible';
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
        const index = object;
        const c = gameSource.constants[object];
        if (typeof c === 'string') {
            constantEditor.innerHTML = index + ' <input type="text" autocomplete="false" disabled value="' + c + '">';
        } else if (c === undefined) {
            constantEditor.innerHTML = index + ' = nil';
        } else if (typeof c === 'number') {
            constantEditor.innerHTML = index + ' <input style="width:50px" type="number" step="1" autocomplete="false" disabled value="' + c + '">';
        } else if (typeof c === 'boolean') {
            constantEditor.innerHTML = '<input type="checkbox" autocomplete="false" disabled "' + (c ? 'checked' : '') + '> ' + index;
        } else {
            // Object or array
            const L = Object.keys(c).length;
            if ((L <= 4) && (c.r !== undefined) && (c.g !== undefined) && (c.b !== undefined) && ((c.a !== undefined) || (L === 3))) {
                constantEditor.innerHTML = index + ` <div style="background: rgb(${255 * c.r}, ${255 * c.g}, ${255 * c.b}); width: 50px; height: 16px; display: inline-block"> </div><br/>(${QRuntime.unparse(c)})`;
            } else {
                let s = QRuntime.unparse(c);
                if (s.length > 16) {
                    constantEditor.innerHTML = index + ' = <table>' + visualizeConstant(c, '') + '</table>';
                } else {
                    constantEditor.innerHTML = index + ' = ' + escapeHTMLEntities(s);
                }
            }
        }
        constantEditor.style.visibility = 'visible';
        break;
        
    case 'mode':
    case 'script':
        let contents;
        if (type === 'mode') {
            contents = fileContents[object.url];
        } else {
            contents = fileContents[object];
        }
        aceEditor.setValue(contents || '');
        aceEditor.gotoLine(0, 0, false);
        aceEditor.scrollToLine(0, false, false, undefined);
        codeEditor.style.visibility = 'visible';
        break;
        
    case 'asset':
        const url = object._url || object.src;
        if (/\.png$/i.test(url)) {
            // Sprite or font
            spriteEditor.style.visibility = 'visible';
            spriteEditor.style.backgroundImage = `url("${url}")`;
            const spriteEditorHighlight = document.getElementById('spriteEditorHighlight');
            const spriteEditorPivot = document.getElementById('spriteEditorPivot');
            const spriteEditorInfo = document.getElementById('spriteEditorInfo');

            if (object._type === 'spritesheet') {
                const spritesheetName = object._name.replace(/.* /, '');
                spriteEditor.onmousemove = spriteEditor.onmousedown = function (e) {
                    const editorBounds = spriteEditor.getBoundingClientRect();

                    // The spritesheet is always fit along the horizontal axis
                    const scale = editorBounds.width / object.size.x;
                    
                    const mouseX = e.clientX - editorBounds.left;
                    const mouseY = e.clientY - editorBounds.top;
                    
                    const scaledSpriteWidth = object.spriteSize.x * scale;
                    const scaledSpriteHeight = object.spriteSize.y * scale;

                    spriteEditorPivot.style.fontSize = Math.round(clamp(Math.min(scaledSpriteWidth, scaledSpriteHeight) * 0.18, 5, 25)) + 'px';

                    const X = Math.floor(mouseX / scaledSpriteWidth);
                    const Y = Math.floor(mouseY / scaledSpriteHeight);

                    spriteEditorHighlight.style.left   = Math.floor(X * scaledSpriteWidth) + 'px';
                    spriteEditorHighlight.style.top    = Math.floor(Y * scaledSpriteHeight) + 'px';
                    spriteEditorHighlight.style.width  = Math.floor(scaledSpriteWidth) + 'px';
                    spriteEditorHighlight.style.height = Math.floor(scaledSpriteHeight) + 'px';
                    
                    const sprite = object[X] && object[X][Y];
                    if (sprite) {
                        const pivot = sprite.pivot || {x: 0, y: 0};
                        spriteEditorPivot.style.visibility = 'visible';
                        spriteEditorPivot.style.left = Math.floor(scale * (sprite.pivot.x + sprite.size.x / 2) - spriteEditorPivot.offsetWidth / 2) + 'px';
                        spriteEditorPivot.style.top = Math.floor(scale * (sprite.pivot.y + sprite.size.y / 2) - spriteEditorPivot.offsetHeight / 2) + 'px';
                            
                        let str = `${spritesheetName}[${X}][${Y}]`;
                        if (sprite._animationName) {
                            str += `<br>${spritesheetName}.${sprite._animationName}`
                            if (sprite._animationIndex !== undefined) {
                                const animation = object[sprite._animationName];
                                str += `[${sprite._animationIndex}]<br>extrapolate: "${animation.extrapolate || 'clamp'}"`;
                            }
                        }

                        str += `<br>duration: ${sprite.duration}`;
                        spriteEditorInfo.innerHTML = str;
                        
                        if (X > object.length / 2) {
                            //spriteEditorInfo.style.textAlign = 'right';
                            spriteEditorInfo.style.float = 'right';
                            spriteEditorHighlight.style.textAlign = 'right';
                        } else {
                            spriteEditorInfo.style.float = 'none';
                            spriteEditorHighlight.style.textAlign = 'left';
                        }
                        spriteEditorInfo.style.marginTop = Math.floor(scaledSpriteHeight + 5) + 'px';
                        spriteEditorHighlight.style.visibility = 'inherit';
                    } else {
                        // Out of bounds
                        spriteEditorHighlight.style.visibility = 'hidden';
                        spriteEditorPivot.style.visibility = 'hidden';
                    }
                };
                
                // Initial position
                const editorBounds = spriteEditor.getBoundingClientRect();
                spriteEditor.onmousemove({clientX: editorBounds.left, clientY: editorBounds.top});
            } else {
                spriteEditorHighlight.style.visibility = 'hidden';
                spriteEditorPivot.style.visibility = 'hidden';
            }
        } else if (/\.mp3$/i.test(url)) {
            soundEditor.style.visibility = 'visible';
            soundEditorCurrentSound = fileContents[url];
        } else if (/\.tmx$/i.test(url)) {
            visualizeMap(object);
            mapEditor.style.visibility = 'visible';
        }
        break;
    }
}


function showGameDoc(docEditor, name, url) {
    // Strip anything sketchy that looks like an HTML attack from the URL
    url = url.replace(/" ></g, '');
    if (url.endsWith('.html')) {
        docEditor.innerHTML = `<embed id="doc" width="125%" height="125%" src="${url}"></embed>`;
    } else if (url.endsWith('.md')) {
        // Trick out .md files using Markdeep
        loadManager = new LoadManager({
            errorCallback: function () {
            },
            forceReload: true});
        loadManager.fetch(url, 'text', null,  function (text) {
            // Set base URL and add Markdeep processing
            const base = urlDir(url);
            const markdeepURL = makeURLAbsolute('', 'quad://doc/markdeep.min.js');

            // Escape quotes to avoid ending the srcdoc prematurely
            text = `<base href='${base}'>\n${text.replace(/"/g, '&quot;')}
                <style>
body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #444 }

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
            docEditor.innerHTML = `<iframe id="doc" srcdoc="${text}" border=0 width=125% height=125%></iframe>`;
        }),
        loadManager.end();
    } else {
        // Treat as text file
        docEditor.innerHTML = `<object id="doc" width="125%" height="125%" type="text/plain" data="${url}" border="0"> </object>`;
    }

}


/** Called from visualizeModes(). Attempts to resolve intersections if
    these arrays of points cross each other. Treats them as polylines
    for simpler intersection determination even though we actually
    render using quadratic beziers. These could be subdivided if more
    accuracy was important, but since this function is only used for
    some layout heuristics, that is not currently justified. */
function resolveModeGraphEdgeIntersection(pointsA, dirA, pointsB, dirB) {
    // dirA/B are +/-1 for the iteration direction. If positive, then
    // the shared endpoint (at which to swap) is at index 0, otherwise
    // it is at index n
    // Compare all sublines
    let intersect = false;
    for (let i = 0; (i < pointsA.length - 1) && ! intersect; ++i) {
        for (let j = 0; (j < pointsB.length - 1) && ! intersect; ++j) {
            intersect = linesIntersect(pointsA[i], pointsA[i + 1], pointsB[j], pointsB[j + 1]);
        } // j
    } // i

    if (intersect) {
        // Indices of the points nearest the shared node
        const a = (dirA === 1) ? 0 : pointsA.length - 1;
        const b = (dirB === 1) ? 0 : pointsB.length - 1;

        // Swap two end points
        const temp = pointsA[a]; pointsA[a] = pointsB[b]; pointsB[b] = temp;

        // Remove any intermediate point that comes immediately before these
        // end points in a curve. This is an attempt to straighten the line
        // near the shared node while avoiding creating collisions with other nodes.
        if (pointsA.length > 2) { pointsA.splice(a + dirA, 1) }
        if (pointsB.length > 2) { pointsB.splice(b + dirB, 1) }
    }
}


/** Returns true if line segment AC intersects BD */
function linesIntersect(A, C, B, D) {
    // Simplified from https://github.com/pgkelley4/line-segments-intersect/blob/master/js/line-segments-intersect.js
    // by ignoring the parallel cases
    
    const dA = QRuntime._sub(C, A);
    const dB = QRuntime._sub(D, B);
    const diff = QRuntime._sub(B, A);

    const numerator = QRuntime.cross(diff, dA);
    const denominator = QRuntime.cross(dA, dB);

    if (Math.max(Math.abs(denominator), Math.abs(numerator)) < 1e-10) {
        // Parallel cases
        return false;
    }

    const u = numerator / denominator;
    const t = QRuntime.cross(diff, dB) / denominator;

    // Intersect within the segments
    return (t >= 0) && (t <= 1) && (u >= 0) && (u <= 1);
}


function visualizeModes(modeEditor) {
    // dagre API: https://github.com/dagrejs/graphlib/wiki/API-Reference#graph-api
    
    function nodeToHTMLColor(node) {
        if (node.label === 'Play') {
            // Force the Play node to white. It is almost always near
            // the center of the graph and nearly white anyway, but
            // this improves contrast.
            return '#fff';
        }
        
        const x = Math.min(1, Math.max(0, 1.5 * node.x / graph._label.width - 0.25));
        const y = Math.min(1, Math.max(0, 1.5 * node.y / graph._label.height - 0.25));

        // Use a Red-Cyan-Yellow color wheel
        let r = Math.max(Math.sqrt(1 - x), Math.max(2 * y - 0.8, 0));
        let g = Math.max(Math.sqrt((x*0.95+0.05) * y), 0.6 * Math.pow(Math.max(2 * (1 - y) - 1, 0), 2));
        let b = Math.sqrt((x*0.95+0.05) * Math.sqrt(1.1 - y));

        // Boost around the green primary
        g += 0.5 * x * Math.max(0, (1 - Math.abs(y - 0.6) * 2));
        
        // Maximize value
        const m = Math.max(r, g, b);
        r /= m; g /= m; b /= m;

        // Decrease saturation
        const s = 0.65;
        // Code to decrease saturation radially, no longer needed now that
        // we special-case the "Play" mode:
        //  s = Math.min(1, Math.pow(Math.hypot(x - 0.5, y - 0.5), 2) * 1.7);

        // Reduce saturation and convert to [0, 255]
        r = Math.round((r * s + (1 - s)) * 255);
        g = Math.round((g * s + (1 - s)) * 255);
        b = Math.round((b * s + (1 - s)) * 255);
        return `rgb(${r}, ${g}, ${b})`;
    }
    
    // Get nodes
    const nodeArray = [], nodeTable = {};
    let startNode = null;
    for (let m = 0; m < gameSource.modes.length; ++m) {
        const mode = gameSource.modes[m];
        const name = mode.name.replace(/^.*\/|\*/g, '');
        // Skip system modes
        if (name[0] === '_') { continue; }
        const isStart = (mode.name.indexOf('*') !== -1);
        const node = {name:name, label:name, edgeArray:[], isStart:isStart};
        if (isStart) { startNode = node; }
        nodeArray.push(node);
        nodeTable[name] = node;
    }

    if (! startNode) {
        setErrorStatus('No starting node specified.');
        return;
    }

    const setModeRegexp = /\b(setMode|pushMode)\s*\(([^,_)]+)\)(?:\s*because\s*"([^"\n]*)")?/g;
    const resetGameRegexp = /\bresetGame\s*\(\s*(?:"([^"]*)")?\s*\)/g;

    // Modes that have links back to their parent mode, whether
    // entered by setMode or pushMode. These have to be processed
    // after all other links are discovered.
    let backLinks = [];
    
    // Get edges for each node
    for (let m = 0; m < gameSource.modes.length; ++m) {
        const mode = gameSource.modes[m];
        const name = mode.name.replace(/^.*\/|\*/g, '');
        // Skip system modes
        if (name[0] === '_') { continue; }
        const code = fileContents[mode.url];

        const edgeArray = nodeTable[name].edgeArray;
        for (let match = setModeRegexp.exec(code); match; match = setModeRegexp.exec(code)) {
            const to = nodeTable[match[2]];
            if (to) {
                edgeArray.push({to:to, label:match[3], type:match[1]});
            } else {
                setErrorStatus(mode.url + ': setMode to nonexistent mode ' + match[2]);
                return;
            }
        } // for each setMode statement

        for (let match = resetGameRegexp.exec(code); match; match = resetGameRegexp.exec(code)) {
            edgeArray.push({to:startNode, label:match[1], type:'resetGame'});
        } // for each setMode statement
    } // for each mode

    //////////////////////////////////////////////////////////////////////////////////////
    // Convert to the layout API
    const graph = new dagre.graphlib.Graph({directed:true, multigraph:true});
    const nodeWidth = 112, nodeHeight = 28;
    graph.setGraph({rankdir: 'LR'});
    graph.setDefaultEdgeLabel(function() { return {}; });

    let edgeId = 0;
    for (let n = 0; n < nodeArray.length; ++n) {
        const node = nodeArray[n];
        // Make the play node a little larger than the others
        const s = node.label === 'Play' ? 1.3 : 1;
        graph.setNode(node.name,
                      {label:    node.label,
                       width:    s * nodeWidth,
                       height:   s * nodeHeight,
                       isStart:  node.isStart});

        for (let e = 0; e < node.edgeArray.length; ++e) {
            const edge = node.edgeArray[e];
            graph.setEdge(node.name, edge.to.name,
                          {label:     edge.label,
                           width:     edge.label ? edge.label.length * 3.5 : 0,
                           height:    8,
                           labelpos: 'c',
                           bidir:    (edge.type === 'pushMode')
                          }, 'edge' + edgeId);
            ++edgeId;
        }
    }
    
    // Compute layout on the mode graph
    dagre.layout(graph);

    // Render the mode graph to SVG
    let svg = `<svg class="modeGraph" width=${graph._label.width + 40} height=${graph._label.height + 60} viewbox="-20 -30 ${graph._label.width + 40} ${graph._label.height + 40}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`;
    svg += `<defs><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" y="-25%" height="150%" flood-opacity="0.5" filterUnits="userSpaceOnUse"/></filter>
<filter id="outerglow">
<feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-opacity="1.0" flood-color="#302b2b" filterUnits="userSpaceOnUse"/>
<feDropShadow dx="0" dy="0" stdDeviation="1" flood-opacity="1.0" flood-color="#302b2b" filterUnits="userSpaceOnUse"/>
</filter>
</defs>`

    // If there are two edges that share a node which cross each other
    // when rendered, see if swapping their rendering endpoints eliminates
    // the crossing. This tends to occur because incoming edges always
    // go to the bottom of nodes and outgoing edges always go to the top.

    graph.nodes().forEach(function(n) {
        const edges = graph.nodeEdges(n);
        edges.forEach(function(e1) {
            const edge1 = graph.edge(e1);
            edges.forEach(function(e2) {
                const edge2 = graph.edge(e2);
                // Only perform comparisons one way; use the Y axis to arbitrarily distingish order
                if ((e1 !== e2) && (edge1.points[0].y < edge2.points[0].y)) {
                    resolveModeGraphEdgeIntersection(edge1.points, (e1.v === n) ? 1 : -1, edge2.points, (e2.v === n) ? 1 : -1);
                }
            }); // edge2
        }); // edge1
    }); // nodes
    
    let i = 0;
    graph.edges().forEach(function(e) {
        const edge = graph.edge(e);

        // Inherit color from the start node
        edge.color = nodeToHTMLColor(graph.node(e.v));
        edge.endColor = nodeToHTMLColor(graph.node(e.w));
        const points = edge.points;
        
        // Define arrow head
        svg += `<defs>
    <marker id="arrowhead${i}" markerWidth="8" markerHeight="8" refX="7" refY="2" orient="auto" position="95%">
      <path d="M 0 0 L 0 4 L 6 2 z" fill="${edge.color}" />
    </marker>
  </defs>`;

        // Browsers have weird svg-filter issues (that affect shadow
        // rendering) with small objects in SVG, even if they have
        // correct bounding boxes.  Compute our own bounds bounds for the curve
        // to detect too-small boxes.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < points.length; ++i) {
            minX = Math.min(minX, points[i].x); minY = Math.min(minY, points[i].y);
            maxX = Math.max(maxX, points[i].x); maxY = Math.max(maxY, points[i].y);
        }
        const tooSmall = Math.min(maxX - minX, maxY - minY) < 8;
        
        // Define bidirectional arrow
        if (edge.bidir) {
            // Set the x1,y1 and x2,y2 based on the path direction
            const first = points[0], last = points[points.length - 1];
            const x1 = (last.x > first.x) ? minX : maxX;
            const y1 = (last.y > first.y) ? minY : maxY;
            const x2 = (last.x > first.x) ? maxX : minX;
            const y2 = (last.y > first.y) ? maxY : minY;

            // gradientUnits="userSpaceOnUse" is needed to support perfectly horizontal lines
            // with zero vertical extent
            svg += `<defs>
    <marker id="endarrowhead${i}" markerWidth="8" markerHeight="8" refX="0" refY="2" orient="auto" position="5%">
      <path d="M 0 2 L 6 0 L 6 4 z" fill="${edge.endColor}" />
    </marker>
    <linearGradient id="gradient${i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${edge.endColor}"/>
      <stop offset="100%" stop-color="${edge.color}"/>
    </linearGradient>
  </defs>`;
        }

        svg += `<path class="edge" stroke="${edge.bidir ? 'url(#gradient' + i + ')' : edge.color}" marker-end="url(#arrowhead${i})" `;
        if (tooSmall) {
            svg += 'style="filter:none" ';
        }

        if (edge.bidir) {
            svg += `marker-start="url(#endarrowhead${i}" `;
        }

        svg += `d="M ${points[0].x} ${points[0].y} `;

        if (edge.points.length === 2) {
            // Line
            svg += `L ${points[1].x} ${points[1].y}`;
        } else if (edge.points.length === 3) {
            // Quadratic bezier
            svg += `Q ${points[1].x} ${points[1].y}, ${points[2].x} ${points[2].y} `;           
        } else if (edge.points.length === 4) {
            // Never observed to be generated by dagre
            svg += `C ${points[1].x} ${points[1].y}, ${points[2].x} ${points[2].y}, ${points[3].x} ${points[3].y} `;
        } else if (edge.points.length >= 5) {
            // Quadratic bezier with a line in the center. Yse a
            // polyline for that central linear part in case something
            // unexpected happened and there actually are intermediate
            // nodes off the line.
            const N = points.length;
            svg += `Q ${points[1].x} ${points[1].y}, ${points[2].x} ${points[2].y} `;
            for (let i = 3; i < N - 2; ++i) {
                svg += `L ${points[i].x} ${points[i].y} `;
            }
            svg += `Q ${points[N - 2].x} ${points[N - 2].y}, ${points[N - 1].x} ${points[N - 1].y} `;
        }

        svg += '"/>';
        ++i;
    });

    // Labels on top of edges
    graph.edges().forEach(function(e) {
        const edge = graph.edge(e);
        if (edge.label) { svg += `<text class="edgeLabel" x="${edge.x}" y="${edge.y}" fill="${edge.color}">${escapeHTMLEntities(edge.label)}</text>`; }
    });

    // Nodes on top of everything
    graph.nodes().forEach(function(v) {
        const node = graph.node(v);
        // enlarge the nodes to account for rounded rect
        node.width += 8; node.height += 8;
        
        svg += `<rect x="${node.x - node.width / 2}" y="${node.y - node.height / 2}" width="${node.width}" height="${node.height}" rx="16" ry="16" fill="${nodeToHTMLColor(node)}"class="node"/>`;
        if (node.isStart) {
            // Highlight the start node
            svg += `<rect x="${node.x - node.width / 2 + 2}" y="${node.y - node.height / 2 + 2}" width="${node.width - 4}" height="${node.height - 4}" fill="none" rx="14" ry="14" stroke="#302b2b"/>`;
        }
        svg += `<text class="nodeLabel" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}">${node.label}</text>`;
    });

    svg += '</svg>';
    modeEditor.innerHTML = svg;
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
            v = escapeHTMLEntities(QRuntime.unparse(v));
            s += `<tr valign=top><td>${indent}${k}:</td><td></td><td><code>${v}</code></td></tr>\n`;
        }
    }
    
    return s;
}


function visualizeGame(gameEditor, url, game) {
    let s = '<table>';
    s += '<tr valign="top"><td width="110px">Title</td><td><input type="text" autocomplete="false" style="width:384px" disabled value="' + game.title + '"></td></tr>\n';
    s += '<tr valign="top"><td>Developer</td><td><input type="text" autocomplete="false" style="width:384px" disabled value="' + game.developer + '"></td></tr>\n';
    s += '<tr valign="top"><td>Copyright</td><td><input type="text" autocomplete="false" style="width:384px" disabled value="' + game.copyright + '"></td></tr>\n';
    s += '<tr valign="top"><td>License</td><td><textarea disabled style="width:384px; padding: 3px; font-family: Helvetica, Arial; font-size:12px" rows=4>' + game.license + '</textarea></td></tr>\n';
    s += `<tr valign="top"><td>Screen&nbsp;Size</td><td><input type="text" autocomplete="false" style="width:384px" disabled value="${gameSource.json.screenSize.x} × ${gameSource.json.screenSize.y}"></td></tr>\n`;
    s += `<tr valign="top"><td></td><td><label><input type="checkbox" autocomplete="false" style="margin-left:0" disabled ${game.flipY ? 'checked' : ''}>Flip Y Axis</label></td></tr>\n`;
    s += '<tr valign="top"><td>Path</td><td>' + url + '</td></tr>\n';

    const baseURL = url.replace(/\/[^\/]*$/, '');
    s += '<tr valign="top"><td>64px&nbsp;Label</td><td><img alt="label64.png" src="' + baseURL + '/label64.png" style="border:1px solid #fff; image-rendering: crisp-edges; image-rendering: pixelated; width:64px; height:64px"></td></tr>\n';
    s += '<tr valign="top"><td>128px&nbsp;Label</td><td><img alt="label128.png" src="' + baseURL + '/label128.png" style="border:1px solid #fff; image-rendering: crisp-edges; image-rendering: pixelated; width:128px; height:128px"></td></tr>\n';
    s += '</table>';
    gameEditor.innerHTML = s;
}


function visualizeMap(map) {
    const width  = map.length;
    const height = map[0].length;
    const depth  = map.layer.length;

    const maxDim = Math.max(width * map.spriteSize.x, height * map.spriteSize.y);
    
    const reduce = (maxDim > 4096) ? 4 : (maxDim > 2048) ? 3 : (maxDim > 1024) ? 2 : 1;

    const dstTileX = Math.max(1, Math.floor(map.spriteSize.x / reduce));
    const dstTileY = Math.max(1, Math.floor(map.spriteSize.y / reduce));

    const canvas = document.getElementById('mapDisplayCanvas');
    canvas.width = width * dstTileX;
    canvas.height = height * dstTileY;
    const mapCtx = canvas.getContext('2d');

    const dstImageData = mapCtx.createImageData(width * dstTileX, height * dstTileY);
    const dstData = new Uint32Array(dstImageData.data.buffer);
    for (let mapZ = 0; mapZ < depth; ++mapZ) {
        const z = map.zScale < 0 ? depth - mapZ - 1 : mapZ;
        for (let mapY = 0; mapY < height; ++mapY) {
            const y = map._flipYOnLoad ? height - mapY - 1 : mapY;
            for (let mapX = 0; mapX < width; ++mapX) {
                const sprite = map.layer[z][mapX][y];
                if (sprite) {
                    const srcData = sprite.spritesheet._uint32Data;
                    for (let y = 0; y < dstTileY; ++y) {
                        for (let x = 0; x < dstTileX; ++x) {
                            const srcOffset = (sprite._x + x * reduce) + (sprite._y + y * reduce) * srcData.width;
                            const dstOffset = (x + mapX * dstTileX) + (y + mapY * dstTileY) * dstImageData.width;
                            const srcValue = srcData[srcOffset];
                            if ((srcValue >>> 24) > 127) { // Alpha test
                                dstData[dstOffset] = srcValue;
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


/** Creates the left-hand project listing from the gameSource */
function createProjectWindow(gameSource) {
    let s = '';
    s += '<b title="' + gameSource.jsonURL +' " onclick="onProjectSelect(event.target, \'game\', null)" class="clickable">' + gameSource.json.title + '</b>';
    s += '<div style="border-left: 1px solid #ccc; margin-left: 4px; padding-top: 5px; padding-bottom: 9px; margin-bottom: -7px"><div style="margin:0; margin-left: -2px; padding:0">';

    s += '— <i>Scripts</i>\n';
    s += '<ul class="scripts">';
    for (let i = 0; i < gameSource.scripts.length; ++i) {
        const script = gameSource.scripts[i];
        s += `<li class="clickable" onclick="onProjectSelect(event.target, 'script', gameSource.scripts[${i}])" title="${script}">${urlFilename(script)}</li>\n`;
    }
    s += '</ul>';

    
    s += '— <i class="clickable" onclick="onProjectSelect(event.target, \'mode\', undefined)">Modes</i>\n';
    s += '<ul class="modes">';
    for (let i = 0; i < gameSource.modes.length; ++i) {
        const mode = gameSource.modes[i];
        // Hide system modes
        if (/^.*\/_|^_/.test(mode.name)) { continue; }
        s += `<li class="clickable" onclick="onProjectSelect(event.target, 'mode', gameSource.modes[${i}])" title="${mode.url}"><code>${mode.name}</code></li>\n`;
    }
    s += '</ul>';

    s += '— <i>Docs</i>\n';
    s += '<ul class="docs">';
    for (let i = 0; i < gameSource.docs.length; ++i) {
        const doc = gameSource.docs[i];
        s += `<li class="clickable" onclick="onProjectSelect(event.target, 'doc', gameSource.docs[${i}])" title="${doc.url}"><code>${doc.name}</code></li>\n`;
    }
    s += '</ul>';
    
    s += '— <i>Constants</i>\n';
    s += '<ul class="constants">';
    {
        const keys = Object.keys(gameSource.constants);
        keys.sort();
        for (let i = 0; i < keys.length; ++i) {
            const c = keys[i];
            s += `<li class="clickable" onclick="onProjectSelect(event.target, 'constant', '${c}')"><code>${c}</code></li>\n`;
        }
    }
    s += '</ul>';

    s += '</div></div>';
    s += '<div style="margin-left: 3px">— <i>Assets</i>\n';
    s += '<ul class="assets">';
    {
        const keys = Object.keys(gameSource.assets);
        for (let i = 0; i < keys.length; ++i) {
            const assetName = keys[i];

            // Hide system assets
            if (assetName[0] === '_') { continue; }

            const asset = gameSource.assets[assetName];
            let type = asset._jsonURL.match(/\.([^.]+)\.json$/i);
            if (type) { type = type[1].toLowerCase(); }

            s += `<li onclick="onProjectSelect(event.target, 'asset', gameSource.assets['${assetName}'])" class="clickable ${type}" title="${asset._jsonURL}"><code>${assetName}</code></li>`;

            if (type === 'map') {
                for (let k in asset.spritesheetTable) {
                    s += `<ul><li onclick="onProjectSelect(event.target, 'asset', gameSource.assets['${assetName}'].spritesheetTable['${k}'])" class="clickable sprite" title="${asset.spritesheetTable[k]._jsonURL}"><code>${k}</code></li></ul>\n`;
                }
            }
        } // for each asset
    }
    s += '</ul>';
    s += '</div>'
    
    // Build the project list for the IDE
    const projectElement = document.getElementById('project');
    projectElement.innerHTML = s;
}


window.gameURL = '';

const autocorrectTable = [
    '\\Delta',    'Δ',
    '\\alpha',    'α',
    '\\beta',     'β',
    '\\gamma',    'γ',
    '\\delta',    'δ',
    '\\epsilon',  'ε',
    '\\zeta',     'ζ',
    '\\eta',      'η',
    '\\theta',    'θ',
    '\\iota',     'ι',
    '\\lambda',   'λ',
    '\\mu',       'μ',
    '\\rho',      'ρ',
    '\\sigma',    'σ',
    '\\phi',      'ϕ',
    '\\chi',      'χ',
    '\\psi',      'ψ',
    '\\omega',    'ω',
    '\\Omega',    'Ω',
    '\\tau',      'τ',
    '\\time',     'τ',
    '\\xi',       'ξ',
    '\\rnd',      'ξ',
    '\\in',       '∊',
    '==',         '≟',
    '?=',         '≟',
    '!=',         '≠',
    '\\neq',      '≠',
    '\\eq',       '≟',
    '\\not',      '¬',
    '\\leq',      '≤',
    '<=',         '≤',
    '\\geq',      '≥',
    '>=',         '≥',
    '>>',         '▻',
    '<<',         '◅',
    '\\bitand',   '∩',
    '\\bitor',    '∪',
    '\\bitxor',   '⊕',
    '\\pi',       'π',
    '\\infty',    '∞',
    '\\nil',      '∅',
    '\\half',     '½',
    '\\third',    '⅓',
    '\\quarter',  '¼',
    '\\fifth',    '⅕',
    '\\sixth',    '⅙',
    '\\seventh',  '⅐',
    '\\eighth',   '⅛',
    '\\ninth',    '⅑',
    '\\tenth',    '⅒',     
    '\\lfloor',   '⌊',
    '\\rfloor',   '⌋',
    '\\lceil',    '⌈',
    '\\rceil',    '⌉',
    '\\deg',      '°'
];


aceEditor.session.on('change', function () {
    let src = aceEditor.getValue();
    if (src.match(/\r|\t|[\u2000-\u200B]/)) {
        // Strip any \r inserted by pasting on windows, replace any \t that
        // likewise snuck in. This is rare, so don't invoke setValue unless
        // one is actually inserted.
        src = src.replace(/\r\n|\n\r/g, '\n').replace(/\r/g, '\n');
        src = src.replace(/\t/g, '  ').replace(/\u2003|\u2001/g, '  ').replace(/\u2007/g, ' ');
        aceEditor.setValue(src);
    } else {
        // Autocorrect
        let position = aceEditor.getCursorPosition();
        let index = aceEditor.session.doc.positionToIndex(position);

        let LONGEST_AUTOCORRECT = 10;
        let start = index - LONGEST_AUTOCORRECT;
        let substr = src.substring(start, index + 1);

        // Look for any possible match in substr, which is faster than
        // searching the entirety of the source on every keystroke
        for (let i = 0; i < autocorrectTable.length; i += 2) {
            let target = autocorrectTable[i];
            let x = substr.indexOf(target);
            if (x >= 0) {
                let replacement = autocorrectTable[i + 1];
                // Found an autocorrectable substring: replace it
                src = src.substring(0, start + x) + replacement + src.substring(start + x + target.length);
                aceEditor.setValue(src);

                // Move the cursor to retain its position
                aceEditor.gotoLine(position.row + 1, Math.max(0, position.column - target.length + replacement.length + 1), false);
                break;
            }
        }
    }
});


if (jsCode) {
    jsCode.getSession().setUseWorker(false);
    jsCode.getSession().setMode('ace/mode/javascript');
    jsCode.setReadOnly(true);
    jsCode.getSession().setUseWrapMode(true);
}

let updateImage = document.createElement('canvas');
let updateImageData;
let error = document.getElementById('error');

function setFramebufferSize(w, h) {
    SCREEN_WIDTH = w;
    SCREEN_HEIGHT = h;
    emulatorScreen.width = w;
    emulatorScreen.height = h;

    updateImage.width  = w;
    updateImage.height = h;
    updateImageData = ctx.createImageData(w, h);

    bootScreen.style.fontSize = '' + Math.max(10 * SCREEN_WIDTH / 384, 4) + 'px';
    
    // The layout may need updating as well
    setTimeout(onResize, 0);
    setTimeout(onResize, 250);
    setTimeout(onResize, 1250);
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
    return document.getElementById(ctrl + 'Button').checked;
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
    if (pressed('play') && ((emulatorMode !== 'play') || (targetFramerate !== PLAY_FRAMERATE))) {
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

    if (pressed('emulatorUI') && (uiMode !== 'Emulator')) {
        setUIMode('Emulator', false);
    } else if (pressed('testUI') && (uiMode !== 'Test')) {
        setUIMode('Test', false);
    } else if (pressed('IDEUI') && (uiMode !== 'IDE')) {
        setUIMode('IDE', false);
    } else if (pressed('maximalUI') && (uiMode !== 'Maximal')) {
        setUIMode('Maximal', false);
    }

    saveIDEState();
}


function setErrorStatus(e) {
    e = escapeHTMLEntities(e);
    error.innerHTML = e;
    if (e !== '') {
        error.style.visibility = 'visible';
        _outputAppend('\n<span style="color:#f55">' + e + '<span>\n');
    } else {
        error.style.visibility = 'hidden';
    }
}


setControlEnable('pause', false);
let coroutine = null;
let emwaFrameTime = 0;
const debugFrameRateDisplay = document.getElementById('debugFrameRateDisplay');
const debugActualFrameRateDisplay = document.getElementById('debugActualFrameRateDisplay');
const debugFramePeriodDisplay = document.getElementById('debugFramePeriodDisplay');
const debugDrawCallsDisplay = document.getElementById('debugDrawCallsDisplay');
const debugModeDisplay = document.getElementById('debugModeDisplay');
const debugPreviousModeDisplay = document.getElementById('debugPreviousModeDisplay');
const debugModeFramesDisplay = document.getElementById('debugModeFramesDisplay');
const debugGameFramesDisplay = document.getElementById('debugGameFramesDisplay');
const outputPane = document.getElementById('outputPane');
const outputDisplayPane = document.getElementById('outputDisplayPane');

// Maps expression strings to values
let debugWatchTable = {};

function debugWatch(expr, value) {
    debugWatchTable[expr] = QRuntime.unparse(value);
}


/** 
    Given a JavaScript runtime error, compute the corresponding nanoscript error by
    parsing the @ pragmas in the compiledProgram code.
 */
function jsToNSError(error) {
    console.log(error);
           
    // Firefox
    let lineNumber = error.lineNumber;

    // Find the first place in the user program that the problem occurred (Firefox and Chrome)
    if (error.stack) {
        const stack = error.stack.split('\n');
        if ((stack.length > 0) && ! /GeneratorFunction|anonymous/.test(stack[0])) {
            if (isSafari) {
                // Safari doesn't give line numbers inside generated
                // code except for the top of the stack. At least find
                // the name of the offending function.
                for (let i = 1; i < stack.length; ++i) {
                    if (stack[i].indexOf('quadplay-runtime.js') === -1) {
                        lineNumber = QRuntime._currentLineNumber + 2;
                        //return {url:'(unknown)', lineNumber:'(unknown)', message: stack[i] + ': ' + error};
                    }
                }
            } else {
            
                for (let i = 1; i < stack.length; ++i) {
                    const match = stack[i].match(/(?:GeneratorFunction|<anonymous>):(\d+):/);
                    if (match) {
                        lineNumber = parseInt(match[1]);
                        break;
                    }
                }
            }
        }
    }
    

    if (! lineNumber && error.lineNumber) {
        // Safari
        lineNumber = error.lineNumber + 1;
    }
    
    if (! lineNumber && error.stack) {
        // Chrome
        const match = error.stack.match(/<anonymous>:(\d+)/);
        if (match) {
            lineNumber = clamp(1, parseInt(match[1]), programNumLines);
        }
    }

    if (error.stack && (error.stack.indexOf('<anonymous>') == -1) && (error.stack.indexOf('GeneratorFunction') == -1) && (error.stack.indexOf('quadplay-runtime.js') !== -1)) {
        return {url:'(unknown)', lineNumber: '(unknown)', message: '' + error};
    }

    if (! lineNumber) {
        return {url: '(unknown)', lineNumber: '(unknown)', message:'' + error};
    }
    
    const lineArray = compiledProgram.split('\n');

    // Look backwards from error.lineNumber for '/*@"'
    let urlLineIndex, urlCharIndex = -1;

    for (urlLineIndex = Math.min(Math.max(0, lineNumber - 1), lineArray.length - 1); (urlLineIndex >= 0) && (urlCharIndex === -1); --urlLineIndex) {
        urlCharIndex = lineArray[urlLineIndex].indexOf('/*@"');
    }

    // Always overshoots by one
    ++urlLineIndex;
    let endCharIndex = lineArray[urlLineIndex].indexOf('*/', urlCharIndex + 1);

    let url = lineArray[urlLineIndex].substring(urlCharIndex + 4, endCharIndex);
    // Strip the line offset
    endCharIndex = url.lastIndexOf(':');
    const quoteIndex = url.lastIndexOf('"');
    let offset = 0;
    if ((endCharIndex !== -1) && (quoteIndex < endCharIndex)) {
        // of the form "url":line
        offset = parseInt(url.substring(endCharIndex + 1));
        url = url.substring(0, endCharIndex);
    }

    return {url: url, lineNumber: lineNumber - urlLineIndex - 3 + offset, message: error.message};
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

    td.innerHTML = '' + time.toFixed(1) + ' ms';
    tp.innerHTML = '' + Math.round(time * 6) + '%';
}

// Invoked by requestAnimationFrame() or setTimeout. 
function mainLoopStep() {
    // Keep the callback chain going
    if (emulatorMode === 'play') {
        // We intentionally don't use requestAnimationFrame. It can go
        // above 60 Hz and require explicit throttling on high-refresh
        // displays. And when the game is falling below frame rate, we
        // don't trust requestAnimationFrame to reliably hit our
        // fractions of 60 Hz. Schedule the next step at the *start* of this
        // one, so that the time for processing the step does not create a
        // delay.
        //
        // Do not account for QRuntime._graphicsPeriod here. Always
        // try to run at 60 Hz for input processing and game
        // execution, and drop graphics processing in QRuntime._show()
        // some of the time.
        lastAnimationRequest = setTimeout(mainLoopStep, Math.floor(1000 / targetFramerate - 1));
    }

    // Erase the table every frame
    debugWatchTable = {};

    // Physics time may be spread over multiple QRuntime.physicsSimulate() calls,
    // but graphics is always a single QRuntime._show() call. Graphics time may
    // be zero on any individual call.
    QRuntime._physicsTimeTotal = 0;
    QRuntime._graphicsTime = 0;

    // Run the "infinite" loop for a while, maxing out at just under 1/60 of a second or when
    // the program explicitly requests a refresh or keyboard update via _show(). Note that
    // refreshPending may already be false if running with _graphicsPeriod > 1, but it does
    // no harm to set it back to false in that case.
    refreshPending = false;
    updateKeyboardPending = false;

    profiler.startFrame();
    // Run until the end of the game's natural main loop excution, the
    // game invokes QRuntime._show(), or the user ends the
    // program. The game may suppress its own graphics computation
    // inside QRuntime._show() if it is running too slowly.
    try {
        // Worst-case timeout in milliseconds (to yield 10 fps)
        // to keep the browser responsive if the game is in a long
        // top-level loop (which will yield). Some of this is legacy
        // to nanojammer, as quadplay games tend to have code in
        // functions where it can't yield.
        const frameStart = profiler.now();
        const endTime = frameStart + 100;

        while (! updateKeyboardPending && ! refreshPending && (performance.now() < endTime) && (emulatorMode === 'play' || emulatorMode === 'step') && coroutine) {
            // Time interval at which to check for new **gamepad**
            // input; won't be able to process keyboard input since
            // that requires events, which requires going out to the
            // main JavaScript loop.
            const gamepadSampleTime = performance.now() + 1000 / 60;
            updateInput();
            while (! updateKeyboardPending && ! refreshPending && (performance.now() < gamepadSampleTime) && (emulatorMode === 'play' || emulatorMode === 'step') && coroutine) {
                coroutine.next();
            }
        }
    } catch (e) {
        if (e.resetGame === 1) {
            // Automatic
            onStopButton(true);
            restartProgram(BOOT_ANIMATION.NONE);
            return;
        } else if (e.quitGame === 1) {
            if (useIDE) {
                onStopButton();
            } else {
                onHomeButton();
            }
        } else if (e.launchGame !== undefined) {
            loadGameIntoIDE(e.launchGame, function () {
                onResize();
                onPlayButton(false, true, e.args);
            });
        } else {
            // Runtime error
            onStopButton();
            e = jsToNSError(e);
            setErrorStatus('file ' + e.url + ' line ' + clamp(1, e.lineNumber, programNumLines) + ': ' + e.message);
        }
    }

    // The frame has ended
    profiler.endFrame(QRuntime._physicsTimeTotal, QRuntime._graphicsTime);

    if ((uiMode === 'Test') || (uiMode === 'IDE')) {
        const frame = profiler.smoothFrameTime.get();
        const logic = profiler.smoothLogicTime.get();
        const physics = profiler.smoothPhysicsTime.get();

        // Show the time that graphics *would* be taking if
        // it wasn't for the frame rate scaler
        const graphics = profiler.smoothGraphicsTime.get() * QRuntime._graphicsPeriod;
        const compute = logic + physics + graphics;
        
        if (profiler.debuggingProfiler) { updateTimeDisplay(frame, 'Frame'); }
        updateTimeDisplay(compute, 'Compute');
        updateTimeDisplay(logic, 'CPU');
        updateTimeDisplay(physics, 'PPU');
        updateTimeDisplay(graphics, 'GPU');

        let color = 'unset';
        if (QRuntime._graphicsPeriod === 2) {
            color = '#fe4';
        } else if (QRuntime._graphicsPeriod > 2) {
            color = '#f30';
        }

        debugFrameRateDisplay.style.color = debugFramePeriodDisplay.style.color = color;
        debugFrameRateDisplay.innerHTML = '' + Math.round(60 / QRuntime._graphicsPeriod) + ' Hz';
        debugFramePeriodDisplay.innerHTML = '(' + ('1½⅓¼⅕⅙'[QRuntime._graphicsPeriod - 1]) + ' ×)';

        if (QRuntime.modeFrames % QRuntime._graphicsPeriod === 1 % QRuntime._graphicsPeriod) {
            // Only display if the graphics period has just ended, otherwise the display would
            // be zero most of the time
            debugDrawCallsDisplay.innerHTML = '' + QRuntime._previousGraphicsCommandList.length;
        }
    }

    if (debugWatchEnabled && emulatorMode === 'play') {
        const pane = document.getElementById('debugWatchDisplayPane');
        let s = '<table width=100% style="border-collapse: collapse" >'
        for (let expr in debugWatchTable) {
            s += `<tr valign=top><td width=50%>${expr}</td><td>${debugWatchTable[expr]}</td></tr>`;
        }
        pane.innerHTML = s + '</table>';
    }

    if (QRuntime._gameMode) {
        if (QRuntime._modeStack.length) {
            let s = '';
            for (let i = 0; i < QRuntime._modeStack.length; ++i) {
                s += QRuntime._modeStack[i]._name + ' → ';
            }
            debugModeDisplay.innerHTML = s + QRuntime._gameMode._name;
        } else {
            debugModeDisplay.innerHTML = QRuntime._gameMode._name;
        }
    } else {
        debugModeDisplay.innerHTML = '∅';
    }

    if (QRuntime._prevMode) {
        debugPreviousModeDisplay.innerHTML = QRuntime._prevMode._name;
    } else {
        debugPreviousModeDisplay.innerHTML = '∅';
    }
    
    debugModeFramesDisplay.innerHTML = '' + QRuntime.modeFrames;
    debugGameFramesDisplay.innerHTML = '' + QRuntime.gameFrames;

    // Update to the profiler's new model of the graphics period
    QRuntime._graphicsPeriod = profiler.graphicsPeriod;

    if (targetFramerate < PLAY_FRAMERATE) {
        // Force the profiler to avoid resetting the
        // graphics rate when in slow mode.
        profiler.reset();
    }
    
    if (emulatorMode === 'step') {
        onPauseButton();
    }
}


/** When true, the system is waiting for a refresh to occur and mainLoopStep should yield
    as soon as possible. */
let refreshPending = false;
let updateKeyboardPending = false;

function reloadRuntime(oncomplete) {
    QRuntime.document.open();
    QRuntime.document.write("<script src='quadplay-runtime.js' charset='utf-8'> </script>");
    QRuntime.onload = function () {
        QRuntime._SCREEN_WIDTH  = SCREEN_WIDTH;
        QRuntime._SCREEN_HEIGHT = SCREEN_HEIGHT;
        QRuntime.resetClip();

        // updateImageData.data is a Uint8Clamped RGBA buffer
        QRuntime._screen = new Uint32Array(updateImageData.data.buffer);

        // Remove any base URL that appears to include the quadplay URL
        const _gameURL = gameSource ? (gameSource.jsonURL || '').replace(location.href.replace(/\?.*/, ''), '') : '';
        QRuntime._window = window;
        QRuntime._gameURL = _gameURL;
        QRuntime._debugPrintEnabled = document.getElementById('debugPrintEnabled').checked;
        QRuntime._assertEnabled = document.getElementById('assertEnabled').checked;
        QRuntime._debugWatchEnabled = document.getElementById('debugWatchEnabled').checked;
        QRuntime._showEntityBoundsEnabled = document.getElementById('showEntityBoundsEnabled').checked;
        QRuntime._showPhysicsEnabled = document.getElementById('showPhysicsEnabled').checked;
        QRuntime._debugWatch    = debugWatch;
        QRuntime._fontMap       = fontMap;
        QRuntime._parse         = _parse;
        QRuntime._submitFrame   = submitFrame;
        QRuntime._requestInput  = requestInput;
        QRuntime._updateInput   = updateInput;
        QRuntime._systemPrint   = _systemPrint;
        QRuntime._outputAppend  = _outputAppend;
        QRuntime._parseHexColor = parseHexColor;
        QRuntime._Physics       = Matter;
        QRuntime.makeEuroSmoothValue = makeEuroSmoothValue;

        QRuntime.pad = Object.seal([0,0,0,0]);
        for (let p = 0; p < 4; ++p) {
            const type = 'Quadplay';

            // These will be overridden immediately on the first call to updateInput()
            // if the id of the underlying device has changed.
            let controlBindings = JSON.parse(localStorage.getItem('pad0' + p) || 'null');
            if (! controlBindings) {
                controlBindings = {id: isMobile ? 'mobile' : '', type: defaultControlType(p)};
            }
            
            QRuntime.pad[p] = Object.seal({
                x:0, dx:0, y:0, dy:0, xx:0, yy:0,
                angle:0, dangle:0,
                a:0, b:0, c:0, d:0, _p:0, q:0,
                aa:0, bb:0, cc:0, dd:0, _pp:0, qq:0,
                pressedA:0, pressedB:0, pressedC:0, pressedD:0, _pressedP:0, pressedQ:0,
                releasedA:0, releasedB:0, releasedC:0, releasedD:0, _releasedP:0, releasedQ:0,
                index: p,
                type: controlBindings.type,
                prompt: controlSchemeTable[controlBindings.type],
                _id: controlBindings.id, 
                _analogX: 0,
                _analogY: 0
            });
        }
        QRuntime.joy = QRuntime.pad[0];
        
        QRuntime.debugPrint     = debugPrint;
        QRuntime.assert         = assert;
        QRuntime.deviceControl  = deviceControl;
        QRuntime.playAudioClip  = playAudioClip;
        QRuntime.stopSound      = stopSound;
        QRuntime.resumeSound    = resumeSound;
        QRuntime.setSoundVolume = setSoundVolume;
        QRuntime.setSoundPitch  = setSoundPitch;
        QRuntime.setSoundPan    = setSoundPan;
        QRuntime.debugPause     = onPauseButton;
        
        if (oncomplete) { oncomplete(); }
    };

    QRuntime.document.close();
}


///////////////////////////////////////////////////////////////////////

function deepClone(src, alreadySeen) {
    if ((src === null) || (src === undefined)) {
        return undefined;
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
                v[k] = deepClone(src[k], alreadySeen);
            } else {
                // Normal array element
                v[i] = deepClone(src[i], alreadySeen);
            }
        }
        
        return v;
    } else if (typeof src === 'object' && (! src.constructor || (src.constructor === Object.prototype.constructor))) {
        // Some generic object that is safe to clone
        let clone = Object.create(null);
        alreadySeen.set(src, clone);
        for (let key in src) {
            clone[key] = deepClone(src[key], alreadySeen);
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
                if (key[0] === '_') {
                    throw 'Illegal constant field name: "' + key + '"';
                }
                clone[key] = frozenDeepClone(src[key], alreadySeen);
            }
            return Object.freeze(clone);
        }

        default: throw 'Cannot clone an object of type ' + (typeof src);
    } // switch
}


/** Environment is the object to create the constants on (the QRuntime
    iFrame, or the object at that is a package), constants is the
    constants field of a package. */
function makeConstants(environment, constants) {
    defineImmutableProperty(environment, 'screenSize', Object.freeze({x:SCREEN_WIDTH, y:SCREEN_HEIGHT}));

    const alreadySeen = new Map();
    for (let key in constants) {
        if (key[0] === '_') {
            throw 'Illegal constant field name: "' + key + '"';
        }

        defineImmutableProperty(environment, key, frozenDeepClone(constants[key], alreadySeen));
    }
}


/** Called by constants and assets to extend the QRuntime environment */
function defineImmutableProperty(object, key, value) {
    Object.defineProperty(object, key,
                          {configurable: true,
                           get: function () { return value; },
                           set: function (ignore) { throw 'Cannot reassign constant "' + key + '"'; }});
}


/** Bind assets in the environment */
function makeAssets(environment, assets) {
    if ((assets === undefined) || (Object.keys(assets).length === 0)) { return; }

    const alreadySeen = new Map();
    
    for (let assetName in assets) {
        defineImmutableProperty(environment, assetName, deepClone(assets[assetName], alreadySeen));
    }
}

// Pause when losing focus if currently playing...prevents quadplay from
// eating resources in the background during development.
window.addEventListener("blur", function () {
    if (backgroundPauseEnabled && useIDE) {
        onPauseButton();
    }
}, false);

function updateControllerIcons() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : (navigator.webkitGetGamepads ? navigator.webkitGetGamepads : []);
    let num = 0;
    for (let i = 0; i < gamepads.length; ++i) {
        const pad = gamepads[i];
        if (pad && pad.connected) {
            // Enable this icon
            document.getElementById('controllerIcon' + num).className = 'controllerPresent';
            ++num;
        }
    }

    // Disable the remaining icons
    while (num < 4) {
        document.getElementById('controllerIcon' + num).className = 'controllerAbsent';
        ++num;
    }
}

window.addEventListener("gamepadconnected", function(e) {
    updateControllerIcons();
    console.log("Gamepad connected at index %d: %s. %d buttons, %d axes.", e.gamepad.index, e.gamepad.id, e.gamepad.buttons.length, e.gamepad.axes.length);
});

window.addEventListener("gamepaddisconnected", function(e) {
    updateControllerIcons();
    console.log("Gamepad disconnected from index %d: %s", e.gamepad.index, e.gamepad.id);
});


setTimeout(updateControllerIcons, 100);

const qrcode = new QRCode('serverQRCode',
                          {width:  192,
                           height: 192,
                           colorDark: "rgba(0,0,0,0)",
                           colorLight: "#eee",
                           correctLevel: QRCode.CorrectLevel.H
                          });

function showBootScreen() {
    bootScreen.innerHTML = `<span style="color:#ec5588">quadplay✜ ${version}</span>
<span style="color:#937ab7">© 2020 Morgan McGuire</span>
<span style="color:#5ea9d8">Licensed under LGPL 3.0</span>
<span style="color:#859ca6">https://casual-effects.com</span>

`;
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


function loadGameIntoIDE(url, callback) {
    if (emulatorMode !== 'stop') { onStopButton(); }

    const isLauncher = /(^quad:\/\/console\/|\/launcher\.game\.json$)/.test(url);
    if (! isLauncher) {
        showBootScreen();
    }
    window.gameURL = url;

    // Let the boot screen show before appending in the following code
    setTimeout(function() {
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
                    '<p>Your local server is in secure mode and has disabled hosting.</p><p>Exit the quadplay script and run it with <code style="white-space:nowrap">quadplay --host</code> to allow hosting games for mobile devices from this machine.</p>';
                document.getElementById('serverQRCode').style.visibility = 'hidden';
                document.getElementById('serverQRMessage').style.visibility = 'hidden';
            } else {
                qrcode.makeCode(serverURL);
                document.getElementById('serverURL').innerHTML =
                    `<a href="${serverURL}" target="_blank">${serverURL}</a>`;
                document.getElementById('serverQRCode').style.visibility = 'visible';
            }
        }

        // TODO: Editor
        //aceEditor.setReadOnly(! locallyHosted());
        aceEditor.setReadOnly(true);
    
        document.getElementById('playButton').enabled = false;
        onLoadFileStart(url);
        afterLoadGame(url, function () {
            onLoadFileComplete(url);
            hideBootScreen();
            console.log('Loading complete.');
            setFramebufferSize(gameSource.json.screenSize.x, gameSource.json.screenSize.y);
            createProjectWindow(gameSource);
            const resourcePane = document.getElementById('resourcePane');
            resourcePane.innerHTML = `
<br/><center><b style="color:#888">Resource Limits</b></center>
<hr>
<br/>
<table style="margin-left: -2px; width: 100%">
<tr><td width=180>Sprite Pixels</td><td class="right">${Math.round(resourceStats.spritePixels / 1000)}k</td><td>/</td><td class="right" width=40>5505k</td><td class="right" width=45>(${Math.round(resourceStats.spritePixels*100/5505024)}%)</td></tr>
<tr><td>Spritesheets</td><td class="right">${resourceStats.spritesheets}</td><td>/</td><td class="right">128</td><td class="right">(${Math.round(resourceStats.spritesheets*100/128)}%)</td></tr>
<tr><td>Max Spritesheet Width</td><td class="right">${resourceStats.maxSpritesheetWidth}</td><td>/</td><td class="right">1024</td><td class="right">(${Math.round(resourceStats.maxSpritesheetWidth*100/1024)}%)</td></tr>
<tr><td>Max Spritesheet Height</td><td class="right">${resourceStats.maxSpritesheetHeight}</td><td>/</td><td class="right">1024</td><td class="right">(${Math.round(resourceStats.maxSpritesheetHeight*100/1024)}%)</td></tr>
<tr><td>Source Statements</td><td class="right">${resourceStats.sourceStatements}</td><td>/</td><td class="right">8192</td><td class="right">(${Math.round(resourceStats.sourceStatements*100/8192)}%)</td></tr>
<tr><td>Audio Clips</td><td class="right">${resourceStats.sounds}</td><td>/</td><td class="right">128</td><td class="right">(${Math.round(resourceStats.sounds*100/128)}%)</td></tr>
</table>`;
            document.getElementById('playButton').enabled = true;
            
            const modeEditor = document.getElementById('modeEditor');
            if (modeEditor.style.visibility === 'visible') {
                // Update the editor
                visualizeModes(modeEditor);
            }
            
            aceEditor.gotoLine(0, 0, false);
            aceEditor.scrollToLine(0, false, false, undefined);
            hideWaitDialog();
            
            appendToBootScreen(`

QuadOS ROM:        256269 bytes    
Runtime ROM:       159754 bytes
Framebuffer RAM:   ${384 * 224 * 2} bytes
Sprite RAM:        ${4718592 * 2} bytes
AudioClip units:   128 slots
Code memory:       8192 lines

Boot loader initialized
Checking ROM…OK
Checking kernel…OK
Checking RAM…OK
Checking game pad input…OK

Starting…
`);        
            if (callback) { callback(); }
        }, function (e) {
            hideBootScreen();
            setErrorStatus('Loading ' + url + ' failed: ' + e);
            onStopButton();
            hideWaitDialog();
        });
    }, 15);
}

// Load state
backgroundPauseEnabled = localStorage.getItem('backgroundPauseEnabled');
if (backgroundPauseEnabled === undefined || backgroundPauseEnabled === null) {
    // Default to true
    backgroundPauseEnabled = true;
}

if (! localStorage.getItem('debugPrintEnabled')) {
    // Default to true
    localStorage.setItem('debugPrintEnabled', "true")
}

if (! localStorage.getItem('assertEnabled')) {
    // Default to true
    localStorage.setItem('assertEnabled', "true")
}

if (! localStorage.getItem('debugWatchEnabled')) {
    // Default to true
    localStorage.setItem('debugWatchEnabled', "true")
}

{
    const optionNames = ['showPhysicsEnabled', 'showEntityBoundsEnabled', 'assertEnabled', 'debugPrintEnabled', 'debugWatchEnabled'];
    for (let i = 0; i < optionNames.length; ++i) {
        const name = optionNames[i];
        const value = JSON.parse(localStorage.getItem(name) || "false");
        const element = document.getElementById(name);
        element.checked = value;
    }
}

{
    let url = getQueryString('game') || launcherURL;

    // If the url doesn't have a prefix, assume that it is relative to
    // the quadplay script in the parent dir.
    if (! (/^.{3,}:\/\//).test(url)) {
        url = '../' + url;
    }

    function go() {
        loadGameIntoIDE(url, function () {
            onProjectSelect(null, 'game', gameSource.url);
            if (! useIDE) { onPlayButton(); }
        });
    }

    if (! useIDE && (url !== 'quad://console/launcher')) {
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
                go();
            }, 800);
        }, 3000);
    } else {
        go();
    }
}

document.getElementById('backgroundPauseCheckbox').checked = backgroundPauseEnabled || false;

setUIMode(localStorage.getItem('uiMode') || 'IDE', false);
setErrorStatus('');
setColorScheme(localStorage.getItem('colorScheme') || 'pink');
onResize();
setTimeout(onResize, 500);
// Set the initial size
setFramebufferSize(SCREEN_WIDTH, SCREEN_HEIGHT);
reloadRuntime();
