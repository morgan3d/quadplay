"use strict";

let importAssetFiles = null;
function showImportAssetDialog() {
    document.getElementById('importAssetDialog').classList.remove('hidden');
    document.getElementById('importAssetImportButton').disabled = true;
    document.getElementById('importAssetFilter').value = '';
    const text = document.getElementById('importAssetName');
    text.value = '';
    text.focus();

    fetchAssetTable(function (table) {
        importAssetFiles = table;

        // Create the initial display
        onImportAssetTypeChange();
    });
}


/** Requests the list of all assets from the server and then runs
    callback(table) on a table mapping asset types to arrays of URLS) */
function fetchAssetTable(callback) {
    let gamePath = getGamePath();
    const assetListURL = location.origin + getQuadPath() + 'console/_assets.json?gamePath=' + gamePath;
    
    // Fetch the asset list
    LoadManager.fetchOne({forceReload: true}, assetListURL, 'json', null, function (json) {
        // Strip the path to the current game off assets in the same dir
        // or subdirectory of it. We do not do this on the server side
        // because we may later allow developers to have their own asset directories
        // separate from games, and the existing protocol allows that.
        if (gamePath.length > 0 && gamePath[0] === '/') {
            gamePath = gamePath.substring(1);
        }

        for (const key in json) {
            const array = json[key];
            for (let i = 0; i < array.length; ++i) {
                const url = array[i];
                if (url.startsWith(gamePath)) {
                    array[i] = url.substring(gamePath.length);
                }
            }
        }

        callback(json);
    });
}


/* Called to regenerate the importAssetList display for the add asset dialog
   when the type of asset to be added is changed by the user. */
