/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License 
 
   Overall IDE functionality not needed when running in just emulator mode.
   See quadplay-ide-game.js for the game.json editor pane.
 */
"use strict";


/** UI callback for a project tree control element is clicked. Sometimes
    also directly called by debugging tools to force a display to load in
    the IDE. Requires useIDE = true

    For the overview Mode and Constants page, the object is undefined.

    - `target` is the Project HTML hierarchy element for the . 
      It can often be obtained from the name, for example: 
      document.getElementById('projectAsset_${assetName}').
      If not defined by the caller, it will be discovered
    
    - `type` is one of: 'asset', 'constant', 'mode', 'script', 'doc'
    
    - `object` is the underlying gameSource child to modify
 */
    function onProjectSelect(target, type, object) {
        console.assert(useIDE);
        // Don't do anything if the game hasn't loaded yet. Any
        // editor is likely to crash at this point with undefined
        // children.
        if (! gameSource || ! gameSource.json || ! useIDE) { return; }
        
        // Hide all editors
        const editorFrame = document.getElementById('editorFrame');
        for (let i = 0; i < editorFrame.children.length; ++i) {
            editorFrame.children[i].style.visibility = 'hidden';
        }
        
        const gameEditor    = document.getElementById('gameEditor');
        const modeEditor    = document.getElementById('modeEditor');
        const codePlusFrame = document.getElementById('codePlusFrame');
    
        // Hide the viewers within the content pane for the code editor
        const editorContentFrame = document.getElementById('editorContentFrame');
        for (let i = 0; i < editorContentFrame.children.length; ++i) {
            editorContentFrame.children[i].style.visibility = 'hidden';
        }
    
        const codeEditor     = document.getElementById('codeEditor');
        const spriteEditor   = document.getElementById('spriteEditor');
        const soundEditor    = document.getElementById('soundEditor');
        const mapEditor      = document.getElementById('mapEditor');
        const docEditor      = document.getElementById('docEditor');
    
        document.getElementById('spriteEditorHighlight').style.visibility =
            document.getElementById('spriteEditorPivot').style.visibility = 'hidden';
        
        let list = document.getElementsByClassName('selectedProjectElement');
        for (let i = 0; i < list.length; ++i) {
            list[i].classList.remove('selectedProjectElement');
        }
    
        if ((type === 'mode') && (object === undefined)) {
            // Select the mode diagram itself
            target.classList.add('selectedProjectElement');
            // Skip visualization if game is running and useIDE is true since the mode diagram
            // was already created during game restart to highlight the active mode for debugging
            if (!(useIDE && QRuntime && QRuntime.$gameMode)) {
                visualizeModes(modeEditor);
            }
            modeEditor.style.visibility = 'visible';
            return;
        }
    
        document.getElementById('codeEditorDivider').style.visibility = 'unset';    
        if (type === 'doc') {
            // Documents
            target.classList.add('selectedProjectElement');
            showGameDoc(object);
            docEditor.style.visibility = 'visible';
            codePlusFrame.style.visibility = 'visible';
    
            codePlusFrame.style.gridTemplateRows = `auto 0px 0px 1fr`;
            
            if (object.endsWith('.md') ||
                object.endsWith('.html') ||
                object.endsWith('.txt')) {
    
                // Show the editor after loading the content
                if (fileContents[object] !== undefined) {
                    setCodeEditorDividerFromLocalStorage();
                    setCodeEditorSession(object);
                } else {
                    // Load and set the contents
                    LoadManager.fetchOne({forceReload: true}, object, 'text', null, function (doc) {
                        fileContents[object] = doc;
                        setCodeEditorDividerFromLocalStorage();
                        setCodeEditorSession(object);
                    });
                }
            }
            return;
        }
    
        if (! target && type === 'mode' && object) {
            target = document.getElementById('ModeItem_' + object.name);
        }
    
        if (type === 'game') {
            if (target) { target.classList.add('selectedProjectElement'); }
            visualizeGame(gameEditor, gameSource.jsonURL, gameSource.json);
            gameEditor.style.visibility = 'visible';
            codePlusFrame.style.visibility = 'visible';
            setCodeEditorDividerFromLocalStorage();
            setCodeEditorSession(gameSource.jsonURL);
            return;
        }
    
        // Find the parent .li
        while (target && (target.tagName !== 'LI')) {
            target = target.parentNode;
        }
    
        if (target) {
            target.classList.add('selectedProjectElement');
        }
    
        switch (type) {
        case 'constant':
            // object may be undefined
            showConstantEditor(object);
            break;
            
        case 'mode':
        case 'script':
            {
                // See if there is already an open editor session, and create one if it
                // doesn't exist
                const url = (type === 'mode') ? object.url : object;
                setCodeEditorSession(url);
                // Show the code editor and hide the content pane
                codePlusFrame.style.visibility = 'visible';
                codePlusFrame.style.gridTemplateRows = '0px 0px auto 1fr';
                document.getElementById('codeEditorDivider').style.visibility = 'hidden';
            }
            break;
            
        case 'asset':
            console.assert(object);
            const url = object.$url || object.src;
            // Find the underlying gameSource.asset key for this asset so
            // that we can fetch it again if needed
            let assetName;
            for (const k in gameSource.assets) {
                const asset = gameSource.assets[k];
                if (asset === object) {
                    assetName = k;
                    break;
                } else if (asset.spritesheet && asset.spritesheet === object) {
                    // Spritesheet on a map
                    assetName = asset.$name + '.spritesheet';
                    break;
                }
            }
            console.assert(assetName, 'Could not find asset name for ' + object);
            setCodeEditorSession(object.$jsonURL, assetName);
    
            // Show the code editor and the content pane
            codePlusFrame.style.visibility = 'visible';
            setCodeEditorDividerFromLocalStorage();
            const spriteEditorCanvas = document.getElementById('spriteEditorCanvas');
            const spriteEditorHighlight = document.getElementById('spriteEditorHighlight');
            const spriteEditorPivot = document.getElementById('spriteEditorPivot');
            const spriteEditorInfo = document.getElementById('spriteEditorInfo');
            spriteEditorHighlight.style.visibility = 'hidden';
            spriteEditorPivot.style.visibility = 'hidden';
            spriteEditorCanvas.onmousemove = spriteEditorCanvas.onmousedown = undefined;
            spriteEditorAsset = object;
            spriteEditorAssetName = assetName;
    
            if (/\.png$/i.test(url)) {
                showPNGEditor(object, assetName);
            } else if (/\.mp3$/i.test(url)) {
                soundEditor.style.visibility = 'visible';
                soundEditorCurrentSound = object;
                document.querySelector('#soundEditor audio').src = object.$url;
            } else if (/\.tmx$/i.test(url)) {
                visualizeMap(object);
                mapEditor.style.visibility = 'visible';
            }
            break;
        }
    }




