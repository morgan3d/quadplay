"use strict";
// Parts of the IDE that are for editing source files using ace.js, vs. simply running and debugging

// How long to wait for new input before saving, to avoid
// constant disk churn
const CODE_EDITOR_SAVE_DELAY_SECONDS = 5;

// How long to wait when saving an asset file's json, which
// typically receives very brief edits
const ASSET_EDITOR_SAVE_DELAY_SECONDS = 1.5;

// Maps filenames to editor sessions. Cleared when a project is loaded
const codeEditorSessionMap = new Map();

/* True if a URL does not match the current server */
function isRemote(url) {
    return ! url.startsWith(location.origin + '/');
}

/** Returns the path to the quadplay root from location.origin */
function getQuadPath() {
    return location.pathname.replace(/\/console\/quadplay\.html$/, '\/');
}


/* Returns the path to the game's root, relative to location.origin */
function getGamePath() {
    let gamePath = gameSource.jsonURL.replace(/\\/g, '/').replace(/\/[^/]+\.game\.json$/g, '/');
    if (gamePath.startsWith(location.origin)) {
        gamePath = gamePath.substring(location.origin.length);
    }
    if (/^\/[A-Za-z]:\//.test(gamePath)) {
        // Remove the leading slash on Windows absolute paths
        gamePath = gamePath.substring(1);
    }
    return gamePath;
}

/* Reference count for outstanding saves to all files. Used to disable reload
   temporarily while a save is pending. */
let savesPending = 0;

/** Array of pending save callbacks. It is possible for savesPending to be nonzero
    when this is empty if the callbacks have run but the saves themselves haven't
    completed. */
let pendingSaveCallbacks = [];
function removePendingSaveCallback(callback) {
    const i = pendingSaveCallbacks.indexOf(callback);
    if (i !== -1) {
        pendingSaveCallbacks.splice(i, 1);
    } else {
        console.warn('Could not find a callback to remove.');
    }
}

/**
   If there are saves pending, run the callbacks as soon
   as possible and execute the followup function when
   
 */
function runPendingSaveCallbacksImmediately() {
    // Work with a clone of the array because calling these functions
    // removes them from pendingSaveCallbacks.
    const copy = pendingSaveCallbacks.slice();
    for (let i = 0; i < copy.length; ++i) { copy[i](); }

    console.assert(pendingSaveCallbacks.length === 0);
}


function onIncreaseFontSizeButton() {
    setCodeEditorFontSize(codeEditorFontSize + 2);
}


function onDecreaseFontSizeButton() {
    setCodeEditorFontSize(codeEditorFontSize - 2);
}


function onCodeEditorSearchButton() {
    aceEditor.execCommand('find');
}


function onCodeEditorUndoButton() {
    aceEditor.session.getUndoManager().undo();
}


function onCodeEditorRedoButton() {
    aceEditor.session.getUndoManager().redo();
}


function removeAllCodeEditorSessions() {
    codeEditorSessionMap.clear();
}


/* Update all sessions from fileContents after load, and destroy
   any that no longer are needed. */
function updateAllCodeEditorSessions() {
    codeEditorSessionMap.forEach(function (session, url) {
        const newText = fileContents[url];
        if (newText === undefined) {
            // No longer in use by the code editor...but may be still in the project if it is a doc
            for (let i = 0; i < gameSource.docs.length; ++i) {
                if (gameSource.docs[i] === url) {
                    // This document is still in the project, so reload the document and
                    // abort removal.
                    LoadManager.fetchOne({forceReload: true}, url, 'text', null, function (doc) {
                        fileContents[url] = doc;
                        updateCodeEditorSession(url, doc);
                    });

                    return;
                }
            }

            // Really not in use
            codeEditorSessionMap.delete(url);
            if (session === aceEditor.session) {
                // This was the active editing session; swap out for the main project page
                onProjectSelect(document.getElementsByClassName('projectTitle')[0], 'game', null);
            }
        } else {
            updateCodeEditorSession(url, newText);
        }
    });
}


/* bodyText can also be json, which will be immediately serialized. */
function updateCodeEditorSession(url, bodyText) {
    console.assert(bodyText !== undefined, 'bodyText required');

    const session = codeEditorSessionMap.get(url);

    console.assert(session, 'Editor session not found!');
    console.assert(session.aux.url === url, 'Inconsistent url in codeEditorSessionMap');

    if (typeof bodyText === 'undefined' || typeof bodyText === 'null') {
        bodyText = '\n';
    } else if (typeof bodyText !== 'string') {
        bodyText = WorkJSON.stringify(bodyText, undefined, 4);
    }

    if (session.errorMarker) { session.removeMarker(session.errorMarker); }

    if (session.getValue() !== bodyText) {
        // Update the value only when it has changed, to avoid
        // disturbing the active line. Calling setValue()
        // resets the undo history, which is what we want when
        // the disk version has changed. Tell the onChange
        // handler that it can ignore the change because it is
        // programmatic and does not require saving or autocorrect.
        session.aux.ignoreChange = true;
        session.setValue(bodyText);
        session.aux.ignoreChange = false;
    }
}


