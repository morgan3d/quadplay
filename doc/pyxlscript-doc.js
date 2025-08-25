"use strict";

function pyxlScriptToMarkdeepDoc(scriptName, pyxlCode, url, documentationProgramAPIOverloads = {}) {
    console.assert(typeof pyxlCode === 'string', typeof pyxlCode);

    let mdSource = `# ${scriptName}\n\n`;
    let license = null;
    let summary = null;

    {
        const match = pyxlCode.match(/^\/\*((?:\*(?!\/)|[^*])+)\*\/\S*(?!\ndef|\nlet|\nconst)/);
        if (match) {
            const overview = match[1];

            // Process metadata:
            license = overview.match(/^\s*@license\s+(.*)$/m);
            summary = overview.match(/^\s*@summary\s+(.*)$/m);
    
            if (summary) {
                summary = summary[1];
                mdSource += `*${summary}*\n\n`;
            }
            if (license) {
                license = license[1];
                mdSource += `<small>\`${url}\`<br>${license.replace(/copyright/gi, '©')}</small>\n\n`;
            }
            if (summary || license) {
                mdSource += '\n------------------------------\n';
            }

            // Remove metadata from the overview
            mdSource += overview.replace(/^@.*$/gm, '') + '\n';

            // Remove the overview comment, which might confusingly define functions in examples
            pyxlCode = pyxlCode.replace(/^\/\*((?:\*(?!\/)|[^*])+)\*\//, '');
        }
    }

    // Remove Windows newlines
    pyxlCode = pyxlCode.replaceAll('\r', '');

    // Maps names to entries
    const publicFunctionTable = {};
    const privateFunctionTable = {};
    const publicVariableTable = {};
    const privateVariableTable = {};
    
    // Find function definitions, with optional preceding documentation
    // in a block comment.
    pyxlCode.matchAll(/(?:\/\*((?:\*(?!\/)|[^*])+)\*\/[ \t\n]{0,3})?(?:^|\n)(?![\t ])def[ \t]+([^(]+\([^:&]+)(?:\n&[^:]+)?\:/g).forEach(function (match) {
        // Function prototype. Reduce to one line
        const proto = match[2].replaceAll('\n', '').replace(/  +/g, ' ').replace(/\( /g, '(').trim();

        const api = proto.replace(/\(.*$/, '');

        documentationProgramAPIOverloads[api] = (documentationProgramAPIOverloads[api] || 0) + 1;

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
    if (Object.keys(publicVariableTable).length > 0) {
        mdSource += `## Variables\n\n`;
    
        for (const variableName of Object.keys(publicVariableTable).sort(sortVarNames)) {
            mdSource += publicVariableTable[variableName];
        }
    }

    if (Object.keys(publicFunctionTable).length > 0) {
        mdSource += `## Functions\n\n`;
        for (const functionName of Object.keys(publicFunctionTable).sort()) {
            mdSource += publicFunctionTable[functionName];
        }
    }
    
    if (Object.keys(privateVariableTable).length || Object.keys(privateFunctionTable).length) {
        mdSource += `## Internal\n\n`;
        // Private variables first, then private functions
        for (const variableName of Object.keys(privateVariableTable).sort(sortVarNames)) {
            mdSource += privateVariableTable[variableName];
        }

        for (const functionName of Object.keys(privateFunctionTable).sort()) {
            mdSource += privateFunctionTable[functionName];
        }
    }   

    return {markdown: mdSource, license: license, summary: summary};
}