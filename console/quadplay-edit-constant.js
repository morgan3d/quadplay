"use strict";
// Parts of the IDE that are for editing constants

// The IDE instantly commits values to a running program,
// but delays writing to the game.json for a few seconds
// in case the programmer is trying different things out or
// dragging a slider.
const CONSTANT_EDITOR_SAVE_DELAY = 1.0; // seconds

/** Input is a scalar on [0, 1], output is a scalar on 0-255. Exactly matches _colorToUint16 */
function htmlColorChannel4Bit(value) {
    value = clamp(value, 0, 1);
    value = (value * 15 + 0.5) >>> 0;
    value = (value << 4) + value;
    return value;
}


/** Rounds to the nearest rgba/hsva 4-bit color and returns a CSS string */
function htmlColor4Bit(value) {
    if (value.h !== undefined) {
        // Convert to RGB
        value = QRuntime.rgba(value);
    }

    
    if (value.a !== undefined) {
        // RGBA
        return `rgba(${htmlColorChannel4Bit(value.r)}, ${htmlColorChannel4Bit(value.g)}, ${htmlColorChannel4Bit(value.b)}, ${htmlColorChannel4Bit(value.a) / 255})`;
    } else {
        // RGB
        return `rgb(${htmlColorChannel4Bit(value.r)}, ${htmlColorChannel4Bit(value.g)}, ${htmlColorChannel4Bit(value.b)})`;
    }
}


/* Called from onProjectSelect() */
function showConstantEditor(index) {
    const constantEditor = document.getElementById('constantEditor');
    const value = gameSource.constants[index];
    const json = gameSource.json.constants[index];
    const debugJSON = (gameSource.debug.json && gameSource.debug.json.constants ? gameSource.debug.json.constants[index] : undefined)

    let html = '';
        
    const constantName = index;
    const controlName = index;
    const debugControlName = '$debug_' + index;

    html += makeConstantEditorControlHTML(constantName, controlName, json, value, false);
    
    if (json.description && json.description !== '') {
        html = '<p><i>' + json.description + '</i></p>' + html;
    }

    const debugEnabled = debugJSON !== undefined && debugJSON.enabled;
    html += `<br/><br/><label><input type="checkbox" style="margin-left:24px" autocomplete="false" ${debugEnabled ? 'checked' : ''} onchange="onConstantEditorDebugOverrideChange(gameSource, '${constantName}', this)">Debug&nbsp;Override</label>`;
    if (debugEnabled) {
        html += '<div style="margin-left:24px; margin-top:4px; width:100%; border: 1px #E0BD33 solid; border-radius: 4px; padding: 2px; padding-top:6px; padding-bottom: 5px; background: #444">';
        html += `<div id="${controlName}_debug_div" ${debugEnabled ? '' : 'disabled'}>`;
       
        if (gameSource.debug.constants && gameSource.debug.constants[constantName]) {
            let debugValue = gameSource.debug.constants[constantName];
            if (debugValue.type !== undefined) {
                // Not a raw value
                debugValue = debugValue.value;
            }
            html += makeConstantEditorControlHTML(constantName, debugControlName, gameSource.debug.json.constants[constantName], debugValue, true);
        }
        html += '</div></div>';
    }
    
    constantEditor.innerHTML = html;
    constantEditor.style.visibility = 'visible';
}