function setCodeEditorSessionMode(session, mode) {
    session.aux.mode = mode;
    codeEditorSessionModeDisplay.innerHTML = mode;

    // Changing the session almost always happens after the layout has
    // changed, so update the ace layout, which does not automatically
    // adjust to the grid changes.
    setTimeout(function() { aceEditor.resize(); });
}


function setCodeEditorSession(url) {
    if (aceEditor.session.errorMarker) { aceEditor.session.removeMarker(aceEditor.session.errorMarker); }
    console.assert(url);
    const contents = fileContents[url] || '';
    const session = codeEditorSessionMap.get(url) || createCodeEditorSession(url, contents);
    aceEditor.setSession(session);
    aceEditor.setReadOnly(session.aux.readOnly || ! editableProject);

    document.getElementById('codeEditorUndoContainer').enabled =
        document.getElementById('codeEditorRedoContainer').enabled =
          aceEditor.getReadOnly();
    
    // Reset the mode so that it is visible
    setCodeEditorSessionMode(session, session.aux.mode);
}


const autocorrectTable = [
    '^-1',      '⁻¹',
    '^0',       '⁰',
    '^1',       '¹',
    '^2',       '²',
    '^3',       '³',
    '^4',       '⁴',
    '^5',       '⁵',
    '^6',       '⁶',
    '^7',       '⁷',
    '^8',       '⁸',
    '^9',       '⁹',
    '^a',       'ᵃ',
    '^d',       'ᵈ',
    '^e',       'ᵉ',
    '^h',       'ʰ',
    '^i',       'ⁱ',
    '^j',       'ʲ',
    '^k',       'ᵏ',
    '^m',       'ᵐ',
    '^n',       'ⁿ',
    '^o',       'ᵒ',
    '^r',       'ʳ',
    '^s',       'ˢ',
    '^t',       'ᵗ',
    '^u',       'ᵘ',
    '^x',       'ˣ',
    '^y',       'ʸ',
    '^z',       'ᶻ',
    '^-x',      '⁻ˣ',
    '^-y',      '⁻ʸ',
    '^-z',      '⁻ᶻ',
    '^-i',      '⁻ⁱ',
    '^-j',      '⁻ʲ',
    '^-k',      '⁻ᵏ',
    '^beta',    'ᵝ', // process before beta, so that it triggers first
    'alpha',    'α',
    'beta',     'β',
    'gamma',    'γ',
    'delta',    'δ',
    'epsilon',  'ε',
    'zeta',     'ζ',
    'eta',      'η',
    'theta',    'θ',
    'iota',     'ι',
    'lambda',   'λ',
    'mu',       'μ',
    'rho',      'ρ',
    'sigma',    'σ',
    'phi',      'ϕ',
    'chi',      'χ',
    'psi',      'ψ',
    'omega',    'ω',
    'Omega',    'Ω',
    'Gamma',    'Γ',
    'Lambda',   'Λ',
    'Theta',    'Θ',
    'Xi',       'Ξ',
    'Pi',       'Π',
    'Sigma',    'Σ',
    'Phi',      'Φ',
    'Psi',      'Ψ',
    'tau',      'τ',
    'xi',       'ξ',
    'pi',       'π',

    // Intentionally disabled (looks weird to experienced programmers):
    // '==',       '≟',
    // 'in',       '∊',
    // '>>',       '▶',
    // '<<',       '◀',
    // '>>=',      '▶=',
    // '<<=',      '◀=',
    
    '?=',       '≟',
    '=?',       '≟',
    '!=',       '≠',
    '<=',       '≤',
    '...',      '…',
    '>=',       '≥',
    'bitand',   '∩',
    'bitor',    '∪',
    'bitxor',   '⊕',
    'bitnot',   '~',
    'infinity', '∞',
    'nil',      '∅',
    '1/2',      '½',
    '1/3',      '⅓',
    '1/4',      '¼',
    '1/5',      '⅕',
    '1/6',      '⅙',
    '1/7',      '⅐',
    '1/8',      '⅛',
    '1/9',      '⅑',
    '1/10',     '⅒',
    '2/3',      '⅔',
    '3/4',      '¾',
    '2/5',      '⅖',
    '3/5',      '⅗',
    '4/5',      '⅘'
];


const autocorrectFunctionTable = [
    'floor()',   '⌊⌋',
    'ceil()',    '⌈⌉',
    'magnitude()', '‖‖',
    'abs()', '||',
    'random()', 'ξ'];


