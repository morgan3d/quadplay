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


/* Called from onProjectSelect(). Set choice = undefined for ALL constants */
function showConstantEditor(choice) {
    const constantEditor = document.getElementById('constantEditor');
    const array = choice ? [choice] : Object.keys(gameSource.constants);
    array.sort();
    
    // Do not show extra data if many wil be visible
    const compact = choice === undefined;
    
    let html = '';

    // Process all constants named in the array
    for (let i = 0; i < array.length; ++i) {
        const index = array[i];
        
        const value = gameSource.constants[index];
        const json = gameSource.json.constants[index];
        const debugJSON = (gameSource.debug.json && gameSource.debug.json.constants ? gameSource.debug.json.constants[index] : undefined)
        
        const constantName = index;
        const controlName = index;
        const debugControlName = 'debug_' + index;

        let entryHTML = ''; 
    
        if (json.description && json.description !== '') {
            entryHTML += `<div class="ace-quadplay" style="padding-bottom: ${compact ? 2 : 12}px"><i class="ace_comment">${json.description}</i></div>`;
        }

        entryHTML += makeConstantEditorControlHTML(constantName, controlName, json, value, false, compact);
        
        if (editableProject) {
            const indent = 0;
            const debugEnabled = debugJSON && debugJSON.enabled;

            entryHTML += '<br/>';
            
            entryHTML += `<input type="checkbox" style="margin-left:${indent + 1}px; position: relative; top: 2px" autocomplete="false" ${debugEnabled ? 'checked' : ''} onchange="onConstantEditorDebugOverrideChange(gameSource, '${constantName}', this)" class="${compact ? 'debugOverrideCheckbox' : ''}"><label style="color:#bbb" class="${compact ? 'debugOverrideCheckbox' : ''}">Debug&nbsp;Override</label>`;
            entryHTML += `<div class="debugOverride ${debugEnabled ? '' : 'disabled'}" id="constantEditor_${controlName}_debug_div" ${debugEnabled ? '' : 'disabled'} style="margin-left:${indent - 3}px">`;
            
            if (gameSource.debug.constants && gameSource.debug.constants[constantName] !== undefined) {
                // Debug editor for a value already defined in the .debug.json. If the value does
                // not exist or the debug.json does not, then they will be created an inserted
                // on the first enabling of debugging for this constant.
                let debugValue = gameSource.debug.constants[constantName];
                if (debugValue.type !== undefined) {
                    // Not a raw value
                    debugValue = debugValue.value;
                }
                entryHTML += makeConstantEditorControlHTML(constantName, debugControlName, gameSource.debug.json.constants[constantName], debugValue, true, compact);
            }

            // End of debug div
            entryHTML += '</div>';
        }

        if (array.length > 0) {
            // In the all-constant list, wrap each one with its own div
            entryHTML = '<div class="oneConstantEditor">' + entryHTML + '</div>';
        }
            
        html += entryHTML;
        
        if (i < array.length - 1) {
            html += '<hr>';
        }
    } // for each constant
    
    constantEditor.innerHTML = html;
    constantEditor.style.visibility = 'visible';
}


