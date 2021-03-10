@echo off
rem Python 3 is called "python" on Windows(!),
rem but so is Python 2 and the Windows app-store launcher
rem shim for Python. So, first test for the presence
rem of py.exe and try to run it.

pushd %~dp0 
where.exe "py.exe" > NUL
if %ERRORLEVEL% EQU 0 (
    py -3 quadplay-server.py %*
) else (
    python quadplay-server.py %*
    if %ERRORLEVEL% EQU 9009 (
        echo "py.exe not found. Please disable the Windows App store shim and install Python 3.8 or later from python.org"
    )
)
popd
