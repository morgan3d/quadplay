/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */

// Routines needed for both GPU and CPU

// Used for font rendering. Returns the font spacing, unless it is
// zero. In the zero case, the function tests for symbols (which
// include superscripts and subscripts, as well as the space
// character) that require spacing around them even if the font
// specifies font.spacing.x === 0.
function $postGlyphSpace(chrPair, font) {
    if (font.spacing.x !== 0 || chrPair.length === 1) {
        return font.spacing.x;
    } else {
        const symbolRegex = /[^A-Za-z0-9_αβγδεζηθικλμνξ§πρστυϕχψωςşğÆÀÁÂÃÄÅÇÈÉÊËÌÍÎÏØÒÓÔÕÖŒÑẞÙÚÛÜБДæàáâãäåçèéêëìíîïøòóôõöœñßùúûüбгдЖЗИЙЛПЦЧШЩЭЮЯЪЫЬжзийлпцчшщэюяъыьΓΔмнкΘΛΞΠİΣℵΦΨΩŞĞ]/;
        // test() will not fail on undefined or NaN, so ok to not safeguard the string conversions
        return symbolRegex.test(chrPair) ? 1 : 0;
    }
}
