/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License 

   Editor for the game.json settings.
 */

"use strict";

function onProjectLicensePreset(license) {
    const projectLicense = document.getElementById('projectLicense');
    projectLicense.value = licenseTable[license];

    // Wait for a GUI update to work around threading issues
    // on Chromium for reading that element immediately
    setTimeout(onProjectMetadataChanged());
}


function onProjectBumpVersion() {
    const oldValue = document.getElementById('projectVersion').value.trim();
    let newValue = oldValue;
    let updated = false;

    // Date format: YYYY.MM.DD.HH, first part > 2000
    const dateParts = oldValue.split('.');
    if (dateParts.length === 4 && /^\d+$/.test(dateParts[0]) && Number(dateParts[0]) > 2000) {
        const now = new Date();
        const yyyy = now.getFullYear().toString();
        const mm = (now.getMonth() + 1).toString().padStart(2, '0');
        const dd = now.getDate().toString().padStart(2, '0');
        const hh = now.getHours().toString().padStart(2, '0');
        newValue = `${yyyy}.${mm}.${dd}.${hh}`;
        updated = true;
    } else if (/^\d+(\.\d+)+$/.test(oldValue)) {
        // Decimal-separated version, e.g., 1.09, 1.1.1, 01.000004
        const parts = oldValue.split('.');
        let carry = 1;
        for (let i = parts.length - 1; i >= 0; --i) {
            if (carry === 0) { break; }
            const orig = parts[i];
            const width = orig.length;
            let n = parseInt(orig, 10) + carry;
            if (n.toString().length > width) {
                // Carry over
                n = 0;
                carry = 1;
            } else {
                carry = 0;
            }
            parts[i] = n.toString().padStart(width, '0');
        }
        newValue = parts.join('.');
        updated = true;
    } else if (/^\d+$/.test(oldValue)) {
        // Pure integer
        const width = oldValue.length;
        let n = parseInt(oldValue, 10) + 1;
        newValue = n.toString().padStart(width, '0');
        updated = true;
    }

    if (updated) {
        document.getElementById('projectVersion').value = newValue;
        // Instead of invoking this immediately, wait for the next GUI
        // thread update. This works around a race-condition like problem
        // where immediately reading the value gives the old value on Chromium.
        setTimeout(onProjectMetadataChanged);
    } else {
        // Unrecognized format: disable the bump button
        document.getElementById('projectLicenseBump').disabled = true;
    }
}


function onProjectMetadataChanged() {
    // The gameSource.extendedJSON will be out of sync briefly after this runs,
    // because only gameSource.json is modified. For simplicity, just leave it that way.
    // The autoreload will catch this and clean it.

    const json = gameSource.json;

    const t = document.getElementById('projectTitle').value.trim();
    const titleChanged = t !== json.title;
    json.title = t;

    json.version = document.getElementById('projectVersion').value.trim();

    const textFields = ['developer', 'copyright', 'license', 'description'];
    for (let f = 0; f < textFields.length; ++f) {
        const key = textFields[f];
        json[key] = document.getElementById('project' + capitalize(key)).value.trim();
    }

    const boolFields = ['Cooperative', 'Competitive', 'High Scores', 'Achievements', 'Show Start Animation', 'Show Controls Button', 'Mobile Touch Gamepad'];
    for (let f = 0; f < boolFields.length; ++f) {
        const name = boolFields[f];
        const key = name.replace(/ /g, '_').toLowerCase();
        json[key] = document.getElementById('project_' + key).checked ? true : false;
    }

    const mn = parseInt(document.getElementById('projectMinPlayers').value);
    const maxPlayersValue = document.getElementById('projectMaxPlayers').value.trim();
    
    // Handle infinity values for max_players
    const isInfinity = (maxPlayersValue === '∞' || maxPlayersValue.toLowerCase() === 'infinity');
    const mx = isInfinity ? Infinity : parseInt(maxPlayersValue);
    
    json.min_players = Math.min(mn, mx);
    json.max_players = isInfinity ? '∞' : Math.max(mn, mx);
    
    document.getElementById('projectMinPlayers').value = json.min_players;
    document.getElementById('projectMaxPlayers').value = json.max_players;

    json.screenshot_tag = document.getElementById('screenshotTag').value;

    if (editableProject && gameSource.debug && gameSource.debug.json && gameSource.debug.json.screenshot_tag_enabled) {
        gameSource.debug.json.screenshot_tag = document.getElementById('debugScreenshotTag').value;
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


function onProjectOnlineMenuChange(target) {
    gameSource.json.online_menu = (target.checked === true);
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

/******************************************************************/

// Exporting

function onExportClick() {
    document.getElementById('exportDialog').classList.remove('hidden');
}

function hideExportDialog() {
    document.getElementById('exportDialog').classList.add('hidden');
}

function onExportDialogOK() {
    const target = document.querySelector('input[name="exportTarget"]:checked').value;
    hideExportDialog();
    
    // Open manual section in new tab based on target before starting export
    const manualSection = {
        'standalone': '#deployinggames/webserver',
        'itchio': '#deployinggames/itch.io',
        'github': '#deployinggames/github'
    }[target];
    window.open('../doc/manual.md.html' + manualSection, '_blank');
    
    // Show wait dialog
    showWaitDialog('Exporting game...');
    
    // Send export request to server
    postToServer(
        {
            command: 'export_game',
            target: target,
            game_path: urlToLocalWebPath(gameSource.jsonURL)
        },
        function(response, code) {
            // Success - hide wait dialog
            hideWaitDialog();
        },
        function(response, code) {
            // Failure - show error and hide wait dialog
            hideWaitDialog();
            try {
                const errorObj = JSON.parse(response);
                alert('Failed to export game: ' + (errorObj.error || 'Unknown error'));
            } catch (e) {
                alert('Failed to export game: ' + response);
            }
        }
    );
}

/***************************************************************/

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