/* Called when the contents change and autocorrect is enabled */
function autocorrectSession(session) {
    const position = aceEditor.getCursorPosition();

    // The current row, including the just-typed character
    let src = session.getTextRange(new ace.Range(position.row, 0, position.row, position.column + 1));

    // ace.js represents the newline as reporting one past the end of the actual range,
    // even though it will draw the cursor on the *next* line.
    if (src.length === position.column) {
        src += '\n';
    }

    if ((src.length === 0) || (/[0-9A-Za-z_|=\-^]/.test(src[src.length - 1]) && ! src.endsWith('Delta'))) {
        // The last character is not a symbol-breaking character, so return immediately
        return;
    }
    
    // See if there are an odd number of double quotes on this row up to this point.
    let quotes = 0;
    for (let i = 0; i < src.length - 1; ++i) {
        if (src[i] === '"') { ++quotes; }
    }
    if (quotes & 1) {
        // There's an odd number of quotes...we must be in a quoted string, so
        // disable autocorrect
        return;
    }

    let target, replacement;

    const lastChar = src[src.length - 1];
    if (lastChar === ')') {
        // Check for special functions. These are weird because we want them to
        // trigger right on the closing paren instead of waiting for the next character,
        // as they are unambiguous immediately after typing.
        for (let i = 0; i < autocorrectFunctionTable.length; i += 2) {
            target = autocorrectFunctionTable[i];
            // Look for a breaking character before the target sequence
            if (((src.length === target.length) ||
                 ((src.length > target.length) &&
                  /[ +\-\.\t\n,:()\[\]]/.test(src[src.length - target.length - 1]))) &&
                src.endsWith(target)) {
                replacement = autocorrectFunctionTable[i + 1];

                session.replace(new ace.Range(position.row, position.column - target.length + 1, position.row, position.column + 1), replacement);
                // Advance the cursor to the end over the replacement
                aceEditor.gotoLine(position.row + 1, position.column - target.length + replacement.length + 1, false)
                return;
            }
        }        
    }

    // Replace Delta immediately on typing the 'a'
    if (! replacement && lastChar === 'a') {
        // Look for a breaking character before the target sequence
        if (src.endsWith('Delta') && ((src.length === 'Delta'.length) || /[ +\-\.\t\n,:()\[\]]/.test(src[src.length - 'Delta'.length - 1]))) {
            replacement = 'Δ';
            target = 'Delta';
            
            session.replace(new ace.Range(position.row, position.column - target.length + 1, position.row, position.column + 1), replacement);
            // Advance the cursor to the end over the replacement
            aceEditor.gotoLine(position.row + 1, position.column - target.length + replacement.length + 1, false)
            return;
        }
    }

    if (! replacement) {
        // Strip the last character, which will not be part of the autocorrect.
        src = src.substring(0, src.length - 1);
        
        // Look for any possible match in substr.
        for (let i = 0; i < autocorrectTable.length; i += 2) {
            target = autocorrectTable[i];
            
            // Look for a breaking character before the target sequence
            if (((src.length === target.length) ||
                 ((src.length > target.length) &&
                  ((target[0] === '^') || // exponents don't need to be broken
                   /[ +\-\.\t\n,:()\[\]∅ΓΨΩΦΣΠΞΛΘΔαβγδεζηθικλμνξπρστυϕχψω]/.test(src[src.length - target.length - 1])))) &&
                src.endsWith(target)) {
                replacement = autocorrectTable[i + 1];                
                break;
            }
        } // for each autocorrect choice
    }

    // Degrees are a very special case. We need to search backwards for
    // the previous breaking character, and then check if we're looking
    // at a number followed by 'deg'
    if (! replacement && /(^|[^A-Za-z_])[\.0-9½⅓⅔¼¾⅕⅖⅗⅘⅙⅐⅛⅑⅒]+deg$/.test(src)) {
        target = 'deg';
        replacement = '°';
    }

    // Mode line
    if (! replacement && /^={5,}$/.test(src)) {
        target = src;
        replacement = '═'.repeat(src.length);
    }

    // Event line
    if (! replacement && /^-{5,}$/.test(src)) {
        target = src;
        replacement = '─'.repeat(src.length);
    }
    
    if (replacement) {
        session.replace(new ace.Range(position.row, position.column - target.length, position.row, position.column), replacement);
        
        // Advance the cursor to the end over the replacement. Ace
        // does not appear to have processed at the editor level that
        // the session has just changed, so it will be off by one in
        // the goto line when the before/after code has different
        // lengths. So, we delay positioning until after the editor
        // has processed the replace.
        setTimeout(function() {
            aceEditor.gotoLine(position.row + 1, position.column - target.length + replacement.length + 1, false)
        });
    }
}