function makeConstantEditorControlHTML(constantName, controlName, json, value, isDebugLayer, compact) {
    let html = '';
    const type = json.type || typeof value;
    const disabled = editableProject ? '' : 'disabled';
    if (type === 'string') {
        html += `<span class="constantName">${constantName}</span> = "<textarea ${json.url ? 'disabled' : ''} style="vertical-align:top; margin-left:1px; margin-right:2px;" autocomplete="false" ${disabled} onchange="onConstantEditorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', this.value, this.value)" rows=4 cols=40>${value}</textarea>"`;
    } else if (value === undefined || value === null) {
        html += '<span class="constantName">' + constantName + '</span> = <code>∅</code><br>';
    } else if (type === 'number') {
        const numValue = (typeof json === 'number') ? value : json.value;

        // Parse and clean up min and max bounds
        let minVal = json.min !== undefined ? evalJSONGameConstant(json.min) : -Infinity;
        let maxVal = json.max !== undefined ? evalJSONGameConstant(json.max) : Infinity;
        if (typeof minVal !== 'number') { minVal = -Infinity; }
        if (typeof maxVal !== 'number') { maxVal = Infinity; }
        if (minVal > maxVal) { let temp = minVal; minVal = maxVal; maxVal = temp; }
        if (isNaN(minVal)) { minVal = -Infinity; }
        if (isNaN(maxVal)) { maxVal = Infinity; }

        // Parse and clean up quantum
        let quantum = 0;
        if (json.quantum !== undefined) {
            try {
                quantum = evalJSONGameConstant(json.quantum);
            } catch (e) {
                quantum = 0;
            }
        }
        if (quantum < 0 || typeof quantum !== 'number' || isNaN(quantum) || quantum === Infinity || quantum > maxVal - minVal) {
            // Not a useful quantum, force to zero
            quantum = 0;
        }

        // Parse and clean up format
        let format = json.format;
        if (typeof format !== 'string') { format = ''; }

        // Event handler
        const onchange =
              `{ const v = clamp(QRuntime.round($parse(this.value, 0).result, ${quantum}), ${minVal}, ${maxVal}); ` +
              `const f = QRuntime.format_number(v, '${format}'); this.value = f; ` +
              `onConstantEditorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', v, f); ` +
              `const slider = document.getElementById('constantEditor_${controlName}_slider'); ` +

              // The maxVal - minVal will be NaN if one is infinity, but then this code will never execute, either!
              `if (slider) { slider.value = 1000 * (v - ${minVal}) / (${maxVal - minVal}); }}`;
        html += `<span class="constantName">${constantName}</span> = <input id="constantEditor_${controlName}_textbox" style="width:100px; text-align: right" type="text" onchange="${onchange}" autocomplete="false" ${disabled} value="${numValue}">`;

        // Show a slider
        if (editableProject &&
            (json.type === 'number' || typeof json.value === 'number') &&
            isFinite(minVal) &&
            isFinite(maxVal)) {

            // Create the slider
            const editor = `<input id="constantEditor_${controlName}_slider" type="range" oninput="onConstantEditorSliderChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, 'constantEditor_${controlName}_textbox', '${type}', QRuntime.round(this.value * ${(maxVal - minVal) / 1000} + ${minVal}, ${quantum}), '${format}')" style="height: 1em" min="0" max="1000" value="${1000 * (value - minVal) / (maxVal - minVal)}"></input>`;
            
            // Insert into the html
            html = `<table style="border-collapse: collapse"><tr align="top"><td>${html}</td><td>${editor}</td></tr></table>\n`;
        } else {
            html += '<br>';
        }
        
        if (! compact) {
            // Show extra information
            html += '<br><i>All PyxlScript number formats supported. For example, <code>10, -3, 1.5, 2pi, 90deg, 90°, -∞, π, ½</code></i>';
        }
    } else if (type === 'boolean') {
        html += `<span class="constantName">${constantName}</span> = <label><div id="constantEditor_${controlName}_display" class="code" style="display: inline-block; width: 45px; font-size: 100%">${value}</div><input type="checkbox" style="position: relative; top: 2px; left: -3px; margin-right:0.5px" autocomplete="false" onchange="onConstantEditorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', this.checked, this.checked)" ${disabled} ${value ? 'checked' : ''}></label><br>`;
    } else if (type === 'xy' || type === 'xz' || type === 'xyz' ||
               type === 'rgb' || type === 'rgba' ||
               type === 'hsv' || type === 'hsva') {

        const fields = type;
        
        const onchange = `onConstantEditorVectorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', '${fields}', event)`;

        html += `<table style="margin-left:10px">`;

        for (let i = 0; i < fields.length; ++i) {
            const element = fields[i];
            const elementValue = json.value[element].type ? json.value[element].value : value[element];
            html += `<tr><td>${element}:</td><td style="white-space: nowrap"><input id="constantEditor_${controlName}_${element}" onchange="${onchange}" style="width:80px; text-align: right; margin-left: 1px; margin-right: 1px" type="text" autocomplete="false" ${disabled} value="${elementValue}">`;
            html +=  (i < fields.length - 1) ? ', ' : '';
            html += '</td></tr>';
        }

        html += '</table>}';

        // editor is the sliders. metaEditor is a preview (for the color)
        let editor = '', metaEditor = '';

        // Nudge buttons for vectors
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
            editor = `<div style="border-radius: 4px; border: 1px solid #000; width: 64px; height: 64px; overflow: hidden" class="checkerboard"><div id="constantEditor_${controlName}_preview" style="background: ${htmlColor4Bit(value)}; width: 64px; height: 64px"></div></div>`;
            
            // Sliders for color channels
            if (editableProject) {
                // Move the color preview over to make room for the sliders
                metaEditor = editor;
                
                editor = '<table>';
                for (let i = 0; i < fields.length; ++i) {
                    const element = fields[i];
                    editor += `<tr><td><input id="constantEditor_${controlName}_slider_${element}" type="range" oninput="onConstantEditorVectorSliderChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, 'constantEditor_${controlName}', '${type}', '${element}', this.value / 255)" style="height: 1em" min="0" max="255" value="${255 * value[element]}"></input></td></tr>`;
                }
                editor += '</table>';
            }

            editor += `// <code style="font-size: 120%" id="constantEditor_${controlName}_hex">${colorToHexString(value)}</code>`;
        } // End special case editors

        if (editor !== '') {
            html = '<table style="border-collapse: collapse"><tr valign="top"><td>' + html + '</td><td style="padding-left: 10px">' + editor + '</td><td>' + metaEditor + '</td></tr></table>';
        }
        html = `<span class="constantName">${constantName}</span> = {<br>` + html;
    } else if (type === 'reference') {
        html += `<span class="constantName">${constantName}</span> → <div class="select-editable"><select onchange="this.nextElementSibling.value=this.value; onConstantEditorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', this.value, this.value)"><option value=""></option>`;

        // Make sorted lists of all constants followed by all assets
        let sources = gameSource.json.constants;
        for (let j = 0; j < 2; ++j) {
            let list = [];
            for (let key in sources) {
                if (key !== constantName) {
                    list.push(key);
                }
            }
            
            list.sort();
            
            for (let i = 0; i < list.length; ++i) {
                const key = list[i];
                html += `<option value="${key}" ${key === json.value ? 'selected="selected"' : ''}>${key}</option>`;
            }
            
            sources = gameSource.json.assets;
        }

        html += `</select><input type="text" onchange="combobox_textbox_onchange(this); onConstantEditorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', this.value, this.value)" value="${json.value}" /></div><br>`;
    } else {
        // Object or array (including built-in objects)
        const s = QRuntime.unparse(value);
        if (s.length > 16) {
            html += '<span class="constantName">' + constantName + '</span> = <table>' + visualizeConstant(value, '') + '</table>';
        } else {
            html += '<span class="constantName">' + constantName + '</span> = ' + escapeHTMLEntities(s);
        }
    }
    
    return html;
}


