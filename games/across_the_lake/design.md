      **across the lake**
       **Design Doc**

*Prompt*: "You are a stone skipping on a lake"

*Design*: "Skippy Stone" == _Flappy Bird_ meets _Desert Golfing_

*Influences*:

- Alto's Adventure
- Loom
- Flappy Bird
- Desert Golfing
- Getting Over It


Coordinate Systems
=========================================================

World space:

- x = right, y = up, z = out of the screen
- x = 0 is the beginning of the world
- y = 0 is the water
- z = 0 is the skippy plane

Draw space:

- x = right, y = up, z = out of the screen
- x = 0, y = 0 is the center of the screen
- z = 0 is the skippy plane

There is no automatic perspective scaling. That is hardcoded into the art.
The `scaling(z)` function returns what the scaling should be for procedurally placed objects.


Task List
=========================================================

Morgan:
[ ] ~~Try to wiggle starting screen reflection~~
[ ] ~~Birds~~
[ ] ~~Fish~~
[x] Performance optimizations
[x] Draw small font
[x] Draw big font 
[x] Enable sequencing to run
[x] Animate particles
[x] Twilight sky and mountains
[x] Night sky, hills, and mountains
[x] Have variations on the first background layer based on camera pos
  [x] Live trees
  [x] Cabins
  [x] Urban
[x] Background palette fades
[x] Fix particle mapping not working correctly in the distance
[x] Change first background layer to be spawned
[x] Clouds
[x] Put junk in the water, comparable to a "starfield", to make the speed clearer
[x] Adjust skippy speed
[x] Add another layer in the back
[x] Shift the vertical parallax plane so that skippy is at y=0
[x] Make a straight conversion from depth to parallax rate, y offset, and z
[x] Spawn ripples on `skippy_hit_water_this_frame`
[x] Draw a better rock that looks like it is spinning
[x] Flip Y

thoughts:
[ ] can the sprite render differently when underwater?  Maybe spawn some bubbles?
    - if you check `````skippy_position.y < 0`, you'll know that the rock is underwater
[ ] vary the size of the splash based on the penalty  (I can set a variable or do something global to pass this along)
[ ] it would be awesome if you got a couple of perfect bounces in a row if some fish start jumping out of the water after you... really subtle stuff builds up.  after two in a row some birds appear, after 3 fish, after 4 wind lines 
[ ] a palette shift somewhere would also be cool
[ ] what if it was two splashes?  one when you hit the water and one when you leave it?  that would help cue you if you were late, and if you hit it perfectly it would be minimal
[ ] could we somehow have the credits text be rippling on the lake on the game over screen


Stephan:
must have:
    [ ] prep the itch page and write up the description and stuff
    [ ] make a playtest build
    [ ] you should never get more energy from a bounce than your last jump
then:
    [ ] pick a distance that seems long to be the other side of the lake, if you hit that its game over, but you made it
    [ ] tilt and angle for juicing the jump
    [ ] other obstacles
    [ ] flip the direction and go back the other way across the lake
    [ ] make the windows tighter for later jumps
    [ ] impact x-velocity no matter what, making it harder to predict the next bounce
    [ ] thoughts for why you're crossing the lake?

[x] fix acceleration for y-up (bounce is going bananas)
[x] set PENALTY_WINDOW to 3 frames
[x] add a constant for debugging that always perfectly bounces
[x] Rename all `rock_` to either `skippy_` or `player_`
[x] angle for spinning skippy
[x] start counting the number of times you hit the water before failing
[x] pass the number of times you bounced to the game over mode
[x] allow button presses after the hit as well as before
[x] credits should fade in on the game over screen
[x] initial title screen with just the lake
[x] when underwater/game over, the stone should slow down nicely and come sink out of frame
[x] hit a button to start again, stone flies in from the left 
[x] hook up sounds from stevel


Archived Code
========================================================================

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
def draw_wrapped_sprite(sprite, z):
   let pos = world_to_draw(xy(0, 0), z)
   pos.x = -loop(-pos.x, sprite.size.x)
   draw_sprite({sprite: sprite, pos: pos, z: pos.z})
   draw_sprite({sprite: sprite, pos: xy(pos.x + sprite.size.x, pos.y), z: pos.z})
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
[Original background tiling code, not currently used]