// One session per edited file is created
function createCodeEditorSession(url, bodyText) {
    console.assert(url);
    console.assert(! codeEditorSessionMap.has(url));
    if (typeof bodyText === 'undefined' || typeof bodyText === 'null') {
        bodyText = '\n';
    } else if (typeof bodyText !== 'string') {
        bodyText = WorkJSON.stringify(bodyText, undefined, 4);
    }
    const session = new ace.EditSession(bodyText);

    const readOnly = isRemote(url) || isBuiltIn(url);
    codeEditorSessionMap.set(url, session);
    if (! readOnly) {
        session.setUndoManager(new ace.UndoManager());
    }

    // Extra quadplay data
    session.aux = {
        url: url,
        
        // Increments on change
        epoch: 0,
        
        mode: 'All changes saved.',

        saveTimeoutID: null,

        // Lock all built-in content
        readOnly: readOnly,

        fileType: url.replace(/^.+\.([A-Za-z0-9]+)$/, '$1')
    };
    
    session.setUseSoftTabs(true);
    session.setUseWorker(false);
    if (url.endsWith('.yaml')) {
        session.setMode('ace/mode/yaml');
    } else if (url.endsWith('.md.html') || url.endsWith('.md')) {
        session.setMode('ace/mode/markdown');
    } else if (url.endsWith('.json')) {
        session.setMode('ace/mode/json');
    } else if (url.endsWith('.html')) {
        session.setMode('ace/mode/html');
    } else if (url.endsWith('.pyxl')) {
        session.setMode('ace/mode/pyxlscript');
        session.setTabSize(4);
    }
    session.setUseWrapMode(false);
    
    if (! session.aux.readOnly) {
        const delaySeconds = session.aux.url.endsWith('.json') ? ASSET_EDITOR_SAVE_DELAY_SECONDS : CODE_EDITOR_SAVE_DELAY_SECONDS;
        
        // onchange handler
        session.on('change', function (delta) {
            if (session.aux.ignoreChange) {
                // Programmatic update using setValue, not a change
                // due to the user. Do not try to save or autocorrect.
                return;
            }

            if (session.aux.readOnly) { return; }

            if (session.errorMarker) { session.removeMarker(session.errorMarker); }

            // Remove this object from the cache (if present)
            delete assetCache[session.aux.url];

            // This is code to detect programmatic changes to the value, but it
            // can't distinguish search-and-replace from other
            // code changes, so not a good idea.
            // if (! aceEditor.curOp || ! aceEditor.curOp.command.name) { return; }

            if ((session.aux.fileType === 'pyxl') && document.getElementById('automathEnabled').checked) {
                autocorrectSession(session);
            }
            
            // Cancel the previous pending timeout if there is one
            if (session.aux.saveTimeoutID) {
                --savesPending;
                clearTimeout(session.aux.saveTimeoutID);
                removePendingSaveCallback(session.aux.saveCallback);
            }
            
            // Note that the epoch has changed
            ++session.aux.epoch;
            const myEpoch = session.aux.epoch;
            setCodeEditorSessionMode(session, 'Modified<span class="blink">...</span>');

            ++savesPending;
            session.aux.saveCallback = function () {
                // Remove the callback
                removePendingSaveCallback(session.aux.saveCallback);
                // Clear the timeout in case this function was explicitly invoked
                clearTimeout(session.aux.saveTimeoutID);
                session.aux.saveTimeoutID = null;
                session.aux.saveCallback = null;
                
                if (myEpoch === session.aux.epoch) {
                    // Epoch has not changed since timeout was created, so begin the POST
                    setCodeEditorSessionMode(session, 'Saving<span class="blink">...</span>');

                    // Update the file contents and cache immediately
                    let contents = session.getValue();
                    const value = url.endsWith('.json') ? WorkJSON.parse(contents) : contents;
                    fileContents[url] = value;

                    // If this is present in a cache, delete it
                    delete assetCache[url];
                    
                    const filename = urlToFilename(url);
                    serverWriteFile(filename, 'utf8', contents, function () {
                        if (! url.endsWith('.json') && ! url.endsWith('.pyxl')) {
                            // This must be a doc; update the preview pane, preserving
                            // the scroll position if possible.
                            showGameDoc(url, true);
                        } else if (url.endsWith('.game.json')) {
                            // Reload the game
                            loadGameIntoIDE(window.gameURL, null, true);
                        }
                        
                        --savesPending;
                        if (myEpoch === session.aux.epoch) {
                            // Only change mode if nothing has changed
                            setCodeEditorSessionMode(session, 'All changes saved.');
                        }
                    }, function () {
                        // Error case
                        --savesPending;
                    });
                } else {
                    // Epoch failed
                    --savesPending;
                }
            };

            pendingSaveCallbacks.push(session.aux.saveCallback);

            session.aux.saveTimeoutID = setTimeout(session.aux.saveCallback, delaySeconds * 1000);
        });
    }
    
    return session;
}