function colorToHexString(color, scale = 15) {
    function percentTo255Hex(v) {
        // Convert to integer
        v = clamp(Math.round(v * scale), 0, scale);
        // Zero pad and hex convert
        return (v < 16 && scale === 255 ? '0' : '') + v.toString(16);
    }

    let s;
    if (color.h !== undefined) {
        // hsv
        s = colorToHexString(rgb(color));
        
    } else {
        // rgb
        s = '#';
        s += percentTo255Hex(color.r) + percentTo255Hex(color.g) + percentTo255Hex(color.b);
    }

    if (color.a !== undefined) {
        s += percentTo255Hex(color.a);
    }

    return s.toUpperCase();
}


/* Called when the debug override GUI control changes for any
   constant. Responsible for creating the debug.json and debug entry
   for this constant and the GUI if they do not already exist, as
   well as toggling the override in the debug.json file */
function onConstantEditorDebugOverrideChange(gameSource, name, checkbox) {
    // Ensure that the constant exists in the json, creating it if needed
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
            gameSource.debug.json.constants[name] = {type: typeof value, value: value};
        }
        created = true;
    }

    const debugPane = document.getElementById('constantEditor_' + name + '_debug_div');
    if (debugPane) {
        if (checkbox.checked) {
            debugPane.classList.remove('disabled');
            debugPane.disabled = false;
        } else {
            debugPane.classList.add('disabled');
            debugPane.disabled = true;
        }
    }

    gameSource.debug.json.constants[name].enabled = checkbox.checked;
    
    if (created) {
        // Create the controls dynamically (force it to compact mode, since we
        // don't know whether we are compact or not at this point)
        debugPane.innerHTML =
            makeConstantEditorControlHTML(name, 'debug_' + name,
                                          gameSource.debug.json.constants[name],
                                          gameSource.debug.constants[name], true, true);
    }
    
    serverSaveDebugJSON();

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


