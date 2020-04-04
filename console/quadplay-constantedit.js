"use strict";
// Parts of the IDE that are for editing constants

// The IDE instantly commits values to a running program,
// but delays writing to the game.json for a few seconds
// in case the programmer is trying different things out or
// dragging a slider.
const CONSTANT_EDITOR_SAVE_DELAY = 1.2; // seconds

function onConstantEditorValueChange(sourceObj, environment, key, value, target) {
    const json  = sourceObj.json.constants;

    // Update pre-evaluated objects
    sourceObj.constants[key] = value;
    
    // Update gameSource.json.constants
    if (typeof json[key] === 'object') {
        const obj = json[key];
        console.assert(obj.type !== 'raw');
        obj.value = value;
    } else {
        // The source was a raw string, just write it back
        json[key] = value;
    }
    
    // Set a timer to save the game.json
    if (sourceObj === gameSource) {
        serverScheduleSaveGameJSON(CONSTANT_EDITOR_SAVE_DELAY);
    }
    
    // if the game is running, update the live constant
    if (emulatorMode !== 'stop') {
        redefineConstant(environment, key, value);
    }
}

////////////////////////////////////////////////////////////////////////

function showNewConstantDialog() {
    document.getElementById('newConstantDialog').classList.remove('hidden');
    document.getElementById('newConstantCreateButton').disabled = true;
    const text = document.getElementById('newConstantName');
    text.value = "";
    text.focus();
}


function hideNewConstantDialog() {
    document.getElementById('newConstantDialog').classList.add('hidden');
    document.getElementById('newConstantName').blur();
}


function onNewConstantCreate() {
    hideNewConstantDialog();

    const key = document.getElementById('newConstantName').value;

    if ((gameSource.constants[key] !== undefined) &&
        ! window.confirm('There is already a constant named ' + key + '. Replace it?')) {
        return;
    }
    
    const type = document.querySelector('input[name="newConstantType"]:checked').value;

    const value = {
        string:  '',
        boolean: true,
        nil:     undefined,
        number:  0,
        xy:      {x: 0, y: 0},
        xz:      {x: 0, z: 0},
        xyz:     {x: 0, y: 0, z: 0},
        rgb:     {r: 1, g: 1, b: 1},
        rgba:    {r: 1, g: 1, b: 1, a: 1},
        hsv:     {h: 0, s: 1, v: 1},
        hsva:    {h: 0, s: 1, v: 1, a: 1},
        object:  {},
        array:   []
    }[type];

    gameSource.constants[key] = value;
    if (! gameSource.json.constants) {
        gameSource.json.constants = {};
    }

    gameSource.json.constants[key] = {
        'type': type,
        'value': typeof value === 'string' ? value : QRuntime.unparse(value)
    };

    // Reload
    serverSaveGameJSON(function () {
        loadGameIntoIDE(window.gameURL, function () {
            // Select
            onProjectSelect(document.getElementById('projectConstant_' + key), 'constant', key);
        });
    });
}