/*
    .-------------------.                    
   | "All changes saved" |<------------------------------------------------------.
    '---------+---------'            POST callback with epoch === epoch[url]     |
              |                                                                  |
.------------>+  onchange()                                                      |
|             v                                                                  |
| +-----------------------+                                                      |
| | 1. setTimeout(...)    |                                                      |
| |                       |                                                      |
| +-----------+-----------+                                                      |
|             |                                                                  |
|             v                       +--------------------------+               |
|   .-------------------.   timeout   | 1. fileContents[url]=... |       .-------+------.
+<-+      "Modified"     +----------->| 2. serverWriteFile(...)  +----->|   "Saving..."  |
^   '-------------------'             +--------------------------+       '-------+------'
|                                                                                |
'--------------------------------------------------------------------------------'
                                   onchange()
*/


///////////////////////////////////////////////////////////////////////////////////

// Payload should be JSON. It will be stringified
function postToServer(payload, callback, errorCallback) {
    console.assert(locallyHosted());

    payload.token = postToken;

    const serverAddress = location.href.replace(/(^http.?:\/\/[^/]+\/).*/, '$1');
                          
    const xhr = new XMLHttpRequest();
    xhr.open("POST", serverAddress, true);

    // Send the proper header information along with the request
    xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    
    xhr.onreadystatechange = function() {
        if (this.readyState === XMLHttpRequest.DONE) {
            // Request finished. Do processing here.
            const jsonResponse = WorkJSON.parse(xhr.response);
            if ((this.status >= 200) && (this.status <= 299)) {
                if (callback) {
                    // Give the server a little more time to catch up
                    // if it is writing to disk and needs to flush or
                    // such before invoking the callback.
                    setTimeout(function () { callback(jsonResponse, this.status); }, 150);
                }
            } else if (errorCallback) {
                errorCallback(jsonResponse, this.status);
            }
        }
    }
    
    xhr.send(JSON.stringify(payload));
}


/* Convert a URL to a local filename suitable for use with serverWriteFile() */
function urlToFilename(url) {
    url = url.replace(/\\/g, '/');
    
    if (url.startsWith(location.origin + '/')) {
        url = url.substring(location.origin.length + 1);
    }

    if (url[0] !== '/') { url = '/' + url; }

    return url;
}


/* Tells a quadplay server to write this file to disk and then invoke
   the callback when the server is done. If the filename is a url,
   computes the appropriate local file. 

   The contents may be a string or arraybuffer */
function serverWriteFile(filename, encoding, contents, callback, errorCallback) {
    console.assert(encoding === 'utf8' || encoding === 'binary');
    
    if (typeof contents !== 'string') {
        console.assert(contents.byteLength !== undefined && encoding === 'binary');
        
        // Contents are an arraybuffer. base64 encode to a string.
        // JavaScript requires us to pack into a string and then
        // base64 encode that string to another string.
        const len = contents.byteLength;
        const view = new Uint8Array(contents);
        const array = new Array(len);
        for (let i = 0; i < len; ++i) {
            array[i] = String.fromCharCode(view[i]);
        }
        contents = window.btoa(array.join(''));
    }

    postToServer({
        command: 'write_file',
        filename: filename,
        encoding: encoding,
        contents: contents
    }, callback, errorCallback);

    if (filename.endsWith('.pyxl')) {
        updateTodoList();
    }
}


/** Write a set of files and invoke the callback when they have all completed */
function serverWriteFiles(array, callback, errorCallback) {
    let complete = 0;
    function onSuccess() {
        ++complete;
        if (complete >= array.length && callback) { callback(); }
    }

    for (let i = 0; i < array.length; ++i) {
        serverWriteFile(array[i].filename, array[i].encoding, array[i].contents, onSuccess, errorCallback);
    }
}


///////////////////////////////////////////////////////////////////////////////////////////

