ReDim args(WScript.Arguments.Count-1)
For i = 0 To WScript.Arguments.Count-1
    args(i) = WScript.Arguments(i)
Next
CreateObject("Wscript.Shell").Run "" & Join(args) & "", 0, False
