@echo off
rem Python 3 is called "python" on Windows(!),
rem but so is Python 2 and the Windows app-store launcher
rem shim for Python. So, first test for the presence
rem of py.exe and try to run it.

where.exe "py.exe" > NUL
if %ERRORLEVEL% EQU 0 (
    py -3 quadplay %*
) else (
    python quadplay %*
)
