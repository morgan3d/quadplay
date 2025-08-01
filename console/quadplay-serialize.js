/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */
"use strict";

/* This is the transformer for quadplay types to use with serialize(). It supports:

    - quadplay API functions
    - fonts
    - spritesheets
    - sprites

    It specifically does not support maps because they are not immutable. It could
    support them by actually serializing the map's contents.
*/
function quadplaySerializeTransform(value) {
    // API function
    if (typeof value === 'function' && (QRuntime[value.name] === value)) {
        return [value.name, 'API'];
    }

    switch (value.$type) {
    case undefined:
        return [value];

    case 'font':
        return [{
            name: value.$name,
        }, 'font'];

    case 'sprite':
        return [{
            spritesheet_name: value.$spritesheet.$name,
            tile_index: value.tile_index,
            scale: value.scale
        }, 'sprite'];

    case 'spritesheet':
        return [{
            name: value.$spritesheet,
        }, 'spritesheet'];
        
    default:
        // Do not transform
        return [value];
    }
}


/* This is the untransformer (reviver) for quadplay types to use with serialize(). */
function quadplaySerializeUntransform(encoded, custom_type) {
    function getByName(array, name) {
        for (const elt of array) {
            if (elt.$name === name) {
                return elt;
            }
        }
        
        return null;
    }


    switch (custom_type) {
    case undefined:
        return encoded;

    case 'API':
        return QRuntime[encoded.name];

    case 'font':
        return getByName(fontArray, encoded.name);

    case 'spritesheet':
        return getByName(spritesheetArray, encoded.name);

    case 'sprite': {
        // Find the spritesheet
        const spritesheet = getByName(spritesheetArray, encoded.spritesheet_name);
        let sprite = spritesheet[encoded.tile_index.x][encoded.tile_index.y];

        if (encoded.scale.x === -1) { sprite = sprite.flipped_x; }
        if (encoded.scale.y === -1) { sprite = sprite.flipped_y; }

        return sprite;
    }

    default:
        // Do nothing
        return encoded;
    }
}
