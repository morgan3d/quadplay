
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
 
    const gameContents = WorkJSON.stringify(gameSource.json, undefined, 3);
    serverWriteFile(gameFilename, 'utf8', gameContents, callback);
}
