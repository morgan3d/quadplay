Set shell = CreateObject("Wscript.Shell")
shell.CurrentDirectory = shell.CurrentDirectory & "\\tools"

Dim cmd
cmd = "quadplay-server --nativeapp --quiet"
For Each arg In Wscript.Arguments
    if InStr(arg, " ") Then
        ' Quote arguments with spaces
        arg = """" & arg & """"
    End If
    cmd = cmd & " " & arg
Next

shell.Run cmd, 0, False