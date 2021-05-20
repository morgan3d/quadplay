/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */
"use strict";
/**
 \file quadplay-font.js

 Font utility routines for both runtime and tools.

  - packFont

*/

/********************************************************************************************/

// This code block uses specific unicode characters in the strings.
// They cannot be replaced with other, similar-looking unicode
// characters; that is the whole point of the alias map at the
// bottom. So, beware that there are potentially differences that you
// cannot see in the source between similar-looking strings!
//
// The final row is short because it contains the four-wide characters
//
// Map character to canonical character.
const fontMap = {};
const fontSubscriptChars = '₀₁₂₃₄₅₆₇₈₉₊₋₍₎ₐᵦᵢⱼₓₖᵤₙ';
const fontChars =
`ABCDEFGHIJKLMNOPQRSTUVWXYZ↑↓;:,.
abcdefghijklmnopqrstuvwxyz←→<>◀▶
0123456789+-()~!@#$%^&*_=?¥€£¬∩∪
⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ᵃᵝⁱʲˣᵏᵘⁿ≟≠≤≥≈{}[]★
ᵈᵉʰᵐᵒʳˢᵗⓌⒶⓈⒹⒾⒿⓀⓁ⍐⍇⍗⍈ⓛⓡ▼∈∞°¼½¾⅓⅔⅕
«»ΓΔмнкΘ¿¡Λ⊢∙Ξ×ΠİΣ♆ℵΦ©ΨΩ∅ŞĞ\\/|\`'
αβγδεζηθικλμνξ§πρστυϕχψωςşğ⌊⌋⌈⌉"
ÆÀÁÂÃÄÅÇÈÉÊËÌÍÎÏØÒÓÔÕÖŒÑẞÙÚÛÜБ✓Д
æàáâãäåçèéêëìíîïøòóôõöœñßùúûüбгд
ЖЗИЙЛПЦЧШЩЭЮЯЪЫЬ±⊗↖↗втⓔ⦸ⓝⓗ○●◻◼△▲
жзийлпцчшщэюяъыь∫❖↙↘…‖ʸᶻⓩ⑤⑥♠♥♣♦✜
ⓐⓑⓒⓓⓕⓖⓟⓠⓥⓧⓨ⬙⬗⬖⬘Ⓞ⍍▣⧉☰⒧⒭①②③④⑦⑧⑨⓪⊖⊕
␣Ɛ⏎ҕﯼડƠ⇥
⬁⬀⌥     `;

// Word forms of last two rows: SPC ENT RET SEL STR SHR OPT TAB / LSH RSH
// This is used by fontgen.
const fontSpecials = {
    '␣':'SPACE',
    'Ɛ':'ENTER',
    '⏎':'RETURN',
    'ҕ':'SELECT',
    'ﯼ':'START',
    'ડ':'SHARE',
    'Ơ':'OPTION',
    '⇥':'TAB',

    '⬁':'L.SHIFT',
    '⬀':'R.SHIFT',
    '⌥':'ALT'};

const FONT_COLS = 32;
// Accounts for the 4x characters on the last two rows, and the missing last newline
const FONT_ROWS = Math.floor((fontChars.length + 1) / (FONT_COLS + 1)) + 2;

