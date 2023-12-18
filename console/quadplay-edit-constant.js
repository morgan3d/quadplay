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


/* Called from onProjectSelect(). Set choice = undefined for ALL constants.
   Can only be used with top-level constants */
function showConstantEditor(choice) {
    console.assert(choice === undefined || choice.indexOf('.') === -1, 'showConstantEditor() does not work with nested constants');
    
    const constantEditor = document.getElementById('constantEditor');
    const array = choice ? [choice] : Object.keys(gameSource.constants);
    array.sort();
    
    // Do not show extra data if many will be visible
    const compact = choice === undefined;
    
    let html = '';

    // Process all constants named in the array
    for (let i = 0; i < array.length; ++i) {
        const index = array[i];
        
        const value = gameSource.constants[index];
        const json = gameSource.json.constants[index];
        console.assert(json);
        const debugJSON = (gameSource.debug.json && gameSource.debug.json.constants ? gameSource.debug.json.constants[index] : undefined)
        
        const constantName = index;
        const controlName = index;
        const debugControlName = 'debug_' + index;

        let entryHTML = ''; 
    
        if (json.description && json.description !== '') {
            entryHTML += `<div class="ace-quadplay" style="padding-bottom: ${compact ? 2 : 12}px"><i class="ace_comment">${json.description}</i></div>`;
        }

        entryHTML += '<span class="constantName">' + constantName + '</span> = ' + makeConstantEditorControlHTML(constantName, json, value, false, compact);

        const isContainer = json.type === 'array' || json.type === 'object';
        entryHTML = `<div class="${isContainer ? 'containerConstantEditor' : 'oneConstantEditor'}">${entryHTML}</div>`;
            
        html += entryHTML;
        
        if (i < array.length - 1) {
            html += '<hr>';
        }
    } // for each constant
    
    constantEditor.innerHTML = html;
    constantEditor.style.visibility = 'visible';
}

/*
  `constantName`
  :  The variable name of the gameSource.json.constants property. To support nested
  :  properties, this may include '.', for example: 'foo.bar.baz' or 'foo.3.health'

  `json`
  :  The JSON source, with `value`, `type`, `description` and other metadata

  `value`
  :  The parsed runtime value. This is not necessarily json.value, for example,
  :  if this is a number, then the json may have a string representation such as "infinity"
  :  or "0xFF" and the value can be a live number.

  `isDebugLayer`
  :  Use gameSource.debug.json.constants or gameSource.json.constants?

  `compact`
  :  If false (default), show extra help information
  
 */
