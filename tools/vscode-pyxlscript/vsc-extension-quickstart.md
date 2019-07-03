# Welcome to your VS Code Extension

## What's in the folder

* This folder contains all of the files necessary for your extension.
* `package.json` - this is the manifest file in which you declare your language support and define the location of the grammar file that has been copied into your extension.
* `syntaxes/pyxlscript.tmLanguage.json` - this is the Text mate grammar file that is used for tokenization.
* `language-configuration.json` - this is the language configuration, defining the tokens that are used for comments and brackets.
* `snippets/pyxlscript.json` - this is the file used to generate snippets of pyxlscript code

## Get up and running straight away

* Make sure the language configuration settings in `language-configuration.json` are accurate.
* Press `F5` to open a new window with your extension loaded.
* Create a new file with a file name suffix matching your language.
* Verify that syntax highlighting works and that the language configuration settings are working.

## Make changes

* You can relaunch the extension from the debug toolbar after making changes to the files listed above.
* You can also reload (`Ctrl+R` or `Cmd+R` on Mac) the VS Code window with your extension to load your changes.

## Add more language features

* To add features such as intellisense, hovers and validators check out the VS Code extenders documentation at https://code.visualstudio.com/docs

## Install your extension

* To start using your extension with Visual Studio Code copy it into the `<user home>/.vscode/extensions` folder and restart Code.
* To share your extension with the world, read on https://code.visualstudio.com/docs about publishing an extension.

## Package the extension
Based on [these instructions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

* Run `vsce package` to create a `pyxlscript-x.x.x.vsix` file that can be used to install the extension.
* Rename the built `.vsix` file to the standard file name: `mv pyxlscript-*.vsix ../vscode-pyxlscript.vsix`.
* End users run `code --install-extension ../vscode-pyxlscript.vsix` to install the packaged extension.
