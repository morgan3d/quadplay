"use strict";
// Parts of the IDE that are for editing constants

// The IDE instantly commits values to a running program,
// but delays writing to the game.json for a few seconds
// in case the programmer is trying different things out or
// dragging a slider.
const CONSTANT_EDITOR_SAVE_DELAY = 1.2; // seconds

/* Called from onProjectSelect() */
function showConstantEditor(index) {
    const constantEditor = document.getElementById('constantEditor');
    const c = gameSource.constants[index];
    const json = gameSource.json.constants[index];
    const type = json.type || typeof c;

    let html = '';

    if (json.description && json.description !== '') {
        html += '<p><i>' + json.description + '</i></p>';
    }
    
    const disabled = editableProject ? '' : 'disabled';
    if (type === 'string') {
        html += `${index} = "<textarea style="vertical-align:top; margin-left:1px; margin-right:2px;" autocomplete="false" ${disabled} onchange="onConstantEditorValueChange(gameSource, QRuntime, '${index}', this.value, this.value)" rows=4 cols=40>${c}</textarea>"`;
    } else if (c === undefined || c === null) {
        html += index + ' = <code>∅</code>';
    } else if (type === 'number') {
        const value = (typeof json === 'number') ? c : json.value;
        html += `${index} = <input style="width:100px; text-align: right" type="text" onchange="onConstantEditorValueChange(gameSource, QRuntime, '${index}', this.value, QRuntime.parse(this.value))" autocomplete="false" ${disabled} value="${value}">`;
        html += '<br/><br/><i>All PyxlScript number formats supported. For example, <code>10, -3, 1.5, 90deg, 90°, -∞, π, ½</code></i>';
    } else if (type === 'boolean') {
        html += `<input type="checkbox" autocomplete="false" onchange="onConstantEditorValueChange(gameSource, QRuntime, '${index}', this.checked, this.checked)" ${disabled} ${c ? 'checked' : ''}> ${index}`;
    } else if (type === 'xy' || type === 'xz' || type === 'xyz' ||
               type === 'rgb' || type === 'rgba' ||
               type === 'hsv' || type === 'hsva') {

        const fields = type;
        
        const onchange = `onConstantEditorVectorValueChange(gameSource, QRuntime, '${index}', '${fields}')`;

        html += `${index} = {<table style="margin-left:10px">`;

        // Preserve the unparsed json formatting if available
        for (let i = 0; i < fields.length; ++i) {
            const element = fields[i];
            
            // Start with the already-parsed value as a backup
            let value = json.value[element].type ? json.value[element].value : c[element];
            html += `<tr><td>${element}:</td><td><input id="constantEditor_${index}_${element}" onchange="${onchange}" style="width:80px; text-align: right; margin-left: 1px; margin-right: 1px" type="text" autocomplete="false" ${disabled} value="${value}">`;
            html +=  (i < fields.length - 1) ? ', ' : '';
            html += '</td></tr>';
        }

        html += '</table>}';

        if (type[0] === 'r') {
            html += `<div id="constantEditor_${index}_preview" style="background: rgb(${255 * c.r}, ${255 * c.g}, ${255 * c.b}); margin-top: 10px; border: 1px solid #000; width: 64px; height: 64px"> </div>`;
        } else if (type[0] === 'h') {
            html += `<div id="constantEditor_${index}_preview" style="background: hsv(${255 * c.h}, ${255 * c.s}, ${255 * c.v}); margin-top: 10px; border: 1px solid #000; width: 64px; height: 64px"> </div>`;
        }
        
    } else {
        // Object or array (including built-in objects)
        const L = Object.keys(c).length;
        if ((L <= 4) && (c.r !== undefined) && (c.g !== undefined) && (c.b !== undefined) && ((c.a !== undefined) || (L === 3))) {
            // RGB[A]
            html += index + ` <div style="background: rgb(${255 * c.r}, ${255 * c.g}, ${255 * c.b}); width: 50px; height: 16px; display: inline-block"> </div><br/>(${QRuntime.unparse(c)})`;
        } else if ((L <= 4) && (c.h !== undefined) && (c.s !== undefined) && (c.v !== undefined) && ((c.a !== undefined) || (L === 3))) {
            // HSV[A]
            html += index + ` <div style="background: hsv(${255 * c.h}, ${255 * c.s}, ${255 * c.v}); width: 50px; height: 16px; display: inline-block"> </div><br/>(${QRuntime.unparse(c)})`;
        } else {
            const s = QRuntime.unparse(c);
            if (s.length > 16) {
                html += index + ' = <table>' + visualizeConstant(c, '') + '</table>';
            } else {
                html += index + ' = ' + escapeHTMLEntities(s);
            }
        }
    }
    constantEditor.innerHTML = html;
    constantEditor.style.visibility = 'visible';
}


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

    const value = evalJSONGameConstant(json);

    // Update the color preview
    const type = sourceObj.json.constants[key].type;
    if (type === 'rgb' || type === 'rgba' ||
        type === 'hsv' || type === 'hsva') {
        const preview = document.getElementById('constantEditor_' + key + '_preview');
        if (type[0] === 'r') {
            preview.style.background = `rgb(${255 * value.r}, ${255 * value.g}, ${255 * value.b})`;
        } else {
            preview.style.background = `hsv(${255 * value.h}, ${255 * value.s}, ${255 * value.v})`;
        }
    }
    
    // Pass down to the generic value change handler
    onConstantEditorValueChange(sourceObj, environment, key, value, json.value, null);
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

    document.getElementById('newConstantDescription').value = "";
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

    const obj = {type: type, value: value};
    const description = document.getElementById('newConstantDescription').value;
    if (description !== '') {
        obj.description = description;
    }
    gameSource.json.constants[key] = obj;

    // Reload
    serverSaveGameJSON(function () {
        loadGameIntoIDE(window.gameURL, function () {
            // Select
            onProjectSelect(document.getElementById('projectConstant_' + key), 'constant', key);
        });
    });
}
