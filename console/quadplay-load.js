/**
   \file quadplay-load.js
 
   Routines for handling asynchronous loading of the game from URLs.
   The main routine is:

   - `afterLoadGame`

   which schedules loading of the entire game into memory and then
   invokes a callback once all resources have been loaded.

   The following return a usable object immediately while scheduling
   asynchronous work to fill out that object:

   - `loadFont`
   - `loadSound`
   - `loadMap`
   - `loadData`
   - `loadSpritesheet`

   Also exports helpers `parseHexColor` and `parseHex`
*/
"use strict";

const allowedScreenSizes = Object.freeze([
    {x: 640, y: 360},
    {x: 384, y: 224},
    {x: 320, y: 180},
    {x: 192, y: 112},
    {x: 128, y: 128},
    {x:  64, y:  64}]);

// Allocated by afterLoadGame
let loadManager = null;

let lastSpriteID = 0;

{
    // Objects created by quadplay-load.js aren't
    // QRuntime.Object but are window.Object, so
    // we must override toString for them here.
    const $toString = Object.prototype.toString;
    Object.prototype.toString = function () {
        return (this && this.$name) || $toString.call(this);
    };
}

// Type used as the value of a constant that references
// another constant or asset. References are stored with
// this level of indirection so that they do not need to
// be re-evaluated when they reference a primitive value
// that is changed in the debugger. The property may be ''.
function GlobalReference(name, property) { this.identifier = name; this.property = property; }
function GlobalReferenceDefinition(name, definition) { this.identifier = name; this.definition = definition; }

// Given a reference definition and name, recursively resolves it using
// both the .game.json and .debug.json data as needed.
GlobalReferenceDefinition.prototype.resolve = function () {
    
    // Recursively evaluate references until an actual value is
    // encountered. Indirect the final value, but flatten the chain so
    // that it is not traversed for every dereference.
    const alreadySeen = new Map();
    
    let id = this.identifier;
    let definition = this.definition
    alreadySeen.set(id, true);
    let path = id;
    while (definition && (definition.type === 'reference')) {
        id = definition.value;
        path += ' → ' + id;
        if (alreadySeen.has(id)) {
            throw 'Cycle in reference chain: ' + path;
        }

        definition = undefined;
        // See if the debug layer is shadowing
        if (gameSource.debug && gameSource.debug.constants) {
            definition = gameSource.debug.constants[id];
            if (! definition || ! definition.enabled) {
                definition = undefined;
            }
        }

        if (! definition) {
            // If the debug layer did not shadow this. Go to the
            // regular constant layer.
            definition = gameSource.json.constants[id];
        }
    }

    // We now have the ID of the other constant (or asset) at the end
    // of the chain that we are supposed to reference.  Whether the
    // actual value is itself overriden in the debug layer is resolved
    // at runtime.
    const object_name = id.replace(/\..+$/, '');
    const property_name = id.indexOf('.') !== -1 ? id.replace(/^[^\.]+\./, '') : '';
    if ((id in gameSource.json.constants) || (object_name in gameSource.json.assets) ||
        ((object_name in gameSource.json.assets) && (property_name in gameSource.assets[property_name]))) {
        return new GlobalReference(object_name, property_name);
    } else {
        throw 'Unresolved reference: ' + path;
    }
};


