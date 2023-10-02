/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */
"use strict";

const SHOW_COMPILED_CODE = false;

/* Set to false if using an unpatched esprima parser that does not
   support the spread operator in objects. */
const PARSER_SUPPORTS_OBJECT_SPREAD = true;

const unprotectQuotedStrings = WorkJSON.unprotectQuotedStrings;
const protectQuotedStrings = WorkJSON.protectQuotedStrings;

function makeError(msg, srcLine) {
    return {lineNumber: (srcLine + 1), message: msg};
}

String.prototype.rtrim = function() {
    return this.replace(/\s+$/, '');
}

/** Assumes that str[i]==='('. Returns the index of the
    matching close ')', assuming that parens are balanced
    and there are no quoted strings or incorrectly
    nested other grouping characters. */
function findMatchingParen(str, i, direction, open = '(', close = ')') {
    i += direction;
    for (let stack = 1; stack > 0; i += direction) {
        switch (str[i]) {
        case open: stack += direction; break;
        case close: stack -= direction; break;
        }
        if (i === str.length || i === -1) {
            throw 'Missing matching parenthesis';
        }
    } // for
    
    return i;
}


/** Returns the index of c or d within str on or after j, or -1 if none.
    Skips over balanced ()[]{}. */
function nextInstance(str, c, j, d) {
    if (d !== undefined) {
        // Two arguments; see which comes first
        const i0 = nextInstance(str, c, j);
        const i1 = nextInstance(str, d, j);
        if (i0 > -1) {
            if (i1 > -1) {
                return Math.min(i0, i1);
            } else {
                return i0;
            }
        } else {
            return i1;
        }
    }

    j = j || 0;
    
    const count = {'(':0,   '{':0,   '[':0};
    const match = {')':'(', '}':'{', ']':'['};
    let stack = 0;
    while (j < str.length) {
        const x = str[j];
        if (x in count) {
            ++count[x];
            ++stack;
        } else if (x in match) {
            --stack;
            if (--count[match[x]] < 0) {
                throw "Unbalanced parens while looking for '" + c + "'";
            }
        } else if ((x === c) && (stack === 0)) {
            return j;
        }
        ++j;
    }
    return -1;
}


// The identifier pattern is also used in quadplay-runtime.js $removeMarkup() and must be kept in sync
const identifierPattern = '_?[Δ]?(?:_?[A-Za-z][A-Za-z_0-9]*|[αβγΔδζηθιλμρσϕφχψτωΩ][_0-9]*(?:_[A-Za-z_0-9]*)?)';
const identifierRegex = RegExp(identifierPattern);

// for WITH statements
const withIdentifierListRegex = RegExp('^[ \\t]*(' + identifierPattern + '[ \\t]*(?:,[ \\t]*' + identifierPattern + '[ \\t]*)*)∊(.*)$');


function legalIdentifier(id) {
    return id.match(identifierRegex);
}


/** Given a pyxl WITH preamble not surrounded in extra (), returns an
    array of two elements: [0] is the code that goes at the front of
    the block, and [1] is the code that goes at the end.  */
function processWithHeader(test) {
    // Cannot create a function because that would break the
    // coroutines used for preemptive multitasking.
    //
    // Syntax: with var0[, var1[, ...]] ∊ expr
    //
    //
    // Maps to ($_ variables are gensyms):
    //
    //
    // { let $_obj = (expr),
    //       var0 = $_obj.var0, ..., varn = $_obj.varn,
    //       $_var0Descriptor = Object.getOwnPropertyDescriptor($_obj, 'var0'), ...;
    //   Object.defineProperties($_obj, {var0: {configurable:true, get() { return var0; }, set($_v) { var0 = $_v; }}, ...});
    //   try {
    //
    //      ...
    //
    //   } finally {
    //       if ($_var0Descriptor.get) Object.defineProperty($_obj, 'var0', $_var0Descriptor); else delete $_obj.var0; $_obj.var0 = var0;
    //       ...
    //  }}

    const match = test.match(withIdentifierListRegex);
    // match[0] = whole match
    // match[1] = variables
    // match[2] = object expression

    if (! match) {
        throw 'Incorrect WITH statement syntax';        
    }
    
    const expr = match[2].trim();
    const varArray = match[1].split(',').map(function (s) { return s.trim(); });

    const obj = gensym('obj'), v = gensym('v');
    const varDescriptorArray = varArray.map(function (vari) { return gensym(vari + 'Descriptor'); });

    const result = [];
    
    const index = gensym('index');
    result[0] = `{ let ${obj} = (${expr})`;
    for (let i = 0; i < varArray.length; ++i) {
        result[0] += `, ${varArray[i]} = ${obj}.${varArray[i]}`;
    }
    
    for (let i = 0; i < varArray.length; ++i) {
        result[0] += `, ${varDescriptorArray[i]} = $Object.getOwnPropertyDescriptor(${obj}, '${varArray[i]}')`;
    }

    result[0] += ';';

    for (let i = 0; i < varArray.length; ++i) {
        result[0] += ` if (! ${varDescriptorArray[i]}) { $error("No '${varArray[i]}' property on object in this with statement")};`;
    }
    
    result[0] += `$Object.defineProperties(${obj}, {` +
        varArray.reduce(function(prev, vari) { return prev + `${vari}: {configurable: true, get() { return ${vari}; }, set(${v}) { ${vari} = ${v}; }}, `; }, '') +
        '}); try {';
    

    result[1] = '} finally { ';

    for (let i = 0; i < varArray.length; ++i) {
        result[1] += `if (${varDescriptorArray[i]}.get) { $Object.defineProperty(${obj}, '${varArray[i]}', ${varDescriptorArray[i]}); } else { delete ${obj}.${varArray[i]}; } ${obj}.${varArray[i]} = ${varArray[i]}; `;
    }
    result[1] += '}}';
    
    return result;
}


/** Given a pyxl FOR-loop test that does not contain the colon,
 * returns the parts before and after the loop. */
function processForTest(test) {
    let before = '', after = '}';

    if ((test[0] === '(') && (test[test.length - 1] === ')') && (nextInstance(test, ')', 1) === test.length - 1)) {
        // There are extra parens surrounding the entire test
        test = test.substring(1, test.length - 1);
    }

    // Named index/key
    let key = gensym('key');
    test = test.replace(RegExp('\\s+at\\s+(' + identifierPattern + ')\\s*∊'), function (match, keyName) {
        key = keyName;
        return ' ∊';
    });

    // The case of a FOR-WITH loop of the form 'for x,y,... ∊ a ∊ array ...'
    let match = test.match(RegExp('^\\s*(\\S.*)∊\\s*(' + identifierPattern + ')\\s*∊(.*)$'));
    if (match) {
        // match[1] = member variables
        // match[2] = with container expr/for variable
        // match[3] = for container expr

        // Rewrite the tested expr
        const withPart = processWithHeader(match[1] + '∊' + match[2]);
        before = withPart[0];
        after = withPart[1] + '}';
        test = match[2] + '∊' + match[3]
    }
        
    match = test.match(RegExp('^\\s*(' + identifierPattern + ')\\s*∊(.*)$'));
    
    if (match) {
        // Generate variables
        const value = match[1],
              container = gensym('container'),
              is_obj = gensym('is_obj'),
              index = gensym('index'),
              key_array = gensym('key_array'),
              is_mutable = gensym('is_mutable'),
              containerExpr = match[2].trim();

        // The '==' on the next line is converted to a === by the remaining compiler pass
        return [`{const ${container} = ${containerExpr}; ` +
                `const ${is_obj} = is_object(${container}); ` +
                `$checkContainer(${container}); ` +
                `const ${is_mutable} = ! $Object.isFrozen(${container}) && ! $Object.isSealed(${container}); ` +
                `try { ` +
                `  let ${key_array} = ${is_obj} ? keys(${container}) : ${container}; ` +
                `  if (${is_mutable}) { $iteratorCount.set(${container}, ($iteratorCount.get(${container}) || 0) + 1); } ` +
                `  for (let ${index} = 0; ${index} < ${key_array}.length; ++${index}) { ` +
                `    let ${key} = ${is_obj} ? ${key_array}[${index}] : ${index}; ` +
                `    if (${is_obj} && (${key}[0] == '_')) { continue; }; ` +
                `    let ${value} = ${container}[${key}]; ${before} `,
                after +
                `} finally { if (${is_mutable}) { $iteratorCount.set(${container}, $iteratorCount.get(${container}) - 1); }}}`];
    } else {
        before = '{';
    }

    // Range FOR loop
    
    // Look for ≤ or < expressions, but skip over pairs of parens
    const j = nextInstance(test, '<', 0, '≤');
    if (j === -1) { throw 'No < or ≤ found in FOR loop declaration'; }
    var op = (test[j] === '≤') ? '<=' : '<';
    
    const k = nextInstance(test, '<', j + 1, '≤');
    let identifier, initExpr, endExpr;

    if (k === -1) {
        // has the form "variable < expr"
        identifier = test.substring(0, j).trim();
        endExpr = test.substring(j + 1).trim();
        initExpr = '0';
    } else {
        // has the form "expr < variable < expr"
        // j is the location of the first operator
        // k is the location of the second operator
        
        initExpr = test.substring(0, j).trim();
        if (op === '<') {
            initExpr = '$Math.floor(' + initExpr + ') + 1';
        }

        op = (test[k] === '≤') ? '<=' : '<';
        identifier = test.substring(j + 1, k).trim();
        endExpr = test.substring(k + 1).trim();
    }

    if (! legalIdentifier(identifier)) { throw 'Illegal FOR-loop variable syntax'; }
    const iterator = gensym(identifier);
    const endVar = gensym('end');
    return [`for (let ${iterator} = ${initExpr}, ${endVar} = ${endExpr}; ${iterator} ${op} ${endVar}; ++${iterator}) ${before} let ${identifier} = ${iterator};`, after];
}


