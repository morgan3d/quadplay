/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License*/
"use strict";

// For debugging
// git log --graph --oneline --decorate --all

function addToVCSLog(html) {
    const terminal = document.getElementById('versionControlTerminal');
    terminal.innerHTML += html;
    terminal.scrollTop = terminal.scrollHeight;  
}

/* Runs a git command that is in the string 'cmd' in the current game's directory
   and runs the success function if it succeeds.
   
   Assumes hasGit and editableProject are true. */
function serverGitCommand(cmd, successFunction) {
    addToVCSLog(`<span class="terminalCommand">&gt; git ${cmd}</span>\n\n`);
    
    LoadManager.fetchOne({}, gameURL.replace(/\/[^/]+\.game\.json$/, '/_git?' + encodeURI(cmd)), 'text', null, function (text) {
        // Parse the result
        const i = text.indexOf('\n');
        const code = parseInt(text.substring(0, i));
        text = text.substring(i + 1);

        // Remove this confusing string from the output
        const remove_string = 'nothing to commit (use -u to show untracked files)';
        text = text.replace(remove_string, '');
        
        addToVCSLog(text + '\n');
            
        // Run the callback
        successFunction(text, code);
    });
}


/* Callback for all branches of merge */
function gitDoMergeAndCommit(mergeOptions, commitFileList) {
    // No conflict, ok to proceed
    serverGitCommand('merge ' + mergeOptions, function (text, code) {
        console.log('Reloading after git merge.');
        loadGameIntoIDE(window.gameURL, null, true);

        const dialog = document.getElementById('versionControlCommitMessage');
        dialog.classList.remove('hidden');
        dialog.commitFileList = commitFileList;
        addToVCSLog(`<span class="terminalComment"># Ready to commit ${commitFileList}</span>\n`);
        const textbox = document.getElementById('versionControlCommitMessageText');
        textbox.focus();
        textbox.value = '';
        // Wait for dialog callback
    }); // merge
}


function onGitSync() {
    const terminal = document.getElementById('versionControlTerminal');
    terminal.innerHTML = '';
    
    document.getElementById('versionControlDialog').classList.remove('hidden');
    const closeButton = document.getElementById('gitCloseButton');
    closeButton.disabled = true;
    
    let commitFileList = '';
    serverGitCommand('status --porcelain .', function (text, code) {
        text = text.trim();
        const fileArray = text.length === 0 ? [] : text.split('\n');

        const commonBase = gameURL.replace(location.href.replace(/console\/quadplay\.html.*/, ''), '').replace(/\/[^/]+\.game.json$/, '/');

        let addFileList = '';

        for (const line of fileArray) {
            const args = line.trim().split(' ');
            let filename = args[1];
            
            // Make filename relative to the game directory
            // as we might be working with a game that is rooted
            // somewhere within a git hierarchy.
            if (filename.startsWith(commonBase)) {
                filename = filename.substring(commonBase.length);
            }
            
            // Modified, new, renamed, or copied AND in the project
            // or Deleted AND NOT in the project
            if ((['M', '?', 'R', 'C'].indexOf(args[0][0]) !== -1 && gameSource.localFileTable[filename]) ||
                (args[0][0] === 'D' && ! gameSource.localFileTable[filename])) {
                commitFileList += ' ' + filename;
                
                if (args[0][0] === '?') {
                    addFileList += ' ' + filename;
                }
            } else {
                //console.log('ignoring', filename);
                //console.log(args[0], ['M', '?', 'R', 'C'].indexOf(args[0][0]), gameSource.localFileTable[filename]);
            }
        }

        // Remove the leading space
        commitFileList = commitFileList.trimStart();
        addFileList = addFileList.trimStart();

        const needTestMerge = commitFileList !== '' || addFileList !== '';

        // Get changes from server
        serverGitCommand('fetch', function (text, code) {
            function doTestMerge() {                
                if (! needTestMerge) {
                    // Directly merge. Since no files changed locally there is no chance of conflict.
                    serverGitCommand('merge', function (text, code) {
                        console.log('Reloading after git merge.');
                        loadGameIntoIDE(window.gameURL, null, true);

                        closeButton.disabled = false;
                        closeButton.focus();
                        // Done!
                    });
                    
                } else {
                    // Files changed locally. Test the merge, backing it out immediately no matter what
                    addToVCSLog('<span class="terminalComment"># Check for merge conflict</span>\n');
                    serverGitCommand('merge --no-commit --no-ff', function (mergeText, code) {   
                        // Do not reload; the files are potentially broken by a failed merge

                        // Parse text to understand if there is a merge conflict
                        const mergeConflict = mergeText.indexOf('Merge conflict') !== -1;

                        if (mergeConflict) {
                            // Put everything back. Reset hard so that we restore the local files to the state
                            // they had before the merge.
                            serverGitCommand('merge --abort', function (text, code) {
                                // Do not force a reload; the files are the same as they were pre-merge

                                // Ask the user how they want to resolve the conflict
                                const dialog = document.getElementById('versionControlMergeConflictDialog');
                                dialog.classList.remove('hidden');
                                dialog.commitFileList = commitFileList;
                                // Callbacks for the dialog are now active
                            });
                            
                        } else {
                            gitDoMergeAndCommit('--no-commit', commitFileList);                                
                        } // if mergeConflict
                            
                    }); // merge
                } // if files to commit
            } // function doMerge

            if (needTestMerge) {
                // Code that runs after adding, if needed
                function theRest() {
                    // Checkpoint the pre-merge state and then merge
                    serverGitCommand(`commit --untracked-files=no --quiet -m "Automated pre-merge commit" ${commitFileList}`, function (text, code) {
                        doTestMerge();
                    }); // commit
                }

                if (addFileList !== '') {
                    serverGitCommand(`add ${commitFileList}`, theRest)
                } else {
                    theRest();
                }
                
            } else {
                // Merge directly
                doTestMerge();
            }
        }); // git fetch
        
        
    }); // git status
}


