Play
════════════════════════════════════════════════════════════════════════

let pos = xy(½ screenSize.x, 132)
let flip = xy(1, 1)


frame
────────────────────────────────────────────────────────────────────────

let sprite = astronaut.idle[0]
if joy.x:
   flip.x = joy.x
   sprite = astronaut.run[⌊modeFrames / 10⌋ mod 2]
   pos.x = loop(pos.x + joy.x, screenSize.x)

// Sky
setBackground(rgb(20%, 50%, 80%))
drawText(font, assetCredits.title, xy(½ screenSize.x, 10), textColor, ∅, ∅, 0, 0)

// Ground
drawRect(xy(0, 140), xy(screenSize.x, screenSize.y - 139), #DDD)

// Shadow
drawLine(pos + xy(-4, 8), pos + xy(+4, 8), rgba(0, 0, 0, 20%))

// Alien
drawSprite(sprite, pos, 0, flip)
