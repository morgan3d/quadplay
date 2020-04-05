"use strict";
// Parts of the IDE that are for editing constants

// The IDE instantly commits values to a running program,
// but delays writing to the game.json for a few seconds
// in case the programmer is trying different things out or
// dragging a slider.
const CONSTANT_EDITOR_SAVE_DELAY = 1.2; // seconds

/** Allows editing an object with a set of numeric fields. fields can be a string of
    single-letter fields or an array of multi-letter ones. */
function onConstantEditorVectorValueChange(sourceObj, environment, key, fields) {
    const json  = sourceObj.json.constants[key];
    console.assert(json !== undefined);
    for (let f = 0; f < fields.length; ++f) {
        const element = fields[f];

        console.assert(json.value[element] !== undefined);

        // Force metadata if not already present
        if (! json.value[element].type) { json.value[element] = {type: 'number', value: undefined}; }

        // Update value
        json.value[element].value = document.getElementById('constantEditor_' + key + '_' + element).value;
    }
    
    // Pass down to the generic value change handler
    onConstantEditorValueChange(sourceObj, environment, key, evalJSONGameConstant(json), json.value, null);
}


function onConstantEditorValueChange(sourceObj, environment, key, value, jsonValue) {
    const json  = sourceObj.json.constants;

    // Update pre-evaluated objects
    sourceObj.constants[key] = value;
    
    // Update gameSource.json.constants
    if (typeof json[key] === 'object') {
        const obj = json[key];
        console.assert(obj.type !== 'raw');
        obj.value = value;
    } else {
        // The source was a raw value. Create
        // metadata.
        switch (typeof value) {
        case 'number':
        case 'string':
        case 'boolean':
            json[key] = {type: typeof value, value: jsonValue};
            break;
            
        case 'object':
            console.assert(value === null);
            // Fall through
        case 'undefined':
            json[key] = {type: 'nil'};
            break;

        default:
            // A more complex object
            json[key].value = jsonValue;
            break;
        }
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
        xy:      {x: {type: 'number', value: 0},
                  y: {type: 'number', value: 0}},
        xz:      {x: {type: 'number', value: 0},
                  z: {type: 'number', value: 0}},
        xyz:     {x: {type: 'number', value: 0},
                  y: {type: 'number', value: 0},
                  z: {type: 'number', value: 0}},
        rgb:     {r: {type: 'number', value: '100%'},
                  g: {type: 'number', value: '100%'},
                  b: {type: 'number', value: '100%'}},
        rgba:    {r: {type: 'number', value: '100%'},
                  g: {type: 'number', value: '100%'},
                  b: {type: 'number', value: '100%'},
                  a: {type: 'number', value: '100%'}},
        hsv:     {h: {type: 'number', value: '0%'},
                  s: {type: 'number', value: '100%'},
                  v: {type: 'number', value: '100%'}},
        hsva:    {h: {type: 'number', value: '0%'},
                  s: {type: 'number', value: '100%'},
                  v: {type: 'number', value: '100%'},
                  a: {type: 'number', value: '100%'}},
        object:  {},
        array:   []
    }[type];

    gameSource.constants[key] = value;
    if (! gameSource.json.constants) {
        gameSource.json.constants = {};
    }

    gameSource.json.constants[key] = {'type': type, 'value': value };

    // Reload
    serverSaveGameJSON(function () {
        loadGameIntoIDE(window.gameURL, function () {
            // Select
            onProjectSelect(document.getElementById('projectConstant_' + key), 'constant', key);
        });
    });
}