function makeConstantEditorControlHTML(constantName, controlName, json, value, isDebugLayer) {
    let html = '';
    const type = json.type || typeof value;
    const disabled = editableProject ? '' : 'disabled';
    if (type === 'string') {
        html += `${constantName} = "<textarea style="vertical-align:top; margin-left:1px; margin-right:2px;" autocomplete="false" ${disabled} onchange="onConstantEditorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', this.value, this.value)" rows=4 cols=40>${value}</textarea>"`;
    } else if (value === undefined || value === null) {
        html += constantName + ' = <code>∅</code>';
    } else if (type === 'number') {
        const numValue = (typeof json === 'number') ? value : json.value;
        html += `${constantName} = <input style="width:100px; text-align: right" type="text" onchange="onConstantEditorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', $parse(this.value, 0).result, this.value)" autocomplete="false" ${disabled} value="${numValue}">`;
        html += '<br/><br/><i>All PyxlScript number formats supported. For example, <code>10, -3, 1.5, 2pi, 90deg, 90°, -∞, π, ½</code></i>';
    } else if (type === 'boolean') {
        html += `<input type="checkbox" autocomplete="false" onchange="onConstantEditorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', this.checked, this.checked)" ${disabled} ${value ? 'checked' : ''}> ${constantName}`;
    } else if (type === 'xy' || type === 'xz' || type === 'xyz' ||
               type === 'rgb' || type === 'rgba' ||
               type === 'hsv' || type === 'hsva') {

        const fields = type;
        
        const onchange = `onConstantEditorVectorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', '${fields}', event)`;

        html += `${constantName} = {<table style="margin-left:10px">`;

        // Preserve the unparsed json formatting if available
        for (let i = 0; i < fields.length; ++i) {
            const element = fields[i];
            
            // Start with the already-parsed value as a backup
            let elementValue = json.value[element].type ? json.value[element].value : value[element];
            html += `<tr><td>${element}:</td><td style="white-space: nowrap"><input id="constantEditor_${controlName}_${element}" onchange="${onchange}" style="width:80px; text-align: right; margin-left: 1px; margin-right: 1px" type="text" autocomplete="false" ${disabled} value="${elementValue}">`;
            html +=  (i < fields.length - 1) ? ', ' : '';
            html += '</td></tr>';
        }

        html += '</table>}';

        let editor = '', metaEditor = '';
        if (editableProject && (type === 'xy' || type === 'xz' || type === 'xyz')) {
            // Position editor
            
            // The arrow characters here must be kept in sync with onConstantEditorVectorNudge
            const buttonParams = ` style="width:24px; height:24px; font-weight: bold; font-family: sans-serif" onclick="onConstantEditorVectorNudge(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, 'constantEditor_${controlName}', '${type}', this.innerText)"`;
            editor = `<table style="border-collapse:collapse"><tr><td></td><td><button ${buttonParams} title="+${type[1]}">↑</button></td><td>` + (type.length === 3 ? `<button ${buttonParams} title="-z">↗</button>` : '') + `</td></tr>` +
                `<tr><td><button ${buttonParams} title="-x">←</button></td><td></td><td><button ${buttonParams} title="+x">→</button></td></tr>` +
                `<tr><td>` + (type.length === 3 ? `<button ${buttonParams} title="+z">↙</button>` : '') + `</td><td><button ${buttonParams} title="-${type[1]}">↓</button></td><td></td></tr></table>`;
            
            metaEditor = '<br><table style="margin-left:10px">';
            if (! json.nudge) {
                // Add nudge values if they aren't present.
                json.nudge = {};
                for (let i = 0; i < fields.length; ++i) { json.nudge[fields[i]] = '+1'; }
                if (type[1] === 'y' && ! gameSource.json.y_up) {
                    json.nudge.y = -1;
                }
            }
            
            for (let i = 0; i < fields.length; ++i) {
                const element = fields[i];
                metaEditor += `<tr><td>Δ${element}</td><td><input id="constantEditor_${controlName}_nudge_${element}" type="text" value="${json.nudge[element]}" onchange="${onchange}" style="width:32px; text-align:right"></input></td></tr>`;
            }
            metaEditor += '</table>';
        } else if (type === 'rgb' || type === 'rgba' || type === 'hsv' || type === 'hsva') {
            // Color editor

            // Display color
            editor = `<br><div style="border-radius: 4px; border: 1px solid #000; width: 64px; height: 64px; overflow: hidden" class="checkerboard"><div id="constantEditor_${controlName}_preview" style="background: ${htmlColor4Bit(value)}; width: 64px; height: 64px"> </div></div>`;
            
            // Sliders
            if (editableProject) {
                // Move the color preview over to make room for the sliders
                metaEditor = editor;
                
                editor = '<br><table>';
                for (let i = 0; i < fields.length; ++i) {
                    const element = fields[i];
                    editor += `<tr><td><input id="constantEditor_${controlName}_slider_${element}" type="range" oninput="onConstantEditorVectorSliderChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, 'constantEditor_${controlName}', '${type}', '${element}', this.value / 255)" style="height: 1em" min="0" max="255" value="${255 * value[element]}"></input></td></tr>`;
                }
                editor += '</table>';
            }
        } // End special case editors

        
        if (editor !== '') {
            html = '<table style="border-collapse: collapse"><tr valign="top"><td>' + html + '</td><td style="padding-left: 10px">' + editor + '</td><td>' + metaEditor + '</td></tr></table>';
        }
    } else if (type === 'reference') {
        html += constantName + ' → ' + json.value;
    } else {
        // Object or array (including built-in objects)
        const L = Object.keys(value).length;
        const s = QRuntime.unparse(value);
        if (s.length > 16) {
            html += constantName + ' = <table>' + visualizeConstant(value, '') + '</table>';
        } else {
            html += constantName + ' = ' + escapeHTMLEntities(s);
        }
    }
    return html;
}


