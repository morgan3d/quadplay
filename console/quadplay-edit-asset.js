"use strict";

let addAssetFiles = null;
function showAddAssetDialog() {
    document.getElementById('addAssetDialog').classList.remove('hidden');
    document.getElementById('addAssetAddButton').disabled = true;
    const text = document.getElementById('addAssetName');
    text.value = '';
    text.focus();

    const assetListURL = location.origin + getQuadPath() + 'console/_assets.json?gamePath=' + getGamePath();
    
    // Fetch the asset list
    LoadManager.fetchOne({forceReload: true}, assetListURL, 'json', null, function (json) {
        addAssetFiles = json;

        // Strip the path to the current game off assets in the same dir
        // or subdirectory of it. We do not do this on the server side
        // because we may later allow developers to have their own asset directories
        // separate from games, and the existing protocol allows that.

        let gamePath = gameSource.jsonURL.replace(/[^\/]+\.game\.json$/g, '');
        if (gamePath.startsWith(location.origin)) {
            gamePath = gamePath.substring(location.origin.length);
        }
        if (gamePath.length > 0 && gamePath[0] === '/') {
            gamePath = gamePath.substring(1);
        }
        
        for (const key in addAssetFiles) {
            const array = addAssetFiles[key];
            for (let i = 0; i < array.length; ++i) {
                const url = array[i];
                if (url.startsWith(gamePath)) {
                    array[i] = url.substring(gamePath.length);
                }
            }
        }

        // Create the initial display
        onAddAssetTypeChange();
    });
}


/* Called to regenerate the addAssetList display for the add asset dialog
   when the type of asset to be added is changed by the user. */