{
    // Build the font map. 
    for (let i = 0, x = 0, y = 0; i < fontChars.length; ++i, ++x) {
        const c = fontChars[i];
        if (c === '\n') { // newline resets
            x = -1; ++y;
        } else if (c !== ' ') { // skip spaces
            console.assert(fontMap[c] === undefined);
            fontMap[c] = c;
        }
    }
    
    for (let i = 0; i < fontSubscriptChars.length; ++i) {
        fontMap[fontSubscriptChars[i]] = fontSubscriptChars[i];
    }

    // Add aliased characters. The first character in each string
    // appears in chars above.  The others are ones that should map to
    // it. To disambiguate characters when debugging, use
    // `'◼'.charCodeAt(0).toString(16)`
    
    const aliases = ['aа',
                     'AΑА',
                     'BΒВ',
                     'ÇҪ',
                     'çҫ',
                     'cс',
                     'EΕЕ',
                     'eе',
                     'HНΗ',
                     'IΙІ',
                     'iі',
                     'jј',
                     'JЈ',
                     'KΚК',
                     'MМΜ',
                     'NΝ',
                     'OОΟ',
                     'oοо',
                     'PРΡ',
                     'pр',
                     'sѕ',
                     'SЅ',
                     'TТΤ',
                     'YΥ',
                     'yу',
                     'xх',
                     'XΧХ',
                     'ΦФ',
                     'ϕф',
                     'ΓГ',
                     'ZΖ',
                     '∙•',
                     '◻▢□',
                     '◼■◼',
                     '-─—━⎯',
                     '△▵',
                     '▲▴',
                     '▼▾',
                     '♥♡❤🖤💙💚💛💜💖',
                     '♦◆◇',
                     '…⋯',
                     '▶▷⊳ᐅ▹▻',
                     '◀◁⊲ᐊ◃◅⨞',
                     '‖∥𝄁║Ⅱǁ',
                     '⍐⍓⬆️',
                     '⍇⬅️',
                     '⍗⍌⬇️',
                     '⍈➡️'];
    
    for (let i = 0; i < aliases.length; ++i) {
        const a = aliases[i];
        console.assert(fontMap[a[0]] !== undefined, a[0]); // All targets in map
        for (let j = 1; j < a.length; ++j) {
            console.assert(j !== a[0]); // No duplicates!
            fontMap[a[j]] = a[0];
        }
    }

    Object.freeze(fontMap);
}


function isDigit(c) {
    c = c.charCodeAt(0);
    return (c >= 48) && (c <= 57);
}