function onConstantEditorDebugOverrideChange(gameSource, name, checkbox) {
    // Ensure that the constant exists in the json
    let created = false;
    if (! gameSource.debug.json) {
        gameSource.debug.json = {};
        created = true;
    }
    
    if (! gameSource.debug.json.constants) {
        gameSource.debug.json.constants = {};
        created = true;
    }
    
    if (! gameSource.debug.json.constants[name]) {
        // Copy from the non-debug version
        gameSource.debug.json.constants[name] = deep_clone(gameSource.json.constants[name]);
        if (gameSource.debug.json.constants[name].type === 'reference') {
            gameSource.debug.constants[name] = new GlobalReferenceDefinition(name, gameSource.debug.json.constants[name]);
        } else {
            gameSource.debug.constants[name] = evalJSONGameConstant(gameSource.debug.json.constants[name]);
        }
        created = true;
    }

    if (typeof gameSource.debug.json.constants[name] !== 'object') {
        // Wrap raw constants
        const value = gameSource.debug.json.constants[name];
        if (value === undefined || value === null) {
            gameSource.debug.json.constants[name] = {type: 'nil'};
        } else {
            gameSource.debug.json.constants[name] = {type: typeof value,
                                                     value: value};
        }
        created = true;
    }
    
    gameSource.debug.json.constants[name].enabled = checkbox.checked;
    serverSaveDebugJSON(function () {
        // Recreate the UI
        showConstantEditor(name);
    });

    // if the game is running, update the live constant
    if (emulatorMode !== 'stop') {
        redefineConstantByName(QRuntime, name);
    }
}


function onConstantEditorVectorSliderChange(gameLayer, controlName, type, field, value) {
    const textBox = document.getElementById(controlName + '_' + field);
    textBox.value = Math.round(100 * value) + '%';
    textBox.onchange();
}


/** Called when a direction button is pressed on a vector editor */
function onConstantEditorVectorNudge(gameLayer, controlName, type, direction) {
    let field = '';
    let sign = 1;
    
    switch (direction) {
    case '↓': sign = -1; // Fall through
    case '↑': field = type[1]; break;
        
    case '←': sign = -1; // Fall through
    case '→': field = type[0]; break;

    case '↗': sign = -1; // Fall through
    case '↙': field = type[2]; break;
    }

    const textBox = document.getElementById(controlName + '_' + field);
    const nudgeBox = document.getElementById(controlName + '_nudge_' + field);
    const step = $parse(nudgeBox.value).result;
    const newValue = $parse(textBox.value).result + step * sign;
    textBox.value = newValue;
    textBox.onchange();
}

/** Allows editing an object with a set of numeric fields. fields can be a string of
    single-letter fields or an array of multi-letter ones.

    If the event is undefined, then this was programmatically invoked. */
function onConstantEditorVectorValueChange(gameLayer, environment, controlName, key, fields, event) {
    const json = gameLayer.json.constants[key];
    console.assert(json !== undefined);
    for (let f = 0; f < fields.length; ++f) {
        const element = fields[f];

        console.assert(json.value[element] !== undefined);

        // Force metadata if not already present
        if (! json.value[element].type) { json.value[element] = {type: 'number', value: undefined}; }

        // Update value
        json.value[element].value = document.getElementById('constantEditor_' + controlName + '_' + element).value;

        if (json.nudge) {
            json.nudge[element] = document.getElementById('constantEditor_' + controlName + '_nudge_' + element).value;
        }
    }

    const value = evalJSONGameConstant(json);

    // Update the color preview
    const type = json.type;
    if (type === 'rgb' || type === 'rgba' ||
        type === 'hsv' || type === 'hsva') {
        const preview = document.getElementById('constantEditor_' + controlName + '_preview');
        preview.style.background = htmlColor4Bit(value);

        // Update sliders
        for (let i = 0; i < type.length; ++i) {
            const field = type[i];
            const slider = document.getElementById('constantEditor_' + controlName + '_slider_' + field);
            slider.value = value[field] * 255;
        }
    }
    
    // Pass down to the generic value change handler
    onConstantEditorValueChange(gameLayer, environment, controlName, key, value, json.value, null);
}


