@echo off
chcp 65001 > NUL
title quadplay✜ installer

if exist "OFL.txt" (
    echo Do not run the installer from inside of the doc folder.
    echo It is stored here but meant to be downloaded from the web.
    echo You already have quadplay installed and don't need it!
    pause
    exit /b 2
)

echo.
echo.
echo                                        ╷       ╷
echo                  ╭───╮ ╷   ╷  ───╮ ╭── │ ╭───╮ │   ───╮ ╷   ╷   ▒▒
echo                  │   │ │   │ ╭── │ │   │ │   │ │  ╭── │ │   │ ▒▒  ▒▒
echo                  ╰── │ ╰───┘ ╰───╯ ╰───╯ │ ──╯ ╰─ ╰───╯ ╰── │   ▒▒
echo                      ╵                   ╵                ──╯
echo.      
echo.

set /P ok="Install or upgrade Python 3 and Quadplay? (Y/N) "
if "%ok%"=="y" set ok=Y
if not "%ok%"=="Y" exit /b 1
echo.

rem Check for Python 3
set has_python=0
where py >NUL 2>NUL
if "%errorlevel%"=="0" (
	set has_python=1
	py -3 --version >NUL 2>NUL
	if not "%errorlevel%"=="0" set has_python=0
)

if "%has_python%"=="0" (
	rem Download Python installer
	echo Python 3 not detected. 	

	if not exist "python-installer.exe" (
		echo Downloading installer from python.org...
		curl -o python-installer.exe https://www.python.org/ftp/python/3.10.2/python-3.10.2-amd64.exe
		if "%errorlevel%"=="0" (
			echo ERROR: Python download failed!
			exit /b 2
		)
		echo Download complete.
	)
	echo.

	rem Run the Python installer
	echo Installing Python 3...
	echo "[Look for a permission popup window]"
	start /WAIT python-installer /simple /passive Include_doc=0 PrependPath=1 InstallAllUsers=0
	echo Python 3 installation complete.
	echo.

	rem Delete the installer
	del python-installer.exe
)

if not exist "quadplay-install.zip" (
	echo Downloading Quadplay zipfile...
	curl --location --output quadplay-install.zip https://github.com/morgan3d/quadplay/archive/refs/heads/main.zip
	echo Quadplay zipfile download complete.
	echo.
)

rem Run Python
rem py -3 helper.py handoff %1 %2 %3 %4 %5 %6 %7 %8 %9

rem Expand the zipfile
tar -xf quadplay-install.zip

rem Delete the zipfile
del quadplay-install.zip

rem Move the files to the installation location
echo Copying files to c:\quadplay...
xcopy /q /y /i /e quadplay-main\* c:\quadplay
del /y quadplay-main
echo Copying done.
echo.

echo Creating desktop shortcut...
rem Create a shortcut
rem (code from https://superuser.com/questions/392061/how-to-make-a-shortcut-from-cmd)
echo Set oWS = WScript.CreateObject("WScript.Shell") > CreateShortcut.vbs
echo sLinkFile = "%HOMEDRIVE%%HOMEPATH%\Desktop\quadplay.lnk" >> CreateShortcut.vbs
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> CreateShortcut.vbs
echo oLink.TargetPath = "C:\quadplay\quadplay.vbs" >> CreateShortcut.vbs
echo oLink.Save >> CreateShortcut.vbs
cscript CreateShortcut.vbs
del CreateShortcut.vbs
echo Shortcut created.
echo.
echo.
echo quadplay installation complete
echo
echo Click the "quadplay" link on your desktop or c:\quadplay\quadplay.vbs
echo to launch the development environment.
echo.
pause