let soundEditorCurrentSound = null;

function setEditorTitle(url) {
    const editorTitle = document.getElementById('editorTitle');
    editorTitle.innerHTML = url.replace(/^.*\//, '').replace(/[<>&]/g, '');
    editorTitle.title = url;
}


/* Updates the preview pane of the doc editor. If useFileContents is true,
   use fileContents[url] when not undefined instead of actually reloading. */
function showGameDoc(url, useFileContents) {
    const docEditor = document.getElementById('docEditor');
    setEditorTitle(url);

    const preserveScroll = (docEditor.lastURL === url);
    docEditor.lastURL = url;

    const srcdoc = useFileContents ? fileContents[url] : undefined;

    // Store old scroll position
    let oldScrollX = 0, oldScrollY = 0;
    {
        const element = document.getElementById('doc');
        if (element) {
            if (element.contentWindow) {
                // Only works when the document is on the same domain
                const doc = element.contentWindow.document;
                const html = doc.getElementsByTagName('html')[0];
                oldScrollX = Math.max(html.scrollLeft, doc.body.scrollLeft);
                oldScrollY = Math.max(html.scrollTop, doc.body.scrollTop);
            } else {
                oldScrollX = element.scrollLeft;
                oldScrollY = element.scrollTop;
            }
        }
    }
    
    // Strip anything sketchy that looks like an HTML attack from the URL
    console.assert(url !== undefined);
    url = url.replace(/['" ><]/g, '');

    docEditor.innerHTML = `<iframe id="doc" onload="setIFrameScroll(this, ${oldScrollX}, ${oldScrollY})" border=0 width=125% height=125%></iframe>`;
    if (url.endsWith('.html')) {
        // Includes the .md.html case
        
        if (srcdoc !== undefined && false) {
            // TODO: Why would we want this case? It causes problems with reloads
            
            // Already loaded content.
            // Add a base tag to HTML documents so that relative URLs are parsed correctly
            const baseTag = `<base href="${urlDir(url)}">`;
            document.getElementById('doc').srcdoc = (baseTag + srcdoc).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        } else {
            // Load from the file
            document.getElementById('doc').src = url;
        }
    } else if (url.endsWith('.md')) {
        const baseTag = `<base href="${urlDir(url)}">`;

        // Trick out .md files using Markdeep
        
        function markdeepify(text) {
            const markdeepURL = makeURLAbsolute('', 'quad://doc/markdeep.min.js');
            text = baseTag + text;
            // Escape quotes to avoid ending the srcdoc prematurely
            return `${text.replace(/"/g, '&quot;')}
                <style>
body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif}

.md a, .md div.title, contents, .md .tocHeader, 
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6, .md .nonumberh1, .md .nonumberh2, .md .nonumberh3, .md .nonumberh4, .md .nonumberh5, .md .nonumberh6, 
.md .shortTOC, .md .mediumTOC, .md .longTOC {
    color: inherit;
    font-family: inherit;
}
.md .title, .md h1, .md h2, .md h3, .md h4, .md h5, .md h6, .md .nonumberh1, .md .nonumberh2, .md .nonumberh3, .md .nonumberh4, .md .nonumberh5, .md .nonumberh6 {
margin-top: 0; padding-top: 0
}
.md h2 { border-bottom: 2px solid }
.md div.title { font-size: 40px }
.md .afterTitles { height: 0; padding-top: 0; padding-bottom: 0 }
</style>\n

<!-- Markdeep: --><script src='${markdeepURL}'></script>\n`;            
        }

        if (srcdoc !== undefined && false) {
            document.getElementById('doc').srcdoc = markdeepify(srcdoc);
        } else {
            LoadManager.fetchOne({
                errorCallback: function () { console.log('Error while loading', url); },
                forceReload: true}, url, 'text', null,  function (text) {
                    document.getElementById('doc').srcdoc = markdeepify(srcdoc);
                });
        }
    } else {
        // Treat as text file
        docEditor.innerHTML = `<object id="doc" width="125%" height="125%" type="text/plain" data="${url}?" border="0"> </object>`;
    }
}



function visualizeConstant(value, indent) {
    let s = '';
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; ++i) {
        let k = keys[i];
        let v = Array.isArray(value) ? value[i] : value[k];
        k = escapeHTMLEntities(k);
        if (Array.isArray(v) || typeof v === 'object') {
            s += `<tr valign=top><td>${indent}${k}:</td><td></td><td><i>${Array.isArray(v) ? 'array' : 'object'}</i></td></tr>\n` + visualizeConstant(v, indent + '&nbsp;&nbsp;&nbsp;&nbsp;');
        } else {
            v = QRuntime.unparse(v);
            s += `<tr valign=top><td>${indent}${k}:</td><td></td><td>`;

            if (v.indexOf('\n') !== -1 && v[0] === '"' && v[v.length - 1] === '"') {
                // Multiline string. Remove the quotes and format multiline
                v = escapeHTMLEntities(v.substring(1, v.length - 1));
                s += `<table style="border-collapse:collapse; margin: -2px 0"><tr><td style="vertical-align:top"><code>&quot;</code></td><td><pre style="margin: 0 0">${v}</pre></td><td style="vertical-align:bottom"><code>&quot;</code></td></tr></table>`;
            } else {
                v = escapeHTMLEntities(v);
                s += `<code>${v}</code>`
            }
            s += '</td></tr>\n';

        }
    }
    
    return s;
}

/* Requires useIDE = true */
function onOpenFolder(filename) {
    postToServer({command: 'open', app: '<finder>', file: filename});
}

/* Create the editor for the game.json. This function requires useIDE = true */
function visualizeGame(gameEditor, url, game) {
    console.assert(url, 'undefined url');
    console.assert(useIDE);

    const disabled = editableProject ? '' : 'disabled';
    let s = '';

    if (! editableProject) {
        // Why isn't this project editable?
        const reasons = [];

        if (! locallyHosted()) {
            reasons.push('is hosted on a remote server');
        } else if (! isQuadserver) {
            reasons.push('is not running locally with the <code>quadplay</code> script');
        }

        if (! useIDE) {
            reasons.push('was launched without the IDE');
        }

        // Is built-in
        if (isBuiltIn(gameURL)) {
            reasons.push('is a built-in example');
        }
        
        s += '<i>This project is locked because it';
        if (reasons.length > 1) {
            // Many reasons
            s += '<ol>\n';
            for (let i = 0; i < reasons.length; ++i) {
                s += '<li>' + reasons[i] + '</li>\n';
            }
            s += '<ol>\n';
        } else {
            // One reason
            s += ' ' + reasons[0] + '.';
        }
        s += '</i><br><br>\n';
    }

    s += '<table>\n';
    s += '<tr valign="top"><td>Path</td><td colspan=3>' + url + '</td></tr>\n';

    if (editableProject) {
        const filename = serverConfig.rootPath + urlToLocalWebPath(url);
        // The second regexp removes the leading slash on windows
        let path = filename.replace(/\/[^.\/\\]+?\.game\.json$/, '').replace(/^\/([a-zA-Z]:\/)/, '$1');
        if (path.length > 0 && path[path.length - 1] !== '/') { path += '/'; }
        s += `<tr valign="top"><td>Folder</td><td colspan=3><a onclick="onOpenFolder('${path}')" style="cursor:pointer">${path}</a></td></tr>\n`;
    }
    
    s += `<tr valign="top"><td width="110px">Title</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} onchange="onProjectMetadataChanged()" id="projectTitle" value="${(game.title || '').replace(/"/g, '\\"')}"></td></tr>\n`;
    s += `<tr valign="top"><td>Developer</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} onchange="onProjectMetadataChanged()" id="projectDeveloper" value="${(game.developer || '').replace(/"/g, '\\"')}"></td></tr>\n`;
    s += `<tr valign="top"><td>Copyright</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} onchange="onProjectMetadataChanged()" id="projectCopyright" value="${(game.copyright || '').replace(/"/g, '\\"')}"></td></tr>\n`;
    s += `<tr valign="top"><td>License</td><td colspan=3><textarea ${disabled} style="width:384px; padding: 3px; margin-bottom:-3px; font-family: Helvetica, Arial; font-size:12px" rows=2 id="projectLicense" onchange="onProjectMetadataChanged(this)">${game.license}</textarea>`;
    if (editableProject) {
        // License defaults
        s += '<br><button class="license" onclick="onProjectLicensePreset(\'All\')">All Rights Reserved</button><button class="license" onclick="onProjectLicensePreset(\'GPL\')">GPL 3</button><button onclick="onProjectLicensePreset(\'BSD\')" class="license">BSD</button><button class="license" onclick="onProjectLicensePreset(\'MIT\')">MIT</button><button onclick="onProjectLicensePreset(\'CC0\')" class="license">Public Domain</button>';
    }
    s += '</td></tr>\n';

    s+= '<tr><td>&nbsp;</td></tr>\n';
    if (editableProject) {
        s += '<tr valign="top"><td>Start&nbsp;Mode</td><td colspan=3><select id="projectstartmodedropdown" style="width:390px" onchange="onProjectInitialModeChange(this.value)">\n';
        for (let i = 0; i < gameSource.modes.length; ++i) {
            const mode = gameSource.modes[i];
            if (! mode.name.startsWith('quad://console/os/_') && ! mode.name.startsWith('$')) {
                s += `<option value=${mode.name} ${mode.name === gameSource.json.start_mode ? 'selected' : ''}>${mode.name}</option>\n`;
            }
        }
        s += '</select></td></tr>\n';

        const overrideInitialMode = gameSource.debug && gameSource.debug.json && gameSource.debug.json.start_mode_enabled && gameSource.debug.json.start_mode;
        s += `<tr valign="top"><td></td><td><label><input id="projectdebugstartmodeoverridecheckbox" type="checkbox" autocomplete="false" style="margin-left:0" ${overrideInitialMode ? 'checked' : ''} onchange="onDebugInitialModeOverrideChange(this)">Debug&nbsp;Override</label></td><td colspan=2"><select id="debugOverrideInitialMode" style="width:205px; top:-2px" ${overrideInitialMode ? '' : 'disabled'} onchange="onProjectDebugInitialModeChange(this.value)">\n`;
        for (let i = 0; i < gameSource.modes.length; ++i) {
            const mode = gameSource.modes[i];
            if (! mode.name.startsWith('quad://console/os/_') && ! mode.name.startsWith('$')) {
                s += `<option value=${mode.name} ${(gameSource.debug.json && (mode.name === gameSource.debug.json.start_mode)) ? 'selected' : ''}>${mode.name}</option>\n`;
            }
        }
        s += '</select></td></tr>\n';
        
        s += `<tr valign="top"><td>Screen&nbsp;Size</td><td colspan=3><select id="projectscreensizedropdown" style="width:390px" onchange="onProjectScreenSizeChange(this)">`;
        for (let i = 0; i < allowedScreenSizes.length; ++i) {
            const W = allowedScreenSizes[i].x, H = allowedScreenSizes[i].y;
            s += `<option value='{"x":${W},"y":${H}}' ${W === gameSource.extendedJSON.screen_size.x && H === gameSource.extendedJSON.screen_size.y ? "selected" : ""}>${W} × ${H}${W === 384 && H === 224 ? ' ✜' : ''}</option>`;
        }
        s += `</select></td></tr>\n`;
    } else {
        // The disabled select box is too hard to read, so revert to a text box when not editable
        for (let i = 0; i < gameSource.modes.length; ++i) {
            const mode = gameSource.modes[i];
            if (! mode.name.startsWith('quad://console/os/_') && (mode.name === gameSource.json.start_mode)) {
                s += `<tr valign="top"><td>Initial&nbsp;Mode</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} value="${mode.name.replace(/\*/g, '')}"></td></tr>\n`;
                break;
            }
        }
        s += `<tr valign="top"><td>Screen&nbsp;Size</td><td colspan=3><input id="projectscreensizetextbox" type="text" autocomplete="false" style="width:384px" ${disabled} value="${gameSource.extendedJSON.screen_size.x} × ${gameSource.extendedJSON.screen_size.y}"></td></tr>\n`;
    }
    s += `<tr valign="top"><td></td><td colspan=3><label><input id="projectyupcheckbox" type="checkbox" autocomplete="false" style="margin-left:0" ${disabled} ${game.y_up ? 'checked' : ''} onchange="onProjectYUpChange(this)">Y-Axis = Up</label></td></tr>\n`;

    s += '<tr><td>&nbsp;</td></tr>\n';
    s += `<tr valign="top"><td>I/O</td><td colspan=4><label><input id="projectdualdpadcheckbox" type="checkbox" autocomplete="false" style="margin-left:0" ${disabled} ${game.dual_dpad ? 'checked' : ''} onchange="onProjectDualDPadChange(this)">Dual D-Pad</label>  <label><input id="projectmidicheckbox" type="checkbox" autocomplete=false ${disabled} ${game.midi_sysex ? 'checked' : ''} onchange="onProjectMIDISysexChange(this)" style="margin-left: 50px" tooltip="Does this game send MIDI sysex messages?">MIDI Sysex Output</label></td></tr>\n`;
    s += '<tr><td>&nbsp;</td></tr>\n';
    
    s += `<tr valign="top"><td>Description<br><span id="projectDescriptionLength">(${(game.description || '').length}/100 chars)</span> </td><td colspan=3><textarea ${disabled} style="width:384px; padding: 3px; margin-bottom:-3px; font-family: Helvetica, Arial; font-size:12px" rows=2 id="projectDescription" onchange="onProjectMetadataChanged(this)" oninput="document.getElementById('projectDescriptionLength').innerHTML = '(' + this.value.length + '/100 chars)'">${game.description || ''}</textarea>`;
    s += '<tr valign="top"><td>Features</td><td colspan=3>';
    const boolFields = ['Cooperative', 'Competitive', 'High Scores', 'Achievements'];
    for (let f = 0; f < boolFields.length; ++f) {
        const name = boolFields[f];
        const field = name.replace(/ /g,'').toLowerCase();
        s += `<label><input ${disabled} type="checkbox" id="project${capitalize(field)}" onchange="onProjectMetadataChanged(this)" ${game[field] ? 'checked' : ''}>${name}</label> `;
    }
    s += '</td></tr>\n';
    s += `<tr><td></td><td><input type="number" min="1" max="8" ${disabled} onchange="onProjectMetadataChanged(this)" id="projectMinPlayers" value="${game.min_players || 1}"></input> - <input type="number" min="1" max="8" ${disabled} onchange="onProjectMetadataChanged(this)" id="projectMaxPlayers" value=${game.max_players || 1}></input> Players</td></tr>\n`;
    s += '<tr><td>&nbsp;</td></tr>\n';

    s += `<tr valign="top"><td>Screenshot&nbsp;Tag</td><td colspan=3><input type="text" autocomplete="false" style="width:384px" ${disabled} onchange="onProjectMetadataChanged()" id="screenshotTag" value="${game.screenshot_tag.replace(/"/g, '\\"')}"></td></tr>\n`;
    if (editableProject) {
        const overrideTag = gameSource.debug.json && gameSource.debug.json.screenshot_tag_enabled;
        s += `<tr><td></td><td><label><input id="projectscreenshottag" type="checkbox" autocomplete="false" style="margin-left:0" ${overrideTag ? 'checked' : ''} onchange="onDebugScreenshotTagOverrideChange(this)">Debug&nbsp;Override</label></td><td colspan=2><input type="text" autocomplete="false" style="width:198px" ${overrideTag ? '' : 'disabled'} ${disabled} onchange="onProjectMetadataChanged()" id="debugScreenshotTag" value="${(game.debug && game.debug.json && game.debug.json.screenshot_tag !== undefined) ? game.debug.json.screenshot_tag.replace(/"/g, '\\"') : ''}"></td></tr>`;
    }
    s += '<tr><td>&nbsp;</td></tr>\n';
        
    
    const baseURL = url.replace(/\/[^\/]*$/, '');
    s += '<tr valign="top">';
    s += '<td>Label&nbsp;Icons</td><td style="text-align:left">128px&nbsp;&times;&nbsp;128px<br><img alt="label128.png" src="' + baseURL + '/label128.png?" style="border:1px solid #fff; image-rendering: crisp-edges; image-rendering: pixelated; width:128px; height:128px"></td>';
    s += '<td></td><td style="text-align:left">64px&nbsp;&times;&nbsp;64px<br><img alt="label64.png" src="' + baseURL + '/label64.png?" style="border:1px solid #fff; image-rendering: crisp-edges; image-rendering: pixelated; width:64px; height:64px"></td>';
    s += '</tr>\n<tr><td></td><td colspan=3><i>Press Shift+F6 in game to capture <code>label64.png</code> and <code>label128.png</code> templates. Press shift+f8 to capture the <code>preview.png</code> animation.</i></td></tr><tr><td><br/><br/></td></tr>\n';
    s += '</table>';
    gameEditor.innerHTML = s;
}


function visualizeMap(map) {
    const width  = map.length;
    const height = map[0].length;
    const depth  = map.layer.length;

    // Scale to fit on screen
    const maxDim = Math.max(width * map.sprite_size.x, height * map.sprite_size.y);
    const reduce = (maxDim > 4096) ? 4 : (maxDim > 2048) ? 3 : (maxDim > 1024) ? 2 : 1;

    // Size of destination tiles
    const dstTileX = Math.max(1, Math.floor(map.sprite_size.x / reduce));
    const dstTileY = Math.max(1, Math.floor(map.sprite_size.y / reduce));

    const canvas  = document.getElementById('mapDisplayCanvas');
    canvas.width  = width  * dstTileX;
    canvas.height = height * dstTileY;
    const mapCtx  = canvas.getContext('2d');

    const dstImageData = mapCtx.createImageData(width * dstTileX, height * dstTileY);
    const dstData = new Uint32Array(dstImageData.data.buffer);
    for (let mapZ = 0; mapZ < depth; ++mapZ) {
        const z = map.zScale < 0 ? depth - mapZ - 1 : mapZ;
        for (let mapY = 0; mapY < height; ++mapY) {
            const y = map.$flipYOnLoad ? height - mapY - 1 : mapY;
            for (let mapX = 0; mapX < width; ++mapX) {
                const sprite = map.layer[z][mapX][y];
                if (sprite) {
                    const srcData = sprite.$spritesheet.$uint16Data;
                    const xShift = (sprite.scale.x === -1) ? (sprite.size.x - 1) : 0;
                    const yShift = (sprite.scale.y === -1) ? (sprite.size.y - 1) : 0;
                    const xReduce = reduce * sprite.scale.x;
                    const yReduce = reduce * sprite.scale.y;
                    for (let y = 0; y < dstTileY; ++y) {
                        for (let x = 0; x < dstTileX; ++x) {
                            const srcOffset = (sprite.$x + x * xReduce + xShift) + (sprite.$y + y * yReduce + yShift) * srcData.width;
                            const dstOffset = (x + mapX * dstTileX) + (y + mapY * dstTileY) * dstImageData.width;
                            const srcValue = srcData[srcOffset];
                            if ((srcValue >>> 12) > 7) { // Alpha test
                                dstData[dstOffset] =
                                    0xff000000 +
                                    (((srcValue & 0xf00) + ((srcValue & 0xf00) << 4)) << 8) +
                                    (((srcValue & 0xf0) + ((srcValue & 0xf0) << 4)) << 4) +
                                    (srcValue & 0xf) + ((srcValue & 0xf) << 4);
                            }
                        } // x
                    } // y
                } // sprite
            } // x
        } // y
    } // z

    // Draw dotted grid lines
    for (let mapX = 0; mapX < width; ++mapX) {
        const x = mapX * dstTileX;
        for (let y = 0; y < dstImageData.height; ++y) {
            dstData[x + y * dstImageData.width] = (y & 1) ? 0xffcccccc : 0xff777777
        }
    }

    for (let mapY = 0; mapY < height; ++mapY) {
        const y = mapY * dstTileY;
        for (let x = 0; x < dstImageData.width; ++x) {
            dstData[x + y * dstImageData.width] = (x & 1) ? 0xffcccccc : 0xff777777
        }
    }

    mapCtx.putImageData(dstImageData, 0, 0);
}

{
    const text = document.getElementById('newModeName');
    text.onkeydown = function (event) {
        if (event.keyCode === 13) {
            onNewModeCreate();
        } else if (event.keyCode === 27) {
            hideNewModeDialog();
        }
    }
}


/** Creates the left-hand project listing from the gameSource. Requires useIDE = true */
function createProjectWindow(gameSource) {
    console.assert(useIDE);
    let s = '';
    {
        const badge = isBuiltIn(gameSource.jsonURL) ? 'builtin' : (isRemote(gameSource.jsonURL) ? 'remote' : '');
        s += `<b title="${gameSource.extendedJSON.title} (${gameSource.jsonURL})" onclick="onProjectSelect(event.target, 'game', null)" class="clickable projectTitle ${badge}">${gameSource.extendedJSON.title}</b>`;
    }

    s += '<div style="border-left: 1px solid #ccc; margin-left: 4px; padding-top: 5px; padding-bottom: 9px; margin-bottom: -7px"><div style="margin:0; margin-left: -2px; padding:0">';

    s += '— <i>Scripts</i>\n';
    s += '<ul class="scripts">';
    for (let i = 0; i < gameSource.scripts.length; ++i) {
        const script = gameSource.scripts[i];
        if (! /\/console\/(os|launcher)\/_[A-Za-z0-9_]+\.pyxl$/.test(script)) {
            const badge = isBuiltIn(script) ? 'builtin' : (isRemote(script) ? 'remote' : '');
            const contextMenu = editableProject ? `oncontextmenu="showScriptContextMenu('${script}')" ` : '';
            s += `<li class="clickable ${badge}" ${contextMenu} onclick="onProjectSelect(event.target, 'script', '${script}')" title="${script}" id="ScriptItem_${script}">${urlFilename(script).replace('.pyxl', '')}</li>\n`;
        }
    }
    if (editableProject) {
        s += '<li class="clickable import" onclick="showImportScriptDialog()"><i>Import existing script…</i></li>';
        s += '<li class="clickable new" onclick="showNewScriptDialog()"><i>Create new script…</i></li>';
    }
    s += '</ul>';
    
    s += '— <i class="clickable" onclick="onProjectSelect(event.target, \'mode\', undefined)" title="View mode diagram">Modes</i>\n';
    s += '<ul class="modes">';
    for (let i = 0; i < gameSource.modes.length; ++i) {
        const mode = gameSource.modes[i];
        // Hide system modes
        if (/^.*\/_|^_|^\$/.test(mode.name)) { continue; }
        const badge = isBuiltIn(mode.url) ? 'builtin' : (isRemote(mode.url) ? 'remote' : '');
        const contextMenu = editableProject ? `oncontextmenu="showModeContextMenu(gameSource.modes[${i}])"` : '';
        s += `<li ${contextMenu} class="clickable ${badge}" onclick="onProjectSelect(event.target, 'mode', gameSource.modes[${i}])" title="${mode.url}" id="ModeItem_${mode.name}"><code>${mode.name}${mode.name === gameSource.json.start_mode ? '*' : ''}</code></li>\n`;
    }
    if (editableProject) {
        s += '<li class="clickable import" onclick="showImportModeDialog()"><i>Import existing mode…</i></li>';
        s += '<li class="clickable new" onclick="showNewModeDialog()"><i>Create new mode…</i></li>';
    }
    s += '</ul>';

    s += '— <i>Docs</i>\n';
    s += '<ul class="docs">';
    {
        for (let i = 0; i < gameSource.docs.length; ++i) {
            const doc = gameSource.docs[i];
            const badge = isBuiltIn(doc) ? 'builtin' : (isRemote(doc) ? 'remote' : '');
            const contextMenu = editableProject ? `oncontextmenu="showDocContextMenu('${doc}')" ` : '';
            s += `<li class="clickable ${badge}" ${contextMenu} id="DocItem_${doc}" onclick="onProjectSelect(event.target, 'doc', '${doc}')" title="${doc}"><code>${doc.replace(/^.*\//, '')}</code></li>\n`;
        }
    }
    if (editableProject) {
        s += '<li class="clickable import" onclick="showImportDocDialog()"><i>Import existing doc…</i></li>';
        s += '<li class="clickable new" onclick="showNewDocDialog()"><i>Create new doc…</i></li>';
    }
    s += '</ul>';
    
    s += '— <i class="clickable" onclick="onProjectSelect(event.target, \'constant\', undefined)" title="View all constants">Constants</i>\n';
    s += '<ul class="constants">';
    {
        const keys = Object.keys(gameSource.extendedJSON.constants || {});
        keys.sort();
        const badge = isBuiltIn(gameSource.jsonURL) ? 'builtin' : (isRemote(gameSource.jsonURL) ? 'remote' : '');
        for (let i = 0; i < keys.length; ++i) {
            const c = keys[i];
            const v = gameSource.constants[c];
            const json = gameSource.extendedJSON.constants[c];
            let tooltip = (json.description || '').replace(/"/g, '\\"');
            if (tooltip.length > 0) { tooltip = ': ' + tooltip; }
            
            const cssclass =
                  (v === undefined || v === null) ? 'nil' :
                  (json.type === 'table') ? 'table' :
                  (json.type === 'xy' || json.type === 'xz') ? 'vec2D' :
                  (json.type === 'xyz') ? 'vec3D' :
                  (json.type === 'rgba' || json.type === 'rgb' || json.type === 'hsva' || json.type === 'hsv') ? 'color' :
                  (json.type === 'reference') ? 'reference' :
                  (json.type === 'distribution') ? 'distribution' :
                  Array.isArray(v) ? 'array' :
                  (typeof v);

            const contextMenu = editableProject ? `oncontextmenu="showConstantContextMenu('${c}')"` : '';

            // Add and then pad with enough space to extend into the hidden scrollbar area
            s += `<li ${contextMenu} class="clickable ${badge} ${cssclass}" title="${c}${tooltip}" id="projectConstant_${c}" onclick="onProjectSelect(event.target, 'constant', '${c}')"><code>${c}</code>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</li>\n`;
        }
    }
    if (editableProject) {
        s += '<li class="clickable new" onclick="showNewConstantDialog()"><i>New constant…</i></li>';
    }
    s += '</ul>';

    s += '</div></div>';

    s += '<div style="margin-left: 3px; position: relative; top: -2px">— <i>Assets</i>\n';

    // Leave a lot of space at the bottom for the git buttons
    s += '<ul class="assets" style="margin-bottom: 36px">';
    {
        const keys = Object.keys(gameSource.assets);
        keys.sort();
        for (let i = 0; i < keys.length; ++i) {
            const assetName = keys[i];

            // Hide system assets
            if (assetName[0] === '$') { continue; }

            const asset = gameSource.assets[assetName];
            let type = asset.$jsonURL.match(/\.([^.]+)\.json$/i);
            if (type) { type = type[1].toLowerCase(); }

            const badge = isBuiltIn(asset.$jsonURL) ? 'builtin' : (isRemote(asset.$jsonURL) ? 'remote' : '');
                
            const contextMenu = editableProject ? `oncontextmenu="showAssetContextMenu('${assetName}')"` : '';
            s += `<li id="projectAsset_${assetName}" ${contextMenu} onclick="onProjectSelect(event.target, 'asset', gameSource.assets['${assetName}'])" class="clickable ${type} ${badge}" title="${assetName} (${asset.$jsonURL})"><code>${assetName}</code>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</li>`;

            if (type === 'map') {
                for (let k in asset.spritesheet_table) {
                    const badge = isBuiltIn(asset.spritesheet_table[k].$jsonURL) ? 'builtin' : (isRemote(asset.spritesheet_table[k].$jsonURL) ? 'remote' : '');
                    s += `<ul><li id="projectAsset_${assetName}.${k}" onclick="onProjectSelect(event.target, 'asset', gameSource.assets['${assetName}'].spritesheet_table['${k}'])" class="clickable sprite ${badge}" title="${k} (${asset.spritesheet_table[k].$jsonURL})"><code>${k}</code></li></ul>\n`;
                }
            }
        } // for each asset
    }
    
    if (editableProject) {
        s += '<li class="clickable import" onclick="showImportAssetDialog()"><i>Import existing asset…</i></li>';
        s += '<li class="clickable new" onclick="showNewAssetDialog()"><i>Create new asset…</i></li>';
    }
    s += '</ul>';
    s += '</div>'

    let versionControl = '';
    if (editableProject && serverConfig.hasGit) {
        // Will be hidden and shown elsewhere
        versionControl += `<div id="versionControl" style="visibility: hidden"><button style="width: 100%" title="Sync your local files with the git server" onclick="runPendingSaveCallbacksImmediately(); setTimeout(onGitSync);">Sync Git</button></div>`;
    }
    
    // Build the project list for the IDE
    const projectElement = document.getElementById('project');

    // Hide the scrollbars
    projectElement.innerHTML = `<div class="hideScrollBars" style="top: 0px; bottom: 40px; position: absolute; ${versionControl !== '' ? 'bottom: 40px' : ''}">` + s + '</div>' + versionControl;
}



function onUpdateClick(installedVersionText, latestVersionText) {
    onStopButton();

    showConfirmDialog(
        'Update',
        'Update from quadplay✜ version ' + installedVersionText + ' to version ' + latestVersionText + '?',
        doUpdate);
}

/* Requires useIDE = true */
function doUpdate() {
    console.assert(useIDE);
    onStopButton();
    // Display a downloading window
    document.getElementById('updateDialog').classList.remove('hidden');

    // Tell the server to update (it will choose the right mechanism)
    postToServer({command: 'update'})

    // Start polling for when the server finishes updating
    const checker = setInterval(function () {
        const progressURL = location.origin + getQuadPath() + 'console/_update_progress.json';

        fetch(progressURL).
            then(response => response.json()).
            then(json => {
                if (json.done) {
                    clearInterval(checker);
                    if (json.restartServer) {
                        postToServer({command: 'quit'});

                        showAlertDialog(
                            'Update',
                            'Update complete. quadplay✜ needs to be restarted after this update.',
                            function () {
                                window.close();
                                location = 'about:blank';
                            },
                            noop,
                            'Restart');
                    } else {
                        showAlertDialog('Update', 'Update complete!', function () {
                            // Refresh, also forcing clean reload on Firefox
                            location.reload(true);
                        });
                    }
                }
            });
    }, 1000);
}