function onConstantEditorSliderChange(gameLayer, controlName, type, value, format) {
    const textBox = document.getElementById(controlName);
    console.assert(textBox, 'Could not find control id = "' + controlName + '"');
    textBox.value = QRuntime.format_number(value, format);
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

        const hex = document.getElementById('constantEditor_' + controlName + '_hex');
        hex.innerHTML = colorToHexString(value);
            
        // Update sliders if editable
        for (let i = 0; i < type.length; ++i) {
            const field = type[i];
            const slider = document.getElementById('constantEditor_' + controlName + '_slider_' + field);
            if (slider) {
                slider.value = value[field] * 255;
            }
        }
    }
    
    // Pass down to the generic value change handler
    onConstantEditorValueChange(gameLayer, environment, controlName, key, value, json.value, null);
}


/** Value is the numeric value to assign. jsonValue is what to store in the .value
    field of the game.json file. */
function onConstantEditorValueChange(gameLayer, environment, controlName, key, value, jsonValue) {
    // Update gameLayer.json.constants
    if (typeof gameLayer.json.constants[key] === 'object') {
        // The target already has metadata, just write to the value field
        const obj = gameLayer.json.constants[key];
        console.assert(obj.type !== 'raw');
        obj.value = jsonValue;
    } else {
        // The target was a raw value. Create metadata.
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
    
    if (typeof value === 'boolean') {
        document.getElementById(`constantEditor_${controlName}_display`).innerHTML = '' + value;
    }
    
    // Update pre-evaluated objects
    if (gameLayer.json.constants[key].type === 'reference') {
        gameLayer.constants[key] = new GlobalReferenceDefinition(key, gameLayer.json.constants[key]);
    } else {
        gameLayer.constants[key] = value;
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

    document.getElementById('newConstantNumberMin').value = '-infinity';
    document.getElementById('newConstantNumberMax').value = '+infinity';
    document.getElementById('newConstantNumberQuantum').value = '0';
    document.getElementById('newConstantNumberFormat').value = '';
    
    // Only make reference types valid if there is already some other
    // asset or constant to refer to.
    document.getElementById('newConstantTypeReference').disabled = 
        (Object.keys(gameSource.json.constants).length === 0 && Object.keys(gameSource.json.assets).length === 0);

    document.getElementById('newConstantDescription').value = '';
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

    let value = {
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

    // Make the reference to *something* valid
    if (type === 'reference') {
        const keyArray = Object.keys(gameSource.json.constants);
        if (keyArray.length > 0) {
            value = keyArray[0];
        } else {
            const keyArray = Object.keys(gameSource.json.assets);
            if (keyArray.length > 0) {
                value = keyArray[0];
            } else {
                // Circular self reference because no other name is valid!
                value = key;
            }
        }
    }

    const obj = {type: type, value: value};
    const description = document.getElementById('newConstantDescription').value;
    if (description !== '') {
        obj.description = description;
    }

    if (type === 'number') {
        const minValText = document.getElementById('newConstantNumberMin').value.trim();
        const maxValText = document.getElementById('newConstantNumberMax').value.trim();
        
        let minVal = $parse(minValText).result;
        let maxVal = $parse(maxValText).result;

        // Legal and nontrivial
        if (! isNaN(minVal) && typeof minVal === 'number' &&
            ! isNaN(maxVal) && typeof maxVal === 'number' &&
            (Math.max(minVal, maxVal) < Infinity || Math.min(minVal, maxVal) > -Infinity)) {

            // Sort
            if (maxVal < minVal) { const temp = minVal; minVal = maxVal; maxVal = temp; }

            // Clamp the initial value to the specified range
            obj.value = value = clamp(obj.value, minVal, maxVal);

            // Save minVal
            if (/^[+\-0-9.]+$/.test(minValText)) {
                obj.min = minVal;
            } else {
                obj.min = {type: 'number', value: minValText};
            }

            // Save maxVal
            if (/^[+\-0-9.]+$/.test(maxValText)) {
                obj.max = maxVal;
            } else {
                obj.max = {type: 'number', value: maxValText};
            }
        } // if min and max val are well formed and not the full range

        const formatText = document.getElementById('newConstantNumberFormat').value.trim();
        const quantumText = document.getElementById('newConstantNumberQuantum').value.trimEnd();
        // Make these discoverable by
        // adding them to the saved object
        obj.format = "";
        if (/^[+\-0-9.]+$/.test(quantumText)) {
            obj.quantum = $parse(quantumText).result;
        } else {
            obj.quantum = {type: 'number', value: quantumText};
        }

        obj.format = formatText;

    } // if number
    
    gameSource.json.constants[key] = obj;
    
    gameSource.constants[key] = value;
    if (! gameSource.json.constants) {
        gameSource.json.constants = {};
    }


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