/** 
    Given an object, an xy() spacing, and a [binary as 0 and 255
    values] Uint8Array augmented with width and height fields, packs
    the font characters tightly and creates fields including $data and
    $bounds.

    Used by loadFont() in quadplay-load.js and by fontpack.html.
*/
function packFont(font, borderSize, shadowSize, baseline, char_size, spacing, srcMask) {
    // Maps characters to tight bounding boxes in the srcMask
    let bounds = {};

    font.spacing = spacing;
    font.$borderSize = borderSize;
    font.$shadowSize = shadowSize;

    // Compute tightest vertical bounding box across all characters
    let tightY1 = Infinity, tightY2 = -Infinity;
          
    // Compute tight bounds on letters so that we can repack.
    let _charWidth = 0;
    for (let charY = 0; charY < FONT_ROWS; ++charY) {
        const charScale = (charY < FONT_ROWS - 2) ? 1 : 4;
        for (let charX = 0; charX < FONT_COLS / charScale; ++charX) {
            const yTile = char_size.y * charY;
            
            // fontChars is actually 33 wide because it has newlines in it
            const index = charX + Math.min(charY, FONT_ROWS - 2) * (FONT_COLS + 1) +
                  Math.max(charY - (FONT_ROWS - 2), 0) * (FONT_COLS / 4 + 1);
            const c = fontChars[index];
            
            if (c !== ' ') {
                // Find tightest non-black bounds on each character
                let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
                for (let y = charY * char_size.y; y < (charY + 1) * char_size.y; ++y) {
                    for (let x = charX * char_size.x * charScale; x < (charX + 1) * char_size.x * charScale; ++x) {
                        if (array2DGet(srcMask, x, y)) {
                            x1 = Math.min(x, x1); y1 = Math.min(y, y1);
                            x2 = Math.max(x, x2); y2 = Math.max(y, y2);
                        }
                    } // for x
                } // for y

                if (y1 === Infinity) {
                    // The entire box was empty. Put both bounds in
                    // the center of the box.
                    y1 = y2 = ((charY + 0.5) * char_size.y) | 0;
                    x1 = x2 = ((charX + 0.5) * char_size.y) | 0;
                }
                tightY1 = Math.min(tightY1, y1 - yTile);
                tightY2 = Math.max(tightY2, y2 - yTile);
                bounds[c] = {x1:x1, y1:y1, x2:x2, y2:y2};
                _charWidth = Math.max(_charWidth, Math.ceil((x2 - x1 + 1) / charScale));
            } // if not space
        }
    }

    // Compute fixed-width number spacing
    let digitWidth = 0;
    for (let i = 0; i <= 9; ++i) {
        digitWidth = Math.max(digitWidth, bounds['' + i].x2 - bounds['' + i].x1 + 1);
    }
    digitWidth += borderSize * 2;

    // Compute line spacing
    {
        // Use ascenders and descenders from these letters
        const measureLetters = 'gjypqQ7zAIPlt';
        let yMin = Infinity, yMax = -Infinity;
        for (let i = 0; i < measureLetters.length; ++i) {
            const b = bounds[measureLetters[i]];
            const baseY = Math.floor(b.y1 / char_size.y) * char_size.y;
            yMin = Math.min(yMin, b.y1 - baseY);
            yMax = Math.max(yMax, b.y2 - baseY);
        }
        font.line_height = yMax - yMin + 1 + spacing.y;
    }
    

    // Char width/height is the extent of each character's box
    // in the packed, padded image.  Allocate the final
    // bitmap, including padding for individual fonts.
    _charWidth += 2 * borderSize;
    font.$charHeight = (tightY2 - tightY1 + 1) + 2 * borderSize + shadowSize;
    font.glyph_size = {x: font.$charWidth - 2 * borderSize, y: font.$charHeight - 2 * borderSize - shadowSize};
    
    // Baseline is the distance from the top of each box to
    // the text baseline.  Adjust the baseline for the new
    // tight packing and the border padding
    font.$baseline = baseline - tightY1 + borderSize;

    // Extract each character
    const colorMask        = array2DUint8(_charWidth * 4, font.$charHeight);
    const borderMask       = array2DUint8(_charWidth * 4, font.$charHeight);
    const shadowMask       = array2DUint8(_charWidth * 4, font.$charHeight);
    const shadowBorderMask = array2DUint8(_charWidth * 4, font.$charHeight);
    font.$data = array2DUint8(_charWidth * FONT_COLS, font.$charHeight * FONT_ROWS);
    font.$bounds = {};

    for (let charY = 0; charY < FONT_ROWS; ++charY) {
        const charScale = (charY < FONT_ROWS - 2) ? 1 : 4;
        for (let charX = 0; charX < FONT_COLS / charScale; ++charX) {
            // Reset
            array2DClear(colorMask, 0);
            array2DClear(borderMask, 0);
            array2DClear(shadowMask, 0);
            array2DClear(shadowBorderMask, 0);
            
            // +1 for the newline on each row
            // take into account that the last two rows are short
            const index = charX +
                  Math.min(charY, FONT_ROWS - 2) * (FONT_COLS + 1) +
                  Math.max(charY - (FONT_ROWS - 2), 0) * (FONT_COLS / 4 + 1);
            const chr = fontChars[index];
            console.assert(chr !== undefined, 'Undefined character at (' + charX + ', ' + charY + ')');
            
            if (chr !== ' ') {
                const srcBounds = bounds[chr];
                ////////////////////////////////////////////////////////////////
                // Extract the colorMask bits, offsetting appropriately
                console.assert(srcBounds.y2 - srcBounds.y1 + 1 <= colorMask.height);
                console.assert(srcBounds.x2 - srcBounds.x1 + 1 <= colorMask.width);
                console.assert(char_size.y * charY === Math.floor(srcBounds.y1 / char_size.y) * char_size.y);
                
                for (let srcY = srcBounds.y1; srcY <= srcBounds.y2; ++srcY) {
                    const dstY = srcY - char_size.y * charY - tightY1 + borderSize;
                    for (let srcX = srcBounds.x1; srcX <= srcBounds.x2; ++srcX) {
                        const dstX = (srcX - srcBounds.x1) + borderSize;
                        array2DSet(colorMask, dstX, dstY, array2DGet(srcMask, srcX, srcY));
                    } // x
                } // y

                // For testing
                /*
                if (chr === 'Ɛ') {
                    console.log(srcBounds);
                    console.log(colorMask);
                    array2DPrint(colorMask);
                }
                */
                
                if (borderSize > 0) {
                    // Compute the borderMask from the colorMask 8-ring
                    makeBorderMask(colorMask, borderMask);
                }

                if (shadowSize > 0) {
                    // Compute the shadowMask from the colorMask
                    array2DMapSet(shadowMask, function(x, y) {
                        if (array2DGet(colorMask, x, y)) { return 0; }
                        for (let s = 1; s <= shadowSize; ++s) if (array2DGet(colorMask, x, y - s)) return 255;
                        return 0;
                    });

                    // Compute the shadowBorderMask from the colorMask
                    array2DMapSet(shadowBorderMask, function(x, y) {
                        if (array2DGet(borderMask, x, y)) { return 0; }
                        for (let s = 1; s <= shadowSize; ++s) if (array2DGet(borderMask, x, y - s)) return 255;
                        return 0;
                    });
                }
                
                ////////////////////////////////////////////////////////////////
                // Write to the packed bitmap
                console.assert(font.$charHeight === colorMask.height);

                // For testing
                // if (chr === '∫') array2DPrint(borderMask);
                for (let srcY = 0; srcY < font.$charHeight; ++srcY) {
                    //let tst = ''; // For testing
                    const dstY = font.$charHeight * charY + srcY;

                    for (let srcX = 0; srcX < _charWidth * charScale; ++srcX) {
                        const dstX = _charWidth * charScale * charX + srcX;
                        
                        const m  = array2DGet(colorMask, srcX, srcY);
                        const b  = array2DGet(borderMask, srcX, srcY);
                        const s  = array2DGet(shadowMask, srcX, srcY);
                        const sb = array2DGet(shadowBorderMask, srcX, srcY);
                            
                        // bits are: s+b | s | b | m
                        let mask = 0x0;
                        if (m) {
                            mask = 0x1;
                        } else {
                            if (b) { mask |= 0x2; }
                            if (s) { mask |= 0x4; }
                            if (sb) { mask |= 0x8; }
                        }
                        
                        //if (chr === '∫') { tst += (mask < 10 ? '0' : '') + mask + ' '; } // For testing
                        array2DSet(font.$data, dstX, dstY, mask);
                    } // srcX
                    //if (chr === '∫') { console.log(tst); }  // For testing
                } // srcY
                
                // Compute the bounds of this character as an absolute position on the final image
                const tileX = _charWidth * charX * charScale, tileY = font.$charHeight * charY, srcTileY = char_size.y * charY;

                let pre = 0, post = 0;
                if (isDigit(chr)) {
                    // If this is a digit, shift the pixels and x
                    // bounds based on the mandatory fixed digit width
                    // so that it is centered
                    const w = srcBounds.x2 - srcBounds.x1 + 2 * borderSize + 1;
                    post = ((digitWidth - w) / 2) | 0;
                    pre = digitWidth - w - post;
                    //console.log(chr, pre, post);
                }

                font.$bounds[chr] = {
                    x1: tileX,
                    x2: tileX + srcBounds.x2 - srcBounds.x1 + 2 * borderSize,
                    y1: tileY + (srcBounds.y1 - srcTileY - tightY1),
                    y2: tileY + (srcBounds.y2 - srcTileY - tightY1) + borderSize * 2 + shadowSize,
                    pre: pre,
                    post: post,
                    yOffset: 0
                };

            } // char !== ' '
            
        } // charX
    } // charY
    
    // Make bounds for the space and tab characters based on whichever
    // is larger of several thin characters.
    {
        const candidates = 'il¹;[';
        let thickestBounds = null, thickestWidth = 0;
        for (let i = 0; i < candidates.length; ++i) {
            const c = candidates[i];
            const bounds = font.$bounds[c];
            const width = bounds.x2 - bounds.x1 + 1;
            if (width > thickestWidth) {
                thickestWidth = width;
                thickestBounds = bounds;
            }
        }
        font.$bounds[' '] = font.$bounds['\t'] = thickestBounds;
    }
        
    // Compute subscripts
    {
        const b = bounds['⁰'];
        const tileY = Math.floor(b.y1 / char_size.y) * char_size.y;
        const subscriptOffset = Math.floor(baseline + (b.y1 - b.y2) / 2);

        // Map a subscript to the corresponding superscript. Note that there
        // are OTHER superscripts that have no corresponding subscript.
        const subscript   = fontSubscriptChars;
        const superscript = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ᵃᵝⁱʲˣᵏᵘⁿ';
        for (let i = 0; i < subscript.length; ++i) {
            const sub = subscript[i];
            const sup = superscript[i];
            const b = Object.assign({}, font.$bounds[sup]);
            b.yOffset = subscriptOffset;
            font.$bounds[sub] = Object.freeze(b);
        }
    }
}