/**
   Returns the line after compilation to JavaScript.

   Algorithm:
   1. Process the line up to the first ';' or single-line block body
   2. Process the rest recursively
*/
function processLine(line, inFunction, stringProtectionMap) {
    let next = '';
    let separatorIndex = line.indexOf(';')
    if (separatorIndex > 0) {
        // Separate the next statement out
        next = line.substring(separatorIndex + 1).trim();
        line = line.substring(0, separatorIndex).rtrim();
    }

    if (line.search(/\S/) === -1) {
        // Empty line, we're done
        return line;
    }

    let match;
    if (match = line.match(/^(\s*)(for|if|(?:else[ \t]+if)|else|while|until|with|def|local)(\b.*)/)) {
        // line is a control flow-affecting expresion
        let before = match[1], type = match[2], rest = match[3].trim() + '; ' + next;

        if (type === 'def') {
            match = rest.match(/\s*([^\( \n\t]+)?\s*\((.*?)\)[ \t]*:(.*)/);

            if (! match) { throw 'Ill-formed single-line function definition'; }
            let name = match[1];
            let args = match[2] || '';
            let body = match[3];

            args = processDefaultArgSyntax(args)

            body = processLine(body, true, stringProtectionMap);
            // Wrapping the function definition in parens can trigger heuristics in Chromium
            // at top level that improve compilation (likely not useful for dynamically generated code, but potentially
            // helpful when exporting to static HTML)
            line = before + 'const ' + name + ' = (function(' + args + ') { ' + body + ' })';
            return line;

        } else {
            
            // Read the test expression
            let end = nextInstance(rest, ':');
            if (end === -1) { throw 'Missing : after single-line "' + type + '".'; }
            let test = rest.substring(0, end);
            let prefix = '', suffix = '}';

            switch (type) {
            case 'local':
                type = '';
                prefix = '{';
                break;

            case 'with':
                {
                    const result = processWithHeader(test);
                    prefix = result[0];
                    suffix = result[1];
                }
                break;

            case 'until':
                type = 'while';
                prefix = 'while (! (' + test + ')) {';
                break;

            case 'for':
                {
                    const result = processForTest(test);
                    prefix = result[0];
                    suffix = result[1];
                }
                break;

            case 'else':
                prefix = type + ' {';
                break;
                
            default:
                // case 'while':
                // case 'if':
                // case /else[ \t]+if/:
                prefix = type + ' (' + test.trim() + ') {';
                break;
            }
            return before + prefix + 
                processLine(rest.substring(end + 1), inFunction, stringProtectionMap) + '; ' + suffix;
            
        } // if control flow block
    } else if (match = line.match(/^(\s*)(preserving_transform\s*:)(.*)/)) {
        // line is a control flow-affecting expresion
        let before = match[1], type = match[2], rest = match[3].trim() + '; ' + next;

        let end = nextInstance(rest, ':');
        if (end === -1) { throw 'Missing : after single-line "' + type + '".'; }

        return before + 'try { $pushGraphicsState(); ' +
            processLine(rest.substring(end + 1), inFunction, stringProtectionMap) + '; } finally { $popGraphicsState(); }';
    
    } else if (match = line.match(/^(\s*)(let|const)\s+(.*)/)) {

        // match let or const
        let before = match[1];
        let type   = match[2];
        let rest   = match[3];

        if ((type === 'let') || (type === 'const')) {
            return before + type + ' ' + rest + ((next !== '') ? '; ' + processLine(next, inFunction, stringProtectionMap) : ';');
        }

    } else if (match = line.match(/^(\s*)(debug_watch|debug_print)\s*(\(.+)/)) {
        const before = match[1];
        const call = match[2];
        const rest = match[3];
        const closeIndex = findMatchingParen(rest, 0, +1);

        let watchExpr = rest.substring(1, closeIndex - 1);
        let message = unprotectQuotedStrings(watchExpr, stringProtectionMap);
        
        // The strings inside of watchExpr are protected, so we have
        // to unprotect, escape quotes, and then reprotect them to make it safe.
        message = message.replace(/"/g, '\\"');        
        message = protectQuotedStrings('"' + message + '"', stringProtectionMap)[0];
        return before + '($' + (call === 'debug_watch' ? 'debugWatch' : 'debugPrint') + 'Enabled && $' + call + '(SOURCE_LOCATION, ' + message + ', ' + watchExpr + ')); ' + processLine(rest.substring(closeIndex + 1), inFunction, stringProtectionMap);
        
    } else {
        // Recursively process the next expression. 
        return line + '; ' + processLine(next, inFunction, stringProtectionMap);
    }
}


/** 
    Given a string containing the arguments [without surrounding
    function parentheses], rewrite 'arg default ...' as 'arg = ...',
    handling complicated cases such as chained use of the default
    statement and other further quadplay statements in the default
    expression. Return legal JavaScript for substitution.
*/
function processDefaultArgSyntax(args) {
    // Nothing to parse
    if (! /\bdefault\b/.test(args)) { return args; }

    const match = {'(':')', '[':']', '{':'}'};

    let accum = '';
    let i = 0;
    let first = true;
    while (i !== -1) {
        // Find the next interesting symbol or character. The first time
        // through, we stop at 'default'. Thereafter, we only stop for
        // commas or parens.
        i = args.search(first ? /[,\(\[\{]| default / : /[,\(\[\{]/);
        first = false;
        if (i === -1) {
            // Nothing to do, break
        } else if (args[i] === ',' || args[i] === ' ') {
            if (args[i] === ',') {
                do { ++i; } while (i < args.length && args[i] === ' ');
                // Skip over the argument
                do { ++i; } while (i < args.length && ! /[ ,\)]/.test(args[i]));
            }

            // And any space after the argument
            while (i < args.length && args[i] === ' ') { ++i; };

            // Move all of this to accum
            accum += args.substring(0, i); args = args.substring(i);

            // See if there's a 'default', and convert it if so
            if (args.startsWith('default ')) {
                accum += '= ';
                args = args.substring('default '.length);
            }
        } else {
            // Skip to the matching paren
            i = findMatchingParen(args, i, +1, args[i], match[args[i]]);
            accum += args.substring(0, i); args = args.substring(i);
        }
    }
    // No more, we're done
    return accum + args;
}


/* Converts #.... to rgb, rgba, or gray function calls */
function replaceHexColors(src) {
    return src.replace(/#([0-9a-fA-F]+)/g, function (match, str) {
        const color = parseHexColor(str);
           
        if (str.length === 3 || str.length === 1 || str.length === 6) {
            if ((color.r === color.g) && (color.g === color.b)) {
                return `gray(${color.r})`;
            } else {
                return `rgb(${color.r}, ${color.g}, ${color.b})`;
            }
        } else {
            return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
        }
    });
}


/* Throws an error on illegal syntax */
function testForIllegalSyntax(src, lineNumber, indent, internalMode) {
    if (/[^A-Za-zαβγΔδζηθιλμρσϕφχψτωΩ_\.0-9#]0\d/g.test(src)) {
        throw makeError('Numbers may not begin with a leading zero', lineNumber);
    }

    const illegal = src.match(/\b(===|!==|&&|&=|\|=|&|toString|try|switch|this|delete|null|arguments|undefined|use|using|yield|prototype|var|new|auto|as|instanceof|typeof|\$|class)\b/) ||
          src.match(/('|&(?![=&])|!(?!=))/) || // Single quote, single &, single !
          (! internalMode && src.match(/\b[\$]\S*?\b/)); // Dollar signs
        
    if (illegal) {
        const alternative = {'|=':'∪=" or "bitor', '&&':'and', '&=':'∩=" or "bitand', '&':'∩" or "bitand', "'":'"', '!==':'!=', '!':'not', 'var':'let', 'null':'nil', '===':'=='};
        let msg = 'Illegal symbol "' + illegal[0] + '"';
        if (illegal[0] in alternative) {
            msg += ' (maybe you meant "' + alternative[illegal[0]] + '")';
        }
        
        if (illegal[0] === "'") {
            msg = 'Illegal single-quote (\'). Maybe you meant to use double quote (") for a string.';
        }
            
        throw makeError(msg, lineNumber);
    }

    if ((lineNumber === 0) && (indent > 0)) {
        throw makeError('First line must not be indented', lineNumber);
    }
}


/**
 Returns nextLineIndex

 Compile the block body that begins at `startLineIndex`, mutating the
 lines in place.
 
 1. Iteratively process lines in the current block, using processLine on each
 2. Recursively process sub-blocks
*/
function processBlock(lineArray, startLineIndex, inFunction, internalMode, stringProtectionMap) {
    
    // Indentation of the previous block. Only used for indentation
    // error checking. The previous line kicked off processing of this
    // block, so it must have code on it.
    let prevBlockIndent = startLineIndex < 1 ? 0 :
        lineArray[startLineIndex - 1].search(/\S/);
    
    // Indentation index of the previous line, indentation index of
    // the block start
    let prevIndent, originalIndent;

    // Current line index
    let i;
    for (i = startLineIndex; i < lineArray.length; ++i) {
        // Trim right whitespace
        lineArray[i] = lineArray[i].rtrim();
        let indent = lineArray[i].search(/\S/);
        
        // Ignore empty lines
        if (indent < 0) { continue; }

        if (prevIndent === undefined) {
            // Initialize on the first non-empty line
            prevIndent = indent;
            originalIndent = indent;
        }

        // Has the block ended?
        if (indent < originalIndent) {
            // Indentation must not be more than the previous block, because
            // otherwise there would be inconsistent indentation
            if (indent > prevBlockIndent) { throw makeError('Inconsistent indentation', i); }
            return i;
        }
        
        // Colors in hex format
        lineArray[i] = replaceHexColors(lineArray[i]);

        // Check for some illegal situations while we're processing
        testForIllegalSyntax(lineArray[i], i, indent, internalMode);

        // See if the next non-empty line is not indented more than this one
        let singleLine = true;
        for (let j = i + 1; j < lineArray.length; ++j) {
            let nextIndent = lineArray[j].search(/\S/);
            if (nextIndent >= 0) {
                singleLine = (nextIndent <= indent);
                break;
            }
        }

        // Note the assignment to variable `match` in the IF statement tests below
        let match;
        if (singleLine) {
            try {
                lineArray[i] = processLine(lineArray[i], inFunction, stringProtectionMap);
            } catch (e) {
                throw makeError(e, i);
            }
            
        } else if (match = lineArray[i].match(RegExp('^(\\s*)def\\s+(\\$?' + identifierPattern + ')\\s*\\((.*)\\)[ \t]*([a-zA-Z_]*)[ \t]*:\\s*$'))) {
            // DEF
            let prefix = match[1], name = match[2], args = match[3] || '', modifier = match[4] || '';
            let end = processBlock(lineArray, i + 1, true, internalMode, stringProtectionMap) - 1;

            // Rewrite args for default values
            args = processDefaultArgSyntax(args);
            
            lineArray[i] = prefix + 'const ' + name + ' = (function(' + args + ') { ';
            if (modifier === 'preserving_transform') {
                lineArray[i] += 'try { $pushGraphicsState();';
            } else if (modifier !== '') {
                throw makeError('Illegal function modifier: ' + modifier, i);
            }
            i = end;

            if (modifier === 'preserving_transform') {
                lineArray[i] += '} finally { $popGraphicsState(); }';
            }
            lineArray[i] += '});';
            
        } else if (match = lineArray[i].match(/^(\s*)with\s+\(?(.+∊.+)\)?[ \t]*:[ \t]*$/)) {
            // WITH
            
            let prefix = match[1];
            let result;
            try {
                result = processWithHeader(match[2]);
            } catch (e) {
                throw makeError(e, i);
            }
            lineArray[i] = prefix + result[0];
            i = processBlock(lineArray, i + 1, inFunction, internalMode, stringProtectionMap) - 1;
            lineArray[i] += result[1];

        } else if (match = lineArray[i].match(/^(\s*)local[ \t]*:[ \t]*$/)) {
            // LOCAL
            
            let prefix = match[1];
            lineArray[i] = prefix + '{';
            i = processBlock(lineArray, i + 1, inFunction, internalMode, stringProtectionMap) - 1;
            lineArray[i] += '}';

        } else if (match = lineArray[i].match(/^(\s*)preserving_transform[ \t]*:[ \t]*$/)) {
            // PRESERVING TRANSFORM
            
            let prefix = match[1];
            lineArray[i] = prefix + 'try { $pushGraphicsState()';
            i = processBlock(lineArray, i + 1, inFunction, internalMode, stringProtectionMap) - 1;
            lineArray[i] += '} finally { $popGraphicsState(); }';

        } else if (match = lineArray[i].match(/^(\s*)for\s*(\b[^:]+)[ \t]*:[ \t]*$/)) {
            // FOR
            let prefix = match[1];
            let test = match[2];
            let forPart;
            try {
                forPart = processForTest(test);
            } catch (e) {
                throw makeError(e, i);
            }
            lineArray[i] = prefix + forPart[0];
            i = processBlock(lineArray, i + 1, inFunction, internalMode, stringProtectionMap) - 1;
            lineArray[i] += forPart[1];
            
        } else if (match = lineArray[i].match(/^(\s*)(if|else[\t ]+if)(\b.*):\s*$/)) {
            // IF, ELSE IF

            let old = i;
            lineArray[i] = match[1] + (/^\s*else[\t ]+if/.test(match[2]) ? 'else ' : '') + 'if (' + match[3].trim() + ') {';
            i = processBlock(lineArray, i + 1, inFunction, internalMode, stringProtectionMap) - 1;
            lineArray[i] += '}';
            
        } else if (match = lineArray[i].match(/^(\s*else)\s*:\s*$/)) {
            // ELSE
            
            lineArray[i] = match[1] + ' {';
            i = processBlock(lineArray, i + 1, inFunction, internalMode, stringProtectionMap) - 1;
            lineArray[i] += '}';
            
        } else if (match = lineArray[i].match(/^(\s*)(while|until)(\b.*)\s*:\s*$/)) {
            // WHILE/UNTIL
            
            let test = match[3];
            if (match[2] === 'until') {
                test = '! (' + test + ')';
            }

            lineArray[i] = match[1] + 'while (' + test + ') { ';
            i = processBlock(lineArray, i + 1, inFunction, internalMode, stringProtectionMap) - 1;
            lineArray[i] += '}';

        } else {
            throw makeError('Illegal block statement', i);
        }

        prevIndent = indent;
    } // for each line
    
    return i;
}


/** Magnitude and absolute value */
function processBars(src, sym, fcn) {
    // Absolute value
    var i = src.indexOf(sym);
    while (i >= 0) {
        let j = nextInstance(src, sym, i + 1);
        if (j === -1) { throw makeError("Unbalanced " + sym + "..." + sym, 0); }
        src = src.substring(0, i) + ' ' + fcn + '(' + src.substring(i + 1, j) + ') ' + src.substring(j + 1);

        // See if there are more instances
        i = src.indexOf(sym);
    }
    return src;
}


let gensymNum = 0;
/** Returns a new identifier */
function gensym(base) {
    return '$_' + (base || '') + (++gensymNum) + '$_';
}

/** Pull up multi-line expressions enclosed in (), [], {} onto their
    start line and leave the intervening lines empty. This undesirably
    gives incorrect line numbers for errors within those expressions,
    but it allows the rest of the parser to operate strictly on single-line
    expressions and control flow. 

    Also compact lines that terminate in a ",", which can result from a multiline
    FOR or WITH statement
*/
function compactMultilineLiterals(lineArray) {
    let i = 0;

    // Count across the current multi-line expression
    let count = Object.seal([0, 0, 0]);

    const BRACKET  = '()[]{}';

    while (i < lineArray.length) {
        // -1 when there is no current expression building
        let currentExprStartLine = -1;
        let multiLine = false;
        do {
            const line = lineArray[i];

            // Update the count for this line
            for (let j = 0; j < line.length; ++j) {
                let type = BRACKET.indexOf(line[j]);
                if (type > -1) {
                    // even indices are open brackets that increment,
                    // odds indices are close brackets that decrement.
                    count[type >> 1] += 1 - ((type & 1) << 1);
                }
            }

            // See if we're still unbalanced
            multiLine = false;
            for (let c = 0; c < 3; ++c) {
                if (count[c] < 0) {
                    throw makeError('Extra "' + BRACKET[2 * c + 1] + '", no expression to close', i);
                } else if (count[c] > 0) {
                    if (currentExprStartLine === -1) {
                        // Start a new expression
                        currentExprStartLine = i;
                    }
                    multiLine = true;
                }
            }

            const multiLineContinuesHere =   multiLine && (currentExprStartLine !== i);
            const multiLineEndsHere      = ! multiLine && (currentExprStartLine !== -1);

            if (multiLineEndsHere && (lineArray[i].indexOf(';') !== -1)) {
                throw makeError('";" not allowed on lines ending multi-line expressions.', i);
            }
                
            if (multiLineContinuesHere || multiLineEndsHere) {
                // move line i up to the expression start
                lineArray[currentExprStartLine] += ' ' + lineArray[i].trim();
                lineArray[i] = '';
            }

            if (i === lineArray.length - 1) {
                if (multiLineEndsHere) {
                    // Expression ended the entire program
                    return lineArray;
                } else if (multiLineContinuesHere) {
                    // Ran out of length!
                    console.error();
                    throw makeError('Expression not closed before the end of the file.', currentExprStartLine);
                }
            }
                
            ++i;
        } while (multiLine);
    } // while not at end

    i = lineArray.length - 1;
    while (i > 0) {
        const prev = lineArray[i - 1];
        if (prev.match(/,\s*$/)) {
            // Pull up onto previous line
            lineArray[i - 1] = prev.trimEnd() + ' ' + lineArray[i].trimStart();
            lineArray[i] = '';
        }
        --i;
    }  // while not at end


    return lineArray;
}


/** Function that count occurrences of a substring in a string;
 * @param {String} string               The string
 * @param {String} subString            The sub string to search for
 * @param {Boolean} [allowOverlapping]  Optional. (Default:false)
 *
 * Derived from
 * @author Vitim.us https://gist.github.com/victornpb/7736865
 * @see Unit Test https://jsfiddle.net/Victornpb/5axuh96u/
 * @see http://stackoverflow.com/questions/4009756/how-to-count-string-occurrence-in-string/7924240#7924240
 */
function countOccurrences(string, subString, allowOverlapping) {
    let n = 0,
        pos = 0,
        step = allowOverlapping ? 1 : subString.length;

    while (true) {
        pos = string.indexOf(subString, pos);
        if (pos >= 0) {
            ++n;
            pos += step;
        } else {
            break;
        }
    }
    
    return n;
}


function countRegexOccurences(string, regex) {
    return (string.match(regex) || []).length;
}


// Not needed for a patched esprima parser
function protectObjectSpread(src) {
    // Because this version of the esprima parser does not support the
    // spread operator on objects (due to a bug), we temporarily hide
    // the spread operator inside `{}` by the transformation:
    //
    // {a, ...b, c} --> {a, ⏓:b, c}
    //
    // Note that at this point in the program, all object literals
    // have been reduced to single-line expressions, which limits how
    // far we have to search, and quoted strings are already
    // protected.

    const close = {'(':')', '{':'}', '[':']'};
    return src.replace(/(\{.*)\.\.\./g, function (match, prefix) {
        // Verify that the match does not contain unmatched [], (), {}
        // between the curly brace and the ellipsis. If it does, then
        // the ellipsis is not intended for the object expansion and
        // is an array ellipis that should be unmodified.
        //
        // Search backwards through the prefix. If the stack is empty
        // and we hit {, then we're in an object. Any other case assume
        // is an array.
        for (let i = prefix.length - 1, stack = []; i >= 0; --i) {
            const c = prefix[i];
            if ((stack.length === 0) && (c === '{')) {
                // Was an object
                return prefix + "'⏓':";
            }

            switch (c) {
            case ')': case '}': case ']': stack.push(c); break;
                
            case '(': case '[': case '{':
                if (stack.pop() !== close[c]) {
                    // Unbalanced brackets. Was not an object
                    return match;
                }
            }
        }

        // Will reach here for illegal statements, e.g., "{}..."
        return match;
    });
}


// Not needed for the patched esprima parser
function unprotectObjectSpread(src) {
    return src.replace(/'⏓':/g, '...');
}


function trimEmptyLines(lineArray) {
    for (let i = 0; i < lineArray.length; ++i) {
        if (lineArray[i].search(/\S/) === -1) {
            lineArray[i] = '';
        }
    }
}

/*
  For each line beginning with spaces and '&':
  
  1. Add a ':' to the previous non-empty line (error if it ends in ':')
  2. Remove the '&'
  3. Increase indent of all lines in the current block, which includes & lines
     at the same level until some other line is reached

xxx
& yyy
    zzz

->

xxx:
   yyy
       zzz
 */
function processElision(lineArray) {
    // Inserted to indent one level
    const indentString = '    ';

    // Scan bottom up so that recursive nesting works.  Multiply
    // elided blocks will be processed multiple times, but this simplifies
    // the logic.
    for (let i = lineArray.length - 1; i > 0; --i) {
        const match = lineArray[i].match(/^([\t ]*)\&[ \t]*(.*)/);
        if (match) {
            if (match[2].startsWith('else')) {
                throw makeError('Cannot elide else blocks using &', i);
            }
                
            // Scan upwards for the previous non-empty line
            let prevNonEmptyLine = i - 1;
            while (prevNonEmptyLine > 0 && lineArray[prevNonEmptyLine] === '') {
                --prevNonEmptyLine;
            }
            
            if (prevNonEmptyLine === -1) {
                throw makeError('Elided block using & with no previous block', i);
            }

            if (lineArray[prevNonEmptyLine].endsWith(':')) {
                throw makeError('Elided block using & to a block that already ends in :', prevNonEmptyLine);
            }
            
            lineArray[prevNonEmptyLine] += ':';

            if (lineArray[prevNonEmptyLine].search(/\S/) !== match[1].length) {
                throw makeError('Elided block must be at same indentation as parent', i);
            }

            // Remove the & and any leading space, and indent the elided line
            lineArray[i] = indentString + match[1] + match[2];
            const currentIndentLength = match[1].length;

            // Scan forward for the next line that is indented more,
            // indenting as we go. There should be no elision encountered
            // as we are processing the outer loop upwards
            
            for (let j = i + 1; j < lineArray.length; ++j) {
                const indentLength = lineArray[j].search(/\S/);
                
                // Check the indent level of this nonempty line
                if (indentLength > -1) {
                    console.assert(indentLength >= 0, 'Nonempty lines must have an indent');
                    console.assert(lineArray[j][indentLength] !== '&', 'Previous elision not removed');

                    // Indent
                    if (indentLength > currentIndentLength) {
                        lineArray[j] = indentString + lineArray[j];
                    }
                }
            } // for j
            
        } // match elision
    } // for each line

}


/** Compiles pyxlscript -> JavaScript. Processes the body of a
    section. Use compile() to compile an entire project. There is no
    standalone mode compiler. */
function pyxlToJS(src, noYield, internalMode) {
    if (noYield === undefined) { noYield = false; }

    // Replace hard tabs
    src = src.replace(/\t/g, '    ');
    
    // Replace confusingly-similar double bars (we use exclusively Double Vertical Line 0x2016)
    src = src.replace(/∥𝄁║Ⅱǁ/g, '‖');

    // Switch to small element-of everywhere before blocks or strings can be processed
    src = src.replace(/∈/g, '∊');

    const pack = protectQuotedStrings(src);
    src = pack[0];
    const stringProtectionMap = pack[1];

    // Check for newlines in strings
    for (let i = 0; i < stringProtectionMap.length; ++i) {
        const value = stringProtectionMap[i];
        if (value.indexOf('\n') !== -1) {
            src = unprotectQuotedStrings(src, stringProtectionMap);
            const j = src.indexOf(value);
            console.assert(j !== -1);
            const line = src.substring(0, j).split('\n').length - 1;
            throw makeError('Illegal multiline quoted string (use \\n for a newline)', line); 
        }
    }

    // Remove multi-line comments, which cause problems with the indentation and end-of-line metrics
    src = src.replace(/\/\*([\s\S]*?)\*\//g, function(match, contents) {
        // Extract and return just the newlines to keep line numbers unmodified
        return contents.replace(/[^\n]/g, '');
    });

    // Remove single-line comments
    src = src.replace(/\/\/.*$/gm, '');

    // Right-trim all lines, which also collapses empty lines to the
    // empty string.
    src = src.replace(/ +$/gm, '');

    // Replace spread operator
    src = src.replace(/…/g, '...');

    // Pull 'because' on a new line up to the previous line
    src = src.replace(/\)[ ]*((?:\n[\t ]*)+)[ ]*because[ ]+("[^\n"]")/g, ') because $2$1');

    // Switch FOR loops (will be switched back later)
    src = src.replace(/<=/g, '≤');
    src = src.replace(/>=/g, '≥');
    src = src.replace(/\sin\s/g, ' ∊ ');

    // BECAUSE clauses
    {
        const lineArray = compactMultilineLiterals(src.split('\n'))
        const becauseRegExp = RegExp('(' + identifierPattern + '\\([^\\n]*\\))[ ]+because[ ]+("[^"]+")', 'g');
        for (let i = 0; i < lineArray.length; ++i) {
            let line = lineArray[i];

            // Process BECAUSE: `foo(...) because "string"` --> `(because("string"),foo(...))`
            //
            // There must be no space between the comma and the
            // identifier in order for the next regexp to fake a
            // negative lookbehind            
            if (/\)[ ]*because[ ]+"/.test(line)) {
                // We can't process this with a regular expression
                // because we have to parse recursive matching
                // parentheses to find the complete expression before
                // the `because`
                const becausePos = line.indexOf('because ');
                console.assert(becausePos !== -1)

                // Extract the reason
                let reasonBeginPos = becausePos + 'because '.length;
                while (line[reasonBeginPos] !== '"') { ++reasonBeginPos; }
                
                let reasonEndPos = reasonBeginPos + 1;
                while (line[reasonEndPos] !== '"') { ++reasonEndPos; }
                
                // Look backwards for the paren
                let callEndPos = becausePos - 1;
                while (line[callEndPos] !== ')') { --callEndPos; }

                // Look farther backwards for the matching paren
                let callBeginPos = findMatchingParen(line, callEndPos, -1);

                // Move backwards over the identifier
                --callBeginPos;
                while ((callBeginPos >= 0) && /[ΔA-Za-z_0-9αβγΔδζηθιλμρσϕφχψτωΩ]/.test(line[callBeginPos])) { --callBeginPos; }
                ++callBeginPos;

                lineArray[i] = line = line.substring(0, callBeginPos) + '(because(' + line.substring(reasonBeginPos, reasonEndPos + 1) + '),' +
                    line.substring(callBeginPos, callEndPos + 1) + ')' + line.substring(reasonEndPos + 1);
            }

            // Insert BECAUSE for state changes or ASSERTs that do not use them already
            line = lineArray[i] = line.replace(/(^|[^,])((?:set_mode|push_mode|pop_mode|launch_game|reset_game|quit_game)[ ]*\()/g, '$1because("");$2');

            // Look for mismatched if/then/else (conservative test, misses some)
            const ifCount = countRegexOccurences(line, /\bif\b/g);
            const thenCount = countRegexOccurences(line, /\bthen\b/g);
            const elseCount = countRegexOccurences(line, /\belse\b/g);
            if (thenCount > elseCount) {
                throw makeError('"then" without "else".', i);
            } else if (thenCount > ifCount) {
                throw makeError('"then" without "if".', i);
            }
        }
        
        src = lineArray.join('\n');
    }

    // Conditional operator. Replace "if TEST then CONSEQUENT else
    // ALTERNATE" --> "TEST ? CONSEQUENT : ALTERNATE" before "if"
    // statements are parsed.

    // An IF that is not at the start of a line or a block is replaced
    // with an open paren. There are no negative lookbehinds in
    // JavaScript, so we have to structure an explicit test for the
    // regexp.
    {
        // Avoid the protectQuotedStrings value range. Must match the constant below as well
        const STACKED_IF_SYMBOL = '\uF8FF';
        
        let found = true
        // Allow multiple IF...THEN on a single line by processing repeatedly
        while (found) {
            found = false;
            src = src.replace(
                    /^([ ]*\S[^\n]*?(?:[A-Za-z0-9_αβγΔδζηθιλμρσϕφχψτωΩ][ ]|[:\^=\-\+\*/><,\[{\(][ ]*))if\b/gm,
                function (match, prefix) {
                    if (/else[ ]*$/.test(prefix)) {
                        // This was an ELSE IF. Leave it alone
                        return match;
                    }

                    // If the prefix ends with a colon, then we need to distinguish
                    // the function IF from a stacked IF statement:
                    //
                    //   def foo(x): if x: bar()
                    //
                    //   x = {a: if b then 3 else 2}            
                    //
                    // Functional IF has more '{' than '}' in the prefix. When we encounter
                    // a non-functional IF, temporarily replace it so as to not trigger the
                    // same regex again
                    if (/:[ ]$/.test(prefix) && (prefix.split('{').length <= prefix.split('}').length)) {
                        return prefix + STACKED_IF_SYMBOL;
                    } else {
                        found = true;
                        // Functional IF, replace
                        return prefix + '(';
                    }
                });
        } // while

        // Restore the temporarily hidden stacked IFs
        src = src.replace(/\uF8FF/g, 'if');
    } // IF

    // THEN
    src = src.replace(/\bthen\b/g, ') ? (');
    
    // ELSE (which does not begin a block; note that chained
    // conditional operators require parentheses to make this parse
    // unambiguously)
    src = src.replace(/\belse[ ]+(?!:|if)/g, ') : ');
    
    // Handle scopes and block statement translations
    {
        const lineArray = src.split('\n');

        trimEmptyLines(lineArray);
        processElision(lineArray);        
        processBlock(lineArray, 0, noYield, internalMode, stringProtectionMap);
        src = lineArray.join('\n');
    }

    src = src.replace(/\breset\b/g, '{ throw new Error("RESET"); }');

    src = src.replace(/==(?!=)/g, ' === ');
    src = src.replace(/!=(?!=)/g, ' !== ');

    src = src.replace(/≟/g, ' === ');
    src = src.replace(/≠/g, ' !== ');
    src = src.replace(/¬/g, ' ! ');

    // Temporary rename to hide from absolute value
    src = src.replace(/\|\|/g, ' or ');
    src = src.replace(/&&/g, ' and ');

    // Floor and ceiling
    src = src.replace(/[⌉⌋]/g, ')');
    src = src.replace(/[⌈]/g, ' ceil(');
    src = src.replace(/[⌊]/g, ' floor(');

    // Process before blocks and implicit multiplication so that
    // they handle the parentheses correctly
    src = processBars(src, '|', 'abs');
    src = processBars(src, '‖', 'magnitude');

    // Convert hexadecimal and binary so that it is not interpreted as implicit multiplication of 0 * x
    src = src.replace(/([^A-Za-z0-9αβγδζηθιλμρσϕφχτψωΩ_]|^)0x([A-Fa-f0-9]+)/g,
                      function (match, pre, num) {
                          return pre + ' (' + parseInt(num, 16) + ') ';
                      });
    src = src.replace(/([^A-Za-z0-9αβγδζηθιλμρσϕφχτψωΩ_]|^)0b([01]+)/g,
                      function (match, pre, num) {
                          return pre + ' (' + parseInt(num, 2) + ') ';
                      });
     
    // #deg -> #°, so that it will not be detected as implicit multiplication
    // by a variable beginning with "deg"
    src = src.replace(/(\d[\.]?\d*|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅐⅛⅑⅒])([ ]*deg\b)/g, '$1°');

    // Process implicit multiplication twice, so that it can happen within exponents
    for (let i = 0; i < 2; ++i) {
        // Implicit multiplication. Must be before operations that may
        // put parentheses after numbers, making the product
        // unclear. Regexp is: a (number, parenthetical expression, or
        // bracketed expression), followed by a variable name.

        // Specials (allow parens on the 2nd expression)
        src = src.replace(/([επξ∞½⅓⅔¼¾⅕⅖⅗⅘⅙⅐⅛⅑⅒⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵝⁱʲˣʸᶻᵏᵘⁿ⁾])[ ]*([\$\(_A-Za-zαβγδζηιθλμρσϕχψωΔΩτεπξ∞])/g, '$1 * $2');

        // Parens (do *not* allow parens on the 2nd expression, as that could be a first class function call)
        src = src.replace(/(\))[ ]*([\$_A-Za-zαβγδζηιθλμρσϕχψωΔΩτεπξ∞])/g, '$1 * $2');

        // Number case (has to rule out a variable name that ends in a
        // number or has a number inside of it)
        src = src.replace(/([^\$A-Za-z0-9αβγδζηθιλμρσϕφχτψωΔΩ_]|^)([0-9\.]*?[0-9])(%|°)?[ ]*([\$\(A-Za-zαβγδζηιθλμρσϕχψωΔΩτεπξ∞_])/g, '$1$2$3 * $4');

        // Fix any instances of text operators that got accentially
        // turned into implicit multiplication. If there are other
        // text operators in the future, they can be added to this
        // pattern.  This also fixes the one case where the pyxl
        // compiler does not inject {} around a loop body: the
        // for-with statement, where it needs to output a single
        // expression to compile those as if they were FOR statements.
        src = src.replace(/\*[ ]*(default|xor|or|and|not|mod|bitxor|bitand|bitor|bitnot|bitnot|bitshr|bitshl|for|with)(\b|\d|$)/g, ' $1$2');

        // Replace exponents
        src = src.replace(/([⁺⁻⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵝⁱʲˣʸᶻᵏᵘⁿ⁽⁾][⁺⁻⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵝⁱʲˣʸᶻᵏᵘⁿ⁽⁾ ]*)/g, '^($1)');
        src = src.replace(/[⁺⁻⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵝⁱʲˣᵏʸᶻᵘⁿ⁽⁾]/g, function (match) { return superscriptToNormal[match]; });
        
        // Replace subscripts
        //src = src.replace(/([₊₋₀₁₂₃₄₅₆₇₈₉ₐᵦᵢⱼₓₖᵤₙ₍₎][₊₋₀₁₂₃₄₅₆₇₈₉ₐᵦᵢⱼₓₖᵤₙ₍₎ ]*)/g, '[($1)]');
        //src = src.replace(/[₊₋₀₁₂₃₄₅₆₇₈₉ₐᵦᵢⱼₓₖᵤₙ₍₎]/g, function (match) { return subscriptToNormal[match]; });
    }

    // Numbers ending in percent. This regex is dangerous because it
    // does not distinguish variables ending with a number from standalone
    // number tokens. Process AFTER implicit multiplication so that the inserted
    // parentheses do not disable multiplication
    src = src.replace(/(\d+(?:\.\d*)?|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅐⅛⅑⅒])%/g, '($1 * 0.01)');

    // Numbers ending in degrees. Does not distinguish variables ending
    // in a number from standalone number tokens. Process AFTER implicit multiplication so that the inserted
    // parentheses do not disable multiplication
    src = src.replace(/(\d+|\d\.\d*|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅐⅛⅑⅒])°/g, '($1 * .017453292519943295)');

    // Replace fractions after implicit multiplication, so that the parentheses do not 
    // confuse it. Do this AFTER degrees and percentages, so that we can have fractional ones
    src = src.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅐⅛⅑⅒]/g, function (match) { return fraction[match]; });
    
    // SIN, COS, TAN with a single argument and no parentheses. Must be processed after implicit
    // multiplication so that, e.g., 2 cos θ parses correctly with regard to the \\b
    src = src.replace(RegExp('\\b(cos|sin|tan)[ ]*([επΔξ]|[ ]+' + identifierPattern + ')', 'g'), '$1($2)');
    
    // Process after FOR-loops so that they are easier to parse
    src = src.replace(/≤/g, ' <= ');
    src = src.replace(/≥/g, ' >= ');
    
    // Expand shifts after blocks so that they aren't misparsed inside
    // FOR loops
    src = src.replace(/[◀◁](=?)/g, ' <<$1 ');
    src = src.replace(/[▶▷](=?)/g, ' >>$1 ');

    // Exponentiation
    src = src.replace(/\^/g, '**');

    src = src.replace(/(\b|\d)or(\b|\d)/g, '$1 || $2');
    src = src.replace(/∩(=?)/g, ' &$1 ');
    src = src.replace(/∪(=?)/g, ' |$1 ');

    // Optimize var**(int), which is much less efficient than var*var.
    // Note that we don't allow random (ξ) in here, as it is not constant!
    src = src.replace(RegExp('(.|..)[ ]*(' + identifierPattern + ')\\*\\*\\((-?\\d)\\)', 'g'), function (match, br, identifier, exponent) {

        if (br.match(/\+\+|--|\.|\*\*/)) {
            // Order of operations may be a problem; don't substitute
            return match;
        } else {
            exponent = parseInt(exponent);

            if (exponent === 0) {
                return br + ' identifier**(0)';
            } else if (exponent < 0) {
                return br + ' (1 / (' + identifier + (' * ' + identifier).repeat(-exponent - 1) + '))';
            } else {
                return br + ' (' + identifier + (' * ' + identifier).repeat(exponent - 1) + ')';
            }
        }
    });

    // Look for % and error out, since it is illegal. Do this before
    // we replace mod with %. Note that strings and comments are gone
    // at this point.
    {
        const i = src.indexOf('%');
        if (i !== -1) {
            const line = (src.substring(0, i).match(/\n/g) || []).length;
            throw makeError('Illegal standalone %. Maybe you want the "mod" operator?', line);
        }
    }
    
    
    src = src.replace(/∞|\binfinity\b/g,  ' (Infinity) ');
    src = src.replace(/\bnan\b/g,         ' (NaN) ');
    src = src.replace(/∅|\bnil\b/g,       ' (undefined) ');
    src = src.replace(/π|\bpi\b/g,        ' ($Math.PI) ');
    src = src.replace(/ε|\bepsilon\b/g,   ' (1e-6) ');
    src = src.replace(/ξ/g,               ' random() ');

    // Must come after exponentiation because it uses the same character
    src = src.replace(/⊕(=?)/g, ' ^$1 ');

    src = src.replace(/(\b|\d)and(\b|\d)/g, '$1 && $2');
    src = src.replace(/(\b|\d)mod(\b|\d)/g, '$1 % $2');
    src = src.replace(/(\b|\d)not(\b|\d)/g, '$1 ! $2');
    // Bitwise operations
    const bitopMap = {shl:'<<', shr:'>>', not:'~', and:'&', or:'|', xor:'^'};
    src = src.replace(/(\b|\d)bit(shl|shr|not|and|or|xor)(\b|\d)/g, function (match, a, op, b) {
        return a + bitopMap[op] + b;
    });

    // Debug statements
    src = src.replace(/\bassert\b/g, '$assertEnabled && assert');
    src = src.replace(/\btodo[ ]*\(/g, '$todoEnabled && $todo(');

    // DEFAULT operators. We replace these with (the unused in pyxlscript) '=='
    // operator, which has similar precedence, and then use vectorify
    // to rewrite them as a semantic emulation of nullish operators.
    // When the esprima library supports '??', we'll change the following
    // line to replace with that operator and then change vectorify to
    // have a flag for rewriting nullish, rather than this weird callback.
    //
    // Do this immediately before vectorify, which will restore these.
    src = src.replace(/\bdefault\b/g, '==');

    if (! PARSER_SUPPORTS_OBJECT_SPREAD) { 
        src = protectObjectSpread(src);
    }

    try {
        src = vectorify(src, {
            assignmentReturnsUndefined: true,
            scalarEscapes: true,
            equalsCallback: vectorify.nullishRewriter,
            operatorPrefix: '$',
            throwErrors: true
        });
    } catch (e) {
        // Many compile-time errors are caught here, including missing
        // comma in object literal.
        
        //console.log(unprotectQuotedStrings(src, stringProtectionMap));
        throw e;
    }

    if (! PARSER_SUPPORTS_OBJECT_SPREAD) {
        // Restore the spread operator for objects
        src = unprotectObjectSpread(src);
    }

    // Cleanup formatting
    src = src.replace(/,[ ]+/g, ', ');
    src = src.replace(/[ ]*,/g, ',');
    src = src.replace(/;[ ]*;/g, ';');
    src = src.replace(/(\S)[ ]{2,}/g, '$1 ');
    src = unprotectQuotedStrings(src, stringProtectionMap);

    // Print output code for debugging the compiler
    if (SHOW_COMPILED_CODE && ! internalMode) { console.log(src); }
    return src;
}


/**
Constructs JavaScript source code for the body
of a generator function 

gameSource.modes[i].url is a list of URLs of source code.
fileContents[url] maps URLs to their text source.
isOS = "this is the OS itself, do not create a pause menu".

This never reads from disk or the web itself.
*/
function compile(gameSource, fileContents, isOS) {
    const separator = '\n\n////////////////////////////////////////////////////////////////////////////////////\n\n';
    const sectionSeparator = '//--------------------------------------------------------------------------------';
    
    // Protect certain variables by shadowing them, since programs
    // that overwrite (or read!) them could cause problems.
    let compiledProgram = 'const $Object = {}.constructor; let navigator, parent, Object, Array, String, Number, location, document, window, print, Math, RegExp, Date, console, localStorage, performance; \n';
    if (gameSource.json.y_up) {
        compiledProgram += 'set_transform(xy(0, SCREEN_SIZE.y), xy(1, -1), 0, 1);\n;';
    }
    compiledProgram += separator;
    
    // Compile the global code
    if (gameSource.scripts) {
        for (let i = 0; i < gameSource.scripts.length; ++i) {
            const url = gameSource.scripts[i];
            const pyxlCode = fileContents[url];
            let jsCode;
            try {
                jsCode = pyxlToJS(pyxlCode, true, /console\/os\/[^/]+\.pyxl$/.test(url));
            } catch (e) {
                throw {url:url, lineNumber:e.lineNumber, message: e.message.replace('Unexpected token ===', 'Unexpected token ==')};
            }
            compiledProgram += '/*ට"' + url + '"*/\n' + jsCode + separator;
        }
    }
    
    const doubleLineChars = '=═⚌';
    const splitRegex = RegExp(String.raw`(?:^|\n)[ ]*(init|enter|frame|leave|pop_mode|[\$_A-Z]${identifierPattern})[ ]*(\([^\n\)]*\))?[ ]*(\bfrom[ ]+[\$_A-Za-z][\$A-Za-z_0-9]*)?\n((?:-|─|—|━|⎯|=|═|⚌){5,})[ ]*\n`);

    // Compile each mode
    for (let i = 0; i < gameSource.modes.length; ++i) {

        // Trust the mode to have the correct name in the gameSource
        // data structure.
        const mode = gameSource.modes[i];
        
        // If true, this is an internal mode that is allowed to access
        // "$" (and legacy "_") private variables.
        const internalMode = mode.name[0] === '_' || mode.name[0] === '$';

        // Eliminate \r on Windows
        const file = fileContents[mode.url] + '\n';
        const noSections = ! splitRegex.test(file);

        // Initalize the table. Note that the top-level mode code will be moved into
        // the "init" section, which cannot be explicitly declared. Each pop_mode is mangled
        // to include the "from" mode's name, and then added as encountered.
        const sectionTable = {init:null, enter:null, leave:null, frame:null};
        for (let name in sectionTable) {
            sectionTable[name] = {pyxlCode: '', args: '()', jsCode: '', offset: 0};
        }

        if (! noSections) {
            // Separate file into sections. Prefix a single newline so that there
            // is guaranteed to be a line before the first section.

            const sectionArray = ('\n' + file).split(splitRegex);

            // Disregard any blank space before the first section, but count the lines
            let line = countLines(sectionArray[0]) - 1;

            if (sectionArray.length % 5 === 0) { throw {url:mode.url, lineNumber:undefined, message: 'There must be at least one line between sections.'}; }

            // The separator names should be interleaved with the bodies. Extract
            // them and count lines.
            for (let s = 1; s < sectionArray.length; s += 5) {
                let name = sectionArray[s];
                const args = sectionArray[s + 1];
                const from = sectionArray[s + 2];
                const type = sectionArray[s + 3][0];
                const body = sectionArray[s + 4];
                // If this is the mode, replace the name with 'init' for the purpose of
                // defining variables.

                line += 1;
                if ((name !== 'enter') && (name !== 'pop_mode') && (args !== undefined)) { throw {url:mode.url, lineNumber:line, message:'Only the enter() and pop_mode() sections in a mode may take arguments'}; }

                if (name === 'pop_mode') {
                    // Generate the section
                    const otherMode = from.replace(/^from[ ]*/,'');
                    if ((otherMode[0] === '_' || otherMode[0] === '$') && ! (internalMode || isOS)) { throw {url:mode.url, lineNumber:line, message:'Illegal mode name in pop_mode() from section: "' + otherMode + '"'}; }
                    name = name + 'From' + otherMode;
                    sectionTable[name] = {pyxlCode: '', args: '()', jsCode: '', offset: 0};
                }
                
                const section = sectionTable[(doubleLineChars.indexOf(type) !== -1) ? 'init' : name];
                if (section === undefined) { throw {url:mode.url, lineNumber:line, message:'Illegal section name: "' + name + '"'}; }
                section.pyxlCode = body;
                section.offset = line;
                section.args = args || '()';
                line += countLines(body);
            }
            
        } else {
            sectionTable.frame.pyxlCode = file;
        }

        let wrappedPopModeFromCode = '', pop_modeBindings = '';
        
        for (let name in sectionTable) {
            const section = sectionTable[name];
            if (section.pyxlCode.trim() !== '') {
                try {
                    section.jsCode = pyxlToJS(section.pyxlCode, false, internalMode);
                } catch (e) {
                    throw {url:mode.url, lineNumber:e.lineNumber + section.offset, message:e.message};
                }
                section.jsCode = `/*ට"${mode.url}":${section.offset}*/\n` + section.jsCode;

                const match = name.match(/^pop_modeFrom(.*)$/);
                if (match) {
                    // There is intentionally a double $ in the code below,
                    // because the second $ is for escaping to the JavaScript
                    // formatted string.
                    pop_modeBindings += `, $${name}:$${name}`;
                    wrappedPopModeFromCode += `

// pop_mode from ${match[1]}
${sectionSeparator}
function $${name}${section.args} {
${section.jsCode}
}

`;
                }
            }
        }

        // set_mode abruptly leaves executing code by throwing an exception that contains
        // a field 'nextMode' equal to the next mode object.

        const wrappedJSCode =
`// ${mode.name}.pyxl
//========================================================================
const ${mode.name} = (function() {

// init
${sectionSeparator}
${sectionTable.init.jsCode}

// enter
${sectionSeparator}
function $enter${sectionTable.enter.args} {
${sectionTable.enter.jsCode}
}

// leave
${sectionSeparator}
function $leave() {
${sectionTable.leave.jsCode}
}
${wrappedPopModeFromCode}

// system menu
${sectionSeparator}
function $pop_modeFrom$SystemMenu(callback) {
   if (callback) { callback(); }
}

// frame
${sectionSeparator}
const $frame = (function quadplay_main_loop() {
try {
if (($gameMode.$name[0] !== '$') && (gamepad_array[0].$pp || gamepad_array[1].$pp || gamepad_array[2].$pp || gamepad_array[3].$pp)) { push_mode($SystemMenu); }
$processFrameHooks();
${sectionTable.frame.jsCode}
$show(); } catch (ex) { if (! ex.nextMode) throw ex; else { $resetTouchInput(); $updateInput(); }}
});

return $Object.freeze({$type:'mode', $enter:$enter, $frame:$frame, $pop_modeFrom$SystemMenu:$pop_modeFrom$SystemMenu ${pop_modeBindings}, $leave:$leave, $name:'${mode.name}'});
})();

`;
        compiledProgram += wrappedJSCode;            

    } // for each mode
    
    // Set the initial mode
    const start_mode = (gameSource.debug && gameSource.debug.json && gameSource.debug.json.start_mode_enabled && gameSource.debug.json.start_mode) || gameSource.json.start_mode
    // Expose to the runtime
    compiledProgram += 'push_guest_menu_mode.$OnlineMenu = $OnlineMenu; ';
    compiledProgram += `
function $start_program() {
    $play_reset_animation.active = false;
    mode_frames = game_frames = 0;
    try {
        set_mode(${start_mode});
    } catch (e) {
        if (! e.nextMode) { throw e; }
    }
}\n\n`;

    // Main loop
    compiledProgram += `// Main loop
return function () {
    if ($play_reset_animation.active) {
        $play_reset_animation();

        // Don't show on the last frame of the animation
        // because that would increment game_frames
        if ($play_reset_animation.active) {
           $show();
        }
    } else {
        $gameMode.$frame();
    }
};

`;

    compiledProgram = "'use strict';/*ට\"reset_animation\"*/ \n" + resetAnimationSource + separator + compiledProgram;

    // Process SOURCE_LOCATION and inject line numbers on Safari
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isSafari || compiledProgram.indexOf('SOURCE_LOCATION') !== -1) {
        const lines = compiledProgram.split('\n');
        // Put after "use strict"
        if (isSafari) { lines[0] += '$currentLineNumber=1;'; }

        let currentURL = '';
        let currentFilename = '';
        let currentLineNumber = 0;

        const baseURL = gameSource.jsonURL.replace(/\/[^\/]+$/, '/');

        // Other lines
        for (let i = 1; i < lines.length; ++i) {
            // Detect changes of file
            const directive = parseCompilerLineDirective(lines[i]);
            if (directive) {
                currentURL = directive.url;
                currentLineNumber = directive.lineNumber;
                if (currentURL.startsWith(baseURL)) {
                    currentFilename = currentURL.substring(baseURL.length);
                } else {
                    currentFilename = currentURL;
                }
            } else {
                ++currentLineNumber;
            }

            // Replace SOURCE_LOCATION if not inside a string
            if (lines[i].indexOf('SOURCE_LOCATION') !== -1) {
                const tmp = protectQuotedStrings(lines[i]);
                lines[i] = unprotectQuotedStrings(tmp[0].replace(/\bSOURCE_LOCATION\b/g, `($Object.freeze({url: "${currentURL}", filename: "${currentFilename}", line_number: ${currentLineNumber}}))`), tmp[1]);
            }

            // There are some weird cases where string split seems to
            // break in the middle of expressions, perhaps because of
            // unusual characters in the source file that turn into \n
            // under unicode rules. Detect these cases and don't
            // insert line numbers for them.
            if (isSafari &&
                ! /^\s*(else|\]|\)|\}|\/\/|$)/.test(lines[i]) &&
                ! /[\(,\[]$/.test(lines[i - 1])) {
                lines[i] = '$currentLineNumber=' + (i+1) + ';' + lines[i];
            }
        }
        compiledProgram = lines.join('\n');
    }

    //console.log(compiledProgram);
    return compiledProgram;
}



/** Returns {url:, lineNumber:} or undefined if this is not a line directive */
function parseCompilerLineDirective(line) {
    const urlCharIndex = line.indexOf('/*ට');
    if (urlCharIndex === -1) { return undefined; }
    
    let endCharIndex = line.indexOf('*/', urlCharIndex + 1);
    let url = line.substring(urlCharIndex + 4, endCharIndex);
    endCharIndex = url.lastIndexOf(':');
    const quoteIndex = url.lastIndexOf('"');
    let offset = 0;

    let lineNumber = 0;
    if ((endCharIndex !== -1) && (quoteIndex < endCharIndex)) {
        // of the form "url":line
        lineNumber = parseInt(url.substring(endCharIndex + 1));
        url = url.substring(0, endCharIndex);
    }
    if (url[url.length - 1] === '"') {
        url = url.substring(0, url.length - 1);
    }

    return {url: url, lineNumber: lineNumber};
}


function countLines(s) {
    return s.split('\n').length + 1;
}

const resetAnimationSource = `
///////////////////////////////////////////////////////////////////////////////////
// Warm the jit by hitting all of the key sprite cases and randomizing parameters so that
// the jit doesn't over specialize (needed on Safari to prevent compilation stutters)
reset_transform()
reset_camera()

for (let i = 0; i < 150; ++i) {
   // Alpha cases (the regular nontransformed alpha case is handled automatically by drawing the visible logo)
   draw_sprite({sprite: $quadplayLogoSprite[0][0], pos: xy(SCREEN_SIZE.x * 0.5 + random(), SCREEN_SIZE.y * 0.5 + random()),
       opacity: random(), z: random() - 100, angle: random(), scale: {x: random(), y: random()}, override_color: rgba(random(), random(), random(), random())});
   draw_sprite({sprite: $quadplayLogoSprite[0][0], pos: xy(SCREEN_SIZE.x * 0.5 + random(), SCREEN_SIZE.y * 0.5 + random()),
       opacity: random(), z: random() - 100});

   // No-alpha cases (the regular nontransformed alpha case is handled automatically by drawing the visible logo)
   draw_sprite({sprite: $opaqueSprite[0][0], pos: xy(SCREEN_SIZE.x * 0.5 + random(), SCREEN_SIZE.y * 0.5 + random()),
       opacity: random(), z: random() - 100, angle: random(), scale: {x: random(), y: random()}, override_color: rgba(random(), random(), random(), random())});
   draw_sprite({sprite: $opaqueSprite[0][0], pos: xy(SCREEN_SIZE.x * 0.5 + random(), SCREEN_SIZE.y * 0.5 + random()),
       opacity: random(), z: random() - 100});
   draw_sprite({sprite: $opaqueSprite[0][0], pos: xy(SCREEN_SIZE.x * 0.5 + random(), SCREEN_SIZE.y * 0.5 + random()), z: random() - 100});
}

// Hide the warmup sprites
draw_corner_rect({x: 0, y: 0}, SCREEN_SIZE, rgb(0,0,0), undefined, -1);

///////////////////////////////////////////////////////////////////////////////////
// Reset animation
function $play_reset_animation() {
   if ($numBootAnimationFrames <= 0) {       
       $start_program();
       return; 
   }

   // Fade in at the start
   const fadeLen = 13;

   // Hold black at the end
   const holdLen = $numBootAnimationFrames > 100 ? 47 : 8;

   // Middle section of dots animation
   const midLen = $numBootAnimationFrames - fadeLen - holdLen;

   let frame = mode_frames;

   // flash at start
   if (frame < fadeLen) {
      set_background(gray(max(0, 0.75 - frame / (fadeLen - 1))));
      return;
   }
   frame -= fadeLen;

   if (frame < midLen) {
      const k = frame;
      const fade = min(96, midLen / 2);
      set_background(gray(0));
      const gradient = [rgb(1, 0.7333333333333333, 0.8666666666666667), rgb(1, 0.6666666666666666, 0.8), rgb(1, 0.26666666666666666, 0.5333333333333333), rgb(1, 0.26666666666666666, 0.5333333333333333), rgb(1, 0.26666666666666666, 0.5333333333333333), rgb(0.9333333333333333, 0.3333333333333333, 0.6), rgb(0.8666666666666667, 0.3333333333333333, 0.6), rgb(0.8, 0.4, 0.6666666666666666), rgb(0.6666666666666666, 0.4666666666666667, 0.7333333333333333), rgb(0.6, 0.4666666666666667, 0.7333333333333333), rgb(0.4666666666666667, 0.5333333333333333, 0.7333333333333333), rgb(0.4, 0.6, 0.8), rgb(0.3333333333333333, 0.6, 0.8), rgb(0.26666666666666666, 0.6666666666666666, 0.8666666666666667), rgb(0.6, 0.7333333333333333, 0.8666666666666667), rgb(0.8, 0.8666666666666667, 0.9333333333333333)];
      const N = size(gradient);

      // fade
      let v = 0;
      if (k < fade) { 
         v = k / fade;
      } else if (k < midLen - fade) {
         v = 1;
      } else {
         v = (midLen - k) / fade;
      }

      const vDot = $Math.max(0, v - 0.2) / (1.0 - 0.2);

      // dots
      const w = $SCREEN_WIDTH >> 1, h = $SCREEN_HEIGHT >> 1;
      const tmp = {r: 0, g: 0, b: 0};
      for (let i = 0; i < 16000; ++i) {
         const x = random(), y = random();
         const c = gradient[$Math.min((y * (N - 1) + 3 * random()) >> 0, N - 1)];
         RGB_MUL(c, vDot, tmp);
         draw_point(xy($Math.floor(w * x) * 2, $Math.floor(h * y) * 2), tmp);
      }

      draw_sprite({sprite: $quadplayLogoSprite[0][0], pos: xy(SCREEN_SIZE.x * 0.5 + 0.5, SCREEN_SIZE.y * 0.5 + 0.5), opacity: $Math.min(1, 2 * v)})
      return;
   }
   frame -= midLen;

   // Hold black frames before going into the game
   if (frame < holdLen) {
      return;
   }
   frame -= holdLen;

   // Done! 
   $start_program();
}
$play_reset_animation.active = true;
`;


const fraction = Object.freeze({
    '½':'(1/2)',
    '⅓':'(1/3)',
    '⅔':'(2/3)',
    '¼':'(1/4)',
    '¾':'(3/4)',
    '⅕':'(1/5)',
    '⅖':'(2/5)',
    '⅗':'(3/5)',
    '⅘':'(4/5)',
    '⅙':'(1/6)',
    '⅐':'(1/7)',
    '⅛':'(1/8)',
    '⅑':'(1/9)',
    '⅒':'(1/10)'
});


const subscriptToNormal = Object.freeze({
    '₊':'+',
    '₋':'-',
    '₀':'0',
    '₁':'1',
    '₂':'2',
    '₃':'3',
    '₄':'4',
    '₅':'5',
    '₆':'6',
    '₇':'7',
    '₈':'8',
    '₉':'9',
    'ₐ':' a ',
    'ᵦ':' β ',
    'ᵢ':' i ',
    'ⱼ':' j ',
    'ₓ':' x ',
    'ᵤ':' u ',
    'ₖ':' k ',
    'ₙ':' n ',
    '₍':'(',
    '₎':')'    
});

const superscriptToNormal = Object.freeze({
    '⁺':'+',
    '⁻':'-',
    '⁰':'0',
    '¹':'1',
    '²':'2',
    '³':'3',
    '⁴':'4',
    '⁵':'5',
    '⁶':'6',
    '⁷':'7',
    '⁸':'8',
    '⁹':'9',
    'ᵃ':' a ',
    'ᵝ':' β ',
    'ⁱ':' i ',
    'ʲ':' j ',
    'ˣ':' x ',
    'ʸ':' y ',
    'ᶻ':' z ',
    'ᵘ':' u ',
    'ᵏ':' k ',
    'ⁿ':' n ',
    '⁽':'(',
    '⁾':')'});
    
