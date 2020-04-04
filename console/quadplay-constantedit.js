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
