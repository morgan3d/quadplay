/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */
'use strict';

// Maps expression strings to values
let debugWatchTable = {changed: false};

/* True if no debug_print or debug_watch statement
   has yet been hit this run. Set to true by restartProgram() */
let firstPrintOrWatch;

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


function debug_watch(location, expression, value) {
    // The value must be unparsed immediately, since it can be mutated
    // after this function returns.

    // Pretty-print the value (hint = expression, specialStructs = true)
    const html = QRuntime.$unparse(value, new Map(), ': ', false, true, false, false, '', expression, true, true);

    debugWatchTable[location.url + ':' + location.line_number] = {
        location: location,
        expression: expression,
        value: html,
        game_frames: QRuntime.game_frames
    };
    
    debugWatchTable.changed = true;
    if (firstPrintOrWatch) {
        firstPrintOrWatch = false;
        // Show the tab
        document.getElementById('watchTab').checked = true;
    }
}


function updateDebugWatchDisplay() {
    let s = '';
    
    for (const id in debugWatchTable) {
        // Skip the changed flag
        if (id === 'changed') { continue; }
        
        const watch = debugWatchTable[id];
        let tooltip = watch.location.url.replace(/^.*\//, '');
        if (/[A-Z]/.test(tooltip[0])) {
            // For modes, remove the extension
            tooltip = tooltip.replace(/\.pyxl$/, '');
        }
        tooltip += ':' + watch.location.line_number;

        const age = QRuntime.game_frames - watch.game_frames;
        const brightness = 0.4 + 0.6 * (age <= 1 ? 1.0 : age <= 30 ? 0.5 : 15 / age);
        s += `<tr valign=top style="color:hsl(0, 0%, ${100 * brightness}%)"><td width=35% title="${tooltip}" style="cursor:pointer" onclick="editorGotoFileLine('${watch.location.url}', ${watch.location.line_number}, undefined, false)">${watch.expression}</td><td>${watch.value}</td></tr>`;
    }
    
    const pane = document.getElementById('debugWatchDisplayPane');
    if (pane.innerHTML !== s) {
        pane.innerHTML = '<table width=100% style="border-collapse: collapse">' + s + '</table>';
    }
    
    debugWatchTable.changed = false;
}


// Injected as debug_print in QRuntime
// Escapes HTML
function debug_print(location, expression, ...args) {
    const prettyPrint = document.getElementById('prettyPrintEnabled').checked;
    let s = '';
    for (let i = 0; i < args.length; ++i) {
        let m = args[i]

        if (typeof m !== 'string') {
            m = QRuntime.$unparse(m, new Map(), ': ', false, true, false, false, '', expression, prettyPrint, prettyPrint);
            
            if (! prettyPrint) {
                // Pretty printing automatically escapes HTML entities
                // in strings. When not pretty printing we need to do
                // so explicitly.
                m = escapeHTMLEntities(m);
            }
        } else {
            m = escapeHTMLEntities(m);
        }
        
        s += m;
        
        if (i < args.length - 1) {
            s += ' ';
        }
    }
    
    $outputAppend(s + '\n', location);

    if (firstPrintOrWatch) {
        firstPrintOrWatch = false;
        // Show the tab
        document.getElementById('outputTab').checked = true;
    }

}


/* Callback for the nested pretty printer when the tree control is expanded */
function onExpanderClick(event) {
    event.stopPropagation();
    event.target.parentElement.classList.toggle('closed');
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
    if (useIDE && (QRuntime.game_frames === 0 || debugWatchEnabled.checked) && ((emulatorMode === 'play') || debugWatchTable.changed)) {
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


function onCopyPerformanceSummary() {
    let summary = `Framerate ${debugFrameRateDisplay.textContent} ${debugFramePeriodDisplay.textContent}; `;
    summary += `${debugFrameTimeDisplay.textContent} Total = ${debugCPUTimeDisplay.textContent} CPU + ${debugGPUTimeDisplay.textContent} GPU + ${debugPPUTimeDisplay.textContent} Phys + ${debugBrowserTimeDisplay.textContent} ${browserName}`;
    navigator.clipboard.writeText(summary);
}