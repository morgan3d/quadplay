/*
  WorkJSON.js (2kB minified)

  JSON extended with:

  - Optional trailing commas on arrays and objects
  - C++ single and multline comments
  - `Backtick` multiline strings
  - Explicit plus sign permitted on numbers
  - Numbers with bare leading or trailing decimal
  - NaN, Infinity, -Infinity
  - Hexadecimal numbers
  - JavaScript undefined
  - Optional unquoted object keys using [A-Za-z_0-9]+ characters only

  See also ../tools/betterjson.py for the Python version

  Just use WorkJSON.parse and WorkJSON.stringify in place of
  JSON.parse and JSON.stringify. They have the same API. 

  WorkJSON.parse is 100% backwards compatible to JSON.parse 
  as long as your input has no characters in the Unicode private
  use area \uE000 through \uF8FF.

  The output of WorkJSON.stringify is backwards compatible to 
  JSON as long as you don't use NaN or Infinity values, which 
  JSON.stringify would error out on anyway.

  The implementation is designed to use only regexps and a vanilla
  JSON parser to simplify porting to other languages.

  This is similar to JSON5 (https://json5.org/) but is about 10x
  smaller. The primary difference is that WorkJSON intentionally 
  does not support unicode in unquoted keys.

  By @CasualEffects

  ------------------------------------------------------------------
OSI MIT LICENSE

Copyright 2020 Morgan McGuire, https://casual-effects.com

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

// Polyfill for IE
if (! String.prototype.replaceAll) {
    String.prototype.replaceAll = function(pattern, str) {
	return this.replace(typeof pattern === 'object' ? pattern : new RegExp(pattern, 'g'), str);
    };
}

const WorkJSON = (function () {

// Use the Multilinguial plane Unicode private use area,
// which has room for over 6000 strings that should not be
// in use by the source text.
//    
// https://en.wikipedia.org/wiki/Private_Use_Areas
//
// Must also match hardcoded values below in regexps
const doubleQuoteProtection = '\uE000';
const NaNSymbol = '\uE001';
const InfinitySymbol = '\uE002';
const NegInfinitySymbol = '\uE003';
const UndefinedSymbol = '\uE004';
const ESCAPED_ESCAPE = '\uE009';
const protectionBlockStart = 0xE010;
    
return {
    /** Returns the new string and a remapping array. If an array is
        provided, then it is extended. */
    protectQuotedStrings: function protectQuotedStrings(src, protectionMap) {
        protectionMap = protectionMap || [];

        // Hide escaped escapes momentarily
        src = src.replace(/\\\\/g, ESCAPED_ESCAPE);
        
        // Hide escaped quotes that would confuse the main regexp
        src = src.replace(/\\"/g, doubleQuoteProtection);

        // Restore escaped escapes
        src = src.replace(/\uE009/g, '\\\\');

        // TODO: i = 97 string is being replaced with "if"
        
        // Protect all strings
        src = src.replace(/"((?:[^"\\]|\\.)*)"/g, function (match, str) {
            const i = protectionMap.length;
            protectionMap.push(str);
            return '"' + String.fromCharCode(i + protectionBlockStart) + '"';
        });

        return [src, protectionMap];
    },

    unprotectQuotedStrings : function unprotectQuotedStrings(s, protectionMap) {
        // Unprotect strings
        for (let i = 0; i < protectionMap.length; ++i) {
            s = s.replace(String.fromCharCode(i + protectionBlockStart), protectionMap[i]);
        }

        // Unprotect escaped quotes
        return s.replaceAll(doubleQuoteProtection, '\\"');
    },

    stringify: function stringify(value, replacer, space) {
        // Allow IEEE numeric constants by temporarily hiding them in strings
        function betterReplacer(key, value) {
            if (replacer) { value = replacer(key, value); }

            if (typeof value === 'undefined') { return UndefinedSymbol; }
            if ((typeof value === 'number') && isNaN(value)) { return NaNSymbol; }
            
            switch (value) {
            case Infinity:  return InfinitySymbol;
            case -Infinity: return NegInfinitySymbol;
            default:        return value;
            }
        }

        // Restore the constants
        let json = JSON.stringify(value, betterReplacer, space);
        json = json.replace(/"\uE001"/g, 'NaN').replace(/"\uE002"/g, 'Infinity').replace(/"\uE003"/g, '-Infinity').replace(/"\uE004"/g, 'undefined');
        return json;
    },
    
    parse: function parse(text, reviver) {
        function betterReviver(key, value) {
            // Restore the temporarily hidden IEEE 754 values
            switch (value) {
            case NaNSymbol:         value = NaN; break;
            case InfinitySymbol:    value = Infinity; break;
            case NegInfinitySymbol: value = -Infinity; break;
            case UndefinedSymbol:   value = undefined; break;
            }
            if (reviver) { value = reviver(key, value); }
            return value;
        }

        // Add leading and trailing whitespace so that \b can detect
        // breaks at the start and end of the string.
        text = ' ' + text + ' ';
        
        // Protect strings
        let protect = WorkJSON.protectQuotedStrings(text);
        text = protect[0];

        // Convert to strict Unix newlines
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        // Non-escaped empty backquote strings
        text = text.replace(/(^|[^\\])``/g, "");

        // Convert multiline backquote strings to singleline
        text = text.replace(/`((?:\s|\S)*?[^\\])`/g, function (match, inside) {
            return '"' + inside.replace(/\n/g, '\\n').replace(/\\`/g, '`').replace(/"/g, '\\"') + '"';
        });

        // Re-protect, hiding the newly converted strings
        protect = WorkJSON.protectQuotedStrings(WorkJSON.unprotectQuotedStrings(text, protect[1]));
        text = protect[0];

        // Remove multiline comments, preserving newlines
        text = text.replace(/\/\*(.|\n)*\*\//g, function (match) {
            return match.replace(/[^\n]/g, '');
        });

        // Remove singleline comments
        text = text.replace(/\/\/.*\n/g, '\n');

        // Remove trailing commas
        text = text.replace(/,(\s*[\]}\)])/g, '$1');

        // Remove leading + signs on numbers, without catching
        // exponential notation
        text = text.replace(/([\[:\s,])\+\s*(?=\.?\d)/g, '$1');

        // Hex constants
        text = text.replace(/0x[\da-fA-F]{1,8}/g, function (hex) {
            return '' + parseInt(hex);
        });

        // Numbers with leading '.'
        text = text.replace(/([\[:\s,])\.(?=\d)/g, '0.');

        // Numbers with trailing '.'
        text = text.replace(/(\d)\.([\]}\s,])/g, '$1$2');

        // Hide IEEE constants
        text = text.replace(/\bNaN\b/g, '"' + NaNSymbol + '"').
            replace(/\b-\s*Infinity\b/g, '"' + NegInfinitySymbol + '"').
            replace(/\bInfinity\b/g, '"' + InfinitySymbol + '"');

        // Quote unquoted keys
        text = text.replace(/([A-Za-z_][A-Za-z_0-9]*)(?=\s*:)/g, '"$1"');

        // Restore strings
        text = unprotectQuotedStrings(text, protect[1]);

        return JSON.parse(text, betterReviver);
    } // parse
}; // WorkJSON object
})();
 