function makeConstantEditorControlHTML(constantName, json, value, isDebugLayer, compact) {
    console.assert(json);
    const type = json.type || typeof value;
    const disabled = editableProject ? '' : 'disabled';
    const controlName = (isDebugLayer ? 'debug_' : '') + constantName;

    let html = '';

    if (type === 'string') {        

        const isLarge = value.length > 20 || value.indexOf('\n') !== -1;
        html += `"<textarea ${json.url ? 'disabled' : ''} style="${isLarge ? '' : 'display: inline-block;'} vertical-align:top; margin-left:1px; margin-right:2px;" autocomplete="false" ${disabled} onchange="onConstantEditorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', this.value, this.value)" rows=${isLarge ? 4 : 1} cols=${isLarge ? 40 : 20}>${value}</textarea>"<br>`;

    } else if (value === undefined || value === null) {

        html += '<code>∅</code><br>';
        
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
        html += `<input id="constantEditor_${controlName}_textbox" style="width:100px; text-align: right" type="text" onchange="${onchange}" autocomplete="false" ${disabled} value="${numValue}">`;

        // Show a slider
        if (editableProject &&
            (json.type === 'number' || typeof json.value === 'number') &&
            isFinite(minVal) &&
            isFinite(maxVal)) {

            // Create the slider
            const editor = `<input ${compact ? 'class="nudge"' : ''} id="constantEditor_${controlName}_slider" type="range" oninput="onConstantEditorSliderChange('constantEditor_${controlName}_textbox', QRuntime.round(this.value * ${(maxVal - minVal) / 1000} + ${minVal}, ${quantum}), '${format}')" min="0" max="1000" value="${1000 * (value - minVal) / (maxVal - minVal)}"></input>`;
            
            // Insert into the html
            html = `<table style="display: inline-block; vertical-align: middle; border-collapse: collapse"><tr align="top"><td>${html}</td><td>${editor}</td></tr></table><br>`;
        } else {
            html += '<br>';
        }
        
        if (! compact) {
            // Show extra information
            html += '<i>All PyxlScript number formats supported. For example, <code>10, -3, 1.5, 2pi, 90deg, 90°, -∞, π, ½</code></i><br>';
        }
        
    } else if (type === 'boolean') {

        html += `<label><div id="constantEditor_${controlName}_display" class="code" style="display: inline-block; width: 45px; font-size: 100%">${value}</div><input type="checkbox" style="position: relative; top: 2px; left: -3px; margin-right:0.5px" autocomplete="false" onchange="onConstantEditorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', this.checked, this.checked)" ${disabled} ${value ? 'checked' : ''}></label><br>`;

    } else if (type === 'xy' || type === 'xz' || type === 'xyz' ||
               type === 'rgb' || type === 'rgba' ||
               type === 'hsv' || type === 'hsva' ||
               type === 'distribution') {

        const fields = (type === 'distribution') ? safeObjectKeys(json.value) : type;
        const onchange = `onConstantEditorVectorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', ${JSON.stringify(fields).replaceAll('"', "'")}, event)`;

        html += `<table style="margin-left:10px">`;

        for (let i = 0; i < fields.length; ++i) {
            const element = fields[i];
            const elementValue = json.value[element].type ? json.value[element].value : value[element];

            let elementQuote = element;
            if (! elementQuote.match(/^[a-zA-Z_][a-zA-Z_0-9]*$/)) {
                // Need quotes
                elementQuote = '"' + elementQuote + '"';
            }
            
            html += `<tr><td>${elementQuote}:</td><td style="white-space: nowrap"><input id="constantEditor_${controlName}_${element.replace(/[^a-z0-9_A-Z]/g, '_')}" onchange="${onchange}" style="width:80px; text-align: right; margin-left: 1px; margin-right: 1px" type="text" autocomplete="false" ${disabled} value="${elementValue}">`;
            html += '</td></tr>';
        }

        html += '</table>';

        // editor is the sliders. metaEditor is a preview (for the color)
        let editor = '', metaEditor = '';

        // Nudge buttons for vectors
        if (editableProject && (type === 'xy' || type === 'xz' || type === 'xyz')) {
            // Position editor
            
            // The arrow characters here must be kept in sync with onConstantEditorVectorNudge
            const buttonParams = ` style="width:18px; height:18px; padding: 0; font-size:10px; font-weight: bold; font-family: sans-serif" onclick="onConstantEditorVectorNudge('constantEditor_${controlName}', '${type}', this.innerText)"`;

            editor += '<table style="border-collapse:collapse" ' + (compact ? 'class="nudge"' : '') + '>';
            
            if (type.length === 3) {
                editor += `<tr valign=top><td></td><td><button ${buttonParams} title="+${type[1]}">↑</button></td><td><button ${buttonParams} title="-z">↗</button></td></tr>` +
                    `<tr><td><button ${buttonParams} title="-x">←</button></td><td></td><td><button ${buttonParams} title="+x">→</button></td></tr>` +
                    `<tr><td><button ${buttonParams} title="+z">↙</button></td><td><button ${buttonParams} title="-${type[1]}">↓</button></td><td></td></tr>`;
            } else {
                editor += `<tr><td rowspan=2><button ${buttonParams} title="-x">←</button></td><td><button ${buttonParams} title="+${type[1]}">↑</button></td><td rowspan=2><button ${buttonParams} title="+x">→</button></td></tr>` +
                    `<tr><td><button ${buttonParams} title="-${type[1]}">↓</button></td></tr>`;
            }

            editor += '</table>';
            
            metaEditor = '<table style="margin-left:10px" ' + (compact ? 'class="nudge"' : '') + '>';
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
        } else if (type === 'rgb' || type === 'rgba' || type === 'hsv' || type === 'hsva' || type === 'distribution') {
            // Editor with sliders

            if (type !== 'distribution') {
                // Display color
                editor = `<div style="border-radius: 4px; border: 1px solid #000; width: 64px; height: 64px; overflow: hidden" class="checkerboard"><div id="constantEditor_${controlName}_preview" style="background: ${htmlColor4Bit(value)}; width: 64px; height: 64px"></div></div>`;
            }
            
            // Sliders for color channels and distributions
            if (editableProject) {
                // Move the color preview over to make room for the sliders
                metaEditor = editor;

                let sum = 0;
                if (type === 'distribution') {
                    for (let i = 0; i < fields.length; ++i) {
                        sum += value[fields[i]];
                    }
                }
                    
                editor = '<table>';
                for (let i = 0; i < fields.length; ++i) {
                    const element = fields[i];
                    editor += `<tr><td><input id="constantEditor_${controlName}_slider_${element.replace(/[^a-z0-9_A-Z]/g, '_')}" type="range" oninput="onConstantEditorSliderChange('constantEditor_${controlName}_${element.replace(/[^a-z0-9_A-Z]/g, '_')}', this.value / 1000, '${type === 'distribution' ? '0.000' : '0%'}')" min="0" max="1000" value="${1000 * value[element]}"></input></td>`;
                    if (type === 'distribution') {
                        // Add the normalized percentages
                        editor += `<td style="text-align: right"><span id="constantEditor_${controlName}_percent_${element.replace(/[^a-z0-9_A-Z]/g, '_')}">${QRuntime.format_number(value[element] / sum, '%')}</span></td>`;
                    }
                    editor += '</tr>';
                }
                editor += '</table>';
            }

        } // End special case editors

        if (editor !== '') {
            html = '<table style="border-collapse: collapse"><tr valign="middle"><td>' + html + '</td><td style="padding-left: 10px">' + editor + '</td><td>' + metaEditor + '</td></tr></table>';
            if (editableProject && type === 'distribution') {
                html += `<span class="newNestedConstant clickable" style="padding-left:14px" onclick="showNewDistributionKeyDialog('${constantName}')">✜&nbsp;<i>New&nbsp;measure…</i></span><br>`;
            }
        }
        html = '{<br>' + html + '}';

        if (type === 'rgb' || type === 'rgba' || type === 'hsv' || type === 'hsva') {
            html += ` // <code style="font-size: 120%" id="constantEditor_${controlName}_hex">${colorToHexString(value)}</code>`;
        }
        html += '<br>';
        
    } else if (type === 'reference') {
        
        html += `<div class="select-editable"><select onchange="this.nextElementSibling.value=this.value; onConstantEditorValueChange(${isDebugLayer ? 'gameSource.debug' : 'gameSource'}, QRuntime, '${controlName}', '${constantName}', this.value, this.value)"><option value=""></option>`;

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
        
    } else if (json.type === 'table') {
        
        // Object or array (including built-in objects)
        const s = QRuntime.unparse(value);
        if (s.length > 16) {
            html += '<table>' + visualizeConstant(value, '') + '</table>';
        } else {
            html += escapeHTMLEntities(s);
        }
        
    } else {
        
        // Object or array (including built-in objects)
        const isArray = type === 'array' || Array.isArray(value);
        html += '<code>' + (isArray && ! json.url ? '[' : '{') + '</code>';
        html += '<div style="margin-left:15px">';

        if (json.url) {
            // Raw constant
            html += `url: ${json.url}`;
        } else {
            const keyArray = Object.keys(value);
            for (let k = 0; k < keyArray.length; ++k) {
                const key = keyArray[k];
                
                // Recursively generate the child editor
                const childIsContainer = json.value[key].type === 'array' || json.value[key].type === 'object';

                let keyQuote = key;
                if (! keyQuote.match(/^[a-zA-Z_][a-zA-Z_0-9]*$/)) {
                    // Need quotes
                    keyQuote = '"' + keyQuote + '"';
                }

                html += `<div class="${childIsContainer ? 'containerConstantEditor' : 'oneConstantEditor'}"><span class="constantName">${keyQuote}</span>:` +
                    makeConstantEditorControlHTML(
                        constantName + '.' + key.replace(/[^0-9a-zA-Z_]/g, '_'),
                        json.value[key],
                        value[key],
                        isDebugLayer,
                        true) + '</div>';
            }

            if (editableProject) {
                html += `<span class="newNestedConstant clickable" onclick="showNewConstantDialog('${constantName}')">✜&nbsp;<i>New&nbsp;${isArray ? 'value' : 'key'}…</i></span>`;
            }
        }
        html += '</div><code>' + (isArray && ! json.url ? ']' : '}') + '</code>';
    }

    const isContainer = json.type === 'array' || json.type === 'object';
    const editableConstant = editableProject && ! isContainer;
        
    if (editableConstant && ! isDebugLayer) {
        const indent = 0;
        const debugJSON = (gameSource.debug.json && gameSource.debug.json.constants) ? nestedGet(gameSource.debug.json.constants, constantName, true, true) : undefined
        const debugEnabled = debugJSON && debugJSON.enabled;
        
        html += `<input type="checkbox" style="margin-left:${indent + 1}px; position: relative; top: 2px" autocomplete="false" ${debugEnabled ? 'checked' : ''} onchange="onConstantEditorDebugOverrideChange(gameSource, '${constantName}', this)" class="${compact ? 'debugOverrideCheckbox' : ''}"><label style="color:#bbb" class="${compact ? 'debugOverrideCheckbox' : ''}">Debug&nbsp;Override</label>`;
        html += `<div class="debugOverride ${debugEnabled ? '' : 'disabled'}" id="constantEditor_${controlName}_debug_div" ${debugEnabled ? '' : 'disabled'} style="margin-left:${indent - 3}px">`;
        
        if (gameSource.debug.constants) {
            const debugValue = nestedGet(gameSource.debug.constants, constantName, true);
            
            if (debugValue !== undefined) {
                // Debug editor for a value already defined in the .debug.json. If the value does
                // not exist or the debug.json does not, then they will be created an inserted
                // on the first enabling of debugging for this constant.
                if (debugValue.type !== undefined) {
                    // Not a raw value
                    debugValue = debugValue.value;
                }
                html += makeConstantEditorControlHTML(constantName, nestedGet(gameSource.debug.json.constants, constantName, false, true), debugValue, true, compact);
            }
        }

        // End of debug div
        html += '</div><br>';
    } // Debug override
    
    return html;
}


