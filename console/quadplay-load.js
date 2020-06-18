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
   - `loadSpritesheet`

   Also exports helpers `parseHexColor` and `parseHex`
*/
"use strict";

// Allocated by afterLoadGame
let loadManager = null;

let alreadyCountedSpritePixels = {};

let lastSpriteID = 0;

// Type used as the value of a constant that references
// another constant or asset
function GlobalReference(name) { this.identifier = name; }

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


// Loads the game and then runs the callback() or errorCallback()
function afterLoadGame(gameURL, callback, errorCallback) {
    // Use a random starting ID so that programmers who don't read the
    // manual won't assume it will be the same for each run and start
    // hardcoding constants that future implementation changes may break.
    lastSpriteID = Math.round(Math.random() * 8192);
    
    loadManager = new LoadManager({
        callback: function () {
            computeAssetCredits(gameSource);
            if (callback) { callback(); }
        },
        errorCallback: errorCallback,
        jsonParser: 'permissive',
        forceReload: false});

    // If given a directory, assume that the file has the same name
    if (! /\.game\.json$/i.test(gameURL)) {
        // Remove trailing slash
        if (gameURL[gameURL.length - 1] === '/') { gameURL = gameURL.substring(0, gameURL.length - 1); }
        gameURL = gameURL.replace(/(\/|^)([^\/]+)$/, '$1$2/$2.game.json');
    }
    gameURL = makeURLAbsolute(location.href, gameURL);
    window.gameURL = gameURL;
    console.log('Loading ' + gameURL);
    
    // Wipe the caches
    fileContents = {};
    alreadyCountedSpritePixels = {};
    gameSource = {};

    // Global arrays for abstracting hardware memory
    // copies of spritesheet and font data
    spritesheetArray = [];
    fontArray = [];
    
    resourceStats = {
        spritePixels: 0,
        spritesheets: 0,
        maxSpritesheetWidth: 0,
        maxSpritesheetHeight: 0,
        sourceStatements: 0,
        sounds: 0
    };

    loadManager.fetch(gameURL, 'json', null, function (gameJSON) {
        if (! Array.isArray(gameJSON.modes)) { throw new Error('The modes parameter is not an array'); }
        if (gameJSON.assets === undefined) { gameJSON.assets = {}; }
        if (typeof gameJSON.assets !== 'object') { throw 'The assets parameter is not an object in ' + gameURL; }

        for (const assetName in gameJSON.assets) {
            if (assetName[0] === '_') { throw 'Illegal asset name: "' + assetName + '"'; }
        }

        // Store the original value, unmodified, so that it
        // can be accessed by the IDE for editing
        fileContents[gameURL] = gameSource.json = gameJSON;

        //////////////////////////////////////////////////////////////////////////////////////////////

        // Clone for the extended version actually loaded
        gameJSON = deep_clone(gameJSON);
        gameSource.extendedJSON = gameJSON;
        
        // Inject OS script dependencies
        gameJSON.modes.push(
            'quad://console/os/_SystemMenu',
            'quad://console/os/_ConfirmDialog',
            'quad://console/os/_GameCredits',
            'quad://console/os/_SetControls',
            'quad://console/os/_SetControls64'
        );

        // Any changes here must also be updated in the os_dependencies variable in tools/export.py
        gameJSON.assets = Object.assign(gameJSON.assets, os_dependencies);
        //////////////////////////////////////////////////////////////////////////////////////////////
        
        gameSource.jsonURL = gameURL;
        if (gameJSON.screen_size === undefined) {
            gameJSON.screen_size = {x: 384, y:224};
        }

        const allowedScreenSizes = [{x: 384, y: 224}, {x: 192, y: 112}, {x: 128, y: 128}, {x: 64, y: 64}];
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
                
                loadManager.fetch(scriptURL, 'text', null, function (scriptText) {
                    scriptText = scriptText.replace(/\r/g, '');
                    addCodeToSourceStats(scriptText, scriptURL);
                    fileContents[scriptURL] = scriptText;
                }, null, null, computeForceReloadFlag(scriptURL));
            }
        }

        // Modes:
        {
            gameSource.modes = [];
            let numStartModes = 0;
            for (let i = 0; i < gameJSON.modes.length; ++i) {
                const modeURL = makeURLAbsolute(gameURL, gameJSON.modes[i].replace('*', '') + '.pyxl');

                if (gameJSON.modes[i].indexOf('*') !== -1) {
                    ++numStartModes;
                }

                // Remove the quad://... from internal modes
                gameSource.modes.push({name: gameJSON.modes[i].replace(/^.*\//, ''), url:modeURL});                
            }

            if (numStartModes === 0) {
                throw new Error('No starting mode (noted with *)');
            } else if (numStartModes > 1) {
                throw new Error('Too many starting modes (noted with *)');
            }

            // Load all modes
            for (let i = 0; i < gameSource.modes.length; ++i) {
                const mode = gameSource.modes[i];
                loadManager.fetch(mode.url, 'text', null, function (modeCode) {
                    modeCode = modeCode.replace(/\r/g, '');
                    addCodeToSourceStats(modeCode, mode.url);
                    fileContents[mode.url] = modeCode;
                }, null, null, computeForceReloadFlag(mode.url));
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
                const assetURL = makeURLAbsolute(gameURL, gameJSON.assets[a]), assetName = a;
                let type = assetURL.match(/\.([^.]+)\.json$/i);
                if (type) { type = type[1].toLowerCase(); }

                loadManager.fetch(assetURL, 'json', null, function (json) {
                    // assetURL is the asset json file
                    // json.url is the png, mp3, etc. referenced by the file
                    fileContents[assetURL] = json;
                    
                    switch (type) {
                    case 'font':
                        gameSource.assets[assetName] = loadFont(assetName, json, assetURL);
                        break;
                        
                    case 'sprite':
                        gameSource.assets[assetName] = loadSpritesheet(assetName, json, assetURL, null);
                        break;
                        
                    case 'sound':
                        console.assert(gameSource);
                        console.assert(gameSource.assets);
                        gameSource.assets[assetName] = loadSound(assetName, json, assetURL);
                        break;
                        
                    case 'map':
                        gameSource.assets[assetName] = loadMap(assetName, json, assetURL);
                        break;
                        
                    default:
                        console.log('Unrecognized asset type: "' + type + '"');
                    }

                });
            } // for each asset
        } // Assets

        // Constants:
        gameSource.constants = {};
        if (gameJSON.constants) {
            // Sort constants alphabetically
            const keys = Object.keys(gameJSON.constants);
            keys.sort();
            let hasReferences = false;
            for (let i = 0; i < keys.length; ++i) {
                const c = keys[i];
                const definition = gameJSON.constants[c];
                if ((definition.type === 'raw') && (definition.url !== undefined)) {
                    // Raw value loaded from a URL
                    const constantURL = makeURLAbsolute(gameURL, definition.url);
                    if (/\.json$/.test(constantURL)) {
                        loadManager.fetch(constantURL, 'json', nullToUndefined, function (data) {
                            gameSource.constants[c] = data;
                        });
                    } else if (/\.yml$/.test(constantURL)) {
                        loadManager.fetch(constantURL, 'text', null, function (yaml) {
                            const json = jsyaml.safeLoad(yaml);
                            gameSource.constants[c] = nullToUndefined(json);
                        });
                    } else {
                        throw 'Unsupported file format for ' + definition.url;
                    }
                } else if (definition.type === 'reference') {
                    // Defer
                    hasReferences = true;
                } else {
                    // Inline value
                    gameSource.constants[c] = evalJSONGameConstant(definition);
                }
            }

            // Now evaluate references
            if (hasReferences) {
                for (let i = 0; i < keys.length; ++i) {
                    const c = keys[i];
                    let definition = gameJSON.constants[c];
                    if (definition.type === 'reference') {
                        // Recursively evaluate references until an actual
                        // value is encountered.
                        let id = undefined;
                        const alreadySeen = new Map();
                        alreadySeen.set(c, true);
                        let path = c;
                        do {
                            id = definition.value;
                            path += ' → ' + id;
                            if (alreadySeen.has(id)) {
                                throw 'Cycle in reference chain: ' + path;
                            }
                            definition = gameJSON.constants[id];
                        } while (definition && definition.type === 'reference');
                        
                        if (id in gameSource.constants || id in gameSource.assets) {
                            // Store the *original* reference, which
                            // will be re-traversed per call at
                            // runtime to ensure that changes are
                            // consistent when debugging (this is not
                            // the fastest choice...we could instead
                            // make the debugger re-evalue the full
                            // constant chain for all forward and backward references).
                            gameSource.constants[c] = new GlobalReference(gameJSON.constants[c].value);
                        } else {
                            throw 'Unresolved reference: ' + path;
                        }
                    }
                }
            } // has references
        }

        // Docs:
        gameSource.docs = [];
        if (gameJSON.docs) {
            // Just clone the array
            gameSource.docs = gameJSON.docs.slice(0);
            for (let d = 0; d < gameSource.docs.length; ++d) {
                const doc = gameSource.docs[d];
                if (typeof doc === 'string') {
                    gameSource.docs[d] = makeURLAbsolute(gameURL, doc);
                } else {
                    // Legacy format, no longer supported
                    gameSource.docs[d] = makeURLAbsolute(gameURL, doc.url);
                }               
            }
        } // if docs
        
    }, loadFailureCallback, loadWarningCallback, computeForceReloadFlag(gameURL));

    loadManager.end();
}


// Becomes the `frame(f)` method on sprite animation arrays.
// Runs in linear time in the length of the array (*not* linear in the value of f).
function animationFrame(f) {
    f = Math.floor(f);
    const animation = this;
    if (! animation) {
        throw new Error('The frame() function can only be called directly from a sprite animation array.');
    }
    const N = animation.length;

    if (animation.extrapolate === 'clamp') {
        // Handle out of bounds cases by clamping
        if (f < 0) { return animation[0]; }
        if (f >= animation.frames) { return animation[N - 1]; }
    } else {
        // Handle out of bounds cases by looping. To handle negatives, we need
        // to add and then mod again. Mod preserves fractions.
        f = ((f % animation.period) + animation.period) % animation.period;
    }

    if (animation.extrapolate === 'oscillate') {
        // Oscillation will give us twice the actual number of frames from the
        // looping, so we need to figure out which part of the period we're in.
        const reverseTime = (animation.period + animation[0].frames + animation[N - 1].frames) / 2;
        if (f >= reverseTime) {
            // Count backwards from the end
            f -= reverseTime;
            let i = N - 2;
            while ((i > 0) && (f >= animation[i].frames)) {
                f -= animation[i].frames;
                --i;
            }
               
            return animation[i];
        }
    }
    
    // Find the value by searching linearly within the array (since we do not
    // store cumulative values to binary search by).
    let i = 0;
    while ((i < N) && (f >= animation[i].frames)) {
        f -= animation[i].frames;
        ++i;
    }
    
    return animation[Math.min(i, N - 1)];

}


/** Computes gameSource.CREDITS from gameSource, mutating it */
function computeAssetCredits(gameSource) {
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
    
    for (let a in gameSource.assets) {
        const asset = gameSource.assets[a];
        const json = asset._json;
        
        let type = asset._jsonURL.match(/\.([^.]+)\.json$/i);
        if (type) { type = type[1].toLowerCase(); }

        if (json.license && CREDITS[type]) {
            addCredit(type, asset._jsonURL, json.license);
        }

        if (type === 'map') {
            // Process the spritesheets
            for (let k in asset.spritesheet_table) {
                const spritesheet = asset.spritesheet_table[k];
                const json = spritesheet._json;
                if (json.license) {
                    addCredit('sprite', spritesheet._jsonURL, json.license);
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
    CREDITS.quadplay.push('quadplay✜ ©2019-2020 Morgan McGuire, used under the LGPL 3.0 license');
    CREDITS.quadplay.push('gif.js ©2013 Johan Nordberg, used under the MIT license, with additional programming by Kevin Weiner, Thibault Imbert, and Anthony Dekker');
    CREDITS.quadplay.push('xorshift implementation ©2014 Andreas Madsen and Emil Bay, used under the MIT license');
    CREDITS.quadplay.push('LoadManager.js ©2019 Morgan McGuire, used under the BSD license');
    CREDITS.quadplay.push('WorkJSON.js ©2020 Morgan McGuire, used under the MIT license');
    CREDITS.quadplay.push('js-yaml ©2011-2015 Vitaly Puzrin, used under the MIT license');
    CREDITS.quadplay.push('matter.js © Liam Brummitt and others, used under the MIT license');
    CREDITS.quadplay.push('poly-decomp.js ©2013 Stefan Hedman, used under the MIT license');
}


function loadFont(name, json, jsonURL) {
    const font = {
        _name:     'font ' + name,
        _type:     'font',
        _url:      makeURLAbsolute(jsonURL, json.url),
        _json:     json,
        _jsonURL:  jsonURL,
        _index:    fontArray.length
    };

    fontArray.push(font);
    const forceReload = computeForceReloadFlag(font._url);

    // No need to avoid the processing of the font once it is loaded
    // into memory, because that is fast. So, fonts don't appear in the
    // asset cache.
    
    onLoadFileStart(font._url);
    loadManager.fetch(font._url, 'image', getBinaryImageData, function (srcMask, image, url) {
        onLoadFileComplete(font._url);

        // Save the raw image for the IDE
        fileContents[url] = image;
        
        const borderSize = 1;
        const shadowSize = parseInt(json.shadowSize || 1);

        packFont(font, borderSize, shadowSize, json.baseline, json.char_size, Object.freeze({x: json.letter_spacing.x, y: json.letter_spacing.y}), srcMask);

        if (name[0] !== '_') {
            resourceStats.spritePixels += font._data.width * font._data.height;
            ++resourceStats.spritesheets;
            resourceStats.maxSpritesheetWidth  = Math.max(resourceStats.maxSpritesheetWidth,  font._data.width);
            resourceStats.maxSpritesheetHeight = Math.max(resourceStats.maxSpritesheetHeight, font._data.height);
        }
        
        Object.freeze(font);
    }, loadFailureCallback, loadWarningCallback, forceReload);

    return font;
}


/** Extracts the image data and returns two RGBA4 arrays as [Uint16Array, Uint16Array],
    where the second is flipped horizontally. Region is an optional crop region. */
function getImageData4BitAndFlip(image, region) {
    const data = getImageData4Bit(image, region);
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
    if (region && ((region.pos.x !== 0) || (region.pos.y !== 0) || (region.size.x !== image.width) || (region.size.y !== image.height))) {
        // Crop
        data = new Uint32Array(region.size.x * region.size.y);
        data.width = region.size.x;
        data.height = region.size.y;

        for (let y = 0; y < data.height; ++y) {
            const srcOffset = (y + region.pos.y) * dataRaw.width + region.pos.x;
            data.set(dataRaw.slice(srcOffset, srcOffset + data.width), y * data.width);
        }
    }

    // Used by scalepix
    if (full32bitoutput) { return data; }
    
    // Quantize (more efficient to process four bytes at once!)
    // Converts R8G8B8A8 to R4G4B4A4-equivalent by copying high bits to low bits.
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

// Maps *.json urls to the live quadplay asset to reduce loading times
// for sounds and spritesheets.
const assetCache = {};

function loadSpritesheet(name, json, jsonURL, callback) {
    let spritesheet;

    const pngURL = makeURLAbsolute(jsonURL, json.url);

    const forceReload = computeForceReloadFlag(pngURL);

    if (forceReload === false) {
        spritesheet = assetCache[jsonURL];
        if (spritesheet) {
            // Make sure the index is updated when pulling from the cache
            if (spritesheetArray.indexOf(spritesheet) === -1) {
                spritesheet._index = spritesheetArray.length;
                spritesheetArray.push(spritesheet);
            } else {
                console.assert(spritesheetArray.indexOf(spritesheet) === spritesheet._index);
            }
            
            fileContents[pngURL] = spritesheet;
            onLoadFileStart(pngURL);
            onLoadFileComplete(pngURL);
            if (callback) { callback(spritesheet); }

            return spritesheet;
        }
    }

   
    // These fields have underscores so that they can't be accessed from pyxlscript.
    spritesheet = Object.assign([], {
        _name: 'spritesheet ' + name,
        _type: 'spritesheet',
        _uint16Data: null,
        _uint16DataFlippedX : null,
        _url: pngURL,
        _sourceURL: (json.source_url && json.source_url !== '') ? makeURLAbsolute(jsonURL, json.source_url) : null,
        _gutter: (json.sprite_size.gutter || 0),
        _json: json,
        _jsonURL: jsonURL,
        _index: spritesheetArray.length,
        sprite_size: Object.freeze({x: json.sprite_size.x, y: json.sprite_size.y})
    });

    spritesheetArray.push(spritesheet);

    // Pivots
    const sspivot = json.pivot ? Object.freeze({x: json.pivot.x - json.sprite_size.x / 2, y: json.pivot.y - json.sprite_size.y / 2}) : Object.freeze({x: 0, y: 0});
    
    // Offsets used for scale flipping
    const PP = Object.freeze({x: 1, y: 1});
    const NP = Object.freeze({x:-1, y: 1});
    const PN = Object.freeze({x: 1, y:-1});
    const NN = Object.freeze({x:-1, y:-1});
          
    // Actually load the image
    onLoadFileStart(pngURL);

    const preprocessor = function(image) {
        if (! (pngURL in fileContents)) {
            // This image has not been previously loaded by this project
            fileContents[pngURL] = image;
        }

        let region = json.region || {};
        if (region.pos === undefined) { region.pos = {x: 0, y: 0}; }
        region.pos.x = Math.min(Math.max(0, region.pos.x), image.width);
        region.pos.y = Math.min(Math.max(0, region.pos.y), image.height);
        
        if (region.size === undefined) { region.size = {x: Infinity, y: Infinity}; }
        region.size.x = Math.min(image.width - region.pos.x, region.size.x);
        region.size.y = Math.min(image.height - region.pos.y, region.size.y);

        const cacheName = pngURL + JSON.stringify(region);
        if (! alreadyCountedSpritePixels[cacheName] && name[0] !== '_') {
            alreadyCountedSpritePixels[cacheName] = true;
            resourceStats.spritePixels += region.size.x * region.size.y;
            ++resourceStats.spritesheets;
            resourceStats.maxSpritesheetWidth = Math.max(resourceStats.maxSpritesheetWidth, region.size.x);
            resourceStats.maxSpritesheetHeight = Math.max(resourceStats.maxSpritesheetHeight, region.size.y);
        }

        return getImageData4BitAndFlip(image, region);
    };
    
    
    loadManager.fetch(pngURL, 'image', preprocessor, function (dataPair, image, url) {
        onLoadFileComplete(pngURL);
        const data = dataPair[0];

        spritesheet._uint16Data = data;
        spritesheet._uint16DataFlippedX = dataPair[1];
        
        const boundingRadius = Math.hypot(spritesheet.sprite_size.x, spritesheet.sprite_size.y);
        spritesheet.size = {x: data.width, y: data.height};

        const sheetDefaultframes = Math.max(json.default_frames || 1, 0.25);
        
        // Create the default grid mapping (may be swapped on the following line)
        let rows = Math.floor((data.height + spritesheet._gutter) / (spritesheet.sprite_size.y + spritesheet._gutter));
        let cols = Math.floor((data.width  + spritesheet._gutter) / (spritesheet.sprite_size.x + spritesheet._gutter));

        if (json.transpose) { let temp = rows; rows = cols; cols = temp; }

        if (rows === 0 || cols === 0) {
            throw new Error('Spritesheet ' + jsonURL + ' has a sprite_size that is larger than the entire spritesheet.');
        }

        for (let x = 0; x < cols; ++x) {
            spritesheet[x] = [];
            
            for (let y = 0; y < rows; ++y) {
                const u = json.transpose ? y : x, v = json.transpose ? x : y;
                
                // Check each sprite for alpha channel
                let hasAlpha = false;
                let hasFractionalAlpha = false;
                outerloop:
                for (let j = 0; j < spritesheet.sprite_size.y; ++j) {
                    let index = (y * (spritesheet.sprite_size.y + spritesheet._gutter) + j) * data.width + x * (spritesheet.sprite_size.x + spritesheet._gutter);
                    for (let i = 0; i < spritesheet.sprite_size.x; ++i, ++index) {
                        const alpha15 = (data[index] >>> 12) & 0xf;
                        if (alpha15 < 0xf) {
                            hasAlpha = true;

                            if (alpha15 > 0) {
                                hasFractionalAlpha = true;
                                break outerloop;
                            }
                        }
                    }
                }

                // Create the actual sprite
                const sprite = {
                    _type:             'sprite',
                    _tileX:            u,
                    _tileY:            v,
                    _boundingRadius:   boundingRadius,
                    _x:                u * (spritesheet.sprite_size.x + spritesheet._gutter),
                    _y:                v * (spritesheet.sprite_size.y + spritesheet._gutter),
                    _hasAlpha:         hasAlpha,
                    _requiresBlending: hasFractionalAlpha,
                    spritesheet:       spritesheet,
                    tile_index:        Object.freeze({x:u, y:v}),
                    id:                ++lastSpriteID,
                    size:              spritesheet.sprite_size,
                    scale:             PP,
                    pivot:             sspivot,
                    frames:            sheetDefaultframes
                };

                // Construct the flipped versions
                sprite.x_flipped = Object.assign({x_flipped:sprite}, sprite);
                sprite.x_flipped.scale = NP;
                sprite.x_flipped.lastSpriteID = ++lastSpriteID;

                sprite.y_flipped = Object.assign({y_flipped:sprite}, sprite);
                sprite.y_flipped.lastSpriteID = ++lastSpriteID;
                sprite.y_flipped.scale = PN;

                sprite.x_flipped.y_flipped = sprite.y_flipped.x_flipped = Object.assign({}, sprite);
                sprite.y_flipped.x_flipped.scale = NN;
                sprite.y_flipped.x_flipped.lastSpriteID = ++lastSpriteID;

                spritesheet[x][y] = sprite;
            }
            
            Object.freeze(spritesheet[x]);
        }

        // Process the name table
        if (json.names) {
            if (Array.isArray(json.names) || (typeof json.names !== 'object')) {
                throw new Error('The "names" entry in a sprite.json file must be an object (was "' + (typeof json.names) + '")');
            }

            for (let anim in json.names) {
                const data = json.names[anim];
                
                // Error checking
                if ((data.start !== undefined && data.x !== undefined) || (data.start === undefined && data.x === undefined)) {
                    throw new Error('Animation data for "' + anim + '" must have either "x" and "y" fields or a "start" field, but not both');
                }
                
                const animDefaultframes = Math.max(0.25, data.default_frames || sheetDefaultframes);
                
                // Apply defaults
                if (data.x !== undefined) {
                    // Named sprite, no animation
                    const u = json.transpose ? data.y : data.x, v = json.transpose ? data.x : data.y;
                    if (u < 0 || u >= spritesheet.length || v < 0 || v >= spritesheet[0].length) {
                        throw new Error('Named sprite "' + anim + '" index xy(' + u + ', ' + v + ') ' + (json.transpose ? 'after transpose ' : '') + 'is out of bounds for the ' + spritesheet.length + 'x' + spritesheet[0].length + ' spritesheet "' + url + '".');
                    }

                    const sprite = spritesheet[anim] = spritesheet[u][v];
                    sprite.frames = animDefaultframes;
                    sprite._animationName = anim;
                    sprite._animationIndex = undefined;

                } else {
                
                    if (data.end === undefined) { data.end = Object.assign({}, data.start); }
                    
                    if (data.end.x === undefined) { data.end.x = data.start.x; }
                
                    if (data.end.y === undefined) { data.end.y = data.start.y; }

                    if (data.start.x !== data.end.x && data.start.y !== data.end.y) {
                        throw new Error('Animation frames must be in a horizontal or vertical line for animation "' + anim + '"');
                    }
                    
                    let pivot = sspivot;
                    if (data.pivot !== undefined) {
                        pivot = Object.freeze({x: data.pivot.x - json.sprite_size.x / 2, y: data.pivot.y - json.sprite_size.y / 2});
                    }
                    const animation = spritesheet[anim] = [];
                    const extrapolate = data.extrapolate || 'loop';
                    animation.extrapolate = extrapolate;
                    animation.frame = animationFrame;

                    const frames = Array.isArray(data.frames) ?
                          data.frames : // array
                          (data.frames !== undefined) ?
                          [data.frames] : // number
                          [animDefaultframes]; // default
                    
                    for (let y = data.start.y, i = 0; y <= data.end.y; ++y) {
                        for (let x = data.start.x; x <= data.end.x; ++x, ++i) {
                            const u = json.transpose ? y : x, v = json.transpose ? x : y;
                            if (u < 0 || u >= spritesheet.length || v < 0 || v >= spritesheet[0].length) {
                                throw new Error('Index xy(' + u + ', ' + v + ') in animation "' + anim + '" is out of bounds for the ' + spritesheet.length + 'x' + spritesheet[0].length + ' spritesheet.');
                            }

                            const sprite = spritesheet[u][v];
                            sprite._animationName = anim;
                            sprite._animationIndex = i;
                            sprite.pivot = pivot;
                            sprite.frames = Math.max(0.25, frames[Math.min(i, frames.length - 1)]);

                            animation.push(sprite);
                        }
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

        // Prevent the game from modifying this asset.
        // Can't freeze it because we change the _index when
        // loading from cache.
        Object.seal(spritesheet);
        for (let x = 0; x < spritesheet.length; ++x) {
            for (let y = 0; y < spritesheet[x].length; ++y) {
                const sprite = spritesheet[x][y];
                // Freeze all versions
                if (sprite.frames === undefined) {
                    sprite.frames = sheetDefaultframes;
                }
                sprite.x_flipped.frames = sprite.y_flipped.frames = sprite.y_flipped.x_flipped.frames = sprite.frames;
                Object.freeze(sprite.x_flipped);
                Object.freeze(sprite.y_flipped);
                Object.freeze(sprite.y_flipped.x_flipped);
                Object.freeze(sprite);
            }
        }

        // Store into the cache
        assetCache[jsonURL] = spritesheet;
        
        if (callback) { callback(spritesheet); }
    }, loadFailureCallback, loadWarningCallback, forceReload);

    return spritesheet;
}
    

function loadSound(name, json, jsonURL) {
    if (name[0] !== '_') { ++resourceStats.sounds; }
    const mp3URL = makeURLAbsolute(jsonURL, json.url);
    const forceReload = computeForceReloadFlag(mp3URL);

    let sound;

    if (forceReload === false) {
        // Use the explicit cache for sounds, which are typically
        // the largest assets in a quadplay game.
        sound = assetCache[jsonURL];
        if (sound) {
            fileContents[mp3URL] = sound;
            onLoadFileStart(mp3URL);
            onLoadFileComplete(mp3URL);
            return sound;
        }
    }
    
    sound = Object.seal({
        src: mp3URL,
        _url: mp3URL,
        name: name,
        loaded: false,
        source: null,
        buffer: null,
        frames: 0,
        _type: 'audioClip',
        _json: json,
        _jsonURL: jsonURL});

    fileContents[mp3URL] = sound;
    onLoadFileStart(mp3URL);
    loadManager.fetch(mp3URL, 'arraybuffer', null, function (arraybuffer) {
        // LoadManager can't see the async decodeAudioData calls
        ++loadManager.pendingRequests;

        try {
            _ch_audioContext.decodeAudioData(
                // The need for slice is some Chrome multithreading issue
                // https://github.com/WebAudio/web-audio-api/issues/1175
                arraybuffer.slice(0), 
                function onSuccess(buffer) {
                    sound.buffer = buffer;
                    sound.loaded = true;
                    
                    // Create a buffer, which primes this sound for playing
                    // without delay later.
                    sound.source = _ch_audioContext.createBufferSource();
                    sound.source.buffer = sound.buffer;
                    sound.frames = sound.source.buffer.duration * 60;
                    onLoadFileComplete(json.url);
                    loadManager.markRequestCompleted(json.url, '', true);
                    
                    // Store into the cache
                    assetCache[jsonURL] = sound;
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
    const map = Object.assign([], {
        _name:   'map ' + name,
        _type:   'map',
        _url:    tmxURL,
        _offset: Object.freeze(json.offset ? {x:json.offset.x, y:json.offset.y} : {x:0, y:0}),
        _flipYOnLoad: json.y_up || false,
        _json:   json,
        _jsonURL: mapJSONUrl,
        z_offset: json.z_offset || 0,
        z_scale: (json.z_scale !== undefined ? json.z_scale : 1),
        layer:  [],
        spritesheet_table:Object.create(null),
        sprite_size: Object.freeze({x:0, y:0}),
        size:   Object.freeze({x: 0, y: 0}),
        wrap_x:  json.wrap_x || false,
        wrap_y:  json.wrap_y || false,
    });

    if (json.sprite_url) {
        json.sprite_url_table = {'<default>': json.sprite_url};
    } else if (! json.sprite_url_table) {
        throw 'No sprite_url_table specified';
    }

    // Primary spritesheet. We need to load more later
    const key = Object.keys(json.sprite_url_table)[0];
    const spritesheetUrl = makeURLAbsolute(mapJSONUrl, json.sprite_url_table[key]);

    onLoadFileStart(spritesheetUrl);
    loadManager.fetch(spritesheetUrl, 'json', null, function (spritesheetJson) {
        onLoadFileComplete(spritesheetUrl);
        spritesheetJson.url = makeURLAbsolute(spritesheetUrl, spritesheetJson.url);
        fileContents[spritesheetUrl] = spritesheetJson;

        const spritesheet = loadSpritesheet(name + ' sprites', spritesheetJson, spritesheetUrl, function (spritesheet) {
            
            // Now go back and fetch the map as a continuation, given that we have the spritesheet
            loadManager.fetch(tmxURL, 'text', null, function (xml) {
                onLoadFileComplete(tmxURL);
                xml = new DOMParser().parseFromString(xml, 'application/xml');
        
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
                
                map.spritesheet_table[spritesheetName] = spritesheet;

                let image = xml.getElementsByTagName('image')[0];
                const size = {x: parseInt(image.getAttribute('width')),
                              y: parseInt(image.getAttribute('height'))};
                const filename = image.getAttribute('source');

                if ((spritesheet.sprite_size.x !== map.sprite_size.x) || (spritesheet.sprite_size.y !== map.sprite_size.y)) {
                    throw `Sprite size (${spritesheet.sprite_size.x}, ${spritesheet.sprite_size.y}) does not match what the map expected, (${map.sprite_size.x}, ${map.sprite_size.y}).`;
                }

                if ((spritesheet.size.x !== size.x) || (spritesheet.size.y !== size.y)) {
                    throw `Sprite sheet size (${spritesheet.size.x}, ${spritesheet.size.y}) does not match what the map expected, (${size.x}, ${size.y}).`;
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
                    
                    // Construct the layer
                    for (let x = 0; x < map.size.x; ++x) { layer[x] = new Array(map.size.y); }
                    map.layer.push(layer);
                    
                    // Extract CSV values
                    for (let y = 0, i = 0; y < map.size.y; ++y) {
                        for (let x = 0; x < map.size.x; ++x, ++i) {
                            const gid = data[i];

                            // See https://doc.mapeditor.org/en/stable/reference/tmx-map-format/#layer
                            const tileFlipX = (gid & 0x80000000) !== 0;
                            const tileFlipY = (gid & 0x40000000) !== 0;
                            const tmxIndex  = (gid & 0x0fffffff) - 1;
                            
                            if (tmxIndex >= 0) {
                                const sx = tmxIndex % columns;
                                const sy = Math.floor(tmxIndex / columns);

                                let sprite = spritesheet[sx][sy];

                                if (tileFlipX) { sprite = sprite.x_flipped; }

                                if (tileFlipY) { sprite = sprite.y_flipped; }
                                
                                layer[x][flipY ? map.size.y - 1 - y : y] = sprite;
                            } else {
                                layer[x][flipY ? map.size.y - 1 - y : y] = undefined;
                            } // if not empty
                        } // x
                    } // y
                    
                    // Prevent the arrays themselves from being reassigned
                    for (let x = 0; x < map.size.x; ++x) {
                        Object.freeze(layer[x]);
                    }
                } // L
                
                // Don't allow the array of arrays to be changed (just the individual elements)
                Object.freeze(map.layer);
            }, loadFailureCallback, loadWarningCallback);
        });
    },
                      loadFailureCallback, loadWarningCallback);
    
    return map;
}


/** Maps URLs to their raw contents for use in displaying them in the IDE */
let fileContents = {};
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
    const sectionRegex = /(?:^|\n)[ \t]*(init|enter|frame|leave)[ \t]*\n(?:-|─|—|━|⎯){5,}[ \t]*\n/;
    code = code.replace(sectionRegex, '\n');

    // Remove blank lines
    code = code.replace(/\n\s*\n/g, '\n');

    // Ignore statements from system files
    if ((scriptURL.replace(/^.*\//, '')[0] !== '_') &&
        ! scriptURL.startsWith('quad://scripts/') &&
        ! scriptURL.startsWith(location.href.replace(/\/console\/quadplay\.html.*$/, '/scripts/'))) {
        resourceStats.sourceStatements += Math.max(0, (code.split(';').length - 1) + (code.split('\n').length - 1) - 1);
    }
}


function loadFailureCallback(reason, url) {
    console.log(`ERROR: Failed to load "${url}". ${reason || ''}`);
}


function loadWarningCallback(reason, url) {
    _outputAppend(url + ': ' + reason + '\n');
}


/** Returns everything up to the final slash from a URL */
function urlDir(url) {
    return url.replace(/\?.*$/, '').replace(/\/[^/]*$/, '/');
}

function urlFile(url) {
    return url.substring(url.lastIndexOf('/') + 1);
}

function computeForceReloadFlag(url) {
    return (fastReload && isBuiltIn(url)) ? false : useIDE;
}

/** Returns the childURL made absolute relative to the parent */
function makeURLAbsolute(parentURL, childURL) {
    if (childURL.startsWith('quad://')) {
        // quad URL. Make relative to the quadplay installation
        return childURL.replace(/^quad:\/\//, urlDir(location.href) + '../').replace(/\/console\/\.\.\//, '/');
    } else if (/^.{3,6}:\/\//.test(childURL)) {
        // Already absolute, some other protocol
        return childURL;
    } else if (/^[\\/]/.test(childURL)) {
        // Absolute on the server. Copy the host and protocol
        const match = parentURL.match(/^.{3,6}:\/\/.*?(?=\/)/);
        if (match) {
            return match[0] + childURL;
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


/** Parse the JSON value starting at character i. Also used by the runtime as QRuntime.parse(str) */
function _parse(source, i) {
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
                const child = _parse(source, i);

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
                    const temp = _parse(source, i);
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
                const value = _parse(source, i);
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

    throw new Error('hit the end of ' + source);
}


/** Evaluate a constant value from JSON. Used only while loading. */
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
            return _parse(json.value.trim()).result;
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

    case 'grid':
        console.error('Not implemented');
        break;

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
        throw 'Unrecognized data type: "' + json.type + '"';
    }
}
