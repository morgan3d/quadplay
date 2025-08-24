"use strict";

function pyxlScriptToMarkdeepDoc(scriptName, pyxlCode, url) {
    let mdSource = `# ${scriptName}\n\n`;

    // Extract doc comment for the entire file
    let needAPIHeader = false;
    {
        const match = pyxlCode.match(/^\/\*((?:\*(?!\/)|[^*])+)\*\/\S*(?!\ndef|\nlet|\nconst)/);
        if (match) {
            mdSource += match[1] + '\n';

            // Remove the overview comment, which might confusingly define functions in examples
            pyxlCode = pyxlCode.replace(/^\/\*((?:\*(?!\/)|[^*])+)\*\//, '');

            // Need a header to separate the API from the overview doc
            // mdSource += `## ${scriptName} API\n`;
        }
    }

    // Remove Windows newlines
    pyxlCode = pyxlCode.replaceAll('\r', '');

    // Maps names to entries
    const publicFunctionTable = {};
    const privateFunctionTable = {};
    const publicVariableTable = {};
    const privateVariableTable = {};
    let hasPrivateFunctions = false;
    let hasPrivateVariables = false;
    
    // Find function definitions, with optional preceding documentation
    // in a block comment.
    pyxlCode.matchAll(/(?:\/\*((?:\*(?!\/)|[^*])+)\*\/[ \t\n]{0,3})?(?:^|\n)(?![\t ])def[ \t]+([^(]+\([^:&]+)(?:\n&[^:]+)?\:/g).forEach(function (match) {
        // Function prototype. Reduce to one line
        const proto = match[2].replaceAll('\n', '').replace(/  +/g, ' ').replace(/\( /g, '(').trim();

        const api = proto.replace(/\(.*$/, '');

        documentationProgramAPIOverloads[api] =
                (documentationProgramAPIOverloads[api] || 0) + 1;

        //console.log('Found', api);
        let doc = (match[1] || '').trim();

        if (doc !== '') {
            // Indent documentation
            doc = doc.replaceAll(/\n/g, '\n  ');
        } else {
            doc = '&nbsp;';
        }

        const entry = '`' + proto + '`\n: ' + doc + '\n\n';
        const isPrivate = proto[0] === '_';
        hasPrivateFunctions = hasPrivateFunctions || isPrivate;
        (isPrivate ? privateFunctionTable : publicFunctionTable)[proto] = entry;
    });
    
    // Find variable definitions, with optional preceding documentation
    // in a block comment.
    pyxlCode.matchAll(/(?:\/\*((?:\*(?!\/)|[^*])+)\*\/[ \t\n]{0,3})?(?:^|\n)(?![\t ])(const|let)[ \t]+([^ \t\n=.,/\\+*\-]+)/g).forEach(function (match) {
        const declType = match[2]; // 'const' or 'let'
        const variableName = match[3];
        let doc = (match[1] || '').trim();

        if (doc !== '') {
            // Indent documentation
            doc = doc.replaceAll(/\n/g, '\n  ');
        } else {
            doc = '&nbsp;';
        }

        // Only show 'const' in output, not 'let'
        const displayName = declType === 'const' ? 'const ' + variableName : variableName;
        const entry = '`' + displayName + '`\n: ' + doc + '\n\n';
        const isPrivate = variableName[0] === '_';
        hasPrivateVariables = hasPrivateVariables || isPrivate;
        (isPrivate ? privateVariableTable : publicVariableTable)[variableName] = entry;
    });
    
    // Helper function for sorting that ignores the `const` prefix. `let` variables
    // don't carry a prefix.
    function sortVarNames(a, b) {
        // Remove 'const' prefix if present for comparison
        const aName = a.replace(/^const /, '');
        const bName = b.replace(/^const /, '');
        return aName.localeCompare(bName);
    }
    
    // Generate documentation in sorted order
    // Public variables first, then public functions
    for (const variableName of Object.keys(publicVariableTable).sort(sortVarNames)) {
        mdSource += publicVariableTable[variableName];
    }
    for (const functionName of Object.keys(publicFunctionTable).sort()) {
        mdSource += publicFunctionTable[functionName];
    }
    
    if (hasPrivateFunctions || hasPrivateVariables) {
        mdSource += `## ${scriptName} Internal\n\n`;
        // Private variables first, then private functions
        for (const variableName of Object.keys(privateVariableTable).sort(sortVarNames)) {
            mdSource += privateVariableTable[variableName];
        }
        for (const functionName of Object.keys(privateFunctionTable).sort()) {
            mdSource += privateFunctionTable[functionName];
        }
    }   
    return mdSource;
}