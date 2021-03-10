Set shell = CreateObject("Wscript.Shell")
shell.CurrentDirectory = shell.CurrentDirectory & "\\tools"
shell.Run "quadplay-server.cmd --nativeapp --quiet", 0, False