function onNewModeCreate() {
    const text = document.getElementById('newModeName');

    // Clean up
    let name = text.value.trim().replace(/[^A-Za-z0-9_]/g, '');
    if (name.length === 0) { return; }

    // Capitalize
    name = name[0].toUpperCase() + name.substring(1);
    if (! /[A-Z]/.test(name[0])) {
        alert('The mode name must begin with a capital letter');
        return;
    }

    // Make sure that the mode doesn't already exist in this project
    for (let i = 0; i < gameSource.modes.length; ++i) {
        if (gameSource.modes[i].name.replace(/\*/g, '') === name) {
            alert('A mode named ' + name + ' already exists in this project.');
            return;
        }
    }

    // Name is OK, create the mode
    const modeContents = `${name}
════════════════════════════════════════════════════════════════════════
// Put local state for the mode here.  Declare variables with let, constants with const, and functions with def.


enter
────────────────────────────────────────────────────────────────────────
// This event runs when the mode is entered via set_mode() or push_mode().


frame
────────────────────────────────────────────────────────────────────────
// This event runs 60 times per second. Game logic, simulation, user input, and drawing all go here.


leave
────────────────────────────────────────────────────────────────────────
// This event runs just before leaving for another mode by set_mode() or pop_mode().

`;
    // Tell the server

    // Canonicalize slashes and remove the game.json
    let gamePath = gameSource.jsonURL.replace(/\\/g, '/');
    if (gamePath.startsWith(location.origin)) {
        gamePath = gamePath.substring(location.origin.length);
    }

    const gameFilename = gamePath;
    console.assert(gameFilename.endsWith('.game.json'));

    const gameJSON = gameSource.json;

    // Add the new mode
    gameJSON.modes.push(name);

    // Convert to a string
    const gameContents = WorkJSON.stringify(gameJSON, undefined, 4);

    let modeFilename = gamePath.replace(/\/[^/]+\.game\.json$/, '\/');
    if (! modeFilename.endsWith('/')) { modeFilename += '/'; }
    
    modeFilename += name + '.pyxl';

    // Write the file and then reload
    serverWriteFiles([{filename: modeFilename, contents: modeContents, encoding: 'utf8'},
                      {filename: gameFilename, contents: gameContents, encoding: 'utf8'}],
                     function () {
        loadGameIntoIDE(window.gameURL, function () {
            // Find the mode in the new project and select it
            let mode;
            for (let i = 0; i < gameSource.modes.length; ++i) {
                if (gameSource.modes[i].name === name) { mode = gameSource.modes[i]; break; }
            }
            
            if (mode) {
                onProjectSelect(document.getElementById('ModeItem_' + name), 'mode', mode);
            } else {
                console.log('ERROR: could not find the mode that was just added');
            }
        })})
    
    hideNewModeDialog();
}


function showNewModeDialog() {
    document.getElementById('newModeDialog').classList.remove('hidden');
    document.getElementById('newModeCreateButton').disabled = true;
    const text = document.getElementById('newModeName');
    text.value = "";
    text.focus();
}


function hideNewModeDialog() {
    document.getElementById('newModeDialog').classList.add('hidden');
    document.getElementById('newModeName').blur();
}

///////////////////////////////////////////////////////////////////////////////////////////

function showNewScriptDialog() {
    document.getElementById('newScriptDialog').classList.remove('hidden');
    document.getElementById('newScriptCreateButton').disabled = true;
    const text = document.getElementById('newScriptName');
    text.value = "";
    text.focus();
}


function hideNewScriptDialog() {
    document.getElementById('newScriptDialog').classList.add('hidden');
    document.getElementById('newScriptName').blur();
}