function safeObjectKeys(object) {
    if (Array.isArray(object)) {
        return Object.keys(object);
    } else {
        const keys = [];
        for (let k in object) {
            if (k[0] !== '$') {
                keys.push(k);
            }
        }
        return keys;
    }
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

    let debugJSON = nestedGetObject(gameSource.debug.json.constants, name, true, true);
    const gameJSON = nestedGetObject(gameSource.json.constants, name, false, true);

    if (! debugJSON) {
        // Need to create a least part of the path in both the debug JSON and debug constants.
        // Walk it recursively
        
        let key = name;
        let srcParent = gameSource.json.constants;
        let dstParent = gameSource.debug.json.constants;
        let valueParent = gameSource.debug.constants;
        
        let i = key.indexOf('.');
        while (i !== -1) {
            const k = key.substring(0, i);
            const next = dstParent[k];
            if (! next) {
                // Terminal end of pre-existing path, clone from the
                // source from here down
                dstParent[k] = deep_clone(srcParent[k]);
                // Populate the constant value so that controls can look up
                valueParent[k] = evalJSONGameConstant(dstParent[k]);
                break;
            } else {
                // Recurse into next part
                dstParent = next.value;
                srcParent = srcParent[k].value;
                valueParent = valueParent[k];
                key = key.substring(i + 1);
                i = key.indexOf('.');
            }
        }

        // Get the object again
        debugJSON = nestedGetObject(gameSource.debug.json.constants, name, false, true);
        console.assert(debugJSON);
    }

    if (! debugJSON.object) {
        // Copy from the non-debug version
        debugJSON.parent[name] = debugJSON.object = deep_clone(gameJSON.object);
        nestedSet(gameSource.debug.constants, name,
                  (debugJSON.object.type === 'reference')  ?
                  new GlobalReferenceDefinition(name, debugJSON.object) :
                  evalJSONGameConstant(debugJSON.object));
        created = true;
    }

    if (typeof debugJSON.object !== 'object') {
        // Wrap raw constants
        const value = debugJSON.object;
        if (value === undefined || value === null) {
            debugJSON.parent[debugJSON.key] = debugJSON.object = {type: 'nil'};
        } else {
            debugJSON.parent[debugJSON.key] = debugJSON.object = {type: typeof value, value: value};
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

    debugJSON.object.enabled = checkbox.checked;
    
    if (created) {
        // Create the controls dynamically (force it to compact mode, since we
        // don't know whether we are compact or not at this point)

        // Create the value
        
        console.log(name, debugJSON.object, gameSource.debug.constants);
        debugPane.innerHTML =
            `<span class="constantName">${name}</span> =` +
            makeConstantEditorControlHTML(name, debugJSON.object,
                                          nestedGet(gameSource.debug.constants, name), true, true);
    }
    
    serverSaveDebugJSON();

    // if the game is running, update the live constant
    if (emulatorMode !== 'stop') {
        redefineConstantByName(QRuntime, name);
    }
}


function onConstantEditorSliderChange(controlName, value, format) {
    const textBox = document.getElementById(controlName);
    console.assert(textBox, 'Could not find control id = "' + controlName + '"');
    textBox.value = QRuntime.format_number(value, format);
    textBox.onchange();
}


/** Called when a direction button is pressed on a vector editor */
function onConstantEditorVectorNudge(controlName, type, direction) {
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


/**
   key is the name of the constant *object*. Which field has been changed is not known to this
   function, which instead serializes all of the fields.
   
   Allows editing an object with a set of numeric fields. fields can be a string of
   single-letter fields or an array of multi-letter ones.

   If the event is undefined, then this was programmatically invoked. */
function onConstantEditorVectorValueChange(gameLayer, environment, controlName, key, fields, event) {
    const json = nestedGet(gameLayer.json.constants, key, false, true);
    console.assert(json !== undefined);

    for (let f = 0; f < fields.length; ++f) {
        const element = fields[f];

        console.assert(json.value[element] !== undefined);

        // Force metadata if not already present
        if (! json.value[element].type) { json.value[element] = {type: 'number', value: undefined}; }

        const value = document.getElementById('constantEditor_' + controlName + '_' + element.replace(/[^a-z0-9_A-Z]/g, '_')).value;
        
        // Update stored value
        json.value[element].value = value;

        if (json.nudge) {
            json.nudge[element] = document.getElementById('constantEditor_' + controlName + '_nudge_' + element.replace(/[^a-z0-9_A-Z]/g, '_')).value;
        }
    }

    const value = evalJSONGameConstant(json);

    const type = json.type;
    const isColor =
          type === 'rgb' || type === 'rgba' ||
          type === 'hsv' || type === 'hsva';
    
    if (isColor) {

        // Update the color preview
        const preview = document.getElementById('constantEditor_' + controlName + '_preview');
        preview.style.background = htmlColor4Bit(value);

        const hex = document.getElementById('constantEditor_' + controlName + '_hex');
        hex.innerHTML = colorToHexString(value);
    }

    if (isColor || type === 'distribution') {
        // Update sliders if editable
        let sum = 0;
        for (let i = 0; i < fields.length; ++i) {
            const field = fields[i];
            const slider = document.getElementById('constantEditor_' + controlName + '_slider_' + field.replace(/[^a-z0-9_A-Z]/g, '_'));
            if (slider) {
                slider.value = value[field] * 1000;
                sum += value[field];
            }
        }

        if (type === 'distribution') {
            // Compute normalized probabilities
            if (sum <= 0 || isNaN(sum) || Math.abs(sum) === Infinity) {
                sum = 1;
            }
            
            for (let i = 0; i < fields.length; ++i) {
                const field = fields[i];
                
                // Update the percentage label
                const percent = value[field] / sum;
                document.getElementById('constantEditor_' + controlName + '_percent_' + field.replace(/[^a-z0-9_A-Z]/g, '_')).innerHTML = QRuntime.format_number(percent, '%');
            }
        } // if distribution
    }

    // Pass down to the generic value change handler
    onConstantEditorValueChange(gameLayer, environment, controlName, key, value, json.value, null);
}


/** Value is the numeric value to assign. jsonValue is what to store in the .value
    field of the game.json file. */
function onConstantEditorValueChange(gameLayer, environment, controlName, key, value, jsonValue) {

    console.assert(gameLayer.json);
    const k = nestedGetObject(gameLayer.json.constants, key, false, true);
    
    // Update gameLayer.json.constants
    if (typeof k.object === 'object') {
        // The target already has metadata, just write to the value field
        console.assert(k.object.type !== 'raw');
        k.object.value = jsonValue;
    } else {
        // The target was a raw value. Create metadata.
        switch (typeof value) {
        case 'number':
        case 'string':
        case 'boolean':
            k.parent[k.key] = k.object = {type: typeof value, value: jsonValue};
            break;
            
        case 'object':
            console.assert(value === null);
            // Fall through
        case 'undefined':
            k.parent[k.key] = k.object = {type: 'nil'};
            break;

        default:
            console.assert(false, 'Should not get here');
            // A more complex object
            //obj.value = jsonValue;
            break;
        }
    }
    
    if (typeof value === 'boolean') {
        document.getElementById(`constantEditor_${controlName}_display`).innerHTML = '' + value;
    }
    
    // Update pre-evaluated objects
    if (k.object.type === 'reference') {
        nestedSet(gameLayer.constants, key, new GlobalReferenceDefinition(key, k.object));
    } else {
        nestedSet(gameLayer.constants, key, value);
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
function showNewDistributionKeyDialog(parentKey) {

    let key;
    while (true) {
        key = window.prompt("Key for new measure in '" + parentKey + "'", '');
        
        // Cancel
        if (! key || key === '') { return; }
        
        // Mangle
        key = key.replace(/(^_|[^_0-9A-Za-z])/g, '');

        // Check for conflict
        if (nestedGet(gameSource.json.constants, parentKey + '.' + key, true, true) !== undefined) {
            window.alert("There is already a measure named '" + parentKey + '.' + key + "'. Choose a different name.");
        } else {
            // Add
            const value = 0.5;
            nestedGet(gameSource.constants, parentKey)[key] = value;
            nestedGet(gameSource.json.constants, parentKey, false, true).value[key] = {type: 'number', value: value};

            // Reload
            serverSaveGameJSON(function () {
                loadGameIntoIDE(window.gameURL, function () {
                    // Select the same parent
                    onProjectSelect(document.getElementById('projectConstant_' + parentKey), 'constant', parentKey);
                }, true);
            });
            return;
        }
    }

}


/* `parentKey` If defined, this is the name of the parent array/object constant
   that the new element goes within */
function showNewConstantDialog(parentKey) {
    document.getElementById('newConstantDialog').classList.remove('hidden');
    document.getElementById('newConstantCreateButton').disabled = true;
    const text = document.getElementById('newConstantName');
    text.value = '';
    text.focus();
    text.style.visibility = 'inherit';

    if (parentKey) {
        const parent = nestedGet(gameSource.json.constants, parentKey, false, true);

        let parentName = parentKey.replaceAll(/\.[0-9]+(?=\.)/g, function (match) { return '[' + match.substring(1) + ']';});
        
        if (parent.type === 'array') {
            text.style.visibility = 'hidden';
            parentName += '[' + parent.value.length + ']';
            document.getElementById('newConstantCreateButton').disabled = false;
        } else {
            parentName += '.';
        }
        document.getElementById('newConstantNameParent').innerHTML = parentName;
    } else {
        document.getElementById('newConstantNameParent').innerHTML = '';
    }

    document.getElementById('newConstantCreateButton').onclick = function () { onNewConstantCreate(parentKey); };
    
    document.getElementById('newConstantNumberMin').value = '-infinity';
    document.getElementById('newConstantNumberMax').value = '+infinity';
    document.getElementById('newConstantNumberQuantum').value = '0.01';
    document.getElementById('newConstantNumberFormat').value = '0.00';
    
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


/* Callback from the New Constant dialog in the IDE.  Creates as a
   child of `parentKey` if it is defined, otherwise as a global
   constant. */
function onNewConstantCreate(parentKey) {
    hideNewConstantDialog();

    let key = document.getElementById('newConstantName').value;

    // May be empty if appending to an array
    if (key === '') {
        console.assert(parentKey);
        key = nestedGet(gameSource.constants, parentKey).length;
    }
    
    if ((nestedGet(gameSource.constants, (parentKey ? parentKey + '.' : '') + key, true) !== undefined) &&
        ! window.confirm('There is already a constant named ' +
                         key.replaceAll(/\.[0-9]+(?=\.)/g, function (match) { return '[' + match.substring(1) + ']';}) +
                         '. Replace it?')) {
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
        distribution: {},
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

    if (! gameSource.json.constants) {
        gameSource.json.constants = {};
    }
    
    if (parentKey) {
        nestedGet(gameSource.constants, parentKey)[key] = value;
        nestedGet(gameSource.json.constants, parentKey, false, true).value[key] = obj;
    } else {
        gameSource.constants[key] = value;
        gameSource.json.constants[key] = obj;
    }

    // Reload
    serverSaveGameJSON(function () {
        loadGameIntoIDE(window.gameURL, function () {
            const k = parentKey ? parentKey.replace(/\..+/, '') : key;
                
            // Select the new constant
            onProjectSelect(document.getElementById('projectConstant_' + k), 'constant', k);
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
