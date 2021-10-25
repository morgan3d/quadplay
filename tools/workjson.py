"""workjson.py

  JSON extended with:

  - Optional trailing commas on arrays and objects
  - C++ single and multline comments
  - `Backtick` multiline strings
  - Explicit plus sign permitted on numbers
  - Numbers with bare leading or trailing decimal
  - NaN, Infinity, -Infinity (Python allows this by default)
  - Hexadecimal numbers
  - Optional unquoted object keys using [A-Za-z_0-9]+ characters only

  See also ../console/workjson.js for the JavaScript version.
  workjson.py is a port of workjson.js that tracks that version
  and maintains the same structure to simplify patching.

  Just use workjson.dumps(obj) and workjson.loads(str) in place of
  json.dumps(obj) and json.loads(str). Note that the current version of
  workjson does not support all of the options of the json module
  versions.

  workjson.loads is 100% backwards compatible to JSON.parse 
  as long as your input has no characters in the Unicode private
  use area \uE000 through \uF8FF.

  The output of workjson.dumps is identical to that of json.dumps.

  The implementation is designed to use only regexps and a vanilla
  JSON parser to simplify porting to other languages.

  This is similar to JSON5 (https://json5.org/) but is about 10x
  smaller. The primary difference is that workjson intentionally 
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
"""

import json, re, sys, argparse, functools

if (sys.version_info[0] < 3) or (sys.version_info[0] == 3 and sys.version_info[1] < 1):
   raise Exception("workjson.py requires Python 3.1 or later")

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
                      separators=separators, default=default, sort_keys=sort_keys,
                      cls=cls, indent=indent)


@functools.wraps(json.loads)
def loads(text, cls=None, object_hook=None, parse_float=None, parse_int=None,
          parse_constant=None, object_pairs_hook=None):

   text, map = _protect_quoted_strings(text)

   # Convert to strict Unix newlines
   text = text.replace('\r\n', '\n').replace('\r', '\n')

   # Non-escaped empty backquote or single-quote strings
   text = re.sub(r"(^|[^\\])(``|'')", '""', text)

   # Convert multiline backquote strings to singleline
   def backquote_replace(match):
       return '"' + match[1].replace('\n', r'\n').replace(r'\`', '`').replace('"', r'\"') + '"'
    
   text = re.sub(r'`((?:\s|\S)*?[^\\])`', backquote_replace, text)

   # Convert single-quoted strings to double quoted
   def singlequote_replace(match):
       print(match[1])
       return '"' + match[1].replace('"', r'\"') + '"'
   text = re.sub(r"'(.*?[^\\])'", singlequote_replace, text)

   # Re-protect, hiding the newly converted strings
   text, map = _protect_quoted_strings(_unprotect_quoted_strings(text, map))

   # Remove multiline comments, preserving newlines
   def comment_replace(match):
       return re.sub(r'[^\n]', '', match[0])
   
   text = re.sub(r'\/\*(.|\n)*\*\/', comment_replace, text)

   # Remove single line comments
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

loads.__doc__ = json.loads.__doc__ + """\n Argument s must be a string, unlike json.loads """

@functools.wraps(json.load)
def load(fp, *args, **kw):
    with open(fp, encoding="utf-8", errors="replace") as fi:
        return loads(fi.read(), *args, **kw)

@functools.wraps(json.dump)
def dump(fp, json, *args, **kw):
    with open(fp, 'w', encoding='utf-8') as f:
        f.write(dumps(json, *args, **kw))
    
# Run as "python3 workjson.py --test" from the command line to
# use as a unit test.
def _test():
    t1 = '..."hello" world'
    t, m = _protect_quoted_strings(t1)
    assert t1 == _unprotect_quoted_strings(t, m)

    print(loads('{foo:"bar"}'))
    print(loads("{fob:'baz'}"))


    
if __name__== '__main__':
   parser = argparse.ArgumentParser(description='More permissive deserialization of JSON')
   parser.add_argument('--test', action='store_true', default=False,
                       help='Run unit tests on the library')

   args = parser.parse_args()

   if args.test: _test()
 
