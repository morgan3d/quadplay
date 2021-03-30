# Stephan's TODO File

## notes:

- might want to mux enemy archytypes with attack types:
    - in other words, a tank enemy with melee might feel different from a tank 
      enemy with artillery
    - cardinal direction based:
        - melee (next to enemy)
        - gun (straight line from enemy, hits first thing on line
        - artillery (arcs and hits something without hitting anything in between)
        - volume (series of cells in a row, regardless of obstruction)
    - open:
        - spell (more like ikenfell, some kind of a non-cardinal pattern grid)

- you have so much mobility compared to enemy attacks, that the threat doesn't seem to come so much from direct damage
- either:
    - make enemy attacks more threatening
        - web to hold you in place so you need to coordinate
        - AoE so they're harder to get away from and achieve other goals
    - add other threats that you don't control
        - ItB: buildings
    - more enemies
    - spawn pressure

- first turn is lame
    - enemy is just attacking into space
    - no threat, nothing to do
    - either spawn enemy so that player is targeted
    - or give the enemy another target

## todos

finaling todo list:
- make an itch page (quadplay has instructions)
- set the fields in the makefile
- record screenshots
- upload a build

- add an object that enemies want to hit that the player doesn't them to hit
- enforce minimum distance on grenade

[x] merge all the procgen template stuff into one file
[x] have templates of multiple rows (lake with mountains)
[x] get enemies spawning
[x] check helps spawning on middle tiles

[x] all enemies get spawned in the last row

[x] add music tracks
[x] add title screen
[x] box should show "scout" for enemy instead of always showing the id (which doesn't help)

[ ] add "you died because... " (death reasons)
[ ] balanced enemies and villagers

[ ] other sfx
[ ] rearrange in game gui

[ ] escalation of enemies
[ ] high score system

[x] add music track
[x] doom clock
[x] grenade should have a minimum distance as well
[x] if selected enemy target score is less than 0, just move to the square and do nothing
[x] player squad unit prototypes (same archytpes to start)
[ ] change grenade enemy sprite to something that links up better with the theme
[ ] enemy that charges across the map in a straight line

[x] enemy property sketch
    [x] scout
    [x] gobsket
    [ ] BRAINGOB

## done
[x] indicate tiles that are going to be damage (maybe a red border like the green one?)
[x] bring building sprite from other itb prototype into this game as a placeholder
[x] visual layout
[x] power/upgrade idea -- systems sketch
[x] enemy spawner
[x] procedural map gen sketch
    [x] reduce size of test puzzle
    [x] make some row templates
    [x] have generate_tiles() return a random row template
    [x] make sure that flipping is working
    [x] place forests randomly on tiles
    [x] initial enemy sets
    [x] place enemies on rows
    [x] place HELPs
    [x] player character should be ok to spawn on forest -- add an "ok to spawn tile list"
[x] add game over screen
[x] set names from ian's sprites in yaml
[x] move the box with actions on top of the actor doing the action
