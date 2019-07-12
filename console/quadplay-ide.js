/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License*/
"use strict";

const deployed = true;
const version  = '2019.07.04b'
const launcherURL = 'quad://console/launcher';

{
    const c = document.getElementsByClassName(isMobile ? 'noMobile' : 'mobileOnly');
    for (let i = 0; i < c.length; ++i) {
        c[i].style.display = 'none';
    }
}


// 'IDE', 'Test', 'Emulator', 'Maximal'. See also setUIMode().
let uiMode = 'IDE';


let SCREEN_WIDTH = 384, SCREEN_HEIGHT = 224;
let gameSource;

// The image being written during preview recording
let previewRecording = null;
let previewRecordingFrame = 0;

function clamp(x, lo, hi) { return Math.min(Math.max(x, lo), hi); }

function getQueryString(field) {
    const reg = new RegExp('[?&]' + field + '=([^&#]*)', 'i');
    const string = reg.exec(location.search);
    return string ? string[1] : null;
}

const useIDE = getQueryString('IDE') || false;
{
    const c = document.getElementsByClassName(useIDE ? 'noIDE' : 'IDEOnly');
    for (let i = 0; i < c.length; ++i) {
        c[i].style.display = 'none';
    }
}


function debugOptionClick(event) {
    const element = event.target;
    event.stopPropagation();
    if (element.id === 'wordWrapEnabled') {
        const outputDisplayPane = document.getElementById('outputDisplayPane');
        outputDisplayPane.style.whiteSpace = element.checked ? 'pre-wrap' : 'pre';
    } else {
        Runtime['_' + element.id] = element.checked;
    }
    saveIDEState();
}


let quadplayLogoSprite;

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
        if ((rule.selectorText === '#header a, #toolsMenu a') ||
            (rule.selectorText === '.emulator .emulatorBackground' && rule.style.background !== '')) {
            stylesheet.deleteRule(i);
            --i;
        }
    }
    // Replacement rules
    stylesheet.insertRule(`#header a, #toolsMenu a { color: ${hrefColor} !important; text-decoration: none; }`, 0);
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
    requestFullScreen();
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

    onResize();
    
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


function onUIModeMenuButton(event) {
    let menu = document.getElementById('uiModeMenu');
    if (menu.style.visibility === 'visible') {
        menu.style.visibility = 'hidden';
    } else {
        menu.style.visibility = 'visible';
    }
    event.stopPropagation();
}

function onToolsMenuButton(event) {
    const button = document.getElementById('toolsMenuButton');
    const menu = document.getElementById('toolsMenu');

    if (menu.style.visibility === 'visible') {
        menu.style.visibility = 'hidden';
    } else {
        menu.style.visibility = 'visible';
        menu.style.left = button.getBoundingClientRect().left + 'px';
    }

    if (event) { event.stopPropagation(); }
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
        onPlayButton();
    });
}


function onRestartButton() {
    onStopButton();
    onPlayButton();
}


let lastAnimationRequest = 0;
function onStopButton() {
    stopAllSounds();
    document.getElementById('stopButton').checked = 1;
    setControlEnable('pause', false);
    coroutine = null;
    emulatorMode = 'stop';

    if (Runtime._graphicsPeriod === 1) {
        cancelAnimationFrame(lastAnimationRequest);
    } else {
        clearTimeout(lastAnimationRequest);
    }
    ctx.clearRect(0, 0, emulatorScreen.width, emulatorScreen.height);
    saveIDEState();
}


