/*
  BetterJSON.js

  JSON extended with:

  - Optional trailing commas on arrays and objects
  - C++ single and multline comments
  - `Backtick` multiline strings
  - Explicit plus sign permitted on numbers
  - Numbers with bare leading or trailing decimal
  - NaN, Infinity, -Infinity
  - Hexadecimal numbers
  - Strict Unix newlines

  Just use BetterJSON.parse and BetterJSON.stringify in place of the
  JSON versions.

  The implementation is designed to use only regexps and a vanilla
  JSON parser to simplify porting to other languages.

  This is similar to JSON5 (https://json5.org/) but is about 20x
  smaller. The primary difference is that BetterJSON does not support
  unquoted strings.

  By @CasualEffects

  ------------------------------------------------------------------

  Open Source under the BSD-2-Clause License:

  Copyright 2020 Morgan McGuire, https://casual-effects.com

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met:

  1. Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.

  2. Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
  
  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
  "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
  A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
  HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/


const BetterJSON = (function () {
const doubleQuoteProtection = String.fromCharCode(0xE000);
const protectionBlockStart = 0xE010;

const NaNSymbol = '\uE001', InfinitySymbol = '\uE002', NegInfinitySymbol = '\uE003';


return {
    /** Returns the new string and a map */
    protectQuotedStrings: function protectQuotedStrings(src) {
        let numProtected = 0, protectionMap = [];

        // Hide escaped quotes that would confuse the following regexp
        src = src.replace('\\"', doubleQuoteProtection);
                      
        // Protect strings
        src = src.replace(/"((?:[^"\\]|\\.)*)"/g, function (match, str) {
            protectionMap.push(str);
            return '"' +  String.fromCharCode(numProtected++ + protectionBlockStart) + '"';
        });

        return [src, protectionMap];
    },

    unprotectQuotedStrings : function unprotectQuotedStrings(s, protectionMap) {
        // Unprotect strings
        for (let i = 0; i < protectionMap.length; ++i) {
            s = s.replace(String.fromCharCode(protectionBlockStart + i), protectionMap[i]);
        }

        // Unprotect escaped quotes
        return s.replace(doubleQuoteProtection, '\\"');
    },

    stringify: function stringify(value, replacer, space) {
        // Allow IEEE numeric constants by temporarily hiding them
        function betterReplacer(key, value) {
            if (replacer) { value = replacer(key, value); }

            if ((typeof value === 'number') && isNaN(value)) { return NaNSymbol; }
            
            switch (value) {
            case Infinity:  return InfinitySymbol;
            case -Infinity: return NegInfinitySymbol;
            default:        return value;
            }
        }

        // Restore the constants
        let json = JSON.stringify(value, betterReplacer, space);
        json = json.replace(/"\uE001"/g, 'NaN').replace(/"\uE002"/g, 'Infinity').replace(/"\uE003"/g, '-Infinity');
        return json;
    },
    
    parse: function parse(text, reviver) {
        function betterReviver(key, value) {
            // Restore the temporarily hidden IEEE 754 values
            switch (value) {
            case NaNSymbol:         value = NaN; break;
            case InfinitySymbol:    value = Infinity; break;
            case NegInfinitySymbol: value = -Infinity; break;
            }
            if (reviver) { value = reviver(key, value); }
            return value;
        }

        // Add leading and trailing whitespace so that \b can detect
        // breaks at the start and end of the string.
        text = ' ' + text + ' ';
        
        // Protect strings
        let protect = BetterJSON.protectQuotedStrings(text);
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
        protect = BetterJSON.protectQuotedStrings(BetterJSON.unprotectQuotedStrings(text, protect[1]));
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

        // Restore strings
        text = unprotectQuotedStrings(text, protect[1]);

        return JSON.parse(text, betterReviver);
    } // parse
}; // BetterJSON object
})();
 
