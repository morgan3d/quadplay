/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */

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

    gameSource.json.screenshot_tag = document.getElementById('screenshotTag').value;

    if (editableProject && gameSource.debug && gameSource.debug.json && gameSource.debug.json.screenshot_tag_enabled) {
        gameSource.debug.json.screenshot_tag = document.getElementById('debugScreenshotTag').value;
        console.log('saving debug');
        serverSaveDebugJSON();
    }
    
    serverSaveGameJSON(titleChanged ? function () { loadGameIntoIDE(window.gameURL, null, true); } : undefined);
}


function onProjectYUpChange(target) {
    gameSource.json.y_up = (target.checked === true);
    serverSaveGameJSON();
}


function onProjectDualDPadChange(target) {
    gameSource.json.dual_dpad = (target.checked === true);
    serverSaveGameJSON();
}


function onProjectMIDISysexChange(target) {
    gameSource.json.midi_sysex = (target.checked === true);
    serverSaveGameJSON();
}


function onProjectScreenSizeChange(target) {
    const res = JSON.parse(target.value);
    gameSource.json.screen_size = res;
    serverSaveGameJSON();
}

///////////////////////////////////////////////////////////////////////////////////////////

const licenseTable = {
    All: 'All Rights Reserved. Redistribution prohibited.',
    GPL: 'Open source under the GPL-3.0-only license https://www.gnu.org/licenses/gpl-3.0.html',
    MIT: 'Open source under the MIT license https://opensource.org/licenses/MIT',
    BSD: 'Open source under the BSD 3-Clause license https://opensource.org/licenses/BSD-3-Clause',
    CC0: 'Released into the public domain; CC0 licensed https://creativecommons.org/share-your-work/public-domain/cc0/'
};


function onProjectInitialModeChange(newStartModeName) {
    gameSource.json.start_mode = newStartModeName;
    serverSaveGameJSON(function () { loadGameIntoIDE(window.gameURL, null, true); });
}


// If the argument is the empty string, then disable the override
function onProjectDebugInitialModeChange(newStartModeName) {
    if (! gameSource.debug.json) { gameSource.debug.json = {}; }
    
    if (newStartModeName === '') {
        // Remove
        gameSource.debug.json.start_mode_enabled = false;
    } else {
        gameSource.debug.json.start_mode = newStartModeName;
        gameSource.debug.json.start_mode_enabled = true;
    }
    
    serverSaveDebugJSON(function () { loadGameIntoIDE(window.gameURL, null, true); });
}


function onDebugInitialModeOverrideChange(checkbox) {
    const dropdown = document.getElementById('debugOverrideInitialMode');
    dropdown.disabled = ! checkbox.checked;
    onProjectDebugInitialModeChange(checkbox.checked ? dropdown.value : '');
}


function onDebugScreenshotTagOverrideChange(checkbox) {
    const control = document.getElementById('debugScreenshotTag');
    control.disabled = ! checkbox.checked;
    if (gameSource.debug === undefined) { gameSource.debug = {}; }
    if (gameSource.debug.json === undefined) { gameSource.debug.json = {}; }
    gameSource.debug.json.screenshot_tag_enabled = checkbox.checked;
    onProjectMetadataChanged();
}


function capitalize(key) {
    return key[0].toUpperCase() + key.substring(1);
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
        // Remove this callback
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
   presumably been modified by the caller.

   Updates the fileContents[gameSource.jsonURL].

   Not called when the JSON editor is used to directly
   modify the code of fileContents[gameSource.jsonURL].
*/
function serverSaveGameJSON(callback) {
    console.assert(gameSource.jsonURL);
    const webpath = urlToLocalWebPath(gameSource.jsonURL);
    console.assert(webpath.endsWith('.game.json'));
 
    const gameContents = WorkJSON.stringify(gameSource.json, undefined, 4);

    // Update the text version used for the IDE
    fileContents[gameSource.jsonURL] = gameContents;

    // Update the editor if open
    if (codeEditorSessionMap.get(gameSource.jsonURL)) {
        updateCodeEditorSession(gameSource.jsonURL, gameContents);
    }
    
    serverWriteFile(webpath, 'utf8', gameContents, callback);
}


function serverSaveDebugJSON(callback) {
    console.assert(gameSource.jsonURL);
    const debugFilename = urlToLocalWebPath(gameSource.jsonURL).replace(/\.game\.json$/, '.debug.json');
 
    const debugContents = WorkJSON.stringify(gameSource.debug.json || {}, undefined, 4);
    serverWriteFile(debugFilename, 'utf8', debugContents, callback);
}


function onExportClick() {
    // TODO
}

function makeGame(srcURL) {
    if (! isQuadserver) {
        // Can't create a game on this server
        if (window.confirm('This game is hosted on the web. You must launch quadplay✜ from a script on your computer to create a new game. Go to the quadplay✜ installer website now?')) {
            window.open('https://github.com/morgan3d/quadplay');
        }
        
        return;
    }
    
    const gameName = window.prompt('New Game Title', 'My New Game');
    if (gameName && gameName !== '') {
        // Mangle name
        const gameDir = makeGoodFilename(gameName);
        
        // Send the POST to make the game
        postToServer(
            {
                command: 'new_game',
                dir_name: gameDir,
                game_name: gameName,
                src_url: srcURL
            },
            function (response, code) {
                // Success. Load the new game and reselect the main page.
                loadGameIntoIDE(response.game, function () {
                    onProjectSelect(document.getElementsByClassName('projectTitle')[0], 'game');
                });
            },
            
            function (resonse, code) {
                // Failure. Warn the user why
                alert(`Could not create the game "${gameName}" because a similar directory name "${gameDir}" already exists in your my_quadplay folder in your home folder.`);
            });
    }
}

function onCopyGameClick() {
    makeGame(gameURL);
}

function onNewGameClick() {
    makeGame('quad://examples/starter');
}
