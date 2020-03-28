"use strict";
// Parts of the IDE that are for editing, vs. simply running and debugging

// How long to wait for new input before saving, to avoid
// constant disk churn
const CODE_EDITOR_SAVE_DELAY = 1.2; // seconds

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

/* Reference count for outstanding saves. Used to disable reload
   temporarily while a save is pending. */
let savesPending = 0;

/* True if a URL is to a path that is a built-in dir for the current server */
function isBuiltIn(url) {
    const quadPath = location.href.replace(/\/console\/quadplay\.html.*$/, '/');
    return url.startsWith('quad://') ||
        url.startsWith(quadPath + 'sprites/') ||
        url.startsWith(quadPath + 'fonts/') ||
        url.startsWith(quadPath + 'sounds/') ||
        url.startsWith(quadPath + 'scripts/') ||
        url.startsWith(quadPath + 'games/') ||
        url.startsWith(quadPath + 'examples/') ||
        url.startsWith(quadPath + 'console/') ||
        url.startsWith(quadPath + 'doc/');
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
    
    if (session.getValue() !== bodyText) {
        // Update the value only when it has changed, to avoid
        // disturbing the active line. Calling setValue()
        // resets the undo history, which is what we want when
        // the disk version has changed.
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
    const contents = fileContents[url] || '';
    const session = codeEditorSessionMap.get(url) || createCodeEditorSession(url, contents);
    aceEditor.setSession(session);
    aceEditor.setReadOnly(session.aux.readOnly || ! editableProject);
    
    // Reset the mode so that it is visible
    setCodeEditorSessionMode(session, session.aux.mode);
}


// One session per edited file is created
function createCodeEditorSession(url, bodyText) {
    console.assert(! codeEditorSessionMap.has(url));
    if (typeof bodyText !== 'string') {
        bodyText = WorkJSON.stringify(bodyText, undefined, 4);
    }
    const session = new ace.EditSession(bodyText || '\n');

    codeEditorSessionMap.set(url, session);

    // Extra quadplay data
    session.aux = {
        url: url,
        
        // Increments on change
        epoch: 0,
        
        mode: 'All changes saved.',

        timeoutID: null,

        // Lock all built-in content
        readOnly: isRemote(url) || isBuiltIn(url)
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
        session.setTabSize(3);
    }
    session.setUseWrapMode(false);

    session.on("change", function (delta) {
        if (session.aux.readOnly) { return; }
        
        // Cancel the previous pending timeout if there is one
        if (session.aux.timeoutID) {
            --savesPending;
            clearTimeout(session.aux.timeoutID);
        }
        
        // Note that the epoch has changed
        ++session.aux.epoch;
        const myEpoch = session.aux.epoch;
        setCodeEditorSessionMode(session, 'Modified<span class="blink">...</span>');

        ++savesPending;
        session.aux.timeoutID = setTimeout(function () {
            session.aux.timeoutID = null;
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
                        // This must be a doc; update the preview pane
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
        }, CODE_EDITOR_SAVE_DELAY * 1000);
    });
    
    return session;
}

/*
aceEditor.session.on('change', function () {
    let src = aceEditor.session.value;
    if (src.match(/\r|\t|[\u2000-\u200B]/)) {
        // Strip any \r inserted by pasting on windows, replace any \t that
        // likewise snuck in. This is rare, so don't invoke setValue unless
        // one is actually inserted.
        src = src.replace(/\r\n|\n\r/g, '\n').replace(/\r/g, '\n');
        src = src.replace(/\t/g, '  ').replace(/\u2003|\u2001/g, '  ').replace(/\u2007/g, ' ');
        aceEditor.session.value = src;
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
                aceEditor.session.value = src;

                // Move the cursor to retain its position
                aceEditor.gotoLine(position.row + 1, Math.max(0, position.column - target.length + replacement.length + 1), false);
                break;
            }
        }
    }
});
*/

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
    
    const serverAddress = location.href.replace(/(^http.?:\/\/[^/]+\/).*/, '$1');
                          
    const xhr = new XMLHttpRequest();
    xhr.open("POST", serverAddress, true);

    // Send the proper header information along with the request
    xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    
    xhr.onreadystatechange = function() {
        if (this.readyState === XMLHttpRequest.DONE) {
            // Request finished. Do processing here.
            if (this.status === 200) {
                if (callback) {
                    // Give the server a little more time to catch up
                    // if it is writing to disk and needs to flush or
                    // such.
                    setTimeout(callback, 150);
                }
            } else if (errorCallback) {
                errorCallback();                
            }
        }
    }
    
    xhr.send(JSON.stringify(payload));
}