function onNewScriptCreate() {
    const text = document.getElementById('newScriptName');

    // Clean up
    let name = text.value.trim().replace(/[^A-Za-z0-9_\-+=]/g, '');
    if (name.length === 0) { return; }
    name += '.pyxl';

    // Make sure that the script doesn't already exist in this project
    for (let i = 0; i < gameSource.scripts.length; ++i) {
        if (gameSource.scripts[i].replace(/^.*\//, '') === name) {
            alert('A script named ' + name + ' already exists in this project.');
            return;
        }
    }

    // Name is OK, create the script

    // Canonicalize slashes and remove the game.json
    let gamePath = gameSource.jsonURL.replace(/\\/g, '/');
    if (gamePath.startsWith(location.origin)) {
        gamePath = gamePath.substring(location.origin.length);
    }

    const gameFilename = gamePath;
    console.assert(gameFilename.endsWith('.game.json'));

    // Construct the game.json contents
    const gameJSON = gameSource.json;

    // Add the new mode
    gameJSON.scripts.push(name);

    // Convert to a string
    const gameContents = WorkJSON.stringify(gameJSON, undefined, 4);

    let scriptFilename = gamePath.replace(/\/[^/]+\.game\.json$/, '\/');
    if (! scriptFilename.endsWith('/')) { scriptFilename += '/'; }

    scriptFilename += name;

    // Write the file and then reload
    serverWriteFiles([{filename: scriptFilename, contents: '// Scripts, variables, and constants here are visible to all modes\n', encoding: 'utf8'},
                      {filename: gameFilename, contents: gameContents, encoding: 'utf8'}],
                     function () {
        loadGameIntoIDE(window.gameURL, function () {
            // Find the script in the new project and select it
            const url = gameSource.jsonURL.replace(/\/[^/]+\.game\.json$/, '\/') + name;
            const id = 'ScriptItem_' + url;
            onProjectSelect(document.getElementById(id), 'script', url);
        }, true)});
    
    hideNewScriptDialog();
}

///////////////////////////////////////////////////////////////////////////////////////////

function showNewDocDialog() {
    document.getElementById('newDocDialog').classList.remove('hidden');
    document.getElementById('newDocCreateButton').disabled = true;
    const text = document.getElementById('newDocName');
    text.value = "";
    text.focus();
    
    document.getElementById('newDocFormat').value = ".md.html";
    document.getElementById('newDocTemplate').value = "empty";
}


function hideNewDocDialog() {
    document.getElementById('newDocDialog').classList.add('hidden');
    document.getElementById('newDocName').blur();
}


function onNewDocCreate() {
    const name = document.getElementById('newDocName').value;
    const format = document.getElementById('newDocFormat').value;
    const templateName = document.getElementById('newDocTemplate').value;

    // Canonicalize slashes and remove the game.json
    let gamePath = gameSource.jsonURL.replace(/\\/g, '/');
    if (gamePath.startsWith(location.origin)) {
        gamePath = gamePath.substring(location.origin.length);
    }
    const gameFilename = gamePath;
    console.assert(gameFilename.endsWith('.game.json'));
    gamePath = gamePath.replace(/\/[^/]+\.game\.json$/, '\/');
    
    const docFilename = gamePath + name + format;

    // Load the template and then callback to save
    const templateFilename = makeURLAbsolute('', 'quad://console/templates/' + templateName + format);

    LoadManager.fetchOne({}, templateFilename, 'text', null, function (templateBody) {
        if (format === '.md.html') {
            // for .md.html files, compute a relative path to Markdeep
            const quadPath = getQuadPath();
            const basePath = longestCommonPathPrefix(gamePath, quadPath);

            console.assert(! /\b\.?\.\//.test(basePath), "Assumed no ../");

            // Construct the relative path to the quad:// root
            const relPath = '../'.repeat(gamePath.substring(basePath.length).split('/').length - 1);

            templateBody = templateBody.replace(/src="doc\/markdeep\.min\.js"/g, 'src="' + relPath + 'doc/markdeep.min.js"');
        }

        const gameJSON = gameSource.json;
        gameJSON.docs.push({name: name, url: name + format});
        
        // Write the file and then reload
        serverWriteFiles([{filename: docFilename, contents: templateBody, encoding: 'utf8'},
                          {filename: gameFilename, contents: WorkJSON.stringify(gameJSON, undefined, 4), encoding: 'utf8'}],
                         function () {
                             loadGameIntoIDE(window.gameURL, function () {
                                 // Find the doc in the new project and select it
                                 for (let i = 0; i < gameSource.docs.length; ++i) {
                                     if (gameSource.docs[i].name === name) {
                                         // Found the match
                                         const id = doc.replace(/[^A-Za-z0-9-_+\/]/g, '_');
                                         onProjectSelect(document.getElementById('DocItem_' + id), 'doc', gameSource.docs[i]);
                                         return;
                                     }
                                 }
                                 console.log('Could not find ' + name);
                             });
                         });
    },
                         
                              function (reason, url) {
                                  console.log('fail', reason);
                              });
    
    hideNewDocDialog();
}


function longestCommonPathPrefix(A, B) {
    let i = 0;
    for (; i < A.length; ++i) {
        if (A[i] !== B[i]) {
            if (i === 0) { return ''; }
            break;
        }
    }
    
    // Walk back to the previous '/'
    while (i >= 0 && A[i] !== '/') { --i; }
    if (i < 0) { return ''; }
    return A.substring(0, i + 1);
}


/**********************************************************************/

let codeEditorDividerInDrag = false;

function onCodeEditorDividerDragStart() {
    codeEditorDividerInDrag = true;
    document.getElementById('codePlusFrame').style.cursor = 'ns-resize';
}


function onCodeEditorDividerDragEnd() {
    if (codeEditorDividerInDrag) {
        codeEditorDividerInDrag = false;	
        document.getElementById('codePlusFrame').style.cursor = 'auto';
        aceEditor.resize();
    }
}


function onCodeEditorDividerDrag(event) {
    if (codeEditorDividerInDrag) {
	const codePlusFrame = document.getElementById('codePlusFrame');
        const topHeight = Math.min(codePlusFrame.clientHeight - 6, Math.max(0, event.clientY - 26 - 24));
	codePlusFrame.style.gridTemplateRows = `auto ${topHeight}px auto 1fr`;
	event.preventDefault();
        
        // Do not resize the aceEditor while dragging most of the time--it is slow. Wait until onCodeEditorDividerDragEnd()
        if (Math.random() < 0.07) {
            aceEditor.resize();
        }
    }
}


function onCodeEditorGoToLineButton() {
    const result = parseInt(window.prompt("Go to line:", ""));
    if (! isNaN(result)) {
        aceEditor.gotoLine(result, 0, true);
        aceEditor.focus();
    }
}

/** Generates the todo() list in the debugger from gamesource */
function updateTodoList() {
    if (! useIDE) { return; }
    const todoPane = document.getElementById('todoPane');

    let result = '<table style="width: 100%">\n';
    let hasAnyTodo = false;

    function processFile(type, name, url) {
        const source = fileContents[url];
        if (source === undefined) {
            console.log("No source code for " + url);
            return;
        }
        
        // Terminate early if there's no todo() at all
        if (source.indexOf('todo(') === -1) { return; }

        // Header
        result += '<tr><td colspan=2 style="border-bottom: double 3px; padding-bottom: 1px">';
        if (type === 'mode') {
            result += `<code>${name}</code>`;
        } else {
            result += name;
        }
        result += '</td></tr>\n';

        // Individual items
        let line = 1;
        let pos = 0;
        while (pos < source.length) {
            // Find the first of a "todo" or newline
            let a = source.indexOf('todo(', pos);
            if (a === -1) { a = Infinity; }
            
            let b = source.indexOf('\n', pos);
            if (b === -1) { b = Infinity; }

            if (b < a) {
                // Newline was first
                ++line;
            } else if (a < b) {
                // "todo(" was first. Find the end
                a += "todo(".length;

                // Find the start quote
                while (a < source.length && source[a] !== '"' && source[a] !== '\n') { ++a; }
                if (a === source.length || source[a] === '\n') {
                    // This is an ill-formed todo() statement; stop processing
                    // this file.
                    console.log('Newline or end of file in todo in ' + name);
                    break;
                }
                
                // a is now the open quote position. Find the end
                ++a;
                b = a;
                while (b < source.length && source[b] !== '\n' && (source[b] !== '"' || source[b - 1] === '\\')) { ++b; }
                if (b === source.length || source[b] === '\n') {
                    // This is an ill-formed todo() statement; stop processing
                    // this file.
                    console.log('Newline or end of file in todo in ' + name);
                    break;
                }

                // b is now the close quote position
                const message = escapeHTMLEntities(source.substring(a, b));
                result += `<tr valign=top style="cursor:pointer" onclick="editorGotoFileLine('${url}', ${line})">` +
                    `<td style="text-align: right; padding-right:10px">${line}</td><td>${message}</td></tr>\n`;
            }
            
            pos = b + 1;
        }

        // Separator
        result += `<tr><td colspan=2>&nbsp;</td></tr>\n`;
        hasAnyTodo = true;
    }
    
    for (let i = 0; i < gameSource.scripts.length; ++i) {
        const url = gameSource.scripts[i];
        processFile('script', url.replace(/^.*\//, ''), url);
    }
    
    for (let i = 0; i < gameSource.modes.length; ++i) {
        const mode = gameSource.modes[i];
        if (mode.name[0] !== '_') {
            processFile('mode', mode.name.replace('*', ''), mode.url);
        }
    }

    result += '</table>';
    
    // If there are no todo() statements
    if (! hasAnyTodo) {
        result += 'Put <code>todo()</code> statements in your code to automatically generate this list.';
    }

    todoPane.innerHTML = result;//`<div class="hideScrollBars" style="width: 97%">${result}</div>`;
}


/** Lines and characters are 1-based. Silently ignored if the 
    url does not correspond to a script or mode in the project.  */
function editorGotoFileLine(url, line, character) {
    if (character === undefined) { character = 1; }

    for (let i = 0; i < gameSource.modes.length; ++i) {
        const mode = gameSource.modes[i];
        if (mode.url === url) {
            // Found the mode
            onProjectSelect(document.getElementById('ModeItem_' + mode.name.replace('*', '')), 'mode', mode);
            aceEditor.focus();
            aceEditor.gotoLine(line, character - 1, false);
            return;
        }
    }

    // Look in scripts
    const i = gameSource.scripts.indexOf(url);
    if (i !== -1) {
        onProjectSelect(document.getElementById('ScriptItem_' + url), 'script', url);
        aceEditor.focus();
        aceEditor.gotoLine(line, character - 1, false);
    }
}


function showModeContextMenu(mode) {
    const id = 'ModeItem_' + mode.name.replace('*', '');

    let s = `<div onmousedown="onProjectSelect(document.getElementById('${id}'}), 'mode', gameSource.modes[${gameSource.modes.indexOf(mode)}])">Edit</div>`;
    if (! mode.name.endsWith('*')) {
        s += `<div onmousedown="onProjectInitialModeChange({value:'${mode.name}'})">Set As Initial Mode</div>`
    }

    customContextMenu.innerHTML = s;
    showContextMenu();
}