function onLoadFileStart(url) {
    // console.log('Fetching "' + url + '"');
    appendToBootScreen('Fetching ' + url.replace(/^.*\//, ''));
}

// Invoked when any file load completes
function onLoadFileComplete(url) {
    //console.log('Processing "' + url + '"');
    appendToBootScreen('Processing ' + url.replace(/^.*\//, ''));
}

/** Allows leading zeros. Returns a number on [0, 1] */
function parseHex(str) {
    const div = (str.length === 2) ? 255 : 15

    // Remove leading zeros
    str = str.replace(/^0*/, '');
    if (str.length === 0) { return 0; }
    return parseInt(str, 16) / div;
}


/* Assumes no '0x' or '#' prefix, just raw Y, YY, RGB, RGBA, RRGGBBAA, or
   RRGGBB values.  Returns {r,g,b,a} floating point values on [0, 1] */
function parseHexColor(str) {
    let r, g, b, a = 1;

    switch (str.length) {
    case 8: // RRGGBBAA
        a = parseHex(str.substring(6, 8));
        // Fall through
        
    case 6: // RRGGBB
        r = parseHex(str.substring(0, 2));
        g = parseHex(str.substring(2, 4));
        b = parseHex(str.substring(4, 6));
        break;
        
    case 4: // RGBA
        a = parseHex(str[3]);
        // Fall through
        
    case 3: // RGB
        r = parseHex(str[0]);
        g = parseHex(str[1]);
        b = parseHex(str[2]);
        break;
        
    case 2: // YY
        r = g = b = parseHex(str);
        break;
        
    case 1: // Y
        r = g = b = parseHex(str);
        break;
        
    default:
        throw new Error("Illegal hexadecimal color specification: '#" + str + "'");
    }
    
    return {r:r, g:g, b:b, a:a};
}

/** 
    Maps *.json urls directly to the live quadplay asset to reduce
    reloading times and collapse multiple references to a single
    in-memory asset, which is guaranteed by quadplay semantics.
    
    When fastReload is true or useIDE is false, built-in assets are not
    wiped from this cache per load.

    See clearAssetCache()
*/
let assetCache = {};

/** Wipes non-builtins from the asset cache, or everything if
    fastReload is not set and not in the IDE. */
function clearAssetCache() {
    if (! useIDE || fastReload) {
        // Remove non-builtins from the asset cache, but keep the
        // builtin assets since we don't expect them to change and can
        // reduce loading time. Make a copy of the keys since we'll be
        // mutating the object while iterating through it.
        const keys = Object.keys(assetCache);
        for (let i = 0; i < keys.length; ++i) {
            const url = keys[i];
            if (! isBuiltIn(url)) {
                delete assetCache[url];
            }
        }
    } else {
        // Wipe the entire asset cache
        assetCache = {};
    }
}

let inGameLoad = false;

function isDebugUrl(url) {
    return /(^|\/)([Dd]ebug|[Tt]est).pyxl$/.test(url);
}

// Used to prevent recursive load while embedded in an iframe
let firstLoadComplete = false;

/* Makes absolute and adds missing game .json name */
function makeGameURLAbsolute(gameURL) {
    if (! /\.game\.json$/i.test(gameURL)) {
        // Remove trailing slash
        if (gameURL[gameURL.length - 1] === '/') { gameURL = gameURL.substring(0, gameURL.length - 1); }
        gameURL = gameURL.replace(/(\/|^)([^\/]+)$/, '$1$2/$2.game.json');
    }
    gameURL = makeURLAbsolute(location.href, gameURL);
    return gameURL;
}

/* If url is local to this game, add just the relative part of it to gameSource.localFileTable */
function maybeRecordURLDependency(url) {
    if (url.startsWith(gameSource.urlBase)) {
        const relative = url.substring(gameSource.urlBase.length);
        gameSource.localFileTable[relative] = true;
    }
}

/* Loads the game and then runs the callback() or errorCallback() */
function afterLoadGame(gameURL, callback, errorCallback) {
    const isLauncher = gameURL.endsWith('/console/launcher/launcher.game.json') || gameURL.endsWith('/console/launcher/') || gameURL.endsWith('/console/launcher');
    console.assert(! inGameLoad, 'Reentrant call to afterLoadGame()!');
    //console.log('Starting game load');
    inGameLoad = true;

    // Use a random starting ID so that programmers who don't read the
    // manual won't assume it will be the same for each run and start
    // hardcoding constants that future implementation changes may break.
    lastSpriteID = Math.round(Math.random() * 8192);
    
    loadManager = new LoadManager({
        callback: function () {
            computeCredits(gameSource);
            computeResourceStats(gameSource);
            inGameLoad = false;
            if (callback) { callback(); }
            firstLoadComplete = true;
        },
        errorCallback: function (...args) {
            inGameLoad = false;
            //console.log('Done game load (error)\n\n');
            errorCallback(...args);
        },
        jsonParser: 'permissive',
        forceReload: false});

    // If given a directory, assume that the file has the same name
    gameURL = makeGameURLAbsolute(gameURL);
    window.gameURL = gameURL;
    console.log('Loading ' + gameURL);

    clearAssetCache();
    
    // Wipe the file data for the IDE
    fileContents = {};
    gameSource = {
        debug: {
            // Has field 'json' if a debug.json exists
            constants: {}
        },

        // All local files in this game (not built-ins)
        localFileTable: {'preview.png': true, 'label64.png': true, 'label128.png': true},
        urlBase: gameURL.replace(/\/[^/]+$/, '') + '/'
    };

    gameSource.localFileTable[gameURL.replace(/^.*\//, '')] = true;

    // Wipe the virtual GPU memory
    spritesheetArray = [];
    fontArray = [];
    
    resourceStats = {
        spritePixels: 0,
        spritesheets: 0,
        soundKilobytes: 0,
        maxSpritesheetWidth: 0,
        maxSpritesheetHeight: 0,
        sourceStatements: 0,
        sounds: 0,
        sourceStatementsByURL: {},
        spritePixelsByURL: {},
        soundKilobytesByURL: {}
    };

    const debugURL = gameURL.replace(/\.game\.json$/, '.debug.json');

    // Look for debugJSON
    if (locallyHosted(gameURL) && useIDE && isQuadserver && ! isBuiltIn(gameURL)) {
        loadManager.fetch(
            debugURL, 'json', null,
            function (debugJSON) {
                // Store the debugJSON contents
                gameSource.debug.json = debugJSON;
                gameSource.debug.constants = {};
                try {
                    loadConstants(gameSource.debug.json.constants, gameURL, true, gameSource.debug.constants);
                } catch (e) {
                    throw debugURL + ': ' + e;
                }
            },
            function () {
                // Tell the LoadManager that this is an acceptable failure
                // and continue.
                return true;
            },
            null,
            true // force reload always
        );
    }

    // Loaded below in the `if (isLauncher)` section
    let launcherGameArray;

    function processGameJSON(gameJSON) {
        if (! Array.isArray(gameJSON.modes)) { throw new Error('The modes parameter is not an array'); }
        if (gameJSON.assets === undefined) { gameJSON.assets = {}; }
        if (typeof gameJSON.assets !== 'object') { throw 'The assets parameter is not an object in ' + gameURL; }

        for (const assetName in gameJSON.assets) {
            if (assetName[0] === '$') { throw 'Illegal asset name: "' + assetName + '"'; }
        }

        gameSource.json = gameJSON;

        //////////////////////////////////////////////////////////////////////////////////////////////

        // Fix legacy files that use a * to denote the start mode
        if (! gameJSON.start_mode) {
            for (let i = 0; i < gameJSON.modes.length; ++i) {
                if (gameJSON.modes[i].indexOf('*') !== -1) {
                    console.log('WARNING: Legacy start mode upgraded on load');
                    gameJSON.start_mode = gameJSON.modes[i] = gameJSON.modes[i].replace('*', '');
                }
            }
        }

        // Upgrade
        if (gameJSON.screenshot_tag === undefined) {
            gameJSON.screenshot_tag = gameJSON.title;
        }
       
        // Clone for the extended version actually loaded
        gameJSON = deep_clone(gameJSON);
        gameSource.extendedJSON = gameJSON;

        // Inject launcherGameArray constant and assets if this is the launcher
        if (isLauncher) {
            gameJSON.constants.game_array = {type: 'raw', value: launcherGameArray};
            
            for (let i = 0; i < launcherGameArray.length; ++i) {
                const asset_prefix = 'a' + i;
                const g = launcherGameArray[i];
                g.asset_prefix = asset_prefix;

                // Add assets
                gameJSON.assets[asset_prefix + '_preview'] = g.url + 'preview.png';
                gameJSON.assets[asset_prefix + '_label'] = g.url + 'label64.png';
            }
        } // if isLauncher

        // TODO: Make sure that reloading the kiosk doesn't add
        // this twice if the JSON was cached

        if (! gameJSON.scripts) { gameJSON.scripts = []; }
        if (! gameJSON.modes) { gameJSON.modess = []; }
        
        // Inject OS support
        gameJSON.scripts.push(
            'quad://console/os/_ui.pyxl'
        );
        gameJSON.modes.push(
            'quad://console/os/_SystemMenu',
            'quad://console/os/_ConfirmDialog',
            'quad://console/os/_GameCredits',
            'quad://console/os/_SetControls',
            'quad://console/os/_ControlsMenu',
            'quad://console/os/_ControllerOrder',
            'quad://console/os/_NewHost',
            'quad://console/os/_OnlineMenu'
        );

        // Any changes here must also be updated in the os_dependencies variable in tools/export.py
        gameJSON.assets = Object.assign(gameJSON.assets, os_dependencies);
        //////////////////////////////////////////////////////////////////////////////////////////////

        gameSource.jsonURL = gameURL;
        if (gameJSON.screen_size === undefined) {
            gameJSON.screen_size = {x: 384, y:224};
        }

        {
            let ok = false;
            for (let i = 0; i < allowedScreenSizes.length; ++i) {
                if ((allowedScreenSizes[i].x === gameJSON.screen_size.x) &&
                    (allowedScreenSizes[i].y === gameJSON.screen_size.y)) {
                    ok = true;
                }
            }
            if (! ok) {
                throw new Error(`${gameJSON.screen_size.x} x ${gameJSON.screen_size.y} is not a supported screen size.`);
            }
        }

        // Scripts:
        gameSource.scripts = [];
        if (gameJSON.scripts) {
            
            if (! Array.isArray(gameJSON.scripts)) {
                throw new Error('The scripts parameter is not an array in ' + gameURL);
            }
            
            for (let i = 0; i < gameJSON.scripts.length; ++i) {
                if (typeof gameJSON.scripts[i] !== 'string') {
                    throw new Error('Script ' + i + ' is not a url.');
                }
                
                const scriptURL = makeURLAbsolute(gameURL, gameJSON.scripts[i]);
                gameSource.scripts.push(scriptURL);

                maybeRecordURLDependency(scriptURL);
                
                loadManager.fetch(scriptURL, 'text', null, function (scriptText) {
                    scriptText = scriptText.replace(/\r/g, '');

                    // Ignore debug files
                    if (! isDebugUrl(scriptURL)) {
                        addCodeToSourceStats(scriptText, scriptURL);
                    }
                    
                    fileContents[scriptURL] = scriptText;
                }, null, null, computeForceReloadFlag(scriptURL));
            }
        }

        // Modes:
        {
            gameSource.modes = [];
            let numStartModes = 0;
            for (let i = 0; i < gameJSON.modes.length; ++i) {
                const modeURL = makeURLAbsolute(gameURL, gameJSON.modes[i] + '.pyxl');
                // Remove any URL prefix and change leading underscore to $ on the name
                // (we don't use $ in the actual URL because it confuses a lot of shells)
                const name = gameJSON.modes[i].replace(/^.*\//, '').replace(/(^|\/)_([^\/]+)$/, '$1$$$2');
                if (name === gameJSON.start_mode) {
                    ++numStartModes;
                }

                maybeRecordURLDependency(modeURL);

                // Remove the quad://... from internal modes
                gameSource.modes.push({name: name, url: modeURL});                
            }

            if (numStartModes === 0) {
                throw new Error('No "start_mode" specified');
            }

            // Load all modes
            for (let i = 0; i < gameSource.modes.length; ++i) {
                const mode = gameSource.modes[i];
                loadManager.fetch(mode.url, 'text', null, function (modeCode) {
                    modeCode = modeCode.replace(/\r/g, '');
                    if (! isDebugUrl(mode.url)) {
                        addCodeToSourceStats(modeCode, mode.url);
                    }
                    fileContents[mode.url] = modeCode;
                }, null, null, true);// Always force reload computeForceReloadFlag(mode.url));
            }
        }

        // Assets (processed before constants to allow references to point to them)
        if (gameJSON.assets) {
            gameSource.assets = {};
            
            // Sort assets alphabetically
            const keys = Object.keys(gameJSON.assets);
            keys.sort();
            for (let i = 0; i < keys.length; ++i) {
                const a = keys[i];
                
                // Capture values for the function below
                const assetURL = makeURLAbsolute(gameURL, gameJSON.assets[a]);
                const assetName = a;                
                maybeRecordURLDependency(assetURL);

                const isIndexingSprite =
                    assetURL.endsWith('preview.png') ||
                    assetURL.endsWith('label64.png') ||
                    assetURL.endsWith('label128.png');

                if (isIndexingSprite) {
                    
                    // Special spritesheet assets used for the
                    // launcher that do not have supporting JSON
                    // files. Synthesize a JSON file for them dynamically

                    const json = {
                        url: assetURL,
                        sprite_size: assetURL.endsWith('preview.png') ? {x: 192, y: 112} : assetURL.endsWith('label128.png') ? {x: 128, y: 128} : {x: 64, y: 64}
                    };
                    
                    gameSource.assets[assetName] = loadSpritesheet(assetName, json, assetURL, null);
                    
                } else {
                
                    let type = assetURL.match(/\.([^.]+)\.json$/i);
                    if (type) { type = type[1].toLowerCase(); }
                    
                    // Always re-fetch and parse the json, even though
                    // this asset may be in the cache if it is a built-in
                    // or duplicate asset.
                    
                    loadManager.fetch(assetURL, 'text', jsonParser, function (json) {
                        // assetURL is the asset json file
                        // json.url is the png, mp3, etc. referenced by the file

                        maybeRecordURLDependency(makeURLAbsolute(assetURL, json.url));
                        if (json.source_url) {
                            maybeRecordURLDependency(makeURLAbsolute(assetURL, json.source_url));
                        }

                        switch (type) {
                        case 'font':
                            gameSource.assets[assetName] = loadFont(assetName, json, assetURL);
                            break;
                            
                        case 'sprite':
                            gameSource.assets[assetName] = loadSpritesheet(assetName, json, assetURL, null);
                            break;
                            
                        case 'sound':
                            gameSource.assets[assetName] = loadSound(assetName, json, assetURL);
                            break;
                            
                        case 'map':
                            gameSource.assets[assetName] = loadMap(assetName, json, assetURL);
                            break;
                            
                        case 'data':
                            gameSource.assets[assetName] = loadData(assetName, json, assetURL);
                            break;
                            
                        default:
                            console.log('Unrecognized asset type: "' + type + '"');
                        }
                        
                    }, // end of callback
                                      null, // error callback
                                      null, // warning callback
                                      computeForceReloadFlag(assetURL)
                                     );
                } // if preview.png
            } // for each asset
        } // Assets

        // Constants:
        gameSource.constants = {};
        loadConstants(gameJSON.constants, gameURL, false, gameSource.constants);
        
        // Docs: Load the names, but do not load the documents themselves.
        gameSource.docs = [];
        if (gameJSON.docs) {
            // Just clone the array
            gameSource.docs = gameJSON.docs.slice(0);
            for (let d = 0; d < gameSource.docs.length; ++d) {
                const doc = gameSource.docs[d];
                                        
                if (typeof doc === 'string') {
                    gameSource.docs[d] = makeURLAbsolute(gameURL, doc);                   
                } else {
                    // Legacy game.json format with metadata on the document. No longer supported
                    gameSource.docs[d] = makeURLAbsolute(gameURL, doc.url);
                }
                maybeRecordURLDependency(gameSource.docs[d]);                 
            }
        } // if docs        
    } // processGameJSON

    function goLoadGame() {
        loadManager.fetch(gameURL, 'text', jsonParser, processGameJSON, loadFailureCallback, loadWarningCallback, true);
    }

    if (isLauncher) {
        // The launcher needs access to the list of games before it can load.
        const gamesListURL = location.origin + getQuadPath() + 'console/games.json';
        loadManager.fetch(gamesListURL, 'json', null, function (gamesListJSON) {
            launcherGameArray = gamesListJSON.builtins;

            // Sort by title
            launcherGameArray.sort(titleComparator);

            // Continue the loading process
            goLoadGame();
        });
    } else {
        goLoadGame();
    }

    loadManager.end();
}
                         

/* Constants json is the table of constants as loaded directly from
   game.json or debug.json.

   Returns a table of evaluated constants. If constantsJson is undefined,
   that table is empty.
*/
function loadConstants(constantsJson, gameURL, isDebugLayer, result) {
    if (! constantsJson) { return; }

    // Sort constants alphabetically
    const keys = Object.keys(constantsJson);
    keys.sort();
    let hasReferences = false;
    for (let i = 0; i < keys.length; ++i) {
        const c = keys[i];
        const definition = constantsJson[c];
        if ((definition.type === 'raw') && (definition.url !== undefined)) {
            if (isDebugLayer) {
                throw 'raw url constants not supported in debug.json (' + c + ')';
            }
            
            // Raw value loaded from a URL
            const constantURL = makeURLAbsolute(gameURL, definition.url);
            maybeRecordURLDependency(constantURL);

            if (/\.json$/.test(constantURL)) {
                loadManager.fetch(constantURL, 'json', nullToUndefined, function (data) {
                    result[c] = data;
                }, undefined, undefined, true);
            } else if (/\.yml$/.test(constantURL)) {
                loadManager.fetch(constantURL, 'text', null, function (yaml) {
                    const json = jsyaml.load(yaml);
                    result[c] = nullToUndefined(json);
                }, undefined, undefined, true);
            } else {
                throw 'Unsupported file format for ' + definition.url;
            }
        } else if ((definition.type === 'table' || definition.type === 'array') && (definition.url !== undefined)) {
            if (isDebugLayer) {
                throw definition.type + ' url constants not supported in debug.json (' + c + ')';
            }
            // Raw value loaded from a URL
            const constantURL = makeURLAbsolute(gameURL, definition.url);
            loadCSV(constantURL, definition, gameSource.constants, c);
        } else if ((definition.type === 'string') && (definition.url !== undefined)) {
            if (isDebugLayer) {
                throw 'string url constants not supported in debug.json (' + c + ')';
            }
            // Raw value loaded from a URL
            const constantURL = makeURLAbsolute(gameURL, definition.url);
            loadTXT(constantURL, definition, gameSource.constants, c);
        } else if (definition.type === 'reference') {
            // Defer evaluation until binding time.
            result[c] = new GlobalReferenceDefinition(c, definition);
        } else {
            // Inline value
            result[c] = evalJSONGameConstant(definition);
        }
    }
}


/** Computes gameSource.CREDITS from gameSource, mutating it. */
function computeCredits(gameSource) {
    function canonicalizeLicense(license) {
        // Remove space after copyright and always just use the symbol
        license = license.replace(/(?:\(c\)|copyright|©)\s*(?=\d)/gi, '©');
        
        // Lower-case any leading "by"
        license = license.replace(/^By /, 'by ');
        return license;
    }

    const CREDITS = gameSource.CREDITS = {
        game: [],
        pack: [],
        font: [],
        sprite: [],
        sound: [],
        code: [],
        data: [],
        quadplay: []
    };

    // Game
    CREDITS.game.push((gameSource.json.title || 'Untitled') +
                      (gameSource.json.developer ? ' by ' +
                       gameSource.json.developer : '') + ' ' +
                      (gameSource.json.copyright || ''));
    if (gameSource.json.license) { CREDITS.game.push(canonicalizeLicense(gameSource.json.license)); }
    
    CREDITS.title = gameSource.json.title || 'Untitled';
    CREDITS.developer = gameSource.json.developer || '';

    // Map from canonicalized licenses to assets that use them
    const cache = {};
    for (const type in CREDITS) {
        cache[type] = new Map();
    }
    Object.seal(cache);

    function addCredit(type, assetURL, license) {
        license = canonicalizeLicense(license);
        if (! cache[type].has(license)) {
            cache[type].set(license, []);
        }
        cache[type].get(license).push(urlFile(assetURL).replace(/\.[^\.]+\.json$/, ''));
    }

    if (gameSource.json.credits) {
        CREDITS.main = gameSource.json.credits.main;
        CREDITS.extra = gameSource.json.credits.extra;
        
        // Code
        const codeCredits = gameSource.json.credits.code;
        for (let url in codeCredits) {
            addCredit('code', url, codeCredits[url]);
        }
    }
    
    for (let a in gameSource.assets) {
        const asset = gameSource.assets[a];

        console.assert(asset, 'Asset ' + a + ' is not in gameSource.assets');
        const json = asset.$json;
        
        let type = asset.$jsonURL.match(/\.([^.]+)\.json$/i);
        if (type) { type = type[1].toLowerCase(); }

        if (json.license && CREDITS[type]) {
            addCredit(type, asset.$jsonURL, json.license);
        }

        if (type === 'map') {
            // Process the spritesheets
            for (let k in asset.spritesheet_table) {                
                const spritesheet = asset.spritesheet_table[k];

                console.assert(spritesheet.$index[0] === spritesheetArray.indexOf(spritesheet));
                console.assert(spritesheet[0][0].rotated_270.$spritesheet.$index[0] === spritesheetArray.indexOf(spritesheet[0][0].rotated_270.$spritesheet),
                               'bad rotated spritesheet index after loading');
                
                const json = spritesheet.$json;
                if (json.license) {
                    addCredit('sprite', spritesheet.$jsonURL, json.license);
                }
            }
        }
    }

    // Generate the credits from the cache, consolidating those with the same license.
    for (const type in cache) {
        cache[type].forEach(function (assetList, license) {
            let assets;
            if (assetList.length === 1) {
                assets = assetList[0];
            } else if (assetList.length === 2) {
                assets = assetList[0] + ' and ' + assetList[1];
            } else {
                assets = assetList.slice(0, assetList.length - 1).join(', ') + ', and ' + assetList[assetList.length - 1];
            }            
            CREDITS[type].push(assets + ' ' + license);
        });
    }
    
    // The quadplay runtime. We only need to credit code that is in the runtime, not the compiler or IDE.
    CREDITS.quadplay.push('quadplay✜ ©2019-2025 Morgan McGuire, used under the LGPL 3.0 license');
    CREDITS.quadplay.push('gif.js ©2013 Johan Nordberg, used under the MIT license, with additional programming by Kevin Weiner, Thibault Imbert, and Anthony Dekker');
    CREDITS.quadplay.push('xorshift implementation ©2014 Andreas Madsen and Emil Bay, used under the MIT license');
    CREDITS.quadplay.push('LoadManager.js ©2018-2020 Morgan McGuire, used under the BSD license');
    CREDITS.quadplay.push('WorkJSON.js ©2020-2021 Morgan McGuire, used under the MIT license');
    CREDITS.quadplay.push('js-yaml ©2011-2015 Vitaly Puzrin, used under the MIT license');
    CREDITS.quadplay.push('matter.js © Liam Brummitt and others, used under the MIT license');
    CREDITS.quadplay.push('poly-decomp.js ©2013 Stefan Hedman, used under the MIT license');
}


function loadFont(name, json, jsonURL) {
    if (json.format !== '20211015') {
        throw 'Font ' + jsonURL + ' in obsolete format. Use tools/font-update.py to upgrade';
    }
    const pngURL = makeURLAbsolute(jsonURL, json.url);

    let font = assetCache[jsonURL];
    if (font) {
        // Make sure the index is updated when pulling from the cache
        if (fontArray.indexOf(font) === -1) {
            font.$index[0] = fontArray.length;
            fontArray.push(font);
        } else {
            console.assert(fontArray.indexOf(font) === font.$index[0]);
        }

        // Print faux loading messages
        onLoadFileStart(pngURL);
        onLoadFileComplete(pngURL);
        return font;
    }

    // Load from disk and create a new object, and then store in the cache
    assetCache[jsonURL] = font = {
        $name:     name,
        $type:     'font',
        $url:      pngURL,
        $json:     json,
        $jsonURL:  jsonURL,
        $index:    [fontArray.length]
    };

    fontArray.push(font);
    const forceReload = computeForceReloadFlag(pngURL);

    onLoadFileStart(pngURL);
    loadManager.fetch(pngURL, 'image', getBinaryImageData, function (srcMask, image) {
        onLoadFileComplete(pngURL);
        
        const borderSize = 1;
        const shadowSize = parseInt(json.shadowSize || 1);

        packFont(font, borderSize, shadowSize, json.baseline, json.char_size, Object.freeze({x: json.letter_spacing.x, y: json.letter_spacing.y}), srcMask, true, json.char_min_width);
        Object.freeze(font);
    }, loadFailureCallback, loadWarningCallback, forceReload);

    return font;
}


function computeResourceStats(gameSource) {
    const alreadyCounted = new Map();
    for (let key in gameSource.assets) {
        if (key[0] !== '$') {
            const asset = gameSource.assets[key];
            if (! alreadyCounted.has(asset)) {
                alreadyCounted.set(asset, true);
                switch (asset.$type) {
                case 'font': case 'spritesheet':
                    recordSpriteStats(asset);
                    break;
                    
                case 'sound':
                    recordSoundStats(asset);
                    break;
                    
                case 'map':
                    for (let spritesheetKey in asset.spritesheet_table) {
                        const spritesheet = asset.spritesheet_table[spritesheetKey];
                        if (! alreadyCounted.has(spritesheet)) {
                            alreadyCounted.set(spritesheet, true);
                            recordSpriteStats(spritesheet);
                        }
                    }
                    break;
                }
            } // already counted
        }
    }
}


/** Extracts the image data and returns two RGBA4 arrays as
    [Uint16Array, Uint16Array], where the second is flipped
    horizontally. Region is an optional crop region.
    
    Options are optional additional preprocessing. The only
    currently-supported option is `palette_swap`.
*/
function getImageData4BitAndFlip(image, region, options) {
    const data = getImageData4Bit(image, region);

    if (options && options.palette_swap) {
        // Build the lookup table with 2^12 = 4096 entries. Start by
        // mapping every RGB color to itself
        const palette = new Uint16Array(4096);
        for (let i = 0; i < 4096; ++i) {
            palette[i] = 0xF000 | i;
        }

        // Now override the individual colors
        for (const src in options.palette_swap) {
            let dst = options.palette_swap[src];
            // Parse src and dst
            if (src[0] !== '#' || dst[0] !== '#' || src.length !== 4 || (dst.length !== 4 && dst.length !== 5)) { throw 'palette_swap source colors must have the form "#RGB" in hexadecimal and destination colors must have the form "#RGB" or "#RGBA"'; }

            // Remove leading zeros
            let src_rgb = (src === '#000') ? 0 : parseInt(src.substring(1).replace(/^0*/, ''), 16);
            // Byte reorder
            src_rgb = ((src_rgb & 0xF) << 8) | (src_rgb & 0x0F0) | (src_rgb >> 8);

            // Remove the leading '#'
            dst = dst.substring(1);
            let dst_a000 = 0xF000;

            if (dst.length === 4) {
                // dst has an alpha channel as the 4th
                // character. Parse and remove A for followup
                // RGB parsing.
                dst_a000 = parseInt(dst.substring(3), 16) << 12;
                dst = dst.substring(0, 3);
            }

            // Parse and re-order bytes, removing leading zeros
            let dst_rgb = (dst === '000') ? 0 : parseInt(dst.replace(/^0*/, ''), 16);
            dst_rgb = ((dst_rgb & 0xF) << 8) | (dst_rgb & 0x0F0) | (dst_rgb >> 8);

            // Store the value
            palette[src_rgb] = dst_a000 | dst_rgb;
        }
        
        // Replace all values in the image in place, preserving alpha.
        // Most will be unchanged.
        for (let i = 0; i < data.length; ++i) {
            const src = data[i];
            const src_a000 = src & 0xF000;
            const src_rgb  = src & 0x0FFF;
            
            const dst = palette[src_rgb];
            const dst_a000 = dst & 0xF000;
            const dst_rgb  = dst & 0x0FFF;
            
            data[i] = (src_a000 & dst_a000) | dst_rgb;
        }
    }
    
    const flipped = new Uint16Array(data.length);
    flipped.width = data.width;
    flipped.height = data.height;

    for (let y = 0; y < data.height; ++y) {
        for (let x = 0; x < data.width; ++x) {
            const i = x + y * data.width;
            const j = (data.width - 1 - x) + y * data.width;
            flipped[i] = data[j];
        }
    }
    
    return [data, flipped];
}


/** Extracts the image data from an Image and quantizes it to RGBA4
    format, returning a Uint16Array. region is an optional crop region. */
function getImageData4Bit(image, region, full32bitoutput) {
    // Make a uint32 aliased version
    const dataRaw = new Uint32Array(getImageData(image).data.buffer);
    dataRaw.width = image.width;
    dataRaw.height = image.height;

    let data = dataRaw;
    if (region && ((region.corner.x !== 0) || (region.corner.y !== 0) || (region.size.x !== image.width) || (region.size.y !== image.height))) {
        // Crop
        data = new Uint32Array(region.size.x * region.size.y);
        data.width = region.size.x;
        data.height = region.size.y;

        for (let y = 0; y < data.height; ++y) {
            const srcOffset = (y + region.corner.y) * dataRaw.width + region.corner.x;
            data.set(dataRaw.slice(srcOffset, srcOffset + data.width), y * data.width);
        }
    }

    // Used by scalepix
    if (full32bitoutput) { return data; }
    
    // Quantize
    const N = data.length;

    const result = new Uint16Array(N);
    result.height = data.height;
    result.width = data.width;
    for (let i = 0; i < N; ++i) {
        // Debug endianness
        //console.log('0x' + a[i].toString(16) + ' : [0]=' + spritesheet.data[4*i] + ', [1] = '+ spritesheet.data[4*i+1] + ', [2] = '+ spritesheet.data[4*i+2] + ', [3] = '+ spritesheet.data[4*i+3]);
        const c = data[i] >> 4;
        result[i] = ((c & 0xf000000) >> 12) | ((c & 0xf0000) >> 8) | ((c & 0xf00) >> 4) | c & 0xf;
    }

    return result;
}


// Handles fonts as well
function recordSpriteStats(spritesheet) {
    if (spritesheet.$name[0] === '$') { return; }
    const data = (spritesheet.$uint16Data || spritesheet.$data);
    let count = data.width * data.height;
    
    if (spritesheet.$type === 'font') {
        // Fonts count half as much because they are 8-bit
        count = Math.ceil(count / 2) >>> 0;
    }
    resourceStats.spritePixels += count;
    resourceStats.spritePixelsByURL[spritesheet.$url] = count;
    
    ++resourceStats.spritesheets;
    resourceStats.maxSpritesheetWidth = Math.max(resourceStats.maxSpritesheetWidth, data.width);
    resourceStats.maxSpritesheetHeight = Math.max(resourceStats.maxSpritesheetHeight, data.height);
}


function loadData(name, json, jsonURL) {
    const dataURL = makeURLAbsolute(jsonURL, json.url);
    maybeRecordURLDependency(dataURL);

    const forceReload = computeForceReloadFlag(dataURL);

    // No caching for data.
    const dataType = dataURL.split('.').pop().toLowerCase();

    // We construct a holder for the value, so that something can be
    // returned immediately. data.value is the actual element. This is
    // unlike all other assets, which are the asset itself.
    const data = {
        value: undefined,
        $type: 'data',
        $json: json,
        $jsonURL: jsonURL
    };
    
    if (dataType === 'png' || dataType === 'jpg' || dataType === 'gif') {
        // Image
        data.value = Object.freeze({$name: name, $type: 'data', r:[], g:[], b:[], a:[]});
        loadManager.fetch(dataURL, 'image', null, function (image) {
            onLoadFileComplete(dataURL);

            const imageData = getImageData(image);
            const channel = "rgba";
            for (let c = 0; c < 4; ++c) {
                const C = channel[c];
                data.value[C].length = imageData.width;
                for (let x = 0; x < imageData.width; ++x) {
                    const array = data.value[C][x] = new Uint8Array(imageData.height);
                    for (let y = 0; y < imageData.height; ++y) {
                        array[y] = imageData.data[(x + y * imageData.width) * 4 + c];
                    }
                    // Cannot freeze typed arrays because they are only
                    // views on the underlying buffer. Freeze the buffer
                    // instead.
                    Object.freeze(array.buffer);
                }
                Object.freeze(data.value[C]);
            } // for each channel
            Object.freeze(data.value);
            Object.freeze(data);
        }, loadFailureCallback, loadWarningCallback, forceReload);
    } else if (dataType === 'csv') {
        // CSV
        loadCSV(dataURL, json, data, 'value', function () {
            data.value.$name = name;
            data.value.$type = 'data';
            deepFreeze(data.value);
        });
    } else if (dataType === 'txt') {
        // CSV
        loadTXT(dataURL, json, data, 'value', function () {
            data.value.$name = name;
            data.value.$type = 'data';
            deepFreeze(data.value);
        });
    } else if (dataType === 'json') {
        // JSON
        loadManager.fetch(dataURL, 'json', nullToUndefined, function (value) {
            data.value = value;
            data.value.$name = name;
            data.value.$type = 'data';
            deepFreeze(data.value);
        }, undefined, undefined, true);
    } else if (dataType === 'yml') {
        loadManager.fetch(dataURL, 'text', null, function (yaml) {
            const json = jsyaml.load(yaml);
            data.value = nullToUndefined(json);
            data.value.$name = name;
            data.value.$type = 'data';
            deepFreeze(data.value);
        }, undefined, undefined, true);
    } else {
        throw new Error(dataType + ' is not a valid data asset type.');
    }

    return data;
}


function deepFreeze(value) {
    if (! Object.isFrozen(value)) {
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; ++i) {
                deepFreeze(value[i]);
            }
        } else if (typeof value === 'object') {
            for (let k in value) {
                Object.freeze(value[k]);
            }
        }
        Object.freeze(value);
    }
}


function loadSpritesheet(name, json, jsonURL, callback) {
    const pngURL = makeURLAbsolute(jsonURL, json.url);

    let spritesheet = assetCache[jsonURL];
    if (spritesheet) {
        // Make sure the index is updated when pulling from the cache.
        // For built-in sprites it could have been wiped.
        if (spritesheetArray.indexOf(spritesheet) === -1) {
            // Change the index
            spritesheet.$index[0] = spritesheetArray.length;
            spritesheetArray.push(spritesheet);

            const transposedSpritesheet = spritesheet[0][0].rotated_90.$spritesheet;
            transposedSpritesheet.$index[0] = spritesheetArray.length;
            spritesheetArray.push(transposedSpritesheet);
        }

        console.assert(spritesheetArray.indexOf(spritesheet) === spritesheet.$index[0]);

        onLoadFileStart(pngURL);
        onLoadFileComplete(pngURL);

        // If the spritesheet is in the assetCache, then some other
        // resource has triggered it to load (or it is built in), but
        // it may not yet be completely processed. Do not run our
        // callback until the spritesheet is fully loaded. We can
        // check by looking at whether the spritesheet is frozen,
        // which is the last step of spritesheet loading.

        if (callback) {
            // Warn the load manager that we are not done yet
            ++loadManager.pendingRequests;
            
            function runCallbackWhenLoaded() {
                if (Object.isFrozen(spritesheet)) {
                    callback(spritesheet);
                    loadManager.markRequestCompleted(jsonURL + ' callback', '', true);
                } else {
                    // Re-queue a test after a few milliseconds
                    setTimeout(runCallbackWhenLoaded, 8);
                }
            };
            runCallbackWhenLoaded();
        }
        
        return spritesheet;
    }


    const forceReload = computeForceReloadFlag(pngURL);

    // These fields have underscores so that they can't be accessed
    // from pyxlscript. Create the object before launching the async
    // load so that the per-reload cache can hold it. The $index is an
    // array so that the spritesheet can be frozen but the index
    // rewritten.
    spritesheet = Object.assign([], {
        $name: name,
        $type: 'spritesheet',
        $uint16Data: null,
        $uint16DataFlippedX: null,
        $url: pngURL,
        $sourceURL: (json.source_url && json.source_url !== '') ? makeURLAbsolute(jsonURL, json.source_url) : null,
        // Before the region is applied. Used by the IDE
        $sourceSize: {x: 0, y: 0},
        $gutter: (json.gutter || 0),
        $json: json,
        $jsonURL: jsonURL,

        // Index into spritesheetArray of the $spritesheet for each sprite
        $index: [spritesheetArray.length],
        // If unspecified, load the sprite size later
        sprite_size: json.sprite_size ? Object.freeze({x: json.sprite_size.x, y: json.sprite_size.y}) : undefined
    });

    assetCache[jsonURL] = spritesheet;   
    spritesheetArray.push(spritesheet);
    console.assert(spritesheetArray.indexOf(spritesheet) === spritesheet.$index[0]);

    if (json.gutter && typeof json.gutter !== 'number') {
        throw new Error('gutter must be a single number');
    }
    
    const transposedSpritesheet = Object.assign([], {
        $name: 'transposed_' + name,
        $type: 'spritesheet',
        $uint16Data: null,
        $uint16DataFlippedX : null,
        $gutter: (json.gutter || 0),
        $index: [spritesheetArray.length],
        // If unspecified, load the sprite size later
        sprite_size: json.sprite_size ? Object.freeze({x: json.sprite_size.y, y: json.sprite_size.x}) : undefined
    });    
    spritesheetArray.push(transposedSpritesheet);
    
    // Offsets used for scale flipping
    const PP = Object.freeze({x: 1, y: 1});
    const NP = Object.freeze({x:-1, y: 1});
    const PN = Object.freeze({x: 1, y:-1});
    const NN = Object.freeze({x:-1, y:-1});
          
    // Actually load the image
    onLoadFileStart(pngURL);
    
    // Clone the region to avoid mutating the original json
    const region = Object.assign({}, json.region || {});
    if (region.pos !== undefined) { region.corner = region.pos; }
    if (region.corner === undefined) { region.corner = {x: 0, y: 0}; }
    
    const preprocessor = function (image) {
        if (! (pngURL in fileContents)) {
            // This image has not been previously loaded by this project
            fileContents[pngURL] = image;
        }

        if (! spritesheet.sprite_size) {
            // Apply the default size of the whole image if the sprite size is not
            // specified
            spritesheet.sprite_size = Object.freeze({x: image.width, y: image.height});
            transposedSpritesheet.sprite_size = Object.freeze({x: image.height, y: image.width});
        }

        // Save these for the editor in the IDE
        spritesheet.$sourceSize.x = image.width;
        spritesheet.$sourceSize.y = image.height;
        
        // Update the region now that we know the image size
        region.corner.x = Math.min(Math.max(0, region.corner.x), image.width);
        region.corner.y = Math.min(Math.max(0, region.corner.y), image.height);
        
        if (region.size === undefined) { region.size = {x: Infinity, y: Infinity}; }
        region.size.x = Math.min(image.width  - region.corner.x, region.size.x);
        region.size.y = Math.min(image.height - region.corner.y, region.size.y);

        return getImageData4BitAndFlip(image, region, json);
    };

    function spritesheetLoadCallback(dataPair, ignore_image, url) {
        onLoadFileComplete(pngURL);
        const data = dataPair[0];

        // Compute the transposedSpritesheet uint16 data
        transposedSpritesheet.$uint16Data = new Uint16Array(data.length);
        transposedSpritesheet.$uint16Data.width = data.height;
        transposedSpritesheet.$uint16Data.height = data.width;
        
        transposedSpritesheet.$uint16DataFlippedX = new Uint16Array(data.length);
        transposedSpritesheet.$uint16DataFlippedX.width = data.height;
        transposedSpritesheet.$uint16DataFlippedX.height = data.width;
        
        for (let y = 0; y < data.width; ++y) {
            for (let x = 0; x < data.height; ++x) {
                const i = x + y * data.height;
                const j = (data.height - 1 - x) + y * data.height;
                const k = x * data.width + y;
                transposedSpritesheet.$uint16Data[i] =
                    transposedSpritesheet.$uint16DataFlippedX[j] =
                    data[k];
            }
        }

        spritesheet.$uint16Data = data;
        spritesheet.$uint16DataFlippedX = dataPair[1];
        
        // Store the region for the editor
        spritesheet.$sourceRegion = region;
        
        const boundingRadius = Math.hypot(spritesheet.sprite_size.x, spritesheet.sprite_size.y);
        spritesheet.size = {x: data.width, y: data.height};
        transposedSpritesheet.size = {x: spritesheet.size.y, y: spritesheet.size.x};

        // Pivots (compute after sprite size is known)
        const sspivot = json.pivot ? Object.freeze({x: json.pivot.x - spritesheet.sprite_size.x / 2, y: json.pivot.y - spritesheet.sprite_size.y / 2}) : Object.freeze({x: 0, y: 0});
        const transposedPivot = Object.freeze({x: sspivot.y, y: sspivot.x});
        
        const sheetDefaultframes = Math.max(json.default_frames || 1, 0.25);
        
        // Create the default grid mapping (may be swapped on the following line)
        let rows = Math.floor((data.height + spritesheet.$gutter) / (spritesheet.sprite_size.y + spritesheet.$gutter));
        let cols = Math.floor((data.width  + spritesheet.$gutter) / (spritesheet.sprite_size.x + spritesheet.$gutter));

        if (json.transpose) { let temp = rows; rows = cols; cols = temp; }

        if (rows === 0 || cols === 0) {
            throw new Error('Spritesheet ' + jsonURL + ' has a sprite_size that is larger than the entire spritesheet.');
        }

        transposedSpritesheet.length = rows;
        for (let y = 0; y < rows; ++y) {
            transposedSpritesheet[y] = new Array(cols);
        }

        spritesheet.size_in_sprites = Object.freeze({x: rows, y: cols});
        transposedSpritesheet.size_in_sprites = Object.freeze({x: cols, y: rows});
        
        for (let x = 0; x < cols; ++x) {
            spritesheet[x] = [];
            
            for (let y = 0; y < rows; ++y) {
                const u = json.transpose ? y : x, v = json.transpose ? x : y;
                
                // Check each sprite for alpha channel
                let hasAlpha = false;
                let hasFractionalAlpha = false;
                const mean_color = {r: 0, g: 0, b: 0, a: 0};
                outerloop:
                for (let j = 0; j < spritesheet.sprite_size.y; ++j) {
                    let index = (v * (spritesheet.sprite_size.y + spritesheet.$gutter) + j) * data.width + u * (spritesheet.sprite_size.x + spritesheet.$gutter);
                    for (let i = 0; i < spritesheet.sprite_size.x; ++i, ++index) {
                        const alpha15 = (data[index] >>> 12) & 0xf;

                        const alpha = alpha15 / 15;
                        mean_color.r += alpha * data[index] & 0xf;
                        mean_color.g += alpha * (data[index] >>> 4) & 0xf;
                        mean_color.b += alpha * (data[index] >>> 8) & 0xf;
                        mean_color.a += alpha;
                        
                        if (alpha15 < 0xf) {
                            hasAlpha = true;

                            if (alpha15 > 0) {
                                hasFractionalAlpha = true;
                                // Can't break out when computing
                                // the mean color
                                //break outerloop;
                            }
                        }
                    }
                }

                if (mean_color.a > 0) {
                    // The unnormalized alpha already factors in the
                    // number of pixels to the sum
                    const k = 15 * mean_color.a;
                    mean_color.r /= k;
                    mean_color.g /= k;
                    mean_color.b /= k;
                    mean_color.a /= spritesheet.sprite_size.x * spritesheet.sprite_size.y;
                }
                mean_color.$color = QRuntime.$colorToUint16(mean_color);
                Object.freeze(mean_color);
                
                let centerColor;
                {
                    const x = u * (spritesheet.sprite_size.x + spritesheet.$gutter) + Math.floor(spritesheet.sprite_size.x / 2);
                    const y = v * (spritesheet.sprite_size.y + spritesheet.$gutter) + Math.floor(spritesheet.sprite_size.y / 2);
                    centerColor = data[x + y * data.width];
                }

                // Create the actual sprite
                const sprite = {
                    $type:             'sprite',
                    $color:            centerColor,
                    $name:             spritesheet.$name + '[' + u + '][' + v + ']',
                    $tileX:            u,
                    $tileY:            v,
                    $boundingRadius:   boundingRadius,
                    $x:                u * (spritesheet.sprite_size.x + spritesheet.$gutter),
                    $y:                v * (spritesheet.sprite_size.y + spritesheet.$gutter),
                    $hasAlpha:         hasAlpha,
                    $requiresBlending: hasFractionalAlpha,
                    // Actual spritesheet for rendering
                    $spritesheet:      spritesheet,
                    // Source spritesheet for game logic
                    spritesheet:       spritesheet,
                    tile_index:        Object.freeze({x:u, y:v}),
                    id:                lastSpriteID,
                    orientation_id:    lastSpriteID,
                    size:              spritesheet.sprite_size,
                    scale:             PP,
                    pivot:             sspivot,
                    frames:            sheetDefaultframes,
                    mean_color:        mean_color
                };
                sprite.base = sprite;

                spritesheet[x][y] = sprite;

                const transposedSprite = {
                    $type:             'sprite',
                    $color:            centerColor,
                    $name:             sprite.$name + '.rotated_270.x_flipped',
                    $boundingRadius:   boundingRadius,

                    // Sprite index
                    $tileX:            sprite.$tileY,
                    $tileY:            sprite.$tileX,

                    // Pixel coord in tile
                    $x:                sprite.$y,
                    $y:                sprite.$x,

                    $hasAlpha:         sprite.$hasAlpha,
                    $requiresBlending: sprite.$requiresBlending,
                    $spritesheet:      transposedSpritesheet,
                    spritesheet:       spritesheet,
                    tile_index:        sprite.tile_index,
                    id:                lastSpriteID,
                    orientation_id:    lastSpriteID + 3,
                    size:              transposedSpritesheet.sprite_size,
                    scale:             PP,
                    pivot:             transposedPivot,
                    frames:            sheetDefaultframes,
                    base:              sprite,
                    mean_color:        sprite.mean_color
                };

                transposedSpritesheet[y][x] = transposedSprite;
                
                lastSpriteID += 6;
            }
            
            Object.freeze(spritesheet[x]);
        }

        // Process the name table
        if (json.names) {
            if (Array.isArray(json.names) || (typeof json.names !== 'object')) {
                throw new Error('The "names" entry in a sprite.json file must be an object (was "' + (typeof json.names) + '")');
            }

            // Excluded from the default property list
            const builtInProperties = ['', 'id', 'frames', 'x', 'y', 'x_flipped', 'y_flipped', 'rotated_90', 'rotated_180', 'rotated_270', 'scale', 'size', 'pivot', 'spritesheet', 'tile_index', 'start', 'end'];
            
            for (let anim in json.names) {
                const data = json.names[anim];
                
                // Error checking
                if ((data.start !== undefined && data.x !== undefined) || (data.start === undefined && data.x === undefined)) {
                    throw new Error('Animation data for "' + anim + '" must have either "x" and "y" fields or a "start" field, but not both');
                }
                
                const animDefaultframes = Math.max(0.25, data.default_frames || sheetDefaultframes);

                const ignoreFrames = data.ignore || 0;
                const rowMajor = data.majorAxis !== 'y';

                const otherProperties = {};
                for (const key in data) {
                    if (key[0] !== '$' && key[0] !== '_' && builtInProperties.indexOf(key) === -1) {
                        try {
                            otherProperties[key] = evalJSONGameConstant(data[key]);
                        } catch (e) {
                            throw e + " while parsing " + anim + "." + key;
                        }
                    }
                }
                
                const pivot = (data.pivot === undefined) ?
                      sspivot :
                      Object.freeze({x: data.pivot.x - json.sprite_size.x / 2, y: data.pivot.y - json.sprite_size.y / 2});

                const tpivot = (data.pivot === undefined) ?
                      transposedPivot :
                      Object.freeze({x: pivot.y, y: pivot.x})

                // Apply defaults
                if (data.x !== undefined) {
                    // Named sprite, no animation
                    const u = json.transpose ? data.y : data.x, v = json.transpose ? data.x : data.y;
                    if (u < 0 || u >= spritesheet.length || v < 0 || v >= spritesheet[0].length) {
                        throw new Error('Named sprite "' + anim + '" index xy(' + u + ', ' + v + ') ' + (json.transpose ? 'after transpose ' : '') + 'is out of bounds for the ' + spritesheet.length + 'x' + spritesheet[0].length + ' spritesheet "' + url + '".');
                    }

                    const sprite = spritesheet[anim] = spritesheet[u][v];

                    let s = sprite;
                    for (let repeat = 0; repeat < 2; ++repeat) {
                        // Copy other properties
                        Object.assign(s, otherProperties);
                        s.frames = animDefaultframes;
                        s.$animationName = anim;
                        s.$animationIndex = undefined;
                        s.pivot = repeat ? tpivot : pivot;

                        // Rename
                        s.$name = spritesheet.$name + '.' + anim;

                        // Repeat for the transposed sprite
                        s = transposedSpritesheet[v][u];
                    }

                } else {
                
                    if (data.end === undefined) { data.end = Object.assign({}, data.start); }
                    
                    if (data.end.x === undefined) { data.end.x = data.start.x; }
                
                    if (data.end.y === undefined) { data.end.y = data.start.y; }

                    if (data.start.x > data.end.x || data.start.y > data.end.y) {
                        throw new Error('Animation end bounds must be greater than or equal to the end on each axis for animation "' + anim + '".');
                    }
                    
                    const animation = spritesheet[anim] = [];
                    
                    const extrapolate = data.extrapolate || 'loop';
                    animation.extrapolate = extrapolate;

                    const frames = Array.isArray(data.frames) ?
                          data.frames : // array
                          (data.frames !== undefined) ?
                          [data.frames] : // number
                          [animDefaultframes]; // default

                    const W = data.end.x - data.start.x + 1;
                    const H = data.end.y - data.start.y + 1;
                    const N = W * H - ignoreFrames;

                    for (let i = 0; i < N; ++i) {
                        let x, y;
                        if (rowMajor) {
                            x = i % W;
                            y = Math.floor(i / W);
                        } else {
                            y = i % H;
                            x = Math.floor(i / H);
                        }

                        x += data.start.x;
                        y += data.start.y;
                            
                        const u = json.transpose ? y : x, v = json.transpose ? x : y;
                        if (u < 0 || u >= spritesheet.length || v < 0 || v >= spritesheet[0].length) {
                            throw new Error('Index xy(' + u + ', ' + v + ') in animation "' + anim + '" is out of bounds for the ' + spritesheet.length + 'x' + spritesheet[0].length + ' spritesheet.');
                        }
                        
                        const sprite = spritesheet[u][v];
                        
                        for (let repeat = 0, s = sprite; repeat < 2; ++repeat) {
                            s.$animationName = anim;
                            s.$animationIndex = i;
                            s.$name = spritesheet.$name + '.' + anim + '[' + i + ']';
                            s.pivot = repeat ? tpivot : pivot;
                            s.frames = Math.max(0.25, frames[Math.min(i, frames.length - 1)]);
                            s.animation = animation;
                            // Copy other properties
                            Object.assign(s, otherProperties);
                            s = transposedSpritesheet[v][u];
                        }
                        
                        animation.push(sprite);
                    }
                    
                    animation.period = 0;
                    animation.frames = (extrapolate === 'clamp' ? 0 : Infinity);
                    for (let i = 0; i < animation.length; ++i) {
                        const frames = animation[i].frames;
                        switch (extrapolate) {
                        case 'oscillate':
                            // The number of frames is infinite; compute the period
                            if (i === 0 || i === animation.length - 1) {
                                animation.period += frames;
                            } else {
                                animation.period += frames * 2;
                            }
                            break;
                            
                        case 'loop':
                            // The number of frames is infinite; compute the period
                            animation.period += frames;
                            break;

                        default: // clamp
                            animation.frames += frames;
                            break;
                        }
                    }

                    Object.freeze(animation);
                } // if single sprite
            }
        }

        // Create flipped and rotated versions and then freeze all sprites
        for (let x = 0; x < spritesheet.length; ++x) {
            for (let y = 0; y < spritesheet[x].length; ++y) {
                const sprite = spritesheet[x][y];
                const transposedSprite = transposedSpritesheet[y][x];

                // TODO: Transposed pivots
                
                // Construct the flipped versions and freeze all
                sprite.x_flipped = Object.assign({x_flipped:sprite}, sprite);
                sprite.x_flipped.scale = NP;
                sprite.x_flipped.orientation_id += 1;
                sprite.x_flipped.$name += '.x_flipped';
                sprite.x_flipped.pivot = Object.freeze({x: -sprite.pivot.x, y: sprite.pivot.y});

                sprite.y_flipped = Object.assign({y_flipped:sprite}, sprite);
                sprite.y_flipped.orientation_id += 2;
                sprite.y_flipped.scale = PN;
                sprite.y_flipped.$name += '.y_flipped';
                sprite.y_flipped.pivot = Object.freeze({x: sprite.pivot.x, y: -sprite.pivot.y});
                
                sprite.x_flipped.y_flipped = sprite.y_flipped.x_flipped = Object.assign({}, sprite);
                sprite.y_flipped.x_flipped.scale = NN;
                sprite.y_flipped.x_flipped.orientation_id += 3;
                sprite.x_flipped.y_flipped.$name += '.x_flipped.y_flipped';
                sprite.x_flipped.y_flipped.pivot = Object.freeze({x: -sprite.pivot.x, y: -sprite.pivot.y});
                
                transposedSprite.x_flipped = Object.assign({x_flipped: transposedSprite}, transposedSprite);
                transposedSprite.x_flipped.scale = NP;
                transposedSprite.x_flipped.orientation_id += 1;
                transposedSprite.x_flipped.$name = transposedSprite.$name.replace(/\.x_flipped$/, '');
                transposedSprite.x_flipped.pivot = Object.freeze({x: -transposedSprite.pivot.x, y: transposedSprite.pivot.y});
                
                transposedSprite.y_flipped = Object.assign({y_flipped: transposedSprite}, transposedSprite);
                transposedSprite.y_flipped.orientation_id += 2;
                transposedSprite.y_flipped.scale = PN;
                transposedSprite.y_flipped.$name += '.y_flipped';
                transposedSprite.y_flipped.pivot = Object.freeze({x: transposedSprite.pivot.x, y: -transposedSprite.pivot.y});
                
                transposedSprite.x_flipped.y_flipped = transposedSprite.y_flipped.x_flipped = Object.assign({}, transposedSprite);
                transposedSprite.y_flipped.x_flipped.scale = NN;
                transposedSprite.y_flipped.x_flipped.orientation_id += 3;
                transposedSprite.x_flipped.y_flipped.$name += transposedSprite.$name.replace(/\.x_flipped$/, '.y_flipped');
                transposedSprite.x_flipped.y_flipped.pivot = Object.freeze({x: -transposedSprite.pivot.x, y: -transposedSprite.pivot.y});

                sprite.rotated_270 = transposedSprite.x_flipped;
                sprite.x_flipped.rotated_270 = transposedSprite.x_flipped.y_flipped;
                sprite.y_flipped.rotated_270 = transposedSprite;
                sprite.x_flipped.y_flipped.rotated_270 = transposedSprite.y_flipped;

                transposedSprite.rotated_270 = sprite.x_flipped;
                transposedSprite.x_flipped.rotated_270 = sprite.x_flipped.y_flipped;
                transposedSprite.y_flipped.rotated_270 = sprite;
                transposedSprite.x_flipped.y_flipped.rotated_270 = sprite.y_flipped;

                const all = [sprite, transposedSprite];

                // Expand the permutations into an array for the final
                // steps, working backwards so that we can stay in the
                // same array
                for (let i = all.length - 1; i >= 0; --i) {
                    const s = all[i];
                    all.push(s.x_flipped, s.y_flipped, s.y_flipped.x_flipped);
                }

                for (let i = all.length - 1; i >= 0; --i) {
                    // Generate 180 deg and 270 degree rotation
                    // pointers to the existing sprites
                    const s = all[i];
                    s.rotated_180 = s.x_flipped.y_flipped;
                    s.rotated_90 = s.rotated_180.rotated_270;

                    // Verify that all transform elements are set on this sprite
                    console.assert(s.x_flipped);
                    console.assert(s.y_flipped);
                    console.assert(s.x_flipped.y_flipped);
                    console.assert(s.y_flipped.x_flipped);
                    console.assert(s.rotated_90);
                    console.assert(s.rotated_180);
                    console.assert(s.rotated_270);
                    
                    Object.freeze(s);
                } // i
            }
        }

        Object.freeze(spritesheet);
        Object.freeze(transposedSpritesheet);

        console.assert(spritesheet.$index[0] === spritesheetArray.indexOf(spritesheet));
        console.assert(transposedSpritesheet.$index[0] === spritesheetArray.indexOf(transposedSpritesheet));

        console.assert(spritesheet[0][0].rotated_270.$spritesheet.$index[0] === spritesheetArray.indexOf(spritesheet[0][0].rotated_270.$spritesheet),
                       'bad spritesheet index during loading');
        
        if (callback) { callback(spritesheet); }
    }

    // Used for preview.png and label*.png images when they are not
    // found on disk.
    
    function loadPlaceholderCallback(reason, url) {
        const size = url.endsWith('label64.png') ? {x: 64, y: 64} :
              url.endsWith('label128.png') ? {x: 128, y: 128} :
              {x: 1152, y: 1120}; // preview.png

        // Create empty image and flipped image 
        const data = new UInt16Array(size.x * size.y);
        data.width = size.x;
        data.height = size.y;
        
        spritesheetLoadCallback([data, data], null, url);
        
        return true;
    }
    
    // Change failure callback for preview.png and label*.png
    const isIndexingSprite =
          pngURL.endsWith('preview.png') ||
          pngURL.endsWith('label64.png') ||
          pngURL.endsWith('label128.png');
    
    const onFailure = isIndexingSprite ? loadPlaceholderCallback : loadFailureCallback;
          
    // The underlying PNG may be read from cache, but the value from
    // the preprocessor will not be read from cache because there is a
    // different preprocessing function for each call.
    loadManager.fetch(pngURL, 'image', preprocessor, spritesheetLoadCallback, onFailure, loadWarningCallback, forceReload);

    return spritesheet;
}


function recordSoundStats(sound) {
    if (sound.$name[0] !== '_') {
        ++resourceStats.sounds;
        const count = Math.ceil(4 * sound.$buffer.numberOfChannels * sound.$buffer.length / 1024);
        resourceStats.soundKilobytes += count;
        resourceStats.soundKilobytesByURL[sound.$url] = count;
    }
}


function loadSound(name, json, jsonURL) {
    const mp3URL = makeURLAbsolute(jsonURL, json.url);

    let sound = assetCache[jsonURL];
    if (sound) {
        // Print faux loading messages
        onLoadFileStart(mp3URL);
        onLoadFileComplete(mp3URL);
        return sound;
    }

    const forceReload = computeForceReloadFlag(mp3URL);

    assetCache[jsonURL] = sound = Object.seal({
        duration: 0,
        $loaded: false,
        $name: name,
        $src: mp3URL,
        $source: null,
        $buffer: null,
        $base_pan: clamp(json.pan || 0, 0, 1),
        $base_volume: clamp(json.volume || 1, 0, 100),
        $base_rate: clamp(json.rate || 1, 0, 100),
        $base_pitch: clamp(json.pitch || 1, 0, 100),
        $url: mp3URL,
        $type: 'sound',
        $json: json,
        $jsonURL: jsonURL});

    onLoadFileStart(mp3URL);
    loadManager.fetch(mp3URL, 'arraybuffer', null, function (arraybuffer) {
        // LoadManager can't see the async decodeAudioData calls
        ++loadManager.pendingRequests;

        try {
            audioContext.decodeAudioData(
                // The need for this apparently useless slice() is to
                // work around a Chrome multithreading bug
                // https://github.com/WebAudio/web-audio-api/issues/1175
                arraybuffer.slice(0),
                
                function onSuccess(buffer) {
                    sound.$buffer = buffer;
                    sound.$loaded = true;

                    // Create a buffer source, which primes this sound
                    // for playing without delay later.
                    sound.$source = audioContext.createBufferSource();
                    sound.$source.buffer = sound.$buffer;
                    sound.duration = sound.$source.buffer.duration;
                    onLoadFileComplete(json.url);
                    loadManager.markRequestCompleted(json.url, '', true);
                },
                
                function onFailure() {
                    loadManager.markRequestCompleted(mp3URL, 'unknown error', false);
                });
        } catch (e) {
            loadManager.markRequestCompleted(mp3URL, e, false);
        }
    }, loadFailureCallback, loadWarningCallback, forceReload);
    
    return sound;
}


function loadMap(name, json, mapJSONUrl) {
    const tmxURL = makeURLAbsolute(mapJSONUrl, json.url);

    let map = assetCache[mapJSONUrl];
    if (map) {
        // Print faux loading messages
        onLoadFileStart(tmxURL);
        onLoadFileComplete(tmxURL);

        // Make sure that the underlying spritesheets are up to date if they have been loaded
        const spritesheet = map.spritesheet;
        if (spritesheet && (spritesheetArray.indexOf(spritesheet) === -1)) {
            // Change the index and re-insert
            spritesheet.$index[0] = spritesheetArray.length;
            spritesheetArray.push(spritesheet);

            const transposedSpritesheet = spritesheet[0][0].rotated_270.$spritesheet;
            transposedSpritesheet.$index[0] = spritesheetArray.length;
            spritesheetArray.push(transposedSpritesheet);

            console.assert(map.spritesheet[0][0].$spritesheet.$index[0] === spritesheetArray.indexOf(map.spritesheet[0][0].$spritesheet),
                           'bad spritesheet index during map re-indexing');
            console.assert(map.spritesheet[0][0].rotated_270.$spritesheet.$index[0] === spritesheetArray.indexOf(map.spritesheet[0][0].rotated_270.$spritesheet),
                           'bad rotated spritesheet index during map re-indexing');
            
        }

        return map;
    }
    
    assetCache[mapJSONUrl] = map = Object.assign([], {
        $name:   name,
        $type:   'map',
        $url:    tmxURL,
        $flipYOnLoad: json.y_up || false,
        $json:   json,
        $jsonURL: mapJSONUrl,
        offset: Object.freeze(json.offset ? {x:json.offset.x, y:json.offset.y} : {x:0, y:0}),
        z_offset: json.z_offset || 0,
        z_scale: (json.z_scale !== undefined ? json.z_scale : 1),
        layer:  [],
        spritesheet_table:Object.create(null),
        sprite_size: Object.freeze({x:0, y:0}),
        size:        Object.freeze({x:0, y:0}),
        size_pixels: Object.freeze({x:0, y:0}),
        loop_x:      json.loop_x || false,
        loop_y:      json.loop_y || false
    });

    // Map loading proceeds in three steps:
    //
    // 1. Load the .spritesheet.json for the spritesheet referenced in the .map.json
    // 2. Load the spritesheet from its png file
    // 3. Load the map from its tmx file

    // Extract the spritesheet info
    if (json.sprite_url) {
        json.sprite_url_table = {'<default>': json.sprite_url};
    } else if (! json.sprite_url_table) {
        throw 'No sprite_url_table specified';
    }

    // Primary spritesheet. (Only one is supported in this version of quadplay.)
    const spritesheetUrl = makeURLAbsolute(mapJSONUrl, json.sprite_url_table[Object.keys(json.sprite_url_table)[0]]);

    const loadSpritesheetJSONCallback = function (spritesheetJson) {
        onLoadFileComplete(spritesheetUrl);
        loadSpritesheet(name + '.spritesheet', spritesheetJson, spritesheetUrl, loadSpritesheetCallback);
    };

    const loadSpritesheetCallback = function (spritesheet) {
        // Fetch the actual map data, given that we have the spritesheet
        map.spritesheet = spritesheet;
        loadManager.fetch(tmxURL, 'text', null, loadTMXCallback,
                          loadFailureCallback, loadWarningCallback,
                          computeForceReloadFlag(tmxURL));
    };
    
    const loadTMXCallback = function (xml) {
        onLoadFileComplete(tmxURL);
        xml = new DOMParser().parseFromString(xml, 'application/xml');
        
        // Custom properties
        let properties = xml.getElementsByTagName('properties');
        if (properties && properties.length > 0) {
            properties = properties[0].children;
            for (let i = 0; i < properties.length; ++i) {
                const node = properties[i];
                if (node.tagName === 'property') {
                    const name = node.getAttribute('name');
                    let value = node.getAttribute('value');
                    
                    switch (node.getAttribute('type')) {
                    case null:
                    case 'file':
                    case 'string':
                        // Nothing to do!
                        break;
                        
                    case 'color': // #AARRGGBB hex color
                        value = parseHexColor(value.substring(3) + value.substring(1, 3));
                        break;
                        
                    case 'bool':
                        value = (value !== 'false');
                        break;
                        
                    case 'float':
                        value = parseFloat(value);
                        break;
                        
                    case 'int':
                        value = parseInt(value);
                        break;
                    }
                    
                    if (name[0] !== '_') {
                        map[name] = value;
                    }
                }
            }
        } // if properties
        
        let tileSet = xml.getElementsByTagName('tileset');
        tileSet = tileSet[0];
        map.sprite_size = Object.freeze({x: parseInt(tileSet.getAttribute('tilewidth')),
                                         y: parseInt(tileSet.getAttribute('tileheight'))});
        const columns = parseInt(tileSet.getAttribute('columns'));
        const spritesheetName = tileSet.getAttribute('name');
        
        if ((Object.keys(json.sprite_url_table)[0] !== '<default>') &&
            (Object.keys(json.sprite_url_table)[0] !== spritesheetName)) {
            throw 'Spritesheet name "' + spritesheetName + '" in ' + spritesheetUrl + ' does not match the name from the map file ' + mapJSONUrl;
        }
        
        map.spritesheet_table[spritesheetName] = map.spritesheet;

        console.assert(map.spritesheet.$index[0] === spritesheetArray.indexOf(map.spritesheet));
        console.assert(map.spritesheet[0][0].rotated_270.spritesheet.$index[0] === spritesheetArray.indexOf(map.spritesheet[0][0].rotated_270.spritesheet));
        
        let image = xml.getElementsByTagName('image')[0];
        const size = {x: parseInt(image.getAttribute('width')),
                      y: parseInt(image.getAttribute('height'))};
        const filename = image.getAttribute('source');
        
        if ((map.spritesheet.sprite_size.x !== map.sprite_size.x) || (map.spritesheet.sprite_size.y !== map.sprite_size.y)) {
            throw `Sprite size (${map.spritesheet.sprite_size.x}, ${map.spritesheet.sprite_size.y}) does not match what the map expected, (${map.sprite_size.x}, ${map.sprite_size.y}).`;
        }
        
        if ((map.spritesheet.size.x !== size.x) || (map.spritesheet.size.y !== size.y)) {
            throw `Sprite sheet size (${map.spritesheet.size.x}, ${map.spritesheet.size.y}) does not match what the map expected, (${size.x}, ${size.y}).`;
        }

        const layerList = Array.from(xml.getElementsByTagName('layer'));
        const layerData = layerList.map(function (layer) {
            map.size = Object.freeze({x: parseInt(layer.getAttribute('width')),
                                      y: parseInt(layer.getAttribute('height'))});
            // Can't directly pass parseInt for some reason
            return layer.lastElementChild.innerHTML.split(',').map(function (m) { return parseInt(m); });
        });
        
        const flipY = (json.y_up === true);
        for (let L = 0; L < layerList.length; ++L) {
            // The first level IS the map itself
            const layer = (L === 0) ? map : new Array(map.size.x);
            const data = layerData[L];
            
            // Construct the layer's columns and prevent them from being extended
            for (let x = 0; x < map.size.x; ++x) {
                layer[x] = new Array(map.size.y);
            }
            map.layer.push(layer);
            
            // Extract CSV values
            for (let y = 0, i = 0; y < map.size.y; ++y) {
                for (let x = 0; x < map.size.x; ++x, ++i) {
                    const gid = data[i];
                    
                    // See https://doc.mapeditor.org/en/stable/reference/tmx-map-format/#tile-flipping
                    const tileFlipX = (gid & 0x80000000) !== 0;
                    const tileFlipY = (gid & 0x40000000) !== 0;
                    const tileFlipD = (gid & 0x20000000) !== 0;
                    const tmxIndex  = (gid & 0x0fffffff) - 1;
                    
                    if (tmxIndex >= 0) {
                        const sx = tmxIndex % columns;
                        const sy = Math.floor(tmxIndex / columns);
                        
                        let sprite = map.spritesheet[sx][sy];
                        
                        if (tileFlipD) { sprite = sprite.rotated_90.y_flipped; }
                        if (tileFlipX) { sprite = sprite.x_flipped; }
                        if (tileFlipY) { sprite = sprite.y_flipped; }
 
                        console.assert(sprite.$spritesheet.$index[0] === spritesheetArray.indexOf(sprite.$spritesheet),
                                       'bad spritesheet index during map loading');
        
                        console.assert(sprite);
                        layer[x][flipY ? map.size.y - 1 - y : y] = sprite;
                    } else {
                        layer[x][flipY ? map.size.y - 1 - y : y] = undefined;
                    } // if not empty
                } // x
            } // y
            
            // Prevent the arrays themselves from being reassigned. Disabled
            // to allow map resizing
            //for (let x = 0; x < map.size.x; ++x) {
            //    Object.preventExtensions(Object.seal(layer[x]));                
            //}
            
        } // L

        map.size_pixels = Object.freeze({x:map.size.x * map.sprite_size.x, y:map.size.y * map.sprite_size.y});

        console.assert(map.spritesheet[0][0].rotated_270.$spritesheet.$index[0] === spritesheetArray.indexOf(map.spritesheet[0][0].rotated_270.$spritesheet),
                       'bad rotated spritesheet index during map loading');

        // Don't allow the array of arrays to be changed (just the individual elements)
        // Disabled to allow map resizing
        //Object.freeze(map.layer);
    };

    // Start the process by loading the spritesheet data. We first have to load
    // the JSON for the spritesheet itself, which loadSpritesheet() expects to be
    // already processed
    onLoadFileStart(spritesheetUrl);
    
    loadManager.fetch(spritesheetUrl, 'text', jsonParser, loadSpritesheetJSONCallback,
                      loadFailureCallback, loadWarningCallback);
    
    return map;
}


/** 

 Maps URLs to their contents for display and editing in the IDE.
 *Not* for caching purposes during loading. 
    
 pngUrl  -> Image
 pyxlUrl -> text string of file contents
 jsonUrl -> text string of the .json file, not the parsed JSON object 


 When the gameSource.json is changed, fileContents for it is
 immediately regenerated to keep it from getting out of sync.
*/
let fileContents = {};

/* Store the original value, unmodified, in fileContents so that it
   can be accessed by the IDE for editing. */
function jsonParser(source, url) {
    fileContents[url] = source;
    return WorkJSON.parse(source);
}


/** Resource tracking for reporting limits in the IDE */
let resourceStats = {};

function modeNameToFileName(modeName) {
    return modeName.replace(/\*/, '') + '.pyxl';
}


/* 
   Takes an already-loaded image and creates an ImageData for it.

   JavaScript imageData colors on a little endian machine:

   - In hex as a uint32, the format is 0xAABBGGRR.
   - Aliased to a Uint8Clamped array, im = [RR, GG, BB, AA]
*/
function getImageData(image) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = image.width;
    tempCanvas.height = image.height;
    
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(image, 0, 0, image.width, image.height);
    
    return tempCtx.getImageData(0, 0, image.width, image.height);
}


function addCodeToSourceStats(code, scriptURL) {
    if ((scriptURL.replace(/^.*\//, '')[0] === '_') ||
        scriptURL.startsWith('quad://scripts/') ||
        scriptURL.startsWith(location.href.replace(/\/console\/quadplay\.html.*$/, '/scripts/'))) {
        // Ignore statements from system files
        return;
    }

    // Remove strings
    code = code.replace(/"(?:[^"\\]|\\.)*"/g, '');

    // Remove comments
    code = code.replace(/\/\*([\s\S]*?)\*\//g, '');
    code = code.replace(/\/\/.*$/gm, '');

    // Compact literals
    const lineArray = code.split('\n');
    try {
        compactMultilineLiterals(lineArray);
    } catch (e) {
        // Error occured during compaction of multiline literals
        e.url = scriptURL;
        console.log(e);
    }
    code = lineArray.join('\n');

    // Remove section headers
    const sectionRegex = /(?:^|\n).*\n[-─—━⎯=═⚌]{5,}[ \t]*\n/gm;
    code = code.replace(sectionRegex, '\n');

    // Remove function definition lines
    code = code.replace(/\n *def [^\n]+: *\n/gm, '\n');

    // Remove variable declarations with no assignment
    code = code.replace(/^ *let +[^ \n=]+ *$/gm, '');

    // Remove LOCAL, WITH, and PRESERVING_TRANSFORM lines
    code = code.replace(/\n *&? *(local:?|preserving_transform:?|with .*) *\n/gm, '\n');

    // Remove ELSE without following IF:
    code = code.replace(/\n *else: *\n/g, '\n');

    // Remove DEBUG_WATCH, DEBUG_PRINT, TODO, and ASSERT (assume that they are on their own lines to simplify parsing)
    code = code.replace(/(debug_watch|debug_print|todo|assert) *\(.*\n/g, '\n');

    // Remove blank lines
    code = code.replace(/\n\s*\n/g, '\n');

    const count = Math.max(1, (code.split(';').length - 1) + (code.split('\n').length - 1) - 1);

    resourceStats.sourceStatementsByURL[scriptURL] = count;
    
    resourceStats.sourceStatements += count;
}


function loadFailureCallback(reason, url) {
    console.log(`ERROR: Failed to load "${url}". ${reason || ''}`);
}


function loadWarningCallback(reason, url) {
    $outputAppend(url + ': ' + reason + '\n');
}


/** Returns everything up to the final slash from a URL */
function urlDir(url) {
    return url.replace(/\?.*$/, '').replace(/\/[^/]*$/, '/');
}

function urlFile(url) {
    return url.substring(url.lastIndexOf('/') + 1);
}

/** When reloading, force assets to be loaded from disk if using the IDE
    and they are not built-in or fastReload is false. */
function computeForceReloadFlag(url) {
    return useIDE && ! (fastReload && isBuiltIn(url));
}

/** Returns the childURL made absolute relative to the parent. The
    result will be a valid http:// url, never a quad:// url. */
function makeURLAbsolute(parentURL, childURL) {
    if (childURL.startsWith('quad://')) {
        // quad URL. Make relative to the quadplay installation
        return childURL.replace(/^quad:\/\//, urlDir(location.href) + '../').replace(/\/console\/\.\.\//, '/');
    } else if (/^.{3,6}:\/\//.test(childURL)) {
        // Already absolute, some other protocol
        return childURL;
    } else if (/^[\\/]/.test(childURL)) {
        // Absolute on the server, Unix path. Copy the host and protocol
        const match = parentURL.match(/^.{3,6}:\/\/.*?(?=\/)/);
        if (match) {
            return match[0] + childURL;
        } else {
            // Hope...
            return childURL;
        }
    } else if (/^[A-Za-z]:[\\\/]/.test(childURL)) {
        // Absolute on the server, Windows path. Copy the host and protocol
        const match = parentURL.match(/^.{3,6}:\/\/.*?(?=\/)/);
        if (match) {
            return match[0] + '/' + childURL;
        } else {
            // Hope...
            return childURL;
        }
    } else {

        // Strip the last part of the parent
        const url = urlDir(parentURL) + childURL;
        
        // Hide the common case of console/.. in URLs
        return url.replace(/\/console\/\.\.\//, '/');
    }
}


/** Returns the filename portion of the URL */
function urlFilename(url) {
    return url.replace(/^.*\//, '');
}


/** Recursively replaces null with undefined, mutating any structures and returning the result. */
function nullToUndefined(x) {
    if (x === null) {
        x = undefined;
    } else if (Array.isArray(x)) {
        for (let i = 0; i < x.length; ++i) {
            x[i] = nullToUndefined(x[i]);
        }
    } else if (typeof x === 'object') {
        const keys = Object.keys(x);
        for (let k = 0; k < keys.length; ++k) {
            const key = keys[k];
            x[key] = nullToUndefined(x[key]);
        }
    }
    return x;
}


function regexIndexOf(text, re, i) {
    const indexInSuffix = text.substring(i).search(re);
    return indexInSuffix < 0 ? text.length : indexInSuffix + i;
}


/** Parse the JSON value starting at character i. Also used by the
   runtime as QRuntime.parse(str) */
function $parse(source, i) {
    i = i || 0;
    if (typeof source !== 'string') {
        throw new Error('parse() requires a string as an agument');
    }
    
    while (i < source.length) {
        switch (source[i]) {
        case ' ': case '\t': case '\n':
            // Nothing to do
            ++i;
            break;
            
        case '"': // Quoted string
            ++i;
            const begin = i;
            while (i < source.length && (source[i] !== '"' || source[i - 1] === '\\')) { ++i; }
            return {result: source.substring(begin, i), next: i + 1};
            
        case '[': // Array
            ++i;
            // Consume the leading space
            while (' \t\n'.indexOf(source[i]) !== -1) { ++i; }
            const a = [];
            while ((i < source.length) && (source[i] !== ']')) {                
                const child = $parse(source, i);

                if (child.result === '…') {
                    // This is a recursive array
                    while (i < source.length && source[i] !== ']') { ++i; }
                    return {result: [], next: i + 1};
                }

                a.push(child.result);
                i = child.next;
                // Consume the trailing space and comma. For simplicity, don't require
                // correct structure in the source here.
                while (', \t\n'.indexOf(source[i]) !== -1) { ++i; }
            }
            // consume the ']'
            return {result: a, next: i + 1}
            break;
            
        case '{': // Object
            ++i;
            const t = {};
            // Consume the leading space
            while (' \t\n'.indexOf(source[i]) !== -1) { ++i; }
            while ((i < source.length) && (source[i] !== '}')) {
                // Read the key
                let key;
                if (source[i] === '"') {
                    // The key is in quotes
                    const temp = $parse(source, i);
                    key = temp.result;
                    i = temp.next;
                } else {
                    // Scan until the next separator
                    const end = regexIndexOf(source, /[: \n\t"]/, i);
                    key = source.substring(i, end);
                    i = end;
                }

                if (key === '…') {
                    // This is a recursive empty table
                    while (i < source.length && source[i] !== '}') { ++i; }
                    return {result: {}, next: i + 1};
                }

                // Consume the colon and space
                while (': \t\n'.indexOf(source[i]) !== -1) { ++i; }

                // Read the value
                const value = $parse(source, i);
                t[key] = value.result;
                i = value.next;
                // Consume the trailing space and comma
                while (', \t\n'.indexOf(source[i]) !== -1) { ++i; }
            }
            // consume the '}'
            return {result: t, next: i + 1}
            break;
            
        default: // a constant
            // Scan until the next separator
            const end = regexIndexOf(source, /[,:\[{}\] \n\t"]/, i);
            const token = source.substring(i, end).toLowerCase();

            switch (token.substring(0, 2)) {
            case '0x': return {result: parseInt(token), next: end};
            case '0b': return {result: parseInt(token.substring(2), 2), next: end};
            } // switch for hex and binary constants
            
            switch (token) {
            case 'true': return {result: true, next: end};
            case 'false': return {result: false, next: end};
            case 'nil': case '∅': case 'builtin': return {result: undefined, next: end};
            case 'function': return {result: (function () {}), next: end};
            case 'infinity': case '∞': case '+infinity': case '+∞': return {result: Infinity, next: end};
            case '-infinity': case '-∞': return {result: -Infinity, next: end};
            case 'nan': return {result: NaN, next: end};
            case 'pi': case 'π': case '+pi': case '+π': return {result: Math.PI, next: end};
            case '-pi': case '-π': return {result: -Math.PI, next: end};
            case '¼pi': case '¼π': case '+¼pi': case '+¼π': return {result: Math.PI/4, next: end};
            case '-¼pi': case '-¼π': return {result: -Math.PI/4, next: end};
            case '½pi': case '½π': case '+½pi': case '+½π': return {result: Math.PI/4, next: end};
            case '-½pi': case '-½π': return {result: -Math.PI/4, next: end};
            case '¾pi': case '¾π': case '+¾pi': case '+¾π': return {result: Math.PI*3/4, next: end};
            case '-¾pi': case '-¾π': return {result: -Math.PI*3/4, next: end};
            case '¼': return {result: 1/4, next: end};
            case '½': return {result: 1/2, next: end};
            case '¾': return {result: 3/4, next: end};
            case '⅓': return {result: 1/3, next: end};
            case '⅔': return {result: 2/3, next: end};
            case '⅕': return {result: 1/5, next: end};
            case '⅖': return {result: 2/5, next: end};
            case '⅗': return {result: 3/5, next: end};
            case '⅘': return {result: 4/5, next: end};
            case '⅙': return {result: 1/6, next: end};
            case '⅚': return {result: 5/6, next: end};
            case '⅐': return {result: 1/7, next: end};
            case '⅛': return {result: 1/8, next: end};
            case '⅜': return {result: 3/8, next: end};
            case '⅝': return {result: 5/8, next: end};
            case '⅞': return {result: 7/8, next: end};
            case '⅑': return {result: 1/9, next: end};
            case '⅒': return {result: 1/10, next: end};
            case '-¼': return {result: -1/4, next: end};
            case '-½': return {result: -1/2, next: end};
            case '-¾': return {result: -3/4, next: end};
            case '-⅓': return {result: -1/3, next: end};
            case '-⅔': return {result: -2/3, next: end};
            case '-⅕': return {result: -1/5, next: end};
            case '-⅖': return {result: -2/5, next: end};
            case '-⅗': return {result: -3/5, next: end};
            case '-⅘': return {result: -4/5, next: end};
            case '-⅙': return {result: -1/6, next: end};
            case '-⅚': return {result: -5/6, next: end};
            case '-⅐': return {result: -1/7, next: end};
            case '-⅛': return {result: -1/8, next: end};
            case '-⅜': return {result: -3/8, next: end};
            case '-⅝': return {result: -5/8, next: end};
            case '-⅞': return {result: -7/8, next: end};
            case '-⅑': return {result: -1/9, next: end};
            case '-⅒': return {result: -1/10, next: end};
            default:
                if (/(deg|°)$/.test(token)) {
                    return {result: parseFloat(token) * Math.PI / 180, next: end};
                } else if (/%$/.test(token)) {
                    return {result: parseFloat(token) / 100, next: end};
                } else {
                    return {result: parseFloat(token), next: end};
                }
            } // switch on token
        } // switch on character
    } // while

    throw new Error('hit the end of "' + source + '"');
}


/** Evaluate a constant value from a JSON definition. Used only while loading. */
function evalJSONGameConstant(json) {
    if (typeof json === 'number' || typeof json === 'string' || typeof json === 'boolean') {
        // Raw values
        return json;
    }

    switch (json.type) {
    case 'nil':
        return undefined;
        
    case 'raw':
        if (json.url !== undefined) {
            // We only allow raw at top level because otherwise we'd have to traverse
            // constants during loading or load during constant evaluation, and would also
            // have to deal with this mess from the GUI.
            throw 'Raw values with URLs only permitted for top-level constants';
        }
        
        // Replace null with undefined, but otherwise directly read the value
        return nullToUndefined(json.value);
        
    case 'number':
        if (typeof json.value === 'number') {
            return json.value;
        } else {
            return $parse(json.value.trim()).result;
        }
        break;
        
    case 'boolean': return (json.value === true) || (json.value === 'true');

    case 'string': return json.value;

    case 'xy':
        return {x: evalJSONGameConstant(json.value.x),
                y: evalJSONGameConstant(json.value.y)};

    case 'xz':
        return {x: evalJSONGameConstant(json.value.x),
                z: evalJSONGameConstant(json.value.z)};
        
    case 'xyz':
        return {x: evalJSONGameConstant(json.value.x),
                y: evalJSONGameConstant(json.value.y),
                z: evalJSONGameConstant(json.value.z)};

    case 'hsv':
        return {h: evalJSONGameConstant(json.value.h),
                s: evalJSONGameConstant(json.value.s),
                v: evalJSONGameConstant(json.value.v)};
        
    case 'hsva':
        return {h: evalJSONGameConstant(json.value.h),
                s: evalJSONGameConstant(json.value.s),
                v: evalJSONGameConstant(json.value.v),
                a: evalJSONGameConstant(json.value.a)};
        
    case 'rgb':
        if (typeof json.value === 'object') {
            return {r: evalJSONGameConstant(json.value.r),
                    g: evalJSONGameConstant(json.value.g),
                    b: evalJSONGameConstant(json.value.b)};
        } else if ((typeof json.value === 'string') && (json.value[0] === '#')) {
            // Parse color
            const c = parseHexColor(json.value.substring(1));
            return {r: c.r, g: c.g, b: c.b};
        } else {
            throw 'Illegal rgb value: ' + json.value;
        }

    case 'rgba':
        if (typeof json.value === 'object') {
            return {r: evalJSONGameConstant(json.value.r),
                    g: evalJSONGameConstant(json.value.g),
                    b: evalJSONGameConstant(json.value.b),
                    a: evalJSONGameConstant(json.value.a)};
        } else if (typeof json.value === 'string' && json.value[0] === '#') {
            // Parse color
            return parseHexColor(json.value.substring(1));
        } else {
            throw 'Illegal rgba value: ' + json.value;
        }

    case 'distribution':
        {
            if (typeof json.value !== 'object') {
                throw 'Distribution constant must have an object {} value field';
            }
            const keys = Object.keys(json.value);
            const result = {};
            for (let i = 0; i < keys.length; ++i) {
                const key = keys[i];
                result[key] = evalJSONGameConstant(json.value[key]);
                if (typeof result[key] !== 'number') {
                    throw 'Value for ' + key + ' of distribution constant must be a number';
                }
            }
            return result;
        }

    case 'object':
        {
            if (typeof json.value !== 'object') {
                throw 'Object constant must have an object {} value field';
            }
            const keys = Object.keys(json.value);
            const result = {};
            for (let i = 0; i < keys.length; ++i) {
                const key = keys[i];
                result[key] = evalJSONGameConstant(json.value[key]);
            }
            return result;
        }

    case 'array':
        {
            if (! Array.isArray(json.value)) {
                throw 'Array constant must have an array [] value field';
            }
            const result = [];
            for (let i = 0; i < json.value.length; ++i) {
                result.push(evalJSONGameConstant(json.value[i]));
            }
            return result;
        }

    case 'reference':
        {
            throw 'References only permitted for top-level constants';
            return undefined;
        }

    default:
        throw 'Unrecognized data type: "' + json.type + '" in constant definition ' + JSON.stringify(json);
    }
}


/** Transposes an array of arrays and returns the new grid */
function transposeGrid(src) {
    const dst = [];
    dst.length = src[0].length;
    for (let i = 0; i < dst.length; ++i) {
        dst[i] = [];
        dst[i].length = src.length;
        for (let j = 0; j < src.length; ++j) {
            dst[i][j] = src[j][i];
        }
    }
    return dst;
}



/** Given a CSV file as a text string, parses into a row-major array of arrays 

 Based on https://www.bennadel.com/blog/1504-ask-ben-parsing-csv-strings-with-javascript-exec-regular-expression-command.htm
 via https://stackoverflow.com/questions/1293147/javascript-code-to-parse-csv-data
 via https://gist.github.com/Jezternz/c8e9fafc2c114e079829974e3764db75
*/
function parseCSV(strData, trim) {
    // Trim trailing newline
    if (strData.endsWith('\n')) {
        strData = strData.slice(0, strData.length - 1);
    }
    
    const objPattern = /(,|\r?\n|\r|^)(?:"([^"]*(?:""[^"]*)*)"|([^,\r\n]*))/gi;
    let arrMatches = null, data = [[]];
    while (arrMatches = objPattern.exec(strData)) {
        if (arrMatches[1].length && arrMatches[1] !== ',') {
            data.push([]);
        }
        
        data[data.length - 1].push(arrMatches[2] ? 
            arrMatches[2].replace(/""/g, '"') :
            arrMatches[3]);
    }

    // Find the max array length
    let max = 0;
    for (let i = 0; i < data.length; ++i) { max = Math.max(max, data[i].length); }

    // Look for quadplay special patterns and normalize array lengths
    for (let r = 0; r < data.length; ++r) {
        const array = data[r];
        
        for (let c = 0; c < array.length; ++c) {
            let val = array[c];
            const v = /^ *[-+]?[0-9]*\.?[0-9]*([eE][-+]?\d+)?(%|deg)? *$/.test(val) ? parseFloat(val) : NaN;
            if (! isNaN(v)) {
                array[c] = v;
                val = val.trim();
                if (val.endsWith('%')) {
                    array[c] /= 100;
                } else if (val.endsWith('deg')) {
                    array[c] *= Math.PI / 180;
                }
            } else if (val && (typeof val === 'string') && (val.length > 0)) {
                // May be a special string
                if (trim) {
                    val = array[c] = array[c].trim();
                }

                switch (val) {
                case 'infinity': case '+infinity':
                    array[c] = Infinity;
                    break;
                    
                case '-infinity':
                    array[c] = -Infinity;
                    break;
                    
                case 'nil': case 'null':
                    array[c] = undefined;
                    break;
                    
                case 'NaN': case 'nan':
                    array[c] = NaN;
                    break;
                    
                case 'TRUE': case 'true':
                    array[c] = true;
                    break;
                    
                case 'FALSE': case 'false':
                    array[c] = false;
                    break;
                
                default:
                    if (/^[\$¥€£§][+\-0-9\.e]+$/.test(val)) {
                        array[c] = parseFloat(val.substring(1));
                    }                       
                } // switch
            } // nonempty string
        } // for each column
        
        if (array.length < max) {
            const old = array.length;
            array.length = max;
            array.fill(old, max, '');
        }
    }

    return data;
}

/** Used by both constants and assets to load and parse a CSV file.
    Stores the result into outputObject[outputField] and then 
    invokes callback() if it is specified.

*/
function loadCSV(csvURL, definition, outputObject, outputField, callback) {
    const arrayOutput = definition.type === 'array';
    
    console.assert(definition.type === 'csv' || arrayOutput);
    console.assert(outputObject);
    
    loadManager.fetch(csvURL, 'text', null, function (csv) {
        // Parse cells
        let grid = parseCSV(csv, definition.trim !== false);

        // By parseCSV returns row-major data and tables in quadplay
        // default to column major, so transpose the CSV parse
        // oppositely to the transpose flag.
        if (! definition.transpose) {
            grid = transposeGrid(grid);
        }

        const row_type = arrayOutput ? 'array' : (definition.transpose ? definition.column_type : definition.row_type) || 'object';
        const col_type = arrayOutput ? 'array' : (definition.transpose ? definition.row_type : definition.column_type) || 'object';

        if (! arrayOutput && (definition.ignore_first_row || (definition.ignore_first_column && definition.transpose))) {
            // Remove the first row of each column
            for (let x = 0; x < grid.length; ++x) {
                grid[x].shift();
            }
        }
        
        if (! arrayOutput && (definition.ignore_first_column || (definition.ignore_first_row && definition.transpose))) {
            // Remove the first column
            grid.shift();
        }
        
        // Parse table
        let data;
        
        if ((col_type === 'array') && (row_type === 'array')) {
            // This is the data structure that we already have
            // in memory
            data = grid;
        } else {
            if (row_type === 'object') {
                data = {};
                if (col_type === 'object') {
                    // Object of objects
                    for (let c = 1; c < grid.length; ++c) {
                        const dst = data[grid[c][0]] = {};
                        const src = grid[c];
                        for (let r = 1; r < grid[0].length; ++r) {
                            dst[grid[0][r]] = src[r];
                        }
                    } // for each column (key)
                    
                } else { // row_type == 'array'
                    
                    // Object of arrays. The first row contains the object property names
                    for (let c = 0; c < grid.length; ++c) {
                        data[grid[c][0]] = grid[c].slice(1);
                    } // for each column (key)
                }
            } else {
                // Array of objects. The first column contains the object property names
                data = new Array(grid.length - 1);
                for (let c = 0; c < data.length; ++c) {
                    const src = grid[c + 1];
                    const dst = data[c] = {};
                    for (let r = 0; r < src.length; ++r) {
                        dst[grid[0][r]] = grid[c + 1][r];
                    } // for row
                } // for col
            } // array of objects
        }

        if (definition.type === 'array') {
            // Convert to a single flat array
            const old = data;
            data = new Array();
            for (const a of old) {
                for (const v of a) {
                    data.push(v);
                }
            }
        }

        outputObject[outputField] = data;
        if (callback) { callback(); }
    });
}


/** Used by both constants and assets to load and parse a TXT file.
    Stores the result into outputObject[outputField] and then 
    invokes callback() if it is specified.
 */
function loadTXT(txtURL, definition, outputObject, outputField, callback) {
    console.assert(outputObject);
    loadManager.fetch(txtURL, 'text', null, function (text) {
        // Convert to unix newlines
        outputObject[outputField] = text.replace(/\r/g, '');
        if (callback) { callback(); }
    });
}