/** Returns 1-bit image data expressed as a Uint8 array of 0x00 and 0xff values */
function getBinaryImageData(image) {
    const imageData = getImageData(image);

    // Extract and copy
    const N = (imageData.data.length / 4) | 0;
    const pixelData = array2DUint8(image.width, image.height);
    for (let i = 0; i < N; ++i) {
        pixelData.data[i] = (imageData.data[i * 4] >= 128) ? 255 : 0;
    }
    
    return pixelData;
}


function array2DUint8(w, h) {
    console.assert(w > 0 && h > 0);
    return Object.seal({width:w, height:h, data:new Uint8Array(w * h)});
}


function array2DPrint(a) {
    const bar = new Array(a.width + 1).join('━━');
    let s = '  ┏' + bar + '┓\n';
    for (let y = 0; y < a.height; ++y) {
        if (y < 10) { s += ' ' + y; } else { s += y; }
        s += '┃';
        for (let x = 0; x < a.width; ++x) {
            s += a.data[x + y * a.width] && '█▋' || '· ';
        }
        s += '┃\n';
    }
    s += '  ┗' + bar + '┛';
    console.log(s);
}


function array2DGet(a, x, y) {
    if ((x >= 0) && (x < a.width) && (y >= 0) && (y < a.height)) {
        return a.data[x + y * a.width];
    } else {
        return undefined;
    }
}


function array2DClear(a, value) {
    a.data.fill(value);
}
    

function array2DSet(a, x, y, v) {
    if ((x >= 0) && (x < a.width) && (y >= 0) && (y < a.height)) { a.data[x + y * a.width] = v; }
}


function array2DMapSet(a, fcn) {
    for (let y = 0; y < a.height; ++y) for (let x = 0; x < a.width; ++x) a.data[x + y * a.width] = fcn(x, y);
}


// Set the dstMask from the srcMask 8-ring
function makeBorderMask(srcMask, dstMask) {
    array2DMapSet(dstMask, function(x, y) {
        return (! array2DGet(srcMask, x, y) &&
                (array2DGet(srcMask, x - 1, y - 1) || array2DGet(srcMask, x, y - 1) || array2DGet(srcMask, x + 1, y - 1) ||
                 array2DGet(srcMask, x - 1, y) || array2DGet(srcMask, x + 1, y) ||
                 array2DGet(srcMask, x - 1, y + 1) || array2DGet(srcMask, x, y + 1) || array2DGet(srcMask, x + 1, y + 1))); });
}
