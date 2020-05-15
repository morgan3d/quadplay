"use strict";
// Parts of the IDE that are for editing source files using ace.js, vs. simply running and debugging

// How long to wait for new input before saving, to avoid
// constant disk churn
const CODE_EDITOR_SAVE_DELAY = 5; // seconds

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
            // No longer in use...but may be still in the project if it is a doc
            for (let i = 0; i < gameSource.docs.length; ++i) {
                if (gameSource.docs[i].url === url) {
                    // This document is still in the project, so reload the document
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
                // Was the active editing session; swap out for the main project page
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

    if (session.getValue() !== bodyText) {
        // Update the value only when it has changed, to avoid
        // disturbing the active line. Calling setValue()
        // resets the undo history, which is what we want when
        // the disk version has changed.
        session.aux.ignoreChange = true;
        session.setValue(bodyText);
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
    console.assert(url);
    const contents = fileContents[url] || '';
    const session = codeEditorSessionMap.get(url) || createCodeEditorSession(url, contents);
    aceEditor.setSession(session);
    aceEditor.setReadOnly(session.aux.readOnly || ! editableProject);

    document.getElementById('codeEditorUndoContainer').enabled =
        document.getElementById('codeEditorRedoContainer').enabled = aceEditor.getReadOnly();
    
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

    if ((src.length === 0) || (/[0-9A-Za-z_|=-\^]/.test(src[src.length - 1]) && ! src.endsWith('Delta'))) {
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
    if (! replacement && (src[0] === '=') && /^={5,}$/.test(src)) {
        target = src;
        replacement = '═'.repeat(src.length);
    }

    // Event line
    if (! replacement && (src[0] === '-') && /^-{5,}$/.test(src)) {
        target = src;
        replacement = '─'.repeat(src.length);
    }
    
    if (replacement) {
        session.replace(new ace.Range(position.row, position.column - target.length, position.row, position.column), replacement);
        // Advance the cursor to the end over the replacement
        aceEditor.gotoLine(position.row + 1, position.column - target.length + replacement.length + 1, false)
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
        readOnly: readOnly
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
        // onchange handler
        session.on('change', function (delta) {
            if (session.aux.ignoreChange) {
                // Programmatic update using setValue, not a change
                // due to the user. Do not try to save or autocorrect.
                session.aux.ignoreChange = false;
                return;
            }

            if (session.aux.readOnly) { return; }

            // Programmatic change, but can't distinguish search and replace
            // if (! aceEditor.curOp || ! aceEditor.curOp.command.name) { return; }

            if (document.getElementById('automathEnabled').checked) {
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

                    // Update the file contents immediately
                    let contents = session.getValue();

                    const value = url.endsWith('.json') ? WorkJSON.parse(contents) : contents;
                    fileContents[url] = value;
                    
                    const filename = urlToFilename(url);
                    serverWriteFile(filename, 'utf8', contents, function () {
                        if (! url.endsWith('.json') && ! url.endsWith('.pyxl')) {
                            // This must be a doc; update the preview pane, preserving
                            // the scroll position if possible.
                            showGameDoc(url, true);
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
            session.aux.saveTimeoutID = setTimeout(session.aux.saveCallback, CODE_EDITOR_SAVE_DELAY * 1000);
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

   The contents may be a string or arraybuffer
*/
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


/* Schedules gameSource.json to be saved to the .game.json via
   serverSaveGameJSON after a delay. No callback or reload. 
   If a new call comes in, this schedule is delayed. */
function serverScheduleSaveGameJSON(delaySeconds) {
    if (gameSource.saveTimeoutID) {
        // Replace existing pending save
        removePendingSaveCallback(gameSource.saveCallback);
        clearTimeout(gameSource.saveTimeoutID);
    } else {
        ++savesPending;
    }

    const saveCallback = function () {
        // Remove the callback
        removePendingSaveCallback(saveCallback);
        // Clear the timeout in case this function was explicitly invoked
        clearTimeout(gameSource.saveTimeoutID);

        gameSource.saveTimeoutID = null;
        gameSource.saveCallback = null;
        serverSaveGameJSON(function () {
            // Wait until the actual save has occurred before reducing
            // the counter.
            --savesPending;
        });
    };
    gameSource.saveCallback = saveCallback;
    
    if (delaySeconds > 0) {
        pendingSaveCallbacks.push(saveCallback);
        gameSource.saveTimeoutID = setTimeout(saveCallback, (delaySeconds || 0) * 1000);
    } else {
        saveCallback();
    }
}


/* Save the current .game.json file, which has
   presumably been modified by the caller */
function serverSaveGameJSON(callback) {
    const gameFilename = urlToFilename(gameSource.jsonURL);

    console.assert(gameFilename.endsWith('.game.json'));
 
    const gameContents = WorkJSON.stringify(getEditableGameJSON(), undefined, 3);
    serverWriteFile(gameFilename, 'utf8', gameContents, callback);
}


/** Returns an editable copy of the game JSON, suitable for editing when saving the project. */
function getEditableGameJSON() {
    const gameJSON = deep_clone(gameSource.json);
    
    // Remove the auto-generated elements
    for (let i = 0; i < gameJSON.modes.length; ++i) {
        if (gameJSON.modes[i].startsWith('quad://')) {
            gameJSON.modes.splice(i, 1);
            --i;
        }
    }
    
    for (const key in gameJSON.assets) {
        if (key.startsWith('_')) {
            delete gameJSON.assets[key];
        }
    }
    
    return gameJSON;
}

///////////////////////////////////////////////////////////////////////////////////////////

const licenseTable = {
    All: 'All Rights Reserved. Redistribution prohibited.',
    GPL: 'Open source under the GPL-3.0-only license https://www.gnu.org/licenses/gpl-3.0.html',
    MIT: 'Open source under the MIT license https://opensource.org/licenses/MIT',
    BSD: 'Open source under the BSD 3-Clause license https://opensource.org/licenses/BSD-3-Clause',
    CC0: 'Released into the public domain; CC0 licensed https://creativecommons.org/share-your-work/public-domain/cc0/'
};


function onProjectInitialModeChange(target) {
    const modes = gameSource.json.modes;
    for (let i = 0; i < modes.length; ++i) {
        modes[i] = modes[i].replace(/\*/g, '');

        // Mark the newly selected value
        if (modes[i] === target.value) {
            modes[i] += '*';
        }
    }
    serverSaveGameJSON(function () { loadGameIntoIDE(window.gameURL); });
}


function onProjectLicensePreset(license) {
    const projectLicense = document.getElementById('projectLicense');
    projectLicense.value = licenseTable[license];
    onProjectMetadataChanged();
}


function onProjectMetadataChanged(projectLicense) {
    const t = document.getElementById('projectTitle').value.trim();
    const titleChanged = t !== gameSource.json.title;
    gameSource.json.title = t;

    const textFields = ['developer', 'copyright', 'license', 'description'];
    for (let f = 0; f < textFields.length; ++f) {
        const key = textFields[f];
        gameSource.json[key] = document.getElementById('project' + capitalize(key)).value.trim();
    }

    const boolFields = ['Cooperative', 'Competitive', 'High Scores', 'Achievements'];
    for (let f = 0; f < boolFields.length; ++f) {
        const name = boolFields[f];
        const key = name.replace(/ /g,'').toLowerCase();
        gameSource.json[key] = document.getElementById('project' + capitalize(key)).checked ? true : false;
    }

    const mn = parseInt(document.getElementById('projectMinPlayers').value);
    const mx = parseInt(document.getElementById('projectMaxPlayers').value);
    gameSource.json.min_players = Math.min(mn, mx);
    gameSource.json.max_players = Math.max(mn, mx);
    document.getElementById('projectMinPlayers').value = gameSource.json.min_players;
    document.getElementById('projectMaxPlayers').value = gameSource.json.max_players;
    
    serverSaveGameJSON(titleChanged ? function () { loadGameIntoIDE(window.gameURL); }: undefined);
}


function capitalize(key) {
    return key[0].toUpperCase() + key.substring(1);
}

function onProjectYUpChange(target) {
    gameSource.json.y_up = (target.checked === true);
    serverSaveGameJSON();
}


function onProjectScreenSizeChange(target) {
    const res = JSON.parse(target.value);
    gameSource.json.screen_size = res;
    serverSaveGameJSON();
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



enter
────────────────────────────────────────────────────────────────────────



frame
────────────────────────────────────────────────────────────────────────



leave
────────────────────────────────────────────────────────────────────────

`;
    // Tell the server

    // Canonicalize slashes and remove the game.json
    let gamePath = gameSource.jsonURL.replace(/\\/g, '/');
    if (gamePath.startsWith(location.origin)) {
        gamePath = gamePath.substring(location.origin.length);
    }

    const gameFilename = gamePath;
    console.assert(gameFilename.endsWith('.game.json'));

    // Construct the game.json contents
    const gameJSON = getEditableGameJSON();

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
    // Tell the server

    // Canonicalize slashes and remove the game.json
    let gamePath = gameSource.jsonURL.replace(/\\/g, '/');
    if (gamePath.startsWith(location.origin)) {
        gamePath = gamePath.substring(location.origin.length);
    }

    const gameFilename = gamePath;
    console.assert(gameFilename.endsWith('.game.json'));

    // Construct the game.json contents
    const gameJSON = getEditableGameJSON();

    // Add the new mode
    gameJSON.scripts.push(name);

    // Convert to a string
    const gameContents = WorkJSON.stringify(gameJSON, undefined, 4);

    let scriptFilename = gamePath.replace(/\/[^/]+\.game\.json$/, '\/');
    if (! scriptFilename.endsWith('/')) { scriptFilename += '/'; }

    scriptFilename += name;

    // Write the file and then reload
    serverWriteFiles([{filename: scriptFilename, contents: '\n', encoding: 'utf8'},
                      {filename: gameFilename, contents: gameContents, encoding: 'utf8'}],
                     function () {
        loadGameIntoIDE(window.gameURL, function () {
            // Find the script in the new project and select it
            onProjectSelect(document.getElementById('ScriptItem_' + name.replace(/\.pyxl$/, '')), 'script', name);
        })});
    
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

        const gameJSON = getEditableGameJSON();
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
                                         onProjectSelect(document.getElementById('DocItem_' + name), 'doc', gameSource.docs[i]);
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
	const codeEditorContentFrame = document.getElementById('codeEditorContentFrame');	

	codePlusFrame.style.gridTemplateRows = `${Math.min(codePlusFrame.clientHeight - 6, Math.max(0, event.clientY - 26))}px 7px auto`;
	event.preventDefault();
        
        // Do not resize the aceEditor while dragging--it is slow. Wait until onCodeEditorDividerDragEnd()
    }
}
