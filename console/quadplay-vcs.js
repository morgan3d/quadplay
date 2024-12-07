/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License*/
"use strict";

// For debugging
// git log --graph --oneline --decorate --all

/* Runs a git command that is in the string 'cmd' in the current game's directory
   and runs the success function if it succeeds.
   
   Assumes hasGit and editableProject are true. */
function serverGitCommand(cmd, successFunction) {
    const terminal = document.getElementById('versionControlTerminal');
    terminal.innerHTML += `<b>&gt; git ${cmd}</b>\n\n`;
    terminal.scrollTop = terminal.scrollHeight;  
    
    LoadManager.fetchOne({}, gameURL.replace(/\/[^/]+\.game\.json$/, '/_git?' + encodeURI(cmd)), 'text', null, function (text) {
        // Parse the result
        const i = text.indexOf('\n');
        const code = parseInt(text.substring(0, i));
        text = text.substring(i + 1);

        terminal.innerHTML += text + '\n';
        terminal.scrollTop = terminal.scrollHeight;  
            
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
        document.getElementById('versionControlCommitMessageText').value = '';
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
        const fileArray = text.trim().split('\n');
        for (const line of fileArray) {
            const args = line.trim().split(' ');
            const filename = args[1];
            // Modified, new, renamed, or copied AND in the project
            // or Deleted AND NOT in the project
            if ((['M', '?', 'R', 'C'].indexOf(args[0]) !== -1 && gameSource.localFileTable[filename]) ||
                (args[0] === 'D' && ! gameSource.localFileTable[filename])) {
                commitFileList += ' ' + filename;
            }
        }

        // Remove the leading space
        commitFileList = commitFileList.trimStart();

            // Get changes from server
        serverGitCommand('fetch', function (text, code) {
            function doTestMerge() {                
                if (commitFileList === '') {
                    // Directly merge. Since no files changed locally there is no chance of conflict.
                    serverGitCommand('merge', function (text, code) {
                        console.log('Reloading after git merge.');
                        loadGameIntoIDE(window.gameURL, null, true);

                        closeButton.disabled = false;
                        // Done!
                    });
                    
                } else {
                    // Files changed locally. Test the merge, backing it out immediately no matter what
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

            if (commitFileList !== '') {
                // Checkpoint the pre-merge state and then merge
                serverGitCommand(`commit --untracked-files=no --quiet -m "Automated pre-merge commit" ${commitFileList}`, function (text, code) {
                    doTestMerge();
                }); // commit
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
    document.getElementById('gitCloseButton').disabled = false;
}


function onGitResolveConflictMine() {
    const dialog = document.getElementById('versionControlMergeConflictDialog');
    dialog.classList.add('hidden');
    gitDoMergeAndCommit('--no-commit -s ort -X ours', dialog.commitFileList);
}


function onGitResolveConflictTheirs() {
    const dialog = document.getElementById('versionControlMergeConflictDialog');
    dialog.classList.add('hidden');
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


    serverGitCommand(`commit -m "${message}" ${commitFileList}`, function (text, code) {
        if (noSend) {
            // Done 
            document.getElementById('gitCloseButton').disabled = false;
        } else {
            serverGitCommand('push', function (text, code) {
                if ((text.indexOf('[rejected]') !== -1) || (code === 1)) {
                    // Try again
                    alert('Command failed');
                    document.getElementById('gitCloseButton').disabled = false;
                } else {
                    // Done!
                    document.getElementById('gitCloseButton').disabled = false;
                }
            }); // push
        }
    }); // commit    
}