/* Convert a URL to a local filename suitable for use with serverWriteFile() */
function urlToFilename(url) {
    const basePath = longestCommonPathPrefix(location.origin + location.pathname, url);
    const filename = url.substring(basePath.length);
    return (filename[0] !== '/' ? '/' : '') + filename;
}


/* Tells a quadplay server to write this file to disk and then invoke
 the callback when the server is done. If the filename is a url,
 computes the appropriate local file. */
function serverWriteFile(filename, encoding, contents, callback, errorCallback) {
    
    console.assert(encoding === 'utf8' || encoding === 'binary');
    
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
        postToServer({
            command: 'write_file',
            filename: array[i].filename,
            encoding: array[i].encoding,
            contents: array[i].contents
        }, onSuccess, errorCallback);
    }
}

/* Save the current .game.json file, which has
   presumably been modified by the caller */
function serverSaveGameJSON(callback) {
    let gameFilename = gameSource.jsonURL.replace(/\\/g, '/');
    if (gameFilename.startsWith(location.origin)) {
        gameFilename = gameFilename.substring(location.origin.length);
    }

    console.assert(gameFilename.endsWith('.game.json'));
 
    const gameContents = WorkJSON.stringify(getEditableGameJSON(), undefined, 4);
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

function onProjectFlipYChange(target) {
    gameSource.json.flip_y = (target.checked === true);
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

let importAssetFiles = null;
function showImportAssetDialog() {
    document.getElementById('importAssetDialog').classList.remove('hidden');
    document.getElementById('importAssetImportButton').disabled = true;
    const text = document.getElementById('importAssetName');
    text.value = '';
    text.focus();

    const assetListURL = location.origin + getQuadPath() + 'console/_assets.json?gamePath=' + getGamePath();
    
    // Fetch the asset list
    LoadManager.fetchOne({}, assetListURL, 'json', null, function (json) {
        importAssetFiles = json;
        onImportAssetTypeChange();
    });
}


/* Called to regenerate the importAssetList */
function onImportAssetTypeChange() {
    const t = document.getElementById('importAssetType').value;
    let s = '<ol id="importAssetListOL" class="select-list">\n';
    if (importAssetFiles) {
        const fileArray = importAssetFiles[t];
        for (let i = 0; i < fileArray.length; ++i) {
            const file = fileArray[i];
            const path = file.replace(/\/[^\/]+$/, '/');
            const rest = file.replace(/^.*\//, '');
            const base = rest.replace(/\..+?$/, '');
            const ext  = rest.replace(/^[^\.]+/, '');
            s += `<li onclick="onImportAssetListSelect(this)">${path}<b style="color:#000">${base}</b>${ext}</li>\n`;
        }
    }
    s += '</ol>';

    const list = document.getElementById('importAssetList');
    list.innerHTML = s;

    importAssetFiles.selected = null;
    // Recreating the list destroys any selection
    document.getElementById('importAssetImportButton').disabled = true;
}


/* Called from the "Import" button */
function onImportAssetImport() {
    const nameBox = document.getElementById('importAssetName');
    const name = nameBox.value;

    // Warn on overwrite
    if ((gameSource.json.assets[name] !== undefined) &&
        ! window.confirm('There is already an asset called ' + name +
                         ' in your game. Replace it?')) {
        nameBox.focus();
        return;
    }

    // Warn on double import
    for (const key in gameSource.json.assets) {
        const value = gameSource.json.assets[key];
        if ((key[0] !== '_') && (value === importAssetFiles.selected)) {
            if (window.confirm('The asset ' + importAssetFiles.selected + ' is already in your game, called ' + key + '. Import the same asset again anyway?')) {
                // The user accepted...go along with it
                break;
            } else {
                return;
            }
        }
    }
    
    gameSource.json.assets[name] = importAssetFiles.selected;
    hideImportAssetDialog();
    
    // Save and reload the game
    serverSaveGameJSON(function () { loadGameIntoIDE(window.gameURL); });
}


function onImportAssetListSelect(target) {
    const list = document.getElementById('importAssetListOL');
    for (let i = 0; i < list.children.length; ++i) {
        list.children[i].classList.remove('selected');
    }
    target.classList.add('selected');
    importAssetFiles.selected = target.innerText; 
    document.getElementById('importAssetImportButton').disabled = (document.getElementById('importAssetName').value.length === 0);
}


function hideImportAssetDialog() {
    document.getElementById('importAssetDialog').classList.add('hidden');
    importAssetFiles = null;
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
                                 for (let i = 0; i < gameSource.json.docs.length; ++i) {
                                     if (gameSource.json.docs[i].name === name) {
                                         // Found the match
                                         onProjectSelect(document.getElementById('DocItem_' + name), 'doc', gameSource.json.docs[i]);
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