function onGitResolveConflictUndo() {
    // The merge was already undone by the time we hit this callback, so just close the dialogs
    const dialog = document.getElementById('versionControlMergeConflictDialog');
    dialog.classList.add('hidden');
    const closeButton = document.getElementById('gitCloseButton');
    closeButton.disabled = false;
    closeButton.focus();
}


function onGitResolveConflictMine() {
    const dialog = document.getElementById('versionControlMergeConflictDialog');
    dialog.classList.add('hidden');
    addToVCSLog('<span class="terminalComment"># Resolve conflicts with my local files</span>\n');
    gitDoMergeAndCommit('--no-commit -s ort -X ours', dialog.commitFileList);
}


function onGitResolveConflictTheirs() {
    const dialog = document.getElementById('versionControlMergeConflictDialog');
    dialog.classList.add('hidden');
    addToVCSLog('<span class="terminalComment"># Resolve conflicts with the remote files</span>\n');
    gitDoMergeAndCommit('--no-commit -s ort -X theirs', dialog.commitFileList);
}


function onGitNoSendButton() {
    onGitSendButton(true);
}

function onGitSendButton(noSend) {
    const dialog = document.getElementById('versionControlCommitMessage');
    const commitFileList = dialog.commitFileList;

    // Hide the message list
    dialog.classList.add('hidden');
    let message = document.getElementById('versionControlCommitMessageText').value;

    // Make the message command-line safe
    message = message.replaceAll(/"\0\n/g, '');
    if (message === '') { message = 'Changed ' + commitFileList; }


    serverGitCommand(`commit --untracked-files=no -m "${message}" ${commitFileList}`, function (text, code) {
        if (noSend) {
            // Done 
            const closeButton = document.getElementById('gitCloseButton');
            closeButton.disabled = false;
            closeButton.focus();
        } else {
            addToVCSLog(`<span class="terminalComment"># Pushing changes to ${commitFileList}</span>\n`);
            serverGitCommand('push', function (text, code) {
                if ((text.indexOf('[rejected]') !== -1) || (code === 1)) {
                    // Try again
                    alert('Your collaborators pushed changes to the remote server while you were syncing files. The sync process needs to be performed again.');
                    setTimeout(onGitSync);
                } else {
                    // Done!
                    const closeButton = document.getElementById('gitCloseButton');
                    closeButton.disabled = false;
                    closeButton.focus();
                }
            }); // push
        }
    }); // commit    
}
