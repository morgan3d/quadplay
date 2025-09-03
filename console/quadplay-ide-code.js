"use strict";
// Parts of the IDE that are for editing source and JSON files using ace.js
// This file is only loaded when useIDE = true

// How long to wait for new input before saving, to avoid
// constant disk churn
const CODE_EDITOR_SAVE_DELAY_SECONDS = 5;

// How long to wait when saving an asset file's json, which
// typically receives very brief edits
const ASSET_EDITOR_SAVE_DELAY_SECONDS = 2.5;

// Maps filenames to editor sessions. Cleared when a project is loaded
const codeEditorSessionMap = new Map();


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
   as possible.
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


function onCodeEditorUndoButton(event) {
    if (aceEditor) {
        aceEditor.undo();
    }
}


function onCodeEditorRedoButton(event) {
    if (aceEditor) {
        aceEditor.redo();
    }
}


function removeAllCodeEditorSessions() {
    codeEditorSessionMap.clear();
}


/* Update all sessions from fileContents after load, and destroy any
   that no longer are needed. 
*/
function updateAllCodeEditorSessions() {
    codeEditorSessionMap.forEach(function (session, url) {
        const newText = fileContents[url];
        if (newText === undefined) {
            // The file is no longer in use by the code editor...but
            // may be still in the project if it is a doc
            for (let i = 0; i < gameSource.docs.length; ++i) {
                if (gameSource.docs[i] === url) {
                    // This document is still in the project, so
                    // reload the document and abort removal.
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


/* `bodyText` can also be json, which will be immediately serialized. 
   Does not update fileContents[url].
   
   Assumes that the code editor is open for `url` already.
 */
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


/* Controls the Find in Files button visibility based on current file type */
function updateFindInFilesButtonVisibility(currentURL) {
    const isPyxlFile = currentURL && currentURL.endsWith('.pyxl');
    const container = document.getElementById('findInFilesContainer');
    container.enabled = Boolean(isPyxlFile);
    container.style.visibility = isPyxlFile ? 'visible' : 'hidden';
}


/* Loads url into the code editor, creating a new editor if needed and
   reusing a cached one if available.

   `assetName` may be undefined */
function setCodeEditorSession(url, assetName) {
    console.assert(url);
    setEditorTitle(url);
    if (aceEditor.session.errorMarker) { aceEditor.session.removeMarker(aceEditor.session.errorMarker); }
    const contents = fileContents[url] || '';
    const session = codeEditorSessionMap.get(url) || createCodeEditorSession(url, contents, assetName);
    aceEditor.setSession(session);
    aceEditor.setReadOnly(session.aux.readOnly || ! editableProject);

    // Update API list after session is set
    if (session.aux.fileType === 'pyxl') {
        updateCodeEditorAPIList();
    }

    document.getElementById('codeEditorUndoContainer').enabled =
        document.getElementById('codeEditorRedoContainer').enabled =
          ! aceEditor.getReadOnly();
    
    // Enable/disable Find in Files button based on file type and toolbar visibility
    updateFindInFilesButtonVisibility(url);
    
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
    '&=',       '∩=',
    '|=',       '∪=',
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

    if ((src.length === 0) || (/[0-9A-Za-z_|=\-^]/.test(src[src.length - 1]) && ! src.endsWith('Delta') && ! src.endsWith('...'))) {
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
        if (src.endsWith('Delta') && ((src.length === 'Delta'.length) || /[ +\-\.\t\n,\|:()\[\]⌊⌋⌈⌉]/.test(src[src.length - 'Delta'.length - 1]))) {
            replacement = 'Δ';
            target = 'Delta';
            
            session.replace(new ace.Range(position.row, position.column - target.length + 1, position.row, position.column + 1), replacement);
            // Advance the cursor to the end over the replacement
            aceEditor.gotoLine(position.row + 1, position.column - target.length + replacement.length + 1, false)
            return;
        }
    }


    if (! replacement && lastChar === '.' && src.endsWith('...')) {
        replacement = '…';
        target = '...';
        
        session.replace(new ace.Range(position.row, position.column - target.length + 1, position.row, position.column + 1), replacement);
        // Advance the cursor to the end over the replacement
        aceEditor.gotoLine(position.row + 1, position.column - target.length + replacement.length + 1, false)
        return;
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
                   /[ +\-\.\t\n,\|:()\[\]∅ΓΨΩΦΣΠΞΛΘΔαβγδεζηθικλμνξπρστυϕχψω]/.test(src[src.length - target.length - 1])))) &&
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


/* One session per edited file is created */
function updateCodeEditorAPIList() {
    const dropdown = document.getElementById('codeEditorAPIList');
    if (!dropdown || !aceEditor) return;
    
    const session = aceEditor.getSession();
    if (!session || !session.aux || !session.aux.url) return;
    
    // Show/hide dropdown based on file type
    if (session.aux.fileType === 'pyxl') {
        dropdown.style.display = 'block';
    } else {
        dropdown.style.display = 'none';
        return;
    }
    
    const content = session.getValue();
    const lines = content.split('\n');
    
    // Clear existing options except the first one
    dropdown.innerHTML = '<option value="">Go to API...</option>';
    
    const functions = [];
    const variables = [];
    const events = [];
    
    // Regex patterns
    const defPattern = /^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;
    const letConstPattern = /^(?:let|const)\s+([a-zA-Z_][a-zA-Z0-9_]*)/;
    const eventPattern = /^[ ]*(init|enter|frame|leave|pop_mode|[\$_A-Z][a-zA-Z_0-9]*)[ ]*(\([^\n\)]*\))?[ ]*(\bfrom[ ]+[\$_A-Za-z][\$A-Za-z_0-9]*)?\s*$/;
    const separatorPattern = /^((?:-|─|—|━|⎯){5,})[ ]*$/;
    
    for (let i = 0; i < lines.length; ++i) {
        const line = lines[i];
        
        // Check for functions
        const defMatch = line.match(defPattern);
        if (defMatch) {
            functions.push({name: defMatch[1] + '()', line: i + 1});
        }
        
        // Check for variables/constants
        const varMatch = line.match(letConstPattern);
        if (varMatch) {
            variables.push({name: varMatch[1], line: i + 1});
        }
        
        // Check for events (look for name followed by separator on next line)
        const eventMatch = line.match(eventPattern);
        if (eventMatch && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (separatorPattern.test(nextLine)) {
                events.push({name: eventMatch[1], line: i + 1});
            }
        }
    }
    
    // Sort each section alphabetically
    const nameComparator = (a, b) => a.name.localeCompare(b.name);
    functions.sort(nameComparator);
    variables.sort(nameComparator);
    events.sort(nameComparator);
    
    // Add sections with separators
    if (variables.length > 0) {
        const group = document.createElement('optgroup');
        group.label = 'Variables';
        variables.forEach(variable => {
            const option = document.createElement('option');
            option.value = variable.line;
            option.textContent = variable.name;
            group.appendChild(option);
        });
        dropdown.appendChild(group);
    }
    
    if (functions.length > 0) {
        const group = document.createElement('optgroup');
        group.label = 'Functions';
        functions.forEach(func => {
            const option = document.createElement('option');
            option.value = func.line;
            option.textContent = func.name;
            group.appendChild(option);
        });
        dropdown.appendChild(group);
    }
    
    if (events.length > 0) {
        const group = document.createElement('optgroup');
        group.label = 'Events';
        events.forEach(event => {
            const option = document.createElement('option');
            option.value = event.line;
            option.textContent = event.name;
            group.appendChild(option);
        });
        dropdown.appendChild(group);
    }
}

function onCodeEditorAPIListChange(dropdown) {
    if (!dropdown.value || !aceEditor) return;
    
    const lineNumber = parseInt(dropdown.value);
    aceEditor.gotoLine(lineNumber, 0, true);
    aceEditor.focus();
    
    // Reset dropdown to show "Go to API..."
    dropdown.selectedIndex = 0;
}

function createCodeEditorSession(url, bodyText, assetName) {
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

    console.assert(! url.endsWith('.sprite.json') || assetName !== undefined,
                   'Undefined asset name for ' + url);
    // Extra quadplay data
    session.aux = {
        url: url,
        
        // Increments on change
        epoch: 0,

        // Undefined for non-assets
        assetName: assetName,
        
        mode: 'All changes saved.',

        saveTimeoutID: null,

        // Lock all built-in content
        readOnly: readOnly,

        fileType: url.replace(/^.+\.([A-Za-z0-9]+)$/, '$1')
    };

    session.setOptions({
        useSoftTabs: true,
        tabSize: 4,
        navigateWithinSoftTabs: true,
        wrap: false,
        useWorker: false
    })

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
    }
    
    if (! session.aux.readOnly) {
        const delaySeconds = session.aux.fileType === 'json' ? ASSET_EDITOR_SAVE_DELAY_SECONDS : CODE_EDITOR_SAVE_DELAY_SECONDS;
        
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

            if (session.aux.fileType === 'pyxl') {

                if (document.getElementById('automathEnabled').checked) {
                    autocorrectSession(session);
                }

                maybeShowDocumentationForSession(session);
                
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
                    fileContents[url] = contents;

                    // Test whether the JSON file can successfully
                    // parse before trying to reload. This will not
                    // stop the save either way.
                    let parseOK = true;
                    if (url.endsWith('.json')) {
                        try {
                            parseOK = false;
                            WorkJSON.parse(contents);
                            parseOK = true;
                        } catch (e) {
                            console.log('Saved but did not reload ' + url + ' because it cannot parse correctly in the current state.');
                        }
                    }

                    // If this is present in a cache, delete it
                    delete assetCache[url];

                    const filename = urlToLocalWebPath(url);
                    serverWriteFile(filename, 'utf8', contents, function () {

                        // If JSON, see if the current contents can
                        // parse before trying to reload anything
                        if (session.aux.fileType !== 'json' || parseOK) {
                            if (session.aux.fileType !== 'json' && session.aux.fileType !== 'pyxl') {
                                // This must be a doc; update the preview pane, preserving
                                // the scroll position if possible.
                                showGameDoc(url, true);
                            } else if (url.endsWith('.sprite.json')) {
                                // Reload the game to pick up the new sprite, and then
                                // reselect
                                loadGameAndConfigureUI(window.gameURL, function () {
                                    // (for a spritesheet in a map, it has a dot in it)
                                    const assetName = session.aux.assetName;

                                    let spritesheet;
                                    if (assetName.indexOf('.') !== -1) {
                                        // Spritesheet within a map
                                        const map = gameSource.assets[assetName.replace(/\..*$/, '')];
                                        const spritesheetName = assetName.replace(/^.*\./, '');
                                        if (spritesheetName === 'spritesheet') {
                                            spritesheet = map.spritesheet;
                                        } else {
                                            spritesheet = map.spritesheet_table[spritesheetName];
                                        }
                                        console.assert(spritesheet);
                                    } else {
                                        spritesheet = gameSource.assets[assetName];
                                        console.assert(spritesheet);
                                    }
                                    onProjectSelect(document.getElementById('projectAsset_' + assetName), 'asset', spritesheet);
                                }, true);
                                
                            } else if (url.endsWith('.game.json')) {
                                const RELOAD_FAST = true;
                                // Avoid cursor jumps
                                const NO_UPDATE_EDITORS = true;
                                
                                // Reload the game
                                loadGameAndConfigureUI(window.gameURL, function () {
                                    // Update the IDE view
                                    visualizeGame(document.getElementById('gameEditor'), url, gameSource.json)
                                }, RELOAD_FAST, NO_UPDATE_EDITORS);
                            }
                        }
                        
                        --savesPending;
                        if (myEpoch === session.aux.epoch) {
                            // Only change mode if nothing has changed
                            setCodeEditorSessionMode(session, 'All changes saved.');
                            
                            // Update API list when file is saved
                            if (session.aux.fileType === 'pyxl') {
                                updateCodeEditorAPIList();
                            }
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
    xhr.open('POST', serverAddress, true);

    // Send the proper header information along with the request
    xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
    
    xhr.onreadystatechange = function () {
        if (this.readyState === XMLHttpRequest.DONE) {
            // Request finished. Do callback processing here.
            const fcn = ((this.status >= 200) && (this.status <= 299)) ?
                  callback :
                  errorCallback;

            //console.log(this.status);

            // Run the callback if there is one. On Windows, there can
            // be race conditions for filesystem writes, so we delay
            // the callback 25ms everywhere (maybe that will
            // occur on other platforms)
            if (fcn) {
                const json = WorkJSON.parse(xhr.response);
                const status = this.status;
                setTimeout(fcn, 25, json, status);
            }
        }
    }
    
    xhr.send(JSON.stringify(payload));
}


/* Convert a URL to a local webpath suitable for use with serverWriteFile() */
function urlToLocalWebPath(url) {
    console.assert(url !== undefined, 'Tried to convert undefined webPath');
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

   encoding is utf8 or binary

   The contents may be a string or arraybuffer. To convert JSON to a string,
   use WorkJSON.stringify. */
function serverWriteFile(webpath, encoding, contents, callback, errorCallback) {
    console.assert(encoding === 'utf8' || encoding === 'binary');
    console.assert(contents !== undefined);
    console.assert(! /^http[s]:\/\//.test(webpath), 'serverWriteFile() expects a local webpath, not a URL');
    console.assert(webpath[1] !== ':', 'serverWriteFile() on Windows must have a / at the front of absolute paths, not a raw drive letter.')
    
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
        url: webpath,
        encoding: encoding,
        contents: contents
    }, callback, errorCallback);

    if (webpath.endsWith('.pyxl')) {
        updateTodoList();
        updateProgramDocumentation();
    }
}


function serverDeleteFile(url, callback, errorCallback) {
    console.assert(locallyHosted());

    console.log('Deleting', url);
    const xhr = new XMLHttpRequest();
    xhr.open("DELETE", url, true);

    // Send the proper header information along with the request
    xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    
    xhr.onreadystatechange = function() {
        if (this.readyState === XMLHttpRequest.DONE) {
            // Request finished. Do processing here.
            const jsonResponse = /^[ \t\n]*$/.test(xhr.response) ? undefined : WorkJSON.parse(xhr.response);
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
    
    xhr.send(JSON.stringify({token: postToken}));
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
// Put local state for the mode here.  Declare variables with let,
// constants with const, and functions with def.


enter
────────────────────────────────────────────────────────────────────────
// This event runs when the mode is entered via set_mode() or
//  push_mode().


frame
────────────────────────────────────────────────────────────────────────
// This event runs 60 times per second. Game logic, simulation,
// user input, and drawing all go here.


leave
────────────────────────────────────────────────────────────────────────
// This event runs just before leaving for another mode by
// set_mode() or pop_mode().

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
        loadGameAndConfigureUI(window.gameURL, function () {
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

function showImportModeDialog() {
    document.getElementById('importModeDialog').classList.remove('hidden');
    let gamePath = getGamePath();
    const codeListURL = location.origin + getQuadPath() + 'console/_scripts.json?gamePath=' + gamePath;
    document.getElementById('importModeImportButton').disabled = true;
    
    // Fetch the mode list
    LoadManager.fetchOne({forceReload: true}, codeListURL, 'json', null, function (json) {
        // Strip the path to the current game off scripts in the same dir
        // or subdirectory of it. We do not do this on the server side
        // because we may later allow developers to have their own asset directories
        // separate from games, and the existing protocol allows that.
        if (gamePath.length > 0 && gamePath[0] === '/') {
            gamePath = gamePath.substring(1);
        }

        for (let i = 0; i < json.length; ++i) {
            const url = json[i];
            if (url.startsWith(gamePath)) {
                json[i] = url.substring(gamePath.length);
            }

            // Remove scripts
            if (! /(^|\/)[A-Z][^\/]*$/.test(json[i])) {
                json.splice(i, 1);
                --i;
            }
        }
        
        // Create the initial display
        let s = '<ol id="importModeListOL" class="select-list">\n';
        for (let i = 0; i < json.length; ++i) {
            const file = json[i];

            // Disable if already in the project
            const disable = (gameSource.json.modes.indexOf(file) !== -1);
            
            const path = (file.indexOf('/') === -1) ? '' : file.replace(/\/[^\/]+$/, '/');
            const rest = file.replace(/^.*\//, '');
            const base = rest.replace(/\..+?$/, '');
            const ext  = rest.replace(/^[^\.]+/, '');
            s += `<li ${disable ? '' : 'onclick="onImportModeListSelect(this)"'}>${path}<b style="color:#000">${base}</b></li>\n`;
        }
        s += '</ol>';

        document.getElementById('importModeList').innerHTML = s;
    });

}


function hideImportModeDialog() {
    document.getElementById('importModeDialog').classList.add('hidden');
}


function onImportModeImport() {
    const url = document.getElementById('importModeListOL').selected;
    gameSource.json.modes.push(url);
    serverSaveGameJSON(function () {
        hideImportModeDialog();
        loadGameAndConfigureUI(window.gameURL, undefined, true);
    });
}


function onImportModeListSelect(target) {
    const list = document.getElementById('importModeListOL');
    for (let i = 0; i < list.children.length; ++i) {
        list.children[i].classList.remove('selected');
    }
    target.classList.add('selected');
    list.selected = target.innerText;

    document.getElementById('importModeImportButton').disabled = false;
}

///////////////////////////////////////////////////////////////////////////////////////////

function showImportScriptDialog() {
    document.getElementById('importScriptDialog').classList.remove('hidden');
    let gamePath = getGamePath();
    const assetListURL = location.origin + getQuadPath() + 'console/_scripts.json?gamePath=' + gamePath;
    document.getElementById('importScriptImportButton').disabled = true;
    
    // Fetch the script list
    LoadManager.fetchOne({forceReload: true}, assetListURL, 'json', null, function (json) {
        // Strip the path to the current game off scripts in the same dir
        // or subdirectory of it. We do not do this on the server side
        // because we may later allow developers to have their own asset directories
        // separate from games, and the existing protocol allows that.
        if (gamePath.length > 0 && gamePath[0] === '/') {
            gamePath = gamePath.substring(1);
        }

        for (let i = 0; i < json.length; ++i) {
            const url = json[i];
            if (url.startsWith(gamePath)) {
                json[i] = url.substring(gamePath.length);
            }

            // Remove modes
            if (/(^|\/)[A-Z][^\/]*$/.test(json[i])) {
                json.splice(i, 1);
                --i;
            }
        }
        
        // Create the initial display
        let s = '<ol id="importScriptListOL" class="select-list">\n';
        for (let i = 0; i < json.length; ++i) {
            const file = json[i];

            // Disable if already in the project
            const disable = (gameSource.json.scripts.indexOf(file) !== -1);
            
            const path = (file.indexOf('/') === -1) ? '' : file.replace(/\/[^\/]+$/, '/');
            const rest = file.replace(/^.*\//, '');
            const base = rest.replace(/\..+?$/, '');
            const ext  = rest.replace(/^[^\.]+/, '');
            s += `<li ${disable ? '' : 'onclick="onImportScriptListSelect(this)"'}>${path}<b style="color:#000">${base}</b>${ext}</li>\n`;
        }
        s += '</ol>';

        document.getElementById('importScriptList').innerHTML = s;
    });

}


function hideImportScriptDialog() {
    document.getElementById('importScriptDialog').classList.add('hidden');
}


function onImportScriptImport() {
    const url = document.getElementById('importScriptListOL').selected;
    gameSource.json.scripts.push(url);
    hideImportScriptDialog();
    serverSaveGameJSON(function () {
        loadGameAndConfigureUI(window.gameURL, undefined, true);
    });
}


function onImportScriptListSelect(target) {
    const list = document.getElementById('importScriptListOL');
    for (let i = 0; i < list.children.length; ++i) {
        list.children[i].classList.remove('selected');
    }
    target.classList.add('selected');
    list.selected = target.innerText;

    document.getElementById('importScriptImportButton').disabled = false;
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
    let gameFilename = gameSource.jsonURL.replace(/\\/g, '/');
    if (gameFilename.startsWith(location.origin)) {
        gameFilename = gameFilename.substring(location.origin.length);
    }
    console.assert(gameFilename.endsWith('.game.json'));

    // Add the new script
    gameSource.json.scripts.push(name);

    // Convert to a string
    const gameContents = WorkJSON.stringify(gameSource.json, undefined, 4);

    const scriptFilename = getGamePath() + name;

    // Write the file and then reload
    serverWriteFiles([{filename: scriptFilename, contents: '// Scripts, variables, and constants here are visible to all modes\n', encoding: 'utf8'},
                      {filename: gameFilename, contents: gameContents, encoding: 'utf8'}],
                     function () {
        loadGameAndConfigureUI(window.gameURL, function () {
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
    let gameFilename = gameSource.jsonURL.replace(/\\/g, '/');
    if (gameFilename.startsWith(location.origin)) {
        gameFilename = gameFilename.substring(location.origin.length);
    }
    console.assert(gameFilename.endsWith('.game.json'));
    
    const docFilename = getGamePath() + name + format;

    // Load the template and then callback to save
    const templateFilename = makeURLAbsolute('', 'quad://console/templates/' + templateName + format);

    LoadManager.fetchOne({}, templateFilename, 'text', null, function (templateBody) {
        if (format === '.md.html') {
            // for .md.html files, compute a relative path to Markdeep
            const quadPath = getQuadPath();
            const basePath = longestCommonPathPrefix(getGamePath(), quadPath);

            console.assert(! /\b\.?\.\//.test(basePath), "Assumed no ../");

            // Construct the relative path to the quad:// root
            const relPath = '../'.repeat(getGamePath().substring(basePath.length).split('/').length - 1);

            templateBody = templateBody.replace(/src="doc\/markdeep\.min\.js"/g, 'src="' + relPath + 'doc/markdeep.min.js"');
        }

        const gameJSON = gameSource.json;
        gameJSON.docs.push({name: name, url: name + format});
        
        // Write the file and then reload
        serverWriteFiles([{filename: docFilename, contents: templateBody, encoding: 'utf8'},
                          {filename: gameFilename, contents: WorkJSON.stringify(gameJSON, undefined, 4), encoding: 'utf8'}],
                         function () {
                             loadGameAndConfigureUI(window.gameURL, function () {
                                 // Find the doc in the new project and select it
                                 for (let i = 0; i < gameSource.docs.length; ++i) {
                                     if (gameSource.docs[i].name === name) {
                                         // Found the match
                                         onProjectSelect(document.getElementById('DocItem_' + doc), 'doc', gameSource.docs[i]);
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

///////////////////////////////////////////////////////////////////////////////////////////

function showImportDocDialog() {
    document.getElementById('importDocDialog').classList.remove('hidden');
    let gamePath = getGamePath();
    const docListURL = location.origin + getQuadPath() + 'console/_docs.json?gamePath=' + gamePath;
    document.getElementById('importDocImportButton').disabled = true;
    
    // Fetch the doc list
    LoadManager.fetchOne({forceReload: true}, docListURL, 'json', null, function (json) {
        // Strip the path to the current game off docs in the same dir
        // or subdirectory of it.

        if (gamePath.length > 0 && gamePath[0] === '/') {
            gamePath = gamePath.substring(1);
        }

        for (let i = 0; i < json.length; ++i) {
            const url = json[i];
            if (url.startsWith(gamePath)) {
                json[i] = url.substring(gamePath.length);
            }
        }
        
        // Create the display
        let s = '<ol id="importDocListOL" class="select-list">\n';
        for (let i = 0; i < json.length; ++i) {
            const file = json[i];

            // Disable if already in the project
            const disable = (gameSource.json.docs.indexOf(file) !== -1);
            
            const path = (file.indexOf('/') === -1) ? '' : file.replace(/\/[^\/]+$/, '/');
            const rest = file.replace(/^.*\//, '');
            const base = rest.replace(/\..+?$/, '');
            const ext  = rest.replace(/^[^\.]+/, '');
            s += `<li ${disable ? '' : 'onclick="onImportDocListSelect(this)"'}>${path}<b style="color:#000">${base}</b>${ext}</li>\n`;
        }
        s += '</ol>';

        document.getElementById('importDocList').innerHTML = s;
    });
}


function hideImportDocDialog() {
    document.getElementById('importDocDialog').classList.add('hidden');
}


function onImportDocImport() {
    const url = document.getElementById('importDocListOL').selected;
    gameSource.json.docs.push(url);
    hideImportDocDialog();
    serverSaveGameJSON(function () {
        loadGameAndConfigureUI(window.gameURL, undefined, true);
    });
}


function onImportDocListSelect(target) {
    const list = document.getElementById('importDocListOL');
    for (let i = 0; i < list.children.length; ++i) {
        list.children[i].classList.remove('selected');
    }
    target.classList.add('selected');
    list.selected = target.innerText;
    document.getElementById('importDocImportButton').disabled = false;
}


/**********************************************************************/

let codeEditorDividerInDrag = false;
let codeEditorDividerDragOffset = 0;

function onCodeEditorDividerDragStart(event) {
    codeEditorDividerInDrag = true;
    document.getElementById('codePlusFrame').classList.add('resizing');
    
    // Store the offset from the top of the divider to where the user clicked
    const dividerRect = document.getElementById('codeEditorDivider').getBoundingClientRect();
    codeEditorDividerDragOffset = event.clientY - dividerRect.top;
}


function onCodeEditorDividerDragEnd() {
    if (codeEditorDividerInDrag) {
        codeEditorDividerInDrag = false;	
        document.getElementById('codePlusFrame').classList.remove('resizing');
        aceEditor.resize();
    }
}


function setCodeEditorDividerFromLocalStorage() {
    let dividerHeight = parseInt(localStorage.getItem('codeDividerTop'));
    if (isNaN(dividerHeight) || dividerHeight > window.innerHeight - 64) {
        // Fallback
        dividerHeight = '1fr';
    } else {
        dividerHeight += 'px';
    }
    codePlusFrame.style.gridTemplateRows = `${dividerHeight} auto auto 1fr`;
}


function onCodeEditorDividerDrag(event) {
    if (codeEditorDividerInDrag) {
	    const codePlusFrame = document.getElementById('codePlusFrame');
        const codePlusFrameRect = codePlusFrame.getBoundingClientRect();
        const topHeight = Math.min(codePlusFrame.clientHeight - 6, Math.max(0, event.clientY - codePlusFrameRect.top - codeEditorDividerDragOffset));
	    codePlusFrame.style.gridTemplateRows = `${topHeight}px auto auto 1fr`;
        localStorage.setItem('codeDividerTop', Math.round(topHeight));
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


/** Generates the todo() list in the debugger from gameSource.scripts
    and gameSource.modes */
function updateTodoList() {
    if (! useIDE) { return; }
    const todoView = document.getElementById('todoView');

    let result = '<table style="width: 100%">\n';
    let hasAnyTodo = false;

    function processFile(type, name, url) {
        const source = fileContents[url];
        if (source === undefined) {
            console.log('No source code for ' + url);
            return;
        }
        
        // Terminate early if there's no todo() at all
        if (source.indexOf('todo(') === -1) { return; }

        // Individual items
        let line = 1;
        let pos = 0;

        // Track the current top-level section or function
        // in which the todos occur
        let currentParseEvent = {url: url, line: undefined, name: undefined};
        let currentParseFunction = {url: url, line: undefined, name: undefined};

        // Location of the previous newline in source, which
        // is used when parsing sections
        let prevNewLinePos = -1;

        // Table mapping all sections (with insertion order mapping
        // the order in which they appear) to arrays of the todos.
        // Top-level is the empty string section. Insert top-level
        // first to ensure that it always appears first.
        const sectionTable = {'': {url: url, line: 1, todoArray: []}};

        //////////////////////////////////////////////////////////////////////////
        // Parse
        
        while (pos < source.length) {
            // Find the first of a "todo" or newline
            let a = source.indexOf('todo(', pos);
            if (a === -1) { a = Infinity; }
            
            let b = source.indexOf('\n', pos);
            if (b === -1) { b = Infinity; }

            if (b < a) {
                // Newline was first
                ++line;

                const chr = source[b + 1];
                if (chr !== ' ' && chr !== '\t') {
                    // Top-level line that may change the current
                    // parse event/function
                    let lineEnd = source.indexOf('\n', b + 1);
                    if (lineEnd === -1) { lineEnd = source.length; }
                    const defMatch = source.substring(b + 1, lineEnd).match(/def[ \t]+([^ \t \(]+)/);
                    if (defMatch) {
                        // Entering a function
                        currentParseFunction.name = defMatch[1] + '()';
                        currentParseFunction.line = line;
                    } else {
                        // Any other top-level line (not a function definition) means
                        // we're no longer inside the previous function
                        currentParseFunction.name = undefined;
                    }
                }
                prevNewLinePos = b;
                
            } else if (a < b) {
                // "todo(" appears before the next newline
                    
                // Find the end
                a += 'todo('.length;

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
                
                // Use the current function context (which gets reset to undefined 
                // when we encounter top-level code)
                const displaySection =
                      currentParseFunction.name ?
                      currentParseFunction :
                      currentParseEvent.name ? 
                      currentParseEvent : {name: ''};

                let section = sectionTable[displaySection.name];
                if (! section) { sectionTable[displaySection.name] = section = {url: displaySection.url, line: displaySection.line, todoArray: []}; }

                section.todoArray.push({url: url, line: line, message: message});
            }
            
            pos = b + 1;
        }

        //////////////////////////////////////////////////////////////////////
        // Visualize todos

        // Remove empty top-level sections
        if (sectionTable[''].todoArray.length === 0) { delete sectionTable['']; }

        // Header
        result += `<tr style="cursor:pointer" onclick="editorGotoFileLine('${url}', 1)"><td colspan="2" style="border-bottom: double 3px; padding-bottom: 1px"><b style="color: var(--theme-color)">`;
        if (type === 'mode') {
            result += `<code">${name}</code>`;
        } else {
            result += name;
        }
        result += '</b></td></tr>\n';

        let first = true;
        for (let sectionName in sectionTable) {
            const section = sectionTable[sectionName];
            
            // Put headers between groups of todos
            if (sectionName !== '') {
                if (! first) { result += '<tr><td colspan="2" height="6px"></td></tr>'; }
                result += `<tr onclick="editorGotoFileLine('${section.url}', ${section.line})" style="cursor:pointer; font-weight: bold; color:var(--theme-color)"><td colspan="2"><code>${sectionName}:</code></td></tr>`;
            }

            for (let i = 0; i < section.todoArray.length; ++i) {
                const todo = section.todoArray[i];
                result += `<tr valign=top style="cursor:pointer" onclick="editorGotoFileLine('${todo.url}', ${todo.line})">` +
                    `<td style="text-align: right; padding-right:10px">${todo.line}</td><td>${todo.message}</td></tr>\n`;
            } // i
            
            first = false;
        } // section

        // Separator between files
        result += '<tr><td colspan=2>&nbsp;</td></tr>\n';
        hasAnyTodo = true;
    } // processFile()
    
    for (let i = 0; i < gameSource.scripts.length; ++i) {
        const url = gameSource.scripts[i];
        // Do not save internal quadplay scripts
        if (! /(^|\/)_[A-Za-z0-9]+\.pyxl$/.test(url[0])) {
            processFile('script', url.replace(/^.*\//, ''), url);
        }
    }
    
    for (let i = 0; i < gameSource.modes.length; ++i) {
        const mode = gameSource.modes[i];
        // Do not save internal quadplay modes
        if (mode.name[0] !== '_') {
            processFile('mode', mode.name.replace('*', ''), mode.url);
        }
    }

    result += '</table>';
    
    // If there are no todo() statements
    if (! hasAnyTodo) {
        result += 'Put <a href="../doc/manual.md.html#standardlibrary/debugging" target="_blank"><code>todo()</code></a> statements in your code to automatically generate this list.';
    }

    todoView.innerHTML = result;//`<div class="hideScrollBars" style="width: 97%">${result}</div>`;
}


/** Lines and characters are 1-based. Silently ignored if the 
    url does not correspond to a script or mode in the project.  
    
    - `url`: The URL of the file to load
    - `line`: The line number to go to (1-based)
    - `character`: The character position to go to (1-based, defaults to 1)
    - `highlight`: Whether to highlight the line (optional, defaults to false)
    */
function editorGotoFileLine(url, line, character, highlight) {
    if (character === undefined) { character = 1; }

    let done = false;
    for (let i = 0; i < gameSource.modes.length; ++i) {
        const mode = gameSource.modes[i];
        if (mode.url === url) {
            // Found the mode
            onProjectSelect(document.getElementById('ModeItem_' + mode.name.replace('*', '')), 'mode', mode);
            aceEditor.focus();
            aceEditor.gotoLine(line, character - 1, false);
            done = true;
            break;
        }
    }

    if (! done) {
        // Look in scripts
        const i = gameSource.scripts.indexOf(url);
        if (i !== -1) {
            onProjectSelect(document.getElementById('ScriptItem_' + url), 'script', url);
            aceEditor.focus();
            aceEditor.gotoLine(line, character - 1, false);
        }
    }

    if (highlight) {
        const Range = ace.require('ace/range').Range;
        if (aceEditor.session.errorMarker) { aceEditor.session.removeMarker(aceEditor.session.errorMarker); }
        aceEditor.session.errorMarker = aceEditor.session.addMarker(new Range(line - 1, 0, line - 1, 1), "aceErrorMarker", "fullLine", false);
    }
}


function showModeContextMenu(mode) {
    const id = 'ModeItem_' + mode.name;

    let s = `<div onmousedown="onProjectSelect(document.getElementById('${id}'}), 'mode', gameSource.modes[${gameSource.modes.indexOf(mode)}])">Edit</div>`;
    if (mode.name !== gameSource.json.start_mode) {
        s += `<div onmousedown="onProjectInitialModeChange('${mode.name}')">Set As Start Mode</div>`
    }
    
    const builtIn = isBuiltIn(makeURLRelativeToGame(mode.name + '.pyxl'));
    if (! builtIn) {
        s += `<div onmousedown="onRenameMode('${mode.name}')">Rename&hellip;</div>`
    }

    s += `<hr><div onmousedown="onRemoveMode('${mode.name}')"><span style="margin-left:-18px; width:18px; display:inline-block; text-align:center">&times;</span>Remove ${mode.name}</div>`

    customContextMenu.innerHTML = s;
    showContextMenu('project');
}


function onRemoveMode(modeName) {
        
    const index = gameSource.json.modes.indexOf(modeName);
    console.assert(index !== -1);
    gameSource.json.modes.splice(index, 1);

    if (modeName === gameSource.json.start_mode) {
        // Choose another mode
        if (gameSource.json.modes.length > 0) {
            gameSource.json.start_mode = gameSource.json.modes[0];
        } else {
            gameSource.json.start_mode = '';
        }
    }
    
    serverSaveGameJSON(function () { loadGameAndConfigureUI(window.gameURL, null, true); });
}


function onRenameMode(modeName) {    
    let newName;

    while (true) {
        newName = window.prompt("New name for mode '" + modeName + "'", modeName);
        if (! newName || newName === '') { return; }

        // Remove extension
        newName = newName.replace(/\.[^\.]+$/, '');
        
        // Check for conflict
        if (/^[^a-zA-Z_]/.test(newName) || /[^a-zA-Z0-9_]/.test(newName)) {
            window.alert("'" + newName + "' is not a legal mode name");
        } if (gameSource.json.modes.indexOf[newName]) {
            window.alert("There is already another mode named '" + newName + "'");
        } else {
            break;
        }
    }
    
    // Change the name in the gameSource.json
    {
        const index = gameSource.json.modes.indexOf(modeName);
        console.assert(index !== -1, 'Could not find mode ' + modeName);
        gameSource.json.modes[index] = newName;
    }
    
    if (modeName === gameSource.json.start_mode) {
        gameSource.json.start_mode = newName;
    }

    const oldURL = makeURLAbsolute(gameSource.jsonURL, modeName + '.pyxl');
    function deleteOldFile() { serverDeleteFile(oldURL); }

    
    function saveAndReloadProject() {
        console.log(gameSource.jsonURL);
        console.assert(gameSource.jsonURL);
        console.assert(window.gameURL);
        serverSaveGameJSON(function () {
            loadGameAndConfigureUI(window.gameURL, deleteOldFile, true);
        });
    }

    // Save mode under the new name, renaming the file
    const code = fileContents[oldURL].replace(new RegExp(`(^|\n)${modeName}[ \t]*(?=\n===|\n═══)`), '$1' + newName);
    serverWriteFile(urlToLocalWebPath(makeURLRelativeToGame(newName + '.pyxl')), 'utf8', code, saveAndReloadProject);
}


/** Moves a script up or down in the execution order */
function onMoveScript(scriptURL, deltaIndex) {
    const index = gameSource.scripts.indexOf(scriptURL);
    console.assert(index !== -1);

    const old = gameSource.json.scripts[index];
    gameSource.json.scripts[index] = gameSource.json.scripts[index + deltaIndex];
    gameSource.json.scripts[index + deltaIndex] = old;
    serverSaveGameJSON(function () { loadGameAndConfigureUI(window.gameURL, null, true); });
}


function onRemoveScript(scriptURL) {
    const index = gameSource.scripts.indexOf(scriptURL);
    console.assert(index !== -1);
    gameSource.json.scripts.splice(index, 1);
    serverSaveGameJSON(function () { loadGameAndConfigureUI(window.gameURL, null, true); });
}


function showScriptContextMenu(scriptURL) {
    if (! gameSource.scripts) { return; }

    const id = 'ScriptItem_' + scriptURL;
    const filename = urlFilename(scriptURL);
    const builtIn = isBuiltIn(scriptURL);

    const index = gameSource.scripts.indexOf(scriptURL);
    console.assert(index !== -1);

    let s = `<div onmousedown="onProjectSelect(document.getElementById('${id}'}), 'script', '${scriptURL}'])">${builtIn ? 'View' : 'Edit'}</div>`;
    if (index > 0) {
        s += `<div onmousedown="onMoveScript('${scriptURL}', -1)"><span style="margin-left:-18px; width:18px; display:inline-block; text-align:center">&uarr;</span>Execute earlier</div>`
    }

    // -2 because quadplay injects the _ui script into each game as a hidden final script
    if (index < gameSource.scripts.length - 2) {
        s += `<div onmousedown="onMoveScript('${scriptURL}', +1)"><span style="margin-left:-18px; width:18px; display:inline-block; text-align:center">&darr;</span>Execute later</div>`
    }
    if (! builtIn) {
        s += `<div onmousedown="onRenameScript('${scriptURL}')">Rename&hellip;</div>`
    }
    s += `<hr><div onmousedown="onRemoveScript('${scriptURL}')"><span style="margin-left:-18px; width:18px; display:inline-block; text-align:center">&times;</span>Remove ${filename}</div>`

    customContextMenu.innerHTML = s;
    showContextMenu('project');
}


function onRenameScript(scriptURL) {
    const filename = urlFilename(scriptURL);

    let newName;

    while (true) {
        newName = window.prompt("New name for script '" + filename + "'", filename);
        if (! newName || newName === '') { return; }

        // Remove extension
        newName = newName.replace(/\.[^\.]+$/, '');
        
        // Mangle and add extension
        newName = newName.replace(/(^_|[^_0-9A-Za-z])/g, '') + '.pyxl';
        
        // Check for conflict
        if (gameSource.json.scripts.indexOf(newName) !== -1) {
            window.alert("There is already another script named '" + newName + "'");
        } else {
            break;
        }
    }
        
    // Change the name in the gameSource.json
    const index = gameSource.json.scripts.indexOf(filename);

    console.assert(index !== -1);
    gameSource.json.scripts.splice(index, 1, newName);

    // Callback sequence is:
    //
    // save script as the new name ->
    //   save the game.json ->
    //     reload the game ->
    //       delete the old file
    
    function deleteOldFile() {
        serverDeleteFile(makeURLAbsolute(gameSource.jsonURL, scriptURL));
    }

    function saveAndReloadProject() {
        console.assert(gameSource.jsonURL);
        serverSaveGameJSON(function () {
            loadGameAndConfigureUI(window.gameURL, deleteOldFile, true);
        });
    }
    
    serverWriteFile(urlToLocalWebPath(makeURLRelativeToGame(newName)), 'utf8', fileContents[scriptURL], saveAndReloadProject);
}


/////////////////////////////////////////////////////////////////////////

function showDocContextMenu(docURL) {
    if (! gameSource.docs) { return; }

    console.assert(docURL);
    const id = 'DocItem_' + docURL;
    const filename = urlFilename(docURL);
    const builtIn = isBuiltIn(docURL);

    const index = gameSource.docs.indexOf(docURL);
    console.assert(index !== -1);

    let externalCmds = '';
    if (! isRemote(docURL) && !isBuiltIn(docURL)) {
        if (serverConfig.hasFinder) {
            externalCmds += `<div onmousedown="onOpenUrlExternally('<finder>', '${docURL}')">Show in ${isApple ? 'Finder' : 'Explorer'}</div>`;
        }

        const ext = docURL.split('.').pop();
        const list = serverConfig.applications;
        if (list) {
            for (let i = 0; i < list.length; ++i) {
                if (list[i].types.indexOf(ext) !== -1) {
                    externalCmds += `<div onmousedown="onOpenUrlExternally('${list[i].path}', '${docURL}')">Open ${ext.toUpperCase()} with ${list[i].name}</div>`;
                }
            }
        }

        if (externalCmds.length > 0) {
            externalCmds = '<hr>' + externalCmds;
        }
    }    
    
    let s = `<div onmousedown="onProjectSelect(document.getElementById('${id}'), 'doc', '${docURL}'])">${builtIn ? 'View' : 'Edit'}</div>` +
        externalCmds;
    s += `<hr><div onmousedown="onRemoveDoc('${docURL}')"><span style="margin-left:-18px; width:18px; display:inline-block; text-align:center">&times;</span>Remove ${filename}</div>`

    customContextMenu.innerHTML = s;
    showContextMenu('project');
}


function onRemoveDoc(docURL) {
    const index = gameSource.docs.indexOf(docURL);
    console.assert(index !== -1);
    gameSource.json.docs.splice(index, 1);
    serverSaveGameJSON(function () { loadGameAndConfigureUI(window.gameURL, null, true); });
}


function showFindInFilesDialog() {
    document.getElementById('findInFilesDialog').classList.remove('hidden');
    document.getElementById('findInFilesQuery').focus();
}


function hideFindInFilesDialog() {
    document.getElementById('findInFilesDialog').classList.add('hidden');
}


function executeFindInFiles() {
    const query = document.getElementById('findInFilesQuery').value;
    const caseSensitive = document.getElementById('findInFilesCaseSensitive').checked;
    const wholeWord = document.getElementById('findInFilesWholeWord').checked;
    
    if (query.trim() === '') {
        return;
    }
    
    const options = {
        caseSensitive: caseSensitive,
        wholeWord: wholeWord
    };
    
    findInFiles(query, options, 'code');
    hideFindInFilesDialog();
}


/**
  Searches for a query string across multiple files in the project and displays the 
  results in the output window..
  
  `query`
  : The search query string
  
  `options`
  : Search options: `{ caseSensitive: boolean, wholeWord: boolean }`
  
  `scope`
  : The scope of the search. Currently only "code" is supported
 */
function findInFiles(query, options, scope) {
    const PREVIEW_LENGTH = 40;
    
    console.assert(scope === 'code', "Only code scope is currently supported for find in files");
    
    if (! query || query.trim() === '') {
        return;
    }
    const results = [];
    let totalMatches = 0;
    
    // Search through all .pyxl files in fileContents
    for (const [url, content] of Object.entries(fileContents)) {
        if (url.endsWith('.pyxl') && typeof content === 'string' && ! url.match(/\/_/)) {
            const matches = searchInFile(url, content, query, options);
            if (matches.length > 0) {
                results.push({url, matches});
                totalMatches += matches.length;
            }
        }
    }
    
    // Switch to develop mode if not in Develop or Debug mode to guarantee results are visible
    if (uiMode !== 'IDE' && uiMode !== 'WideIDE') {
        setUIMode('IDE');
    }
    
    // Activate the output tab to show results
    document.getElementById('outputTab').checked = true;
    
    
    // Output results
    $outputAppend('<hr>');
    if (results.length === 0) {
        $outputAppend(`<i>No matches found for "${escapeHTMLEntities(query)}"</i>\n`);
    } else {
        $outputAppend(`<b>Found ${totalMatches} match${totalMatches === 1 ? '' : 'es'} in ${results.length} file${results.length === 1 ? '' : 's'} for "${escapeHTMLEntities(query)}":</b>\n`);
        
        for (const fileResult of results) {
            const shortUrl = fileResult.url.replace(/^.*\//, '');
            $outputAppend(`\n<b><a style="cursor: pointer" onclick="editorGotoFileLine('${fileResult.url}', 1)">${shortUrl}</a></b> (${fileResult.matches.length} match${fileResult.matches.length === 1 ? '' : 'es'}):\n`);
            
            for (const match of fileResult.matches) {
                const loc = {url: fileResult.url, line_number: match.lineNumber};
                let linePreview = match.lineContent.trim();
                if (linePreview.length >= PREVIEW_LENGTH) {
                    linePreview = linePreview.substring(0, PREVIEW_LENGTH) + '…';
                }
                $outputAppend(`  ${linePreview}\n`, loc);
            }
        }
        $outputAppend('\n');
    }
}


/**
  Searches for matches within a single file's content.
  
  `url`
  : The file URL
  
  `content`
  : The file content
  
  `query`
  : The search query
  
  `options`
  : Search options
  
  Returns and array of match objects with lineNumber and lineContent
 */
function searchInFile(url, content, query, options) {
    const matches = [];
    const lines = content.split('\n');
    
    const flags = 'g' + (options.caseSensitive ? '' : 'i');
    const searchQuery = options.wholeWord ? 
        '\\b' + escapeRegExp(query) + '\\b' : 
        escapeRegExp(query);
    
    const regex = new RegExp(searchQuery, flags);
    
    for (let i = 0; i < lines.length; ++i) {
        const line = lines[i];
        if (regex.test(line)) {
            matches.push({lineNumber: i + 1, lineContent: line});
        } // if
    } // for
    
    return matches;
}


/**
  Escapes special regex characters in a string.
  
  `string`
  : The string to escape
  
  Returns the escaped string
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


/*
Shows a custom context menu for the editor with options based on selection or word under cursor

`event`
: The right-click event
*/
function showEditorContextMenu(event) {
    // Store the right-click position for getWordUnderCursor()
    const pos = aceEditor.renderer.screenToTextCoordinates(event.clientX, event.clientY);
    lastRightClickPosition = pos;
    
    const selectedText = aceEditor.getSelectedText();
    const hasSelection = selectedText && selectedText.trim().length > 0;
    
    // Get word under cursor if no selection
    let wordUnderCursor = null;
    if (! hasSelection) {
        wordUnderCursor = getWordUnderCursor();
    }
    
    // Platform-specific key symbols
    const cmdKey = isApple ? '⌘' : '^';
    const shiftKey = isApple ? '⇧' : 'Shift+';
    
    // Define menu items
    const cutItem = `<div onmousedown="onEditorCut()">Cut\t${cmdKey}X</div>`;
    const copyItem = `<div onmousedown="onEditorCopy()">Copy\t${cmdKey}C</div>`;
    const pasteItem = `<div onmousedown="onEditorPaste()">Paste\t${cmdKey}V</div>`;
    const separator = `<div style="border-top: 1px solid rgba(255,255,255,20%); margin: 2px 0;"></div>`;
    const findInFilesItem = `<div onmousedown="onEditorFindInFiles()">Find in Files...\t${cmdKey}${shiftKey}F</div>`;
    const goToDefinitionItem = `<div onmousedown="onEditorGoToDefinition()">Go to Definition</div>`;
    const findAndReplaceItem = `<div onmousedown="onEditorFindAndReplace()">Find and Replace...\t${cmdKey}F</div>`;
    
    let menuHTML = pasteItem;
    
    if (hasSelection) {
        // Show all options when text is selected
        menuHTML = cutItem + copyItem + menuHTML;
    }
    
    if (hasSelection || (wordUnderCursor && ! isLanguageKeyword(wordUnderCursor))) {
        // Show advanced options when cursor is on a non-keyword word
        menuHTML = menuHTML + separator + goToDefinitionItem + findInFilesItem + findAndReplaceItem;
    }
    
    customContextMenu.innerHTML = menuHTML;
    showContextMenu('ace');
}


// Store the last right-click position for context menu operations
let lastRightClickPosition = null;

/*
Gets the word under the text cursor in the editor, or at the last right-click position if available

Returns the word as a string, or null if cursor is not on a word
*/
function getWordUnderCursor() {
    const session = aceEditor.session;
    // Use the right-click position if available, otherwise fall back to cursor position
    const position = lastRightClickPosition || aceEditor.getCursorPosition();
    
    // Use ACE's token-based approach for more accurate word detection
    const token = session.getTokenAt(position.row, position.column);
    
    if (token && (token.type === 'identifier' || 
                  token.type === 'support.function' || 
                  token.type === 'variable' ||
                  token.type === 'entity.name.function')) {
        return token.value;
    }
    
    return null;
}


/*
Returns true if the word is a Pyxl language keyword
*/
function isLanguageKeyword(word) {
    const keywords = {
        // Pyxl keywords
        'if': true, 'else': true, 'then': true,
        'for': true, 'while': true, 'with': true, 'in': true,
        'def': true, 'return': true, 'break': true, 'continue': true,
        'let': true, 'const': true, 'local': true,
        'nil': true, 'and': true, 'or': true, 'not': true, 'xor': true,
        'true': true, 'false': true, 'nil': true, 'infinity': true,
    };
    
    return keywords[word] || false;
}

/*
Checks if a word is a built-in API function that should not show "not found" errors

`word`
: The word to check

Returns true if the word is a built-in API function
*/
function isBuiltInAPI(word) {
    return documentationBuiltInAPIOverloads && (word in documentationBuiltInAPIOverloads);
}

/*
Checks if a word is at its definition point in the current file

`identifier`
: The identifier to check

`cursorPos`
: Current cursor position

Returns true if the cursor is at the definition of the identifier
*/
function isAtDefinitionPoint(identifier, cursorPos) {
    const currentSession = aceEditor.session;
    const currentUrl = currentSession.aux ? currentSession.aux.url : null;
    
    if (! currentUrl || ! fileContents[currentUrl]) {
        return false;
    }
    
    const content = fileContents[currentUrl];
    const lines = content.split('\n');
    const currentLine = lines[cursorPos.row];
    
    if (! currentLine) {
        return false;
    }
    
    // Check if current line contains a definition of the identifier
    const defRegex = new RegExp(`^\\s*def\\s+(${escapeRegExp(identifier)})\\s*\\(`);
    const varRegex = new RegExp(`^\\s*(?:let|const)\\s+(${escapeRegExp(identifier)})\\s*[=:]`);
    
    return defRegex.test(currentLine) || varRegex.test(currentLine);
}


/*
Cut selected text from editor
*/
function onEditorCut() {
    const selectedText = aceEditor.getSelectedText();
    if (selectedText) {
        copyToClipboard(selectedText);
        // Use ace's insert method which properly integrates with undo when replacing selection
        aceEditor.insert('');
    }
    customContextMenu.style.visibility = 'hidden';
}


/*
Copy selected text from editor
*/
function onEditorCopy() {
    const selectedText = aceEditor.getSelectedText();
    if (selectedText) {
        copyToClipboard(selectedText);
    }
    customContextMenu.style.visibility = 'hidden';
}


/*
Paste text into editor
*/
function onEditorPaste() {
    pasteFromClipboard(function(text) {
        aceEditor.session.getDocument().replace(aceEditor.getSelectionRange(), text);
    }, function() {
        console.log('Paste failed - clipboard may be empty or inaccessible');
    });
    customContextMenu.style.visibility = 'hidden';
}


/*
Find selected text or word under cursor in all files
*/
function onEditorFindInFiles() {
    let searchText = aceEditor.getSelectedText();
    if (! searchText || ! searchText.trim()) {
        searchText = getWordUnderCursor();
        // Clear the stored position after use
        lastRightClickPosition = null;
    }
    
    if (searchText && searchText.trim() && ! isLanguageKeyword(searchText.trim())) {
        // Use existing find in files functionality
        document.getElementById('findInFilesQuery').value = searchText.trim();
        showFindInFilesDialog();
    }
    customContextMenu.style.visibility = 'hidden';
}


/*
Go to definition of the word under the editor's text cursor
*/
function onEditorGoToDefinition() {
    let identifier = getWordUnderCursor();
    // Clear the stored position after use
    lastRightClickPosition = null;
    
    if (! identifier || isLanguageKeyword(identifier)) {
        customContextMenu.style.visibility = 'hidden';
        return;
    }
    
    // Check if this is a built-in API function - do nothing if so
    if (isBuiltInAPI(identifier)) {
        customContextMenu.style.visibility = 'hidden';
        return;
    }
    
    // Check if identifier is in constants
    if (gameSource && gameSource.constants && (identifier in gameSource.constants)) {
        // Open constant editor - pass the constant name, not the value
        const constantElement = document.getElementById('projectConstant_' + identifier);
        if (constantElement) {
            onProjectSelect(constantElement, 'constant', identifier);
        } else {
            // If element doesn't exist, create a temporary one for the call
            const tempElement = document.createElement('div');
            tempElement.id = 'projectConstant_' + identifier;
            onProjectSelect(tempElement, 'constant', identifier);
        }
        customContextMenu.style.visibility = 'hidden';
        return;
    }
    
    // Check if identifier is an asset
    if (gameSource && gameSource.assets && (identifier in gameSource.assets)) {
        // Open asset editor
        const assetElement = document.getElementById('projectAsset_' + identifier);
        if (assetElement) {
            onProjectSelect(assetElement, 'asset', gameSource.assets[identifier]);
        } else {
            // If element doesn't exist, create a temporary one for the call
            const tempElement = document.createElement('div');
            tempElement.id = 'projectAsset_' + identifier;
            onProjectSelect(tempElement, 'asset', gameSource.assets[identifier]);
        }
        customContextMenu.style.visibility = 'hidden';
        return;
    }
    
    const cursorPos = aceEditor.getCursorPosition();
    
    // Check if we're already at the definition point
    if (isAtDefinitionPoint(identifier, cursorPos)) {
        // Already at definition, just stay here (no error)
        customContextMenu.style.visibility = 'hidden';
        return;
    }
    
    // Search for user-defined functions and variables
    const definition = findDefinitionInProject(identifier);
    if (definition) {
        editorGotoFileLine(definition.url, definition.line, definition.character, true);
    } else {
        showPopupMessage(`Definition not found for "${identifier}"`);
    }
    
    customContextMenu.style.visibility = 'hidden';
}


/*
Searches for the definition of an identifier in the project files

`identifier`
: The variable or function name to search for

Returns an object with `url`, `line`, and `character` properties if found, null otherwise
*/
function findDefinitionInProject(identifier) {
    const currentSession = aceEditor.session;
    const currentUrl = currentSession.aux ? currentSession.aux.url : null;
    
    // Get current cursor position for context
    const cursorPos = aceEditor.getCursorPosition();
    
    // Search order: current file first, then other files
    const filesToSearch = [];
    
    // Add current file first if it exists
    if (currentUrl) {
        filesToSearch.push(currentUrl);
    }
    
    // Add all script files
    if (gameSource.scripts) {
        for (const scriptUrl of gameSource.scripts) {
            if (scriptUrl !== currentUrl) {
                filesToSearch.push(scriptUrl);
            }
        }
    }
    
    // Add all mode files
    if (gameSource.modes) {
        for (const mode of gameSource.modes) {
            if (mode.url !== currentUrl) {
                filesToSearch.push(mode.url);
            }
        }
    }
    
    // Search each file
    for (const url of filesToSearch) {
        const content = fileContents[url];
        if (! content) continue;
        
        const definition = searchForDefinitionInFile(identifier, content, url, currentUrl, cursorPos);
        if (definition) {
            return definition;
        }
    }
    
    return null;
}


/*
Searches for a definition within a single file

`identifier`
: The identifier to search for

`content`
: The file content to search in

`fileUrl`
: URL of the file being searched

`currentUrl`
: URL of the currently active file (for scoping rules)

`cursorPos`
: Current cursor position (for lexical scoping)

Returns definition object or null
*/
function searchForDefinitionInFile(identifier, content, fileUrl, currentUrl, cursorPos) {
    const lines = content.split('\n');
    const isCurrentFile = (fileUrl === currentUrl);
    const isMode = gameSource.modes && gameSource.modes.some(mode => mode.url === fileUrl);
    
    // For modes, only search if we're in the same mode file (file-scoped)
    if (isMode && ! isCurrentFile) {
        return null;
    }
    
    // Search for function definitions: def identifier(...)
    for (let i = 0; i < lines.length; ++i) {
        const line = lines[i];
        const defMatch = line.match(new RegExp(`^\\s*def\\s+(${escapeRegExp(identifier)})\\s*\\(`));
        if (defMatch) {
            // If in current file, check if definition is before cursor (lexical scoping)
            if (isCurrentFile && i >= cursorPos.row) {
                continue; // Definition must be before usage in lexical scoping
            }
            return {
                url: fileUrl,
                line: i + 1,
                character: defMatch.index + defMatch[0].indexOf(identifier) + 1
            };
        }
        
        // Search for variable declarations: let identifier = ... or const identifier = ...
        const varMatch = line.match(new RegExp(`^\\s*(?:let|const)\\s+(${escapeRegExp(identifier)})\\s*[=:]`));
        if (varMatch) {
            // If in current file, check lexical scoping
            if (isCurrentFile && i >= cursorPos.row) {
                continue;
            }
            return {
                url: fileUrl,
                line: i + 1,
                character: varMatch.index + varMatch[0].indexOf(identifier) + 1
            };
        }
        
        // Search for function parameters in def statements
        const paramMatch = line.match(new RegExp(`^\\s*def\\s+\\w+\\s*\\([^)]*\\b(${escapeRegExp(identifier)})\\b`));
        if (paramMatch) {
            // Parameters are only visible within the function, so only match if cursor is after this line
            if (isCurrentFile && cursorPos.row > i) {
                return {
                    url: fileUrl,
                    line: i + 1,
                    character: paramMatch.index + paramMatch[0].indexOf(identifier) + 1
                };
            }
        }
        
        // TODO: Handle with and for statement variable declarations
        // These have complex syntax and scoping rules that need careful parsing
    }
    
    return null;
}


/*
Find and replace selected text or word under cursor
*/
function onEditorFindAndReplace() {
    let searchText = aceEditor.getSelectedText();
    if (! searchText || ! searchText.trim()) {
        searchText = getWordUnderCursor();
        // Clear the stored position after use
        lastRightClickPosition = null;
        // If we found a word under cursor, select it so ace's find/replace will use it
        if (searchText && ! isLanguageKeyword(searchText)) {
            const cursor = aceEditor.getCursorPosition();
            const line = aceEditor.session.getLine(cursor.row);
            const wordStart = line.lastIndexOf(searchText, cursor.column);
            if (wordStart !== -1) {
                const Range = ace.require('ace/range').Range;
                const range = new Range(cursor.row, wordStart, cursor.row, wordStart + searchText.length);
                aceEditor.selection.setRange(range);
            }
        }
    }
    
    if (searchText && searchText.trim() && ! isLanguageKeyword(searchText.trim())) {
        // Use ace's built-in find and replace, pre-filled with selected text
        aceEditor.execCommand('replace');
    }
    customContextMenu.style.visibility = 'hidden';
}



