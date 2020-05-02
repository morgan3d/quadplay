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

    gameSource.json.assets[name] = addAssetFiles.selected;
    hideAddAssetDialog();
    
    // Save and reload the game
    serverSaveGameJSON(function () { loadGameIntoIDE(window.gameURL); });
}


function onAddAssetListSelect(target) {
    const list = document.getElementById('addAssetListOL');
    for (let i = 0; i < list.children.length; ++i) {
        list.children[i].classList.remove('selected');
    }
    target.classList.add('selected');
    addAssetFiles.selected = target.innerText; 
    document.getElementById('addAssetAddButton').disabled = (document.getElementById('addAssetName').value.length === 0);
}


function hideAddAssetDialog() {
    document.getElementById('addAssetDialog').classList.add('hidden');
    addAssetFiles = null;
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
                    onProjectSelect(document.getElementById('projectAsset_' + newName), 'asset', gameSource.assets['${newName}']);
                });
            });
            
            return;
        } // if ok name
    } // while true
}


function onRemoveAsset(key) {
    if (confirm('Remove asset \'' + key + '\' from this project?')) {
        delete gameSource.json.assets[key];
        serverSaveGameJSON(function () {
            loadGameIntoIDE(window.gameURL);
        });
    }
}


function showAssetContextMenu(assetName) {
    const getElement = `document.getElementById('projectAsset_${assetName}')`;
    customContextMenu.innerHTML =
        `<div onmousedown="onProjectSelect(${getElement}, 'asset', gameSource.assets['${assetName}'])">Inspect</div>` +
        `<div onmousedown="onRenameAsset('${assetName}')">Rename&hellip;</div>` +
        `<hr><div onmousedown="onRemoveAsset('${assetName}')">Remove '${assetName}'</div>`;
    showContextMenu();
}
