/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */
'use strict';

// Maps expression strings to values
let debugWatchTable = {changed: false};

function debug_watch(location, expression, value) {
    // The value must be unparsed immediately, since it can be mutated
    // after this function returns.

    // Pretty-print the value (hint = expression, specialStructs = true)
    const html = QRuntime.$unparse(value, new Map(), ': ', false, true, false, '', expression, true);

    debugWatchTable[location.url + ':' + location.line_number] = {
        location: location,
        expression: expression,
        value: html,
        game_frames: QRuntime.game_frames
    };
    
    debugWatchTable.changed = true;
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
            m = QRuntime.$unparse(m, new Map(), ': ', false, true, false, '', expression, prettyPrint);
            
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
}


// Injected as assert in QRuntime
function assert(x, m) {
    if (! x) {
        throw new Error(m || "Assertion failed");
    }
}


/* Callback for the nested pretty printer when the tree control is expanded */
function onExpanderClick(event) {
    event.stopPropagation();
    event.target.parentElement.classList.toggle('closed');
}

