The **quadplay✜** fantasy console by [CasualEffects](https://casual-effects.com)
is now in public beta.

- [Play games online](https://morgan3d.github.io/quadplay/console/quadplay.html?kiosk=1)
- [Download the console](https://github.com/morgan3d/quadplay/archive/master.zip)
- [Preview the web IDE](https://morgan3d.github.io/quadplay/console/quadplay.html?IDE=1&game=quad://games/quadpaddle)
- [Read the manual](https://morgan3d.github.io/quadplay/doc/manual.md.html)

![](doc/emulator.png)

<img src="doc/emulator.png">

Features
========================================================

- Create games on Windows, macOS, Linux
- Play your games in any web browser on laptop, desktop, tablet, phone, Raspberry Pi 4, or Jetson Nano
- 60 fps @ 384 x 224 pixels = 12:7 aspect ≈ 16:9.3
- 4096 sRGB (4:4:4) colors
- Four players with virtual controls for D-pad and eight buttons
- Supports Xbox, Playstation, SNES, Stadia, Switch, 8bitdo, touch screen, and other controllers
- Hundreds of built-in sprites, sounds, and fonts
- Program in PyxlScript, a friendly Python-like language
- Order-independent, 4-bit alpha transparency
- Native 2.5D graphics with z-order
- 9.4 MB of total sprite memory
- Up to 64 sprite and font sheets of up to 1024x1024
- Optional 384 x 224, 192 x 112, 128 x 128, and [64 x 64](https://itch.io/jam/lowrezjam-2019) screen modes
- Free and open source


Join the Beta
========================================================

This beta version is fully functional and has already been used to ship jam games.
You can use an external editor (like VSCode) or the browser-based development environment.
To enable some features, you may have to edit a line of a text file in a separate editor (even Notepad)
right now. Soon, all core features will be supported directly in the browser.

To get started, you'll need Windows, macOS, or Linux and 
the following freely-available software.

_Required_:

- [**This SDK**](https://github.com/morgan3d/quadplay/archive/master.zip)
- [**Python 3.8**](https://www.python.org/downloads/)
- A **modern web browser** such as Chrome, Edge, Safari, or Firefox
- [**The manual**](https://morgan3d.github.io/quadplay/doc/manual.md.html)

_Optional_:

- A **code editor** such as [VS Code](https://code.visualstudio.com/), Emacs, or VIM. Use Python mode for PyxlScript or install our provided editor extensions
- A TMX map editor such as [Tiled](https://www.mapeditor.org/)
- A sprite and font pixel editor such as [Piskel](https://www.piskelapp.com/) or [GrafX2](http://pulkomandy.tk/projects/GrafX2/downloads?order=version&desc=1)
- A [SFX generator](https://www.bfxr.net/) and audio editor such as [Audacity](https://www.audacityteam.org/)
- An account on the [forums](http://quadplay.freeforums.net)
- Follow development online at [@CasualEffects](https://twitter.com/CasualEffects)

See the manual for a getting started guide, the change log, road map, and beta notes.


License
========================================================

The quadplay✜ runtime, compiler, and emulator are licensed as
[LGPL3](https://www.gnu.org/licenses/lgpl-3.0.en.html). 

You can create closed-source games with it and distribute your games
however you want, including commercially. If you modify the runtime
library, compiler, or emulator, then you must redistribute your
changes to those under the LGPL3 with your game as open source.

Portions of the IDE are under different open source licenses (BSD,
MIT, and public domain).

All sounds, sprites, and games distributed with quadplay✜ are Creative
Commons licensed. The copyright and license on each of those is in 
a JSON file next to the asset.

© 2020 Morgan McGuire
