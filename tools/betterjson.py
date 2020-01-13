"""
  betterjson.py

  JSON extended with:

  - Optional trailing commas on arrays and objects
  - C++ single and multline comments
  - `Backtick` multiline strings
  - Explicit plus sign permitted on numbers
  - Numbers with bare leading or trailing decimal
  - NaN, Infinity, -Infinity (Python allows this by default)
  - Hexadecimal numbers
  - Optional unquoted object keys using [A-Za-z_0-9]+ characters only

  See also ../console/BetterJSON.js for the JavaScript version.
  betterjson.py is a port of BetterJSON.js that tracks that version
  and maintains the same structure to simplify patching.

  Just use betterjson.dumps(obj) and betterjson.loads(str) in place of
  json.dumps(obj) and json.loads(str). Note that the current version of
  betterjson does not support all of the options of the json module
  versions.

  betterjson.loads is 100% backwards compatible to JSON.parse 
  as long as your input has no characters in the Unicode private
  use area \uE000 through \uF8FF.

  The output of betterjson.dumps is identical to that of json.dumps.

  The implementation is designed to use only regexps and a vanilla
  JSON parser to simplify porting to other languages.

  This is similar to JSON5 (https://json5.org/) but is about 10x
  smaller. The primary difference is that betterjson intentionally 
  does not support unicode in unquoted keys.

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
"""

import json, re, sys, argparse

if (sys.version_info[0] < 3) or (sys.version_info[0] == 3 and sys.version_info[1] < 1):
   raise Exception("betterjson.py requires Python 3.1 or later")

_double_quote_protection = chr(0xE000)
_protection_block_start = 0xE010

""" Returns the new string and a map """
def _protect_quoted_strings(src):
   protection_map = []

   # Hide escaped quotes that would confuse the following regexp
   src = src.replace('\\"', _double_quote_protection)

   def protect(match):
      protection_map.append(match[1])
      return '"' +  chr(len(protection_map) - 1 + _protection_block_start) + '"'
   
   # Protect strings
   src = re.sub(r'"((?:[^"\\]|\\.)*)"', protect, src)

   return src, protection_map



def _unprotect_quoted_strings(s, protection_map):
   # Unprotect strings
   for i in range(0, len(protection_map)):
      s = s.replace(chr(_protection_block_start + i), protection_map[i], 1)

   # Unprotect escaped quotes
   return s.replace(_double_quote_protection, '\\"')



def dumps(obj, skipkeys=False, ensure_ascii=True, allow_nan=True,
          cls=None, indent=None, separators=None, default=None, sort_keys=False):
   
   return json.dumps(obj, skipkeys=skipkeys, allow_nan=allow_nan, ensure_ascii=ensure_ascii,
                     separators=separators, default=default, sort_keys=sort_keys)


""" s must be a string, unlike json.loads """
def loads(text, cls=None, object_hook=None, parse_float=None, parse_int=None,
          parse_constant=None, object_pairs_hook=None):

   text, map = _protect_quoted_strings(text)

   # Convert to strict Unix newlines
   text = text.replace('\r\n', '\n').replace('\r', '\n')

   # Non-escaped empty backquote strings
   text = re.sub(r'(^|[^\\])``', '', text)

   # Convert multiline backquote strings to singleline
   def quote_replace(match):
      return '"' + match[0].replace('\n', r'\n').replace(r'\`', '`').replace('"', r'\"') + '"'
         
   text = re.sub(r'`((?:\s|\S)*?[^\\])`', quote_replace, text)

   # Re-protect, hiding the newly converted strings
   text, map = _protect_quoted_strings(_unprotect_quoted_strings(text, map))

   # Remove multiline comments, preserving newlines
   def comment_replace(match):
      return re.sub(r'[^\n]', '', match[0])
   
   text = re.sub(r'\/\*(.|\n)*\*\//', comment_replace, text)

   # Remove singleline comments
   text = re.sub(r'\/\/.*\n', '\n', text)

   # Remove trailing commas
   text = re.sub(r',(\s*[\]}\)])', r'\g<1>', text)

   # Remove leading + signs on numbers, without catching
   # exponential notation
   text = re.sub(r'([\[:\s,])\+\s*(?=\.?\d)', r'\g<1>', text)

   # Hex constants
   def hex_replace(match): return str(int(match[0], 16))
   text = re.sub(r'0x[\da-fA-F]{1,8}', hex_replace, text)

   # Numbers with leading '.'
   text = re.sub(r'([\[:\s,])\.(?=\d)', '0.', text)

   # Numbers with trailing '.'
   text = re.sub(r'(\d)\.([\]}\s,])', r'\g<1>\g<2>', text)

   # No need to hide IEEE special constants in Python
   
   # Quote unquoted keys
   text = re.sub(r'([A-Za-z_][A-Za-z_0-9]*)(?=\s*:)', r'"\g<1>"', text)

   # Restore strings
   text = _unprotect_quoted_strings(text, map)

   # TODO: Pass other options
   return json.loads(text)


# Run as "python3 betterjson.py --test" from the command line to
# use as a unit test.
def _test():
   t1 = '..."hello" world'
   t, m = _protect_quoted_strings(t1)
   assert t1 == _unprotect_quoted_strings(t, m)

   print(loads('{foo:"bar"}'))


if __name__== '__main__':
   parser = argparse.ArgumentParser(description='More permissive deserialization of JSON')
   parser.add_argument('--test', action='store_true', default=False,
                       help='Run unit tests on the library')

   args = parser.parse_args()

   if args.test: _test()
 