function onImportAssetTypeChange() {
    const t = document.getElementById('importAssetType').value;
    let s = '<ol id="importAssetListOL" class="select-list">\n';
    if (importAssetFiles) {
        const fileArray = importAssetFiles[t];
        for (let i = 0; i < fileArray.length; ++i) {
            const file = fileArray[i];
            const path = (file.indexOf('/') === -1) ? '' : file.replace(/\/[^\/]+$/, '/');
            const rest = file.replace(/^.*\//, '');
            const base = rest.replace(/\..+?$/, '');
            const ext  = rest.replace(/^[^\.]+/, '');
            s += `<li onclick="onImportAssetListSelect(this)">${path}<b style="color:#000">${base}</b>${ext}</li>\n`;
        }
    }
    s += '</ol>';

    const list = document.getElementById('importAssetList');
    list.innerHTML = s;

    onImportAssetFilterChange();

    importAssetFiles.selected = null;
    // Recreating the list destroys any selection
    document.getElementById('importAssetImportButton').disabled = true;

    // Clear the preview
    onImportAssetPreview();
}


function onImportAssetFilterChange() {
    const filter = document.getElementById('importAssetFilter').value.trim().toLowerCase();
    const list = document.querySelectorAll('#importAssetListOL li');
    for (let i = 0; i < list.length; ++i) {
        const element = list[i];
        element.style.display = (filter === '') || (element.innerText.toLowerCase().indexOf(filter) !== -1) ? '' : 'none';
    }
}


function suggestedAssetVariableName(url, suffix) {
    // Remove extensions
    url = url.replace(/\..*$/, '');

    // Remove prefix
    url = url.replace(/^.*\//, '');

    // Spaces and punctuation to underscores
    url = url.replace(/[+\- ,\(\)\[\]\$]/g, '_');

    // Remove dimension specifications
    url = url.replace(/_\d+x\d+/g, '');

    // Remove leading underscore or number
    url = url.replace(/^[0-9_]+/, '');

    // Remove 'kenny_', 'dawnlike_', or 'dawnbringer_'
    url = url.replace(/^(kenney|dawnbringer|dawnlike)_/, '');

    if (! url.match(/^[_a-zA-Z]/)) {
        // Make a legal variable name
        url = (suffix || 'x')[0] + url;
    }

    return url + (suffix || '');
}


/* Called from the "Import" button */
function onImportAssetImport() {
    const nameBox = document.getElementById('importAssetName');
    const name = nameBox.value;

    // Warn on overwrite
    if ((gameSource.json.assets[name] !== undefined) &&
        ! window.confirm('There is already an asset called ' + name +
                         ' in your game. Replace it?')) {
        nameBox.focus();
        return;
    }

    // Warn on double add
    for (const key in gameSource.json.assets) {
        const value = gameSource.json.assets[key];
        if ((key[0] !== '_') && (value === importAssetFiles.selected)) {
            if (window.confirm('The asset ' + importAssetFiles.selected + ' is already in your game, called ' + key + '. Add the same asset again anyway?')) {
                // The user accepted...go along with it
                break;
            } else {
                return;
            }
        }
    }

    const url = importAssetFiles.selected;
    const sourceFiles = importAssetFiles.source;

    if (url.endsWith('.png') ||
        url.endsWith('.tmx') ||
        url.endsWith('.mp3')) {
        // Handle raw assets
        
        const rawName = url;
        const type = document.getElementById('importAssetType').value;
        const jsonBase = rawName.replace(/\..*$/, '.' + type + '.json');
        const jsonAbsoluteURL = makeURLRelativeToGame(jsonBase);

        const json = {
            'url': rawName,
            'license': 'todo'
        };
        
        if (type === 'map') {
            json.sprite_url_table = {'todo': 'todo'};
        } else if (type === 'sprite') {
            // Autdetect source_url for psd, kra, ase, aseprite files
            const baseName = rawName.replace(/\.png$/, '');

            for (const sourceName of sourceFiles) {
                if (baseName === sourceName.replace(/\.(kra|psd|ase|aseprite)$/i, '')) {
                    // Found a source URL
                    json.source_url = sourceName;
                    break;
                }
            }
        }

        gameSource.json.assets[name] = jsonBase;

        // Save the new JSON file, and then reload the game
        serverWriteFile(jsonAbsoluteURL, 'utf8', WorkJSON.stringify(json, undefined, 4), function () {
            serverSaveGameJSON(function () {
                loadGameIntoIDE(window.gameURL, function () {
                    // Show the new object
                    onProjectSelect(document.getElementById('projectAsset_' + name), 'asset', gameSource.assets[name]);
                }, true);
            });
        });
        
    } else {
        // Not a sprite, sound, or map
        
        gameSource.json.assets[name] = url;
    
        // Save and reload the game
        serverSaveGameJSON(function () { loadGameIntoIDE(window.gameURL, null, true); });
    }

    hideImportAssetDialog();
}


function onImportAssetListSelect(target) {
    const list = document.getElementById('importAssetListOL');
    for (let i = 0; i < list.children.length; ++i) {
        list.children[i].classList.remove('selected');
    }
    target.classList.add('selected');
    importAssetFiles.selected = target.innerText;

    onImportAssetPreview(importAssetFiles.selected);

    const importAssetName = document.getElementById('importAssetName');
    if (importAssetName.value.length === 0) {
        const type = document.getElementById('importAssetType').value;
        importAssetName.value = suggestedAssetVariableName(importAssetFiles.selected, (type === 'data') ? '' : '_' + type);
    }
    
    document.getElementById('importAssetImportButton').disabled = (importAssetName.value.length === 0);
}


function hideImportAssetDialog() {
    document.getElementById('importAssetDialog').classList.add('hidden');
    importAssetFiles = null;
}

/////////////////////////////////////////////////////////////////////////////////////////////////////


function showNewAssetDialog() {
    document.getElementById('newAssetDialog').classList.remove('hidden');
    document.getElementById('newAssetCreateButton').disabled = true;
    const text = document.getElementById('newAssetName');
    text.value = '';
    text.focus();
    onNewAssetTypeChange();

    // Remove previous spritesheet options for the map
    const spritesheetDropdown = document.getElementById('newAssetMapSpritesheet');
    spritesheetDropdown.innerHTML = '';
    
    fetchAssetTable(function(table) {
        const array = table.sprite;
        let s = '';
        for (let i = 0; i < array.length; ++i) {
            const url = array[i];
            // Do not show raw PNGs as potential map spritesheets. There
            // are too many issues with not having metadata for them.
            if (! url.endsWith('.png')) {
                s += `<option value="${url}">${url}</option>`;
            }
        }
        spritesheetDropdown.innerHTML = s;
        spritesheetDropdown.dispatchEvent(new Event('change'));
    });
}


function onNewAssetTypeChange() {
    const type = document.getElementById('newAssetType').value.toLowerCase();
    document.getElementById('newAssetSuffix').innerHTML = '_' + type;
    document.getElementById('newAssetMapOptions').style.display = (type === 'map' ? 'block' : 'none');
    if (type === 'map') {
        document.getElementById('newAssetMapYUp').checked = gameSource.json.y_up;
    }
}


function onNewAssetCreate() {
    const type = document.getElementById('newAssetType').value.toLowerCase();
    const nameBox = document.getElementById('newAssetName');
    const fileName = nameBox.value;
    const assetName = fileName + '_' + type;

    const assetCreator = document.getElementById('newAssetCreator').value.trim();
    const assetLicense = document.getElementById('newAssetLicense').value.trim();

    let license = '' + new Date().getFullYear();
    if (/cc0|public domain/i.test(assetLicense)) {
        license = 'By ' + assetCreator + ' ' + license;
    } else {
        license = '©' + license + ' ' + assetCreator;
    }
    license += '. ' + assetLicense;

    // Warn on overwrite
    if ((gameSource.json.assets[assetName] !== undefined) &&
        ! window.confirm(`There is already an asset called ${name} in your game. Replace it?`)) {
        nameBox.focus();
        return;
    }

    // Add the new name to the game
    gameSource.json.assets[assetName] = fileName + '.' + type + '.json';

    const gamePath = getGamePath();
    const dataType = {'sprite': 'png', 'map': 'tmx', 'sound': 'mp3', 'font': 'png'};
    const templateJSONParameters = {
        license: license,
        url: fileName + '.' + dataType[type]
    };

    switch (type) {
    case 'sprite':
        createNewAssetFromTemplate(assetName, gamePath, fileName, type, 'png', templateJSONParameters);
        break;

    case 'sound':
        createNewAssetFromTemplate(assetName, gamePath, fileName, type, 'mp3', templateJSONParameters);
        break;

    case 'map':
        let spriteURL = document.getElementById('newAssetMapSpritesheet').value;

        function makeMap(pngURL, spriteJSON, spriteImage, spriteURL) {
            console.assert(spriteJSON);
            console.assert(spriteImage);

            // Needed for both the TMX and json
            const width   = clamp(readIntFromControl('newAssetMapWidth', 16), 1, 8192);
            const height  = clamp(readIntFromControl('newAssetMapHeight', 16), 1, 8192);
            const layers  = clamp(readIntFromControl('newAssetMapLayers', 1), 1, 8192);
            const yUp     = document.getElementById('newAssetMapYUp').checked;
            const zOffset = readNumberFromControl('newAssetMapZ0', 0);
            const zScale  = readNumberFromControl('newAssetMapZScale', 1);
            
            templateJSONParameters.loop_x = document.getElementById('newAssetMapLoopX').checked;
            templateJSONParameters.loop_y = document.getElementById('newAssetMapLoopY').checked;
            templateJSONParameters.z_offset = zOffset;
            templateJSONParameters.z_scale = zScale;
            templateJSONParameters.y_up = yUp;
            templateJSONParameters.sprite_url = templateJSONParameters.sprite_url2 = spriteURL;
            const spriteSize = spriteJSON.sprite_size || {x: spriteImage.width, y: spriteImage.height};
            
            if (document.getElementById('newAssetMapCenter').checked) {
                templateJSONParameters.offset_x = -spriteSize.x * width / 2;
                templateJSONParameters.offset_y = -spriteSize.y * height / 2;
            } else {
                templateJSONParameters.offset_x = templateJSONParameters.offset_y = 0;
            }
            
            const tmxContents = generateTMX(spriteURL, pngURL, spriteJSON, spriteSize.x, spriteSize.y, width, height, layers, spriteImage.width, spriteImage.height);
            createNewAssetFromTemplate(assetName, gamePath, fileName, type, 'tmx', templateJSONParameters, tmxContents);
        } // makeMap

        const loadOptions = {jsonParser: 'permissive'};
        const cloneSpriteJson = document.getElementById('newAssetMapCloneSpriteJson').checked;
        const cloneSpritePng = document.getElementById('newAssetMapCloneSpritePng').checked && cloneSpriteJson;

        LoadManager.fetchOne(
            loadOptions,
            makeURLAbsolute(window.gameURL, spriteURL),
            'json',
            undefined,
            function (spriteJson, raw, spriteHttpURL) {
                
                // Resolve the PNG's original URL to be relative to the
                // sprite if it is not quad:// absolute.
                let pngURL = spriteJson.url;
                if (! /^[a-z]+:\/\//.test(pngURL) && (spriteURL.indexOf('/') !== -1)) {
                    pngURL = spriteURL.replace(/\/[^/]+$/, '/') + pngURL;
                }

                LoadManager.fetchOne(
                    loadOptions,
                    makeURLAbsolute(spriteHttpURL, spriteJson.url),
                    'image',

                    undefined,
                    
                    function (image) {
                        // Clone sprite and JSON if required before triggering the map creation
                        if (cloneSpriteJson) {
                            // Make the sprite URL relative to the current directory
                            spriteURL = urlFilename(spriteURL);
                            
                            if (cloneSpritePng) {
                                // Put new PNG into the game directory
                                const newPngURL = urlFilename(pngURL);
                                
                                // Copy the original PNG bits (even
                                // though we have already loaded them
                                // as an image, since the PNG loading
                                // never gives us the original bits
                                // and we do not want to re-encode)
                                LoadManager.fetchOne(loadOptions, makeURLAbsolute(spriteHttpURL, pngURL), 'arraybuffer', null, function (pngRawData) {
                                    serverWriteFile(gamePath + newPngURL, 'binary', pngRawData);
                                });
                                
                                pngURL = newPngURL;
                            }
                            
                            // Update the spritesheet with the current pngURL
                            spriteJson.url = pngURL;

                            // Write the modified json
                            serverWriteFile(gamePath + spriteURL, 'utf8',
                                            WorkJSON.stringify(spriteJson, undefined, 4),
                                            function () {
                                                makeMap(pngURL, spriteJson, image, spriteURL);
                                            }, null);
                        } else {
                            // No cloning, use the original image and sprite
                            // urls.
                            makeMap(pngURL, spriteJson, image, spriteURL);
                        }
                    },
                    function (error) { alert(error + ' while loading sprite png for map from ' + pngURL); },
                    undefined, true);
            },
            function (error) { alert(error + ' while loading sprite json for map from ' + spriteURL); },
            undefined, true);
        break;
    }

    hideNewAssetDialog();
}


/** Returns a string that is the contents of a TMX map file. */
function generateTMX(spriteURL, pngURL, spriteJSON, tilewidth, tileheight, layerwidth, layerheight, numlayers, spritesheetwidth, spritesheetheight) {
    const spriteName = spriteURL.replace(/^.*\/([^/]+)\.sprite\.json$/, '$1').replace(/.sprite.json$/, '');
    
    // Path to the PNG. The input is already an absolute URL
    // We need to make the spritePath into a file system path
    // that is relative to the current game or the quadplay install.
    let pngPath = pngURL;

    // This is an absolute URL. We need to make it into a filesystem path.

    const gameRootURL = gameSource.jsonURL.replace(/\/[^\/]*$/, '/');
    if (pngPath.startsWith(gameRootURL)) {
        // This is a relative http:// file, so we can simply tell the
        // TMX that it is relative to the game's own root

        pngPath = pngPath.substring(gameRootURL.length);
        
        // (if it was an *external* http:// URL there is simply
        // nothing we can do, so let it pass through broken)

    } else if (pngPath.startsWith('quad://')) {
        // Quadplay path. Find the relative path from the game to the
        // quadplay install on this machine. This is machine specific
        // (that's a problem with TMX!), but still likely to be robust
        // than an absolute path. A design alternative would be to
        // force copying the sprite into the game directory. Note
        // that the relative path in the TMX only matters for editing
        // the TMX; the game can be played and the game edited without
        // touching the TMX file even if this path is wrong on another
        // machine.

        // pngURL is initially relative to quadpath.  We need to make
        // it relative to mapPath.
        const mapPath = gameURL.replace(/^[a-z]+:\/\/[^/]+\//, '/').replace(/\/[^/]+$/, '/');

        // Make a file system path relative to the web server's root
        pngPath = pngPath.replace(/^quad:\/\//, getQuadPath());

        // Remove the longest common subpath of pngURL and mapPath
        let pngPathArray = pngPath.split('/');
        let mapPathArray = mapPath.split('/');
        console.assert(pngPathArray[0] === '' && mapPathArray[0] === '', 'Both paths must start with /');

        // The pngPathArray contains at least one different element:
        // the final filename, so there's no need to check about going
        // off the end of the array.
        while (pngPathArray[0] === mapPathArray[0]) {
            pngPathArray.shift();
            mapPathArray.shift();
        }

        // For each remaining unique element in mapPathArray, go up
        // one directory to reach that common subpath root
        pngPath = pngPathArray.join('/');
        for (let i = 0; i < mapPathArray.length - 1; ++i) {
            pngPath = '../' + pngPath;
        }
    }

    const columns = Math.floor(spritesheetwidth / tilewidth);
    const tilecount = columns * Math.floor(spritesheetheight / tileheight);
    
    let data = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.4" tiledversion="1.4.3" orientation="orthogonal" renderorder="left-down" width="${layerwidth}" height="${layerheight}" tilewidth="${tilewidth}" tileheight="${tileheight}" infinite="0" nextlayerid="${numlayers + 1}" nextobjectid="1">
 <tileset firstgid="1" name="${spriteName}" tilewidth="${tilewidth}" tileheight="${tileheight}" tilecount="${tilecount}" columns="${columns}">
  <image source="${pngPath}" width="${spritesheetwidth}" height="${spritesheetheight}"/>
 </tileset>
`;

    for (let L = 0; L < numlayers; ++L) {
        data += `<layer id="${L + 1}" name="Tile Layer ${L + 1}" width="${layerwidth}" height="${layerheight}"><data encoding="csv">\n`;
        for (let y = 0; y < layerheight; ++y) {
            for (let x = 0; x < layerwidth; ++x) {
                data += '0,';
            }
            // Remove the trailing ,
            if (y === layerheight - 1) { data = data.substring(0, data.length - 1); }
            data += '\n';
        }
        data += '</data></layer>\n';
    }

    data += '</map>\n';
    return data;
}
    

function readNumberFromControl(controlName, defaultValue) {
    const a = parseFloat(document.getElementById(controlName).value)
    if (! isFinite(a)) {
        return defaultValue === undefined ? 0 : defaultValue;
    } else {
        return a;
    }
}


function readIntFromControl(controlName, defaultValue) {
    const a = parseInt(document.getElementById(controlName).value)
    if (! isFinite(a)) {
        return defaultValue === undefined ? 0 : defaultValue;
    } else {
        return Math.round(a);
    }
}


/* 
   templateParameters is a table. Each key triggers a SINGLE
   replacement in the template of "TODO: key" -> JSON.stringify(value).

   The url property of the template is always replaced, based on the
   assetName.

   If assetData is specified, it is used as the contents of the data
   file (rather than copying a binary file loaded from disk). This is
   how TMX maps are generated.
*/
function createNewAssetFromTemplate(assetName, gamePath, fileName, type, dataType, templateJSONParameters, assetData) {
    const templateName = type;
    let assetJSONText;
    
    // Create from the template and write to disk
    // Load the template JSON and PNG
    const templateLoadManager = new LoadManager({
        callback: function() {
            // Copy the template
            serverWriteFiles(
                [{filename: gamePath + fileName + '.' + type + '.json', contents: assetJSONText, encoding: 'utf8'},
                 {filename: gamePath + fileName + '.' + dataType, contents: assetData, encoding: (typeof assetData === 'string' ? 'utf8' : 'binary')}],
                function () {
                    // Save the game
                    serverSaveGameJSON(function () {
                        // Reload the game
                        loadGameIntoIDE(window.gameURL, function () {
                            // Select the new asset
                            onProjectSelect(document.getElementById('projectAsset_' + assetName), 'asset', gameSource.assets[assetName]);
                        }, true);
                    });
                });
        },
        jsonParser:  'permissive',
        forceReload: false
    });

    // Load the data
    templateLoadManager.fetch(makeURLAbsolute('', 'quad://console/templates/' + templateName + '.' + type + '.json'), 'text', null, function (templateJSONString) {
        assetJSONText = templateJSONString;
        for (let key in templateJSONParameters) {
            const value = templateJSONParameters[key];
            assetJSONText = assetJSONText.replace('"TODO: ' + key + '"', JSON.stringify(value));
        }
    });

    if (assetData === undefined) {
        // Load the data from disk
        templateLoadManager.fetch(makeURLAbsolute('', 'quad://console/templates/' + templateName + '.' + dataType), 'arraybuffer', null, function (data) {
            assetData = data;
        });
    }

    templateLoadManager.end();
}


function hideNewAssetDialog() {
    document.getElementById('newAssetDialog').classList.add('hidden');
}

/////////////////////////////////////////////////////////////////////////////////////////////////////

function onCloneAsset(assetName) {
    document.getElementById('cloneAssetDialog').classList.remove('hidden');

    document.getElementById('cloneAssetSrcName').innerHTML = assetName;

    // Remove any leading slash, which is part of the URL but will
    // confuse a user by looking like an absolute filesystem path
    const gamePath = getGamePath().replace(/^\//, '');
    const srcUrl = gameSource.json.assets[assetName];
    const srcAbsoluteUrl = ((srcUrl.indexOf(':') === -1) ?
                            gamePath : '') + srcUrl;
    
    document.getElementById('cloneAssetSrcUrl').innerHTML = srcAbsoluteUrl;
    
    document.getElementById('cloneAssetDstUrl').innerHTML = gamePath +
        gameSource.json.assets[assetName].replace(/^.*\//, '');
    
    document.getElementById('cloneAssetKeepOriginal').checked = false;
    document.getElementById('cloneAssetNewName').disabled = true;
    document.getElementById('cloneAssetNewName').value = '';
}


function hideCloneAssetDialog() {
    document.getElementById('cloneAssetDialog').classList.add('hidden');
}


function onCloneAssetCreate() {
    // The order of operations in this function is convoluted because
    // it must asynchronously read the asset JSON, and then may need
    // to read the asset data, before it can write.
    
    hideCloneAssetDialog();
    
    const add = document.getElementById('cloneAssetKeepOriginal').checked;

    const srcAssetName = document.getElementById('cloneAssetSrcName').innerHTML;
    const dstAssetName = add ? document.getElementById('cloneAssetNewName').value.replace(/(^_|[^_0-9A-Za-z])/g, '') : srcAssetName;

    const cloneData = document.getElementById('cloneAssetCloneData').checked;

    // Absolute
    const srcAbsoluteUrl = document.getElementById('cloneAssetSrcUrl').innerHTML;

    // Relative to the game
    const dstUrl = document.getElementById('cloneAssetDstUrl').innerHTML.replace(/^.*\//, '');

    // Accumulated after the LoadManager is created
    const filesToWrite = [];

    const cloneLoadManager = new LoadManager({
        callback: function () {
            serverWriteFiles(
                filesToWrite,
                
                function () {
                    // Modify game JSON to reference the new file
                    gameSource.json.assets[dstAssetName] = dstUrl;
                    
                    // Save and reload game JSON
                    serverSaveGameJSON(function () {
                        loadGameIntoIDE(window.gameURL, function () {
                            // Select the renamed asset
                            onProjectSelect(document.getElementById('projectAsset_' + dstAssetName), 'asset', gameSource.assets[dstAssetName]);
                        }, true);
                    });
                }); // write files
        } // load manager callback
    }); // load manager

    // Clone the asset JSON
    cloneLoadManager.fetch(
        srcAbsoluteUrl,
        'text',
        null,
        function (assetJson) {
            const dstAssetUrl = assetJson.url.replace(/^.*\//, '');
            
            // Change the url in the file to be the new relative url for the json
            assetJson.url = dstAssetUrl;

            const dstAbsoluteUrl = getGamePath() + dstUrl;
            
            filesToWrite.push({
                filename: dstAbsoluteUrl,
                contents: assetJson,
                encoding: 'utf8'});

            if (cloneData) {
                let srcAssetAbsoluteUrl = assetJson.url;
                if (srcAssetAbsoluteUrl.indexOf(':') === -1) {
                    // This src asset was specified is relative to the
                    // asset json, so copy over its path prefix
                    srcAssetAbsoluteUrl = srcAbsoluteUrl.replace(/\/[^\/]*$/, '/') + srcAssetAbsoluteUrl;
                }
                
                const dstAssetAbsoluteUrl = getGamePath() + dstAssetUrl;

                // Copy the underlying asset
                cloneLoadManager.fetch(
                    srcAssetAbsoluteUrl,
                    'arraybuffer',
                    null,
                    function (assetData) {
                        filesToWrite.push({
                            filename: dstAssetAbsoluteUrl,
                            contents: assetData,
                            encoding: (typeof assetData === 'string' ? 'utf8' : 'binary')
                        });
                    });
            } // if clone data
        }); // fetch first

    // Start the loading, which will trigger the saving
    cloneLoadManager.end();
}

/////////////////////////////////////////////////////////////////////////////////////////////////////

function onRenameAsset(assetName) {
    let newName;
    while (true) {
        newName = window.prompt("New name for asset '" + assetName + "'", assetName);
        if (! newName || newName === '') { return; }
        
        // Mangle
        newName = newName.replace(/(^_|[^_0-9A-Za-z])/g, '');

        // Check for conflict
        if (gameSource.json.assets[newName]) {
            window.alert("There is already another asset named '" + newName + "'");
        } else if (gameSource.json.constants[newName]) {
            window.alert("There is already a constant named '" + newName + "'");
        } else {

            // Perform the rename
            gameSource.json.assets[newName] = gameSource.json.assets[assetName];
            delete gameSource.json.assets[assetName];
            
            serverSaveGameJSON(function () {
                loadGameIntoIDE(window.gameURL, function () {
                    // Select the renamed asset
                    onProjectSelect(document.getElementById('projectAsset_' + newName), 'asset', gameSource.assets[newName]);
                }, true);
            });
            
            return;
        } // if ok name
    } // while true
}


function onRemoveAsset(key) {
    if (confirm('Remove asset \'' + key + '\' from this project?')) {
        delete gameSource.json.assets[key];
        serverSaveGameJSON(function () {
            loadGameIntoIDE(window.gameURL, null, true);
        });
    }
}


function onOpenUrlExternally(appName, url) {
    // Assumes that the asset was local and not built-in
    const filename = serverConfig.rootPath + urlToLocalWebPath(url);
    postToServer({command: 'open',
                  app: appName,
                  file: filename});
}


function showAssetContextMenu(assetName) {
    const getElement = `document.getElementById('projectAsset_${assetName}')`;

    let allExternalCmds = '';
    if (gameSource.assets) {
        // Process once for the sourceURL and once for the asset URL
        for (let url of [gameSource.assets[assetName].$sourceURL, gameSource.assets[assetName].$url]) {
            if (url && ! isRemote(url) && !isBuiltIn(url)) {
                let externalCmds = '';
                const ext = url.split('.').pop();

                if (serverConfig.hasFinder) {
                    externalCmds += `<div onmousedown="onOpenUrlExternally('<finder>', '${url}')">Show ${ext.toUpperCase()} in ${isApple ? 'Finder' : 'Explorer'}</div>`;
                }

                const list = serverConfig.applications;
                if (list) {
                    for (let i = 0; i < list.length; ++i) {
                        if (list[i].types.indexOf(ext) !== -1) {
                            externalCmds += `<div onmousedown="onOpenUrlExternally('${list[i].path}', '${url}')">Open ${ext.toUpperCase()} with ${list[i].name}</div>`;
                        }
                    }
                }

                if (externalCmds.length > 0) {
                    allExternalCmds += '<hr>' + externalCmds;
                }
            }
        }
    }

    customContextMenu.innerHTML =
        `<div onmousedown="onProjectSelect(${getElement}, 'asset', gameSource.assets['${assetName}'])">Inspect</div>
        <div onmousedown="onRenameAsset('${assetName}')">Rename&hellip;</div>
        <div onmousedown="onCloneAsset('${assetName}')">Clone&hellip;</div>` +
        allExternalCmds + 
        `<hr><div onmousedown="onRemoveAsset('${assetName}')"><span style="margin-left:-18px; width:18px; display:inline-block; text-align:center">&times;</span>Remove '${assetName}'</div>`;
    showContextMenu('project');
}


/////////////////////////////////////////////////////////////////


function showPNGEditor(object, assetName) {
    spriteEditorAsset = object;
    spriteEditorAssetName = assetName;
    const spriteEditor = document.getElementById('spriteEditor');
    
    // Sprite or font
    spriteEditor.selectedAssetName = object.$name;
    spriteEditor.style.visibility = 'visible';

    spriteEditorCanvasShowImage(spriteEditorAsset.$url);
    onSpriteEditorViewChange();
   
    if (object.$type === 'spritesheet') {
        spriteEditorCanvas.onmousemove = spriteEditorCanvas.onmousedown = onSpriteEditorCanvasMouseMove;
        
        document.getElementById('spriteEditorViewSpriteSheetLabel').innerHTML = 'Sprite Sheet';

        // Initialize from the current position
        {
            const canvasBounds = spriteEditorCanvas.getBoundingClientRect();
            spriteEditorCanvas.onmousemove({clientX: canvasBounds.left, clientY: canvasBounds.top});
        }
    } else {
        // Font
        spriteEditorHighlight.style.visibility = 'hidden';
        spriteEditorPivot.style.visibility = 'hidden';
        spriteEditorCanvas.onmousemove = spriteEditorCanvas.onmousedown = undefined;
        document.getElementById('spriteEditorViewSpriteSheetLabel').innerHTML = 'Glyph Sheet';
    }

    onSpriteEditorZoomSliderChange();
}

/**
    Clears the import asset preview and description elements. If called with an empty string or undefined,
    returns immediately after clearing. Otherwise, prepares to update the preview for the given asset URL.
    @param {string=} url The asset URL to preview, or empty/undefined to clear the preview.
*/
function onImportAssetPreview(url) {
    const previewDiv = document.getElementById('importAssetPreview');
    previewDiv.innerHTML = '';
    previewDiv.style.overflow = 'hidden';
    if (! url) {
        return;
    }

    // Sprite JSON preview callback
    function spriteJsonCallback(json, raw, jsonHttpURL) {
        const imgUrl = makeURLAbsolute(jsonHttpURL, json.url);
        let html = `<div class="pixelate" style="width:256px;height:256px;border-radius:5px;border:solid #FFF 1px;background:url('${imgUrl}') center/contain no-repeat #222;margin-bottom:8px;"></div>`;
        if (json.license) {
            html += `<div style="font-size:90%;color:#888;margin-bottom:2px;">${json.license}</div>`;
        } else {
            html += `<div style="font-size:90%;color:#888;margin-bottom:2px;">No license information</div>`;
        }
        if (json.description) {
            html += `<div style="font-size:90%;color:#888;">${json.description}</div>`;
        }
        previewDiv.innerHTML = html;
    }

    // Sound JSON preview callback
    function soundJsonCallback(json, raw, jsonHttpURL) {
        const mp3Url = makeURLAbsolute(jsonHttpURL, json.url);
        let html = `<audio controls style=\"width:100%;margin-bottom:8px;border-radius:5px;\"><source src=\"${mp3Url}\" type=\"audio/mpeg\">Your browser does not support the audio element.</audio>`;
        if (json.license) {
            html += `<div style=\"font-size:90%;color:#888;margin-bottom:2px;\">${json.license}</div>`;
        } else {
            html += `<div style=\"font-size:90%;color:#888;margin-bottom:2px;\">No license information</div>`;
        }
        if (json.description) {
            html += `<div style=\"font-size:90%;color:#888;\">${json.description}</div>`;
        }
        previewDiv.innerHTML = html;
    }

    // Generic JSON pretty-print callback
    function genericJsonCallback(json) {
        previewDiv.innerHTML = `<pre style="font-size:90%;color:#888;text-align:left;max-width:512px;overflow-x:auto;">${JSON.stringify(json, null, 2)}</pre>`;
    }
    
    if (url.endsWith('.json')) {
        const absoluteUrl = makeURLAbsolute(window.gameURL, url);

        // Choose callback based on extension
        let callback;
        if (url.endsWith('.sprite.json')) {
            callback = spriteJsonCallback;
        } else if (url.endsWith('.sound.json')) {
            callback = soundJsonCallback;
        } else if (url.endsWith('.font.json')) {
            callback = spriteJsonCallback;
        } else {
            callback = genericJsonCallback;
        }
        // TODO: implement other asset preview types


        LoadManager.fetchOne(
            {forceReload: true},
            absoluteUrl,
            'json',
            null,
            callback
        );
    }
}