function onPlayButton() {
    function doPlay() {
        document.getElementById('playButton').checked = 1;
        setControlEnable('pause', true);
        _ch_audioContext.resume();
    
        setErrorStatus('');
        emulatorMode = 'play';
        emwaFrameTime = 0;
        lastGraphicsPeriodCheckTime = performance.now();
        emwaFrameInterval = 1000/60;
        periodCapThisRun = 1;
        frameRateFailuresThisRun = 0;        
        prevFrameStart = performance.now();
        previewRecordingFrame = 0;
        previewRecording = null;

        
        if (! coroutine) {
            outputDisplayPane.innerHTML = '';
            compiledProgram = '';
            try {
                compiledProgram = compile(gameSource);
                setErrorStatus('');
            } catch (e) {
                e.message = e.message.replace(/^line \d+: /i, '');
                if (e.message === 'Unexpected token :') {
                    e.message += ', possible due to a missing { on a previous line';
                }
                
                setErrorStatus('Error: ' + e.url + ', line ' + e.lineNumber + ': ' + e.message);
                if (isSafari) {
                    console.log('_currentLineNumber = ' + Runtime._currentLineNumber);
                }
                console.log(e);
            }
            
            if (compiledProgram) {
                if (! deployed && useIDE) { console.log(compiledProgram); }
                
                // Ready to execute. Reload the runtime and compile and launch
                // this code within it.
                programNumLines = compiledProgram.split('\n').length;

                restartProgram(true);
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
        return;
    } else if (emulatorMode === 'stop') {
        // Reload the program
        if (loadManager.status !== 'complete' && loadManager.status !== 'failure') {
            console.log('Load already in progress...');
        } else {
            console.log('\n');
            if (useIDE) {
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
    }

}


function deviceControl(cmd) {
    switch (cmd) {
    case "StartGIFRecording":     startGIFRecording(); break;
    case "StopGIFRecording":      stopGIFRecording(); break;
    case "TakeScreenshot":        downloadScreenshot(); break;
    case "StartPreviewRecording": startPreviewRecording(); break;
    }
}


/** Called by resetGame() as well as the play and reload buttons to
    reset all game state and load the game.  */
function restartProgram(showBootAnimation) {
    reloadRuntime(function () {
        try {
            // Inject the constants into the runtime space
            makeConstants(Runtime, gameSource.constants);
            makeAssets(Runtime, gameSource.assets);
        } catch (e) {
            // Compile-time error
            onStopButton();
            setErrorStatus(e);
        }
        
        // Create the main loop function in the Runtime environment so
        // that it sees those variables.
        try {
            coroutine = Runtime._makeCoroutine(compiledProgram);
            Runtime._showBootAnimation = showBootAnimation;
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


window.onclick = function(event) {
    /*
    // Hide modal dialogs
    if (event.target.classList.contains('modal') && (event.target !== document.getElementById('waitDialog'))) {
        event.target.classList.add('hidden');
    }
    */
    
    // Hide dropdown menus
    const list = document.getElementsByClassName('dropdown');
    for (let i = 0; i < list.length; ++i) {
        list[i].style.visibility = 'hidden';
    }
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
    case 71: // G
        if (event.ctrlKey || event.metaKey) { // Ctrl+R / Ctrl+G
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

aceEditor.setReadOnly(true);

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

    /*
    // Show in the editor
    let c;
    if (typeof index === 'string') {
        const part = index.split('.');
        c = gameSource[category][part[0]];
        if (part.length > 1) { c = c[part[1]]; }
    } else {
        c = gameSource[category][index];
    }*/

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
                constantEditor.innerHTML = index + ` <div style="background: rgb(${255 * c.r}, ${255 * c.g}, ${255 * c.b}); width: 50px; height: 16px; display: inline-block"> </div><br/>(${Runtime.unparse(c)})`;
            } else {
                let s = Runtime.unparse(c);
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
    
    const dA = Runtime._sub(C, A);
    const dB = Runtime._sub(D, B);
    const diff = Runtime._sub(B, A);

    const numerator = Runtime.cross(diff, dA);
    const denominator = Runtime.cross(dA, dB);

    if (Math.max(Math.abs(denominator), Math.abs(numerator)) < 1e-10) {
        // Parallel cases
        return false;
    }

    const u = numerator / denominator;
    const t = Runtime.cross(diff, dB) / denominator;

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
        const name = mode.name.replace('*', '');
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

    const setModeRegexp = /\b(setMode|pushMode)\s*\(([^,)]+)\s*(?:,\s*"([^"]*)"\s*)?\)/g;
    const resetGameRegexp = /\bresetGame\s*\(\s*(?:"([^"]*)")?\s*\)/g;
    //const popModeRegexp = /\bpopMode\s*\((?:\s*"([^"]*)"\s*)?\)/g;

    // Modes that have links back to however they are entered. These
    // have to be processed after all other links are discovered.
    let backLinks = [];
    
    // Get edges for each node
    for (let m = 0; m < gameSource.modes.length; ++m) {
        const mode = gameSource.modes[m];
        const name = mode.name.replace('*', '');
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
    const nodeWidth = 76, nodeHeight = 28;
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
            v = escapeHTMLEntities(Runtime.unparse(v));
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
    s += '<tr valign="top"><td>Label&nbsp;64</td><td><img alt="label64.png" src="' + baseURL + '/label64.png" style="border:1px solid #fff; image-rendering: crisp-edges; image-rendering: pixelated; width:64px; height:64px"></td></tr>\n';
    s += '<tr valign="top"><td>Label&nbsp;128</td><td><img alt="label128.png" src="' + baseURL + '/label128.png" style="border:1px solid #fff; image-rendering: crisp-edges; image-rendering: pixelated; width:128px; height:128px"></td></tr>\n';
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
        s += `<li class="clickable" onclick="onProjectSelect(event.target, 'mode', gameSource.modes[${i}])" title="${mode.url}"><code>${mode.name}</code></li>\n`;
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
    
    // The layout may need updating as well
    onResize();
}


// Set by compilation
let programNumLines = 0;
let compiledProgram = '';

// 'stop', 'step', 'pause', 'play'
let emulatorMode = 'stop';

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
    if (pressed('play') && (emulatorMode !== 'play')) {
        onPlayButton();
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
const debugFrameTimeDisplay = document.getElementById('debugFrameTimeDisplay');
const debugFramePercentDisplay = document.getElementById('debugFramePercentDisplay');
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
    debugWatchTable[expr] = Runtime.unparse(value);
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
                        lineNumber = Runtime._currentLineNumber + 2;
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
    
// Used for timing the actual frame rate
let prevFrameStart = 0;
let emwaFrameInterval = 1000 / 60;

// Minimum graphics period permitted for the game
// on this run. If the game consistently fails to make
// 60 fps, it will be capped lower than 1
let periodCapThisRun = 1;
let frameRateFailuresThisRun = 0;

// performance.now time at which the graphics period was last adjusted
let lastGraphicsPeriodCheckTime = 0;
const graphicsPeriodCheckInterval = 1000;// milliseconds

function mainLoopStep() {
    // Keep the callback chain going
    if (emulatorMode === 'play') {
        if (Runtime._graphicsPeriod === 1) {
            // Line up with Vsync and browser repaint at 60 Hz
            lastAnimationRequest = requestAnimationFrame(mainLoopStep);
        } else {
            // Use manual scheduling when running below 60 Hz
            lastAnimationRequest = setTimeout(mainLoopStep, (1000 / 60) * Runtime._graphicsPeriod);
        }
    }

    const frameStart = performance.now();
    emwaFrameInterval = emwaFrameInterval + (frameStart - prevFrameStart - emwaFrameInterval) * 0.09;
    prevFrameStart = frameStart;
    
    // Erase the table every frame
    debugWatchTable = {};

    // Run the "infinite" loop for a while, maxing out at just under 1/60 of a second or when
    // the program explicitly requests a refresh via _show().
    refreshPending = false;
    try {
        // Worst-case timeout in milliseconds to keep the system responsive
        // even if it isn't receiving graphics submissions
        const endTime = frameStart + 100;

        while (! refreshPending && (performance.now() < endTime) && (emulatorMode === 'play' || emulatorMode === 'step') && coroutine) {
            updateInput();

            // Time interval at which to check for new [gamepad]
            // input; won't be able to process keyboard input since
            // that requires events.
            const inputTime = performance.now() + 1000 / 60;
            while (! refreshPending && (performance.now() < inputTime) && (emulatorMode === 'play' || emulatorMode === 'step') && coroutine) {
                coroutine.next();
            }
        }
    } catch (e) {
        if (e.resetGame === 1) {
            restartProgram(false);
            return;
        } else if (e.quitGame === 1) {
            if (useIDE) {
                onStopButton();
            } else {
                onHomeButton();
            }
        } else if (e.launchGame !== undefined) {
            loadGameIntoIDE(e.launchGame, function () {
                onPlayButton();
            });
        } else {
            // Runtime error
            onStopButton();
            e = jsToNSError(e);
            setErrorStatus('file ' + e.url + ' line ' + clamp(1, e.lineNumber, programNumLines) + ': ' + e.message);
        }
    }

    const frameEnd = performance.now();
    const frameTime = (frameEnd - frameStart - Runtime._graphicsTime) / Runtime._graphicsPeriod + Runtime._graphicsTime;
    if (emwaFrameTime === 0) {
        // First frame
        emwaFrameTime = frameTime;
    } else {
        emwaFrameTime = emwaFrameTime * 0.96 + frameTime * 0.04;
    }

    if ((lastGraphicsPeriodCheckTime + graphicsPeriodCheckInterval < frameEnd) && ! previewRecording) {
        // Time to update the graphics period
        lastGraphicsPeriodCheckTime = frameEnd;

        // "periods" are integer multiples of 1000 ms / 60 frames = 16.7 ms
        const oldPeriod = Runtime._graphicsPeriod;
        
        // (f [ms / frame]) / (1000/60 [ms/frame]) = f * 60 / 1000
        let nextPeriod = frameTime * (60 / 1000);

        // If we're almost making frame rate, do not increase the graphics period
        if (nextPeriod * 0.96 > Runtime._graphicsPeriod) {
            // Increase the period because the program is running too slowly 
            nextPeriod = clamp(Math.round(nextPeriod), periodCapThisRun, 6);
        } else if (Math.ceil(nextPeriod) <= Runtime._graphicsPeriod) {
            // The program is running fast. Drop down to the new period
            nextPeriod = clamp(Math.ceil(nextPeriod), periodCapThisRun, 6);
        } else {
            // Do not change frame rate
            nextPeriod = oldPeriod;
        }

        if ((nextPeriod === 1) && (oldPeriod === 1) && (frameTime >= 18 * oldPeriod)) {
            // We are missing frame rate badly (worse than 55.5 fps) due to the browser even
            // though the game itself is running fast enough. Back off to 30 fps.
            nextPeriod = 2;
            ++frameRateFailuresThisRun;
            if (frameRateFailuresThisRun >= 5) {
                periodCapThisRun = 2;
            }
        }

        if (nextPeriod !== oldPeriod) {
            emwaFrameInterval = emwaFrameInterval * 0.7 + 0.3 * nextPeriod * 1000/60;
        }

        Runtime._graphicsPeriod = nextPeriod;
    }
    
    debugFrameTimeDisplay.innerHTML = '' + emwaFrameTime.toFixed(1) + ' ms';
    debugFramePercentDisplay.innerHTML = '(' + Math.round(emwaFrameTime * 6) + '%)';
    debugFrameRateDisplay.innerHTML = '' + Math.round(60 / Runtime._graphicsPeriod) + ' Hz';
    debugActualFrameRateDisplay.innerHTML = '' + Math.round(1000 / emwaFrameInterval) + ' Hz';
    debugFramePeriodDisplay.innerHTML = '(' + ('1½⅓¼⅕⅙'[Runtime._graphicsPeriod - 1]) + ' ×)';
    debugDrawCallsDisplay.innerHTML = '' + Runtime._previousGraphicsCommandList.length;

    if (debugWatchEnabled && emulatorMode === 'play') {
        const pane = document.getElementById('debugWatchDisplayPane');
        let s = '<table width=100% style="border-collapse: collapse" >'
        for (let expr in debugWatchTable) {
            s += `<tr valign=top><td width=50%>${expr}</td><td>${debugWatchTable[expr]}</td></tr>`;
        }
        pane.innerHTML = s + '</table>';
    }

    if (Runtime._gameMode) {
        if (Runtime._modeStack.length) {
            let s = '';
            for (let i = 0; i < Runtime._modeStack.length; ++i) {
                s += Runtime._modeStack[i].name + ' → ';
            }
            debugModeDisplay.innerHTML = s + Runtime._gameMode.name;
        } else {
            debugModeDisplay.innerHTML = Runtime._gameMode.name;
        }
    } else {
        debugModeDisplay.innerHTML = '∅';
    }

    if (Runtime._prevMode) {
        debugPreviousModeDisplay.innerHTML = Runtime._prevMode.name;
    } else {
        debugPreviousModeDisplay.innerHTML = '∅';
    }
    
    debugModeFramesDisplay.innerHTML = '' + Runtime.modeFrames;
    debugGameFramesDisplay.innerHTML = '' + Runtime.gameFrames;

    if (emulatorMode === 'step') {
        onPauseButton();
    }
}


/** When true, the system is waiting for a refresh to occur and mainLoopStep should yield
    as soon as possible. */
let refreshPending = false;

function reloadRuntime(oncomplete) {
    Runtime.document.open();
    Runtime.document.write("<script src='quadplay-runtime.js' charset='utf-8'> </script>");
    Runtime.onload = function () {
        Runtime._SCREEN_WIDTH  = SCREEN_WIDTH;
        Runtime._SCREEN_HEIGHT = SCREEN_HEIGHT;
        Runtime.resetClip();

        // updateImageData.data is a Uint8Clamped RGBA buffer
        Runtime._screen = new Uint32Array(updateImageData.data.buffer);

        // Remove any base URL that appears to include the quadplay URL
        const _gameURL = (gameSource.jsonURL || '').replace(location.href.replace(/\?.*/, ''), '');
        Runtime._window = window;
        Runtime._gameURL = _gameURL;
        Runtime._quadplayLogoSprite = quadplayLogoSprite;
        Runtime._debugPrintEnabled = document.getElementById('debugPrintEnabled').checked;
        Runtime._assertEnabled = document.getElementById('assertEnabled').checked;
        Runtime._debugWatchEnabled = document.getElementById('debugWatchEnabled').checked;
        Runtime._showEntityBoundsEnabled = document.getElementById('showEntityBoundsEnabled').checked;
        Runtime._debugWatch    = debugWatch;
        Runtime._fontMap       = fontMap;
        Runtime._parse         = _parse;
        Runtime._submitFrame   = submitFrame;
        Runtime._updateInput   = updateInput;
        Runtime._systemPrint   = _systemPrint;

        Runtime.debugPrint     = debugPrint;
        Runtime.assert         = assert;
        Runtime.deviceControl  = deviceControl;
        Runtime.playAudioClip  = playAudioClip;
        Runtime.stopSound      = stopSound;
        Runtime.resumeSound    = resumeSound;
        Runtime.setSoundVolume = setSoundVolume;
        Runtime.setSoundPitch  = setSoundPitch;
        Runtime.setSoundPan    = setSoundPan;
        Runtime.debugPause     = onPauseButton;
        
        if (oncomplete) { oncomplete(); }
    };

    Runtime.document.close();
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
    for consistency with the rest of nanoscript. */
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


/** Environment is the object to create the constants on (the Runtime
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


/** Called by constants and assets to extend the Runtime environment */
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
        if (assetName[0] === '_') { throw 'Illegal asset name: "' + assetName + '"'; }
        defineImmutableProperty(environment, assetName, deepClone(assets[assetName], alreadySeen));
    }
}


// Hide the UI mode menu if anyone clicks off of it while it is open
window.addEventListener('click',
                        function () {
                            let menu = document.getElementById('uiModeMenu');
                            if (menu && (menu.style.visibility !== 'hidden')) {
                                menu.style.visibility = 'hidden';
                            }
                        });

// Pause when losing focus if currently playing...prevents nano from
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
<span style="color:#937ab7">© 2019 Morgan McGuire</span>
<span style="color:#5ea9d8">Licensed under LGPL 3.0</span>
<span style="color:#859ca6">https://casual-effects.com</span>

`;
    bootScreen.style.zIndex = 100;
    bootScreen.style.visibility = 'visible';
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

    showBootScreen();

    // Let the boot screen show before we add to it
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
        qrcode.makeCode(serverURL);
        document.getElementById('serverURL').innerHTML =
            `<a href="${serverURL}" target="_blank">${serverURL}</a>`;
    }
    
    document.getElementById('playButton').enabled = false;
    onLoadFileStart(url);
    afterLoadGame(url, function () {
        onLoadFileComplete(url);
        hideBootScreen();
        console.log('Loading complete.');
        setFramebufferSize(gameSource.json.screenSize.x, gameSource.json.screenSize.y);
        createProjectWindow(gameSource);
        let resourcePane = document.getElementById('resourcePane');
        resourcePane.innerHTML = `
<br/><center><b style="color:#888">Resource Limits</b></center>
<hr>
<br/>
<table style="margin-left: -2px; width: 100%">
<tr><td width=180>Sprite Pixels</td><td class="right">${Math.round(resourceStats.spritePixels / 1000)}k</td><td>/</td><td class="right" width=40>4719k</td><td class="right" width=45>(${Math.round(resourceStats.spritePixels*100/4718592)}%)</td></tr>
<tr><td>Spritesheets</td><td class="right">${resourceStats.spritesheets}</td><td>/</td><td class="right">64</td><td class="right">(${Math.round(resourceStats.spritesheets*100/64)}%)</td></tr>
<tr><td>Max Spritesheet Width</td><td class="right">${resourceStats.maxSpritesheetWidth}</td><td>/</td><td class="right">1024</td><td class="right">(${Math.round(resourceStats.maxSpritesheetWidth*100/1024)}%)</td></tr>
<tr><td>Max Spritesheet Height</td><td class="right">${resourceStats.maxSpritesheetHeight}</td><td>/</td><td class="right">1024</td><td class="right">(${Math.round(resourceStats.maxSpritesheetHeight*100/1024)}%)</td></tr>
<tr><td>Source Statements</td><td class="right">${resourceStats.sourceStatements}</td><td>/</td><td class="right">8192</td><td class="right">(${Math.round(resourceStats.sourceStatements*100/8192)}%)</td></tr>
<tr><td>Sounds</td><td class="right">${resourceStats.sounds}</td><td>/</td><td class="right">128</td><td class="right">(${Math.round(resourceStats.sounds*100/128)}%)</td></tr>
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
Checking ROM...OK
Checking kernel...OK
Checking RAM...OK
Checking game pad input...OK

Starting...
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
    const optionNames = ['showEntityBoundsEnabled', 'assertEnabled', 'debugPrintEnabled', 'debugWatchEnabled'];
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
        
    loadGameIntoIDE(url , function () {
        onProjectSelect(null, 'game', gameSource.url);
        if (! useIDE) { onPlayButton(); }
    });
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