function onAddAssetTypeChange() {
    const t = document.getElementById('addAssetType').value;
    let s = '<ol id="addAssetListOL" class="select-list">\n';
    if (addAssetFiles) {
        const fileArray = addAssetFiles[t];
        for (let i = 0; i < fileArray.length; ++i) {
            const file = fileArray[i];
            const path = (file.indexOf('/') === -1) ? '' : file.replace(/\/[^\/]+$/, '/');
            const rest = file.replace(/^.*\//, '');
            const base = rest.replace(/\..+?$/, '');
            const ext  = rest.replace(/^[^\.]+/, '');
            s += `<li onclick="onAddAssetListSelect(this)">${path}<b style="color:#000">${base}</b>${ext}</li>\n`;
        }
    }
    s += '</ol>';

    const list = document.getElementById('addAssetList');
    list.innerHTML = s;

    addAssetFiles.selected = null;
    // Recreating the list destroys any selection
    document.getElementById('addAssetAddButton').disabled = true;
}


function suggestedAssetFilename(url, suffix) {
    // Remove extension
    url = url.replace(/\..*$/, '');

    // Remove prefix
    url = url.replace(/^.*\//, '');

    // Spaces (!) and punctuation to underscores
    url = url.replace(/[+\- ,\(\)\[\]\$]/g, '_');

    // Remove dimension specifications
    url = url.replace(/_\d+x\d+/g, '');

    // Remove leading underscore or number
    url = url.replace(/^[0-9_]+/, '');

    // Remove 'kenny_', 'dawnlike_', or 'dawnbringer_'
    url = url.replace(/^(kenney|dawnbringer|dawnlike)_/, '');

    return url + (suffix || '');
}


/* Called from the "Add" button */
function onAddAssetAdd() {
    const nameBox = document.getElementById('addAssetName');
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
        if ((key[0] !== '_') && (value === addAssetFiles.selected)) {
            if (window.confirm('The asset ' + addAssetFiles.selected + ' is already in your game, called ' + key + '. Add the same asset again anyway?')) {
                // The user accepted...go along with it
                break;
            } else {
                return;
            }
        }
    }

    const url = addAssetFiles.selected;
    hideAddAssetDialog();

    if (url.endsWith('.png') ||
        url.endsWith('.tmx') ||
        url.endsWith('.mp3')) {
        // Handle raw assets
        
        const rawName = url;
        const type = document.getElementById('addAssetType').value;
        const jsonBase = rawName.replace(/\..*$/, '.' + type + '.json');
        const jsonAbsoluteURL = makeURLRelativeToGame(jsonBase);

        const json = {
            'url': rawName,
            'license': 'TODO'
        };
        
        if (type === 'map') {
            json.sprite_url_table = {'todo': 'todo'};
        }

        gameSource.json.assets[name] = jsonBase;

        // Save the new JSON file, and then reload the game
        serverWriteFile(jsonAbsoluteURL, 'utf8', WorkJSON.stringify(json, undefined, 4), function () {
            serverSaveGameJSON(function () { loadGameIntoIDE(window.gameURL, null, true); });
        });
    } else {
        gameSource.json.assets[name] = url;
    
        // Save and reload the game
        serverSaveGameJSON(function () { loadGameIntoIDE(window.gameURL, null, true); });
    }
}


function onAddAssetListSelect(target) {
    const list = document.getElementById('addAssetListOL');
    for (let i = 0; i < list.children.length; ++i) {
        list.children[i].classList.remove('selected');
    }
    target.classList.add('selected');
    addAssetFiles.selected = target.innerText;

    const addAssetName = document.getElementById('addAssetName');
    if (addAssetName.value.length === 0) {
        const type = document.getElementById('addAssetType').value;
        addAssetName.value = suggestedAssetFilename(addAssetFiles.selected, '_' + type);
    }
    
    document.getElementById('addAssetAddButton').disabled = (addAssetName.value.length === 0);
}


function hideAddAssetDialog() {
    document.getElementById('addAssetDialog').classList.add('hidden');
    addAssetFiles = null;
}

/////////////////////////////////////////////////////////////////////////////////////////////////////


function showNewAssetDialog() {
    document.getElementById('newAssetDialog').classList.remove('hidden');
    document.getElementById('newAssetCreateButton').disabled = true;
    const text = document.getElementById('newAssetName');
    text.value = '';
    text.focus();
}

function onNewAssetTypeChange() {
    const type = document.getElementById('newAssetType').value.toLowerCase();
    document.getElementById('newAssetSuffix').innerHTML = '_' + type;
}


function onNewAssetCreate() {
    const type = document.getElementById('newAssetType').value.toLowerCase();
    const nameBox = document.getElementById('newAssetName');
    const fileName = nameBox.value;
    const assetName = fileName + '_' + type;

    // Warn on overwrite
    if ((gameSource.json.assets[assetName] !== undefined) &&
        ! window.confirm(`There is already an asset called ${name} in your game. Replace it?`)) {
        nameBox.focus();
        return;
    }

    // Add the new name to the game
    gameSource.json.assets[assetName] = fileName + '.' + type + '.json';

    let gamePath = getGamePath();

    switch (type) {
    case 'sprite':
        createNewAssetFromTemplate(assetName, gamePath, fileName, type, 'png', 'sprite-32x32');
        break;

    case 'sound':
        createNewAssetFromTemplate(assetName, gamePath, fileName, type, 'mp3', 'sound');
        break;
    }

    hideNewAssetDialog();
}



function createNewAssetFromTemplate(assetName, gamePath, fileName, type, binaryType, templateName) {
    let assetJSONText;
    let assetBits;
    
    // Create from the template and write to disk
    // Load the template JSON and PNG
    const templateLoadManager = new LoadManager({
        callback: function() {
            // Copy the template
            serverWriteFiles(
                [{filename: gamePath + fileName + '.' + type + '.json', contents: assetJSONText, encoding: 'utf8'},
                 {filename: gamePath + fileName + '.' + binaryType, contents: assetBits, encoding: 'binary'}],
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
    templateLoadManager.fetch(makeURLAbsolute('', 'quad://console/templates/' + templateName + '.' + type + '.json'), 'text', null, function (data) {
        assetJSONText = data.replace('"' + templateName + '.' + binaryType + '"', '"' + fileName + '.' + binaryType + '"');
    });
    
    templateLoadManager.fetch(makeURLAbsolute('', 'quad://console/templates/' + templateName + '.' + binaryType), 'arraybuffer', null, function (data) {
        assetBits = data;
    });

    templateLoadManager.end();
}


function hideNewAssetDialog() {
    document.getElementById('newAssetDialog').classList.add('hidden');
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



function onOpenAssetExternally(appName, assetName) {
    // Assumes that the asset was local and not built-in
    const url = gameSource.assets[assetName]._sourceURL || gameSource.assets[assetName]._url;
    const filename = serverConfig.rootPath + urlToFilename(url);
    postToServer({command: 'open',
                  app: appName,
                  file: filename});
}



function showAssetContextMenu(assetName) {
    const getElement = `document.getElementById('projectAsset_${assetName}')`;

    let externalCmds = '';
    if (gameSource.assets) {
        const url = gameSource.assets[assetName]._sourceURL || gameSource.assets[assetName]._url;
        if (! isRemote(url) && !isBuiltIn(url)) {
            if (serverConfig.hasFinder) {
                externalCmds += `<div onmousedown="onOpenAssetExternally('<finder>', '${assetName}')">Show in ${isApple ? 'Finder' : 'Explorer'}</div>`;
            }

            const ext = url.split('.').pop();
            const list = serverConfig.applications;
            if (list) {
                for (let i = 0; i < list.length; ++i) {
                    if (list[i].types.indexOf(ext) !== -1) {
                        externalCmds += `<div onmousedown="onOpenAssetExternally('${list[i].path}', '${assetName}')">Open ${ext.toUpperCase()} with ${list[i].name}</div>`;
                    }
                }
            }

            if (externalCmds.length > 0) {
                externalCmds = '<hr>' + externalCmds;
            }
        }    
    }
          
    customContextMenu.innerHTML =
        `<div onmousedown="onProjectSelect(${getElement}, 'asset', gameSource.assets['${assetName}'])">Inspect</div>
        <div onmousedown="onRenameAsset('${assetName}')">Rename&hellip;</div>` +
        externalCmds + 
        `<hr><div onmousedown="onRemoveAsset('${assetName}')"><span style="margin-left:-18px; width:18px; display:inline-block; text-align:center">&times;</span>Remove '${assetName}'</div>`;
    showContextMenu();
}
