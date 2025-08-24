/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */
/* Edit time documentation system */
"use strict";


/* Maps API names to number of overloads */
const documentationBuiltInAPIOverloads = {};

/* Maps API names to number of overloads */
let documentationProgramAPIOverloads = {};


function updateProgramDocumentation() {
    if (! gameSource.scripts) {
        return;
    }
    
    // Markdeep source for the help pane
    let mdSource = `<meta charset="utf-8">\n      **${gameSource.json.title} Globals Documentation**\n     ${gameSource.json.developer}\n\n`;

    mdSource += '# Constants\n\n';

    if (gameSource.json && gameSource.json.constants) {
        for (const [name, entry] of Object.entries(gameSource.json.constants)) {
            mdSource += `\`${name}\`\n:  ${entry.description || entry.type || ''}\n\n`;
        }
    }

    documentationProgramAPIOverloads = {};
    
    for (let i = 0; i < gameSource.scripts.length; ++i) {
        const url = gameSource.scripts[i];
        const scriptName = url.replace(/^.*\//, '').replace('.pyxl', '');
        
        // Hide system scripts
        if (scriptName[0] !== '$' && scriptName[0] !== '_') {
            mdSource += pyxlScriptToMarkdeepDoc(scriptName, fileContents[url], url);
        }
    }

    const docPath = makeURLAbsolute('', 'quad://doc/');
    // Escape quotes to avoid ending the srcdoc prematurely
    mdSource += `
<script>markdeepOptions = {tocStyle:'short', definitionStyle:'long', inlineCodeLang: 'PyxlScript'};</script>
<link rel="stylesheet" href="${docPath}slate.css">
<link rel="stylesheet" href="${docPath}manual.css">
<style>
body {left: 8px}
.md div.title {font-size: 24px}
.md h1:before, .md h2:before, .md h3:before {content: none}
.md h1 {font-size: 28px; font-weight: 800}
.md h2 {font-size: 22px; font-weight: normal; font-color: #DDD}
.md h3 {font-size: 20px; font-weight: normal; font-color: #DDD}
</style>
<!-- Markdeep: --><script src="${docPath}markdeep.min.js" charset="utf-8"></script>`;

    const iframe = document.getElementById('programAPI');

    // Don't trigger update if it isn't changing!
    if (mdSource !== iframe.srcdoc) {
        const oldPos = iframe.contentWindow.scrollY;
        iframe.srcdoc = mdSource;
        setTimeout(function () {
            iframe.contentWindow.scrollTo(0, oldPos);
        }, 250);
    }
}


////////////////////////////////////////////////////////////////////////

// Install doc tooltips handler when quadplay is in edit mode. This has to run
// after the IDE is loaded, so schedule it to run after the initial load.
if (useIDE) {
    setTimeout(
    function () {
    const aceEditor = ace.edit('ace');

    // Initialize the documentation viewer
    {
        const quadplayAPIURL = location.origin + getQuadPath() + 'doc/api.md.html';

        // Load the source code for the manual. We'll end up fetching
        // it *twice*, once as raw code for processing here, and then
        // as a separate iframe load below. The browser should cache
        // the html, however.
        LoadManager.fetchOne({}, quadplayAPIURL, 'text', null, function (text) {
            console.log("Parsing quadplay API for help system");
            // Look for function call definitions in the manual
            
            // Replace windows newlines
            text = text.replaceAll('\r', '');

            const matchIterator = text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)\(.*\)`[ \t]*\n:/g);
            for (let match of matchIterator) {
                const api = match[1];
                
                documentationBuiltInAPIOverloads[api] =
                    (documentationBuiltInAPIOverloads[api] || 0) + 1;
            }
        }, function(error) {
            console.warn("Failed to load quadplay API for help system:", error);
        });

        // Load the manual into the iframe. This triggers markdeep
        // processing, so run it later to speed up initial load.
        const MS_PER_SECOND = 1000;
        setTimeout(function () {
            const iframe = document.getElementById('manual');
            iframe.src = quadplayAPIURL;
        }, 2 * MS_PER_SECOND);
    }

    aceEditor.on("mousedown", function (event) {        
        const pos = event.getDocumentPosition();
        const tokenArray = event.editor.session.getTokens(pos.row);
        const token = event.editor.session.getTokenAt(pos.row, pos.column);
        
        // Identify function calls
        if (token &&
            (token.index < tokenArray.length - 1) &&
            (token.type !== 'functiondecl') &&
            (tokenArray[token.index + 1].type === 'paren.lparen')) {

            maybeShowDocumentationForToken(token);
        }});
    });
}


/* Called when the contents change  */
function maybeShowDocumentationForSession(session) {
    const position = aceEditor.getCursorPosition();

    const token = session.getTokenAt(position.row, position.column + 1);
    
    if (! token || token.type !== 'paren.lparen') {
        return;
    }

    const functionToken = session.getTokens(position.row)[token.index - 1];
    if (functionToken && (functionToken.type !== 'functiondecl')) {
        maybeShowDocumentationForToken(functionToken);
    }
}


/* Called from the mouseover handler and
   the keyboard change handler. */
function maybeShowDocumentationForToken(token) {
    if (token.type === 'identifier' ||
        token.type === 'support.function' ||
        token.type === 'keyword') {
        showDocumentation(token.value, 'function');
    }
}


/* Suppress documentation for these common function names. */
const noDocumentationTable = {
    xy: true,
    xyz: true,
    xz: true,
    rgb: true,
    rgba: true,
    hsv: true,
    hsva: true
};


/* Called from maybeShowDocumentationForToken */
function showDocumentation(api, type) {
    // Suppress trivial APIs
    if (noDocumentationTable[api]) { return; }
    
    const sources = [
        {index: documentationProgramAPIOverloads, iframeName: 'programAPI', callback: onShowProgramAPI},
        {index: documentationBuiltInAPIOverloads, iframeName: 'manual',     callback: onShowManual},
    ];

    for (let source of sources) {
        const numOverloads = source.index[api];
        if (numOverloads) {
            const iframe = document.getElementById(source.iframeName);
            
            // Safety check: ensure iframe exists and is loaded
            if (!iframe || !iframe.contentWindow || !iframe.contentWindow.location) {
                console.warn(`Iframe ${source.iframeName} not ready for API ${api}`);
                continue;
            }
            
            const hash = `apiDefinition-${api}-fcn`;
            if (iframe.contentWindow.location.hash !== hash) {
                // Found a match, go to it within the iframe and show that tab in the debugger
                iframe.contentWindow.location.hash = `apiDefinition-${api}-fcn`;
                document.getElementById('helpTab').checked = true;
                source.callback();
            }
        }
    }
}


function onShowManual() {
    document.getElementById('helpViewManual').checked = true;

    document.getElementById('manual').style.visibility = 'visible';
    document.getElementById('programAPI').style.visibility = 'hidden';
}


function onShowProgramAPI() {
    document.getElementById('helpViewProgramAPI').checked = true;
    
    document.getElementById('manual').style.visibility = 'hidden';
    document.getElementById('programAPI').style.visibility = 'visible';
}
