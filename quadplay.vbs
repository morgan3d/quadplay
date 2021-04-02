Set shell = CreateObject("Wscript.Shell")
shell.CurrentDirectory = shell.CurrentDirectory & "\\tools"
shell.Run "quadplay-server --nativeapp --quiet", 0, False