/** Value is the numeric value to assign. jsonValue is what to store in the .value
    field of the game.json file. */
function onConstantEditorValueChange(gameLayer, environment, controlName, key, value, jsonValue) {
    // Update pre-evaluated objects
    gameLayer.constants[key] = value;
    
    // Update gameSource.json.constants
    if (typeof gameLayer.json.constants[key] === 'object') {
        const obj = gameLayer.json.constants[key];
        console.assert(obj.type !== 'raw');
        obj.value = value;
    } else {
        // The source was a raw value. Create
        // metadata.
        switch (typeof value) {
        case 'number':
        case 'string':
        case 'boolean':
            gameLayer.json.constants[key] = {type: typeof value, value: jsonValue};
            break;
            
        case 'object':
            console.assert(value === null);
            // Fall through
        case 'undefined':
            gameLayer.json.constants[key] = {type: 'nil'};
            break;

        default:
            // A more complex object
            gameLayer.json.constants[key].value = jsonValue;
            break;
        }
    }
    
    // Set a timer to save the game.json
    if (gameLayer === gameSource) {
        serverScheduleSaveGameJSON(CONSTANT_EDITOR_SAVE_DELAY);
    } else if (gameLayer === gameSource.debug) {
        // There is no save delay implemented for the debug layer currently
        serverSaveDebugJSON();
    }
    
    // if the game is running, update the live constant
    if (emulatorMode !== 'stop') {
        redefineConstantByName(environment, key);
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
        }, true);
    });
}


function onRemoveConstant(key) {
    if (confirm('Remove constant \'' + key + '\' from this project?')) {
        delete gameSource.json.constants[key];
        serverSaveGameJSON(function () {
            loadGameIntoIDE(window.gameURL, null, true);
        });
    }
}


function onEditConstantMetadata(key) {
    /*
    // Reload
    serverSaveGameJSON(function () {
        loadGameIntoIDE(window.gameURL, function () {
            // Select
            onProjectSelect(document.getElementById('projectConstant_' + key), 'constant', key);
        });
    });
    */
}


function onEditConstantDescription(constantName) {
    let json = gameSource.json.constants[constantName];
    
    let description = json.description || '';
    
    description = window.prompt("Description for constant '" + constantName + "'", description);
    if (description) {
        switch (typeof json) {
        case 'string': json = {'type': 'string', 'value': json}; break;
        case 'number': json = {'type': 'number', 'value': json}; break;
        }
        json.description = description;
        gameSource.json.constants[constantName] = json;
        
        serverSaveGameJSON(function () {
            loadGameIntoIDE(window.gameURL, function () {
                // Select
                onProjectSelect(document.getElementById('projectConstant_' + key), 'constant', key);
            }, true);
        });
    }
}


function onRenameConstant(constantName) {
    let newName;
    while (true) {
        newName = window.prompt("New name for constant '" + constantName + "'", constantName);
        if (! newName || newName === '') { return; }
        
        // Mangle
        newName = newName.replace(/(^_|[^_0-9A-Za-z])/g, '');

        // Check for conflict
        if (gameSource.json.assets[newName]) {
            window.alert("There is already an asset named '" + newName + "'");
        } else if (gameSource.json.constants[newName]) {
            window.alert("There is already another constant named '" + newName + "'");
        } else {

            // Perform the rename
            gameSource.json.constants[newName] = gameSource.json.constants[constantName];
            delete gameSource.json.constants[constantName];
            
            serverSaveGameJSON(function () {
                loadGameIntoIDE(window.gameURL, function () {
                    // Select the renamed asset
                    onProjectSelect(document.getElementById('projectConstant_' + newName), 'constant', newName);
                }, true);
            });
            
            return;
        } // if ok name
    } // while true
}


function showConstantContextMenu(constantName) {
    const getElement = `document.getElementById('projectConstant_${constantName}')`;
    customContextMenu.innerHTML =
        `<div onmousedown="onProjectSelect(${getElement}, 'constant', '${constantName}')">Change Value</div>
        <div onmousedown="onRenameConstant('${constantName}')">Rename&hellip;</div>
        <div onmousedown="onEditConstantDescription('${constantName}')">Edit Description&hellip;</div>
        <hr><div onmousedown="onRemoveConstant('${constantName}')""><span style="margin-left:-18px; width:18px; display:inline-block; text-align:center">&times;</span>Remove '${constantName}'</div>`;
    showContextMenu('project');
}
