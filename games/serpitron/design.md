                      **Serpitron**
                       *Design Doc*

TODO
=========================================================

Current Task Items
---------------------------------------------------------

[ ] Teaser images for levels
  [ ] Pyramid
  [ ] Pyramid with snow
  [ ] City
  [ ] City with snow
  [ ] Tree
  [ ] Tree with snow
  [ ] Add cloud as needed
  [ ] Add cowboy hat as needed
  [ ] Add rat hat as needed


Future Tasks
---------------------------------------------------------

[ ] Outfits


Change Log
---------------------------------------------------------

Completed Tasks:

[x] Reserve space for scores and info
[x] Make the screen a multiple of six on each axis
[x] Draw color variation assets
[x] Make torus geometry for board
[x] Add multiplayer
[x] Lock motion to six-pixel grid
[x] Draw tails (by remembering orientations)
[x] Detect collision
[x] Shrink on collision
[x] Bug: can reverse direction going down (needed two `loop()` calls)
[x] Shrink back into center instead of into head
[x] In makeSnake(), extract the color for each player
[x] Bug: Fix direction controls not working after 
    shrinking to minimum size (was misalignment with grid)
[x] Grow on food powerups
[x] Wiggle the snake
[x] Scores
   [x] Display
   [x] Increase based on length
   [x] Increase when another player hits
[x] Bug: Fix not being able to turn when on row or column 0
    (was sin/cos round off error)
[x] Playtest feedback:
   [x] Grow more for each food
   [x] Shrink less
   [x] Fix food getting stuck off the edge
   [x] Add invincibility period
   [x] Increase play space by putting scores on the top and 
       bottom instead of the sides
[x] Point powerups
[x] Different kinds of food
[x] Grow slower with more players
[x] Better (longer) background song
[x] Add sound assets
  [x] Grow
  [x] Points
  [x] Hit
  [x] Positional sound
[x] Fix: Use frame hooks to be able to shrink *and* grow at the same time
[x] Second playtest feedback:
  [x] Show points longer
  [x] Increase the value of the final powerup
  [x] Grow all snakes continuously
  [x] Increase the shrink penalty
  [x] Make coin borders darker
  [x] Make the grow sound longer
[x] Give visual feedback on success
  [x] Crown on leader and scoreboard
  [x] Animate point bonuses
  [x] Make more obvious when growing by showing swallowing animation
[x] Fix: color changing broken on title screen
[x] Varying background color
[ ] ~~Variable terrain (will be an issue for shadows)~~
[x] Extra modes
  [x] Pause screen
  [x] Placeholder title screen
  [x] Option to quit to title from the pause screen
  [x] Player selection screen + title screen
  [x] Multiplayer end condition (waves)
  [x] Singleplayer end condition (time)
[x] Shotgun Showdown wave
  [x] Draw assets
  [x] `hasGun` state on snakes, draw guns and hat
  [x] `shotArray` state
  [x] Auto-firing based on modeFrames
  [x] Sound effect
  [x] Shotgun screen shake
  [x] Hit detection
  [x] Grant guns to losing players at level start
  [x] Increase chance of a showdown level based on disparity
[x] New level transition _in_
  [x] Description and delay 
  [x] New `LevelTitle` mode
  [x] Fade
[x] Juice
  [x] Upgrade Broderick-7 --> Broderick-14
  [x] New game transition animation
  [x] Old level transition out
[x] Instructions message on `LevelTitle` for `level==0`
[x] Show controller icon hints on title screen
[x] Continue to show scores on title screens
[x] Identifier (beanie) for loser
[x] Show ranking on game over screen
[x] Pyramids in the desert
[x] Reset snake sizes per level
[x] Blizzard
  [x] Snowflakes
  [x] Fade using background color
[x] Make controls feel more responsive
   [x] Forgiveness on late turn
   [x] Show head turned immediately
   [x] Do not lock during ghosting
   [x] Shrink faster (from tail too)
[x] Implement coffee and donut powerups
[x] Add speed up and slow down sounds
[x] Rat waves
[x] Buildings in urban location
   [x] Shadows
   [x] Create a maze
   [x] Maintain reachability
[x] Add "Cloudy" weather type
[x] Added tiara for 2nd place
[x] Game Over juice
  [x] Show rankings at all times
  [x] Transition animation
  [x] Animation
[x] Fix single-player timer countdown to work with new mode changes
[x] Fix crazy super coffee (maybe it is the last coffee doubling?)
[x] Package 
  [x] Credits on pause screen
  [x] Preview image
  [x] Move to `games/`
  [x] Add to quadplay launcher
[x] Fix game-over transition
[x] Make appropriate single-player game over
   [x] Separate mode
   [x] Draw snake as juice



Game Design
=========================================================

The soul of the game is growing and shrinking. Most playtest changes
were to increase the rate of each.


Levels
---------------------------------------------------------

Each level is defined by a wave of powerups, and ends when those
powerups are consumed.

Each level is defined by "Location" + "Weather" + "Wave":

Location
: Cosmetic background and real obstructions. "Desert",
  "City", "Country"

Wave
: The types of powerups available. These are: "Apples", "Cherries", "Gold",
  "Diamonds", "Rats", "Coffee Break" (coffee accelerators and donut decelerators),
  "Showdown" (guns for the lowest-scoring players...a way of evening out unfair games)

Weather
: Cosmetic effects for variation. Includes time of day.
  "", "Cloudy", "Blizzard"


Implementation
=========================================================

Level Advancement
---------------------------------------------------------

The `powerupArray` being empty triggers advancement of the 
level. The `LevelTransition` spins out the current screen,
and then returns to the `Play` mode. The `Play` mode shows
the current level description and fades in.


Code Invariants
---------------------------------------------------------

All coordinates are in pixels, with (0, 0) as the center of the
lower-left corner. 

All objects are aligned (when they change orientation)
on a `cellSide` grid. 

The screen is drawn shifted by `cellSide / 2` so that sprites appear
properly centered.
